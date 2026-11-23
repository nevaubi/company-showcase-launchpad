/**
 * Which 10-K and 10-Q the filing-detail pass reads (pure). A company that changed registrant has two
 * submission indexes (XOM: 34088 holds the annual report filed in February, 2115436 the 10-Q filed in
 * November): the newest annual report across them, and the newest 10-Q filed after it, each read
 * under the CIK whose index lists it (an archive URL resolves only there). With one index this is the
 * pass's old rule: the first annual in the list and the first 10-Q before it.
 */
export interface IndexColumns {
  form: string[];
  filingDate: string[];
  accessionNumber: string[];
}
export interface Pick<S> {
  src: S;
  i: number;
}

export function pickDetailFilings<S extends { cik: string; r: IndexColumns }>(subs: readonly S[], isAnnual: (form: string) => boolean): { annual: Pick<S> | null; quarterly: Pick<S> | null } {
  let annual: Pick<S> | null = null;
  for (const s of subs) {
    const i = s.r.form.findIndex(isAnnual);
    if (i >= 0 && (!annual || s.r.filingDate[i] > annual.src.r.filingDate[annual.i])) annual = { src: s, i };
  }
  const after = annual ? annual.src.r.filingDate[annual.i] : "";
  let quarterly: Pick<S> | null = null;
  for (const s of subs) {
    const k = s.r.form.findIndex(isAnnual);
    const i = s.r.form.findIndex((f, j) => f === "10-Q" && (k < 0 || j < k) && s.r.filingDate[j] >= after);
    if (i >= 0 && (!quarterly || s.r.filingDate[i] > quarterly.src.r.filingDate[quarterly.i])) quarterly = { src: s, i };
  }
  return { annual, quarterly };
}
