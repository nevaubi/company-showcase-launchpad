/**
 * The app's own pages that cover the same ground as a collection, linked rather than repeated. Pure.
 * Copies overlap (FRED series in Macro, OFR data in Hedge funds, SEC facts in the statements), and the page
 * says so in one line: their figures are never added to the library's.
 */
export type RelatedPage = { label: string; href: string; note: string };

const sector = (name: string): RelatedPage => ({
  label: `${name} sector`,
  href: `/app/sectors/${encodeURIComponent(name)}`,
  note: "covered companies in this sector",
});

const RELATED: Record<string, RelatedPage[]> = {
  "00_universal": [{ label: "Macro", href: "/app/macro", note: "the app's FRED economic series" }],
  "01_financials": [
    { label: "Hedge funds", href: "/app/hedge-funds", note: "OFR leverage, positioning and crowding" },
    { label: "Exposures", href: "/app/exposures", note: "loans, deposits and credit of covered banks" },
    sector("Financials"),
  ],
  "02_technology": [sector("Information Technology")],
  "03_healthcare": [sector("Health Care")],
  "04_energy": [sector("Energy")],
  "05_utilities": [sector("Utilities")],
  "06_industrials": [sector("Industrials")],
  "07_materials": [sector("Materials")],
  "08_consumer_discretionary": [sector("Consumer Discretionary")],
  "09_consumer_staples": [sector("Consumer Staples")],
  "10_communications": [sector("Communication Services")],
  "11_real_estate": [sector("Real Estate"), { label: "Macro", href: "/app/macro", note: "housing and mortgage rate series" }],
  "12_sec_company_financials": [{ label: "All companies", href: "/app/companies", note: "statements built from the same SEC filings" }],
  "13_ir_integration": [
    { label: "JPMorgan Chase IR data", href: "/app/companies/JPM/ir", note: "documents and figures read from its IR site" },
    { label: "Robinhood IR data", href: "/app/companies/HOOD/ir", note: "documents and figures read from its IR site" },
  ],
};

export function relatedPages(collectionId: string): RelatedPage[] {
  return RELATED[collectionId] ?? [];
}

export const OVERLAP_NOTE =
  "Some figures here also appear on these pages, as separate copies of the same series. They overlap and are never added together.";
