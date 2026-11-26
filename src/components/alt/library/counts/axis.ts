/**
 * The count axis, pure: clean steps from zero and tick labels in full under 10,000, compact on an axis that reaches
 * it (0 / 10K / 20K), one style per axis. Counts are whole numbers, so a step is never below 1.
 */

/** Ticks from 0 to the first clean value at or above `max`: about `count` steps of 1, 2, 2.5 or 5 times a power of ten. */
export function countTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, ([1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power));
  // 2.5 below a power of ten of 10 would give fractions of a record
  const whole = Number.isInteger(step) ? step : Math.ceil(step);
  const top = Math.ceil(max / whole) * whole;
  const out: number[] = [];
  for (let v = 0; v <= top + whole / 2; v += whole) out.push(Math.round(v));
  return out;
}

const trim = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ""));

/** A tick label in the axis's one style. */
export function axisLabel(value: number, top: number): string {
  if (top < 10_000) return value.toLocaleString("en-US");
  if (top < 1_000_000) return value === 0 ? "0" : `${trim(value / 1000)}K`;
  if (top < 1_000_000_000) return value === 0 ? "0" : `${trim(value / 1_000_000)}M`;
  return value === 0 ? "0" : `${trim(value / 1_000_000_000)}B`;
}

/** Width in pixels the longest label of an axis needs at 11 px (tabular figures, about 6.6 px a character). */
export function labelWidth(labels: readonly string[]): number {
  return Math.ceil(Math.max(1, ...labels.map((l) => l.length)) * 6.6) + 6;
}
