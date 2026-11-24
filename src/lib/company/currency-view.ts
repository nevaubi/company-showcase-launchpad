// Which statements the Overview computes from, and which newer filings it still has to name. Pure.
//
// The Financials tab extends the served statements at view time with any 10-Q/10-K the scheduled
// build has not picked up (useFiledStatements, src/components/financials/currency.tsx). The Overview
// reads the same hook, so both pages share one query cache, and computes everything from the
// extended dataset once it is read. While the read runs the page shows the served figures; the
// "not yet included" list already leaves out the filings being read (the currency line names them),
// so the list does not shrink, and the panel does not change height, when the read lands. If the
// read fails, the list falls back to everything newer than the served statements.
import type { Extension } from "@/lib/financials/extend";
import type { CompanyDataset, Filing } from "@/lib/financials/types";
import { newerFilings, type NewerFiling } from "./staleness";

export type StatementState = "served" | "reading" | "extended" | "failed";

/** The part of useFiledStatements' result the selection needs. */
export interface FiledLike {
  extension: Extension | undefined;
  reading: boolean;
  failed: boolean;
}

export interface StatementView {
  /** What every financial computation on the page uses */
  dataset: CompanyDataset;
  state: StatementState;
  /** Filings being read, or read, at view time (oldest first) */
  reads: Filing[];
}

/**
 * The dataset the analysis runs on: the extended one once the read has added a period, the served
 * one otherwise (no read needed, still reading, read failed, or the filing added nothing).
 */
export function statementView(served: CompanyDataset, filed: FiledLike, plan: Filing[]): StatementView {
  if (filed.extension && filed.extension.added.length) return { dataset: filed.extension.dataset, state: "extended", reads: plan };
  if (!plan.length) return { dataset: served, state: "served", reads: [] };
  if (filed.failed) return { dataset: served, state: "failed", reads: plan };
  if (filed.reading) return { dataset: served, state: "reading", reads: plan };
  // read finished without adding a period: the filings stay "not yet included"
  return { dataset: served, state: "served", reads: [] };
}

const later = (a: string | null, b: string | undefined) => (!a ? (b ?? null) : b && b > a ? b : a);

/**
 * Newer filings the page should still list as not in its figures. `latestEnd` is the newest period
 * the page's analysis covers (quarter end, else fiscal year end) on `view.dataset`.
 * - extended: what is newer than the extended statements, less what the extension read;
 * - reading: what will remain once the planned filings are in (their period ends taken as covered),
 *   so the list does not change when the read lands;
 * - failed or served: everything newer than the served statements.
 */
export function stillMissing(view: StatementView, latestEnd: string | null, extension?: Extension): NewerFiling[] {
  const readAccns = new Set([...(extension?.added.map((a) => a.accn) ?? []), ...(view.state === "reading" ? view.reads.map((f) => f.accn) : [])]);
  let end = latestEnd;
  if (view.state === "reading") for (const f of view.reads) if (/^10-[KQ]/.test(f.form)) end = later(end, f.report);
  return newerFilings(view.dataset, end).filter((f) => !readAccns.has(f.accn));
}
