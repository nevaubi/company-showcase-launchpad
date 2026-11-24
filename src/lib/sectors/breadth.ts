// Member tape: each covered company's trend flags and volatility from `setup_series` (written daily by the
// setups job for about 1,780 companies: above the 200-day average, within 2% of the 52-week high, standard
// deviation of daily returns over 60 sessions). The server function in ./breadth.functions.ts reads only
// those columns; the pages roll the rows up per sector or industry with `groupTape`. Pure, so tests and
// scripts reproduce every figure.
import { median, shareOf, type Share } from "./stats";

export interface MemberTape {
  tk: string;
  /** Sample standard deviation of daily returns over 60 sessions (not annualised). */
  vol60: number | null;
  above200: boolean | null;
  near_high: boolean | null;
}
export interface TapeFile {
  /** Newest session any row describes. */
  asOf: string | null;
  /** Rows that describe that session. The daily job rewrites the table over about two hours, so the rest are older. */
  atAsOf: number;
  /** Newest session among the other rows; null when every row is at `asOf`. */
  olderAsOf: string | null;
  rows: MemberTape[];
}

/** One stored row, as the server function reads it. */
export interface TapeRow {
  ticker: string;
  end_date: string;
  vol60: number | null;
  above200: boolean | null;
  near_high: boolean | null;
}

/** Rows describing a session more than `maxAgeDays` calendar days before the newest one are dropped (stale tickers). */
export function freshRows<T extends { end_date: string }>(rows: readonly T[], maxAgeDays = 7): { asOf: string | null; rows: T[] } {
  const asOf = rows.reduce<string | null>((m, r) => (m == null || r.end_date > m ? r.end_date : m), null);
  if (!asOf) return { asOf: null, rows: [] };
  const floor = new Date(Date.parse(`${asOf}T00:00:00Z`) - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
  return { asOf, rows: rows.filter((r) => r.end_date >= floor) };
}

const round = (v: number | null | undefined, d = 5) => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(d)));

/** The file the pages receive: fresh rows only, and how many of them describe the newest session. */
export function tapeFile(stored: readonly TapeRow[]): TapeFile {
  const fresh = freshRows(stored);
  const older = fresh.rows.filter((r) => r.end_date !== fresh.asOf);
  return {
    asOf: fresh.asOf,
    atAsOf: fresh.rows.length - older.length,
    olderAsOf: older.reduce<string | null>((m, r) => (m == null || r.end_date > m ? r.end_date : m), null),
    rows: fresh.rows.map((r) => ({ tk: r.ticker, vol60: round(r.vol60), above200: r.above200 ?? null, near_high: r.near_high ?? null })),
  };
}

/**
 * What "as of" may honestly say. While the daily job is part-way through the table the newest session
 * describes only some rows, so the count is stated instead of naming one date for all of them.
 */
export function tapeAsOf(f: Pick<TapeFile, "asOf" | "atAsOf" | "olderAsOf" | "rows">, fmt: (d: string) => string): string {
  if (!f.asOf) return "";
  const n = f.rows.length;
  if (f.atAsOf >= n || !f.olderAsOf) return `as of ${fmt(f.asOf)}`;
  return `as of ${fmt(f.asOf)} for ${f.atAsOf.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} companies, ${fmt(f.olderAsOf)} or earlier for the rest`;
}

export interface GroupTape {
  /** Members asked about. */
  members: number;
  /** Members with a row. */
  known: number;
  /** Members without a row: they count in no breadth figure. */
  noRow: number;
  above200: Share;
  nearHigh: Share;
  /** Median 60-day volatility of the members, annualised (× √252). */
  vol: number | null;
  /** Members whose volatility is known. */
  volKnown: number;
}

export const tapeIndex = (rows: readonly MemberTape[]) => new Map(rows.map((r) => [r.tk, r]));

/** Annualised volatility from a daily standard deviation. */
export const annualised = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v * Math.sqrt(252));

/** Breadth and median volatility of a group of tickers. The one rule: a member counts only through its own tape row. */
export function groupTape(members: readonly string[], idx: ReadonlyMap<string, MemberTape>): GroupTape {
  const rows = members.map((t) => idx.get(t)).filter((r): r is MemberTape => !!r);
  const vols = rows.map((r) => r.vol60).filter((v): v is number => v != null && Number.isFinite(v));
  return {
    members: members.length,
    known: rows.length,
    noRow: members.length - rows.length,
    above200: shareOf(rows.map((r) => r.above200)),
    nearHigh: shareOf(rows.map((r) => r.near_high)),
    vol: annualised(median(vols)),
    volKnown: vols.length,
  };
}
