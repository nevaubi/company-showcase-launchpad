// Paid OpenAI balance empty (credit_balance_exhausted): readers move to the owner's free lane instead
// of pausing for a person. The paid path is skipped for 30 minutes after an exhaustion, then retried;
// while the `provider:openai-paid` circuit is open the paid call fails fast (no HTTP) and lands here too.
import { OpenAIError } from "@/lib/openai.server";

export const PAID_REST_MS = 30 * 60_000;
let paidOffUntil = 0;
export const resetPaidRest = () => { paidOffUntil = 0; };

export const isCreditExhausted = (e: unknown) =>
  e instanceof OpenAIError && e.kind === "quota" && (/credit_balance_exhausted|no credits remaining|insufficient_quota/i.test(e.message) || (e.provider === "openai-paid" && e.status === 0));

export async function paidOrLane<T>(paid: () => Promise<T>, lane: () => Promise<T | null>, now = Date.now): Promise<T> {
  if (now() < paidOffUntil) {
    const r = await lane();
    if (r) return r;
    throw new OpenAIError("OpenAI credit balance exhausted and the free lane is spent for today", "quota", 429);
  }
  try {
    return await paid();
  } catch (e) {
    if (!isCreditExhausted(e)) throw e;
    paidOffUntil = now() + PAID_REST_MS;
    const r = await lane();
    if (r) return r;
    throw e;
  }
}
