// Server and offline ingestion only. This snapshot also seeds fresh Lovable Cloud databases.
import seed from "../../../scripts/data/issuer-directory.json";
import { reviewedLinks, type ReviewedIssuerLinks } from "./issuer-directory";

const byIssuer = new Map<string, ReviewedIssuerLinks>();
for (const row of seed) {
  const key = `${row.ticker}:${row.cik}`;
  byIssuer.set(key, { ...byIssuer.get(key), ...reviewedLinks([row]) });
}

export function snapshotIssuerLinks(ticker: string, cik: string): ReviewedIssuerLinks {
  return byIssuer.get(`${ticker.toUpperCase()}:${cik.replace(/^0+/, "")}`) ?? {};
}

/** A financial-history profile can belong to a predecessor with a different SEC registrant ID. */
export function snapshotProfileLinks(company: { ticker: string; cik: string }, profileCik: string): ReviewedIssuerLinks {
  return company.cik.replace(/^0+/, "") === profileCik.replace(/^0+/, "")
    ? snapshotIssuerLinks(company.ticker, profileCik)
    : { website: null, ir: null };
}
