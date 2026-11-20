// Pure email and waitlist rules shared by the server and tests. No Node or browser APIs.
import { z } from "zod";

export const SITE_URL = "https://filedunder.ai";
export const MAX_ATTEMPTS = 6;
export const DEFAULT_DAILY_CAP = 200;
export const IP_LIMIT_PER_HOUR = 5;
export const EMAIL_LIMIT_PER_DAY = 3;
export const REMINDER_AFTER_DAYS = 3;

export type EmailStatus = "queued" | "waiting_sender" | "sent" | "suppressed" | "failed";
export type TemplateName = "waitlist-receipt" | "waitlist-owner-notice" | "waitlist-approved" | "waitlist-reminder" | "firm-invite" | "ops-alert";

const opt = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const waitlistSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100, "Name is too long"),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().email("Enter a valid work email").max(255, "Email is too long")),
  firm: opt(120),
  role: opt(80),
  useCase: opt(500),
  /** Honeypot: real people leave it empty. */
  website: z.string().max(200).optional(),
});
export type WaitlistInput = z.input<typeof waitlistSchema>;

/** One logical send per template, recipient and row state, so retries and double clicks never send twice. */
export function idemKey(template: TemplateName, recipient: string, relatedId: string, state: string): string {
  return `${template}:${recipient.trim().toLowerCase()}:${relatedId}:${state}`;
}

/** Exponential backoff: 5, 10, 20, 40 minutes, capped at 6 hours. */
export function backoffMs(attempts: number): number {
  return Math.min(6 * 3_600_000, 5 * 60_000 * 2 ** Math.max(0, attempts - 1));
}

export function capReached(sentToday: number, cap: number): boolean {
  return sentToday >= cap;
}

export type RateDecision = { ok: true } | { ok: false; reason: "ip" | "email" };
export function rateLimit(ipAttemptsLastHour: number, emailAttemptsLastDay: number): RateDecision {
  if (ipAttemptsLastHour >= IP_LIMIT_PER_HOUR) return { ok: false, reason: "ip" };
  if (emailAttemptsLastDay >= EMAIL_LIMIT_PER_DAY) return { ok: false, reason: "email" };
  return { ok: true };
}

/** Maps a send error to a stored status. Sender not ready waits; throttles and transient errors retry; the rest fail after MAX_ATTEMPTS. */
export function classifySendError(err: { code?: string; status?: number; message?: string }, attempts: number): { status: EmailStatus; retry: boolean } {
  if (err.code === "recipient_suppressed") return { status: "suppressed", retry: false };
  if (err.code === "domain_not_verified" || err.code === "emails_disabled") return { status: "waiting_sender", retry: true };
  if (attempts >= MAX_ATTEMPTS) return { status: "failed", retry: false };
  return { status: err.status === 429 ? "queued" : "failed", retry: true };
}

export const approvalLink = (email: string, hasAccount: boolean) =>
  `${SITE_URL}/auth?${new URLSearchParams({ mode: hasAccount ? "signin" : "signup", email, redirect: "/app" })}`;
