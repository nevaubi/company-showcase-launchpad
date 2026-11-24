// The cross-company feed of SEC filings (`sec_filings`, a rolling 60-day table): one filing day at
// a time, filtered by form family, sector, watchlist and words, with same-day bursts of insider
// forms from one company folded into one row so a day of 1,200 filings stays readable.
import { describeFiling, familyOf, formName, type FilingFamily } from "./kinds";

export interface FeedFiling {
  accn: string;
  ticker: string;
  cik: string;
  form: string;
  filed: string;
  report: string | null;
  items: string | null;
  doc: string;
  description: string | null;
}

export const FEED_COLUMNS = "accn, ticker, cik, form, filed, report, items, doc, description";

export type FeedFamily = "all" | Exclude<FilingFamily, "correspondence">;

export interface FeedScope {
  family: FeedFamily;
  sector: string;
  watch: boolean;
  q: string;
}

/** Forms that arrive in bursts (one company's officers filing the same day) and fold into one row. */
const BURST = /^(3|4|5|144)(\/A)?$/i;

export interface FeedRow {
  key: string;
  ticker: string;
  form: string;
  family: FilingFamily;
  title: string;
  detail: string | null;
  /** Filings in the row, newest accession first; one unless an insider-form burst was folded. */
  filings: FeedFiling[];
}

/** Rows for one day: each filing, except same-company same-form insider bursts, which fold into one row. */
export function feedRows(rows: FeedFiling[]): FeedRow[] {
  const out: FeedRow[] = [];
  const burst = new Map<string, FeedRow>();
  const sorted = [...rows].sort((a, b) => b.filed.localeCompare(a.filed) || a.ticker.localeCompare(b.ticker) || b.accn.localeCompare(a.accn));
  for (const f of sorted) {
    const form = f.form.toUpperCase();
    if (BURST.test(form)) {
      const k = `${f.filed}|${f.ticker}|${form}`;
      const row = burst.get(k);
      if (row) {
        row.filings.push(f);
        continue;
      }
      const r: FeedRow = { key: k, ticker: f.ticker, form: f.form, family: familyOf(form), title: formName(form), detail: null, filings: [f] };
      burst.set(k, r);
      out.push(r);
      continue;
    }
    const d = describeFiling({ form: f.form, items: f.items, desc: f.description });
    out.push({ key: f.accn, ticker: f.ticker, form: f.form, family: familyOf(form), title: d.title, detail: d.detail, filings: [f] });
  }
  for (const r of out) if (r.filings.length > 1) r.title = `${formName(r.form)} · ${r.filings.length} filings`;
  return out;
}

/** Rows that pass the filters. `sectorOf` and `nameOf` come from coverage. */
export function filterFeed(rows: FeedRow[], s: FeedScope, sectorOf: (t: string) => string | undefined, nameOf: (t: string) => string | undefined, watched: Set<string>): FeedRow[] {
  const terms = s.q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (s.family !== "all" && r.family !== s.family) return false;
    if (s.sector !== "all" && sectorOf(r.ticker) !== s.sector) return false;
    if (s.watch && !watched.has(r.ticker)) return false;
    if (!terms.length) return true;
    const text = [r.ticker, nameOf(r.ticker), r.form, r.title, r.detail, ...r.filings.map((f) => f.items)].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => (t === r.ticker.toLowerCase() ? true : text.includes(t)));
  });
}

/** Rows per family, for the family control's counts. */
export function familyCounts(rows: FeedRow[]): Record<FeedFamily, number> {
  const out: Record<FeedFamily, number> = { all: rows.length, periodic: 0, current: 0, ownership: 0, proxy: 0, offerings: 0, other: 0 };
  for (const r of rows) {
    const f = r.family === "correspondence" ? "other" : r.family;
    out[f]++;
  }
  return out;
}

/** Order within a day: periodic reports and 8-Ks first (what moves a view), then the rest; by ticker within each. */
const RANK: Record<FilingFamily, number> = { periodic: 0, current: 1, proxy: 2, offerings: 3, ownership: 4, correspondence: 5, other: 6 };
export const byImportance = (a: FeedRow, b: FeedRow) => RANK[a.family] - RANK[b.family] || a.ticker.localeCompare(b.ticker) || a.key.localeCompare(b.key);

/** The archive URL of a filing's index page (under the CIK the filing was listed under). */
export const indexUrl = (cik: string, accn: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${accn}-index.htm`;
