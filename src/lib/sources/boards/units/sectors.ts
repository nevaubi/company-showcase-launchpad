/**
 * Tiles and boards of round 6 unit `sectors`: Housing (`11_real_estate`, tiles added to the core board), and new boards
 * for Communications (`10_communications`), Technology (`02_technology`) and Health care (`03_healthcare`), plus two
 * tiles for the landing board. Pure data: no network; no shared list is edited.
 *
 * Every tile names its dataset by id and was computed once from production rows on 26 Nov 2026 (the unit's report
 * lists each headline with its period and snapshot). Measures come only from the profiles of
 * `../../profiles/units/sectors.ts`; tables without a provable unit get count tiles (`records`), which need none.
 *
 * Live and pending. A tile is on a board only when the engine on this branch computes its form; the forms of round 6
 * (compare, map, distribution, records) and the paged and lowest-first rankings are defined here and held in
 * `PENDING_BOARD_TILES` until their compute lands (unit `forms`), so no board shows a refusal that only means
 * "not built yet". The tests check both lists against the specs.
 */
import { FDA_ORIGINAL_COUNTS, FHFA_QUARTERLY_DATASET, WB_HIGH_TECH, WB_ICT_GOODS } from "../../profiles/units/sectors";
import type { FieldMatch } from "../../profiles/types";
import type { UnitSpecs } from "../compose";
import type {
  BoardSpec,
  CompareTileSpec,
  DistributionTileSpec,
  MapTileSpec,
  RankTileSpec,
  RecordsTileSpec,
  SeriesTileSpec,
  StatTileSpec,
  TileSeriesSpec,
  TileSpec,
} from "../types";

// ---------------------------------------------------------------- datasets

const FHFA_COUNTY_HISTORY = "official_11_real_estate_hpi_at_county_fc7641108a";
const FHFA_COUNTY_2025 = "official_11_real_estate_hpi_at_county_latest_4e3ee0764a";
const TWSE_TECH = "official_02_technology_csv_twse_tech_revenue_922c8b713b";
const TPEX_TECH = "official_02_technology_csv_tpex_tech_revenue_fdf5c543f2";
const TWSE_ALL = "official_02_technology_csv_twse_revenue_all_industries_96edc5fdfa";
const KEV = "official_02_technology_csv_cisa_kev_8249fbd9bc";
const WB_TECH_FULL = "official_02_technology_csv_wb_tech_annual_full_7471fc676b";
const WB_TECH_SHORT = "official_02_technology_csv_wb_tech_annual_22be3f4568";
const PARTD = "official_03_healthcare_csv_partd_overall_annual_654675dedc";
const FDA_APPLICATIONS = "official_03_healthcare_csv_fda_applications_8ae8368413";
const OB_EXCLUSIVITY = "official_03_healthcare_csv_ob_exclusivity_b108a0e8e8";
const FCC_PROVIDERS = "official_10_communications_csv_fcc_provider_extents_b54be90909";
const CAF_DISBURSE = "official_10_communications_csv_caf_disbursements_929fb6680e";
const CAF_SPEED = "official_10_communications_csv_caf_speed_obligations_4a63551abb";
const WB_TELECOM = "official_10_communications_csv_wb_telecom_annual_full_c578033483";
const WB_TELECOM_MISSING = "official_10_communications_csv_wb_telecom_missing_observations_afef7dfa81";

// ---------------------------------------------------------------- Housing (FHFA)

const FHFA_Q_UNIT = "Index, first quarter of 1991 = 100";
const FHFA_Q_FAMILY: readonly FieldMatch[] = [
  { field: "hpi_type", value: "traditional" },
  { field: "hpi_flavor", value: "purchase-only" },
  { field: "frequency", value: "quarterly" },
];
const FHFA_Q_NOTE = "Purchase-only index, seasonally adjusted, quarterly. FHFA re-estimates the whole history with each release.";

/** One place of the quarterly purchase-only family: four cell filters inside one select of the 40,304-record table. */
const fhfaPlace = (placeId: string, label: string): TileSeriesSpec => ({
  series: { where: [{ field: "place_id", value: placeId }, ...FHFA_Q_FAMILY] },
  label,
});

const fhfaDivisions = (spec: { id: string; title: string; lines: readonly TileSeriesSpec[] }): CompareTileSpec => ({
  id: spec.id,
  collection: "11_real_estate",
  datasetId: FHFA_QUARTERLY_DATASET,
  measure: "index_sa",
  title: spec.title,
  subject: "The FHFA purchase-only index",
  unit: FHFA_Q_UNIT,
  decimals: 2,
  form: "compare",
  transform: "change-1y-quarterly",
  changeAs: "percent",
  headline: "change",
  lines: spec.lines,
  window: 24,
  section: "States and divisions",
  note: FHFA_Q_NOTE,
});

const COUNTY_NOTE = "FHFA's developmental annual county index: all transactions, not seasonally adjusted. Counties as FHFA names them; the FIPS code tells counties of one name apart.";

const countyRank = (id: string, order: "highest" | "lowest"): RankTileSpec => ({
  id,
  collection: "11_real_estate",
  datasetId: FHFA_COUNTY_2025,
  measure: "Annual Change (%)",
  title: order === "highest" ? "Counties with the largest annual house price change" : "Counties with the smallest annual house price change",
  subject: "annual change of the county house price index",
  entities: "counties in FHFA's annual index",
  unit: "Percent",
  decimals: 2,
  form: "ranked-bars",
  transform: "rank",
  headline: "rank",
  across: { by: "geo_code", period: "latest", top: 10, order },
  section: "Counties",
  note: COUNTY_NOTE,
});

const countyLine = (fips: string, label: string): TileSeriesSpec => ({ series: { by: "geo_code", key: fips }, label });

const HOUSING: TileSpec[] = [
  {
    id: "fhfa-states-change-map",
    collection: "11_real_estate",
    datasetId: FHFA_QUARTERLY_DATASET,
    measure: "index_sa",
    title: "FHFA purchase-only house price index by state, change over four quarters",
    subject: "The FHFA purchase-only index",
    entities: "states",
    unit: FHFA_Q_UNIT,
    decimals: 2,
    form: "map",
    transform: "change-12m",
    changeAs: "percent",
    headline: "rank",
    // the store's period dimension holds the year; the quarter is FHFA's own field `period`
    across: { by: "geo_code", period: "2026", where: [...FHFA_Q_FAMILY, { field: "period", value: "2" }] },
    section: "States and divisions",
    size: "wide",
    note: FHFA_Q_NOTE,
  } satisfies MapTileSpec,
  fhfaDivisions({
    id: "fhfa-divisions-east",
    title: "FHFA purchase-only index, change over four quarters: United States and eastern divisions",
    lines: [
      fhfaPlace("USA", "United States"),
      fhfaPlace("DV_NE", "New England"),
      fhfaPlace("DV_MA", "Middle Atlantic"),
      fhfaPlace("DV_SA", "South Atlantic"),
      fhfaPlace("DV_ENC", "East North Central"),
    ],
  }),
  fhfaDivisions({
    id: "fhfa-divisions-west",
    title: "FHFA purchase-only index, change over four quarters: central and western divisions",
    lines: [
      fhfaPlace("DV_PAC", "Pacific"),
      fhfaPlace("DV_MT", "Mountain"),
      fhfaPlace("DV_WSC", "West South Central"),
      fhfaPlace("DV_WNC", "West North Central"),
      fhfaPlace("DV_ESC", "East South Central"),
    ],
  }),
  countyRank("fhfa-counties-highest", "highest"),
  countyRank("fhfa-counties-lowest", "lowest"),
  {
    id: "fhfa-counties-compare",
    collection: "11_real_estate",
    datasetId: FHFA_COUNTY_HISTORY,
    measure: "HPI with 2000 base",
    title: "FHFA county house price index, 2000 = 100: Los Angeles, Cook, Harris, Maricopa and San Diego",
    subject: "The FHFA index for Los Angeles County",
    unit: "Index, 2000 = 100",
    decimals: 2,
    form: "compare",
    transform: "level",
    changeAs: "percent",
    headline: "level",
    lines: [
      countyLine("06037", "Los Angeles, CA"),
      countyLine("17031", "Cook, IL"),
      countyLine("48201", "Harris, TX"),
      countyLine("04013", "Maricopa, AZ"),
      countyLine("06073", "San Diego, CA"),
    ],
    window: 26,
    section: "Counties",
    note: COUNTY_NOTE,
  } satisfies CompareTileSpec,
  {
    id: "fhfa-county-records",
    collection: "11_real_estate",
    datasetId: FHFA_COUNTY_HISTORY,
    title: "Counties in FHFA's annual index, records by year",
    subject: "FHFA's annual county index",
    transform: "records",
    headline: "records",
    form: "bars",
    per: { dimension: "period", format: "year", by: "year" },
    section: "Counties",
    note: "One record per county and year as FHFA publishes them, from the county's first recorded year; a blank figure is a record too.",
  } satisfies RecordsTileSpec,
];

// ---------------------------------------------------------------- Technology

const TW_MONEY_UNIT = "thousands of source reporting currency (MOPS: 千元); no currency normalization";
const TW_COHORT =
  "The store's technology table: the exchange's industries 半導體業, 電腦及週邊設備業, 電子零組件業, 光電業, 通信網路業, 電子通路業, 資訊服務業, 其他電子業 and 數位雲端. Names as the exchange writes them; amounts in thousands of the reporting currency as MOPS states.";

const twRank = (id: string, datasetId: string, exchange: "TWSE" | "TPEX"): RankTileSpec => ({
  id,
  collection: "02_technology",
  datasetId,
  measure: "monthly_revenue",
  title: `Largest monthly operating revenue, ${exchange}-listed technology companies`,
  subject: "monthly operating revenue",
  entities: `companies in the ${exchange} technology table`,
  unit: TW_MONEY_UNIT,
  decimals: 0,
  form: "ranked-bars",
  transform: "rank",
  headline: "rank",
  across: { by: "entity_id", period: "latest", top: 10 },
  section: "Taiwan monthly revenue",
  note: TW_COHORT,
});

/** One economy of a fixed indicator: two cell filters inside one select of the 23,398-record table. */
const wbLine = (indicator: string, code: string, label: string): TileSeriesSpec => ({
  series: { where: [{ field: "indicator_code", value: indicator }, { field: "wb_country_code", value: code }] },
  label,
});

const wbCompare = (spec: { id: string; datasetId: string; title: string; indicator: { code: string; name: string; unit: string }; subject: string }): CompareTileSpec => ({
  id: spec.id,
  collection: "02_technology",
  datasetId: spec.datasetId,
  measure: "value",
  title: spec.title,
  subject: spec.subject,
  unit: spec.indicator.unit,
  decimals: 1,
  form: "compare",
  transform: "level",
  verb: "were",
  headline: "level",
  lines: [
    wbLine(spec.indicator.code, "KOR", "Korea, Rep."),
    wbLine(spec.indicator.code, "CHN", "China"),
    wbLine(spec.indicator.code, "USA", "United States"),
    wbLine(spec.indicator.code, "JPN", "Japan"),
    wbLine(spec.indicator.code, "DEU", "Germany"),
  ],
  window: 18,
  section: "Trade in technology",
  note: "World Bank, World Development Indicators. Economies as the World Bank names them.",
});

const KEV_NOTE = "CISA's catalog of vulnerabilities known to be exploited. The catalog opened on 3 Nov 2021 with 287 entries.";

const TECHNOLOGY: TileSpec[] = [
  twRank("twse-tech-revenue-top", TWSE_TECH, "TWSE"),
  twRank("tpex-tech-revenue-top", TPEX_TECH, "TPEX"),
  {
    id: "twse-tech-revenue-change",
    collection: "02_technology",
    datasetId: TWSE_TECH,
    measure: "year_over_year_pct",
    title: "Monthly revenue against the same month a year earlier, TWSE-listed technology companies",
    subject: "change on the same month a year earlier",
    entities: "companies in the TWSE technology table",
    unit: "Percent",
    decimals: 1,
    form: "distribution",
    transform: "level",
    headline: "median",
    across: { by: "entity_id", period: "latest" },
    draw: { as: "histogram", edges: ["-50", "-25", "-10", "0", "10", "25", "50", "100"] },
    section: "Taiwan monthly revenue",
    note: TW_COHORT,
  } satisfies DistributionTileSpec,
  {
    id: "twse-industries-records",
    collection: "02_technology",
    datasetId: TWSE_ALL,
    title: "Companies in TWSE's monthly revenue report, by industry",
    subject: "TWSE's monthly revenue report",
    transform: "records",
    headline: "records",
    form: "ranked-bars",
    per: { field: "產業別", top: 10 },
    section: "Taiwan monthly revenue",
    note: "One record per listed company for the reporting month; industries as the exchange names them.",
  } satisfies RecordsTileSpec,
  {
    id: "kev-added-by-month",
    collection: "02_technology",
    datasetId: KEV,
    title: "Known exploited vulnerabilities added to CISA's catalog, by month",
    subject: "CISA's Known Exploited Vulnerabilities catalog",
    transform: "records",
    headline: "records",
    form: "bars",
    per: { field: "dateAdded", format: "iso-date", by: "month", window: 36 },
    section: "Known exploited vulnerabilities",
    size: "wide",
    note: KEV_NOTE,
  } satisfies RecordsTileSpec,
  {
    id: "kev-added-by-year",
    collection: "02_technology",
    datasetId: KEV,
    title: "Known exploited vulnerabilities added to CISA's catalog, by year",
    subject: "CISA's Known Exploited Vulnerabilities catalog",
    transform: "records",
    headline: "records",
    form: "bars",
    per: { field: "dateAdded", format: "iso-date", by: "year" },
    section: "Known exploited vulnerabilities",
    note: `${KEV_NOTE} The latest year is counted to the date of the stored copy.`,
  } satisfies RecordsTileSpec,
  {
    id: "kev-by-vendor",
    collection: "02_technology",
    datasetId: KEV,
    title: "Vendors with the most known exploited vulnerabilities",
    subject: "CISA's Known Exploited Vulnerabilities catalog",
    transform: "records",
    headline: "records",
    form: "ranked-bars",
    per: { dimension: "entity_name", top: 10 },
    section: "Known exploited vulnerabilities",
    note: "Vendor or project as CISA writes it.",
  } satisfies RecordsTileSpec,
  {
    id: "kev-ransomware",
    collection: "02_technology",
    datasetId: KEV,
    title: "Known use in ransomware campaigns",
    subject: "CISA's Known Exploited Vulnerabilities catalog",
    transform: "records",
    headline: "records",
    form: "ranked-bars",
    per: { field: "knownRansomwareCampaignUse", top: 2 },
    section: "Known exploited vulnerabilities",
    note: "CISA marks an entry Known when the vulnerability is known to have been used in a ransomware campaign; Unknown otherwise.",
  } satisfies RecordsTileSpec,
  wbCompare({
    id: "wb-high-tech-exports",
    datasetId: WB_TECH_FULL,
    title: "High-technology exports (% of manufactured exports)",
    indicator: WB_HIGH_TECH,
    subject: "High-technology exports of Korea",
  }),
  wbCompare({
    id: "wb-ict-goods-exports",
    datasetId: WB_TECH_SHORT,
    title: "ICT goods exports (% of total goods exports)",
    indicator: WB_ICT_GOODS,
    subject: "ICT goods exports of Korea",
  }),
];

// ---------------------------------------------------------------- Health care

const PARTD_UNIT = "USD nominal gross drug spending";
const PARTD_NOTE = "Gross drug cost as CMS defines it: ingredient cost, dispensing fees, sales tax and vaccine administration fees, before manufacturers' rebates. Overall rows: each drug across its manufacturers.";

const drug = (brand: string, generic: string): TileSeriesSpec => ({
  series: { where: [{ field: "brand_name", value: brand }, { field: "generic_name", value: generic }] },
  label: brand,
  subjectCheck: { field: "manufacturer_scope", value: "Overall" },
});

const fdaLine = (type: string, status: string, label: string): TileSeriesSpec => ({
  series: { where: [{ field: "application_type", value: type }, { field: "submission_status", value: status }] },
  label,
});

const FDA_COUNT_NOTE = "Original submissions in Drugs@FDA by the year of their status date, as the store counted them from FDA's Submissions file. The latest year is counted to the date of FDA's file.";

const HEALTH: TileSpec[] = [
  {
    id: "partd-top-drugs",
    collection: "03_healthcare",
    datasetId: PARTD,
    measure: "Tot_Spndng",
    title: "Medicare Part D total spending: Eliquis, Ozempic, Jardiance, Mounjaro and Xarelto",
    subject: "Part D spending on Eliquis",
    unit: PARTD_UNIT,
    decimals: 0,
    form: "compare",
    transform: "level",
    changeAs: "percent",
    headline: "level",
    lines: [
      drug("Eliquis", "Apixaban"),
      drug("Ozempic", "Semaglutide"),
      drug("Jardiance", "Empagliflozin"),
      drug("Mounjaro", "Tirzepatide"),
      drug("Xarelto", "Rivaroxaban"),
    ],
    window: 5,
    section: "Medicare Part D",
    size: "wide",
    note: `${PARTD_NOTE} The five drugs with the largest 2024 spending in the table.`,
  } satisfies CompareTileSpec,
  {
    id: "partd-ozempic",
    collection: "03_healthcare",
    datasetId: PARTD,
    measure: "Tot_Spndng",
    title: "Medicare Part D total spending on Ozempic (semaglutide)",
    subject: "Part D spending on Ozempic",
    unit: PARTD_UNIT,
    decimals: 0,
    form: "bars",
    transform: "level",
    changeAs: "percent",
    headline: "level",
    series: { where: [{ field: "brand_name", value: "Ozempic" }, { field: "generic_name", value: "Semaglutide" }] },
    subjectCheck: { field: "manufacturer_scope", value: "Overall" },
    window: 5,
    section: "Medicare Part D",
    note: PARTD_NOTE,
  } satisfies SeriesTileSpec,
  {
    id: "partd-ozempic-per-claim",
    collection: "03_healthcare",
    datasetId: PARTD,
    measure: "Avg_Spnd_Per_Clm",
    title: "Average Part D spending per claim, Ozempic",
    subject: "Average Part D spending per claim for Ozempic",
    unit: "USD per claim",
    decimals: 2,
    form: "stat",
    transform: "level",
    headline: "level",
    series: { where: [{ field: "brand_name", value: "Ozempic" }, { field: "generic_name", value: "Semaglutide" }] },
    changeAs: "percent",
    window: 5,
    section: "Medicare Part D",
    note: "Part D spending divided by the number of prescription fills (CMS).",
  } satisfies StatTileSpec,
  {
    id: "partd-eliquis-claims",
    collection: "03_healthcare",
    datasetId: PARTD,
    measure: "Tot_Clms",
    title: "Part D claims for Eliquis",
    subject: "Part D claims for Eliquis",
    verb: "were",
    unit: "claims",
    decimals: 0,
    form: "stat",
    transform: "level",
    headline: "level",
    series: { where: [{ field: "brand_name", value: "Eliquis" }, { field: "generic_name", value: "Apixaban" }] },
    changeAs: "percent",
    window: 5,
    section: "Medicare Part D",
    note: "Prescription fills, original prescriptions and refills (CMS).",
  } satisfies StatTileSpec,
  {
    id: "fda-nda-approvals",
    collection: "03_healthcare",
    datasetId: FDA_ORIGINAL_COUNTS,
    measure: "original_submission_record_count",
    title: "Original new drug applications approved, by year (Drugs@FDA)",
    subject: "Drugs@FDA records of original NDAs approved",
    verb: "were",
    unit: "records",
    decimals: 0,
    form: "bars",
    transform: "level",
    headline: "level",
    series: { where: [{ field: "application_type", value: "NDA" }, { field: "submission_status", value: "AP" }] },
    window: 26,
    section: "Drug approvals",
    note: FDA_COUNT_NOTE,
  } satisfies SeriesTileSpec,
  {
    id: "fda-nda-bla-approvals",
    collection: "03_healthcare",
    datasetId: FDA_ORIGINAL_COUNTS,
    measure: "original_submission_record_count",
    title: "Original NDAs and BLAs approved, by year (Drugs@FDA)",
    subject: "Drugs@FDA records of original NDAs approved",
    verb: "were",
    unit: "records",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [fdaLine("NDA", "AP", "NDA"), fdaLine("BLA", "AP", "BLA")],
    window: 26,
    section: "Drug approvals",
    note: `${FDA_COUNT_NOTE} Drugs@FDA lists the biologics CDER regulates.`,
  } satisfies CompareTileSpec,
  {
    id: "fda-anda-approvals",
    collection: "03_healthcare",
    datasetId: FDA_ORIGINAL_COUNTS,
    measure: "original_submission_record_count",
    title: "Original generic drug applications (ANDAs) approved and tentatively approved, by year",
    subject: "Drugs@FDA records of original ANDAs approved",
    verb: "were",
    unit: "records",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [fdaLine("ANDA", "AP", "Approved"), fdaLine("ANDA", "TA", "Tentatively approved")],
    window: 26,
    section: "Drug approvals",
    note: FDA_COUNT_NOTE,
  } satisfies CompareTileSpec,
  {
    id: "fda-sponsors",
    collection: "03_healthcare",
    datasetId: FDA_APPLICATIONS,
    title: "Sponsors with the most applications in Drugs@FDA",
    subject: "Drugs@FDA applications",
    transform: "records",
    headline: "records",
    form: "ranked-bars",
    per: { dimension: "entity_name", top: 10 },
    section: "Drug approvals",
    note: "One record per application (NDA, ANDA or BLA); sponsor names as FDA writes them.",
  } satisfies RecordsTileSpec,
  {
    id: "ob-exclusivity-codes",
    collection: "03_healthcare",
    datasetId: OB_EXCLUSIVITY,
    title: "Orange Book exclusivities by code",
    subject: "The Orange Book exclusivity file",
    transform: "records",
    headline: "records",
    form: "ranked-bars",
    per: { field: "Exclusivity_Code", top: 8 },
    section: "Orange Book",
    note: "One record per product and exclusivity; codes as FDA's Orange Book writes them (NCE new chemical entity, ODE orphan drug, PED pediatric).",
  } satisfies RecordsTileSpec,
];

// ---------------------------------------------------------------- Communications

const COMMUNICATIONS: TileSpec[] = [
  {
    id: "fcc-provider-records",
    collection: "10_communications",
    datasetId: FCC_PROVIDERS,
    title: "Fixed broadband providers in FCC's provider lookup table, by Form 477 date",
    subject: "FCC's fixed broadband provider lookup table",
    transform: "records",
    headline: "records",
    form: "bars",
    per: { dimension: "period", format: "mmmyyyy", by: "period" },
    section: "Broadband providers",
    size: "wide",
    note: "One record per holding company and Form 477 date (June and December), as FCC publishes them; the table's latest date is June 2021.",
  } satisfies RecordsTileSpec,
  {
    id: "caf-disbursement-records",
    collection: "10_communications",
    datasetId: CAF_DISBURSE,
    title: "Connect America Fund disbursement records by state",
    subject: "USAC's CAF disbursements and locations table",
    transform: "records",
    headline: "records",
    form: "map",
    per: { dimension: "geo_code", top: 60 },
    section: "Connect America Fund",
    size: "wide",
    note: "One record per study area, fund and filing year, as USAC publishes them.",
  } satisfies RecordsTileSpec,
  {
    id: "caf-speed-records",
    collection: "10_communications",
    datasetId: CAF_SPEED,
    title: "Connect America Fund speed tier records by state",
    subject: "USAC's CAF obligation and deployment by speed tier table",
    transform: "records",
    headline: "records",
    form: "map",
    per: { dimension: "geo_code", top: 60 },
    section: "Connect America Fund",
    note: "One record per study area, fund, filing year and obligated speed tier, as USAC publishes them.",
  } satisfies RecordsTileSpec,
  {
    id: "wb-telecom-records",
    collection: "10_communications",
    datasetId: WB_TELECOM,
    title: "World Bank telecom indicators: observations by year",
    subject: "The World Bank telecom indicator table",
    transform: "records",
    headline: "records",
    form: "bars",
    per: { dimension: "period", format: "year", by: "year", window: 30 },
    section: "World Bank indicators",
    note: "Seven indicators (subscriptions, Internet use, secure servers) for every economy and aggregate the World Bank lists.",
  } satisfies RecordsTileSpec,
  {
    id: "wb-telecom-missing",
    collection: "10_communications",
    datasetId: WB_TELECOM_MISSING,
    title: "World Bank telecom indicators: missing observations by year",
    subject: "The World Bank telecom missing observations table",
    transform: "records",
    headline: "records",
    form: "bars",
    per: { dimension: "period", format: "year", by: "year", window: 30 },
    section: "World Bank indicators",
    note: "Indicator, economy and year combinations the World Bank lists without a value.",
  } satisfies RecordsTileSpec,
];

// ---------------------------------------------------------------- boards

const ALL: readonly TileSpec[] = [...HOUSING, ...TECHNOLOGY, ...HEALTH, ...COMMUNICATIONS];

/**
 * Count tiles that read the store's facet counts (`source_facets`): the board tests' fake client answers no facet
 * call yet, so these wait off the boards (asked of the lead on 26 Nov 2026). Their exact production counts are in
 * `sectors.fixtures.json` under `facets`.
 */
export const FACET_TILES: ReadonlySet<string> = new Set([
  "fhfa-county-records",
  "kev-by-vendor",
  "fda-sponsors",
  "fcc-provider-records",
  "caf-disbursement-records",
  "caf-speed-records",
  "wb-telecom-records",
  "wb-telecom-missing",
]);

/** Tiles on the live board lists: every tile the engine computes on the fixture rows of `sectors.fixtures.json`. */
export const LIVE_TILES: ReadonlySet<string> = new Set(
  [...HOUSING, ...TECHNOLOGY, ...HEALTH, ...COMMUNICATIONS].map((t) => t.id).filter((id) => !FACET_TILES.has(id)),
);

/** Each board's tiles in board order, live and pending alike. */
const ORDER: Readonly<Record<string, readonly string[]>> = {
  "11_real_estate": HOUSING.map((t) => t.id),
  "02_technology": TECHNOLOGY.map((t) => t.id),
  "03_healthcare": HEALTH.map((t) => t.id),
  "10_communications": COMMUNICATIONS.map((t) => t.id),
  library: ["fhfa-states-change-map", "twse-tech-revenue-top"],
};

const live = (ids: readonly string[]) => ids.filter((id) => LIVE_TILES.has(id));

/** Tiles defined here that wait for the engine of unit `forms`, by board, in board order. */
export const PENDING_BOARD_TILES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(ORDER).map(([board, ids]) => [board, ids.filter((id) => !LIVE_TILES.has(id))]),
);

const NEW_BOARDS: readonly { id: string; title: string }[] = [
  { id: "10_communications", title: "Communications" },
  { id: "02_technology", title: "Technology" },
  { id: "03_healthcare", title: "Health care" },
];

/** A new board is listed once it holds a live tile, so no collection shows an empty board. */
const BOARDS: BoardSpec[] = NEW_BOARDS.flatMap((b) => {
  const tiles = live(ORDER[b.id]);
  return tiles.length ? [{ id: b.id, title: b.title, tiles }] : [];
});

/**
 * Tiles and boards added by round 6 unit `sectors`. Pure data: no network; no shared list is edited. Only live tiles are
 * given to the boards: the board tests require every defined tile to be on a board and to compute on fixture rows.
 */
export const SPECS: UnitSpecs = {
  unit: "sectors",
  tiles: ALL.filter((t) => LIVE_TILES.has(t.id)),
  boards: BOARDS,
  boardTiles: { "11_real_estate": live(ORDER["11_real_estate"]), library: live(ORDER.library) },
};

/** Every tile this unit defines, live and pending, for the tests and the report. */
export const SECTOR_TILES: readonly TileSpec[] = ALL;

/** Every board this unit fills, live and pending, in board order. */
export const SECTOR_BOARD_ORDER = ORDER;
