/**
 * Scheduled standard reports, one slot per call (run by the Render worker loop every 10 minutes):
 * recaps for earnings 8-Ks of the last 3 days, previews for reports expected within 7 days. Bounded
 * by ensureReport's daily limit. An AI 402 is recorded once, pauses the job and is probed hourly.
 * Each call also returns slots whose lock is older than 2 hours to a retryable state.
 *   bun scripts/reports-due.ts [--dry]
 */
import { args, log, sb } from "./lib/supa";
import { COVERAGE } from "@/lib/coverage";
import { ensureReport, ReportLimitError } from "@/lib/reports/store.server";
import { loadReportInputs } from "@/lib/reports/inputs.server";
import { dueSlots, isAiCreditError, REPORTS_JOB, REPORTS_PROBE_MS, STUCK_LOCK_MS } from "./lib/reports-due";

const now = () => new Date().toISOString();
const today = now().slice(0, 10);
const dry = args.dry !== undefined;

// 1. Stuck locks (writer died mid-report): back to a retryable state, never deleted.
const cutoff = new Date(Date.now() - STUCK_LOCK_MS).toISOString();
const { data: stuck } = await sb.from("reports").select("id, title").eq("status", "generating").lt("started_at", cutoff);
for (const r of stuck ?? []) {
  if (dry) continue;
  await sb.from("reports").update({ status: r.title ? "ready" : "failed", error: "Interrupted writer: lock older than 2 hours released; will be rewritten", updated_at: now() }).eq("id", r.id).eq("status", "generating");
}
if (stuck?.length) log(`${dry ? "would release" : "released"} ${stuck.length} stale report lock(s)`);

// 2. Paused on AI credits: wait for the hourly probe.
const { data: st } = await sb.from("job_state").select("cursor, paused_reason").eq("job", REPORTS_JOB).maybeSingle();
if (st?.paused_reason && (st.cursor ?? 0) * 1000 > Date.now()) { log(`${REPORTS_JOB} paused (${st.paused_reason}); next probe ${new Date(st.cursor * 1000).toISOString()}`); process.exit(0); }

// 3. What is due.
const since = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const [{ data: events }, { data: est }, { data: reps }] = await Promise.all([
  sb.from("earnings_events").select("ticker, accn, filed").gte("filed", since),
  sb.from("analyst_estimates").select("ticker, payload->nextEarnings"),
  sb.from("reports").select("ticker, kind, status, data_version, updated_at").eq("scope", "shared").eq("variant", "base").in("kind", ["recap", "preview"]),
]);
const horizon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const upcoming = (est ?? []).flatMap((e) => {
  const d = (e as { nextEarnings?: { start?: string } | null }).nextEarnings?.start;
  return d && d >= today && d <= horizon ? [{ ticker: e.ticker, date: d }] : [];
});
const due = dueSlots(events ?? [], upcoming, reps ?? [], new Set(COVERAGE.map((c) => c.ticker)), today);
log(`${REPORTS_JOB}: ${due.length} due (${due.filter((d) => d.kind === "recap").length} recaps, ${due.filter((d) => d.kind === "preview").length} previews)${dry ? " — dry run" : ""}`);
if (dry || !due.length) process.exit(0);

// 4. One slot per call.
const slot = due[0];
const pause = async (reason: string | null, retryAt = 0) => sb.from("job_state").upsert({ job: REPORTS_JOB, cursor: retryAt, paused_reason: reason, updated_at: now() });
try {
  const row = await ensureReport(sb as never, { ticker: slot.ticker, kind: slot.kind, scope: "shared", firmId: null, firmName: null, userId: null, coverage: null, source: "pregen" }, () => loadReportInputs(slot.ticker));
  if (row.error && isAiCreditError(row.error)) {
    if (!st?.paused_reason) log(`${REPORTS_JOB}: AI credits exhausted — paused, probing hourly`);
    await pause(`AI credits exhausted (402): ${row.error.slice(0, 120)}`, Math.ceil((Date.now() + REPORTS_PROBE_MS) / 1000));
  } else {
    if (st?.paused_reason) await pause(null);
    log(`${row.error ? "✗" : "✓"} ${slot.ticker}/${slot.kind} (${slot.reason}) ${row.error ?? row.title ?? ""}`);
  }
} catch (e) {
  const m = (e as Error).message;
  if (e instanceof ReportLimitError) log(`${REPORTS_JOB}: daily limit reached — ${m}`);
  else if (isAiCreditError(m)) await pause(`AI credits exhausted (402): ${m.slice(0, 120)}`, Math.ceil((Date.now() + REPORTS_PROBE_MS) / 1000));
  else log(`✗ ${slot.ticker}/${slot.kind}: ${m}`);
}
process.exit(0);
