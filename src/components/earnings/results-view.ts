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
import type { Surprise } from "@/lib/estimates/core";
import type { ReadPeriod } from "@/lib/financials/extend";
import type { CompanyDataset, Filing, Period } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import type { Reaction } from "@/lib/markets/core";

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

/** The quarter after `p` in the same labelling ("Q3 FY26" to "Q4 FY26", "Q4 FY26" to "Q1 FY27"), or null without a fiscal quarter. */
export function nextQuarterLabel(p: Period): string | null {
  if (p.fy == null || p.fq == null || p.fq < 1 || p.fq > 4) return null;
  const fy = p.fq === 4 ? p.fy + 1 : p.fy;
  const fq = p.fq === 4 ? 1 : p.fq + 1;
  return `Q${fq} FY${String(fy).slice(2)}`;
}

/** The consensus and price figures of one quarter, named by that quarter. */
export interface QuarterFigures {
  label: string;
  surprise: Surprise | null;
  reaction: Reaction | null;
}

export interface LatestFigures {
  /** The quarter the Latest quarter table shows: its side tiles. */
  side: QuarterFigures;
  /** The newest release's figures when it reports a quarter the statements do not hold yet and has any; null otherwise. */
  release: QuarterFigures | null;
  /** Why two quarters' figures stand in one panel, when they do. */
  why: string | null;
}

/**
 * Which quarter each "EPS vs the Street" and 2-day reaction in the Latest quarter panel belongs to (p5-shots M1).
 * The side tiles always describe the table's quarter. When a newer release is pending (the read of its 10-Q/10-K
 * is under way or failed), its own figures are named by the quarter it reports: the next fiscal quarter when it
 * is the only release since, otherwise the quarter end the provider gives, otherwise "the newest release".
 */
export function latestFigures(cur: QuarterRecord, pending: PendingRelease | null): LatestFigures {
  const side: QuarterFigures = { label: cur.period.label, surprise: cur.surprise, reaction: cur.reaction };
  if (!pending || (!pending.surprise && !pending.reaction)) return { side, release: null, why: null };
  const next = pending.count === 1 ? nextQuarterLabel(cur.period) : null;
  const label = next ?? (pending.surprise?.quarter ? `the quarter ended ${day(pending.surprise.quarter)}` : "the newest release");
  const release: QuarterFigures = { label, surprise: pending.surprise, reaction: pending.reaction };
  const why = `The figures above are ${label}, from the newest release; the table and the tiles beside it are ${side.label}, the newest quarter in the filed statements.`;
  return { side, release, why };
}
