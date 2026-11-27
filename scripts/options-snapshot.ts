// One options snapshot per covered stock and trading day, from Yahoo Finance (owner, 27 Nov 2026:
// Yahoo Finance or Firecrawl instead of Cboe). Rules: src/lib/jobs/options-collect.ts.
//
//   bun scripts/options-snapshot.ts --night [--minutes=50] [--any-time]
//       The worker loop's side step. Collects today's session after the close (16:20 to 23:30 New
//       York), resumes from `options-collect` in job_state, skips names already stored today, goes
//       through the page reader when Yahoo refuses this address (at most READER_MAX_PER_SESSION a
//       session) and records its own pause when both routes are refused. Each pass leaves an
//       `options-collect` row in job_runs. --any-time drops the clock window for a pass run by hand
//       (after an early close); the chain must still be today's finished session.
//
//   bun scripts/options-snapshot.ts --tickers=AAPL,HOOD [--dry]
//       Reads the named stocks now, by the same rules (a chain is stored only when it is today's
//       finished session). --dry prints what each chain comes to and stores nothing.
import { COVERAGE } from "@/lib/coverage";
import { Collector, loadRate, openRoutes } from "@/lib/options/collect.server";
import {
  chunkFailed, COLLECT_CHUNK, COLLECT_KEY, COLLECT_PROBE, collectBlocked, collectClosed, collectPlan, collectProgress, DIRECT_GAP_MS, emptyTally, parseCollect, probeVerdict,
  READER_KEY, READER_MAX_PER_SESSION, readerRow, readerUsed, sessionOf, tally, toFetch, type ChainOutcome,
  noneReceipts,
} from "@/lib/jobs/options-collect";
import { fairOrder } from "@/lib/jobs/priority";
import type { StateRow } from "@/lib/jobs/watchdog";
import { loadRank } from "./lib/rank";
import { args, dbGate, log, sb, sleep } from "./lib/supa";

const states = async () => {
  const { data, error } = await sb.from("job_state").select("job, cursor, paused_reason, updated_at").in("job", [COLLECT_KEY, READER_KEY]);
  if (error) throw new Error(`job_state: ${error.message}`);
  return new Map(((data ?? []) as StateRow[]).map((r) => [r.job, r]));
};
const put = async (row: StateRow) => {
  const { error } = await sb.from("job_state").upsert(row);
  if (error) throw new Error(`job_state: ${error.message}`);
};
async function store(results: ChainOutcome[]) {
  const rows = results.flatMap((r) => (r.kind === "stored" ? [{ ...r.row, fetched_at: new Date().toISOString() }] : []));
  if (rows.length) {
    await dbGate("options");
    const { error } = await sb.from("options_daily").upsert(rows as never, { onConflict: "ticker,date" });
    if (error) throw new Error(`options_daily: ${error.message}`);
  }
  // a name without listed options leaves a receipt, so the coverage ledger does not call it "not collected"
  const none = noneReceipts(results, Date.now());
  if (none.length) {
    await dbGate("options");
    const { error } = await sb.from("job_state").upsert(none);
    if (error) console.warn(`options-none receipts not stored: ${error.message}`);
  }
}
const say = (r: ChainOutcome) =>
  r.kind === "stored"
    ? `stored (${r.route}) ${JSON.stringify({ date: r.row["date"], price: r.row["price"], iv30: r.row["iv30"], atm_iv: r.row["atm_iv"], skew25: r.row["skew25"], pc_oi: r.row["pc_oi"], term: (r.row["term"] as unknown[]).length })}`
    : r.kind === "stale" ? `not today's finished session (${r.quoted})` : r.kind === "none" ? "no listed options" : r.kind === "unquoted" ? "no two-sided quotes near the money" : r.kind === "blocked" ? `refused (HTTP ${r.status})` : `error: ${r.message}`;

if (args.night) await night();
else await manual();
process.exit(0);

async function manual() {
  const tickers = String(args.tickers ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) {
    log("usage: options-snapshot.ts --night [--minutes=50] | --tickers=AAPL,HOOD [--dry]");
    process.exit(2);
  }
  const today = sessionOf(Date.now());
  const c = new Collector(sb, process.env, await loadRate(sb), today.date);
  const t0 = emptyTally();
  for (const t of tickers) {
    const r = await c.one(t);
    log(`${t}: ${say(r)}`);
    if (!args.dry) await store([r]);
    tally(t0, [r]);
    await sleep(DIRECT_GAP_MS);
  }
  log(`${args.dry ? "DRY " : ""}${t0.stored} stored · ${t0.none} without options · ${t0.unquoted} without quotes · ${t0.stale} not today's session · ${t0.errors} failed`);
}

async function night() {
  const t0 = Date.now();
  const stopAt = t0 + Number(args.minutes ?? 50) * 60_000;
  const st = await states();
  const rank = await loadRank();
  const list = fairOrder(COVERAGE.map((c) => c.ticker), rank, { offset: 0 });
  const plan = collectPlan({ nowMs: t0, row: st.get(COLLECT_KEY), total: list.length, anyTime: !!args["any-time"] });
  log(`options: ${plan.run ? `collecting session ${plan.session} from ${plan.start} of ${list.length}` : "not collecting"} (${plan.why})`);
  if (!plan.run) return;
  const rate = await loadRate(sb);
  const used0 = readerUsed(st.get(READER_KEY), plan.session);
  const c = new Collector(sb, process.env, rate, plan.date, openRoutes(used0));
  const counts = emptyTally();
  let pos = plan.start;
  let blockedWhy: string | null = null;
  let note = "";
  const receipt = async (ok: boolean) => {
    const row = { job: COLLECT_KEY, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), ok, items: counts.stored, detail: { session: plan.session, from: plan.start, to: pos, total: list.length, ...counts, readerUsed: c.routes.readerUsed, rate: rate.value, rateDate: rate.date, ...(blockedWhy ? { blocked: blockedWhy } : {}), ...(note ? { note } : {}) } };
    await sb.from("job_runs").insert(row as never).then(undefined, () => undefined);
  };
  const saveReader = async () => {
    if (c.routes.readerUsed !== used0) await put(readerRow(plan.session, c.routes.readerUsed, Date.now()));
  };
  const refusal = () => `Yahoo refused the collector (HTTP ${c.routes.lastStatus || "?"})${c.routes.readerClosed ? " and the page reader was refused too" : c.routes.readerUsed >= READER_MAX_PER_SESSION ? ` and the page reader's ${READER_MAX_PER_SESSION} requests for the session are used` : ""}`;

  // Is there a finished session today? SPY always has a chain.
  const probe = await c.probe(COLLECT_PROBE).catch((e: Error) => ({ kind: "error" as const, message: e.message.slice(0, 120) }));
  await saveReader();
  if (probe.kind === "blocked") {
    blockedWhy = refusal();
    await put(collectBlocked(plan.session, pos, parseCollect(st.get(COLLECT_KEY)), Date.now(), blockedWhy));
    log(`options: ${blockedWhy}`);
    return receipt(false);
  }
  if (probe.kind !== "read") {
    note = `probe failed: ${probe.kind === "error" ? probe.message : "Yahoo did not accept the session"}`;
    log(`options: ${note}; the next pass tries again`);
    return receipt(false);
  }
  const verdict = probeVerdict(probe.result, plan.date);
  if (verdict.kind === "closed") {
    await put(collectClosed(plan.session, verdict.last, Date.now()));
    note = `no session today (Yahoo's newest quote is from ${verdict.last})`;
    log(`options: ${note}`);
    return receipt(true);
  }
  if (verdict.kind !== "ready") {
    note = verdict.kind === "open" ? "the session is still open on Yahoo" : "the probe carried no quote time";
    log(`options: ${note}; the next pass tries again`);
    return receipt(true);
  }
  await put(collectProgress(plan.session, pos, list.length, Date.now()));

  let last = 0;
  while (pos < list.length && Date.now() < stopAt) {
    const chunk = list.slice(pos, pos + COLLECT_CHUNK);
    await dbGate("options");
    const { data: have, error: hErr } = await sb.from("options_daily").select("ticker").in("ticker", chunk).eq("date", plan.date).eq("source", "yahoo");
    if (hErr) throw new Error(`options_daily: ${hErr.message}`);
    const todo = toFetch(chunk, new Set(((have ?? []) as { ticker: string }[]).map((r) => r.ticker)));
    const results: ChainOutcome[] = [];
    for (const t of todo) {
      if (Date.now() >= stopAt) break;
      const wait = last + DIRECT_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const r = await c.one(t, AbortSignal.timeout(45_000)).catch((e: Error): ChainOutcome => ({ t, kind: "error", message: e.message.slice(0, 120) }));
      results.push(r);
      if (r.kind === "blocked") break;
    }
    await store(results);
    await saveReader();
    tally(counts, results);
    if (results.some((r) => r.kind === "blocked")) {
      blockedWhy = refusal();
      await put(collectBlocked(plan.session, pos, parseCollect((await states()).get(COLLECT_KEY)), Date.now(), blockedWhy));
      log(`options: ${blockedWhy} at ${pos}; ${counts.stored} stored this pass`);
      return receipt(false);
    }
    if (chunkFailed(results)) {
      note = `every name of the chunk at ${pos} failed (${results.slice(0, 3).map((r) => (r.kind === "error" ? `${r.t}: ${r.message}` : r.t)).join("; ")})`;
      log(`options: ${note}; the next pass repeats it`);
      return receipt(false);
    }
    // A chunk cut by the time limit is repeated next pass (stored names are skipped then).
    if (results.length < todo.length) break;
    pos += chunk.length;
    await put(collectProgress(plan.session, pos, list.length, Date.now()));
  }
  log(`options: session ${plan.session} at ${pos} of ${list.length}; this pass ${counts.stored} stored (${counts.reader} through the page reader), ${counts.none} without options, ${counts.unquoted} without quotes, ${counts.stale} not traded today, ${counts.errors} failed`);
  return receipt(true);
}
