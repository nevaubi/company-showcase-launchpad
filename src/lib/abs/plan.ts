// Which filings one run stores, decided from what the store already holds. Pure, so the rules that
// make a rerun a no-op and a cut-off run resumable are tested without a database.

export type FilingState = {
  accession: string;
  form: string;
  /** YYYY-MM-DD */
  filed: string;
  status: "listed" | "loaded" | "skipped" | "failed";
  attempts: number;
  is_current: boolean;
  /** reader version and source hash of the committed load; null when nothing is stored */
  parser: string | null;
  sha256: string | null;
  /**
   * Why the filing is skipped or failed (`abs_filings.status_detail`). `abs_filing_states` returns it
   * from migration 0069 on; before that it is absent, and a skipped filing is then never read again.
   */
  detail?: string | null;
};

/**
 * A filing the scheduled job set aside only because its asset file is over the job's size limit
 * (`src/lib/jobs/abs-ee.server.ts`): the script reads files of any size, so it may store it. Every
 * other skip ("no EX-102 asset data file", "unsupported", a header that "does not establish" one
 * issuing entity) is permanent for this reader and is never read again.
 */
export const sizeSkip = (detail: string | null | undefined): boolean =>
  typeof detail === "string" && detail.startsWith("asset file of") && detail.includes("over the scheduled run's limit");

export type PlanOptions = {
  parser: string;
  /** at most this many filings in one run */
  maxFilings: number;
  /** a filing that failed this many times is left alone until someone looks at it */
  maxAttempts: number;
  /** also store again the filings an older reader version stored */
  reparse?: boolean;
  /** also store the filings the scheduled job set aside for size (`sizeSkip`); no other skip */
  retrySkipped?: boolean;
  /**
   * Plan only the filings given up after `maxAttempts` (recovery after an outage), oldest first. Listed
   * filings are left out, so such a run never reads a filing the worker's own runs would plan.
   */
  retryFailed?: boolean;
  /** only filings filed in this range (inclusive, YYYY-MM-DD) */
  from?: string;
  to?: string;
};

export type Plan = {
  /** accessions to store now, oldest filing first */
  todo: string[];
  /** in range and still to do after this run */
  left: number;
  loaded: number;
  /** stored by an older reader version (stored again only with `reparse`) */
  stale: number;
  skipped: number;
  /** failed too often to be tried again */
  givenUp: number;
  /** the accessions of `givenUp`, oldest first */
  givenUpList: string[];
  /** filings not yet stored that are outside `from`..`to`: listed, but no backlog of these runs */
  outOfRange: number;
};

/**
 * Oldest first, so a deal's history fills in order and an amendment is stored after the filing it
 * amends. A filing already stored by this reader version is never planned: running again does nothing.
 */
export function planLoads(states: FilingState[], o: PlanOptions): Plan {
  const within = (s: FilingState) => (!o.from || s.filed >= o.from) && (!o.to || s.filed <= o.to);
  const outOfRange = states.filter((s) => !within(s) && s.status !== "loaded").length;
  const inRange = states
    .filter(within)
    .sort((a, b) =>
      a.filed < b.filed
        ? -1
        : a.filed > b.filed
          ? 1
          : a.accession < b.accession
            ? -1
            : a.accession > b.accession
              ? 1
              : 0,
    );
  const want: string[] = [];
  const givenUpList: string[] = [];
  let loaded = 0;
  let stale = 0;
  let skipped = 0;
  for (const s of inRange) {
    if (s.status === "loaded") {
      loaded++;
      if (s.parser !== o.parser) {
        stale++;
        if (o.reparse && !o.retryFailed) want.push(s.accession);
      }
    } else if (s.status === "skipped") {
      if (o.retrySkipped && !o.retryFailed && sizeSkip(s.detail)) want.push(s.accession);
      else skipped++;
    } else if (s.status === "failed" && s.attempts >= o.maxAttempts) {
      givenUpList.push(s.accession);
      if (o.retryFailed) want.push(s.accession);
    } else if (!o.retryFailed) want.push(s.accession);
  }
  const todo = want.slice(0, Math.max(0, o.maxFilings));
  return { todo, left: want.length - todo.length, loaded, stale, skipped, givenUp: givenUpList.length, givenUpList, outOfRange };
}
