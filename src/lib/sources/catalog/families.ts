import type { CatalogInput } from "./types";

export type Family = { id: string; name: string };

/** `source_id` (exact, or by prefix when the value ends in "*") to the family a reader would name. */
const BY_SOURCE_ID: [string, Family][] = [
  ["FRED_*", { id: "fred", name: "FRED economic series" }],
  ["FED_Z1", { id: "fed-z1", name: "Financial Accounts of the United States (Z.1)" }],
  ["FED_H8", { id: "fed-h8", name: "Assets and Liabilities of Commercial Banks (H.8)" }],
  ["FED_NIC", { id: "ffiec-nic", name: "National Information Center bank structure data" }],
  ["FED_Y9", { id: "fed-y9", name: "Holding company financial statements (FR Y-9)" }],
  ["FDIC_FINANCIALS", { id: "fdic-financials", name: "FDIC bank financial reports" }],
  ["FDIC_SOD", { id: "fdic-sod", name: "FDIC Summary of Deposits" }],
  ["FDIC_FAILURES", { id: "fdic-failures", name: "FDIC bank failures" }],
  ["FDIC_HISTORY", { id: "fdic-history", name: "FDIC structure change history" }],
  ["FDIC_INSTITUTIONS", { id: "fdic-institutions", name: "FDIC institution directory" }],
  ["FDIC_SUMMARY", { id: "fdic-summary", name: "FDIC historical industry summary" }],
  ["NCUA_CALL", { id: "ncua-call", name: "NCUA credit union call reports" }],
  ["OFR_STFM", { id: "ofr-stfm", name: "OFR Short-term Funding Monitor" }],
  ["SEC_BDC", { id: "sec-bdc", name: "SEC business development company data sets" }],
  ["SEC_NMFP", { id: "sec-nmfp", name: "SEC money market fund reports (Form N-MFP)" }],
  ["SEC_NPORT", { id: "sec-nport", name: "SEC fund portfolio reports (Form N-PORT)" }],
  ["SEC_FSDS", { id: "sec-fsds", name: "SEC Financial Statement Data Sets" }],
  ["COMPANY_IR", { id: "company-ir", name: "Company investor-relations documents" }],
  ["CISA_KEV", { id: "cisa-kev", name: "CISA Known Exploited Vulnerabilities" }],
  ["TWSE_MONTHLY", { id: "twse-revenue", name: "TWSE listed-company monthly revenue" }],
  ["TPEX_MONTHLY", { id: "tpex-revenue", name: "TPEx listed-company monthly revenue" }],
  ["WB_*", { id: "worldbank-indicators", name: "World Bank indicators" }],
  ["CMS_PARTD_*", { id: "cms-partd", name: "Medicare Part D drug spending" }],
  ["CTG_*", { id: "clinicaltrials", name: "ClinicalTrials.gov studies" }],
  ["FDA_*", { id: "fda-drugsfda", name: "Drugs@FDA" }],
  ["ORANGE_*", { id: "fda-orange-book", name: "FDA Orange Book" }],
  ["BSEE_*", { id: "bsee-offshore", name: "BSEE offshore wells, pipelines and operators" }],
  ["EIA_EV_MICRODATA", { id: "eia-ev", name: "EIA electric vehicle charging ports" }],
  ["EIA_MER", { id: "eia-mer", name: "EIA Monthly Energy Review" }],
  ["EIA814_*", { id: "eia-814", name: "EIA company-level petroleum imports (form EIA-814)" }],
  ["EIA820_*", { id: "eia-820", name: "EIA refinery capacity (form EIA-820)" }],
  ["EIA860_*", { id: "eia-860", name: "EIA generator inventory (form EIA-860)" }],
  ["EIA861_*", { id: "eia-861", name: "EIA electric power industry report (form EIA-861)" }],
  ["EIA923_*", { id: "eia-923", name: "EIA power plant operations (form EIA-923)" }],
  ["EPA_EGRID", { id: "epa-egrid", name: "EPA eGRID" }],
  ["MSHA_*", { id: "msha", name: "MSHA mine data" }],
  [
    "USGS_DS140",
    {
      id: "usgs-ds140",
      name: "USGS Historical Statistics for Mineral and Material Commodities (Data Series 140)",
    },
  ],
  ["FAA_REGISTRY", { id: "faa-registry", name: "FAA aircraft registry" }],
  ["NHTSA_RECALLS", { id: "nhtsa-recalls", name: "NHTSA vehicle and equipment recalls" }],
  ["RETAINED_RAW_SAFERCAR_DATA_CSV", { id: "nhtsa-ratings", name: "NHTSA vehicle safety ratings" }],
  ["ERS_*", { id: "ers-food-prices", name: "USDA Food Price Outlook" }],
  ["FCC_*", { id: "fcc-providers", name: "FCC provider records" }],
  ["USAC_*", { id: "usac-funds", name: "USAC universal service funding" }],
  ["FHFA_*", { id: "fhfa-hpi", name: "FHFA House Price Index" }],
  ["SPEC_REGISTRY", { id: "source-registry", name: "Source registry" }],
];

/** Datasets stored without a `source_id`: the family is read from the id's own file stem. */
const BY_ID_PART: [RegExp, string | Family][] = [
  [/_(indicators_all_observations|monthly_panel|quarterly_panel|daily_weekly|series_catalogue)_[0-9a-f]{10}$/, "FRED_X"],
  [/_(us_electronics_ip|us_ip_series_metadata|fred_electronics_ip)_[0-9a-f]{10}$/, "FRED_X"],
  [/_fdic_native_field_dictionary/, "FDIC_FINANCIALS"],
  [/_twse_(company_profiles|tech_companies)/, { id: "twse-profiles", name: "TWSE listed-company profiles" }],
  [/_wb_(tech|telecom)_/, "WB_X"],
  [/_fda_(original_by_year|sponsor_counts)_/, "FDA_X"],
];

function lookup(sourceId: string): Family | null {
  for (const [key, family] of BY_SOURCE_ID) {
    if (key.endsWith("*") ? sourceId.startsWith(key.slice(0, -1)) : sourceId === key) return family;
  }
  return null;
}

export function familyFor(d: Pick<CatalogInput, "id" | "source_id">): Family | null {
  if (d.source_id) return lookup(d.source_id);
  for (const [pattern, family] of BY_ID_PART) {
    if (pattern.test(d.id)) return typeof family === "string" ? lookup(family) : family;
  }
  return null;
}
