// How this view prints numbers. One convention per column, the unit stated once in the column head,
// a true minus sign, a quiet en dash for a value the file does not state.
import { fmtCompactUsd, fmtDate } from "@/lib/format";

export const DASH = "–";
const MINUS = "−";

const grouped = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const G0 = grouped(0);
const G1 = grouped(1);
const G2 = grouped(2);

const signed = (v: number, body: string) => (v < 0 && /[1-9]/.test(body) ? `${MINUS}${body}` : body);

/** A count, grouped by thousands. */
export function count(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? DASH : signed(v, G0.format(Math.abs(v)));
}

/** Dollars in millions with one decimal, for a column headed "$M". */
export function usdM(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? DASH : signed(v, G1.format(Math.abs(v) / 1e6));
}

/** Dollars in thousands, no decimals, for a column headed "$K". */
export function usdK(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? DASH : signed(v, G0.format(Math.abs(v) / 1e3));
}

/** Dollars in full with cents, for a hover or a definitions line. */
export function usdFull(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const body = G2.format(Math.abs(v));
  return `${v < 0 && /[1-9]/.test(body) ? MINUS : ""}$${body}`;
}

/** Dollars, compact with a unit letter ("$636.3M"), for a stat or a sentence. */
export const usdCompact = (v: number | null | undefined, digits = 1): string =>
  fmtCompactUsd(v, digits);

/** A fraction as percent points with `digits` decimals and no sign, for a column headed "%". */
export function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const body = (Math.abs(v) * 100).toFixed(digits);
  return signed(v, body);
}

/** The same with the percent sign, for a sentence or a stat. */
export const pctSign = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v) ? DASH : `${pct(v, digits)}%`;

/** A change of a share in percentage points, always signed ("+0.21", "−0.05"). */
export function points(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const body = (Math.abs(v) * 100).toFixed(digits);
  if (!/[1-9]/.test(body)) return body;
  return `${v > 0 ? "+" : MINUS}${body}`;
}

/** A plain number with fixed decimals (a score, a term in months, a ratio). */
export function fixed(v: number | null | undefined, digits: number): string {
  return v == null || !Number.isFinite(v) ? DASH : signed(v, Math.abs(v).toFixed(digits));
}

/**
 * A value whose scale is the filer's own (a rate written 0.0489 by one file and 4.89 by another):
 * printed in the scale it was filed in, to four decimals, never converted.
 */
export function asFiled(v: number | string | null | undefined, digits = 4): string {
  if (v == null || v === "") return DASH;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? signed(n, Math.abs(n).toFixed(digits)) : DASH;
}

/** A stored text exactly as stored, for a value shown "as written by the filer". */
export const asWritten = (text: string | null | undefined): string => (text ? text : DASH);

/** Bytes as a file size. */
export function bytes(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** A calendar date ("Sep 30, 2026"); a dash when absent. */
export const day = (iso: string | null | undefined): string => (iso ? fmtDate(iso.slice(0, 10)) : DASH);

/** Month and year of a period end ("Sep 2026"), for a chart axis. */
export const monthYear = (iso: string | null | undefined): string =>
  iso ? fmtDate(iso.slice(0, 10), { month: "short", year: "numeric" }) : DASH;

/** A SHA-256 shortened to its first twelve characters; the whole value belongs in a hover. */
export const shortHash = (sha: string | null | undefined): string => (sha ? sha.slice(0, 12) : DASH);
