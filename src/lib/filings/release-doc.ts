// Which document an earnings release row opens. Releases from the company record point at the
// 8-K's Exhibit 99.1; releases added from the live filing table point at the 8-K cover document,
// so for those the exhibit is looked up in the filing index before anything says "Exhibit 99.1".

export interface ReleaseLike {
  accn: string;
  doc: string;
  title: string;
}

/** True when the release's document is already the exhibit, not the 8-K's own primary document. */
export function releaseIsExhibit(r: ReleaseLike, filingDoc?: string | null): boolean {
  if (!r.doc) return false;
  if (filingDoc && r.doc === filingDoc) return false;
  // Rows added from the live table (financials/releases.ts) carry this title and the 8-K document.
  return !/\(Form 8-K, Item 2\.02\)$/.test(r.title);
}

/** The press release in a filing index: EX-99.1 first, then the first other EX-99 exhibit. */
export function pickReleaseExhibit(docs: { name: string; type: string; description?: string }[]): string | null {
  const ex = (re: RegExp) => docs.find((d) => re.test(d.type.trim()))?.name ?? null;
  return ex(/^EX-99\.1$/i) ?? ex(/^EX-99(\.0?1)?\b/i) ?? ex(/^EX-99/i);
}
