/**
 * Read receipts for supply-link extraction (pure). One row per filing read (`supply_scans`,
 * migration 0087) with the number of links it gave, also when it gave none: the coverage ledger
 * (src/lib/coverage/corpora.ts) tells "read, names nobody" from "not read yet" by it.
 */
export interface ScanFiling {
  accn: string;
  form: string;
  filed: string;
}
export interface ScanReceipt extends ScanFiling {
  ticker: string;
  links: number;
  scanned_at: string;
}

/** A receipt for each filing of the set that was read, counting the stored rows that cite it. */
export function scanReceipts(ticker: string, filings: readonly ScanFiling[], rows: readonly Record<string, unknown>[], at: string): ScanReceipt[] {
  return filings.map((f) => ({ ticker, accn: f.accn, form: f.form, filed: f.filed, links: rows.filter((r) => r["accn"] === f.accn).length, scanned_at: at }));
}
