// Number formatting for report facts. ASCII minus so the number checker can read figures back. Pure.
export function money(v: number): string {
  const s = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  if (a === 0) return "$0";
  return `${s}$${a.toFixed(2)}`;
}
export const perShare = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
export const pct = (v: number, signed = false) => `${signed && v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
export const mult = (v: number) => `${v.toFixed(1)}x`;
/** Percentage-point change written out (the checker reads the signed number). */
export const pp = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(1)} percentage points`;
