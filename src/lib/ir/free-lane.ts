/**
 * OpenRouter free-model lane: pure budget and rotation rules (no I/O), shared by the server lane and tests.
 * One account, inside OpenRouter's published free limits — never rotate keys or accounts to get past them.
 */
/** Free models that support structured outputs, best first (checked against OpenRouter's model list). */
export const FREE_MODELS = (process.env["IR_FREE_MODELS"] || "nvidia/nemotron-3.5-super-vl:free,inclusionai/ling-3.2-flash:free")
  .split(",").map((s) => s.trim()).filter(Boolean);

/** OpenRouter: ~1,000 free requests/day once $10 credit was ever bought (50 without), ~20/min. Stay under. */
export const FREE_DAILY_CAP = Number(process.env["IR_FREE_DAILY_CAP"] || 950);
export const FREE_PER_MINUTE = 18;
export const FAILS_TO_REST = 2;
export const REST_MS = 3_600_000;

export type ModelHealth = Record<string, { fails: number; restUntil: number }>;

/** First model in list order that isn't resting; null when all are. */
export function pickModel(models: string[], health: ModelHealth, now: number): string | null {
  return models.find((m) => (health[m]?.restUntil ?? 0) <= now) ?? null;
}

/** Record one result: two failures in a row rest the model for an hour; a success clears it. */
export function recordResult(health: ModelHealth, model: string, ok: boolean, now: number): ModelHealth {
  if (ok) return { ...health, [model]: { fails: 0, restUntil: 0 } };
  const fails = (health[model]?.fails ?? 0) + 1;
  return { ...health, [model]: fails >= FAILS_TO_REST ? { fails: 0, restUntil: now + REST_MS } : { fails, restUntil: 0 } };
}

/** Whether one more request fits today's and this minute's budget. */
export function canSpend(usedToday: number, recentMinute: number[], now: number, cap = FREE_DAILY_CAP): boolean {
  return usedToday < cap && recentMinute.filter((t) => now - t < 60_000).length < FREE_PER_MINUTE;
}
