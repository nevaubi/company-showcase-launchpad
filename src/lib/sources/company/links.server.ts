// Server-only loader of the company to official-record mapping. The mapping is a reviewed data file generated and
// checked by `scripts/company-source-links.ts`; nothing here builds a link. Only proven rows with an open
// `valid_to` are links: `review` rows (name matches kept for the caveat) and closed or retired rows never are.
import raw from "./links.json";
import { isLive, type CompanyLink, type Y9cPointer } from "./types";

const ALL = raw as unknown as CompanyLink[];
const BY_TICKER = new Map<string, CompanyLink[]>();
for (const l of ALL) {
  const list = BY_TICKER.get(l.ticker);
  if (list) list.push(l);
  else BY_TICKER.set(l.ticker, [l]);
}
const norm = (ticker: string) => ticker.trim().toUpperCase();

/** Every row, as stored (for the validation test and the script). */
export function allLinks(): readonly CompanyLink[] {
  return ALL;
}

/** The links in force for a ticker. */
export function linksFor(ticker: string): CompanyLink[] {
  return (BY_TICKER.get(norm(ticker)) ?? []).filter(isLive);
}

/** Rows kept for review for a ticker (name matches): never a link, only the reason for a caveat. */
export function reviewRows(ticker: string): CompanyLink[] {
  return (BY_TICKER.get(norm(ticker)) ?? []).filter(l => l.status === "review");
}

/** The registrant's own entity at the Federal Reserve (NIC), when its EIN proves it. */
export function registrantLink(ticker: string): CompanyLink | null {
  return linksFor(ticker).find(l => l.link_kind === "registrant_rssd") ?? null;
}

export function registrantRssd(ticker: string): string | null {
  return registrantLink(ticker)?.key_value ?? null;
}

/** FDIC institutions proven to be the registrant's: insured banks first by total assets, then trust companies. */
export function provenBanks(ticker: string): CompanyLink[] {
  const assets = (l: CompanyLink) => Number(l.evidence.fdic?.total_assets_k ?? 0);
  return linksFor(ticker)
    .filter(l => l.link_kind === "insured_bank" || l.link_kind === "noninsured_trust_company")
    .sort((a, b) => (a.link_kind === b.link_kind ? assets(b) - assets(a) : a.link_kind === "insured_bank" ? -1 : 1));
}

/** The registrant's FR Y-9C rows, oldest report date first. */
export function y9cRows(ticker: string): Y9cPointer[] {
  return [...(registrantLink(ticker)?.y9c ?? [])].sort((a, b) => a.report_date.localeCompare(b.report_date));
}

/** Asset-backed deal sponsors that are proven insured banks of the registrant. */
export function absSponsors(ticker: string): CompanyLink[] {
  return linksFor(ticker).filter(l => l.link_kind === "abs_sponsor_bank");
}
