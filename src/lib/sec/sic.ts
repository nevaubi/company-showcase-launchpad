// SEC's company data (data.sec.gov submissions, `sicDescription`) carries a wrong or misspelt text for a
// few industry codes. The corrected text is SEC's own published code list
// (https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list, read 24 Nov 2026),
// compared with the company data of all 1,844 covered companies: these are the only codes where the two
// disagree in substance. Pure, shared by the page, the ingest and the coverage generator.
const CORRECTED: Record<string, string> = {
  // the company data says "Silver Ores" for this code (Warrior Met Coal, Core Natural Resources)
  "1220": "Bituminous Coal & Lignite Mining",
  // the company data says "Wholesale-Metals Service Centers & of fices"
  "5051": "Wholesale-Metals Service Centers & Offices",
};

/** The industry text to show for an SEC SIC code: SEC's company data, except where its own code list corrects it. */
export function sicDescription(code: string | number | null | undefined, fromCompanyData: string | null | undefined): string {
  const key = String(code ?? "").trim();
  return CORRECTED[key] ?? (fromCompanyData ?? "");
}
