// Screener fields read from the daily setup engine's per-company series (`setup_series`), which the
// scheduled `setups` job rewrites every trading day for every company with price history. They add what
// screener.json does not carry (traded value and short-sale volume) and are fresher than its weekly
// rebuild. Pure: the server function in series.functions.ts only selects the stored columns.
import type { FieldDef, Row } from "./engine";

/** The `setup_series` columns the screener reads (no close arrays, nothing it does not show). */
export const SERIES_COLUMNS = ["ticker", "end_date", "dv20", "short5"] as const;

/** One stored `setup_series` row, the columns in SERIES_COLUMNS. */
export interface SeriesRow {
  ticker: string;
  end_date: string;
  dv20: number | null;
  short5: number | null;
}

const SRC = "Daily bars and FINRA daily short-sale volume, through the setup engine (setup_series), updated each trading day";

/** Field definitions in the screener catalogue's format, so filters, sort, columns and CSV treat them like any other field. */
export const SERIES_FIELDS: FieldDef[] = [
  {
    id: "dv20",
    g: "px",
    n: "Dollar volume 20d",
    u: "usd",
    d: "Average daily traded value (adjusted close × shares traded) over the last 20 sessions. A liquidity measure: how much can change hands in a day. Read shortly after the close, so it can run a few percent below the final figures.",
    src: SRC,
  },
  {
    id: "short_vol5",
    g: "act",
    n: "Short volume share 5d",
    u: "pct",
    d: "Average of the daily FINRA short-sale ratio (short volume ÷ volume reported to FINRA, off-exchange trades) over the latest five sessions with a published file. Most companies are scanned before FINRA publishes the latest session, so their value covers the four sessions before the as-of date. Includes market-maker hedging, so read it against the company's own history and its peers.",
    src: SRC,
  },
];
export const SERIES_FIELD_IDS = new Set(SERIES_FIELDS.map((f) => f.id));

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : null);

/** Adds the series fields to a screener row. Values are copied as stored; out-of-range values are dropped. */
export function withSeries(r: Row, s: SeriesRow | undefined): Row {
  if (!s) return r;
  const dv = fin(s.dv20);
  const sh = fin(s.short5);
  return {
    ...r,
    dv20: dv != null && dv > 0 ? dv : null,
    short_vol5: sh != null && sh >= 0 && sh <= 1 ? sh : null,
    series_asof: s.end_date,
  };
}

/** Newest end date among the rows (the feed's as-of), or null. */
export function seriesAsOf(rows: Pick<SeriesRow, "end_date">[]): string | null {
  let best: string | null = null;
  for (const r of rows) if (r.end_date && (!best || r.end_date > best)) best = r.end_date;
  return best;
}

/** Oldest and newest series date (rows are scanned on different days, so the header states a range when they differ). */
export function seriesRange(rows: Pick<SeriesRow, "end_date">[]): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const r of rows) {
    if (!r.end_date) continue;
    if (!from || r.end_date < from) from = r.end_date;
    if (!to || r.end_date > to) to = r.end_date;
  }
  return from && to ? { from, to } : null;
}
