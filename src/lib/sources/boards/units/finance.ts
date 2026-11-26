import type { UnitSpecs } from "../compose";
import type {
  CompareTileSpec,
  MixTileSpec,
  RankTileSpec,
  RecordsTileSpec,
  SeriesTileSpec,
  StatTileSpec,
  TileSeriesSpec,
  TileSpec,
} from "../types";
import {
  FDIC_FAILURES_DATASET,
  H8_MONTHLY_DATASET,
  NCUA_CORE_DATASET,
  H8_MONTHLY_SERIES,
  H8_UNIT,
  OFR_MMF_DATASET,
  Z1_SECTORS_DATASET,
  Z1_TABLES,
  Z1_UNIT,
  h8Series,
  ofrSeries,
  z1Sector,
} from "../../profiles/units/finance";

/**
 * Tiles and boards added by round 6 unit `finance` (Banks and funds, collection 01_financials). Pure data: no
 * network; no shared list is edited. Every tile reads a family profiled in ../../profiles/units/finance.ts, or counts
 * records (no unit), and was computed once from production rows on 26 Nov 2026 (the unit's report lists each
 * headline with its period and snapshot). Titles and subjects use the publishers' words; notes state the publishers'
 * own caveats (adjustment, averaging, basis, cohort).
 */

const FIN = "01_financials";

const SECTION = {
  banks: "Bank balance sheets",
  deposits: "Deposits and branches",
  creditUnions: "Credit unions",
  funds: "Money market funds and repo",
  households: "Household and corporate balance sheets",
  failures: "Structure and failures",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// H.8: assets and liabilities of all commercial banks, monthly
// ---------------------------------------------------------------------------------------------------------------

const H8_NOTE = "Monthly levels are pro rata averages of Wednesday values, not seasonally adjusted: compare a month with the same month a year earlier.";

/** The record's own series description must be the one the Board gives the code. */
function h8Check(code: string) {
  const series = H8_MONTHLY_SERIES.find((s) => s.code === code);
  if (!series) throw new Error(`no H.8 monthly series ${code}`);
  return { field: "description", value: series.description };
}

const h8Line = (code: string, label: string, subject: string): TileSeriesSpec => ({ series: h8Series(code), label, subject, subjectCheck: h8Check(code) });

const bankAssets: SeriesTileSpec = {
  id: "banks-total-assets",
  collection: FIN,
  section: SECTION.banks,
  size: "wide",
  datasetId: H8_MONTHLY_DATASET,
  measure: "value_native",
  title: "Total assets, all commercial banks (H.8)",
  subject: "Total assets of all commercial banks",
  verb: "were",
  subjectCheck: h8Check("B1151NCBDM"),
  unit: H8_UNIT,
  decimals: 1,
  form: "line",
  transform: "level",
  changeAs: "percent",
  headline: "level",
  series: h8Series("B1151NCBDM"),
  window: 120,
  note: H8_NOTE,
};

const bankLoanGrowth: CompareTileSpec = {
  id: "banks-loan-growth",
  collection: FIN,
  section: SECTION.banks,
  datasetId: H8_MONTHLY_DATASET,
  measure: "value_native",
  title: "Loans at all commercial banks, change from a year earlier (H.8)",
  subject: "Commercial and industrial loans",
  unit: H8_UNIT,
  decimals: 1,
  form: "compare",
  transform: "change-12m",
  changeAs: "percent",
  headline: "change",
  lines: [
    h8Line("B1023NCBDM", "Commercial and industrial", "Commercial and industrial loans"),
    h8Line("B1026NCBDM", "Real estate", "Real estate loans"),
    h8Line("B1020NCBDM", "All loans and leases", "Loans and leases in bank credit"),
  ],
  window: 60,
  note: "Percent change from the same month a year earlier, from monthly levels that are pro rata averages of Wednesday values, not seasonally adjusted.",
};

const bankDeposits: StatTileSpec = {
  id: "banks-deposits",
  collection: FIN,
  section: SECTION.deposits,
  datasetId: H8_MONTHLY_DATASET,
  measure: "value_native",
  title: "Deposits, all commercial banks (H.8)",
  subject: "Deposits at all commercial banks",
  verb: "were",
  subjectCheck: h8Check("B1058NCBDM"),
  unit: H8_UNIT,
  decimals: 1,
  form: "stat",
  transform: "level",
  headline: "level",
  series: h8Series("B1058NCBDM"),
  changeAs: "percent",
  window: 24,
  note: H8_NOTE,
};

// ---------------------------------------------------------------------------------------------------------------
// Counts of records (no unit): the FDIC cohort's main offices, credit unions, failures
// ---------------------------------------------------------------------------------------------------------------

const cohortStates: RecordsTileSpec = {
  id: "cohort-institutions-by-state",
  collection: FIN,
  section: SECTION.deposits,
  datasetId: "official_01_financials_data_fdic_top500_current_institution_attributes_8fe835cdd1",
  title: "Institutions of the FDIC cohort by state of the main office",
  subject: "The FDIC cohort's institution file",
  transform: "records",
  headline: "records",
  form: "map",
  per: { dimension: "geo_code", top: 60 },
  note: "A fixed cohort of 500 insured institutions chosen by assets on 30 June 2026, one record each, placed by the state of the main office (STALP). Not every bank.",
};

const creditUnionStates: RecordsTileSpec = {
  id: "credit-unions-by-state",
  collection: FIN,
  section: SECTION.creditUnions,
  datasetId: NCUA_CORE_DATASET,
  title: "Credit unions by state, call reports for June 2026 (NCUA)",
  subject: "The NCUA call report file for June 2026",
  transform: "records",
  headline: "records",
  form: "map",
  per: { dimension: "geo_code", top: 60 },
  note: "One record per credit union that filed a call report for the quarter ending 30 June 2026, placed by the state of its main office. Includes the credit unions that are not federally insured (CU_TYPE 3), which NCUA's own counts leave out.",
};

const largestCreditUnions: RankTileSpec = {
  id: "largest-credit-unions",
  collection: FIN,
  section: SECTION.creditUnions,
  datasetId: NCUA_CORE_DATASET,
  measure: "assets_USD",
  title: "Largest credit unions by total assets, June 2026 (NCUA)",
  subject: "total assets",
  entities: "credit unions that filed call reports for June 2026",
  unit: "USD",
  decimals: 0,
  form: "ranked-bars",
  transform: "rank",
  headline: "rank",
  across: { by: "entity_id", period: "table", top: 10 },
  note: "Total assets (account 010) as each credit union reported them for the quarter ending 30 June 2026, in dollars.",
};

const mmfCategories: RecordsTileSpec = {
  id: "mmf-fund-categories",
  collection: FIN,
  section: SECTION.funds,
  datasetId: "official_01_financials_data_sec_nmfp_october2026_series_core_09a9c73b6e",
  title: "Money market fund reports by fund category, filed 8 October to 6 November 2026 (SEC N-MFP)",
  subject: "The SEC's N-MFP data set for filings of 8 October to 6 November 2026",
  transform: "records",
  headline: "records",
  form: "ranked-bars",
  per: { field: "MONEYMARKETFUNDCATEGORY", top: 6 },
  note: "Each record is one fund's N-MFP report, amendments included, counted by the category the fund reports.",
};

const costliestFailures: RankTileSpec = {
  id: "costliest-bank-failures",
  collection: FIN,
  section: SECTION.failures,
  datasetId: FDIC_FAILURES_DATASET,
  measure: "COST",
  title: "Failures since 2000 with the largest estimated loss to the Deposit Insurance Fund (FDIC)",
  subject: "estimated loss",
  entities: "failed or assisted institutions since 2000",
  unit: "USD thousands",
  decimals: 0,
  form: "ranked-bars",
  transform: "rank",
  headline: "rank",
  across: { by: "entity_id", period: "table", top: 10 },
  note: "The FDIC's estimate: what the Deposit Insurance Fund paid out for insured deposits less what it expects to recover from the receivership. Estimates change as receiverships wind down.",
};

const failuresPerYear: RecordsTileSpec = {
  id: "bank-failures-per-year",
  collection: FIN,
  section: SECTION.failures,
  size: "wide",
  datasetId: "official_01_financials_data_fdic_failures_and_assistance_1934_latest_6580a92fd4",
  title: "Failures and assistance transactions of FDIC-insured institutions, by year (FDIC)",
  subject: "The FDIC failures and assistance file",
  transform: "records",
  headline: "records",
  form: "bars",
  per: { field: "FAILYR", format: "year", by: "year", window: 60 },
  note: "Each record is one failure or one assistance transaction of an FDIC-insured institution since 1934, counted by the year the FDIC gives it (FAILYR).",
};

// ---------------------------------------------------------------------------------------------------------------
// Z.1: financial accounts (sector totals, households, debt by sector)
// ---------------------------------------------------------------------------------------------------------------

const Z1_NOTE_NSA = "Amounts outstanding at the end of the quarter, not seasonally adjusted. Financial Accounts of the United States (Z.1).";

function z1Table(prefix: string) {
  const table = Z1_TABLES.find((t) => t.table.startsWith(`${prefix} `));
  if (!table) throw new Error(`no checked Z.1 table ${prefix}`);
  return table;
}

const creditUnionAssets: SeriesTileSpec = {
  id: "credit-unions-financial-assets",
  collection: FIN,
  section: SECTION.creditUnions,
  datasetId: Z1_SECTORS_DATASET,
  measure: "value_native",
  title: "Credit unions; total financial assets (Z.1, table S122.4.s)",
  subject: "Total financial assets of credit unions",
  verb: "were",
  subjectCheck: { field: "description", value: "Credit unions; total financial assets" },
  unit: Z1_UNIT,
  decimals: 0,
  form: "bars",
  transform: "level",
  changeAs: "percent",
  headline: "level",
  series: z1Sector("FL474090005.Q"),
  window: 24,
  note: Z1_NOTE_NSA,
};

const householdNetWorth: SeriesTileSpec = {
  id: "household-net-worth",
  collection: FIN,
  section: SECTION.households,
  datasetId: z1Table("S1M.b").datasetId,
  measure: "FL152090005.Q",
  title: "Households and nonprofit organizations; net worth (Z.1, table S1M.b)",
  subject: "The net worth of households and nonprofit organizations",
  unit: Z1_UNIT,
  decimals: 0,
  form: "bars",
  transform: "level",
  changeAs: "percent",
  headline: "level",
  series: { whole: true },
  window: 24,
  note: Z1_NOTE_NSA,
};

const D3S = z1Table("D3.s").datasetId;
const d3Part = (code: string, label: string, subject: string): TileSeriesSpec => ({ datasetId: D3S, measure: code, series: { whole: true }, label, subject });

const debtBySector: MixTileSpec = {
  id: "debt-by-sector",
  collection: FIN,
  section: SECTION.households,
  size: "wide",
  datasetId: D3S,
  measure: "LA384104005.Q",
  title: "Debt outstanding by sector, domestic nonfinancial sectors (Z.1, table D3.s)",
  subject: "Federal government debt",
  unit: Z1_UNIT,
  decimals: 0,
  form: "mix",
  transform: "level",
  headline: "share",
  whole: d3Part("LA384104005.Q", "Domestic nonfinancial sectors", "debt of the domestic nonfinancial sectors"),
  parts: [
    d3Part("LA314104005.Q", "Federal government", "Federal government debt"),
    d3Part("LA154104005.Q", "Households and nonprofit organizations", "household debt"),
    d3Part("LA144104005.Q", "Nonfinancial business", "nonfinancial business debt"),
    d3Part("LA214104005.Q", "State and local governments", "state and local government debt"),
  ],
  draw: "areas",
  // the Board rounds each figure to the nearest million: four parts may differ from the total by up to 2
  tolerance: "2",
  window: 80,
  note: "Debt securities and loans outstanding at the end of the quarter, seasonally adjusted. The total is the Board's own line, never the sum of the parts.",
};

const D3G = z1Table("D3.g").datasetId;
const d3Growth = (code: string, label: string, subject: string): TileSeriesSpec => ({ datasetId: D3G, measure: code, series: { whole: true }, label, subject });

const debtGrowth: CompareTileSpec = {
  id: "debt-growth-by-sector",
  collection: FIN,
  section: SECTION.households,
  datasetId: D3G,
  measure: "FG384104005.Q",
  title: "Debt growth by sector (Z.1, table D3.g)",
  subject: "The growth rate of domestic nonfinancial debt",
  unit: "Percent",
  decimals: 1,
  form: "compare",
  transform: "level",
  headline: "level",
  lines: [
    d3Growth("FG384104005.Q", "Domestic nonfinancial sectors", "The growth rate of domestic nonfinancial debt"),
    d3Growth("FG154104005.Q", "Households", "household debt growth"),
    d3Growth("FG144104005.Q", "Nonfinancial business", "nonfinancial business debt growth"),
    d3Growth("FG314104005.Q", "Federal government", "federal government debt growth"),
  ],
  window: 40,
  changeAs: "difference",
  note: "Percent growth at a seasonally adjusted annual rate, as the Board publishes it in table D3.g; not computed here.",
};

// ---------------------------------------------------------------------------------------------------------------
// OFR: money market fund investments and repo yields (from the funds' N-MFP reports)
// ---------------------------------------------------------------------------------------------------------------

const ofrPart = (mnemonic: string, label: string, subject: string): TileSeriesSpec => ({ series: ofrSeries(mnemonic), label, subject });

const mmfMix: MixTileSpec = {
  id: "mmf-investments-mix",
  collection: FIN,
  section: SECTION.funds,
  size: "wide",
  datasetId: OFR_MMF_DATASET,
  measure: "value_native",
  title: "Money market fund investments by asset class (OFR)",
  subject: "U.S. Treasury securities",
  unit: "USD",
  decimals: 2,
  form: "mix",
  transform: "share",
  headline: "share",
  whole: ofrPart("MMF-MMF_TOT-M", "Total", "money market fund investments"),
  parts: [
    ofrPart("MMF-MMF_T_TOT-M", "U.S. Treasury securities", "U.S. Treasury securities"),
    ofrPart("MMF-MMF_RP_TOT-M", "Repurchase agreements", "repurchase agreements"),
    ofrPart("MMF-MMF_AG_TOT-M", "Federal agency and GSE securities", "federal agency and GSE securities"),
    ofrPart("MMF-MMF_BRA_TOT-M", "Bank-related assets", "bank-related assets"),
    ofrPart("MMF-MMF_OA_TOT-M", "Other assets", "other assets"),
  ],
  draw: "areas",
  // OFR states the figures to the cent and lists these five as the parts of the total; they add up exactly
  tolerance: "0.01",
  window: 120,
  note: "Month-end holdings of U.S. money market funds from their Form N-MFP reports, as OFR aggregates them. Share of the total is 100 × part ÷ total.",
};

const mmfRepoYield: SeriesTileSpec = {
  id: "mmf-repo-yield",
  collection: FIN,
  section: SECTION.funds,
  datasetId: OFR_MMF_DATASET,
  measure: "value_native",
  title: "Median yield on money market fund investments in repurchase agreements (OFR)",
  subject: "The median yield money market funds received on repurchase agreements",
  unit: "Percent",
  decimals: 2,
  form: "line",
  transform: "level",
  changeAs: "difference",
  headline: "level",
  series: ofrSeries("MMF-MY_MMF_RP_TOT-M"),
  window: 60,
  note: "Month-end, from the funds' Form N-MFP reports: the median across funds' repurchase agreements, as OFR publishes it.",
};

const TILES: readonly TileSpec[] = [
  bankAssets,
  bankLoanGrowth,
  bankDeposits,
  cohortStates,
  creditUnionAssets,
  largestCreditUnions,
  creditUnionStates,
  mmfMix,
  mmfRepoYield,
  mmfCategories,
  householdNetWorth,
  debtBySector,
  debtGrowth,
  failuresPerYear,
  costliestFailures,
];

/** The tiles this unit puts on the Banks and funds board, in board order (sections follow their first tile). */
export const FINANCE_BOARD_TILES: readonly string[] = [
  "banks-total-assets",
  "banks-loan-growth",
  "banks-deposits",
  "cohort-institutions-by-state",
  "credit-unions-financial-assets",
  "largest-credit-unions",
  "credit-unions-by-state",
  "mmf-investments-mix",
  "mmf-repo-yield",
  "mmf-fund-categories",
  "household-net-worth",
  "debt-by-sector",
  "bank-failures-per-year",
  "costliest-bank-failures",
];

/** Tiles and boards added by round 6 unit `finance`. Pure data: no network; no shared list is edited. */
export const SPECS: UnitSpecs = {
  unit: "finance",
  tiles: TILES,
  boards: [],
  boardTiles: {
    [FIN]: FINANCE_BOARD_TILES,
    "00_universal": ["household-net-worth", "debt-growth-by-sector"],
    library: ["banks-total-assets", "mmf-investments-mix"],
  },
};
