// Scheduled refresh jobs. Each invocation handles one small slice (the scheduler's
// HTTP call is short-lived and Workers allow six concurrent outbound requests). Rotating jobs read
// their cursor in job_state, do the slice, and move the cursor only after the slice was stored
// (slice.ts), so a run the scheduler cuts off repeats its slice instead of skipping it.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BENCHMARKS, companyCiks, COVERAGE, MACRO_SERIES, type CoverageCompany } from "@/lib/coverage";
import { summarize } from "@/lib/macro";
import { fetchCboeDaily, fetchFred, fetchNasdaqDaily, fetchTreasury, fetchYahoo, isCboeIndex, isTreasurySeries, pool, toBars } from "@/lib/market-data.server";
import { archiveUrl, fetchSec } from "@/lib/sec.server";
import type { Json } from "@/integrations/supabase/types";
import { secAltRows, type SubmissionBlock } from "@/lib/alt/sec-forms";
import { storeForm4 } from "@/lib/jobs/form4.server";
import { budgetCut, claimSlice, commitSlice, outcomeOf, runBudgetMs, sliceKey, unitTimeoutMs, type Claim, type SliceOutcome } from "@/lib/jobs/slice";
import { fairOrder, nextTailOffset } from "@/lib/jobs/priority";
import { loadJobRank } from "@/lib/jobs/priority.server";
import { backoffRow, blockStreak, chainStatus, judgeSlice, OPTIONS_BACKOFF_KEY, OPTIONS_PROBE, optionsNight, type ChainResult } from "@/lib/jobs/options-run";
import { backoffTicker, chargeFailure, estimateErrorClass, pickEstimates, scanCursorAfter, ESTIMATE_FAIL_PREFIX, ESTIMATE_NONE_PREFIX, ESTIMATE_SCAN, type FailReceipt } from "@/lib/jobs/estimates-order";
import { barProblem } from "@/lib/jobs/bar-check";
import { healRow, providerKey, tripRow, type CircuitRow } from "@/lib/jobs/provider-health";
import { isEarnings } from "@/lib/jobs/sec-discover";

export type JobName = "prices" | "macro" | "sec" | "filing-cache" | "ir-docs" | "estimates" | "alt-data" | "setups" | "gov-data" | "options" | "short-volume" | "sec-discover" | "partner-mirror" | "emails" | "abs-ee" | "call-archive";

/** job_state row: where the options tail rotation starts tonight (cursor = offset into the tail). */
const OPTIONS_TAIL_KEY = "options-tail";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const slice = <T,>(all: T[], start: number, n: number) => all.slice(start, start + n);

/**
 * The scheduler's HTTP call gives up after about 5 s and the platform cancels the handler with it,
 * so every job stops starting new work once this budget is spent and leaves the rest to the next
 * run; every unit also gets a deadline from the same budget. 3.5 s by default (the run plus its
 * database writes fits under the cut); JOB_RUN_BUDGET_MS raises it after the scheduler timeout is raised.
 */
export const RUN_BUDGET_MS = runBudgetMs(process.env);

export interface Budget {
  (): boolean;
  /** epoch ms when the budget ends */
  end: number;
  /** a per-unit abort signal: the time left in the run, at least 500 ms */
  signal(): AbortSignal;
}
export const budget = (ms = RUN_BUDGET_MS): Budget => {
  const end = Date.now() + ms;
  const f = (() => Date.now() < end) as Budget;
  f.end = end;
  f.signal = () => AbortSignal.timeout(unitTimeoutMs(end, Date.now()));
  return f;
};

type StateRow = { job: string; cursor: number | null; paused_reason: string | null; updated_at: string | null };

async function readStates(jobs: string[]): Promise<Map<string, StateRow>> {
  const { data, error } = await supabaseAdmin.from("job_state").select("job, cursor, paused_reason, updated_at").in("job", jobs);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as StateRow[]).map((r) => [r.job, r]));
}

/** Upsert cursor rows (same columns in every row, so pause reasons on those rows are kept). */
async function putCursors(rows: { job: string; cursor: number }[]) {
  if (!rows.length) return;
  const at = new Date().toISOString();
  const { error } = await supabaseAdmin.from("job_state").upsert(rows.map((r) => ({ job: r.job, cursor: r.cursor, updated_at: at })));
  if (error) throw new Error(error.message);
}

/** Read the cursor and record this attempt before any work (see slice.ts). */
async function claim(job: string, total: number, step: number, extra: string[] = []): Promise<{ c: Claim; st: Map<string, StateRow> }> {
  const st = await readStates([job, sliceKey(job), ...extra]);
  const c = claimSlice(st.get(job)?.cursor, st.get(sliceKey(job))?.cursor, total, step);
  await putCursors([{ job: sliceKey(job), cursor: c.triesCursor }, ...(c.cursorNow != null ? [{ job, cursor: c.cursorNow }] : [])]);
  return { c, st };
}

/** Move the cursor only for a stored slice; a failed or blocked slice is repeated next run. */
async function commit(job: string, c: Claim, outcome: SliceOutcome, total: number, step: number, advanceBy?: number) {
  const p = commitSlice(c, outcome, total, step, advanceBy);
  await putCursors([{ job: sliceKey(job), cursor: p.triesCursor }, ...(p.cursor != null ? [{ job, cursor: p.cursor }] : [])]);
  return p;
}

const sliceDetail = (c: Claim, outcome: SliceOutcome, total: number) => ({
  at: c.start,
  of: total,
  attempt: c.attempt,
  outcome,
  ...(c.skipped ? { skipped: `slice at ${c.skipped.start} skipped after ${c.skipped.tries} tries without a stored result` } : {}),
});

/** COVERAGE in priority order: top 1,000 by dv20 first with one tail company after every four, so the tail still rotates. */
async function rankedCoverage(offset = 0): Promise<CoverageCompany[]> {
  const rank = await loadJobRank();
  if (!rank.size) return COVERAGE;
  const by = new Map(COVERAGE.map((c) => [c.ticker, c]));
  return fairOrder(COVERAGE.map((c) => c.ticker), rank, { offset }).map((t) => by.get(t)!);
}

export async function runJob(job: JobName): Promise<{ ok: boolean; items: number; detail: Record<string, unknown> }> {
  const { data: run } = await supabaseAdmin.from("job_runs").insert({ job }).select("id").single();
  let result: { ok: boolean; items: number; detail: Record<string, unknown> };
  try {
    result = await JOBS[job]();
  } catch (e) {
    const message = (e as Error).message;
    // The run's own time budget ran out (nothing answered in time): it resumes next run, not a failure.
    result = budgetCut(message) ? { ok: true, items: 0, detail: { outcome: "cut", note: message } } : { ok: false, items: 0, detail: { error: message } };
  }
  if (run) {
    await supabaseAdmin
      .from("job_runs")
      .update({ finished_at: new Date().toISOString(), ok: result.ok, items: result.items, detail: result.detail as Json })
      .eq("id", run.id);
  }
  return result;
}

type JobResult = { ok: boolean; items: number; detail: Record<string, unknown> };

const JOBS: Record<JobName, () => Promise<JobResult>> = {
  async "call-archive"() {
    const { scheduledCallArchive } = await import("@/lib/transcripts/issuer-jobs.server");
    return scheduledCallArchive();
  },
  /** Dead-man watchdog first (bounded), then the email outbox with the time that is left. */
  async emails() {
    const started = Date.now();
    let watchdog: Record<string, unknown> = { skipped: "WATCHDOG=0" };
    if (process.env["WATCHDOG"] !== "0") {
      const { alertIfDatabaseDown, runWatchdog } = await import("@/lib/jobs/watchdog.server");
      watchdog = await runWatchdog(1500).catch(async (e: Error) => ({ error: e.message.slice(0, 200), ...(await alertIfDatabaseDown(e).catch((x: Error) => ({ direct: `check failed: ${x.message.slice(0, 120)}` }))) }));
    }
    const { runOutbox } = await import("@/lib/email/outbox.server");
    const out = await runOutbox(Math.max(1000, RUN_BUDGET_MS - (Date.now() - started)));
    return { ...out, detail: { ...out.detail, watchdog } };
  },
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
   * (registry names from `scripts/alt-registry.ts`), top 1,000 companies first. Slow sources (13D/13G
   * history, federal contracts) stay in `scripts/alt-data.ts`; 8-K/SEC form rows refresh in the `sec` job.
   */
  async "alt-data"() {
    const left = budget();
    const { ADAPTERS, altFetch, altRowsForDb } = await import("@/lib/alt/collect.server");
    const { appliesTo, REGISTRY_PATH } = await import("@/lib/alt/registry");
    // NHTSA recall queries take ~6 s, longer than a scheduled call lives, so recalls refresh in the script.
    const sets = ["regulatory", "fda", "complaints", "bank", "attention", "consumer", "trials"];
    const { data: file } = await supabaseAdmin.storage.from("datasets").download(REGISTRY_PATH);
    const reg = (file ? JSON.parse(await file.text()) : {}) as Record<string, import("@/lib/alt/registry").AltRegistryEntry>;
    const pairs: [CoverageCompany, string][] = [];
    for (const c of await rankedCoverage()) for (const s of sets) if (appliesTo(s, c, reg[c.ticker])) pairs.push([c, s]);
    const step = 3;
    const { c: cl } = await claim("alt-data", pairs.length, step);
    altFetch.timeoutMs = Math.max(500, left.end - Date.now() - 300);
    altFetch.tries = 1;
    altFetch.recent = true;
    const picked = slice(pairs, cl.start, step);
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
    const failed = results.filter((r) => r.error).length;
    const outcome = outcomeOf(picked.length, failed);
    await commit("alt-data", cl, outcome, pairs.length, step);
    const items = results.reduce((n, r) => n + r.rows, 0);
    return { ok: outcome === "done", items, detail: { pairs: pairs.length, ...sliceDetail(cl, outcome, pairs.length), results } };
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
   * Nightly options snapshots from Cboe's delayed chains: four stocks per call, top 1,000 by dv20
   * first (the list restarts at the top each night, so a short night still covers the biggest names).
   * Rows are keyed by the quotes' own trading day, so a re-run the same night overwrites rather than
   * duplicates. A refusal (429, or 403s that SPY confirms) is not "no options": the slice is held,
   * the job backs off (`options-backoff`), `provider:cboe` records the block and the run is not ok.
   */
  async options() {
    const { cboeChainUrl, snapshotRow, summarizeChain } = await import("@/lib/options/core");
    const left = budget();
    const now = Date.now();
    const night = optionsNight(now);
    const st0 = await readStates([OPTIONS_BACKOFF_KEY, providerKey("cboe"), "options-night", "options", OPTIONS_TAIL_KEY]);
    const backoff = st0.get(OPTIONS_BACKOFF_KEY);
    if ((backoff?.cursor ?? 0) > now / 1000) return { ok: true, items: 0, detail: { idle: true, retryAt: new Date((backoff?.cursor ?? 0) * 1000).toISOString(), reason: backoff?.paused_reason } };
    const step = 4;
    // The tail rotation resumes where last night's pass ended (review R4); before the first night
    // with this row it starts at the night number, as it did.
    let tailOffset = st0.get(OPTIONS_TAIL_KEY)?.cursor ?? night;
    if ((st0.get("options-night")?.cursor ?? 0) !== night) {
      // A new night starts at the top of the ranked list; the tail goes on after the names last night reached.
      const rank = await loadJobRank();
      if (rank.size) tailOffset = nextTailOffset(COVERAGE.map((c) => c.ticker), rank, tailOffset, Number(st0.get("options")?.cursor ?? 0));
      await putCursors([{ job: "options", cursor: 0 }, { job: sliceKey("options"), cursor: 0 }, { job: "options-night", cursor: night }, { job: OPTIONS_TAIL_KEY, cursor: tailOffset }]);
    }
    const tickers = (await rankedCoverage(tailOffset)).map((c) => c.ticker);
    const { c: cl } = await claim("options", tickers.length, step);
    const picked = slice(tickers, cl.start, step);
    const headers = { "User-Agent": "Mozilla/5.0 (compatible; FiledUnder/1.0)", Accept: "application/json" };
    const results: ChainResult[] = await Promise.all(
      picked.map(async (t): Promise<ChainResult> => {
        try {
          const r = await fetch(cboeChainUrl(t), { headers, signal: AbortSignal.timeout(unitTimeoutMs(left.end - 600, Date.now())) });
          const kind = chainStatus(r.status);
          if (kind !== "read") {
            r.body?.cancel().catch(() => undefined);
            if (kind === "error") return { t, kind: "error", message: `HTTP ${r.status}` };
            return { t, kind, status: r.status };
          }
          const j = (await r.json()) as { data?: import("@/lib/options/core").CboeChain };
          const snap = j.data ? summarizeChain(t, j.data) : null;
          return snap ? { t, kind: "stored", row: snapshotRow(snap) } : { t, kind: "none", status: r.status };
        } catch (e) {
          return { t, kind: "error", message: (e as Error).message.slice(0, 120) };
        }
      }),
    );
    let verdict = judgeSlice(results);
    let probe: number | undefined;
    if (verdict.needsProbe) {
      probe = await fetch(cboeChainUrl(OPTIONS_PROBE), { headers, signal: AbortSignal.timeout(unitTimeoutMs(left.end - 300, Date.now())) })
        .then((r) => (r.body?.cancel().catch(() => undefined), r.status))
        .catch(() => 0);
      verdict = judgeSlice(results, probe);
    }
    const rows = verdict.results.flatMap((r) => (r.kind === "stored" ? [r.row as ReturnType<typeof snapshotRow>] : []));
    if (rows.length) {
      const { error } = await supabaseAdmin.from("options_daily").upsert(rows.map((r) => ({ ...r, term: r.term as unknown as Json, fetched_at: new Date().toISOString() })), { onConflict: "ticker,date" });
      if (error) throw new Error(error.message);
    }
    await commit("options", cl, verdict.outcome, tickers.length, step);
    const cboe = st0.get(providerKey("cboe")) as CircuitRow | undefined;
    let retryAt: string | undefined;
    if (verdict.outcome === "blocked") {
      const statuses = verdict.results.flatMap((r) => (r.kind === "blocked" ? [r.status] : []));
      const b = backoffRow(blockStreak(backoff?.paused_reason) + 1, statuses, Date.now());
      retryAt = new Date(b.cursor * 1000).toISOString();
      const trip = tripRow("cboe", "rate", b.paused_reason.replace(/^blocked: /, "").replace(/\s\[n=\d+\]$/, ""), cboe ?? null, Date.now());
      // Same columns in both rows; the circuit's retry time follows the job's own backoff.
      const { error } = await supabaseAdmin.from("job_state").upsert([
        { job: b.job, cursor: b.cursor, paused_reason: b.paused_reason, updated_at: b.updated_at },
        { job: trip.job, cursor: b.cursor, paused_reason: trip.paused_reason, updated_at: trip.updated_at ?? b.updated_at },
      ]);
      if (error) throw new Error(error.message);
    } else if (verdict.stored > 0 && (backoff?.paused_reason || cboe?.paused_reason)) {
      // Cboe answered again: clear the backoff and close the circuit.
      const heal = healRow("cboe", Date.now());
      const at = heal.updated_at ?? new Date().toISOString();
      const { error } = await supabaseAdmin.from("job_state").upsert([
        { job: OPTIONS_BACKOFF_KEY, cursor: 0, paused_reason: null, updated_at: at },
        { job: heal.job, cursor: 0, paused_reason: null, updated_at: at },
      ]);
      if (error) throw new Error(error.message);
    }
    const of = (k: ChainResult["kind"]) => verdict.results.filter((r) => r.kind === k);
    return {
      ok: verdict.outcome === "done",
      items: rows.length,
      detail: {
        ...sliceDetail(cl, verdict.outcome, tickers.length),
        night,
        tailOffset,
        stored: rows.map((r) => r.ticker),
        none: of("none").map((r) => `${r.t}${"status" in r ? ` ${r.status}` : ""}`),
        blocked: of("blocked").map((r) => `${r.t}${"status" in r ? ` ${r.status}` : ""}`),
        failed: of("error").map((r) => `${r.t}: ${"message" in r ? r.message : ""}`),
        ...(probe !== undefined ? { probe: `${OPTIONS_PROBE} ${probe}` } : {}),
        ...(retryAt ? { retryAt } : {}),
      },
    };
  },
  /**
   * Analyst estimates, three a run: covered companies with no stored estimates first (top 1,000 by
   * dv20 first), then the stalest stored rows; one slot always goes to a row older than a week, so
   * stored estimates cannot age without bound while new coverage fills. "No estimates" answers get a
   * 30-day receipt so they do not take a slot every run.
   */
  async estimates() {
    const left = budget();
    const { data: cooldown, error: cooldownError } = await supabaseAdmin.from("job_state").select("cursor, paused_reason").eq("job", "estimates-backoff").maybeSingle();
    if (cooldownError) throw new Error(cooldownError.message);
    if ((cooldown?.cursor ?? 0) > Date.now() / 1000) return { ok: true, items: 0, detail: { retryAt: new Date((cooldown?.cursor ?? 0) * 1000).toISOString(), reason: cooldown?.paused_reason ?? null } };
    const ranked = (await rankedCoverage()).map((c) => c.ticker);
    const { data: cursor, error: cursorError } = await supabaseAdmin.from("job_state").select("cursor").eq("job", "estimates-new").maybeSingle();
    if (cursorError) throw new Error(cursorError.message);
    const start = (cursor?.cursor ?? 0) % ranked.length;
    const candidates = Array.from({ length: Math.min(ESTIMATE_SCAN, ranked.length) }, (_, i) => ranked[(start + i) % ranked.length]);
    const [{ data: existing, error }, { data: stale, error: staleError }] = await Promise.all([
      supabaseAdmin.from("analyst_estimates").select("ticker").in("ticker", candidates),
      // More than the three slots: rows held by a failure receipt are dropped below.
      supabaseAdmin.from("analyst_estimates").select("ticker, fetched_at").lt("fetched_at", new Date(Date.now() - 12 * 3600000).toISOString()).order("fetched_at", { ascending: true }).limit(12),
    ]);
    if (error) throw new Error(error.message);
    if (staleError) throw new Error(staleError.message);
    const looked = [...new Set([...candidates, ...(stale ?? []).map((r) => r.ticker)])];
    const { data: receipts, error: receiptError } = await supabaseAdmin
      .from("job_state")
      .select("job, cursor, updated_at")
      .in("job", [...candidates.map((t) => `${ESTIMATE_NONE_PREFIX}${t}`), ...looked.map((t) => `${ESTIMATE_FAIL_PREFIX}${t}`)]);
    if (receiptError) throw new Error(receiptError.message);
    const none = new Map<string, string | null>();
    const failedBefore = new Map<string, FailReceipt>();
    for (const r of receipts ?? []) {
      if (r.job.startsWith(ESTIMATE_NONE_PREFIX)) none.set(r.job.slice(ESTIMATE_NONE_PREFIX.length), r.updated_at);
      else failedBefore.set(r.job.slice(ESTIMATE_FAIL_PREFIX.length), { tries: Number(r.cursor ?? 0), at: r.updated_at });
    }
    const plan = pickEstimates({
      candidates,
      start,
      total: ranked.length,
      have: new Set((existing ?? []).map((r) => r.ticker)),
      none,
      stale: (stale ?? []).map((r) => ({ ticker: r.ticker, fetchedAt: r.fetched_at })),
      failed: failedBefore,
      deferred: backoffTicker(cooldown?.paused_reason),
      nowMs: Date.now(),
    });
    // Nothing missing in the scanned window: move the scan on so the next run looks further.
    if (plan.scanCursor != null) await putCursors([{ job: "estimates-new", cursor: plan.scanCursor }]);
    if (!plan.batch.length) return { ok: true, items: 0, detail: { note: "no stale estimates or missing ticker in this scan", scannedFrom: start } };
    const { fetchEstimates } = await import("@/lib/estimates.server");
    const failed: string[] = [];
    const noneNow: string[] = [];
    const skipped: string[] = [];
    const gaveUp: string[] = [];
    const attempted = new Set<string>();
    let answered = 0;
    let items = 0;
    let lastCursor: number | null = null;
    const moveScan = async () => {
      const c = scanCursorAfter(plan.batch, attempted);
      if (c != null && c !== lastCursor) await putCursors([{ job: "estimates-new", cursor: c }]);
      lastCursor = c;
    };
    for (const p of plan.batch) {
      if (!left()) break;
      let fresh: Awaited<ReturnType<typeof fetchEstimates>> | null = null;
      let err: unknown = null;
      try {
        fresh = await fetchEstimates(p.ticker, AbortSignal.timeout(Math.min(1200, unitTimeoutMs(left.end, Date.now()))));
      } catch (e) {
        err = e;
      }
      if (fresh) {
        // A database error is the run's failure, never the ticker's (it throws out of the job).
        const { error } = await supabaseAdmin.from("analyst_estimates").upsert({ ticker: p.ticker, payload: fresh as never, fetched_at: fresh.asOf });
        if (error) throw new Error(error.message);
        if (failedBefore.has(p.ticker)) {
          const { error: delError } = await supabaseAdmin.from("job_state").delete().eq("job", `${ESTIMATE_FAIL_PREFIX}${p.ticker}`);
          if (delError) throw new Error(delError.message);
        }
        items++;
        answered++;
      } else {
        const msg = ((err as Error | null)?.message ?? String(err)).slice(0, 160);
        let cls = estimateErrorClass(err);
        // The provider answered other tickers in this run: a "provider" failure on this one is about this one.
        if (cls === "provider" && answered > 0) cls = "ticker";
        if (cls === "none") {
          // The provider has no coverage for this company: a receipt, not a provider failure.
          noneNow.push(p.ticker);
          answered++;
          const { error } = await supabaseAdmin.from("job_state").upsert({ job: `${ESTIMATE_NONE_PREFIX}${p.ticker}`, cursor: Math.floor(Date.now() / 1000), updated_at: new Date().toISOString() });
          if (error) throw new Error(error.message);
        } else if (cls === "ticker") {
          // One bad symbol: charge it (bounded tries, then a 7-day rest) and go on with the rest.
          const ch = chargeFailure(p.ticker, failedBefore.get(p.ticker), msg, Date.now());
          (ch.gaveUp ? gaveUp : skipped).push(`${p.ticker}: ${ch.row.paused_reason}`);
          const { error } = await supabaseAdmin.from("job_state").upsert(ch.row);
          if (error) throw new Error(error.message);
        } else {
          failed.push(`${p.ticker}: ${msg}`);
          // Serial requests plus a persistent 30-minute cooldown avoid hammering a throttled source.
          // The reason names the ticker: it is fetched last next time (see pickEstimates).
          const { error } = await supabaseAdmin.from("job_state").upsert({ job: "estimates-backoff", cursor: Math.ceil(Date.now() / 1000) + 1800, paused_reason: failed[failed.length - 1].slice(0, 200), updated_at: new Date().toISOString() });
          if (error) throw new Error(error.message);
          break;
        }
      }
      // A missing ticker was attempted: the scan moves past it, never past one not yet tried.
      if (p.kind === "missing") {
        attempted.add(p.ticker);
        await moveScan();
      }
    }
    const ok = failed.length === 0 && (answered > 0 || (skipped.length === 0 && gaveUp.length === 0));
    return { ok, items, detail: { tickers: plan.batch.map((p) => `${p.ticker} (${p.kind})`), none: noneNow, failed, skipped, gaveUp } };
  },

  /** Daily bars for ten symbols per run (top 1,000 first, then the tail and the benchmarks). */
  async prices() {
    const left = budget();
    const symbols = [...(await rankedCoverage()).map((c) => c.ticker), ...BENCHMARKS.map((b) => b.symbol)];
    const step = 10;
    const { c: cl } = await claim("prices", symbols.length, step);
    const batch = slice(symbols, cl.start, step);
    const stocks = new Set(COVERAGE.map((c) => c.ticker));
    const flagged: string[] = [];
    let started = 0;
    const results = await pool(batch, 3, async (symbol) => {
      // Out of budget: leave this symbol (and the rest of the slice) for the next run.
      if (!left()) return null;
      started++;
      // Yahoo first (dividend-adjusted closes); Nasdaq (stocks, ETFs) or Cboe (VIX) when Yahoo throttles.
      let bars;
      try {
        bars = toBars(await fetchYahoo(symbol, "1mo", "1d", left.signal()), false);
      } catch (e) {
        const fallback = isCboeIndex(symbol)
          ? fetchCboeDaily(symbol, 31, left.signal())
          : symbol.startsWith("^")
            ? Promise.reject(new Error("no fallback for this index"))
            : fetchNasdaqDaily(symbol, stocks.has(symbol) ? "stocks" : "etf", 31, left.signal());
        bars = await fallback.catch((n: Error) => {
          throw new Error(`${(e as Error).message}; ${n.message}`);
        });
      }
      // A bar whose open or close lies outside its high-low range is not stored (the next run's
      // fetch replaces it); it is reported in the run detail, never repaired by guesswork.
      const good = bars.filter(([date, open, high, low, close]) => {
        const p = barProblem({ open, high, low, close });
        if (p) flagged.push(`${symbol} ${date}: ${p}`);
        return !p;
      });
      const rows = good.map(([date, open, high, low, close, adj, volume]) => ({
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
      if (rows.length) {
        const { error } = await supabaseAdmin.from("market_bars").upsert(rows);
        if (error) throw new Error(error.message);
      }
      return rows.length;
    });
    const failed = batch.flatMap((sym, i) => (results[i].status === "rejected" ? [`${sym}: ${String((results[i] as PromiseRejectedResult).reason?.message ?? results[i])}`] : []));
    // pool starts symbols in order, so the unstarted ones are the end of the slice
    const outcome: SliceOutcome = started === 0 ? "failed" : outcomeOf(started, failed.length);
    const p = await commit("prices", cl, outcome, symbols.length, step, started);
    if (p.wrapped) {
      await supabaseAdmin.from("market_bars").delete().lt("date", daysAgo(400));
      // Bounded 14-day retention for refresh-job runs. vendor-backfill rows are the collector's
      // lifetime credit/call ledger and are never pruned, so spending ceilings survive restarts.
      await supabaseAdmin.from("job_runs").delete().neq("job", "vendor-backfill").lt("started_at", new Date(Date.now() - 14 * 86400000).toISOString());
    }
    const items = results.reduce((n, r) => n + (r.status === "fulfilled" ? (r.value ?? 0) : 0), 0);
    return { ok: outcome === "done", items, detail: { ...sliceDetail(cl, outcome, symbols.length), symbols: batch.slice(0, started), notStarted: batch.slice(started), failed, ...(flagged.length ? { flagged } : {}) } };
  },

  /** Four macro series per run: recent observations plus a fresh dashboard summary. */
  async macro() {
    const left = budget();
    const defs = MACRO_SERIES;
    const step = 4;
    const { c: cl } = await claim("macro", defs.length, step);
    const batch = slice(defs, cl.start, step);
    const since = daysAgo(11 * 365);
    const results = await pool(batch, 4, async (def) => {
      const signal = left.signal();
      const obs = isTreasurySeries(def.id) ? await fetchTreasury(def.id, since, 1, signal) : await fetchFred(def.id, since, signal);
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
    const failed = batch.flatMap((d, i) => (results[i].status === "rejected" ? [`${d.id}: ${String((results[i] as PromiseRejectedResult).reason?.message ?? "")}`] : []));
    const outcome = outcomeOf(batch.length, failed.length);
    const p = await commit("macro", cl, outcome, defs.length, step);
    if (p.wrapped) await supabaseAdmin.from("macro_observations").delete().lt("date", daysAgo(420));
    const items = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
    return { ok: outcome === "done", items, detail: { ...sliceDetail(cl, outcome, defs.length), series: batch.map((d) => d.id), failed } };
  },

  /**
   * New filings and Form 4 insider trades for four companies per run (two at a time, top 1,000
   * first). Latency for new filings comes from `sec-discover`; this walk fills Form 4 detail and alt
   * rows everywhere. The cursor moves past the companies that were synced, not the whole slice.
   */
  async sec() {
    const left = budget();
    const ranked = await rankedCoverage();
    const step = 4;
    const { c: cl } = await claim("sec", ranked.length, step);
    const batch = slice(ranked, cl.start, step);
    const since = daysAgo(45);
    let filings = 0;
    let trades = 0;
    const errors: string[] = [];
    const done: string[] = [];
    let broken = 0;
    let next = 0;
    // Batch position of the first company the run's budget cut short: the cursor stops there.
    let firstCut = Infinity;
    const cut: string[] = [];
    await Promise.all([0, 1].map(async () => {
      while (next < batch.length && left()) {
        const i = next++;
        const c = batch[i];
        const r = await syncCompany(c, since, { form4: true, deadline: left.end });
        filings += r.filings; trades += r.trades; errors.push(...r.errors);
        if (r.cut) {
          cut.push(r.cut);
          firstCut = Math.min(firstCut, i);
        } else done.push(c.ticker);
        if (r.failed) broken++;
      }
    }));
    // `next` companies were started (in order) and all of them finished; a budget cut is not a failure,
    // and the cursor stops at the first company that was cut. With nothing finished: a run that had no
    // budget left to start anything is cut (no try charged); a run whose first company outran a whole
    // budget is charged a try as before, so a company that can never be read in time is passed over
    // after three runs instead of holding every company behind it.
    const advance = Math.min(next, firstCut);
    const outcome: SliceOutcome = advance === 0 ? (next === 0 && !left() ? "cut" : "failed") : outcomeOf(advance, broken);
    await commit("sec", cl, outcome, ranked.length, step, advance);
    // A lost earnings-event write always fails the run, so the failure shows in job health.
    const earningsLost = errors.some((e) => e.includes(" earnings events: "));
    return { ok: (outcome === "done" || outcome === "cut") && !earningsLost && errors.length < Math.max(1, done.length), items: filings + trades, detail: { ...sliceDetail(cl, outcome, ranked.length), companies: done, notStarted: batch.slice(next).map((c) => c.ticker), filings, trades, errors, ...(cut.length ? { cut } : {}) } };
  },

  /** Refresh the local copy of partner company/price files and universe.json, one file per call. */
  async "partner-mirror"() {
    const { runPartnerMirror } = await import("@/lib/jobs/partner-mirror.server");
    return runPartnerMirror(RUN_BUDGET_MS - 200);
  },

  /** Market-wide new-filing discovery (EDGAR current feed + daily master index) for every covered company. */
  async "sec-discover"() {
    const { runDiscovery } = await import("@/lib/jobs/sec-discover.server");
    const left = budget();
    return runDiscovery(left, left.end);
  },
  /** ABS-EE asset files: one waiting filing stored, or one watched CIK listed (src/lib/jobs/abs-ee.server.ts). */
  async "abs-ee"() {
    const { refreshAbsEe } = await import("@/lib/jobs/abs-ee.server");
    return refreshAbsEe(budget().end);
  },

  /** Store the exhibits of new earnings / Reg FD 8-Ks found by the SEC scan, a few files per run. */
  async "ir-docs"() {
    // Deep history (2008+) and IR-website files are collected by scripts/ir-backfill.ts and
    // scripts/ir-site-daily.ts (worker); this run only keeps up with new releases inside the call window.
    const { collectRecentRelease } = await import("@/lib/jobs/ir.server");
    const fresh = await collectRecentRelease(COVERAGE, budget());
    if (!fresh) return { ok: true, items: 0, detail: { idle: true } };
    return { ok: true, items: fresh.stored, detail: fresh as unknown as Record<string, unknown> };
  },

  /** Mirror one recent 10-K/10-Q primary document into file storage per run. */
  async "filing-cache"() {
    const left = budget();
    const total = COVERAGE.length * 2;
    const { c: cl } = await claim("filing-cache", total, 1);
    const c = COVERAGE[Math.floor(cl.start / 2)];
    const form = cl.start % 2 === 0 ? "10-K" : "10-Q";
    let detail: Record<string, unknown>;
    let items = 0;
    try {
      // The newest filing of the form across every CIK of the company (a new registrant's index
      // may not list the last annual report its predecessor filed), cached under the CIK listing it.
      let pick: { cik: string; accn: string; doc: string; size: number; filed: string } | null = null;
      for (const cik of companyCiks(c)) {
        const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { deadline: left.end })).json()) as {
          filings: { recent: { accessionNumber: string[]; form: string[]; primaryDocument: string[]; size: number[]; filingDate: string[] } };
        };
        const r = sub.filings.recent;
        const i = r.form.findIndex((f) => f === form);
        if (i >= 0 && (!pick || (r.filingDate?.[i] ?? "") > pick.filed)) pick = { cik, accn: r.accessionNumber[i], doc: r.primaryDocument[i], size: r.size?.[i] ?? 0, filed: r.filingDate?.[i] ?? "" };
      }
      if (!pick) detail = { ticker: c.ticker, form, skipped: "no filing" };
      else {
        const { accn, doc } = pick;
        // Big filings take longer than the scheduler waits; they're mirrored the first time someone opens them.
        if (pick.size > 12 * 1024 * 1024) detail = { ticker: c.ticker, form, accn, doc, skipped: "large, mirrored on first view" };
        else {
          const cached = await cacheFilingDocument(pick.cik, accn, doc, undefined, "text/html", left.end);
          items = cached.stored ? 1 : 0;
          detail = { ticker: c.ticker, form, accn, doc, ...cached };
        }
      }
    } catch (e) {
      // Hold the slot: the next run retries this company and form (skipped after three tries).
      await commit("filing-cache", cl, "failed", total, 1);
      return { ok: false, items: 0, detail: { ...sliceDetail(cl, "failed", total), ticker: c.ticker, form, error: (e as Error).message } };
    }
    await commit("filing-cache", cl, "done", total, 1);
    return { ok: true, items, detail: { ...sliceDetail(cl, "done", total), ...detail } };
  },
};



/**
 * One company's recent submissions: upserts every recent filing (fills rows discovery found with
 * full details), earnings 8-K (item 2.02) events and alt rows; optionally parses two new Form 4s.
 */
export async function syncCompany(
  c: CoverageCompany,
  since: string,
  opts: { form4: boolean; deadline?: number },
): Promise<{ filings: number; trades: number; errors: string[]; failed: boolean; cut: string | null }> {
  // `cut`: the run's time budget ran out inside this company (it is read again next run, not failed).
  const out = { filings: 0, trades: 0, errors: [] as string[], failed: false, cut: null as string | null };
  const sec = { deadline: opts.deadline };
  try {
    // Every CIK of the company (current registrant first, then former ones, e.g. XOM 2115436 and
    // 34088): each filing keeps the CIK whose index lists it, so its archive URLs resolve.
    const all: { accn: string; ticker: string; cik: string; form: string; filed: string; report: string | null; doc: string; description: string | null; items: string | null; ixbrl: boolean; size: number | null }[] = [];
    const listed = new Set<string>();
    for (const cik of companyCiks(c)) {
      const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, sec)).json()) as {
        filings: { recent: Record<string, (string | number)[]> };
      };
      const r = sub.filings.recent;
      // Keep the alt-data hub current: 8-K items and capital-markets filings from the last 45 days.
      // (A filing an earlier CIK's index also lists keeps the current registrant's link: uid `kind:T:accn…`.)
      const alt = secAltRows(c.ticker, cik, r as unknown as SubmissionBlock).filter((x) => x.date >= since && !listed.has(x.uid.split(":")[2]));
      if (alt.length) await supabaseAdmin.from("alt_data").upsert(alt as never, { onConflict: "uid" });
      for (const [i, accn] of (r.accessionNumber as string[]).entries()) {
        if (listed.has(accn)) continue;
        listed.add(accn);
        all.push({
          accn,
          ticker: c.ticker,
          cik,
          form: String(r.form[i]),
          filed: String(r.filingDate[i]),
          report: (r.reportDate[i] as string) || null,
          doc: String(r.primaryDocument[i]),
          description: (r.primaryDocDescription[i] as string) || null,
          items: (r.items[i] as string) || null,
          ixbrl: !!r.isInlineXBRL[i],
          size: Number(r.size[i]) || null,
        });
      }
    }
    const rows = all.filter((f) => f.filed >= since && !/^(424B|FWP|SC 13|S-3)/.test(f.form));
    if (!rows.length) return out;
    const { data: known, error: knownError } = await supabaseAdmin.from("sec_filings").select("accn").in("accn", rows.map((f) => f.accn));
    if (knownError) throw new Error(knownError.message);
    const have = new Set((known ?? []).map((k) => k.accn));
    const fresh = rows.filter((f) => !have.has(f.accn));
    if (fresh.length) {
      const { error } = await supabaseAdmin.from("sec_filings").upsert(fresh);
      if (error) throw new Error(error.message);
      out.filings += fresh.length;
    }
    // Earnings announcement dates for the setups engine (8-K item 2.02). Every 2.02 filing in the
    // window is asserted, not only new ones, so an event write that failed once is repaired on the
    // company's next pass (insert-only, idempotent). A failed write is reported, never ignored.
    const earn = rows.filter((f) => isEarnings(f.form, f.items)).map((f) => ({ ticker: c.ticker, accn: f.accn, filed: f.filed, source: "sec-8k-2.02" }));
    if (earn.length) {
      const { error } = await supabaseAdmin.from("earnings_events").upsert(earn, { onConflict: "ticker,accn", ignoreDuplicates: true });
      if (error) out.errors.push(`${c.ticker} earnings events: ${error.message}`);
    }
    if (!opts.form4) return out;
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
    // Everything past these two (same-day bursts, filings discovered late) is read by the worker's
    // Form 4 repair pass (src/lib/jobs/form4.server.ts `repairForm4`).
    for (const f of candidates.filter((x) => !seen.has(`form4-seen:${x.accn}`)).slice(0, 2)) {
      try {
        const r = await storeForm4(supabaseAdmin, { accn: f.accn, ticker: c.ticker, cik: f.cik, filed: f.filed, report: f.report, doc: f.doc }, sec);
        out.trades += r.trades;
      } catch (e) {
        if (budgetCut((e as Error).message)) out.cut ??= `${c.ticker} ${f.accn}: ${(e as Error).message}`;
        else out.errors.push(`${c.ticker} ${f.accn}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    if (budgetCut((e as Error).message)) out.cut = `${c.ticker}: ${(e as Error).message}`;
    else {
      out.errors.push(`${c.ticker}: ${(e as Error).message}`);
      out.failed = true;
    }
  }
  return out;
}

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
export async function cacheFilingDocument(cik: string, accn: string, doc: string, text?: string, contentType = "text/html", deadline?: number) {
  const { data: have } = await supabaseAdmin.from("filing_documents").select("bytes").eq("accn", accn).eq("doc", doc).maybeSingle();
  if (have) return { stored: false, bytes: have.bytes, reason: "already cached" };
  let body = text;
  if (body == null) {
    const res = await fetchSec(archiveUrl(cik, accn, doc), { deadline });
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
