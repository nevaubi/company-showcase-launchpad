// Joins the nightly price bundle with the official daily bars stored since it was built.
//
// Two things can be wrong at the seam. The bundle's adjusted closes are as of its build date while
// `market_bars` rows are adjusted as of a later date, so a dividend or split in between leaves a step.
// And the bundle's last bar can be a mid-session snapshot (the pipeline ran before the close), which
// must not beat the official bar for that day. The day both sources hold settles both: its official
// row replaces the bundle's bar, and the two sources' adjustment factors there (adjusted close over
// close, which does not depend on the price level) put every later row on the bundle's basis.
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

const factor = (adj: number | null | undefined, close: number | null | undefined): number | null =>
  adj != null && close != null && Number.isFinite(adj) && Number.isFinite(close) && adj > 0 && close > 0 ? adj / close : null;

/**
 * The bundle's bars with the official rows merged in: the bundle's last day takes its official row when
 * `rows` holds one, and every later row is appended with its adjusted close on the bundle's basis.
 * Returns the same array when `rows` adds nothing. Without a row for the bundle's last day the stored
 * adjusted closes are used as they are; a row without an adjusted close takes its close on the bundle's
 * own factor.
 */
export function mergeStoredBars(bundle: Bar[], rows: StoredBar[]): Bar[] {
  const lastBar = bundle.at(-1);
  const last = lastBar?.[0] ?? "";
  const later = rows.filter((r) => r.date > last).sort((x, y) => x.date.localeCompare(y.date));
  const anchor = lastBar ? rows.find((r) => r.date === last) : undefined;
  if (!later.length && !anchor) return bundle;

  // The bundle's own adjustment factor on its last day; 1 when it cannot be read (or the bundle is empty).
  const fb = (lastBar && factor(lastBar[5], lastBar[4])) ?? 1;
  const fs = anchor ? factor(anchor.adj_close, anchor.close) : null;
  const k = fs != null ? fb / fs : 1;

  const head = anchor && lastBar
    ? [...bundle.slice(0, -1), [last, anchor.open ?? anchor.close, anchor.high ?? anchor.close, anchor.low ?? anchor.close, anchor.close, anchor.close * fb, Number(anchor.volume ?? lastBar[6] ?? 0)] as Bar]
    : bundle;
  const tail = later.map((r): Bar => [
    r.date,
    r.open ?? r.close,
    r.high ?? r.close,
    r.low ?? r.close,
    r.close,
    r.adj_close != null && Number.isFinite(r.adj_close) && r.adj_close > 0 ? r.adj_close * k : r.close * (anchor ? fb : 1),
    Number(r.volume ?? 0),
  ]);
  return [...head, ...tail];
}
