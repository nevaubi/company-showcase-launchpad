// Joins the nightly price bundle with the bars stored since it was built, on one adjusted basis.
// The bundle's adjusted closes are as of its build date; `market_bars` rows are adjusted as of a later
// date, so a dividend or split in between leaves a step at the seam. The bar both sources hold (the
// bundle's last day) gives the ratio that puts the stored rows on the bundle's basis.
import type { Bar } from "@/lib/financials/types";

export interface StoredBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adj_close: number | null;
  volume: number | null;
}

/**
 * Bars after the bundle's last day, with adjusted closes rebased onto the bundle. `rows` may include the
 * bundle's last day (the anchor); without it, or when either adjusted close there is missing or not
 * positive, the stored adjusted closes are used as they are.
 */
export function appendStoredBars(bundle: Bar[], rows: StoredBar[]): Bar[] {
  const lastBar = bundle.at(-1);
  const last = lastBar?.[0] ?? "";
  const anchor = rows.find((r) => r.date === last);
  const a = anchor?.adj_close ?? null;
  const b = lastBar?.[5] ?? null;
  const k = a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? b / a : 1;
  return rows
    .filter((r) => r.date > last)
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((r): Bar => [r.date, r.open ?? r.close, r.high ?? r.close, r.low ?? r.close, r.close, (r.adj_close ?? r.close) * k, Number(r.volume ?? 0)]);
}
