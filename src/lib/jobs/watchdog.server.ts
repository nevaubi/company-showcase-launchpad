/**
 * Watchdog run (server): reads freshness, job health and job_state, applies the pure rules in
 * watchdog.ts and sends at most one digest email through the outbox. Called first by the `emails`
 * job with a time limit; it never throws at the caller (errors come back in the result).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dataFreshness } from "@/lib/jobs/data-freshness";
import { OWNER_HOLD_PREFIX, ownerHolds } from "@/lib/jobs/lane-hold";
import { readJobHealth, type HealthClient } from "@/lib/jobs/job-health.server";
import { REMEDY_KEYS } from "@/lib/jobs/remediation";
import { alerts, dbDownKey, dbReadFailure, digestSubject, planAlerts, DIGEST_KEY, type JobHealthRow, type StateRow } from "@/lib/jobs/watchdog";

const withTimeout = <T,>(p: PromiseLike<T>, ms: number, what: string) =>
  Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} took over ${ms} ms`)), ms))]);

export async function runWatchdog(budgetMs = 1500): Promise<Record<string, unknown>> {
  const started = Date.now();
  const readMs = Math.max(500, budgetMs - 300);
  // Called on the client, never through a detached reference: the client's rpc reads `this.rest`, and a
  // bare `const rpc = supabaseAdmin.rpc` threw "Cannot read properties of undefined (reading 'rest')" on
  // every production run, so the watchdog never read anything and never alerted.
  type RpcAnswer = PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const rpc = (fn: string, args?: Record<string, unknown>): RpcAnswer =>
    (supabaseAdmin as unknown as { rpc(fn: string, args?: Record<string, unknown>): RpcAnswer }).rpc(fn, args);
  // Job health from job_health() or, while migration 0066 is not applied, from job_runs (job-health.server.ts).
  const [fresh, health, states] = await withTimeout(
    Promise.all([
      rpc("data_freshness"),
      readJobHealth({ rpc, from: (t: string) => supabaseAdmin.from(t as never) } as HealthClient, { hours: 24, budgetMs: readMs - 100 }),
      supabaseAdmin.from("job_state").select("job, cursor, paused_reason, updated_at").or(`job.like."provider:*",job.like."alert:*",job.like."remedy:*",job.like."registrant-drift:*",job.eq.options-backoff,job.eq.alert-digest,paused_reason.like."${OWNER_HOLD_PREFIX}*"`).limit(1000),
    ]),
    readMs,
    "watchdog reads",
  );
  if (fresh.error) throw new Error(`data_freshness: ${fresh.error.message}`);
  // A job health read that failed (or timed out) does not end the run: freshness and job_state are
  // still judged, every job counts as not read (never "no run in 24 h"), and the result says why.
  if (states.error) throw new Error(`job_state: ${states.error.message}`);
  const now = Date.now();
  const rows = (states.data ?? []) as StateRow[];
  const jobs: JobHealthRow[] = health.rows;
  // Lanes the owner stopped: the datasets they feed are held, and raise nothing.
  const active = alerts({ freshness: dataFreshness((fresh.data ?? []) as { key: string; newest: string | null }[], new Date(now), ownerHolds(rows)), jobs, states: rows, unread: health.unread }, now, REMEDY_KEYS);
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
  return { health: health.error ? `not read: ${health.error.slice(0, 160)}` : health.source, ...(health.unread.length ? { unread: health.unread } : {}), active: active.map((a) => a.key), opened: rowsToWrite.filter((r) => r.job.startsWith("alert:") && /^open:/.test(r.paused_reason ?? "")).map((r) => r.job), closed: plan.close, emailed: delivered ? plan.send.map((a) => a.key) : [], ...(plan.send.length && !delivered ? { held: plan.send.map((a) => a.key) } : {}), sent, ms: Date.now() - started };
}

/**
 * Called when runWatchdog threw (review R7). If a second, minimal read also fails, the database API
 * is taken as unreachable and one email goes straight to the email provider, to OPS_ALERT_EMAIL (the
 * admin list lives in the database, so it cannot be read now). At most one a UTC day: the provider
 * deduplicates the idempotency key across isolates. What this cannot see: a Postgres outage stops
 * pg_cron, which is what calls this job, so then nothing in the app runs at all; only an outside
 * uptime check covers that.
 */
export async function alertIfDatabaseDown(err: Error, nowMs = Date.now()): Promise<Record<string, unknown>> {
  if (!dbReadFailure(err.message)) return { direct: "not sent: the watchdog's reads were slow, not refused" };
  const probe = await withTimeout(supabaseAdmin.from("job_state").select("job").limit(1), 800, "database probe").then(
    (r) => (r.error ? r.error.message : null),
    (e: Error) => e.message,
  );
  if (probe == null) return { direct: "not sent: the database answered a second read" };
  const to = (process.env["OPS_ALERT_EMAIL"] ?? "").trim();
  if (!to) return { direct: "not sent: OPS_ALERT_EMAIL is not set", probe };
  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const since = new Date(nowMs).toISOString();
    await sendTemplateEmail("ops-alert", to, {
      idempotencyKey: dbDownKey(nowMs),
      templateData: {
        subject: "FiledUnder ops: the database is not answering",
        link: "https://filedunder.ai/app/freshness",
        alerts: [
          {
            key: "database",
            title: `The database API refused the watchdog's reads: ${probe.slice(0, 160)}`,
            since,
            tried: "nothing can be retried while the database is down; jobs repeat their slices once it answers",
            action: "Check the Lovable Cloud project status (database and API) and its logs.",
          },
        ],
      },
    });
    return { direct: `sent to ${to}`, probe };
  } catch (e) {
    return { direct: `send failed: ${(e as Error).message.slice(0, 160)}`, probe };
  }
}
