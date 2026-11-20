/**
 * Scheduled standard reports, one slot per call (run by the Render worker loop every 10 minutes):
 * recaps for earnings 8-Ks of the last 3 days, previews for reports expected within 7 days. Bounded
 * by ensureReport's daily limit. An AI 402 is recorded once, pauses the job and is probed hourly.
 * Each call also returns slots whose lock is older than 2 hours to a retryable state. Failure classes
 * (src/lib/jobs/failure.ts): credit and allowance outages pause the job (and the provider circuit
 * holds every AI caller back); a wrong model or key pauses it too; any other failure counts against
 * that slot only, and a slot that failed 3 times is skipped so it cannot block every other report.
 * Every call writes a `job_runs` row `reports-due`.
 *   bun scripts/reports-due.ts [--dry]
 */
import { args, log, sb } from "./lib/supa";
import { COVERAGE } from "@/lib/coverage";
import { ensureReport, ReportLimitError } from "@/lib/reports/store.server";
import { loadReportInputs } from "@/lib/reports/inputs.server";
import { dueSlots, FAIL_PREFIX, failedSlots, failReceipt, failReceiptKey, nextUtcDay, reportOutcome, REPORTS_JOB, REPORTS_PROBE_MS, STUCK_LOCK_MS } from "./lib/reports-due";
import { routeDecision, routeOf, type ProviderId } from "@/lib/jobs/provider-health";
import { providerStates } from "@/lib/jobs/provider-health.server";

const started = new Date().toISOString();
async function finish(ok: boolean, detail: Record<string, unknown>, items = 0): Promise<never> {
  if (!dry) await sb.from("job_runs").insert({ job: REPORTS_JOB, started_at: started, finished_at: new Date().toISOString(), ok, items, detail: detail as never });
  process.exit(0);
}

const now = () => new Date().toISOString();
const today = now().slice(0, 10);
const dry = args.dry !== undefined;

// 1. Stuck locks (writer died mid-report): back to a retryable state, never deleted.
const cutoff = new Date(Date.now() - STUCK_LOCK_MS).toISOString();
const { data: stuck } = await sb.from("reports").select("id, title").eq("status", "generating").lt("started_at", cutoff);
for (const r of stuck ?? []) {
  if (dry) continue;
  // A report restored to "ready" keeps its updated_at: bumping it made the reports dataset look fresh
  // although nothing new was written (P2-5).
  await sb.from("reports").update(r.title ? { status: "ready", error: "Interrupted writer: lock older than 2 hours released; will be rewritten" } : { status: "failed", error: "Interrupted writer: lock older than 2 hours released; will be rewritten", updated_at: now() }).eq("id", r.id).eq("status", "generating");
}
if (stuck?.length) log(`${dry ? "would release" : "released"} ${stuck.length} stale report lock(s)`);

// 2. Paused on AI credits: wait for the hourly probe.
const { data: st } = await sb.from("job_state").select("cursor, paused_reason").eq("job", REPORTS_JOB).maybeSingle();
if (st?.paused_reason && (st.cursor ?? 0) * 1000 > Date.now()) {
  log(`${REPORTS_JOB} paused (${st.paused_reason}); next probe ${new Date(st.cursor * 1000).toISOString()}`);
  await finish(true, { paused: st.paused_reason });
}
// The provider circuit already knows the AI route is out: skip without a call (no slot is charged).
const route: ProviderId[] = process.env.IR_FREE_ONLY === "1" ? routeOf("gpt-5.4-mini", process.env) : ["gateway"];
try {
  const d = routeDecision(await providerStates(route), route, Date.now());
  if (d.state === "open") {
    log(`${REPORTS_JOB}: ${route.join("/")} closed (${d.cls}) until ${d.retryAt ? new Date(d.retryAt * 1000).toISOString() : "?"}`);
    await finish(true, { waiting: route, cls: d.cls });
  }
} catch {
  /* circuit unreadable: carry on */
}

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
const { data: receipts } = await sb.from("job_state").select("job, cursor, paused_reason").like("job", `${FAIL_PREFIX}%`).limit(2000);
const skip = failedSlots(receipts ?? []);
const due = dueSlots(events ?? [], upcoming, reps ?? [], new Set(COVERAGE.map((c) => c.ticker)), today, skip);
log(`${REPORTS_JOB}: ${due.length} due (${due.filter((d) => d.kind === "recap").length} recaps, ${due.filter((d) => d.kind === "preview").length} previews)${dry ? " — dry run" : ""}`);
if (dry) process.exit(0);
if (!due.length) await finish(true, { due: 0, skipped: skip.size });

// 4. One slot per call.
const slot = due[0];
const FREE_PAUSE = "Free AI allowance spent for today; resumes after 00:00 UTC";
const pause = async (reason: string | null, retryAt = 0) => sb.from("job_state").upsert({ job: REPORTS_JOB, cursor: retryAt, paused_reason: reason, updated_at: now() });
const receipt = (receipts ?? []).find((r) => r.job === failReceiptKey(slot)) ?? null;
let error: string | null = null;
let title: string | null = null;
let limited = false;
try {
  const row = await ensureReport(sb as never, { ticker: slot.ticker, kind: slot.kind, scope: "shared", firmId: null, firmName: null, userId: null, coverage: null, source: "pregen" }, () => loadReportInputs(slot.ticker));
  error = row.error ?? null;
  title = row.title ?? null;
} catch (e) {
  error = (e as Error).message;
  limited = e instanceof ReportLimitError;
}
const outcome = limited ? "limit" : reportOutcome(error);
if (outcome === "limit") log(`${REPORTS_JOB}: daily limit reached — ${error}`);
else if (outcome === "allowance") {
  if (!st?.paused_reason) log(`${REPORTS_JOB}: free AI allowance spent — paused until the UTC day resets`);
  await pause(FREE_PAUSE, nextUtcDay(Date.now()));
} else if (outcome === "credit") {
  if (!st?.paused_reason) log(`${REPORTS_JOB}: AI credits exhausted — paused, probing hourly`);
  await pause(`AI credits exhausted: ${error!.slice(0, 140)}`, Math.ceil((Date.now() + REPORTS_PROBE_MS) / 1000));
} else if (outcome === "config") {
  log(`${REPORTS_JOB}: AI configuration error — paused, probing hourly: ${error}`);
  await pause(`AI configuration error: ${error!.slice(0, 140)}`, Math.ceil((Date.now() + REPORTS_PROBE_MS) / 1000));
} else if (outcome === "fail") {
  // Charged to this slot only; after 3 failures it is skipped and the next due slot gets its turn.
  await sb.from("job_state").upsert({ ...failReceipt(slot, receipt, error!), updated_at: now() });
  if (st?.paused_reason) await pause(null);
  log(`✗ ${slot.ticker}/${slot.kind} (${slot.reason}) ${error}`);
} else {
  if (st?.paused_reason) await pause(null);
  if (receipt) await sb.from("job_state").delete().eq("job", receipt.job);
  log(`✓ ${slot.ticker}/${slot.kind} (${slot.reason}) ${title ?? ""}`);
}
await finish(outcome === "ok" || outcome === "limit", { slot, outcome, error: error?.slice(0, 200) ?? null, due: due.length, skipped: skip.size }, outcome === "ok" ? 1 : 0);
