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
};

export type PlanOptions = {
  parser: string;
  /** at most this many filings in one run */
  maxFilings: number;
  /** a filing that failed this many times is left alone until someone looks at it */
  maxAttempts: number;
  /** also store again the filings an older reader version stored */
  reparse?: boolean;
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
};

/**
 * Oldest first, so a deal's history fills in order and an amendment is stored after the filing it
 * amends. A filing already stored by this reader version is never planned: running again does nothing.
 */
export function planLoads(states: FilingState[], o: PlanOptions): Plan {
  const inRange = states
    .filter((s) => (!o.from || s.filed >= o.from) && (!o.to || s.filed <= o.to))
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
  let loaded = 0;
  let stale = 0;
  let skipped = 0;
  let givenUp = 0;
  for (const s of inRange) {
    if (s.status === "loaded") {
      loaded++;
      if (s.parser !== o.parser) {
        stale++;
        if (o.reparse) want.push(s.accession);
      }
    } else if (s.status === "skipped") skipped++;
    else if (s.status === "failed" && s.attempts >= o.maxAttempts) givenUp++;
    else want.push(s.accession);
  }
  const todo = want.slice(0, Math.max(0, o.maxFilings));
  return { todo, left: want.length - todo.length, loaded, stale, skipped, givenUp };
}
