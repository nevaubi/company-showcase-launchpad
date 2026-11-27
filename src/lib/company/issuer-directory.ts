import { guardedSourceOf } from "../ir/source-guard";

// A present null is an explicit review decision. An absent field retains the normal profile fallback.
export interface ReviewedIssuerLinks { website?: string | null; ir?: string | null }

export function reviewedLinks(rows: { kind: string; status: string; url: string | null }[]): ReviewedIssuerLinks {
  const result: ReviewedIssuerLinks = {};
  for (const row of rows) {
    if (row.kind !== "website" && row.kind !== "ir") continue;
    if (row.status === "withheld") result[row.kind] = null;
    else if (row.status === "verified" && row.url?.startsWith("https://")) result[row.kind] = row.url;
  }
  return result;
}

export function issuerLink(
  links: ReviewedIssuerLinks | undefined,
  kind: keyof ReviewedIssuerLinks,
  ticker: string,
  ...fallbacks: (string | null | undefined)[]
): string | null {
  const reviewed = links?.[kind];
  const options = reviewed === undefined ? fallbacks : [reviewed];
  for (const option of options) {
    const url = option?.trim();
    if (url && /^https?:\/\/[^\s]+$/i.test(url) && !guardedSourceOf(ticker, url)) return url;
  }
  return null;
}
