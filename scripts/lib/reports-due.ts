import type { ReportKind } from "@/lib/reports/types";
import { KIND_ORDER } from "@/lib/reports/kinds";
import { REPORT_FORMAT } from "@/lib/reports/facts";
import { classify, isFreeAllowanceSpent as allowanceSpent } from "@/lib/jobs/failure";
/** Scheduled standard reports: what is due, and how a credit outage pauses the job. */
export const REPORTS_JOB = "reports-due";
export const REPORTS_PROBE_MS = 3600_000;
export const STUCK_LOCK_MS = 2 * 3600_000;
/** No money left on the AI provider (gateway 402, OpenAI credit_balance_exhausted, …): pause, never retry the slot. */
export const isAiCreditError = (m: string) => /credits are exhausted|\b402\b|payment required|insufficient credits/i.test(m) || classify({ message: m }) === "quota";
/** A wrong model id or missing key: the provider needs a person; pause like a credit outage. */
export const isAiConfigError = (m: string) => classify({ message: m }) === "config";
/** The worker's free-only lane: the day's free allowance is spent, so nothing can be written until the UTC day resets. */
export const isFreeAllowanceSpent = (m: string) => allowanceSpent(m);
/** Seconds since epoch just after the next UTC midnight (when the free allowance resets). */
export const nextUtcDay = (nowMs: number) => {
  const d = new Date(nowMs);
  return Math.ceil(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5) / 1000);
};

export interface DueSlot { ticker: string; kind: ReportKind; reason: string; retryAt?: number }

/** Recover empty shared slots when the event desk has spare capacity. The scheduled worker's
 * provider circuit, allowances, daily cap and per-slot receipt still apply. */
export function recoverySlots(
  failed: { ticker: string; kind: string; updated_at: string }[],
  scheduled: DueSlot[],
  covered: Set<string>,
): DueSlot[] {
  const active = new Set(scheduled.map(failReceiptKey));
  return failed.flatMap((row) => {
    const kind = KIND_ORDER.find((k) => k === row.kind);
    if (!kind || !covered.has(row.ticker) || active.has(failReceiptKey({ ticker: row.ticker, kind }))) return [];
    const retryAt = Date.parse(row.updated_at) + REPORTS_PROBE_MS;
    return [{ ticker: row.ticker, kind, reason: `Recover shared report ${REPORT_FORMAT}`, retryAt }];
  }).sort((a, b) => a.retryAt - b.retryAt || a.ticker.localeCompare(b.ticker));
}

/**
 * Recaps: a covered company with an earnings 8-K (item 2.02) in the last 3 days whose shared recap
 * was not written for that accession. Previews: an expected report date in the next 7 days and no
 * preview written this ISO week for the current data. Recaps first (newest filing first).
 */
export function dueSlots(
  events: { ticker: string; accn: string; filed: string }[],
  upcoming: { ticker: string; date: string }[],
  reports: { ticker: string; kind: string; status: string; data_version: string; updated_at: string }[],
  covered: Set<string>,
  today: string,
  /** slots set aside after repeated failures (`slotKey`); see `failedSlots` */
  skip: Set<string> = new Set(),
): DueSlot[] {
  const by = new Map(reports.map((r) => [`${r.ticker}:${r.kind}`, r]));
  const out: DueSlot[] = [];
  const latest = new Map<string, { accn: string; filed: string }>();
  for (const e of events) if (covered.has(e.ticker) && (!latest.has(e.ticker) || e.filed > latest.get(e.ticker)!.filed)) latest.set(e.ticker, e);
  for (const [ticker, e] of [...latest].sort((a, b) => b[1].filed.localeCompare(a[1].filed))) {
    const r = by.get(`${ticker}:recap`);
    if (r && r.status === "ready" && r.data_version.split("|")[1] === e.accn) continue;
    const slot: DueSlot = { ticker, kind: "recap", reason: `8-K 2.02 ${e.accn} filed ${e.filed}` };
    if (!skip.has(slotKey(slot))) out.push(slot);
  }
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString();
  for (const u of [...upcoming].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!covered.has(u.ticker) || latest.has(u.ticker)) continue;
    const r = by.get(`${u.ticker}:preview`);
    if (r && r.status === "ready" && r.updated_at >= weekAgo) continue;
    const slot: DueSlot = { ticker: u.ticker, kind: "preview", reason: `expected report ${u.date}` };
    if (!skip.has(slotKey(slot))) out.push(slot);
  }
  return out;
}

// ---------- head-of-line skip (P1-6) ----------
export const FAIL_PREFIX = "reports-due-fail:";
export const SLOT_MAX_FAILS = 3;
/** One receipt per slot: job_state `reports-due-fail:<ticker>:<kind>`, cursor = failures, paused_reason = `<reason>|<error>`. */
export const failReceiptKey = (s: Pick<DueSlot, "ticker" | "kind">) => `${FAIL_PREFIX}${s.ticker}:${s.kind}`;
/** A slot's identity includes its reason (accession or expected date), so a new quarter is a new slot. */
export const slotKey = (s: DueSlot) => `${s.ticker}:${s.kind}:${s.reason}`;

/** Slots to skip: receipts with SLOT_MAX_FAILS or more failures for the same slot reason. */
export function failedSlots(receipts: { job: string; cursor: number; paused_reason: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const r of receipts) {
    if (!r.job.startsWith(FAIL_PREFIX) || r.cursor < SLOT_MAX_FAILS || !r.paused_reason) continue;
    const [ticker, kind] = r.job.slice(FAIL_PREFIX.length).split(":");
    const reason = r.paused_reason.split("|")[0];
    out.add(`${ticker}:${kind}:${reason}`);
  }
  return out;
}

/** Receipt after a non-credit failure: counts up for the same slot reason, restarts for a new one. */
export function failReceipt(slot: DueSlot, prev: { cursor: number; paused_reason: string | null } | null, error: string) {
  const same = prev?.paused_reason?.split("|")[0] === slot.reason;
  return { job: failReceiptKey(slot), cursor: (same ? prev!.cursor : 0) + 1, paused_reason: `${slot.reason}|${error}`.slice(0, 200) };
}

export type ReportOutcome = "ok" | "allowance" | "credit" | "config" | "fail";
/** What one ensureReport result or error means for the job. */
export function reportOutcome(error: string | null | undefined): ReportOutcome {
  if (!error) return "ok";
  if (isFreeAllowanceSpent(error)) return "allowance";
  if (isAiCreditError(error)) return "credit";
  if (isAiConfigError(error)) return "config";
  return "fail";
}

/**
 * Failure receipts whose slot is no longer due at all (the recap was written another way, the
 * accession fell out of the 3-day window, the preview date passed): delete them, at most `max` per
 * call, so receipts stay far below the 2,000 rows the job reads (review F10).
 */
export function staleReceipts(receipts: { job: string; paused_reason: string | null }[], dueUnskipped: DueSlot[], max = 100): string[] {
  const live = new Set(dueUnskipped.map(slotKey));
  const out: string[] = [];
  for (const r of receipts) {
    if (!r.job.startsWith(FAIL_PREFIX)) continue;
    const [ticker, kind] = r.job.slice(FAIL_PREFIX.length).split(":");
    const reason = (r.paused_reason ?? "").split("|")[0];
    if (!live.has(`${ticker}:${kind}:${reason}`)) out.push(r.job);
    if (out.length >= max) break;
  }
  return out;
}
