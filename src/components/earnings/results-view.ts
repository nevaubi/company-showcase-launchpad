// Which statements the Earnings tab's Results sections run on, and the one line that says so. Pure.
//
// The Overview and the Financials tab extend the served statements at view time with any 10-Q/10-K the
// scheduled build has not picked up (useFiledStatements, src/components/financials/currency.tsx). The
// Results tab reads the same hook (same query cache, so nothing is downloaded twice) and builds its
// quarter records from the extended dataset once the read has added a period, so its latest quarter is
// the one the rest of the company page shows. A column read at view time keeps its filing in
// `period.readFrom`; a quarter a 10-K adds is derived (the year less the first nine months).
import { statementView, type FiledLike, type StatementState } from "@/lib/company/currency-view";
import { pendingRelease, profitLine, quarterRecords, recentQuarters, type PendingRelease, type ProfitLine, type QuarterInputs, type QuarterRecord } from "@/lib/earnings/quarters";
import type { ReadPeriod } from "@/lib/financials/extend";
import type { CompanyDataset, Filing, Period } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";

export interface ResultsModel {
  state: StatementState;
  dataset: CompanyDataset;
  /** Every quarter, oldest first */
  records: QuarterRecord[];
  /** Up to twelve quarters with results, newest first */
  recent: QuarterRecord[];
  /** The quarter the Latest quarter section shows */
  latest: QuarterRecord | null;
  pending: PendingRelease | null;
  profit: ProfitLine;
  /** Filings being read, or read, at view time */
  reads: Filing[];
}

/** The filing a column was read from at view time, if it was. */
export const readFromOf = (p: Period | undefined): ReadPeriod["readFrom"] | undefined => (p as ReadPeriod | undefined)?.readFrom;

/** A 10-K states the year, so a quarter it adds is the year less the nine months the 10-Qs reported. */
export const isDerivedQuarter = (p: Period | undefined) => !!readFromOf(p)?.form.startsWith("10-K");

export function resultsModel(served: CompanyDataset, filed: FiledLike, plan: Filing[], inputs: Omit<QuarterInputs, "dataset"> = {}): ResultsModel {
  const view = statementView(served, filed, plan);
  const d = view.dataset;
  const records = quarterRecords({ ...inputs, dataset: d });
  const recent = recentQuarters(records, 12);
  const pending = pendingRelease(records, d.earningsReleases, inputs.reactions, inputs.surprises, d.filings);
  return { state: view.state, dataset: d, records, recent, latest: recent[0] ?? null, pending, profit: profitLine(d), reads: view.reads };
}

const day = (d: string) => fmtDate(d.slice(0, 10));
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The periodic reports among the filings being read (a release is never read for statements). */
const periodic = (reads: Filing[]) => reads.filter((f) => /^10-[KQ]/.test(f.form)).sort((a, b) => a.filed.localeCompare(b.filed));

/**
 * The line above the Results tables for each state of the view-time read, or null when the served
 * statements are current. Reading and failed name the newest report being read; extended names each
 * quarter the read added and says when it is derived.
 */
export function resultsReadNote(m: ResultsModel): string | null {
  if (m.state === "extended") {
    const added = m.records.filter((r) => readFromOf(r.period));
    if (!added.length) return null;
    const parts = added.map((r) => {
      const f = readFromOf(r.period)!;
      return `${r.period.label} is read at view time from the ${f.form} filed on ${day(f.filed)}`;
    });
    const derived = added.filter((r) => isDerivedQuarter(r.period)).map((r) => r.period.label);
    const tail = derived.length ? ` A 10-K states the full year, so ${list(derived)} ${derived.length === 1 ? "is" : "are"} derived: the year less the first nine months.` : "";
    return `${list(parts)}; the scheduled rebuild has not added ${added.length === 1 ? "it" : "them"} yet.${tail}`;
  }
  const reports = periodic(m.reads);
  const newest = reports.at(-1);
  if (!newest) return null;
  if (m.state === "reading") return `Reading the ${newest.form} filed on ${day(newest.filed)} from SEC.`;
  if (m.state === "failed") return `The ${newest.form} filed on ${day(newest.filed)} could not be read here; the scheduled rebuild will add it.`;
  return null;
}
