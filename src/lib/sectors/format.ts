// One number style for the three sector pages: one decimal for percentages and multiples, a true minus
// sign, a sign on changes and returns, and a quiet en dash for anything missing.

export const MISSING = "–";
const MINUS = "−";

const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** A fraction as a percentage: 0.047 → "4.7%"; `sign` adds "+" to positives (returns, changes). */
export function pct(v: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string {
  if (!ok(v)) return MISSING;
  const d = opts.digits ?? 1;
  const x = v * 100;
  const body = Math.abs(x).toFixed(d);
  if (Number(body) === 0) return `${(0).toFixed(d)}%`;
  return `${x < 0 ? MINUS : opts.sign ? "+" : ""}${body}%`;
}

/** A multiple: 23.14 → "23.1×". */
export function mult(v: number | null | undefined): string {
  if (!ok(v)) return MISSING;
  return `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}×`;
}

/** Dollars at a readable scale: "$4.62T", "$946.4B", "$613M", "$48K". */
export function usd(v: number | null | undefined): string {
  if (!ok(v)) return MISSING;
  const a = Math.abs(v);
  const s = v < 0 ? MINUS : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

/** A change in percentage points of a fraction: 0.012 → "+1.2 pt". */
export function pts(v: number | null | undefined): string {
  if (!ok(v)) return MISSING;
  const body = Math.abs(v * 100).toFixed(1);
  return `${v < 0 ? MINUS : "+"}${body} pt`;
}

/** A plain ratio such as a beta or a correlation: 1.084 → "1.08", −0.3 → "−0.30". */
export function ratio(v: number | null | undefined, digits = 2): string {
  if (!ok(v)) return MISSING;
  const body = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(body) !== 0 ? MINUS : ""}${body}`;
}

/** Whole count with thousands separators. */
export const count = (v: number | null | undefined) => (ok(v) ? Math.round(v).toLocaleString("en-US") : MISSING);

/** Tone class for a signed value: positive and negative tokens, nothing for zero or missing. */
export function tone(v: number | null | undefined): string {
  return !ok(v) || v === 0 ? "" : v > 0 ? "text-positive" : "text-negative";
}

export type Unit = "pct" | "x" | "usd" | "ret";

/** Format by unit: "ret" is a signed percentage. */
export function byUnit(v: number | null | undefined, unit: Unit): string {
  return unit === "pct" ? pct(v) : unit === "ret" ? pct(v, { sign: true }) : unit === "x" ? mult(v) : usd(v);
}

/** A correlation printed × 100 as a whole number with a true minus ("−16"), the quiet en dash when missing. */
export function corr100(v: number | null | undefined): string {
  if (!ok(v)) return MISSING;
  const n = Math.round(v * 100);
  return n < 0 ? `−${-n}` : String(n);
}
