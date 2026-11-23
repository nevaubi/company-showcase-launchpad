// The one check every stored `alt_data` row passes before anything shows it (pages, alerts, the
// daily brief, the research assistant, exports). Rows a collector stored under the wrong company
// (misattributed contract awards, look-alike FDA firms, trial sponsors and vehicle makers) and
// missing values stored as zero (FDIC) are removed. Pure.
import { contractRowBelongs, REFRESH_DATASET, type CompanyKeys } from "@/lib/alt/contracts";
import { firmRowBelongs, rowFirm } from "@/lib/alt/firms";
import { isBankPlaceholder } from "@/lib/alt/bank";

/** The fields of a stored row the screen reads. */
export interface ScreenRowLike {
  ticker: string;
  dataset: string;
  kind: string;
  meta?: unknown;
  title?: string | null;
  value?: number | null;
}

/** Columns a reader must select for the screen to judge its rows. */
export const SCREEN_COLUMNS = ["ticker", "dataset", "kind", "meta", "title", "value"] as const;

/** Whether the screen needs to know who the company is to judge this row. */
const needsKeys = (r: ScreenRowLike) => r.dataset === "contracts" || rowFirm(r) !== undefined;

/**
 * Rows that may be shown. `keysOf` returns who a ticker is (null when unknown: rows that need the
 * company's identity are then dropped, never guessed).
 */
export function screenAltRows<T extends ScreenRowLike>(rows: T[], keysOf: (ticker: string) => CompanyKeys | null): T[] {
  const cache = new Map<string, CompanyKeys | null>();
  const keys = (t: string) => {
    if (!cache.has(t)) cache.set(t, keysOf(t));
    return cache.get(t)!;
  };
  return rows.filter((r) => {
    if (r.dataset === REFRESH_DATASET) return false;
    if (r.dataset === "bank") return !isBankPlaceholder(r);
    if (!needsKeys(r)) return true;
    const k = keys(r.ticker);
    if (!k) return false;
    return r.dataset === "contracts" ? contractRowBelongs(r, k) : firmRowBelongs(r, r.ticker, k);
  });
}

/** Add the screen's columns to a select list ("dataset,date,title" → "dataset,date,title,ticker,kind,meta,value"). */
export function withScreenColumns(columns: string): string {
  const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.includes("*")) return "*";
  for (const c of SCREEN_COLUMNS) if (!cols.includes(c)) cols.push(c);
  return cols.join(",");
}

/** Datasets whose `alt_event_buckets` counts are recomputed from screened rows until the stored rows are repaired. */
export const BUCKET_RECOUNT = ["contracts", "fda", "trials"] as const;

export interface EventBucket {
  ticker: string;
  dataset: string;
  bucket: number;
  n: number;
  last_date: string | null;
}

/** Whole days from `a` to `b` (ISO dates, UTC). */
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/**
 * Event counts per company × dataset in 90-day windows back from `today`, the same buckets the
 * `alt_event_buckets` database function returns (bucket 0 = the last 90 days, up to 810 days back,
 * nothing dated after today).
 */
export function eventBuckets(rows: { ticker: string; dataset: string; date: string | null }[], today: string): EventBucket[] {
  const m = new Map<string, EventBucket>();
  for (const r of rows) {
    if (!r.date) continue;
    const age = days(r.date.slice(0, 10), today);
    if (age < 0 || age >= 810) continue;
    const bucket = Math.floor(age / 90);
    const k = `${r.ticker}|${r.dataset}|${bucket}`;
    const b = m.get(k) ?? { ticker: r.ticker, dataset: r.dataset, bucket, n: 0, last_date: null };
    b.n++;
    if (!b.last_date || r.date > b.last_date) b.last_date = r.date.slice(0, 10);
    m.set(k, b);
  }
  return [...m.values()];
}
