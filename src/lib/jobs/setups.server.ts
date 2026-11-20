// Nightly short-term setups refresh. After each US close the scheduled `setups` job walks one cycle:
//   bars → context → scan → cross → evaluate → publish → bots → done
// Each call does a small slice inside the scheduler's short window; several calls can run at once
// (tickers are claimed with SKIP LOCKED, single-step phases take a lease). The math is the same pure
// code the full-history script uses (src/lib/signals/*), so the job only maintains what changed.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { COVERAGE } from "@/lib/coverage";
import type { Bar } from "@/lib/financials/types";
import { fetchCboeDaily, fetchNasdaqDaily, fetchYahoo, isCboeIndex, pool, toBars } from "@/lib/market-data.server";
import { benchFromBars, BENCH_SYMBOLS, contextFromBench, parseCboeCsv, VIX3M_URL, type BenchFile, type EngineContext } from "@/lib/signals/context";
import { LIVE_BARS, scanTicker, tradeOutcome, type ScanOut } from "@/lib/signals/scan";
import { finalize, variantPartial, type DailyAgg, type VariantPartial } from "@/lib/signals/backtest";
import { formPairs, PAIRS, spreadZ, type PairLeg } from "@/lib/signals/pairs";
import { isNearMiss, parseVariantKey, pickSetups, riskPlan, variantKey, variantMeta, type LiveFiring, type MarketContext, type PairSetup, type SetupsFile, type VariantMeta } from "@/lib/signals/setups";
import { STRATEGY } from "@/lib/signals/strategies";
import { parseRules, stepBot, type Candidate, type Ohlc, type Position } from "@/lib/signals/bots";
import { GATE, OOS_START } from "@/lib/signals/backtest";
import { roundTripCost, tradeCost } from "@/lib/signals/features";
import type { Json } from "@/integrations/supabase/types";
import { barProblem } from "@/lib/jobs/bar-check";

type Result = { ok: boolean; items: number; detail: Record<string, unknown> };
const db = () => supabaseAdmin;
const sf = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");
const nowIso = () => new Date().toISOString();
const PAIR_KEY = variantKey("pairs", 1, 20);
const SAMPLE_TAIL = 60;
const SERIES_BARS = 300;

// ---------------------------------------------------------------- session timing

/** Current New York date/time parts. */
function nyNow(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: p.weekday as string };
}
const prevWeekday = (d: string) => {
  const t = new Date(d + "T12:00:00Z");
  do t.setUTCDate(t.getUTCDate() - 1);
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return t.toISOString().slice(0, 10);
};
/** The latest session whose closing bars should be final (40 minutes after the 4pm close). */
export function targetSession(d = new Date()): string {
  const ny = nyNow(d);
  const weekend = ny.weekday === "Sat" || ny.weekday === "Sun";
  if (!weekend && ny.minutes >= 16 * 60 + 40) return ny.date;
  return prevWeekday(ny.date);
}
/** UTC instant of 4:10pm New York on a date (bars written after it are closing bars). */
function closeInstant(date: string): string {
  for (const off of [4, 5]) {
    const t = new Date(`${date}T${String(16 + off).padStart(2, "0")}:10:00Z`);
    if (nyNow(t).minutes === 16 * 60 + 10) return t.toISOString();
  }
  return `${date}T21:10:00Z`;
}

// ---------------------------------------------------------------- bars

async function fetchDaily(symbol: string): Promise<Bar[]> {
  try {
    return toBars(await fetchYahoo(symbol, "5d", "1d"), false);
  } catch (e) {
    if (isCboeIndex(symbol)) return fetchCboeDaily(symbol, 7);
    if (symbol.startsWith("^")) throw e;
    const stock = !BENCH_SYMBOLS.includes(symbol);
    return fetchNasdaqDaily(symbol, stock ? "stocks" : "etf", 7);
  }
}

/**
 * Store bars, rejecting any whose open or close lies outside its high-low range (`barProblem`). A
 * rejected bar for the session itself throws after the good bars are stored, so the symbol is
 * reported as failed for this session instead of carrying an impossible bar into the scan.
 */
async function upsertBars(symbol: string, bars: Bar[], session?: string) {
  const bad: string[] = [];
  const good = bars.filter(([date, open, high, low, close]) => {
    const p = barProblem({ open, high, low, close });
    if (p) bad.push(`${date}: ${p}`);
    return !p;
  });
  const rows = good.map(([date, open, high, low, close, adj, volume]) => ({ symbol, date, open, high, low, close, adj_close: adj, volume: Math.round(volume), updated_at: nowIso() }));
  if (rows.length) {
    const { error } = await db().from("market_bars").upsert(rows);
    if (error) throw new Error(error.message);
  }
  if (session && bad.some((b) => b.startsWith(session))) throw new Error(`rejected bar ${bad.find((b) => b.startsWith(session))}`);
  return rows.length;
}

const ALL = () => [...BENCH_SYMBOLS, ...COVERAGE.map((c) => c.ticker)];

// ---------------------------------------------------------------- context cache

let ctxCache: { asOf: string; ctx: EngineContext; bench: BenchFile } | null = null;

async function loadBench(): Promise<BenchFile> {
  const { data, error } = await db().storage.from("datasets").download("setups/bench.json");
  if (error || !data) throw new Error(`benchmarks file missing: ${error?.message ?? "no data"}`);
  return JSON.parse(await data.text()) as BenchFile;
}

async function context(asOf: string) {
  if (ctxCache?.asOf === asOf) return ctxCache;
  const bench = await loadBench();
  if (bench.dates[bench.dates.length - 1] !== asOf) throw new Error(`benchmarks end ${bench.dates.at(-1)}, expected ${asOf}`);
  ctxCache = { asOf, bench, ctx: contextFromBench(bench) };
  return ctxCache;
}

// ---------------------------------------------------------------- cycle

interface Cycle {
  as_of: string;
  phase: string;
  cursor: number;
  started_at: string;
  updated_at: string;
  detail: Record<string, unknown>;
}

async function currentCycle(): Promise<Cycle | null> {
  const { data } = await db().from("setup_cycles").select("as_of, phase, cursor, started_at, updated_at, detail").order("as_of", { ascending: false }).limit(1).maybeSingle();
  return (data as Cycle | null) ?? null;
}

const advance = (asOf: string, from: string, to: string) => db().rpc("setup_advance", { _as_of: asOf, _from: from, _to: to });
const lease = async (asOf: string, phase: string, secs = 60) => !!(await db().rpc("setup_lease", { _as_of: asOf, _phase: phase, _secs: secs })).data;
const take = async (asOf: string, phase: string, n: number) => (await db().rpc("setup_take", { _as_of: asOf, _phase: phase, _n: n })).data as number | null;

export async function runSetups(left: () => boolean): Promise<Result> {
  const target = targetSession();
  let cycle = await currentCycle();
  if (!cycle || (cycle.as_of < target && cycle.phase === "done")) {
    if (cycle?.detail?.checked === target) return { ok: true, items: 0, detail: { idle: true, asOf: cycle.as_of, note: "no session on " + target } };
    // Holidays: the newest SPY bar decides the session.
    const spy = (await fetchDaily("SPY")).filter((b) => b[0] <= target);
    const last = spy.at(-1)?.[0];
    if (!last || (cycle && last <= cycle.as_of)) {
      if (cycle) await db().from("setup_cycles").update({ detail: { ...cycle.detail, checked: target } as Json }).eq("as_of", cycle.as_of);
      return { ok: true, items: 0, detail: { idle: true, note: `no new session (latest ${last})` } };
    }
    await upsertBars("SPY", spy);
    const { error } = await db().from("setup_cycles").insert({ as_of: last, phase: "bars", cursor: 0, detail: {} });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    cycle = await currentCycle();
  }
  if (!cycle) return { ok: false, items: 0, detail: { error: "no cycle" } };
  if (cycle.phase === "done") return { ok: true, items: 0, detail: { idle: true, asOf: cycle.as_of } };
  // A phase stuck for 4 hours (a run that keeps getting cancelled) moves on with what it has.
  const stuck = Date.now() - Date.parse(cycle.updated_at) > 4 * 3600_000;
  const asOf = cycle.as_of;
  const out = await PHASES[cycle.phase as keyof typeof PHASES]?.(asOf, left, cycle, stuck);
  return out ?? { ok: false, items: 0, detail: { error: `unknown phase ${cycle.phase}` } };
}

type Phase = (asOf: string, left: () => boolean, cycle: Cycle, stuck: boolean) => Promise<Result>;

const PHASES: Record<string, Phase> = {
  /** Closing bars for every symbol that doesn't have a final bar for the session yet. */
  async bars(asOf, left) {
    const symbols = ALL();
    const closeAt = closeInstant(asOf);
    let items = 0;
    const failed: string[] = [];
    const rejected: string[] = [];
    while (left()) {
      const start = await take(asOf, "bars", 6);
      if (start == null) break;
      if (start >= symbols.length) {
        await advance(asOf, "bars", "context");
        return { ok: true, items, detail: { asOf, phase: "bars", done: true } };
      }
      const batch = symbols.slice(start, start + 6);
      const { data: have } = await db().from("market_bars").select("symbol, updated_at").eq("date", asOf).in("symbol", batch);
      const fresh = new Set((have ?? []).filter((r) => r.updated_at >= closeAt).map((r) => r.symbol));
      const todo = batch.filter((s) => !fresh.has(s));
      const res = await pool(todo, 3, async (s) => upsertBars(s, (await fetchDaily(s)).filter((b) => b[0] <= asOf), asOf));
      res.forEach((r, k) => {
        if (r.status === "fulfilled") items += r.value;
        else {
          failed.push(todo[k]);
          const why = String((r.reason as Error)?.message ?? "");
          if (why.startsWith("rejected bar")) rejected.push(`${todo[k]} ${why.slice(13)}`);
        }
      });
    }
    return { ok: true, items, detail: { asOf, phase: "bars", failed, ...(rejected.length ? { rejected } : {}) } };
  },

  /** Extend the calendar/benchmark file to the session and queue every ticker for the scan. */
  async context(asOf, _left, cycle) {
    if (!(await lease(asOf, "context", 90))) return { ok: true, items: 0, detail: { asOf, phase: "context", waiting: true } };
    const bench = await loadBench();
    const lastDate = bench.dates[bench.dates.length - 1];
    const bars: Record<string, Bar[]> = {};
    for (const sym of BENCH_SYMBOLS) {
      const o = bench.o[sym] ?? [], c = bench.c[sym] ?? [];
      bars[sym] = bench.dates.flatMap((d, i) => (c[i] == null ? [] : [[d, o[i] ?? c[i]!, c[i]!, c[i]!, c[i]!, c[i]!, 0] as Bar]));
    }
    if (lastDate < asOf) {
      const { data: rows } = await db().from("market_bars").select("symbol, date, open, high, low, close, adj_close, volume").in("symbol", BENCH_SYMBOLS).gt("date", lastDate).lte("date", asOf).order("date");
      for (const r of rows ?? []) bars[r.symbol]?.push([r.date, Number(r.open), Number(r.high), Number(r.low), Number(r.close), Number(r.adj_close ?? r.close), Number(r.volume ?? 0)]);
    }
    let v3 = new Map<string, number>();
    try {
      const res = await fetch(VIX3M_URL, { headers: { "user-agent": "Mozilla/5.0 (FiledUnder)" }, signal: AbortSignal.timeout(8000) });
      if (res.ok) v3 = parseCboeCsv(await res.text());
    } catch {
      /* keep the stored term structure */
    }
    bench.dates.forEach((d, i) => bench.vix3m[i] != null && !v3.has(d) && v3.set(d, bench.vix3m[i]!));
    const next = benchFromBars(bars, v3, asOf);
    if (next.dates[next.dates.length - 1] !== asOf) throw new Error(`SPY has no bar for ${asOf}`);
    const { error } = await db().storage.from("datasets").upload("setups/bench.json", new Blob([JSON.stringify(next)], { type: "application/json" }), { upsert: true });
    if (error) throw new Error(error.message);
    ctxCache = null;
    const rows = COVERAGE.map((c) => ({ ticker: c.ticker, sector: c.sector || null }));
    for (let k = 0; k < rows.length; k += 500) await db().from("setup_scan").upsert(rows.slice(k, k + 500), { onConflict: "ticker", ignoreDuplicates: true });
    await advance(asOf, "context", "scan");
    return { ok: true, items: next.dates.length, detail: { asOf, phase: "context", from: lastDate, vix3m: v3.get(asOf) ?? null, detail: cycle.detail } };
  },

  /** Rescan a few tickers per call with full history; keep the samples tail, live signals and outcomes current. */
  async scan(asOf, left, _cycle, stuck) {
    const { ctx } = await context(asOf);
    let items = 0;
    const errors: string[] = [];
    while (left()) {
      const { data: claimed } = await db().rpc("setup_claim_tickers", { _as_of: asOf, _n: 3 });
      const list = (claimed ?? []) as { ticker: string; sector: string | null }[];
      if (!list.length) {
        const { count } = await db().from("setup_scan").select("ticker", { count: "exact", head: true }).or(`scanned_for.is.null,scanned_for.lt.${asOf}`);
        if (!count || stuck) await advance(asOf, "scan", "cross");
        return { ok: true, items, detail: { asOf, phase: "scan", remaining: count ?? 0 } };
      }
      try {
        items += await scanBatch(asOf, ctx, list);
      } catch (e) {
        errors.push((e as Error).message);
        await db().from("setup_scan").update({ claimed_at: null, error: (e as Error).message.slice(0, 300) }).in("ticker", list.map((x) => x.ticker));
      }
    }
    return { ok: errors.length === 0, items, detail: { asOf, phase: "scan", errors } };
  },

  /** Cross-company signals: cointegrated pairs per sector and customer momentum along supply links. */
  async cross(asOf, left) {
    const { ctx } = await context(asOf);
    const sectors = [...new Set(COVERAGE.map((c) => c.sector).filter(Boolean))].sort();
    let items = 0;
    while (left()) {
      const k = await take(asOf, "cross", 1);
      if (k == null) break;
      if (k > sectors.length) {
        await advance(asOf, "cross", "evaluate");
        return { ok: true, items, detail: { asOf, phase: "cross", done: true } };
      }
      items += k < sectors.length ? await pairsFor(asOf, sectors[k]) : await customerMomentum(asOf, ctx);
    }
    return { ok: true, items, detail: { asOf, phase: "cross" } };
  },

  /** Per-variant statistics from the database aggregates (one variant at a time). */
  async evaluate(asOf, left) {
    const { ctx } = await context(asOf);
    const { data: list } = await db().rpc("setup_variant_list");
    const variants = ((list ?? []) as { variant: string }[]).map((v) => v.variant).sort();
    const idx = new Map(ctx.dates.map((d, i) => [d, i]));
    let items = 0;
    while (left()) {
      const k = await take(asOf, "evaluate", 1);
      if (k == null) break;
      if (k >= variants.length) {
        await advance(asOf, "evaluate", "publish");
        return { ok: true, items, detail: { asOf, phase: "evaluate", done: true } };
      }
      const { data: rows, error } = await db().rpc("setup_variant_daily", { _variant: variants[k] });
      if (error) throw new Error(error.message);
      // One JSON array of [date, n, net, ex, gross, hits] per signal day (not row-limited).
      const days: DailyAgg[] = ((rows ?? []) as unknown as [string, number, number, number, number, number][])
        .map(([d, n, net, ex, gross, hits]) => ({ i: idx.get(d) ?? -1, n, net, ex, gross, hits }))
        .filter((r) => r.i >= 0);
      const partial = variantPartial(variants[k], days, ctx.dates, ctx.regime);
      await db().from("setup_variant_stats").upsert({ variant: variants[k], as_of: asOf, stats: { partial } as unknown as Json, updated_at: nowIso() });
      items++;
    }
    return { ok: true, items, detail: { asOf, phase: "evaluate" } };
  },

  /** Strict gate across all variants, forward record, today's setups and market context. */
  async publish(asOf) {
    if (!(await lease(asOf, "publish", 90))) return { ok: true, items: 0, detail: { asOf, phase: "publish", waiting: true } };
    const { ctx } = await context(asOf);
    const D = ctx.dates.length;
    const { data: statRows } = await db().from("setup_variant_stats").select("variant, as_of, stats");
    const parts = (statRows ?? [])
      .map((r) => (r.stats as { partial?: VariantPartial } & Partial<VariantMeta>).partial ?? (r.stats as unknown as VariantPartial))
      .filter((p): p is VariantPartial => !!p?.key && !!p.outSample);
    const { data: fwd } = await db().rpc("setup_forward_stats");
    const live = new Map(((fwd ?? []) as { variant: string; n: number; avg_net: number; avg_ex: number; hits: number; first_seen: string }[]).map((r) => [r.variant, r]));
    const variants: VariantMeta[] = finalize(parts).map((p) => {
      const L = live.get(p.key);
      return variantMeta(p, L ? { n: L.n, avgNet: round(L.avg_net, 5), avgExSpy: round(L.avg_ex, 5), hit: L.n ? round(L.hits / L.n, 4) : null, since: L.first_seen } : { n: 0, avgNet: null, avgExSpy: null, hit: null, since: null });
    });
    for (let k = 0; k < variants.length; k += 20)
      await db().from("setup_variant_stats").upsert(variants.slice(k, k + 20).map((v) => ({ variant: v.key, as_of: asOf, stats: { partial: parts.find((p) => p.key === v.key), meta: v } as unknown as Json, updated_at: nowIso() })));
    const sigs = await selectAll((a, b) => db().from("setup_signals").select("ticker, variant, fired_at, name, sector, strength, detail, price, atr, spark, context").eq("last_seen", asOf).gte("fired_at", ctx.dates[D - LIVE_BARS]).range(a, b));
    const liveF: LiveFiring[] = sigs
      .filter((s) => s.variant !== PAIR_KEY)
      .map((s) => ({ ticker: s.ticker, name: s.name ?? s.ticker, sector: s.sector ?? "", variant: s.variant, firedAt: s.fired_at, strength: Number(s.strength ?? 0), detail: s.detail ?? "", price: Number(s.price ?? 0), atr: Number(s.atr ?? 0), spark: (s.spark ?? []) as number[] }));
    const today = ctx.regime[D - 1];
    const setups = pickSetups(variants, liveF, today);
    const pairs = sigs.filter((s) => s.variant === PAIR_KEY && s.fired_at === asOf).map((s) => s.context as unknown as PairSetup).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 40);
    const market = await marketContext(asOf, ctx);
    const { count } = await db().from("setup_scan").select("ticker", { count: "exact", head: true }).eq("scanned_for", asOf).is("error", null);
    const payload: SetupsFile = {
      generatedAt: nowIso(), asOf, companies: count ?? 0, regime: today, oosStart: OOS_START, gate: GATE, variants, setups,
      pairsProven: !!variants.find((v) => v.key === PAIR_KEY)?.passed, pairs, market, source: "daily",
    };
    const { error } = await db().from("setup_results").upsert({ as_of: asOf, generated_at: payload.generatedAt, payload: payload as unknown as Json });
    if (error) throw new Error(error.message);
    await db().from("setup_results").delete().lt("as_of", ctx.dates[Math.max(0, D - 30)]);
    await advance(asOf, "publish", "bots");
    return { ok: true, items: setups.length, detail: { asOf, phase: "publish", setups: setups.length, proven: variants.filter((v) => v.passed).length, pairs: pairs.length } };
  },

  /** Paper autopilots: fill, exit and queue positions for each active bot (one bot at a time). */
  async bots(asOf, left, _cycle, stuck) {
    if (stuck) {
      await advance(asOf, "bots", "done");
      return { ok: false, items: 0, detail: { asOf, phase: "bots", note: "gave up on bots still failing after 4 hours" } };
    }
    const { ctx } = await context(asOf);
    let items = 0;
    let cand: Candidate[] | null = null;
    while (left()) {
      const cutoff = new Date(Date.now() - 120_000).toISOString();
      const { data: next } = await db().from("paper_bots").select("id, user_id, rules, capital, status, last_as_of, last_run_at, started_on").eq("status", "active").or(`last_as_of.is.null,last_as_of.lt.${asOf}`).order("last_run_at", { ascending: true, nullsFirst: true }).limit(20);
      const bot = (next ?? []).find((b) => !b.last_run_at || b.last_run_at < cutoff);
      if (!bot) {
        if (!next?.length) await advance(asOf, "bots", "done");
        return { ok: true, items, detail: { asOf, phase: "bots", done: !next?.length } };
      }
      // Claim it (another run may be on the same bot).
      const { data: claimed } = await db().from("paper_bots").update({ last_run_at: nowIso() }).eq("id", bot.id).or(`last_run_at.is.null,last_run_at.lt.${cutoff}`).select("id");
      if (!claimed?.length) continue;
      try {
        if (bot.user_id) {
          const { data: limit } = await db().rpc("paper_bot_limit", { _user: bot.user_id });
          if (!limit) {
            await db().from("paper_bots").update({ status: "paused", last_error: "Automations are locked after the trial; choose a plan on the Billing page" }).eq("id", bot.id);
            continue;
          }
        }
        cand ??= await candidates(asOf, ctx);
        await runBot(asOf, bot, cand);
        items++;
      } catch (e) {
        await db().from("paper_bots").update({ last_error: (e as Error).message.slice(0, 300) }).eq("id", bot.id);
      }
    }
    return { ok: true, items, detail: { asOf, phase: "bots" } };
  },
};

const round = (x: number | null | undefined, d: number) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------- scan

async function priceFile(ticker: string): Promise<Bar[]> {
  const { data } = await db().storage.from("datasets").download(`prices/${sf(ticker)}.json`);
  if (!data) return [];
  return ((JSON.parse(await data.text()) as { bars?: Bar[] }).bars ?? []);
}

async function scanBatch(asOf: string, ctx: EngineContext, list: { ticker: string; sector: string | null }[]): Promise<number> {
  const D = ctx.dates.length;
  const tickers = list.map((x) => x.ticker);
  const tail = ctx.dates[D - SAMPLE_TAIL];
  const shortFrom = ctx.dates[Math.max(0, D - 160)];
  const failsFrom = ctx.dates[Math.max(0, D - 420)];
  const [files, recent, earn, buys, shorts, sigs, fails] = await Promise.all([
    Promise.all(tickers.map((t) => priceFile(t).catch(() => [] as Bar[]))),
    db().from("market_bars").select("symbol, date, open, high, low, close, adj_close, volume").in("symbol", tickers).gte("date", ctx.dates[Math.max(0, D - 45)]).lte("date", asOf).order("date").limit(5000),
    db().from("earnings_events").select("ticker, filed").in("ticker", tickers).limit(5000),
    db().from("insider_buys").select("ticker, filed, owner, value, plan_10b5").in("ticker", tickers).limit(5000),
    db().from("short_volume").select("symbol, date, short_vol, total_vol").in("symbol", tickers).gte("date", shortFrom).limit(5000),
    db().from("setup_signals").select("ticker, variant, fired_at, first_seen, outcome_net, side, horizon, cost").in("ticker", tickers).gte("fired_at", ctx.dates[Math.max(0, D - 80)]).limit(5000),
    // SEC fails-to-deliver half-months (kept current by the gov-data job)
    db().from("alt_data").select("ticker, date, value").eq("dataset", "settlement").in("ticker", tickers).gte("date", failsFrom).limit(5000),
  ]);
  const samples: Record<string, unknown>[] = [];
  const signals: Record<string, unknown>[] = [];
  const series: Record<string, unknown>[] = [];
  const scanRows: Record<string, unknown>[] = [];
  const idx = new Map(ctx.dates.map((d, i) => [d, i]));
  for (let k = 0; k < list.length; k++) {
    const { ticker, sector } = list[k];
    const name = COVERAGE.find((c) => c.ticker === ticker)?.shortName ?? ticker;
    const file = files[k];
    const fileEnd = file.at(-1)?.[0] ?? "";
    const tailBars: Bar[] = (recent.data ?? [])
      .filter((r) => r.symbol === ticker && r.date > fileEnd)
      .map((r) => [r.date, Number(r.open), Number(r.high), Number(r.low), Number(r.close), Number(r.adj_close ?? r.close), Number(r.volume ?? 0)]);
    const bars = [...file, ...tailBars];
    const stale = bars.at(-1)?.[0] !== asOf;
    const events = {
      earnings: (earn.data ?? []).filter((e) => e.ticker === ticker).map((e) => e.filed),
      buys: (buys.data ?? []).filter((b) => b.ticker === ticker).map((b) => ({ filed: b.filed, owner: b.owner, value: Number(b.value ?? 0), plan: b.plan_10b5 })),
      short: (shorts.data ?? []).filter((s) => s.symbol === ticker && Number(s.total_vol) > 0).map((s) => ({ date: s.date, ratio: Number(s.short_vol) / Number(s.total_vol) })),
      fails: (fails.data ?? []).filter((x) => x.ticker === ticker && x.date && x.value != null).map((x) => ({ end: x.date as string, value: Number(x.value) })),
    };
    let out: ScanOut | null = null;
    try {
      out = scanTicker(ctx, { ticker, sector: sector ?? "", bars, events });
    } catch (e) {
      scanRows.push({ ticker, sector, scanned_for: asOf, claimed_at: null, error: `scan: ${(e as Error).message}`.slice(0, 300), updated_at: nowIso() });
      continue;
    }
    if (!out) {
      scanRows.push({ ticker, sector, scanned_for: asOf, claimed_at: null, bars: bars.length, samples: 0, error: bars.length ? "not enough history" : "no prices", updated_at: nowIso() });
      continue;
    }
    const { a, f, bench } = out;
    const last = D - 1;
    // Samples whose signal falls in the tail are rewritten (their outcomes may have just completed).
    const tailSamples = out.samples.filter((s) => s.i >= D - SAMPLE_TAIL);
    for (const s of tailSamples) samples.push({ ticker, variant: s.variant, d: ctx.dates[s.i], net: round(s.net, 6), ex: round(s.ex, 6), gross: round(s.gross, 6) });
    // Live signals (skip when the ticker's bar for the session isn't in yet).
    const existing = new Map((sigs.data ?? []).filter((s) => s.ticker === ticker).map((s) => [`${s.variant}|${s.fired_at}`, s]));
    const spark = Array.from(a.c.slice(D - 60)).map((x) => round(x, 2));
    if (!stale) {
      for (const F of out.firings.filter((x) => x.i >= D - LIVE_BARS)) {
        const key = `${F.variant}|${ctx.dates[F.i]}`;
        const prev = existing.get(key);
        existing.delete(key);
        signals.push({
          ticker, variant: F.variant, fired_at: ctx.dates[F.i], first_seen: prev?.first_seen ?? asOf, last_seen: asOf, name, sector, strategy: F.strategy, side: F.side, horizon: F.horizon,
          strength: round(F.strength, 3), detail: F.detail, price: round(a.c[last], 4), atr: round(f.atr14[last], 4), dv20: Math.round(f.dv20[last]) || null, cost: round(F.cost, 5), spark,
          context: { shortRatio: round(f.ev?.shortRatio5[last], 4), earnIn: Number.isFinite(f.ev?.earnAhead[last] ?? NaN) ? f.ev!.earnAhead[last] : null } as Json,
        });
      }
    }
    // Outcomes of earlier signals whose holding period has finished.
    for (const s of existing.values()) {
      if (s.outcome_net != null) continue;
      const i = idx.get(s.fired_at);
      if (i == null) continue;
      const o = tradeOutcome(a, bench, ctx.spy, i, s.side as 1 | -1, s.horizon, Number(s.cost ?? 0));
      if (!o) continue;
      signals.push({ ticker, variant: s.variant, fired_at: s.fired_at, outcome_net: round(o.net, 6), outcome_ex: round(o.ex, 6), outcome_at: asOf });
      // Cross-company variants have no per-ticker replay, so their finished trades become samples here.
      if (s.variant.startsWith("custMom")) samples.push({ ticker, variant: s.variant, d: s.fired_at, net: round(o.net, 6), ex: round(o.ex, 6), gross: round(o.gross, 6) });
    }
    const from = Math.max(a.start, D - SERIES_BARS);
    const s5 = f.ev?.shortRatio5[last];
    series.push({
      ticker, sector, start_date: ctx.dates[from], end_date: stale ? (bars.at(-1)?.[0] ?? asOf) : asOf,
      o: Array.from(a.o.slice(from)).map((x) => round(x, 4)), c: Array.from(a.c.slice(from)).map((x) => round(x, 4)),
      dv20: Math.round(f.dv20[last]) || null, r5: round(a.c[last] / a.c[last - 5] - 1, 5), r21: round(a.c[last] / a.c[last - 21] - 1, 5),
      vol60: round(f.vol60[last], 5), above200: a.c[last] > f.sma200[last], near_high: a.c[last] >= 0.98 * f.max252[last],
      short5: s5 != null && Number.isFinite(s5) ? round(s5, 4) : null, updated_at: nowIso(),
    });
    scanRows.push({ ticker, sector, scanned_for: asOf, claimed_at: null, bars: bars.length, samples: out.samples.length, error: stale ? "no bar for the session yet" : null, updated_at: nowIso() });
  }
  const done = scanRows.filter((r) => !String(r.error ?? "").startsWith("scan:")).map((r) => r.ticker as string);
  await db().from("setup_samples").delete().in("ticker", done).gte("d", tail).not("variant", "like", "custMom%");
  if (samples.length) {
    const { error } = await db().from("setup_samples").insert(samples as never);
    if (error) throw new Error(error.message);
  }
  const fullSignals = signals.filter((s) => "last_seen" in s);
  const outcomes = signals.filter((s) => !("last_seen" in s));
  if (fullSignals.length) {
    const { error } = await db().from("setup_signals").upsert(fullSignals as never);
    if (error) throw new Error(error.message);
  }
  for (const o of outcomes) await db().from("setup_signals").update({ outcome_net: o.outcome_net, outcome_ex: o.outcome_ex, outcome_at: o.outcome_at } as never).eq("ticker", o.ticker as string).eq("variant", o.variant as string).eq("fired_at", o.fired_at as string);
  if (series.length) await db().from("setup_series").upsert(series as never);
  await db().from("setup_scan").upsert(scanRows as never);
  return list.length;
}

// ---------------------------------------------------------------- cross-company

async function pairsFor(asOf: string, sector: string): Promise<number> {
  const { data } = await db().from("setup_series").select("ticker, o, c, dv20, start_date, end_date").eq("sector", sector).eq("end_date", asOf).order("dv20", { ascending: false }).limit(PAIRS.maxNames);
  const rows = (data ?? []).filter((r) => r.c?.length === SERIES_BARS);
  if (rows.length < 2) return 0;
  const legs: PairLeg[] = rows.map((r) => ({ ticker: r.ticker, o: Float64Array.from(r.o as number[]), c: Float64Array.from(r.c as number[]), start: 0, dv20: new Float64Array(SERIES_BARS).fill(Number(r.dv20 ?? 0)) }));
  const T = SERIES_BARS - 1;
  const names = new Map(COVERAGE.map((c) => [c.ticker, c.shortName]));
  const out: Record<string, unknown>[] = [];
  for (const p of formPairs(legs, T)) {
    const z = spreadZ(legs, p, T);
    if (Math.abs(z) < PAIRS.entryZ) continue;
    const A = legs[p.a], B = legs[p.b];
    const pair: PairSetup = {
      a: A.ticker, b: B.ticker, nameA: names.get(A.ticker) ?? A.ticker, nameB: names.get(B.ticker) ?? B.ticker, sector,
      z: +z.toFixed(2), beta: +p.beta.toFixed(3), halfLife: +p.hl.toFixed(1), rho: +p.rho.toFixed(3), adf: +p.adf.toFixed(2), side: z < 0 ? 1 : -1,
      zs: Array.from({ length: 120 }, (_, k) => +spreadZ(legs, p, T - 119 + k).toFixed(2)), priceA: +A.c[T].toFixed(2), priceB: +B.c[T].toFixed(2),
    };
    out.push({ ticker: `${A.ticker}/${B.ticker}`, variant: PAIR_KEY, fired_at: asOf, first_seen: asOf, last_seen: asOf, name: `${pair.nameA} / ${pair.nameB}`, sector, strategy: "pairs", side: pair.side, horizon: 20, strength: Math.abs(pair.z), detail: `Spread ${pair.z} standard deviations`, price: pair.priceA, context: pair as unknown as Json });
  }
  if (out.length) await db().from("setup_signals").upsert(out as never, { onConflict: "ticker,variant,fired_at", ignoreDuplicates: true });
  return out.length;
}

async function customerMomentum(asOf: string, ctx: EngineContext): Promise<number> {
  const D = ctx.dates.length;
  if ((D - 1) % 21 !== 0) return 0; // monthly rule, same bar grid as the full-history scan
  const links = await selectAll((a, b) => db().from("supply_links").select("ticker, counterparty_ticker, relation, filed").in("relation", ["customer", "supplier"]).not("counterparty_ticker", "is", null).lte("filed", asOf).order("id").range(a, b));
  const customersOf = new Map<string, Set<string>>();
  for (const l of links) {
    const [sup, cus] = l.relation === "customer" ? [l.ticker, l.counterparty_ticker!] : [l.counterparty_ticker!, l.ticker];
    if (sup === cus) continue;
    (customersOf.get(sup) ?? customersOf.set(sup, new Set()).get(sup)!).add(cus);
  }
  const all = [...new Set([...customersOf.keys(), ...[...customersOf.values()].flatMap((s) => [...s])])];
  const stats = new Map<string, { r21: number; vol60: number; c: number; dv20: number; sector: string | null; atr: number }>();
  for (let k = 0; k < all.length; k += 300) {
    const { data } = await db().from("setup_series").select("ticker, r21, vol60, dv20, sector, c").in("ticker", all.slice(k, k + 300)).eq("end_date", asOf);
    for (const r of data ?? []) {
      const c = (r.c ?? []) as number[];
      let atr = 0;
      for (let j = c.length - 14; j < c.length; j++) atr += Math.abs(c[j] - c[j - 1]) / 14;
      stats.set(r.ticker, { r21: Number(r.r21), vol60: Number(r.vol60), c: c.at(-1) ?? 0, dv20: Number(r.dv20 ?? 0), sector: r.sector, atr });
    }
  }
  const rs = ctx.spy.c[D - 1] / ctx.spy.c[D - 22] - 1;
  const names = new Map(COVERAGE.map((c) => [c.ticker, c.shortName]));
  const out: Record<string, unknown>[] = [];
  for (const [sup, cus] of customersOf) {
    const me = stats.get(sup);
    if (!me) continue;
    let sum = 0, vol = 0, n = 0;
    for (const c of cus) {
      const s = stats.get(c);
      if (!s || !Number.isFinite(s.r21) || !(s.vol60 > 0)) continue;
      sum += s.r21 - rs;
      vol += s.vol60;
      n++;
    }
    if (!n) continue;
    const z = sum / n / ((vol / n) * Math.sqrt(21));
    const side = z >= 1 ? 1 : z <= -1 ? -1 : 0;
    const rt = roundTripCost(me.dv20);
    if (!side || rt == null) continue;
    const key = variantKey("custMom", side, 21);
    out.push({
      ticker: sup, variant: key, fired_at: asOf, first_seen: asOf, last_seen: asOf, name: names.get(sup) ?? sup, sector: me.sector, strategy: "custMom", side, horizon: 21,
      strength: round(Math.abs(z), 3), detail: `${STRATEGY.custMom.label}: ${n} linked customer${n === 1 ? "" : "s"} ${z >= 0 ? "up" : "down"} ${Math.abs(z).toFixed(1)} standard deviations vs the S&P 500 over 21 days`, price: round(me.c, 4), atr: round(me.atr, 4), dv20: Math.round(me.dv20), cost: round(tradeCost(rt, side, 21), 5),
    });
  }
  for (let k = 0; k < out.length; k += 500) await db().from("setup_signals").upsert(out.slice(k, k + 500) as never, { onConflict: "ticker,variant,fired_at", ignoreDuplicates: true });
  return out.length;
}

async function marketContext(asOf: string, ctx: EngineContext): Promise<MarketContext> {
  const D = ctx.dates.length;
  const rows = await selectAll((a, b) => db().from("setup_series").select("above200, near_high, short5").eq("end_date", asOf).range(a, b));
  const shorts = rows.map((r) => Number(r.short5)).filter((x) => x > 0).sort((a, b) => a - b);
  return {
    vix: round(ctx.vix[D - 1], 2),
    vix3m: round(ctx.vix3m[D - 1], 2),
    vixRatio: round(ctx.vixRatio[D - 1], 3),
    breadth200: rows.length ? round(rows.filter((r) => r.above200).length / rows.length, 4) : null,
    nearHighs: rows.length ? round(rows.filter((r) => r.near_high).length / rows.length, 4) : null,
    shortRatio: shorts.length ? round(shorts[Math.floor(shorts.length / 2)], 4) : null,
  };
}

// ---------------------------------------------------------------- bots

async function candidates(asOf: string, ctx: EngineContext): Promise<Candidate[]> {
  const D = ctx.dates.length;
  const { data: res } = await db().from("setup_results").select("payload").eq("as_of", asOf).maybeSingle();
  const variants = ((res?.payload as unknown as SetupsFile | null)?.variants ?? []) as VariantMeta[];
  const byKey = new Map(variants.map((v) => [v.key, v]));
  const today = ctx.regime[D - 1];
  const sigs = await selectAll((a, b) => db().from("setup_signals").select("ticker, variant, name, sector, strength, price, atr, cost").eq("fired_at", asOf).neq("variant", PAIR_KEY).range(a, b));
  return sigs.flatMap((s) => {
    const v = byKey.get(s.variant);
    if (!v || !(Number(s.price) > 0)) return [];
    const { strategy, side, horizon } = parseVariantKey(s.variant);
    const rg = v.regimes[today];
    const plan = riskPlan(v.family, side, Number(s.price), Number(s.atr ?? 0));
    return [{
      ticker: s.ticker, name: s.name ?? s.ticker, sector: s.sector ?? "", variant: s.variant, strategy, family: v.family, side, horizon,
      strength: Number(s.strength ?? 0), price: Number(s.price), atr: Number(s.atr ?? 0), cost: Number(s.cost ?? 0), stop: plan.stop, target: plan.target,
      edge: v.outSample.avgNet ?? 0, proven: v.passed, near: isNearMiss(v), regimeOk: !!rg && rg.n >= GATE.minRegimeN && (rg.avgNet ?? 0) > 0,
    } satisfies Candidate];
  });
}

async function runBot(asOf: string, bot: { id: string; rules: unknown; capital: number; last_as_of: string | null; started_on: string }, cand: Candidate[]) {
  const rules = parseRules(bot.rules);
  const { data: posRows } = await db().from("paper_bot_positions").select("*").eq("bot_id", bot.id).in("status", ["pending", "open"]);
  const positions = (posRows ?? []).map((p) => ({ ...p, side: p.side as 1 | -1 })) as unknown as Position[];
  const { data: closedAgg } = await db().from("paper_bot_equity").select("realized").eq("bot_id", bot.id).order("date", { ascending: false }).limit(1);
  const realized = Number(closedAgg?.[0]?.realized ?? 0);
  const earliest = [bot.last_as_of, ...positions.map((p) => p.entry_date ?? p.signal_date)].filter(Boolean).sort()[0] ?? asOf;
  const { data: spyRows } = await db().from("market_bars").select("date, open, high, low, close").eq("symbol", "SPY").gte("date", earliest).lte("date", asOf).order("date");
  const calendar = (spyRows ?? []).map((r) => r.date);
  if (!calendar.length || calendar[calendar.length - 1] !== asOf) throw new Error("no SPY bar for the session yet");
  const spy: Record<string, Ohlc> = Object.fromEntries((spyRows ?? []).map((r) => [r.date, { o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }]));
  const tickers = [...new Set(positions.map((p) => p.ticker))];
  const bars: Record<string, Record<string, Ohlc>> = {};
  if (tickers.length) {
    const rows = await selectAll((a, b) => db().from("market_bars").select("symbol, date, open, high, low, close").in("symbol", tickers).gte("date", earliest).lte("date", asOf).order("date").range(a, b));
    for (const r of rows) (bars[r.symbol] ??= {})[r.date] = { o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) };
  }
  const res = stepBot({ botId: bot.id, rules, capital: Number(bot.capital), calendar, from: bot.last_as_of, positions, realized, bars, spy, candidates: cand });
  const updates = res.positions.filter((p) => p.id);
  const inserts = res.positions.filter((p) => !p.id);
  if (updates.length) {
    const { error } = await db().from("paper_bot_positions").upsert(updates.map((p) => ({ ...p, updated_at: nowIso() })) as never);
    if (error) throw new Error(error.message);
  }
  if (inserts.length) {
    const { error } = await db().from("paper_bot_positions").upsert(inserts as never, { onConflict: "bot_id,ticker,variant,signal_date", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  if (res.equity.length) {
    const { error } = await db().from("paper_bot_equity").upsert(res.equity.map((e) => ({ ...e, bot_id: bot.id })) as never);
    if (error) throw new Error(error.message);
  }
  await db().from("paper_bots").update({ last_as_of: asOf, last_error: null }).eq("id", bot.id);
}

/** Exposed for tests: which phase follows which. */
export const PHASE_ORDER = ["bars", "context", "scan", "cross", "evaluate", "publish", "bots", "done"] as const;
