// Member tape: each covered company's recent returns and trend flags from `setup_series` (written daily by
// the setups job for about 1,780 companies: ~300 closes, r5, r21, 60-day volatility, above the 200-day
// average, within 2% of the 52-week high). The server function in ./breadth.functions.ts reads the table
// and derives the longer returns with `returnsFromCloses`; the pages roll the rows up per sector or
// industry with `groupTape`. Pure, so tests and scripts reproduce every figure.
import { median, shareOf, type Share } from "./stats";

export interface MemberTape {
  tk: string;
  /** Returns over 5, 21, 63, 126 and 252 sessions, as fractions. */
  r5: number | null;
  r21: number | null;
  r63: number | null;
  r126: number | null;
  r252: number | null;
  /** Standard deviation of daily returns over 60 sessions. */
  vol60: number | null;
  above200: boolean | null;
  near_high: boolean | null;
}
export interface TapeFile {
  /** Session the newest rows describe. */
  asOf: string | null;
  rows: MemberTape[];
}

export const TAPE_WINDOWS = [
  { k: "r5", l: "1W", n: 5 },
  { k: "r21", l: "1M", n: 21 },
  { k: "r63", l: "3M", n: 63 },
  { k: "r126", l: "6M", n: 126 },
  { k: "r252", l: "1Y", n: 252 },
] as const;
export type TapeKey = (typeof TAPE_WINDOWS)[number]["k"];

/** Return over the last `n` sessions of a close series, or null when the series is shorter or a close is not positive. */
export function trailingReturn(c: readonly number[], n: number): number | null {
  const last = c.length - 1;
  if (last - n < 0) return null;
  const a = c[last - n];
  const b = c[last];
  if (!(a > 0) || !(b > 0)) return null;
  return b / a - 1;
}

/** The 3-, 6- and 12-month returns the table does not store, from its close series. */
export function returnsFromCloses(c: readonly number[]): Pick<MemberTape, "r63" | "r126" | "r252"> {
  return { r63: trailingReturn(c, 63), r126: trailingReturn(c, 126), r252: trailingReturn(c, 252) };
}

/** Rows describing a session more than `maxAgeDays` calendar days before the newest one are dropped (stale tickers). */
export function freshRows<T extends { end_date: string }>(rows: readonly T[], maxAgeDays = 7): { asOf: string | null; rows: T[] } {
  const asOf = rows.reduce<string | null>((m, r) => (m == null || r.end_date > m ? r.end_date : m), null);
  if (!asOf) return { asOf: null, rows: [] };
  const floor = new Date(Date.parse(`${asOf}T00:00:00Z`) - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
  return { asOf, rows: rows.filter((r) => r.end_date >= floor) };
}

export interface GroupTape {
  /** Members asked about. */
  members: number;
  /** Members with a row. */
  known: number;
  above200: Share;
  nearHigh: Share;
  /** Members up over the last month. */
  up1m: Share;
  /** Median member return per window. */
  med: Record<TapeKey, number | null>;
  /** Median daily volatility, annualised (× √252). */
  vol: number | null;
}

export const tapeIndex = (rows: readonly MemberTape[]) => new Map(rows.map((r) => [r.tk, r]));

/** Breadth and median returns of a group of tickers. */
export function groupTape(members: readonly string[], idx: ReadonlyMap<string, MemberTape>): GroupTape {
  const rows = members.map((t) => idx.get(t)).filter((r): r is MemberTape => !!r);
  const med = Object.fromEntries(TAPE_WINDOWS.map((w) => [w.k, median(rows.map((r) => r[w.k]))])) as Record<TapeKey, number | null>;
  const v = median(rows.map((r) => r.vol60));
  return {
    members: members.length,
    known: rows.length,
    above200: shareOf(rows.map((r) => r.above200)),
    nearHigh: shareOf(rows.map((r) => r.near_high)),
    up1m: shareOf(rows.map((r) => (r.r21 == null ? null : r.r21 > 0))),
    med,
    vol: v == null ? null : v * Math.sqrt(252),
  };
}
