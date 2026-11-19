// Earnings releases known from SEC filings (8-K item 2.02) that the company dataset doesn't list yet,
// so report data versions and recaps key on the newest release as soon as the filing is discovered.
import type { CompanyDataset } from "./types";

export function withFiledReleases(d: CompanyDataset): CompanyDataset {
  const newest = d.earningsReleases.reduce((m, r) => (r.filed > m ? r.filed : m), "");
  const known = new Set(d.earningsReleases.map((r) => r.accn));
  const add = d.filings
    .filter((f) => /^8-K/.test(f.form) && /(^|,)\s*2\.02/.test(f.items ?? "") && !known.has(f.accn) && f.filed > newest)
    .sort((a, b) => b.filed.localeCompare(a.filed))
    .map((f) => ({ accn: f.accn, filed: f.filed, report: f.report, doc: f.doc, title: "Earnings release (Form 8-K, Item 2.02)" }));
  return add.length ? { ...d, earningsReleases: [...add, ...d.earningsReleases] } : d;
}
