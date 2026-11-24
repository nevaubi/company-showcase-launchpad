// What the statements do not hold yet. The financial analysis is computed from a dataset that is rebuilt on a
// schedule, so a 10-K or 10-Q filed since the last rebuild is listed among the filings before its figures are in the
// statements. The Overview says so next to the figures instead of leaving the reader to notice. Pure.
import type { CompanyDataset, Filing } from "@/lib/financials/types";

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export interface NewerFiling {
  accn: string;
  doc: string;
  form: string;
  filed: string;
  /** period the report covers, when the filing states one */
  report?: string;
  /** "report": a 10-K or 10-Q for a later period; "release": an earnings release for a later period */
  kind: "report" | "release";
}

/** A fiscal period end drifts a few days between filings (52/53-week years): closer than this is the same period. */
const SAME_PERIOD_DAYS = 10;
/** An earnings release comes out two to eight weeks after its quarter ends; later than this it reports the next one. */
const NEXT_QUARTER_DAYS = 75;

/**
 * Filings that report a period later than the newest one in the statements, newest first: 10-K and 10-Q reports by
 * their period end, and earnings releases (8-K item 2.02) filed late enough to belong to a later quarter.
 */
export function newerFilings(d: Pick<CompanyDataset, "filings" | "earningsReleases">, latestEnd: string | null): NewerFiling[] {
  if (!latestEnd) return [];
  const end = t(latestEnd);
  const out: NewerFiling[] = [];
  const seen = new Set<string>();
  const add = (f: Pick<Filing, "accn" | "doc" | "form" | "filed" | "report">, kind: NewerFiling["kind"]) => {
    if (seen.has(f.accn)) return;
    seen.add(f.accn);
    out.push({ accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, ...(f.report ? { report: f.report } : {}), kind });
  };
  for (const f of d.filings) {
    if ((f.form === "10-K" || f.form === "10-Q") && f.report && t(f.report) - end > SAME_PERIOD_DAYS * DAY) add(f, "report");
  }
  // a release counts only while its period's report is not already listed
  const reportFiled = out.map((f) => t(f.filed));
  for (const r of d.earningsReleases) {
    const filed = t(r.filed);
    if (filed - end <= NEXT_QUARTER_DAYS * DAY) continue;
    if (reportFiled.some((x) => Math.abs(x - filed) <= 45 * DAY)) continue;
    add({ accn: r.accn, doc: r.doc, form: "8-K", filed: r.filed, report: r.report }, "release");
  }
  return out.sort((a, b) => b.filed.localeCompare(a.filed));
}
