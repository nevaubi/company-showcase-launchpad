/**
 * Exact decimal arithmetic for tile figures. A stored cell such as "8.292398" is read as the integer
 * 8292398 with scale 6, so a change over a year or a share is computed from the digits the publisher
 * wrote, and rounded once, half away from zero, for display. Binary floating point is used only to
 * place marks on a chart, never for a printed figure.
 */

export type Decimal = { int: bigint; scale: number };

const PLAIN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** The exact value of a plain decimal cell, or null when the text is not one. */
export function parseDecimal(text: string): Decimal | null {
  const m = PLAIN.exec(text);
  if (!m) return null;
  const digits = `${m[2]}${m[3] ?? ""}`;
  let scale = (m[3] ?? "").length - (m[4] === undefined ? 0 : Number(m[4]));
  let int = BigInt(digits);
  if (scale < 0) {
    int *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (scale > 60) return null;
  return { int: m[1] === "-" ? -int : int, scale };
}

const pow10 = (n: number) => 10n ** BigInt(n);

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.int * pow10(scale - a.scale), b.int * pow10(scale - b.scale), scale];
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { int: x - y, scale };
}

/** numerator / denominator rounded half away from zero to an integer. The denominator is not zero. */
function divideRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

/** a / b x factor, rounded to `decimals` places. Null when b is zero. */
export function ratioDecimal(a: Decimal, b: Decimal, factor: number, decimals: number): Decimal | null {
  if (b.int === 0n) return null;
  // a / b = (a.int / 10^a.scale) / (b.int / 10^b.scale) = a.int * 10^b.scale / (b.int * 10^a.scale)
  const numerator = a.int * pow10(b.scale) * BigInt(factor) * pow10(decimals);
  const denominator = b.int * pow10(a.scale);
  return { int: divideRound(numerator, denominator), scale: decimals };
}

/** 100 x (a / b - 1), rounded to `decimals` places. Null when b is zero. */
export function percentChange(a: Decimal, b: Decimal, decimals: number): Decimal | null {
  if (b.int === 0n) return null;
  const difference = subtractDecimal(a, b);
  return ratioDecimal(difference, b, 100, decimals);
}

/** The value rounded half away from zero to `decimals` places (never adds digits the value lacks). */
export function roundDecimal(a: Decimal, decimals: number): Decimal {
  if (a.scale <= decimals) return a;
  return { int: divideRound(a.int, pow10(a.scale - decimals)), scale: decimals };
}

/** a × 10^k, exact: the decimal point moves, no digit is lost or added. */
export function shiftDecimal(a: Decimal, k: number): Decimal {
  if (k < 0) return { int: a.int, scale: a.scale - k };
  return a.scale >= k ? { int: a.int, scale: a.scale - k } : { int: a.int * pow10(k - a.scale), scale: 0 };
}

/** How many digits |a| has before the decimal point (0 when |a| < 1). */
export function integerDigits(a: Decimal): number {
  const whole = (a.int < 0n ? -a.int : a.int) / pow10(a.scale);
  return whole === 0n ? 0 : whole.toString().length;
}

export function isZero(a: Decimal): boolean {
  return a.int === 0n;
}

export function signOf(a: Decimal): -1 | 0 | 1 {
  return a.int < 0n ? -1 : a.int > 0n ? 1 : 0;
}

export function absDecimal(a: Decimal): Decimal {
  return a.int < 0n ? { int: -a.int, scale: a.scale } : a;
}

/** A float for placing a mark. Exact enough for a chart; never printed. */
export function toNumber(a: Decimal): number {
  return Number(a.int) / 10 ** a.scale;
}

export const MINUS = "−";

/**
 * The figure as text: digits grouped by three with commas, exactly `decimals` places when given
 * (the value is rounded first), otherwise the places it carries; a true minus sign.
 */
export function formatDecimal(a: Decimal, options?: { decimals?: number; grouping?: boolean; plus?: boolean }): string {
  const value = options?.decimals === undefined ? a : roundDecimal(a, options.decimals);
  const scale = options?.decimals === undefined ? value.scale : options.decimals;
  const widened = value.scale < scale ? value.int * pow10(scale - value.scale) : value.int;
  const negative = widened < 0n;
  const digits = (negative ? -widened : widened).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? digits.slice(digits.length - scale) : "";
  const grouped = options?.grouping === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? MINUS : options?.plus && widened > 0n ? "+" : "";
  return `${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
}
