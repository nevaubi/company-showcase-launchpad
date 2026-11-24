// Snapshot every covered stock's Cboe option chain into options_daily right now (the scheduled
// `options` job does the same four stocks at a time through the US evening).
//
// Cboe answers bursts with 429, so requests are paced (--gap ms between starts) and a 429 waits.
//
//   bun scripts/options-snapshot.ts [--tickers=AAPL,HOOD] [--workers=1] [--gap=2900]  (Cboe allows about 20 requests a minute)
//
// --night [--minutes=50]: the worker loop's side job. Takes tonight's snapshot only when the app's
// scheduled `options` job cannot (Cboe refuses the app server), resumes from `options-worker` in
// job_state, skips names already stored tonight and records its own pause when Cboe refuses the
// worker too. Every decision is in src/lib/jobs/options-worker.ts.
import { COVERAGE } from "@/lib/coverage";
import { cboeChainUrl, snapshotRow, summarizeChain, type CboeChain } from "@/lib/options/core";
import { chainStatus, judgeSlice, OPTIONS_BACKOFF_KEY, OPTIONS_PROBE, type ChainResult } from "@/lib/jobs/options-run";
import { nightStartMs, parseWorker, toFetch, workerBlocked, WORKER_CHUNK, WORKER_GAP_MS, WORKER_KEY, workerPlan, workerProgress } from "@/lib/jobs/options-worker";
import { fairOrder } from "@/lib/jobs/priority";
import type { StateRow } from "@/lib/jobs/watchdog";
import { loadRank } from "./lib/rank";
import { args, dbGate, log, sb, sleep } from "./lib/supa";

if (args.night) {
  await night();
  process.exit(0);
}

const tickers = args.tickers ? String(args.tickers).split(",").map((t) => t.trim().toUpperCase()) : COVERAGE.map((c) => c.ticker);
const workers = Number(args.workers ?? 1);
const gap = Number(args.gap ?? 2900);
let lastStart = 0;
async function pace() {
  for (;;) {
    const wait = lastStart + gap - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  lastStart = Date.now();
}
let next = 0;
let stored = 0;
let none = 0;
const failed: string[] = [];

async function one(t: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await pace();
      const r = await fetch(cboeChainUrl(t), { headers: { "User-Agent": "Mozilla/5.0 (compatible; FiledUnder/1.0)", Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (r.status === 403 || r.status === 404) return void none++;
      if (r.status === 429) {
        log(`${t}: Cboe rate limit, waiting ${30 * (attempt + 1)} s`);
        await sleep(30000 * (attempt + 1));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { data?: CboeChain };
      const snap = j.data ? summarizeChain(t, j.data) : null;
      if (!snap) return void none++;
      await dbGate("options");
      const { error } = await sb.from("options_daily").upsert({ ...snapshotRow(snap), fetched_at: new Date().toISOString() }, { onConflict: "ticker,date" });
      if (error) throw new Error(error.message);
      stored++;
      return;
    } catch (e) {
      if (attempt === 4) return void failed.push(`${t}: ${(e as Error).message.slice(0, 80)}`);
      await sleep(1500 * (attempt + 1));
    }
  }
  failed.push(`${t}: still rate limited`);
}

await Promise.all(
  Array.from({ length: workers }, async () => {
    while (next < tickers.length) {
      const t = tickers[next++];
      await one(t);
      const done = stored + none + failed.length;
      if (done % 100 === 0) log(`${done}/${tickers.length} · ${stored} stored · ${none} without options · ${failed.length} failed`);
    }
  }),
);
log(`DONE ${stored} stored · ${none} without options · ${failed.length} failed`);
if (failed.length) log(failed.slice(0, 20).join("\n"));

// ---------- --night: the worker's side job ----------
async function night() {
  const stopAt = Date.now() + Number(args.minutes ?? 50) * 60_000;
  const states = async () => {
    const { data, error } = await sb.from("job_state").select("job, cursor, paused_reason, updated_at").in("job", [OPTIONS_BACKOFF_KEY, WORKER_KEY]);
    if (error) throw new Error(`job_state: ${error.message}`);
    return new Map(((data ?? []) as StateRow[]).map((r) => [r.job, r]));
  };
  const st = await states();
  const nowMs = Date.now();
  const since = new Date(nightStartMs(workerPlan({ nowMs, backoff: null, worker: null, storedTonight: 0, total: 1 }).night)).toISOString();
  const { count, error: cErr } = await sb.from("options_daily").select("ticker", { count: "exact", head: true }).gte("fetched_at", since);
  if (cErr) throw new Error(`options_daily: ${cErr.message}`);
  const rank = await loadRank();
  const list = fairOrder(COVERAGE.map((c) => c.ticker), rank, { offset: 0 });
  const plan = workerPlan({ nowMs, backoff: st.get(OPTIONS_BACKOFF_KEY), worker: st.get(WORKER_KEY), storedTonight: count ?? 0, total: list.length });
  log(`options night: ${plan.run ? `collecting from ${plan.start} of ${list.length}` : "not collecting"} (${plan.why})`);
  if (!plan.run) return;
  const put = async (row: StateRow) => {
    const { error } = await sb.from("job_state").upsert(row);
    if (error) throw new Error(`job_state: ${error.message}`);
  };
  await put(workerProgress(plan.night, plan.start, list.length, Date.now()));
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; FiledUnder/1.0)", Accept: "application/json" };
  let last = 0;
  const fetchChain = async (t: string): Promise<ChainResult> => {
    const wait = last + WORKER_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const r = await fetch(cboeChainUrl(t), { headers, signal: AbortSignal.timeout(20_000) });
      const kind = chainStatus(r.status);
      if (kind !== "read") {
        r.body?.cancel().catch(() => undefined);
        return kind === "error" ? { t, kind: "error", message: `HTTP ${r.status}` } : { t, kind, status: r.status };
      }
      const j = (await r.json()) as { data?: CboeChain };
      const snap = j.data ? summarizeChain(t, j.data) : null;
      return snap ? { t, kind: "stored", row: snapshotRow(snap) } : { t, kind: "none", status: r.status };
    } catch (e) {
      return { t, kind: "error", message: (e as Error).message.slice(0, 120) };
    }
  };
  let pos = plan.start;
  let storedRows = 0;
  while (pos < list.length && Date.now() < stopAt) {
    const chunk = list.slice(pos, pos + WORKER_CHUNK);
    await dbGate("options");
    const { data: have, error: hErr } = await sb.from("options_daily").select("ticker").in("ticker", chunk).gte("fetched_at", since);
    if (hErr) throw new Error(`options_daily: ${hErr.message}`);
    const todo = toFetch(chunk, new Set(((have ?? []) as { ticker: string }[]).map((r) => r.ticker)));
    const results: ChainResult[] = [];
    for (const t of todo) {
      if (Date.now() >= stopAt) break;
      results.push(await fetchChain(t));
    }
    let verdict = judgeSlice(results);
    if (verdict.needsProbe) {
      const probe = await fetchChain(OPTIONS_PROBE);
      verdict = judgeSlice(results, probe.kind === "stored" || probe.kind === "none" ? 200 : probe.kind === "blocked" ? probe.status : 0);
    }
    const rows = verdict.results.filter((r): r is Extract<ChainResult, { kind: "stored" }> => r.kind === "stored").map((r) => ({ ...(r.row as Record<string, unknown>), fetched_at: new Date().toISOString() }));
    if (rows.length) {
      await dbGate("options");
      const { error } = await sb.from("options_daily").upsert(rows as never, { onConflict: "ticker,date" });
      if (error) throw new Error(`options_daily: ${error.message}`);
      storedRows += rows.length;
    }
    if (verdict.outcome === "blocked") {
      const statuses = verdict.results.flatMap((r) => (r.kind === "blocked" ? [r.status] : []));
      await put(workerBlocked(plan.night, pos, parseWorker((await states()).get(WORKER_KEY)), Date.now(), statuses));
      log(`options night: Cboe refused the worker at ${pos}; ${storedRows} stored this pass`);
      return;
    }
    // A chunk cut by the time limit is repeated next pass (stored names are skipped then).
    if (results.length < todo.length) break;
    pos += chunk.length;
    await put(workerProgress(plan.night, pos, list.length, Date.now()));
  }
  log(`options night: at ${pos} of ${list.length}, ${storedRows} stored this pass`);
}
