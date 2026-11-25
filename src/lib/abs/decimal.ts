// Exact decimal arithmetic on the numbers an asset file states. Pool totals and weighted averages are
// computed on integers, so the same file gives the same figure on every run and on every machine;
// a float sum of two hundred thousand balances does not.

/** A decimal as an integer `v` scaled by ten to the `s`: 1.25 is { v: 125n, s: 2 }. */
export type Dec = { v: bigint; s: number };

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** True for a plain decimal number as the files write them ("115000000.00000000", ".03486", "-12"). */
export const isDecimal = (text: string) => NUM.test(text);

/** Reads a plain decimal; null for anything else (blank, "N/A", "1,234", exponent notation). */
export function dec(text: string): Dec | null {
  if (!NUM.test(text)) return null;
  const neg = text[0] === "-";
  const body = text[0] === "-" || text[0] === "+" ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const int = dot < 0 ? body : body.slice(0, dot);
  const frac = dot < 0 ? "" : body.slice(dot + 1);
  const v = BigInt((int || "0") + frac);
  return { v: neg ? -v : v, s: frac.length };
}

export const ZERO: Dec = { v: 0n, s: 0 };

const lift = (a: Dec, s: number) => (a.s === s ? a.v : a.v * 10n ** BigInt(s - a.s));

export function add(a: Dec, b: Dec): Dec {
  const s = Math.max(a.s, b.s);
  return { v: lift(a, s) + lift(b, s), s };
}

export const mul = (a: Dec, b: Dec): Dec => ({ v: a.v * b.v, s: a.s + b.s });

/** a ÷ b to `scale` decimal places, half away from zero; null when b is zero. */
export function div(a: Dec, b: Dec, scale: number): Dec | null {
  if (b.v === 0n) return null;
  // a.v / 10^a.s ÷ (b.v / 10^b.s) = a.v × 10^(b.s + scale) ÷ (b.v × 10^a.s), in units of 10^-scale
  const num = a.v * 10n ** BigInt(b.s + scale);
  const den = b.v * 10n ** BigInt(a.s);
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (2n * n + d) / (2n * d);
  return { v: neg ? -q : q, s: scale };
}

export const isZero = (a: Dec) => a.v === 0n;
export const cmp = (a: Dec, b: Dec) => {
  const s = Math.max(a.s, b.s);
  const x = lift(a, s);
  const y = lift(b, s);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Shortest plain form: trailing zeros of the fraction are dropped ("115000000", "0.03486"). */
export function fmt(a: Dec): string {
  const neg = a.v < 0n;
  const digits = (neg ? -a.v : a.v).toString().padStart(a.s + 1, "0");
  const int = digits.slice(0, digits.length - a.s);
  const frac = digits.slice(digits.length - a.s).replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return neg && a.v !== 0n ? `-${out}` : out;
}
