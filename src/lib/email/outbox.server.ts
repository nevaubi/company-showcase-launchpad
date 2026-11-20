// Server-only outbox: every app email is recorded in email_log first, then delivered.
// Retries, sender-not-ready and the daily cap are handled here; never throws at the caller.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  approvalLink, backoffMs, capReached, classifySendError, DEFAULT_DAILY_CAP, idemKey, MAX_ATTEMPTS,
  REMINDER_AFTER_DAYS, SITE_URL, type EmailStatus, type TemplateName,
} from "./core";

export interface QueueArgs {
  template: TemplateName;
  to: string;
  relatedTable: string;
  relatedId: string;
  /** Row state that makes this send unique (e.g. "joined", "approved:<decided_at>"). */
  state: string;
  data: Record<string, unknown>;
}

type Row = { id: string; idempotency_key: string; recipient: string; template: string; template_data: unknown; status: string; attempts: number };

async function sentToday(): Promise<{ sent: number; cap: number }> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count }, { data: s }] = await Promise.all([
    supabaseAdmin.from("email_log").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", since),
    supabaseAdmin.from("email_settings").select("daily_cap").eq("id", 1).maybeSingle(),
  ]);
  return { sent: count ?? 0, cap: s?.daily_cap ?? DEFAULT_DAILY_CAP };
}

async function update(id: string, patch: Record<string, unknown>) {
  await supabaseAdmin.from("email_log").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Tries one delivery and records the outcome. */
async function deliver(row: Row): Promise<EmailStatus> {
  const { sent, cap } = await sentToday();
  if (capReached(sent, cap)) {
    await update(row.id, { status: "queued", error: `daily cap of ${cap} reached`, next_attempt_at: new Date(Date.now() + 3_600_000).toISOString() });
    return "queued";
  }
  const attempts = row.attempts + 1;
  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const r = await sendTemplateEmail(row.template, row.recipient, {
      templateData: (row.template_data ?? {}) as Record<string, unknown>,
      idempotencyKey: row.idempotency_key,
    });
    if (!r.sent) {
      await update(row.id, { status: "suppressed", attempts, error: "recipient suppressed" });
      return "suppressed";
    }
    await update(row.id, { status: "sent", attempts, error: null, sent_at: new Date().toISOString() });
    return "sent";
  } catch (e) {
    const err = e as { code?: string; status?: number; message?: string; retryAfterSeconds?: number | null };
    const c = classifySendError(err, attempts);
    const wait = err.status === 429 ? (err.retryAfterSeconds ?? 60) * 1000 : backoffMs(attempts);
    await update(row.id, {
      status: c.status, attempts, error: String(err.code ?? err.message ?? e).slice(0, 500),
      next_attempt_at: new Date(Date.now() + (c.retry ? wait : 365 * 86_400_000)).toISOString(),
    });
    return c.status;
  }
}

/**
 * Records the send (once per idempotency key) and delivers it now. `recorded` is false when no
 * email_log row exists for the key (the insert failed and no earlier row was found): nothing will
 * ever deliver it, whatever `status` says.
 */
export async function queueEmailRecorded(a: QueueArgs): Promise<{ status: EmailStatus; recorded: boolean; error?: string }> {
  const key = idemKey(a.template, a.to, a.relatedId, a.state);
  const { data: inserted, error } = await supabaseAdmin
    .from("email_log")
    .upsert(
      { idempotency_key: key, recipient: a.to.trim().toLowerCase(), template: a.template, related_table: a.relatedTable, related_id: a.relatedId, template_data: a.data as never },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id,idempotency_key,recipient,template,template_data,status,attempts");
  const row = inserted?.[0] as Row | undefined;
  if (!row) {
    const { data: existing, error: readError } = await supabaseAdmin.from("email_log").select("status").eq("idempotency_key", key).maybeSingle();
    if (existing) return { status: existing.status as EmailStatus, recorded: true };
    return { status: "queued", recorded: false, error: (error ?? readError)?.message ?? "email_log row missing" };
  }
  try {
    return { status: await deliver(row), recorded: true };
  } catch (e) {
    console.error("email deliver", e);
    return { status: "queued", recorded: true };
  }
}

/** queueEmailRecorded's status only (callers that cannot act on a missing row). Never throws on the database. */
export async function queueEmail(a: QueueArgs): Promise<EmailStatus> {
  return (await queueEmailRecorded(a)).status;
}

export async function adminEmails(): Promise<string[]> {
  const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  const out: string[] = [];
  for (const r of roles ?? []) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
    if (data.user?.email) out.push(data.user.email.toLowerCase());
  }
  return out;
}

const RUN_BUDGET_MS = 4_000;

/**
 * Scheduled: retries due sends, then queues the one-time reminder for approvals not yet used.
 * `budgetMs` is what the `emails` job has left after the watchdog (default 4 s).
 */
export async function runOutbox(budgetMs = RUN_BUDGET_MS): Promise<{ ok: boolean; items: number; detail: Record<string, unknown> }> {
  const started = Date.now();
  const tally: Record<string, number> = {};
  const { data: due } = await supabaseAdmin
    .from("email_log")
    .select("id,idempotency_key,recipient,template,template_data,status,attempts")
    .in("status", ["queued", "waiting_sender", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at")
    .limit(10);
  for (const row of (due ?? []) as Row[]) {
    if (Date.now() - started > budgetMs) break;
    const s = await deliver(row);
    tally[s] = (tally[s] ?? 0) + 1;
  }
  let reminders = 0;
  if (Date.now() - started < budgetMs) reminders = await queueReminders(started, budgetMs);
  const items = Object.values(tally).reduce((a, b) => a + b, 0) + reminders;
  return { ok: true, items, detail: { retried: tally, reminders } };
}

/** One reminder per approval, only for people whose approval email was actually sent. */
async function queueReminders(started: number, budgetMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 86_400_000).toISOString();
  const { data: approvals } = await supabaseAdmin
    .from("email_log")
    .select("recipient,related_table,related_id,template_data")
    .eq("template", "waitlist-approved").eq("status", "sent").lt("sent_at", cutoff)
    .limit(50);
  if (!approvals?.length) return 0;
  const { data: idle } = await supabaseAdmin.rpc("waitlist_reminder_candidates");
  const idleEmails = new Set((idle ?? []).map((r) => (r.email ?? "").toLowerCase()));
  const { data: requests } = await supabaseAdmin.from("waitlist_requests").select("email,user_id").is("user_id", null).eq("status", "approved");
  const noAccount = new Set((requests ?? []).map((r) => r.email));
  let n = 0;
  for (const a of approvals) {
    if (Date.now() - started > budgetMs) break;
    if (!idleEmails.has(a.recipient) && !noAccount.has(a.recipient)) continue;
    const d = (a.template_data ?? {}) as Record<string, unknown>;
    const s = await queueEmail({
      template: "waitlist-reminder", to: a.recipient, relatedTable: a.related_table ?? "waitlist", relatedId: a.related_id ?? a.recipient,
      state: "reminder", data: { name: d.name, email: a.recipient, link: approvalLink(a.recipient, !noAccount.has(a.recipient)) },
    });
    if (s !== "queued") n++;
  }
  return n;
}

export const ADMIN_WAITLIST_URL = `${SITE_URL}/app/admin`;
