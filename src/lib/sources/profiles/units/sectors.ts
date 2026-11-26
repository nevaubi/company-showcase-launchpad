import { defineProfile } from "../define";
import type { Profile, ProfileDataset, ProfileEntry } from "../types";

/**
 * Profile families of round 6 unit `sectors` (Housing, Communications, Technology, Health care), each with its
 * proof (see ../registry.ts for the rule). The values compared for each proof are listed in the unit's report
 * (round 6, `sectors`). A family whose unit could not be traced to the publisher is not here; the report lists
 * it with the reason.
 */

// ---------------------------------------------------------------- Housing: FHFA quarterly purchase-only

/**
 * FHFA House Price Index, national and state table: the rows of FHFA's master file for the United States, the nine
 * census divisions and the states (`place_id`, the indexed geo code), every index family and frequency. FHFA
 * publishes purchase-only indexes for states only quarterly, so this family draws the traditional purchase-only
 * quarterly indexes, which FHFA normalizes "to 100 in the first quarter of 1991" (FHFA HPI FAQ): all 161 places of
 * that family in FHFA's master file start at 1991 Q1 with index_nsa and index_sa at 100.00, and so do the 51 states
 * of the stored table. An address must fix the family fields. The period is composed from `yr` and `period` (the
 * quarter), because the store's period dimension holds the year alone.
 * FHFA re-estimates the whole index history with each release (FAQ). This table was retrieved on 24 Nov 2026, before
 * the release that FHFA's current file carries, so the current file equals it only at the base: the comparison is
 * in the report, and a refreshed snapshot of the table is the release on screen.
 */
export const FHFA_QUARTERLY_DATASET = "official_11_real_estate_national_and_state_c21c1607a1";
const FHFA_Q_UNIT = "Index, first quarter of 1991 = 100";
const FHFA_Q_EVIDENCE =
  "https://fhfa.gov/sites/default/files/2024-05/FHFA_HPI_FAQs_05282024.pdf (\"We normalize the purchase-only indexes to 100 in the first quarter of 1991\"); https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv (traditional, purchase-only, quarterly: index_nsa and index_sa are 100.00 for 1991, period 1, at all 161 places)";
const FHFA_Q_FIXED = [
  { field: "hpi_type", value: "traditional" },
  { field: "hpi_flavor", value: "purchase-only" },
  { field: "frequency", value: "quarterly" },
] as const;

const fhfaQuarterlyClaims = (d: ProfileDataset) => d.source_id === "FHFA_MASTER" && d.id === FHFA_QUARTERLY_DATASET;

function fhfaQuarterlyProfile(): Profile {
  return defineProfile(fhfaQuarterlyClaims, {
    family: "fhfa-hpi-quarterly",
    period: {
      from: "fields",
      fields: ["yr", "period", "frequency"],
      format: "quarter",
      compose: ([yr, period, frequency]) => {
        if (!yr || !period || !/^\d{4}$/.test(yr) || !/^[1-4]$/.test(period)) return null;
        return frequency === "quarterly" ? { text: `${yr}Q${period}`, format: "quarter" } : null;
      },
    },
    cadence: "quarter",
    fixed: FHFA_Q_FIXED,
    measures: [
      { field: "index_sa", label: "Index, seasonally adjusted", unit: { from: "constant", text: FHFA_Q_UNIT, evidence: FHFA_Q_EVIDENCE }, grouping: "none" },
      { field: "index_nsa", label: "Index, not seasonally adjusted", unit: { from: "constant", text: FHFA_Q_UNIT, evidence: FHFA_Q_EVIDENCE }, grouping: "none" },
    ],
    extraFields: ["place_id", "place_name", "level"],
    addressing: {
      by: "geo_code",
      where: ["hpi_type", "hpi_flavor", "frequency"],
      scan: "key",
      rowsScanned: 1130,
      note: "A place is one place_id through the geo index (at most 1,130 records, the United States, over every index family); the family fields are matched after the read.",
    },
    defaultSeries: () => ({ by: "geo_code", key: "USA", where: [...FHFA_Q_FIXED] }),
    firstLook: "series",
    proof: {
      snapshotId: "ddd83ae236ba7f328fea24ad360b64510e73b6acf75b3c2c7f57f7e48769ade7",
      datasetId: FHFA_QUARTERLY_DATASET,
      checked: "2026-11-26",
      documentation: ["https://fhfa.gov/sites/default/files/2024-05/FHFA_HPI_FAQs_05282024.pdf", "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"],
    },
  });
}

export const FHFA_QUARTERLY_ENTRY: ProfileEntry = { family: "fhfa-hpi-quarterly", claims: fhfaQuarterlyClaims, profile: fhfaQuarterlyProfile };

// ---------------------------------------------------------------- Housing: FHFA annual county, ZIP and tract indexes

/**
 * FHFA's annual house price indexes for counties and five-digit ZIP codes (developmental, all-transactions, not
 * seasonally adjusted): one record per place (the indexed geo code: the county's FIPS code, the ZIP code) and year
 * (the period dimension), 1975 to 2025, at most 51 records a place. FHFA's workbook states the columns: "Column E is
 * the annual change, Column F is the index value with a base of 100 when first recorded, Column G is the index value
 * with a base of 100 in 1990, and Column H is the index value with a base of 100 in 2000", and "a missing value is
 * reported with a period". The index with a base when first recorded starts in a different year for each place, so
 * it is not drawn; the two rebased indexes and the annual change are.
 * Checked on 26 Nov 2026: 72 of 72 county cells (six counties, 2000, 2024, 2025) and 48 of 48 ZIP cells (twelve ZIP
 * years) equal FHFA's workbooks (last updated 31 Mar 2026), read to the two decimals FHFA writes: the stored text
 * is the workbook's number written in full ("536.80999999999995" for 536.81).
 */
const FHFA_ANNUAL_NOTES =
  "https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx (notes above the header: base of 100 in 1990 in Column G, in 2000 in Column H; annual change in Column E)";

function fhfaAnnualMeasures(evidence: string) {
  return [
    { field: "Annual Change (%)", label: "Annual change", unit: { from: "constant", text: "Percent", evidence }, grouping: "none", markers: ["."] },
    { field: "HPI with 2000 base", label: "Index, base 100 in 2000", unit: { from: "constant", text: "Index, 2000 = 100", evidence }, grouping: "none", markers: ["."] },
    { field: "HPI with 1990 base", label: "Index, base 100 in 1990", unit: { from: "constant", text: "Index, 1990 = 100", evidence }, grouping: "none", markers: ["."] },
  ] as const;
}

/** Los Angeles County, the most populous county, opens the county history: the table has no aggregate to open on. */
const LOS_ANGELES_COUNTY = "06037";
const FHFA_COUNTY_HISTORY = "official_11_real_estate_hpi_at_county_fc7641108a";

const fhfaCountyClaims = (d: ProfileDataset) => d.source_id === "FHFA_COUNTY";

function fhfaCountyProfile(dataset: ProfileDataset): Profile {
  return defineProfile(fhfaCountyClaims, {
    family: "fhfa-hpi-county",
    entityNoun: { one: "county", many: "counties" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: fhfaAnnualMeasures(FHFA_ANNUAL_NOTES),
    extraFields: ["State", "County", "FIPS code", "Year"],
    addressing: {
      by: "geo_code",
      where: [],
      scan: "key",
      rowsScanned: 51,
      note: "A county is one FIPS code through the geo index: one record a year, 1975 to 2025, at most 51.",
    },
    defaultSeries: (d) => (d.id === FHFA_COUNTY_HISTORY ? { by: "geo_code", key: LOS_ANGELES_COUNTY } : null),
    // the latest table holds one year: a series of one point says nothing, a ranking of its 2,795 counties waits for a paged read
    firstLook: dataset.id === FHFA_COUNTY_HISTORY ? "series" : "ranking",
    proof: {
      snapshotId: "00411d96f967186a22ba7c229a907620ed95d56fac7a5fb496edf4c42a717b8f",
      datasetId: FHFA_COUNTY_HISTORY,
      checked: "2026-11-26",
      documentation: ["https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx", "https://www.fhfa.gov/data/hpi/datasets"],
    },
  });
}

export const FHFA_COUNTY_ENTRY: ProfileEntry = { family: "fhfa-hpi-county", claims: fhfaCountyClaims, profile: fhfaCountyProfile };

const FHFA_ZIP_HISTORY = "official_11_real_estate_hpi_at_zip5_beae754ada";
const fhfaZipClaims = (d: ProfileDataset) => d.source_id === "FHFA_ZIP5";

function fhfaZipProfile(dataset: ProfileDataset): Profile {
  return defineProfile(fhfaZipClaims, {
    family: "fhfa-hpi-zip5",
    entityNoun: { one: "ZIP code", many: "ZIP codes" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: fhfaAnnualMeasures(
      "https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx (the county workbook's notes state the three bases for this family: https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx)",
    ),
    extraFields: ["Five-Digit ZIP Code", "Year"],
    addressing: {
      by: "geo_code",
      where: [],
      scan: "key",
      rowsScanned: 51,
      note: "A ZIP code is one geo code through the geo index: one record a year, 1975 to 2025, at most 51.",
    },
    defaultSeries: () => null,
    // the latest table holds one year of 19,024 ZIP codes: no bounded read ranks it
    firstLook: dataset.id === FHFA_ZIP_HISTORY ? "series" : "none",
    proof: {
      snapshotId: "6ce2b2eac4020d460d57f6aa25c31316936b6c49014dcd4499a21e4c120870d2",
      datasetId: FHFA_ZIP_HISTORY,
      checked: "2026-11-26",
      documentation: ["https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx", "https://www.fhfa.gov/data/hpi/datasets"],
    },
  });
}

export const FHFA_ZIP_ENTRY: ProfileEntry = { family: "fhfa-hpi-zip5", claims: fhfaZipClaims, profile: fhfaZipProfile };

/**
 * FHFA's annual census tract indexes: FHFA's CSV as published (the stored file's SHA-256 equals FHFA's file of
 * 26 Nov 2026), one record per tract (the 11-character tract code, the indexed geo code) and year, 1975 to 2025.
 * The dictionary states the units ("percent", "index; 1990=100", "index; 2000=100"); the profile reads them from
 * it and turns off if it ever states another. Checked on 26 Nov 2026: 24 of 24 cells of six records across the
 * file equal FHFA's CSV as text.
 */
const fhfaTractClaims = (d: ProfileDataset) => d.source_id === "FHFA_TRACT";

function fhfaTractProfile(): Profile {
  return defineProfile(fhfaTractClaims, {
    family: "fhfa-hpi-tract",
    entityNoun: { one: "census tract", many: "census tracts" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: [
      { field: "annual_change", label: "Annual change", unit: { from: "dictionary", text: "percent" }, grouping: "none" },
      { field: "hpi2000", label: "Index, base 100 in 2000", unit: { from: "dictionary", text: "index; 2000=100" }, grouping: "none" },
      { field: "hpi1990", label: "Index, base 100 in 1990", unit: { from: "dictionary", text: "index; 1990=100" }, grouping: "none" },
    ],
    extraFields: ["tract", "state_abbr", "year"],
    addressing: {
      by: "geo_code",
      where: [],
      scan: "key",
      rowsScanned: 51,
      note: "A tract is one 11-character tract code through the geo index: one record a year, 1975 to 2025, at most 51.",
    },
    defaultSeries: () => null,
    firstLook: "series",
    proof: {
      snapshotId: "a5b0f712db7e8ac19126e1c6cd734fea4c4103b84d23ddff8eec80d3cf513c2c",
      datasetId: "official_11_real_estate_raw_hpi_at_tract_d51b3471be",
      checked: "2026-11-26",
      documentation: ["https://www.fhfa.gov/hpi/download/annual/hpi_at_tract.csv", "https://www.fhfa.gov/data/hpi/datasets"],
    },
  });
}

export const FHFA_TRACT_ENTRY: ProfileEntry = { family: "fhfa-hpi-tract", claims: fhfaTractClaims, profile: fhfaTractProfile };

// ---------------------------------------------------------------- Technology: Taiwan monthly operating revenue

/**
 * Monthly operating revenue of companies listed on the Taiwan Stock Exchange (TWSE, `t187ap05_L`) and the Taipei
 * Exchange (TPEX, `mopsfin_t187ap05_O`), one record per company (the company code is the indexed entity, the short
 * name the entity name) for one reporting month.
 *
 * Units. Neither exchange's API states the unit of the money fields (both OpenAPI descriptions name the fields
 * only), and MOPS, whose pages state it, refuses automated requests. So money is drawn only where the snapshot's
 * own dictionary states the unit: the two technology tables, whose dictionary entry reads "thousands of source
 * reporting currency (MOPS: 千元); no currency normalization"; the profile reads it from the dictionary and turns
 * off if it states anything else. TSMC's own release agrees for its record: "revenue for October 2026 was
 * approximately NT$586.89 billion" and "January through October 2026 totaled NT$4,485.62 billion", stored as
 * 586890319 and 4485617293. The percent changes are drawn in both layouts: the exchanges' own headers state them
 * in percent ("營業收入-去年同月增減(%)").
 * Checked on 26 Nov 2026: every record of the TWSE (1,091) and TPEX (898) all-industries tables equals the
 * exchange's API of that day (company code and five money fields, one digest over every record in order), and the
 * 472 and 484 records of the technology tables equal those records field for field.
 */
const TW_PERCENT_EVIDENCE =
  "https://openapi.twse.com.tw/v1/swagger.json and https://www.tpex.org.tw/openapi/swagger.json (fields 營業收入-去年同月增減(%), 營業收入-上月比較增減(%), 累計營業收入-前期比較增減(%))";
const TW_MONEY_UNIT = "thousands of source reporting currency (MOPS: 千元); no currency normalization";
const twClaims = (d: ProfileDataset) => d.source_id === "TWSE_MONTHLY" || d.source_id === "TPEX_MONTHLY";

/** The technology tables: English field names, the money unit in the dictionary, the month as a Gregorian period. */
function twTechProfile(): Profile {
  return defineProfile(twClaims, {
    family: "tw-revenue-tech",
    entityNoun: { one: "listed company", many: "listed companies" },
    period: { from: "dimension", format: "yyyy-mm" },
    cadence: "month",
    measures: [
      { field: "monthly_revenue", label: "Operating revenue, the month", unit: { from: "dictionary", text: TW_MONEY_UNIT }, grouping: "none" },
      { field: "year_to_date_revenue", label: "Operating revenue, year to date", unit: { from: "dictionary", text: TW_MONEY_UNIT }, grouping: "none" },
      { field: "year_over_year_pct", label: "Change on the same month a year earlier", unit: { from: "constant", text: "Percent", evidence: TW_PERCENT_EVIDENCE }, grouping: "none" },
    ],
    extraFields: ["exchange", "company_code", "company_name", "period_gregorian"],
    addressing: {
      by: "entity_id",
      where: [],
      scan: "key",
      rowsScanned: 1,
      note: "A company is one company code through the entity index; each table holds one reporting month.",
    },
    defaultSeries: () => null,
    firstLook: "ranking",
    proof: {
      snapshotId: "40892380b8bc623f4e3e3f9f49e4af550828b460f406a3b3f82b43df63af1f74",
      datasetId: "official_02_technology_csv_twse_tech_revenue_922c8b713b",
      checked: "2026-11-26",
      documentation: ["https://openapi.twse.com.tw/v1/opendata/t187ap05_L", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", "https://pr.tsmc.com/english/news/3349"],
    },
  });
}

/**
 * The all-industries tables as the exchanges serve them: Chinese headers. The store's period dimension holds the
 * exchange's ROC month ("11510") in the copies of the technology collection and the Gregorian month ("2026-10") in
 * the two current copies of the universal collection; rankings read that dimension, so its format is declared per
 * copy (the exchange's own field 資料年月 is "11510" in all four).
 */
const twGregorianCopy = (d: ProfileDataset) => d.id === "official_twse_monthly_revenue_native_current" || d.id === "official_tpex_monthly_revenue_native_current";

function twNativeProfile(dataset: ProfileDataset): Profile {
  return defineProfile(twClaims, {
    family: "tw-revenue-native",
    entityNoun: { one: "listed company", many: "listed companies" },
    period: { from: "dimension", format: twGregorianCopy(dataset) ? "yyyy-mm" : "roc-yyymm" },
    cadence: "month",
    measures: [
      { field: "營業收入-去年同月增減(%)", label: "Change on the same month a year earlier", unit: { from: "constant", text: "Percent", evidence: TW_PERCENT_EVIDENCE }, grouping: "none" },
      { field: "營業收入-上月比較增減(%)", label: "Change on the month before", unit: { from: "constant", text: "Percent", evidence: TW_PERCENT_EVIDENCE }, grouping: "none" },
      { field: "累計營業收入-前期比較增減(%)", label: "Change in the year to date on a year earlier", unit: { from: "constant", text: "Percent", evidence: TW_PERCENT_EVIDENCE }, grouping: "none" },
    ],
    extraFields: ["資料年月", "公司代號", "公司名稱", "產業別"],
    addressing: {
      by: "entity_id",
      where: [],
      scan: "key",
      rowsScanned: 1,
      note: "A company is one company code through the entity index; each table holds one reporting month.",
    },
    defaultSeries: () => null,
    firstLook: "ranking",
    proof: {
      snapshotId: "145e7c96d5e7a897d8500cde169608728fa9ce2c1cde014781e26180fba8060b",
      datasetId: "official_02_technology_csv_twse_revenue_all_industries_96edc5fdfa",
      checked: "2026-11-26",
      documentation: ["https://openapi.twse.com.tw/v1/opendata/t187ap05_L", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"],
    },
  });
}

/** Two layouts share the source ids: each entry claims the dataset, and the one whose fields are there applies. */
export const TW_TECH_ENTRY: ProfileEntry = { family: "tw-revenue-tech", claims: twClaims, profile: twTechProfile };
export const TW_NATIVE_ENTRY: ProfileEntry = { family: "tw-revenue-native", claims: twClaims, profile: twNativeProfile };

// ---------------------------------------------------------------- Technology: World Bank technology indicators

/**
 * World Bank technology indicators (World Development Indicators), annual: one record per indicator, economy and
 * year, the year as the period dimension. The two tables hold the same 23,398 records (one digest over indicator,
 * economy, year and value). Each indicator has its own unit, which the World Bank states in the indicator's name
 * (its API leaves the unit field empty), and no field of the record holds it; so each table is drawn for one
 * indicator, fixed in every address: the full table for "High-technology exports (% of manufactured exports)",
 * the short table for "ICT goods exports (% of total goods exports)". An economy is a cell filter on the World Bank
 * code (the tables have no indexed economy; 23,398 records allow the filter).
 * Checked on 26 Nov 2026: 36 of 36 values (six economies, 2022 to 2024, both indicators) equal the World Bank API
 * (last updated 11 Nov 2026), as text.
 */
type WbIndicator = { code: string; name: string; unit: string };
const WB_TECH_FULL = "official_02_technology_csv_wb_tech_annual_full_7471fc676b";
const WB_TECH_SHORT = "official_02_technology_csv_wb_tech_annual_22be3f4568";
export const WB_HIGH_TECH: WbIndicator = { code: "TX.VAL.TECH.MF.ZS", name: "High-technology exports (% of manufactured exports)", unit: "% of manufactured exports" };
export const WB_ICT_GOODS: WbIndicator = { code: "TX.VAL.ICTG.ZS.UN", name: "ICT goods exports (% of total goods exports)", unit: "% of total goods exports" };

const wbTechClaims = (d: ProfileDataset) => d.source_id === null && (d.id === WB_TECH_FULL || d.id === WB_TECH_SHORT);

function wbTechProfile(dataset: ProfileDataset): Profile {
  const indicator = dataset.id === WB_TECH_FULL ? WB_HIGH_TECH : WB_ICT_GOODS;
  const fixed = [{ field: "indicator_code", value: indicator.code }] as const;
  return defineProfile(wbTechClaims, {
    family: "wb-tech",
    entityNoun: { one: "economy", many: "economies" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    fixed,
    measures: [
      {
        field: "value",
        label: indicator.name,
        unit: { from: "constant", text: indicator.unit, evidence: `https://api.worldbank.org/v2/indicator/${indicator.code}?format=json (name: "${indicator.name}")` },
        grouping: "none",
      },
    ],
    extraFields: dataset.id === WB_TECH_FULL ? ["wb_country_code", "country_name", "year"] : ["wb_country_code", "year"],
    addressing: {
      by: null,
      where: ["wb_country_code"],
      scan: "table",
      rowsScanned: 23398,
      note: "An economy is a cell filter on wb_country_code beside the fixed indicator, over a 23,398-record table.",
    },
    defaultSeries: () => ({ where: [...fixed, { field: "wb_country_code", value: "WLD" }] }),
    firstLook: "series",
    proof: {
      snapshotId: "1bd95e8d2f8bad96df323eb4aeb858096da152796da02a29342cbf6717fcbe83",
      datasetId: WB_TECH_FULL,
      checked: "2026-11-26",
      documentation: [`https://api.worldbank.org/v2/indicator/${WB_HIGH_TECH.code}?format=json`, `https://api.worldbank.org/v2/indicator/${WB_ICT_GOODS.code}?format=json`],
    },
  });
}

export const WB_TECH_ENTRY: ProfileEntry = { family: "wb-tech", claims: wbTechClaims, profile: wbTechProfile };

// ---------------------------------------------------------------- Health care: CMS Medicare Part D spending

/**
 * CMS Medicare Part D Spending by Drug, the "Overall" rows (each brand and generic name across its manufacturers)
 * reshaped to one record per drug and year, 2020 to 2024, the year as the period dimension. The dictionary states
 * each unit ("USD nominal gross drug spending", "claims", "beneficiaries; suppressed values blank", "USD per claim");
 * the profile reads them from it and turns off if it states another. CMS defines the spending as "the gross drug
 * cost, which includes ingredient cost, dispensing fees, sales tax, and applicable vaccine administration fees"
 * and states that it does not "reflect any manufacturers' rebates or other price concessions" (methodology).
 * A drug is a cell filter on brand and generic name (18,125 records). The table opens on Eliquis (apixaban), the
 * drug with the largest 2024 spending in it (checked on production).
 * Checked on 26 Nov 2026: 30 of 30 values (Eliquis and Ozempic, spending, claims and beneficiaries, 2020 to 2024)
 * equal CMS's API for the same drugs' Overall rows, as text.
 */
const CMS_PARTD_ANNUAL = "official_03_healthcare_csv_partd_overall_annual_654675dedc";
/** The wide all-manufacturer table (46 fields, a year in each field name) has no period to draw by: it is not claimed. */
const cmsClaims = (d: ProfileDataset) => d.source_id === "CMS_PARTD_2024" && d.id === CMS_PARTD_ANNUAL;

function cmsPartdProfile(): Profile {
  return defineProfile(cmsClaims, {
    family: "cms-partd",
    entityNoun: { one: "drug", many: "drugs" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: [
      { field: "Tot_Spndng", label: "Total spending", unit: { from: "dictionary", text: "USD nominal gross drug spending" }, grouping: "none" },
      { field: "Tot_Clms", label: "Total claims", unit: { from: "dictionary", text: "claims" }, grouping: "none" },
      { field: "Tot_Benes", label: "Total beneficiaries", unit: { from: "dictionary", text: "beneficiaries; suppressed values blank" }, grouping: "none" },
      { field: "Avg_Spnd_Per_Clm", label: "Average spending per claim", unit: { from: "dictionary", text: "USD per claim" }, grouping: "none" },
    ],
    extraFields: ["brand_name", "generic_name", "manufacturer_scope", "year"],
    addressing: {
      by: null,
      where: ["brand_name", "generic_name"],
      scan: "table",
      rowsScanned: 18125,
      note: "A drug is a cell filter on brand_name and generic_name over an 18,125-record table: five records, one a year.",
    },
    defaultSeries: () => ({ where: [{ field: "brand_name", value: "Eliquis" }, { field: "generic_name", value: "Apixaban" }] }),
    firstLook: "series",
    proof: {
      snapshotId: "ad25a8c762a4f2f5515ef93ef2d81dda4ec9c1a96c1b48bf45495573632a4bd8",
      datasetId: CMS_PARTD_ANNUAL,
      checked: "2026-11-26",
      documentation: [
        "https://data.cms.gov/data-api/v1/dataset/da5ff50b-e5da-42de-b68b-6cfac1f64f35/data",
        "https://data.cms.gov/sites/default/files/2025-05/Medicare%20Part%20D%20Spending%20by%20Drug%20Data%20Dictionary%2020250425_508.pdf",
        "https://data.cms.gov/sites/default/files/2026-06/d7e0a571-9d08-40ec-8278-1b2300f59424/DSD_PTD_RY26_20260603_Methodology_WDDSE_508.pdf",
      ],
    },
  });
}

export const CMS_PARTD_ENTRY: ProfileEntry = { family: "cms-partd", claims: cmsClaims, profile: cmsPartdProfile };

// ---------------------------------------------------------------- Health care: Drugs@FDA original submissions by year

/**
 * The store's count of Drugs@FDA original submissions (SubmissionType ORIG in FDA's Submissions file) by the year of
 * their status date, the application type (FDA's Applications file: NDA, ANDA, BLA) and the status (AP approved, TA
 * tentatively approved). The figure is a count of FDA's records, so its unit is "records". A series is one type and
 * status, a cell filter over 369 records; the year is a field (the table has no period dimension).
 * Checked on 26 Nov 2026 by counting FDA's own file (drugsatfda.zip of 24 Nov 2026, 14:30, released after the
 * store's retrieval): 363 of 370 groups equal; NDA and BLA approvals equal in every year; the seven that differ are
 * tentative approvals and 2026 counts, which FDA's weekly update changed (28,010 records stored, 28,015 in the file).
 */
export const FDA_ORIGINAL_COUNTS = "official_03_healthcare_csv_fda_original_by_year_b0807c7bff";
const fdaCountsClaims = (d: ProfileDataset) => d.source_id === null && d.id === FDA_ORIGINAL_COUNTS;

function fdaCountsProfile(): Profile {
  return defineProfile(fdaCountsClaims, {
    family: "fda-original-counts",
    period: { from: "field", field: "status_year", format: "year" },
    cadence: "year",
    measures: [
      {
        field: "original_submission_record_count",
        label: "Original submissions",
        unit: {
          from: "constant",
          text: "records",
          evidence: "https://www.fda.gov/media/89850/download (Drugs@FDA: Submissions.txt, one record per submission, counted where SubmissionType is ORIG, by ApplType from Applications.txt)",
        },
        grouping: "none",
      },
    ],
    extraFields: ["application_type", "submission_status"],
    addressing: {
      by: null,
      where: ["application_type", "submission_status"],
      scan: "table",
      rowsScanned: 369,
      note: "A series is one application type and status, a cell filter over a 369-record table, one record a year.",
    },
    defaultSeries: () => ({ where: [{ field: "application_type", value: "NDA" }, { field: "submission_status", value: "AP" }] }),
    firstLook: "series",
    proof: {
      snapshotId: "df4d01099c1a472a50423d91e4915afb5fc756146e84d147b5623dd209292c7b",
      datasetId: FDA_ORIGINAL_COUNTS,
      checked: "2026-11-26",
      documentation: ["https://www.fda.gov/media/89850/download", "https://www.fda.gov/drugs/drug-approvals-and-databases/drugsfda-data-files"],
    },
  });
}

export const FDA_COUNTS_ENTRY: ProfileEntry = { family: "fda-original-counts", claims: fdaCountsClaims, profile: fdaCountsProfile };

/** Profile families of round 6 unit `sectors`, each with its proof (see ../registry.ts for the rule). */
export const ENTRIES: readonly ProfileEntry[] = [
  FHFA_QUARTERLY_ENTRY,
  FHFA_COUNTY_ENTRY,
  FHFA_ZIP_ENTRY,
  FHFA_TRACT_ENTRY,
  TW_TECH_ENTRY,
  TW_NATIVE_ENTRY,
  WB_TECH_ENTRY,
  CMS_PARTD_ENTRY,
  FDA_COUNTS_ENTRY,
];
