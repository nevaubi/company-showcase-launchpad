// Scheduled refresh jobs. Each invocation handles one small slice (the scheduler's
// HTTP call is short-lived and Workers allow six concurrent outbound requests),
// advancing a cursor in job_state so successive runs rotate through everything.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BENCHMARKS, COVERAGE, MACRO_SERIES, type CoverageCompany } from "@/lib/coverage";
import { form4XmlPath, parseForm4 } from "@/lib/financials/form4";
import { summarize } from "@/lib/macro";
import { fetchCboeDaily, fetchFred, fetchNasdaqDaily, fetchTreasury, fetchYahoo, isCboeIndex, isTreasurySeries, pool, toBars } from "@/lib/market-data.server";
import { archiveUrl, fetchSec } from "@/lib/sec.server";
import type { Json } from "@/integrations/supabase/types";
import { secAltRows, type SubmissionBlock } from "@/lib/alt/sec-forms";
import { insiderBuyRows } from "@/lib/signals/events";

export type JobName = "prices" | "macro" | "sec" | "filing-cache" | "ir-docs" | "ir-site" | "ir-extract" | "estimates" | "alt-data" | "setups" | "gov-data" | "options" | "short-volume";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function advance(job: JobName, total: number, step: number): Promise<{ start: number; wrapped: boolean }> {
  const { data } = await supabaseAdmin.from("job_state").select("cursor").eq("job", job).maybeSingle();
  const start = (data?.cursor ?? 0) % Math.max(1, total);
  const next = start + step;
  await supabaseAdmin.from("job_state").upsert({ job, cursor: next >= total ? 0 : next, updated_at: new Date().toISOString() });
  return { start, wrapped: next >= total };
}

const slice = <T,>(all: T[], start: number, n: number) => all.slice(start, start + n);

/**
 * The scheduler's HTTP call gives up after a few seconds and the platform cancels the handler with
 * it, so every job stops starting new work once this budget is spent and leaves the rest to the
 * next run.
 */
export const RUN_BUDGET_MS = 2000;
const budget = (ms = RUN_BUDGET_MS) => {
  const end = Date.now() + ms;
  return () => Date.now() < end;
};

export async function runJob(job: JobName): Promise<{ ok: boolean; items: number; detail: Record<string, unknown> }> {
  const { data: run } = await supabaseAdmin.from("job_runs").insert({ job }).select("id").single();
  let result: { ok: boolean; items: number; detail: Record<string, unknown> };
  try {
    result = await JOBS[job]();
  } catch (e) {
    result = { ok: false, items: 0, detail: { error: (e as Error).message } };
  }
  if (run) {
    await supabaseAdmin
      .from("job_runs")
      .update({ finished_at: new Date().toISOString(), ok: result.ok, items: result.items, detail: result.detail as Json })
      .eq("id", run.id);
  }
  return result;
}

const JOBS: Record<JobName, () => Promise<{ ok: boolean; items: number; detail: Record<string, unknown> }>> = {
  async "short-volume"() {
    const { refreshShortVolume } = await import("@/lib/jobs/short-volume.server");
    return refreshShortVolume();
  },
  /**
   * Nightly short-term setups: closing bars, full rescan, strategy re-tests, today's setups and the
   * paper autopilots, one small slice per call (several schedules call it in parallel after the close).
   */
  async setups() {
    const { runSetups } = await import("@/lib/jobs/setups.server");
    return runSetups(budget(1000));
  },
  /**
   * Alt data for every covered company: each run refreshes three (company, quick public source)
   * pairs in parallel, rotating through only the pairs whose source can know about the company
   * (registry names from `scripts/alt-registry.ts`). Slow sources (13D/13G history, federal
   * contracts) stay in `scripts/alt-data.ts`; 8-K/SEC form rows already refresh in the `sec` job.
   */
  async "alt-data"() {
    const { ADAPTERS, altFetch, altRowsForDb } = await import("@/lib/alt/collect.server");
    const { appliesTo, REGISTRY_PATH } = await import("@/lib/alt/registry");
    // NHTSA recall queries take ~6 s, longer than a scheduled call lives, so recalls refresh in the script.
    const sets = ["regulatory", "fda", "complaints", "bank", "attention", "consumer", "trials"];
    const { data: file } = await supabaseAdmin.storage.from("datasets").download(REGISTRY_PATH);
    const reg = (file ? JSON.parse(await file.text()) : {}) as Record<string, import("@/lib/alt/registry").AltRegistryEntry>;
    const pairs: [CoverageCompany, string][] = [];
    for (const c of COVERAGE) for (const s of sets) if (appliesTo(s, c, reg[c.ticker])) pairs.push([c, s]);
    const step = 3;
    const { start } = await advance("alt-data", pairs.length, step);
    altFetch.timeoutMs = RUN_BUDGET_MS - 300;
    altFetch.tries = 1;
    altFetch.recent = true;
    const picked = slice(pairs, start, step);
    const results = await Promise.all(
      picked.map(async ([c, set]) => {
        try {
          const rows = await ADAPTERS[set]({ ticker: c.ticker, name: c.shortName, cik: c.cik, sector: c.sector, industry: c.industry, reg: reg[c.ticker] });
          if (set === "complaints" && rows.length) {
            // keep the stored product breakdown the quick count leaves out
            const { data: old } = await supabaseAdmin.from("alt_data").select("uid, meta").in("uid", rows.map((r) => r.uid));
            const prev = new Map((old ?? []).map((o) => [o.uid, o.meta as Record<string, unknown> | null]));
            for (const r of rows) if (r.meta && r.meta.products === undefined) r.meta.products = prev.get(r.uid)?.products ?? [];
          }
          if (rows.length) {
            const { error } = await supabaseAdmin.from("alt_data").upsert(altRowsForDb(rows) as never, { onConflict: "uid" });
            if (error) throw new Error(error.message);
          }
          return { ticker: c.ticker, set, rows: rows.length };
        } catch (e) {
          return { ticker: c.ticker, set, rows: 0, error: (e as Error).message.slice(0, 160) };
        }
      }),
    );
    const items = results.reduce((n, r) => n + r.rows, 0);
    return { ok: results.some((r) => !r.error), items, detail: { pairs: pairs.length, at: start, results } };
  },
  /**
   * Government data published as whole-market files: the SEC fails-to-deliver file for the next
   * half-month after the last one stored (twice a month; `scripts/gov-data.ts --ftd` backfills
   * history). Upserts are idempotent, so a run cut short is simply repeated.
   */
  async "gov-data"() {
    const { ftdRows, ftdUrl, latestLikelyPeriod, nextPeriod, parseFtd, unzipText, periodCode, codePeriod } = await import("@/lib/alt/ftd");
    const { data: st } = await supabaseAdmin.from("job_state").select("cursor").eq("job", "gov-ftd").maybeSingle();
    const latest = latestLikelyPeriod(new Date());
    const last = st?.cursor ? codePeriod(st.cursor) : null;
    const next = last ? nextPeriod(last) : latest;
    if (periodCode(next) > periodCode(latest)) return { ok: true, items: 0, detail: { note: `up to date through ${last}` } };
    const r = await fetch(ftdUrl(next), { headers: { "User-Agent": "FiledUnder Research research@filedunder.ai" }, signal: AbortSignal.timeout(RUN_BUDGET_MS) });
    if (r.status === 404 || r.status === 403) return { ok: true, items: 0, detail: { note: `${next} not published yet` } };
    if (!r.ok) throw new Error(`fails-to-deliver ${next}: HTTP ${r.status}`);
    const text = await unzipText(new Uint8Array(await r.arrayBuffer()));
    const rows = ftdRows(parseFtd(text, next, new Set(COVERAGE.map((c) => c.ticker))));
    if (rows.length) {
      const { error } = await supabaseAdmin.from("alt_data").upsert(rows.map((x) => ({ ...x, meta: x.meta ?? {} })) as never, { onConflict: "uid" });
      if (error) throw new Error(error.message);
    }
    await supabaseAdmin.from("job_state").upsert({ job: "gov-ftd", cursor: periodCode(next), updated_at: new Date().toISOString() });
    return { ok: true, items: rows.length, detail: { period: next } };
  },
  /**
   * Nightly options snapshots from Cboe's delayed chains: four stocks per call, rotating through every
   * covered company (schedules run every minute through the US evening). Rows are keyed by the quotes'
   * own trading day, so a re-run the same night overwrites rather than duplicates; stocks without
   * listed options answer 403 and are skipped.
   */
  async options() {
    const { cboeChainUrl, snapshotRow, summarizeChain } = await import("@/lib/options/core");
    const tickers = COVERAGE.map((c) => c.ticker);
    const step = 4;
    const { start } = await advance("options", tickers.length, step);
    const picked = slice(tickers, start, step);
    const results = await Promise.all(
      picked.map(async (t) => {
        try {
          const r = await fetch(cboeChainUrl(t), { headers: { "User-Agent": "Mozilla/5.0 (compatible; FiledUnder/1.0)", Accept: "application/json" }, signal: AbortSignal.timeout(RUN_BUDGET_MS - 600) });
          if (r.status === 403 || r.status === 404) return { t, none: true as const };
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = (await r.json()) as { data?: import("@/lib/options/core").CboeChain };
          const snap = j.data ? summarizeChain(t, j.data) : null;
          return snap ? { t, row: snapshotRow(snap) } : { t, none: true as const };
        } catch (e) {
          return { t, error: (e as Error).message.slice(0, 120) };
        }
      }),
    );
    const rows = results.flatMap((r) => ("row" in r && r.row ? [r.row] : []));
    if (rows.length) {
      const { error } = await supabaseAdmin.from("options_daily").upsert(rows.map((r) => ({ ...r, term: r.term as unknown as Json, fetched_at: new Date().toISOString() })), { onConflict: "ticker,date" });
      if (error) throw new Error(error.message);
    }
    const failed = results.filter((r) => "error" in r);
    return { ok: failed.length < picked.length || picked.length === 0, items: rows.length, detail: { at: start, of: tickers.length, stored: rows.map((r) => r.ticker), none: results.filter((r) => "none" in r).map((r) => r.t), failed } };
  },
  /** Refresh stale estimates, then fill unused slots with covered companies not yet stored. */
  async estimates() {
    const left = budget();
    const { data: cooldown, error: cooldownError } = await supabaseAdmin.from("job_state").select("cursor").eq("job", "estimates-backoff").maybeSingle();
    if (cooldownError) throw new Error(cooldownError.message);
    if ((cooldown?.cursor ?? 0) > Date.now() / 1000) return { ok: true, items: 0, detail: { retryAt: new Date((cooldown?.cursor ?? 0) * 1000).toISOString() } };
    const { data: rows, error: staleError } = await supabaseAdmin.from("analyst_estimates").select("ticker, fetched_at").lt("fetched_at", new Date(Date.now() - 12 * 3600000).toISOString()).order("fetched_at", { ascending: true }).limit(3);
    if (staleError) throw new Error(staleError.message);
    const batch = (rows ?? []).map((r) => r.ticker);
    if (batch.length < 3 && left()) {
      const { data: cursor, error: cursorError } = await supabaseAdmin.from("job_state").select("cursor").eq("job", "estimates-new").maybeSingle();
      if (cursorError) throw new Error(cursorError.message);
      const start = (cursor?.cursor ?? 0) % COVERAGE.length;
      const candidates = Array.from({ length: Math.min(30, COVERAGE.length) }, (_, i) => COVERAGE[(start + i) % COVERAGE.length].ticker);
      const { data: existing, error } = await supabaseAdmin.from("analyst_estimates").select("ticker").in("ticker", candidates);
      if (error) throw new Error(error.message);
      const have = new Set((existing ?? []).map(r => r.ticker));
      batch.push(...candidates.filter(t => !have.has(t) && !batch.includes(t)).slice(0, 3 - batch.length));
      // Only advance through a candidate when attempted below. A timeout must not skip new coverage.
      if (!batch.some(t => candidates.includes(t) && !have.has(t))) {
        const { error: advanceError } = await supabaseAdmin.from("job_state").upsert({ job: "estimates-new", cursor: (start + candidates.length) % COVERAGE.length, updated_at: new Date().toISOString() });
        if (advanceError) throw new Error(advanceError.message);
      }
    }
    if (!batch.length) return { ok: true, items: 0, detail: { note: "no stale estimates or missing ticker in this scan" } };
    const { fetchEstimates } = await import("@/lib/estimates.server");
    const failed: string[] = [];
    let items = 0;
    for (const t of batch) {
      if (!left()) break;
      try {
        const fresh = await fetchEstimates(t, AbortSignal.timeout(1200));
        const { error } = await supabaseAdmin.from("analyst_estimates").upsert({ ticker: t, payload: fresh as never, fetched_at: fresh.asOf });
        if (error) throw new Error(error.message);
        items++;
        if (!(rows ?? []).some(r => r.ticker === t)) {
          const { error: cursorError } = await supabaseAdmin.from("job_state").upsert({ job: "estimates-new", cursor: (COVERAGE.findIndex(c => c.ticker === t) + 1) % COVERAGE.length, updated_at: new Date().toISOString() });
          if (cursorError) throw new Error(cursorError.message);
        }
      } catch (e) {
        failed.push(`${t}: ${(e as Error).message}`);
        // Serial requests plus a persistent 30-minute cooldown avoid hammering a throttled source.
        const { error } = await supabaseAdmin.from("job_state").upsert({ job: "estimates-backoff", cursor: Math.ceil(Date.now() / 1000) + 1800, paused_reason: failed[failed.length - 1].slice(0, 200), updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
        break;
      }
    }
    return { ok: failed.length === 0, items, detail: { tickers: batch, failed } };
  },

  /** Daily bars for ten symbols per run. */
  async prices() {
    const symbols = [...COVERAGE.map((c) => c.ticker), ...BENCHMARKS.map((b) => b.symbol)];
    const { start, wrapped } = await advance("prices", symbols.length, 10);
    const batch = slice(symbols, start, 10);
    const stocks = new Set(COVERAGE.map((c) => c.ticker));
    const results = await pool(batch, 3, async (symbol) => {
      // Yahoo first (dividend-adjusted closes); Nasdaq (stocks, ETFs) or Cboe (VIX) when Yahoo throttles.
      let bars;
      try {
        bars = toBars(await fetchYahoo(symbol, "1mo", "1d"), false);
      } catch (e) {
        const fallback = isCboeIndex(symbol)
          ? fetchCboeDaily(symbol)
          : symbol.startsWith("^")
            ? Promise.reject(new Error("no fallback for this index"))
            : fetchNasdaqDaily(symbol, stocks.has(symbol) ? "stocks" : "etf");
        bars = await fallback.catch((n: Error) => {
          throw new Error(`${(e as Error).message}; ${n.message}`);
        });
      }
      const rows = bars.map(([date, open, high, low, close, adj, volume]) => ({
        symbol,
        date,
        open,
        high,
        low,
        close,
        adj_close: adj,
        volume: Math.round(volume),
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("market_bars").upsert(rows);
      if (error) throw new Error(error.message);
      return rows.length;
    });
    if (wrapped) {
      await supabaseAdmin.from("market_bars").delete().lt("date", daysAgo(400));
      // Bounded 14-day retention for refresh-job runs. vendor-backfill rows are the collector's
      // lifetime credit/call ledger and are never pruned, so spending ceilings survive restarts.
      await supabaseAdmin.from("job_runs").delete().neq("job", "vendor-backfill").lt("started_at", new Date(Date.now() - 14 * 86400000).toISOString());
    }
    const failed = batch.flatMap((sym, i) => (results[i].status === "rejected" ? [`${sym}: ${String((results[i] as PromiseRejectedResult).reason?.message ?? results[i])}`] : []));
    const items = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
    return { ok: failed.length < batch.length, items, detail: { symbols: batch, failed } };
  },

  /** Four macro series per run: recent observations plus a fresh dashboard summary. */
  async macro() {
    const defs = MACRO_SERIES;
    const { start, wrapped } = await advance("macro", defs.length, 4);
    const batch = slice(defs, start, 4);
    const since = daysAgo(11 * 365);
    const results = await pool(batch, 4, async (def) => {
      const obs = isTreasurySeries(def.id) ? await fetchTreasury(def.id, since, 1) : await fetchFred(def.id, since);
      if (!obs.length) throw new Error("no observations");
      const cutoff = daysAgo(400);
      const recent = obs.filter(([d]) => d >= cutoff).map(([date, value]) => ({ series_id: def.id, date, value, updated_at: new Date().toISOString() }));
      if (recent.length) {
        const { error } = await supabaseAdmin.from("macro_observations").upsert(recent);
        if (error) throw new Error(error.message);
      }
      const summary = summarize(def, obs);
      const { error } = await supabaseAdmin
        .from("macro_summaries")
        .upsert({ series_id: def.id, summary: summary as unknown as Json, updated_at: summary.updatedAt });
      if (error) throw new Error(error.message);
      return recent.length;
    });
    if (wrapped) await supabaseAdmin.from("macro_observations").delete().lt("date", daysAgo(420));
    const failed = batch.flatMap((d, i) => (results[i].status === "rejected" ? [`${d.id}: ${String((results[i] as PromiseRejectedResult).reason?.message ?? "")}`] : []));
    const items = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
    return { ok: failed.length < batch.length, items, detail: { series: batch.map((d) => d.id), failed } };
  },

  /** New filings and Form 4 insider trades for four companies per run. */
  async sec() {
    const { start } = await advance("sec", COVERAGE.length, 2);
    const batch = slice(COVERAGE, start, 2);
    const since = daysAgo(45);
    let filings = 0;
    let trades = 0;
    const errors: string[] = [];
    for (const c of batch) {
      try {
        const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`)).json()) as {
          filings: { recent: Record<string, (string | number)[]> };
        };
        const r = sub.filings.recent;
        // Keep the alt-data hub current: 8-K items and capital-markets filings from the last 45 days.
        const alt = secAltRows(c.ticker, c.cik, r as unknown as SubmissionBlock).filter((x) => x.date >= since);
        if (alt.length) await supabaseAdmin.from("alt_data").upsert(alt as never, { onConflict: "uid" });
        const rows = (r.accessionNumber as string[])
          .map((accn, i) => ({
            accn,
            ticker: c.ticker,
            cik: c.cik,
            form: String(r.form[i]),
            filed: String(r.filingDate[i]),
            report: (r.reportDate[i] as string) || null,
            doc: String(r.primaryDocument[i]),
            description: (r.primaryDocDescription[i] as string) || null,
            items: (r.items[i] as string) || null,
            ixbrl: !!r.isInlineXBRL[i],
            size: Number(r.size[i]) || null,
          }))
          .filter((f) => f.filed >= since && !/^(424B|FWP|SC 13|S-3)/.test(f.form));
        if (!rows.length) continue;
        const { data: known } = await supabaseAdmin.from("sec_filings").select("accn").in("accn", rows.map((f) => f.accn));
        const have = new Set((known ?? []).map((k) => k.accn));
        const fresh = rows.filter((f) => !have.has(f.accn));
        if (fresh.length) {
          const { error } = await supabaseAdmin.from("sec_filings").upsert(fresh);
          if (error) throw new Error(error.message);
          filings += fresh.length;
          // Earnings announcement dates for the setups engine (8-K item 2.02).
          const earn = fresh.filter((f) => /^8-K/.test(f.form) && /(^|,)\s*2\.02/.test(f.items ?? "")).map((f) => ({ ticker: c.ticker, accn: f.accn, filed: f.filed, source: "sec-8k-2.02" }));
          if (earn.length) await supabaseAdmin.from("earnings_events").upsert(earn, { onConflict: "ticker,accn", ignoreDuplicates: true });
        }
        // Parse up to two new Form 4s per company per run; the rest are picked up on later passes.
        const { data: parsedAlready } = await supabaseAdmin.from("insider_trades").select("accn").eq("ticker", c.ticker).gte("filed", since);
        const done = new Set((parsedAlready ?? []).map((x) => x.accn));
        const candidates = rows.filter((x) => /^(4|4\/A)$/.test(x.form) && !done.has(x.accn));
        // Empty ownership filings need a durable receipt, not a fabricated zero-share trade.
        const { data: receipts, error: receiptError } = candidates.length
          ? await supabaseAdmin.from("job_state").select("job").in("job", candidates.map((f) => `form4-seen:${f.accn}`))
          : { data: [], error: null };
        if (receiptError) throw new Error(receiptError.message);
        const seen = new Set((receipts ?? []).map((x) => x.job));
        for (const f of candidates.filter((x) => !seen.has(`form4-seen:${x.accn}`)).slice(0, 2)) {
          try {
          const path = form4XmlPath(f.doc);
          const xml = await (await fetchSec(archiveUrl(c.cik, f.accn, path))).text();
          // Do not receipt a malformed response as an empty/derivative-only filing.
          if (!/<ownershipDocument\b/i.test(xml) || !/<\/ownershipDocument>/i.test(xml)) throw new Error("Invalid ownership XML");
          const parsed = parseForm4(xml, { accn: f.accn, filed: f.filed, report: f.report ?? undefined }, path);
          if (!parsed.length) {
            const { error } = await supabaseAdmin.from("job_state").upsert({ job: `form4-seen:${f.accn}`, cursor: 0, updated_at: new Date().toISOString() });
            if (error) throw new Error(error.message);
            continue;
          }
          const { error } = await supabaseAdmin.from("insider_trades").upsert(
            parsed.map((t, seq) => ({
              accn: t.accn,
              seq,
              ticker: c.ticker,
              filed: t.filed,
              owner: t.owner,
              role: t.role,
              trade_date: t.date,
              code: t.code,
              security: t.security,
              shares: t.shares,
              price: t.price,
              acquired: t.acquired,
              owned_after: t.ownedAfter,
              direct: t.direct,
              plan_10b5: t.plan10b5,
              doc: t.doc,
            })),
          );
          if (error) throw new Error(error.message);
          trades += parsed.length;
          // Open-market purchases by officers/directors feed the insider-cluster strategy.
          const buys = insiderBuyRows(c.ticker, parsed.map((t) => ({ ...t, date: t.date })), "sec-form4");
          if (buys.length) await supabaseAdmin.from("insider_buys").upsert(buys, { onConflict: "accn,owner", ignoreDuplicates: true });
          } catch (e) {
            errors.push(`${c.ticker} ${f.accn}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        errors.push(`${c.ticker}: ${(e as Error).message}`);
      }
    }
    return { ok: errors.length < batch.length, items: filings + trades, detail: { companies: batch.map((c) => c.ticker), filings, trades, errors } };
  },

  /** Store the exhibits of new earnings / Reg FD 8-Ks found by the SEC scan, a few files per run. */
  async "ir-docs"() {
    // Deep history (2008+) and IR-website files are collected by scripts/ir-backfill.ts and
    // scripts/ir-site.ts; this run only keeps up with new releases inside the call window.
    const { collectRecentRelease } = await import("@/lib/jobs/ir.server");
    const fresh = await collectRecentRelease(COVERAGE, budget());
    if (!fresh) return { ok: true, items: 0, detail: { idle: true } };
    return { ok: true, items: fresh.stored, detail: fresh as unknown as Record<string, unknown> };
  },

  /** Extract segment/KPI facts from the next stored press release. */
  async "ir-extract"() {
    const { extractIrDocument, nextToExtract } = await import("@/lib/ir/extract.server");
    const next = await nextToExtract();
    if (!next) return { ok: true, items: 0, detail: { idle: true } };
    try {
      const r = await extractIrDocument(next.id);
      return { ok: true, items: r.facts, detail: { ...next, ...r } };
    } catch (e) {
      const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
      await db.from("ir_documents").update({ extracted_at: new Date().toISOString(), extract_status: `error: ${(e as Error).message.slice(0, 200)}` }).eq("id", next.id);
      return { ok: false, items: 0, detail: { ...next, error: (e as Error).message } };
    }
  },

  /** Store files hosted on one company's IR website per run (found with Firecrawl). */
  async "ir-site"() {
    const { start } = await advance("ir-site", COVERAGE.length, 1);
    const { collectIr } = await import("@/lib/jobs/ir.server");
    const r = await collectIr(COVERAGE[start], "site", 25);
    return { ok: true, items: r.stored, detail: r as unknown as Record<string, unknown> };
  },

  /** Mirror one recent 10-K/10-Q primary document into file storage per run. */
  async "filing-cache"() {
    const { start } = await advance("filing-cache", COVERAGE.length * 2, 1);
    const c = COVERAGE[Math.floor(start / 2)];
    const form = start % 2 === 0 ? "10-K" : "10-Q";
    const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`)).json()) as {
      filings: { recent: { accessionNumber: string[]; form: string[]; primaryDocument: string[]; size: number[] } };
    };
    const r = sub.filings.recent;
    const i = r.form.findIndex((f) => f === form);
    if (i < 0) return { ok: true, items: 0, detail: { ticker: c.ticker, form, skipped: "no filing" } };
    const accn = r.accessionNumber[i];
    const doc = r.primaryDocument[i];
    // Big filings take longer than the scheduler waits; they're mirrored the first time someone opens them.
    if ((r.size?.[i] ?? 0) > 12 * 1024 * 1024) return { ok: true, items: 0, detail: { ticker: c.ticker, form, accn, doc, skipped: "large — mirrored on first view" } };
    const cached = await cacheFilingDocument(c.cik, accn, doc);
    return { ok: true, items: cached.stored ? 1 : 0, detail: { ticker: c.ticker, form, accn, doc, ...cached } };
  },
};

const BUCKET = "sec-filings";
const MAX_BYTES = 20 * 1024 * 1024;
const storagePath = (cik: string, accn: string, doc: string) => `${Number(cik)}/${accn}/${doc}.gz`;

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Store an SEC document (gzip) in file storage unless it's already there. */
export async function cacheFilingDocument(cik: string, accn: string, doc: string, text?: string, contentType = "text/html") {
  const { data: have } = await supabaseAdmin.from("filing_documents").select("bytes").eq("accn", accn).eq("doc", doc).maybeSingle();
  if (have) return { stored: false, bytes: have.bytes, reason: "already cached" };
  let body = text;
  if (body == null) {
    const res = await fetchSec(archiveUrl(cik, accn, doc));
    contentType = res.headers.get("content-type") ?? contentType;
    body = await res.text();
  }
  if (body.length > MAX_BYTES) return { stored: false, bytes: body.length, reason: "too large" };
  const gz = await gzip(body);
  const path = storagePath(cik, accn, doc);
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, gz, { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("filing_documents").upsert({ accn, doc, path, bytes: body.length, content_type: contentType });
  return { stored: true, bytes: body.length, compressed: gz.length };
}

/** Read a cached SEC document, or null when it isn't mirrored yet. */
export async function readCachedFiling(accn: string, doc: string): Promise<{ html: string; contentType: string } | null> {
  const { data: row } = await supabaseAdmin.from("filing_documents").select("path, content_type").eq("accn", accn).eq("doc", doc).maybeSingle();
  if (!row) return null;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(row.path);
  if (error || !data) return null;
  return { html: await gunzip(await data.arrayBuffer()), contentType: row.content_type };
}
