// Stage of a filing, by dates only. assemble.ts applies it to every filing it reads; the optional SQL
// view `abs_filing_periods` (round 4 part of migration 0069) states the same rule, and a test holds the
// two together on real filings.
//
// A filing dated to a period that had not ended when it was filed cannot be a report on that period:
// it describes a pool at a cut-off, made for an offering. Two clocks exist (../AGENTS.md): the period
// each record states and the cover period in the EDGAR header. Either one lying after the filing date
// marks the filing. An offering file dated to a past cut-off by both clocks is not recognised: nothing
// stored says more, and the page says so wherever it states the rule.

export type StageFacts = {
  /** filing date, YYYY-MM-DD */
  filed: string;
  /** end of the cover period in the EDGAR header */
  cover_end: string | null;
  /** latest period end the records state */
  records_end: string | null;
};

export type Stage = {
  offering: boolean;
  /** the records state a period end later than the filing date */
  recordsAfterFiling: boolean;
  /** the cover period in the EDGAR header ends after the filing date */
  coverAfterFiling: boolean;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** True when both are calendar dates and `a` is after `b`. ISO dates compare as text. */
const after = (a: string | null, b: string | null) =>
  a != null && b != null && ISO.test(a) && ISO.test(b) && a > b;

export function stageOf(f: StageFacts): Stage {
  const recordsAfterFiling = after(f.records_end, f.filed);
  const coverAfterFiling = after(f.cover_end, f.filed);
  return { offering: recordsAfterFiling || coverAfterFiling, recordsAfterFiling, coverAfterFiling };
}

export const STAGE_LABEL = "Pool at cut-off (offering)";

/** The rule in the page's words. */
export const STAGE_RULE =
  "A filing dated to a period that had not ended when it was filed describes a pool at a cut-off, made for an offering: either its records state a period end later than the filing date, or the cover period in its EDGAR header ends after the filing date. It is marked and kept out of trends and out of each deal's newest period.";

export const STAGE_LIMIT =
  "The stage is read from these dates only. An offering file dated to a past cut-off is not recognised and reads as a monthly file, so a deal's first stored file can be one.";

/** Why this filing is marked, for a hover. Empty for a filing that is not marked. */
export function stageReason(f: StageFacts): string {
  const s = stageOf(f);
  if (!s.offering) return "";
  const parts: string[] = [];
  if (s.recordsAfterFiling)
    parts.push(`its records state a period end of ${f.records_end}, after the filing date ${f.filed}`);
  if (s.coverAfterFiling)
    parts.push(
      `the cover period in its EDGAR header ends ${f.cover_end}, after the filing date ${f.filed}`,
    );
  return `Marked because ${parts.join(" and ")}.`;
}
