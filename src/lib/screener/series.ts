// Screener fields read from the daily setup engine's per-company series (`setup_series`), which the
// scheduled `setups` job rewrites every trading day for every company with price history. They add what
// screener.json does not carry (traded value and short-sale volume) and are fresher than its weekly
// rebuild. Pure: the server function in series.functions.ts only selects the stored columns.
import type { FieldDef, Row } from "./engine";

/** One stored `setup_series` row, scalar columns only (the close arrays stay on the server). */
export interface SeriesRow {
  ticker: string;
  end_date: string;
  dv20: number | null;
  r5: number | null;
  r21: number | null;
  vol60: number | null;
  above200: boolean | null;
  near_high: boolean | null;
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
    d: "Average daily traded value (close × shares traded) over the last 20 sessions. A liquidity measure: how much can change hands in a day.",
    src: SRC,
  },
  {
    id: "short_vol5",
    g: "act",
    n: "Short volume share 5d",
    u: "pct",
    d: "Share of reported trading volume that was short sales (FINRA daily short-sale volume / total volume), averaged over the last five sessions. Includes market-maker hedging, so read it against the company's own history and its peers.",
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
