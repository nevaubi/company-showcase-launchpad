/**
 * The owner's free daily OpenAI allowance for traffic shared with OpenAI (Nov 17): 1M tokens a day
 * across the large models, 10M across the small ones. Pure: tier lookup, token estimates, UTC day.
 * Only public investor-relations documents may go through this lane — shared traffic can be used
 * by OpenAI, so user files, chats and workspace data never do.
 */

export type FreeTier = "large" | "mini";

export const FREE_TIERS: Record<FreeTier, { cap: number; models: string[] }> = {
  large: { cap: 1_000_000, models: ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o", "o1", "o3"] },
  mini: { cap: 10_000_000, models: ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini", "o3-mini", "o4-mini"] },
};

/** Stop short of the cap: calls in flight are reserved by estimate and settled afterwards. */
export const FREE_SAFETY = 0.9;

/** The tier a model id draws on ("gpt-5.4-mini-2026-03-05" → mini), or null when it isn't free. */
export function tierOf(model: string): FreeTier | null {
  const base = model.replace(/^openai\//, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (FREE_TIERS.mini.models.includes(base)) return "mini";
  if (FREE_TIERS.large.models.includes(base)) return "large";
  return null;
}

/** A generous token estimate for one call, reserved before it runs (about 3.2 characters a token). */
export function estimateTokens(inputChars: number, maxOutput: number) {
  return Math.ceil(inputChars / 3.2) + Math.min(maxOutput, 12_000);
}

/** The allowance resets each UTC day. */
export const allowanceDay = (now = new Date()) => now.toISOString().slice(0, 10);

/** Tokens a finished call used against the allowance (input, including cached, plus output). */
export const usedTokens = (u: { input_tokens: number; output_tokens: number }) => u.input_tokens + u.output_tokens;
