/**
 * Watchdog run (server): reads freshness, job health and job_state, applies the pure rules in
 * watchdog.ts and sends at most one digest email through the outbox. Called first by the `emails`
 * job with a time limit; it never throws at the caller (errors come back in the result).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dataFreshness } from "@/lib/jobs/data-freshness";
import { REMEDY_KEYS } from "@/lib/jobs/remediation";
import { alerts, digestSubject, planAlerts, DIGEST_KEY, type JobHealthRow, type StateRow } from "@/lib/jobs/watchdog";

const withTimeout = <T,>(p: PromiseLike<T>, ms: number, what: string) =>
  Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} took over ${ms} ms`)), ms))]);

export async function runWatchdog(budgetMs = 1500): Promise<Record<string, unknown>> {
  const started = Date.now();
  const readMs = Math.max(500, budgetMs - 300);
  const rpc = supabaseAdmin.rpc as unknown as (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const [fresh, health, states] = await withTimeout(
    Promise.all([
      rpc("data_freshness"),
      rpc("job_health", { _hours: 24 }),
      supabaseAdmin.from("job_state").select("job, cursor, paused_reason, updated_at").or('job.like."provider:*",job.like."alert:*",job.like."remedy:*",job.like."registrant-drift:*",job.eq.options-backoff,job.eq.alert-digest').limit(1000),
    ]),
    readMs,
    "watchdog reads",
  );
  if (fresh.error) throw new Error(`data_freshness: ${fresh.error.message}`);
  if (health.error) throw new Error(`job_health: ${health.error.message}`);
  if (states.error) throw new Error(`job_state: ${states.error.message}`);
  const now = Date.now();
  const rows = (states.data ?? []) as StateRow[];
  const jobs = ((health.data ?? []) as JobHealthRow[]).map((j) => ({ ...j, runs: Number(j.runs), unfinished: Number(j.unfinished), failed: Number(j.failed), fail_streak: Number(j.fail_streak) }));
  const active = alerts({ freshness: dataFreshness((fresh.data ?? []) as { key: string; newest: string | null }[], new Date(now)), jobs, states: rows }, now, REMEDY_KEYS);
  const plan = planAlerts(active, rows, now);

  // Send first. Episodes are marked sent only when the digest reached the outbox: an email_log row
  // exists and is sent or waiting there. Otherwise they stay open (no digest time either), and the
  // next run asks again under the same idempotency key, so a row the outbox delivers later counts then.
  let sent: string[] = [];
  let delivered = false;
  if (plan.send.length && plan.digestState) {
    const { adminEmails, queueEmailRecorded } = await import("@/lib/email/outbox.server");
    const to = await adminEmails();
    const data = {
      subject: digestSubject(plan.send.length, plan.send[0].title),
      alerts: plan.send.map((a) => ({ key: a.key, title: a.title, since: a.since, tried: a.tried, action: a.action })),
      link: "https://filedunder.ai/app/freshness",
    };
    const results = await Promise.all(to.map((addr) => queueEmailRecorded({ template: "ops-alert", to: addr, relatedTable: "job_state", relatedId: DIGEST_KEY, state: plan.digestState!, data })));
    delivered = results.some((r) => r.recorded && (r.status === "sent" || r.status === "queued" || r.status === "waiting_sender"));
    sent = to.map((addr, i) => `${addr}: ${results[i].status}${results[i].recorded ? "" : ` (not recorded: ${results[i].error ?? "no row"})`}`);
    if (!to.length) sent = ["no admin recipients"];
  }
  const at = new Date(now).toISOString();
  const rowsToWrite = plan.send.length && !delivered ? plan.unsent : plan.upsert;
  if (rowsToWrite.length) {
    const { error } = await supabaseAdmin.from("job_state").upsert(rowsToWrite.map((r) => ({ job: r.job, cursor: Number(r.cursor ?? 0), paused_reason: r.paused_reason, updated_at: r.updated_at ?? at })));
    if (error) throw new Error(error.message);
  }
  if (plan.close.length) {
    const { error } = await supabaseAdmin.from("job_state").delete().in("job", plan.close);
    if (error) throw new Error(error.message);
  }
  return { active: active.map((a) => a.key), opened: rowsToWrite.filter((r) => r.job.startsWith("alert:") && /^open:/.test(r.paused_reason ?? "")).map((r) => r.job), closed: plan.close, emailed: delivered ? plan.send.map((a) => a.key) : [], ...(plan.send.length && !delivered ? { held: plan.send.map((a) => a.key) } : {}), sent, ms: Date.now() - started };
}
