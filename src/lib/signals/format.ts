// Number and label formatting shared by the signals pages (setups, trade ideas, autopilots, paper
// portfolio): one decimal convention per kind of figure, a true minus sign, an en dash for missing.
import { coverageOf } from "@/lib/coverage";
import type { Grade, LiveVerdict } from "./evidence";

export const DASH = "–";

const signOf = (v: number, signed: boolean, shown: string) => (Number(shown) === 0 ? "" : v < 0 ? "−" : signed ? "+" : "");

/** A fraction as a percentage: `pct(0.0067)` is "+0.67%". */
export function pct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const s = (Math.abs(v) * 100).toFixed(digits);
  return `${signOf(v, signed, s)}${s}%`;
}

/** A plain number with a true minus sign: `num(-1.5, 2)` is "−1.50". */
export function num(v: number | null | undefined, digits = 2, signed = false): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const s = Math.abs(v).toFixed(digits);
  return `${signOf(v, signed, s)}${s}`;
}

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const count = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? DASH : int.format(v));

const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A share price: two decimals, three under a dollar fifty so penny stocks keep their last digit. */
export function price(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return v < 1.5 ? `$${v.toFixed(3)}` : `$${usd2.format(v)}`;
}

/** Dollars a day, compact: 44654400 is "$45M". */
export function usdCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`;
  return `$${a.toFixed(0)}`;
}

/** "Nov 20" (the year is in the page header's as-of date). Dates read as everywhere else in the app. */
export function dayShort(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric", month: "short" });
}

/** "Nov 20, 2026". */
export function dayLong(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

/** "Mar 2024" from a month key "2024-03". */
export function monthLabel(key: string): string {
  const d = new Date(`${key.slice(0, 7)}-15T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
}

export const sideLabel = (side: 1 | -1) => (side > 0 ? "Long" : "Short");

/** The covered company's short name, left out when it only repeats the symbol ("UPS UPS"). */
export function nameOf(ticker: string): string | undefined {
  const n = coverageOf(ticker)?.shortName;
  return n && n.toUpperCase() !== ticker.toUpperCase() ? n : undefined;
}

/** Holding period in trading days as people say it: 1 day, 5 days, 4 weeks. */
export const holdLabel = (h: number) => (h === 1 ? "1 day" : h >= 20 ? `${Math.round(h / 5)} weeks` : `${h} days`);

export const GRADE_LABEL: Record<Grade, string> = {
  proven: "Proven",
  candidate: "Candidate",
  watch: "Watch",
  probation: "Probation",
  unproven: "Not listed",
};

export const VERDICT_LABEL: Record<LiveVerdict, string> = {
  none: "No finished trades",
  short: "Too short to judge",
  "in line": "In line with the backtest",
  ahead: "Ahead of the backtest",
  behind: "Well below the backtest",
};

/** Round tick values inside [lo, hi]: steps of 1, 2 or 5 times a power of ten, about `target` intervals. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const mag = 10 ** Math.floor(Math.log10(span / target));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => span / s <= target + 1) ?? 10 * mag;
  const out: number[] = [];
  for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) out.push(i === 0 ? 0 : +(i * step).toPrecision(12));
  return out;
}
