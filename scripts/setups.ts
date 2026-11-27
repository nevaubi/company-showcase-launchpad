// Short-term setup engine, full history. Runs every strategy in src/lib/signals/strategies.ts over the
// whole universe with the shared one-ticker scan (src/lib/signals/scan.ts), adds earnings (SEC 8-K
// 2.02), insider purchases (Form 4), FINRA short-sale volume, VIX term structure and supplier-customer
// links, evaluates every variant out of sample after costs and writes:
//   - public/data/setups.json (bundled fallback)
//   - Cloud tables the daily setups job maintains from then on (samples, series, signals, stats, results)
//   - datasets/setups/bench.json (calendar + benchmarks the job extends each day)
// Usage: bun scripts/setups.ts [--cache=/tmp/px] [--no-db]
import { pageSupplyLinks } from "../src/lib/supply/read";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Json } from "../src/integrations/supabase/types";
import { sb, args, log, selectAll, dbGate } from "./lib/supa";
import type { Bar } from "../src/lib/financials/types";
import { fetchYahoo, toBars } from "../src/lib/market-data.server";
import { align, rollStd, type Aligned } from "../src/lib/signals/features";
import { evaluate, GATE, OOS_START, Samples } from "../src/lib/signals/backtest";
import { formPairs, PAIRS, spreadZ, tradePairs, type PairLeg } from "../src/lib/signals/pairs";
import { customerZ, LIVE_BARS, scanTicker, type Firing } from "../src/lib/signals/scan";
import { benchFromBars, BENCH_SYMBOLS, contextFromBench, parseCboeCsv, VIX3M_URL } from "../src/lib/signals/context";
import { parseShortVolume, FINRA_SHORT_URL } from "../src/lib/signals/finra";
import { ftdUrl, latestLikelyPeriod, nextPeriod, parseFtd, periodEnd, unzipText } from "../src/lib/alt/ftd";
import type { TickerEvents } from "../src/lib/signals/events";
import { mergeOfficialBars, type OfficialRow } from "../src/lib/jobs/setups-bars";
import { EXECUTION_VERSION, pickSetups, variantKey, variantMeta, type LiveFiring, type MarketContext, type PairSetup, type SetupsFile } from "../src/lib/signals/setups";

const CACHE = String(args.cache ?? "/tmp/px");
const DB = args["no-db"] !== "true";
const sf = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

async function bucketJson<T>(path: string): Promise<T | null> {
  const local = `${CACHE}/${path}`;
  if (existsSync(local)) return JSON.parse(await readFile(local, "utf8")) as T;
  const r = await sb.storage.from("datasets").download(path);
  if (!r.data) {
    if (r.error && !/not found|does not exist/i.test(r.error.message)) throw new Error(`${path}: ${r.error.message}`);
    return null;
  }
  const t = await r.data.text();
  await mkdir(local.slice(0, local.lastIndexOf("/")), { recursive: true });
  await writeFile(local, t);
  return JSON.parse(t) as T;
}

async function benchBars(sym: string): Promise<Bar[]> {
  const cached = `${CACHE}/bm/${sf(sym)}.json`;
  try {
    const bars = toBars(await fetchYahoo(sym, "10y", "1d"), false).filter((b) => b[0] >= "2015-01-01");
    await mkdir(`${CACHE}/bm`, { recursive: true });
    await writeFile(cached, JSON.stringify({ bars }));
    return bars;
  } catch (e) {
    log("yahoo failed", sym, (e as Error).message, "- using cached copy");
    const f = existsSync(cached) ? cached : `public/data/prices/${sf(sym)}.json`;
    return (JSON.parse(await readFile(f, "utf8")) as { bars: Bar[] }).bars;
  }
}

const universe = (await bucketJson<{ companies: { ticker: string; name: string; sector?: string }[] }>("universe.json"))!.companies;
log("universe", universe.length);

// ---- prices
const priceFiles = new Map<string, Bar[]>();
let loaded = 0;
await Promise.all(Array.from({ length: 16 }, async (_, w) => {
  for (let k = w; k < universe.length; k += 16) {
    const p = await bucketJson<{ bars: Bar[] }>(`prices/${sf(universe[k].ticker)}.json`);
    if (p?.bars?.length) priceFiles.set(universe[k].ticker, p.bars);
    if (++loaded % 400 === 0) log("prices", loaded);
  }
}));
// The official daily bars win over the partner file for every date both hold; a partner bar newer
// than every official bar (possibly a mid-session snapshot) is dropped (src/lib/jobs/setups-bars.ts).
{
  const officialFrom = new Date(Date.now() - 70 * 86400_000).toISOString().slice(0, 10);
  const rows = await selectAll<OfficialRow & { symbol: string }>((a, b) =>
    sb.from("market_bars").select("symbol, date, open, high, low, close, adj_close, volume").gte("date", officialFrom).order("symbol").order("date").range(a, b));
  const bySymbol = new Map<string, OfficialRow[]>();
  for (const r of rows) (bySymbol.get(r.symbol) ?? bySymbol.set(r.symbol, []).get(r.symbol)!).push(r);
  const provisional: string[] = [];
  let corrected = 0;
  for (const [t, bars] of priceFiles) {
    const m = mergeOfficialBars(bars, bySymbol.get(t) ?? [], officialFrom, "9999-12-31");
    if (m.provisional) provisional.push(`${t} ${m.provisional}`);
    if (m.corrected.length) corrected++;
    priceFiles.set(t, m.bars);
  }
  log("official bars", rows.length, "rows;", corrected, "files corrected;", provisional.length, "provisional bars skipped", provisional.slice(0, 10).join(", "));
}
// End the calendar on the last day most stocks have a bar.
const lastCount = new Map<string, number>();
for (const bars of priceFiles.values()) for (const b of bars.slice(-15)) lastCount.set(b[0].slice(0, 10), (lastCount.get(b[0].slice(0, 10)) ?? 0) + 1);
const endDate = [...lastCount.entries()].filter(([, n]) => n >= priceFiles.size * 0.5).map(([d]) => d).sort().at(-1)!;

// ---- calendar, benchmarks, VIX term structure
const bm: Record<string, Bar[]> = {};
for (const s of BENCH_SYMBOLS) bm[s] = await benchBars(s);
const v3resp = await fetch(VIX3M_URL, { headers: { "user-agent": "Mozilla/5.0" } });
if (!v3resp.ok) throw new Error(`VIX3M history returned HTTP ${v3resp.status}`);
const v3text = await v3resp.text();
const vix3m = parseCboeCsv(v3text);
if (!vix3m.size) throw new Error("VIX3M history is empty");
const bench = benchFromBars(bm, vix3m, endDate);
if (bench.dates.at(-1) !== endDate) throw new Error(`SPY history ends ${bench.dates.at(-1)}, expected ${endDate}`);
const ctx = contextFromBench(bench);
const { dates } = ctx;
const D = dates.length;
log("calendar", dates[0], "to", endDate, D, "bars;", priceFiles.size, "price files; VIX3M days", vix3m.size);

// ---- events
const events = new Map<string, TickerEvents>();
const ev = (t: string) => events.get(t) ?? (events.set(t, { earnings: [], buys: [], short: [] }), events.get(t)!);
const earn = await selectAll<{ ticker: string; filed: string }>((a, b) => sb.from("earnings_events").select("ticker, filed").order("ticker").order("accn").range(a, b));
const finraPublications = await selectAll<{trade_date: string; available_on: string}>((a, b) => sb.from('setup_finra_publications')
  .select('trade_date,available_on').lte('available_on', endDate).order('trade_date').range(a,b));
const finraAvailable = new Map(finraPublications.map(p => [p.trade_date, p.available_on]));
for (const e of earn) ev(e.ticker).earnings.push(e.filed);
const buys = await selectAll<{ ticker: string; filed: string; owner: string; value: number | null; plan_10b5: boolean }>((a, b) =>
  sb.from("insider_buys").select("ticker, filed, owner, value, plan_10b5").order("accn").order("owner").range(a, b));
for (const x of buys) ev(x.ticker).buys.push({ filed: x.filed, owner: x.owner, value: x.value ?? 0, plan: x.plan_10b5 });
log("earnings events", earn.length, "insider buys", buys.length);
// FINRA short volume: daily files cached locally (faster than reading millions of rows back).
const keep = new Set(universe.map((u) => u.ticker));
await mkdir(`${CACHE}/finra`, { recursive: true });
const fdays = dates.filter((d) => d >= "2018-08-01");
let fdone = 0;
const fq = [...fdays];
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let d = fq.shift(); d; d = fq.shift()) {
    const local = `${CACHE}/finra/${d}.txt`;
    let text = existsSync(local) ? await readFile(local, "utf8") : null;
    if (!text) {
      const res = await fetch(FINRA_SHORT_URL(d), { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok && res.status !== 404) throw new Error(`FINRA ${d}: HTTP ${res.status}`);
      text = res.ok ? await res.text() : "";
      if (text) await writeFile(local, text);
    }
    for (const r of parseShortVolume(text, keep)) ev(r.symbol).short.push({ date: r.date, ratio: r.short_vol / r.total_vol, availableOn: finraAvailable.get(r.date) });
    if (++fdone % 500 === 0) log("finra days", fdone);
  }
}));

// SEC fails-to-deliver half-month files since 2018 (cached locally like FINRA; the job reads the
// same readings from alt_data). Each reading is used only after its publication lag (events.ts).
await mkdir(`${CACHE}/ftd`, { recursive: true });
const ftdPeriods: string[] = [];
for (let p = "201801a", last = latestLikelyPeriod(new Date()); p <= last; p = nextPeriod(p)) ftdPeriods.push(p);
const ftdQ = [...ftdPeriods];
let ftdDone = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let p = ftdQ.shift(); p; p = ftdQ.shift()) {
    const local = `${CACHE}/ftd/${p}.txt`;
    let text = existsSync(local) ? await readFile(local, "latin1") : null;
    if (!text) {
      const res = await fetch(ftdUrl(p), { headers: { "user-agent": "FiledUnder Research research@filedunder.ai" } });
      if (!res.ok && res.status !== 404) throw new Error(`SEC fails file ${p}: HTTP ${res.status}`);
      text = res.ok ? await unzipText(new Uint8Array(await res.arrayBuffer())) : "";
      if (text) await writeFile(local, text, "latin1");
    }
    for (const a of parseFtd(text, p, keep)) {
      const e = ev(a.ticker);
      (e.fails ??= []).push({ end: periodEnd(p), value: a.value / a.days });
    }
    ftdDone++;
  }
}));
log("fails-to-deliver files", ftdDone, "of", ftdPeriods.length);

// ---- pass 1: aligned closes for customer momentum and pairs
const A = new Map<string, Aligned>();
const vol = new Map<string, Float64Array>();
for (const u of universe) {
  const bars = priceFiles.get(u.ticker);
  if (!bars) continue;
  const a = align(dates, bars);
  if (a.start < 0) continue;
  A.set(u.ticker, a);
  const r1 = new Float64Array(D);
  for (let i = a.start + 1; i < D; i++) r1[i] = a.c[i] / a.c[i - 1] - 1;
  vol.set(u.ticker, rollStd(r1, 60, a.start + 1));
}
// Supplier ← customer links, valid from the filing that first states them.
const links = await pageSupplyLinks<{ ticker: string; counterparty_ticker: string | null; relation: string; filed: string | null }>(sb, "ticker, counterparty_ticker, relation, filed", (q) =>
  q.in("relation", ["customer", "supplier"]).not("counterparty_ticker", "is", null).order("id"));
const customersOf = new Map<string, Map<string, string>>();
for (const l of links) {
  const [sup, cus] = l.relation === "customer" ? [l.ticker, l.counterparty_ticker!] : [l.counterparty_ticker!, l.ticker];
  if (!l.filed || sup === cus || !A.has(sup) || !A.has(cus)) continue;
  const m = customersOf.get(sup) ?? new Map<string, string>();
  if (!m.has(cus) || l.filed < m.get(cus)!) m.set(cus, l.filed);
  customersOf.set(sup, m);
}
const idxOf = (d: string) => {
  let lo = 0, hi = D;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (dates[m] < d) lo = m + 1;
    else hi = m;
  }
  return lo;
};
log("suppliers with linked customers", customersOf.size);

// ---- pass 2: scan
const samples = new Map<string, Samples>();
const sample = (k: string) => samples.get(k) ?? (samples.set(k, new Samples()), samples.get(k)!);
const replayed = new Set<string>();
const sampleRows: { ticker: string; variant: string; d: string; net: number; ex: number; gross: number }[] = [];
const live: (LiveFiring & { firing: Firing })[] = [];
const legsBySector = new Map<string, (PairLeg & { volume: Float64Array })[]>();
const meta = new Map(universe.map((u) => [u.ticker, u]));
const seriesRows: Record<string, unknown>[] = [];
let scanned = 0, above = 0, highs = 0;
const shortNow: number[] = [];
for (const u of universe) {
  const bars = priceFiles.get(u.ticker);
  if (!bars || !A.has(u.ticker)) continue;
  const cm = customersOf.get(u.ticker);
  const cust = cm
    ? customerZ(D, ctx.spy, [...cm.entries()].map(([t, filed]) => ({ from: idxOf(filed), c: A.get(t)!.c, vol60: vol.get(t)! })))
    : undefined;
  const out = scanTicker(ctx, { ticker: u.ticker, sector: u.sector ?? "", bars, events: events.get(u.ticker), cust });
  if (!out) continue;
  scanned++;
  replayed.add(u.ticker);
  const { f, a } = out;
  for (const s of out.samples) {
    sample(s.variant).push(s.i, s.net, s.ex, s.gross);
    sampleRows.push({ ticker: u.ticker, variant: s.variant, d: dates[s.i], net: +s.net.toFixed(6), ex: +s.ex.toFixed(6), gross: +s.gross.toFixed(6) });
  }
  const last = D - 1;
  for (const F of out.firings.filter((x) => x.i >= D - LIVE_BARS && a.v[last] > 0)) {
    live.push({
      ticker: u.ticker, name: u.name, sector: u.sector ?? "", variant: F.variant, firedAt: dates[F.i], strength: F.strength, detail: F.detail,
      price: a.c[last], atr: f.atr14[last], spark: Array.from(a.c.slice(D - 60)).map((x) => +x.toFixed(2)), firing: F,
    });
  }
  const isAbove = a.c[last] > f.sma200[last], isHigh = a.c[last] >= 0.98 * f.max252[last];
  if (isAbove) above++;
  if (isHigh) highs++;
  const s5 = f.ev?.shortRatio5[last];
  if (s5 != null && Number.isFinite(s5)) shortNow.push(s5);
  const from = Math.max(a.start, D - 300);
  seriesRows.push({
    ticker: u.ticker, sector: u.sector ?? null, start_date: dates[from], end_date: bars.at(-1)![0].slice(0, 10),
    o: Array.from(a.o.slice(from)).map((x) => +x.toFixed(4)), c: Array.from(a.c.slice(from)).map((x) => +x.toFixed(4)),
    dv20: Math.round(f.dv20[last]) || null, r5: +(a.c[last] / a.c[last - 5] - 1).toFixed(5), r21: +(a.c[last] / a.c[last - 21] - 1).toFixed(5),
    vol60: Number.isFinite(f.vol60[last]) ? +f.vol60[last].toFixed(5) : null, above200: isAbove, near_high: isHigh,
    short5: s5 != null && Number.isFinite(s5) ? +s5.toFixed(4) : null, updated_at: new Date().toISOString(),
  });
  if (u.sector) {
    const legs = legsBySector.get(u.sector) ?? (legsBySector.set(u.sector, []), legsBySector.get(u.sector)!);
    legs.push({ ticker: u.ticker, o: a.o, c: a.c, start: a.start, dv20: f.dv20, volume: a.v });
  }
  if (scanned % 300 === 0) log("scanned", scanned);
}
log("scanned", scanned, "companies;", live.length, "live firings;", sampleRows.length, "samples");

// ---- pairs
const pairKey = variantKey("pairs", 1, 20);
const livePairs: PairSetup[] = [];
for (const [sector, legs] of legsBySector) {
  replayed.add(`pair:${sector}`);
  const before = sample(pairKey).i.length;
  for (let F = PAIRS.window; F < D - 2; F += PAIRS.step) tradePairs(legs, formPairs(legs, F), F, D, sample(pairKey));
  const s = sample(pairKey);
  for (let k = before; k < s.i.length; k++) sampleRows.push({ ticker: `pair:${sector}`, variant: pairKey, d: dates[s.i[k]], net: +s.net[k].toFixed(6), ex: +s.exSpy[k].toFixed(6), gross: +s.gross[k].toFixed(6) });
  for (const p of formPairs(legs, D - 1)) {
    const z = spreadZ(legs, p, D - 1);
    if (Math.abs(z) < PAIRS.entryZ) continue;
    const L = legs[p.a], R = legs[p.b];
    if (!(L.volume[D - 1] > 0 && R.volume[D - 1] > 0)) continue;
    livePairs.push({
      a: L.ticker, b: R.ticker, nameA: meta.get(L.ticker)?.name ?? L.ticker, nameB: meta.get(R.ticker)?.name ?? R.ticker, sector,
      z: +z.toFixed(2), beta: +p.beta.toFixed(3), halfLife: +p.hl.toFixed(1), rho: +p.rho.toFixed(3), adf: +p.adf.toFixed(2), side: z < 0 ? 1 : -1,
      zs: Array.from({ length: 120 }, (_, k) => +spreadZ(legs, p, D - 120 + k).toFixed(2)),
      priceA: +L.c[D - 1].toFixed(2), priceB: +R.c[D - 1].toFixed(2),
    });
  }
  log("pairs", sector, s.i.length - before);
}

// ---- evaluate & publish
const keys = [...samples.keys()].sort();
const variants = evaluate(keys.map((key) => ({ key, samples: samples.get(key)! })), dates, ctx.regime).map((p) => variantMeta(p));
const today = ctx.regime[D - 1];
const setups = pickSetups(variants, live, today);
const median = (x: number[]) => (x.length ? [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)] : null);
const market: MarketContext = {
  vix: Number.isFinite(ctx.vix[D - 1]) ? +ctx.vix[D - 1].toFixed(2) : null,
  vix3m: Number.isFinite(ctx.vix3m[D - 1]) ? +ctx.vix3m[D - 1].toFixed(2) : null,
  vixRatio: Number.isFinite(ctx.vixRatio[D - 1]) ? +ctx.vixRatio[D - 1].toFixed(3) : null,
  breadth200: scanned ? +(above / scanned).toFixed(4) : null,
  nearHighs: scanned ? +(highs / scanned).toFixed(4) : null,
  shortRatio: median(shortNow),
};
const out: SetupsFile = {
  executionVersion: EXECUTION_VERSION, generatedAt: new Date().toISOString(), asOf: endDate, companies: scanned, regime: today, oosStart: OOS_START, gate: GATE,
  variants, setups, pairsProven: !!variants.find((v) => v.key === pairKey)?.passed, pairs: livePairs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 40),
  market, source: "full",
};
await writeFile("public/data/setups.json", JSON.stringify(out));
log("regime", today, "| setups", setups.length, "| pairs", out.pairs.length, "of", livePairs.length, "| market", JSON.stringify(market));
for (const v of variants)
  log(v.passed ? "PASS" : "fail", v.key.padEnd(20), `oos n=${v.outSample.n} net=${((v.outSample.avgNet ?? 0) * 100).toFixed(2)}% t=${v.outSample.t} dsr=${v.dsr} is=${((v.inSample.avgNet ?? 0) * 100).toFixed(2)}%`, v.failed.join("; "));

if (DB) {
  // Calendar + benchmarks for the daily job.
  const { error: be } = await sb.storage.from("datasets").upload("setups/bench.json", new Blob([JSON.stringify(bench)], { type: "application/json" }), { upsert: true });
  if (be) throw new Error(be.message);
  // A failed call leaves the previous window intact. A ticker without replayable history is untouched.
  const byTicker = new Map<string, typeof sampleRows>();
  for (const row of sampleRows) {
    const rows = byTicker.get(row.ticker) ?? [];
    rows.push(row);
    byTicker.set(row.ticker, rows);
  }
  const pending = [...replayed];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let ticker = pending.pop(); ticker; ticker = pending.pop()) {
      await dbGate("setups");
      const rows = byTicker.get(ticker) ?? [];
      // Most company replays fit in one request. Bound the exceptional sector-level pair payloads by year.
      const windows: [string, string][] = [];
      if (rows.length <= 5000) windows.push([dates[0], endDate]);
      else {
        for (let year = Number(dates[0].slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
          windows.push([`${year}-01-01`, `${year}-12-31` < endDate ? `${year}-12-31` : endDate]);
        }
      }
      for (const [from, to] of windows) {
        await sb.rpc("replace_setup_sample_slice_v2", {
          p_tickers: [ticker], p_from: from, p_to: to, p_full: true,
          p_rows: rows.filter((r) => r.d >= from && r.d <= to) as Json,
        }).throwOnError();
      }
    }
  }));
  for (let k = 0; k < seriesRows.length; k += 200) {
    const { error } = await sb.from("setup_series").upsert(seriesRows.slice(k, k + 200));
    if (error) throw new Error(error.message);
  }
  const sig = live.map((L) => ({
    // first_seen = the real run date, so a full-history run never counts as a live catch (the live record needs first_seen = fired_at).
    ticker: L.ticker, variant: L.variant, fired_at: L.firedAt, first_seen: new Date().toISOString().slice(0, 10), last_seen: endDate, name: L.name, sector: L.sector,
    strategy: L.firing.strategy, side: L.firing.side, horizon: L.firing.horizon, strength: +L.strength.toFixed(3), detail: L.detail,
    price: +L.price.toFixed(4), atr: +L.atr.toFixed(4), dv20: null, cost: +L.firing.cost.toFixed(5), spark: L.spark,
  }));
  for (let k = 0; k < sig.length; k += 500) {
    const { error } = await sb.from("setup_signals").upsert(sig.slice(k, k + 500), { onConflict: "ticker,variant,fired_at", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { error: ve } = await sb.from("setup_variant_stats").upsert(variants.map((v) => ({ variant: v.key, as_of: endDate, stats: { ...v, executionVersion: EXECUTION_VERSION } as never, updated_at: new Date().toISOString() })));
  if (ve) throw new Error(ve.message);
  const { error: re } = await sb.from("setup_results").upsert({ as_of: endDate, generated_at: out.generatedAt, payload: out as never });
  if (re) throw new Error(re.message);
  // Recorded as finished: autopilots only step on the nightly job's sessions.
  await sb.from("setup_cycles").upsert({ as_of: endDate, phase: "done", cursor: 0, finished_at: new Date().toISOString(), detail: { source: "full" } as never, updated_at: new Date().toISOString() });
  // Queue every ticker for the nightly scan (only new tickers are inserted; existing rows keep their progress).
  const scanRows = universe.map((u) => ({ ticker: u.ticker, sector: u.sector ?? null }));
  for (let k = 0; k < scanRows.length; k += 500) await sb.from("setup_scan").upsert(scanRows.slice(k, k + 500), { onConflict: "ticker", ignoreDuplicates: true });
  log("database updated for", endDate);
}
