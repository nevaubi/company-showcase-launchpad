import { defineProfile } from "../define";
import type { FieldMatch, MeasureSpec, Profile, ProfileDataset, ProfileEntry } from "../types";

/**
 * Profile families of round 6 unit `finance` (Banks and funds, collection 01_financials), each with its proof (see
 * ../registry.ts for the rule). Every family below was read on production on 26 Nov 2026 (dictionary and rows) and
 * compared with the publisher's own file retrieved that day; the values compared are in finance.checks.json and the
 * unit's report. Families of the collection that are not here were refused, with the reason, in that report.
 */

/** The day the families below were checked, UTC. */
export const FINANCE_CHECKED = "2026-11-26";

// ---------------------------------------------------------------------------------------------------------------
// Federal Reserve H.8, monthly headline balances of all commercial banks
// ---------------------------------------------------------------------------------------------------------------

export const H8_MONTHLY_DATASET = "official_01_financials_data_fed_h8_monthly_headline_balances_2000_latest_ad2cb5f5f5";
export const H8_MONTHLY_SNAPSHOT = "4598d415126fdd93dd72c72a952d0813a478829dddd81d93b0c3efd78bd40b6a";
export const H8_UNIT = "Millions of dollars";
export const H8_PACKAGE = "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H8&filetype=zip";
const H8_EVIDENCE = `${H8_PACKAGE} (H8_data.xml: each of the six series carries UNIT="Currency", UNIT_MULT="1000000", CURRENCY="USD")`;

/** The record fields that state the currency and multiplier of every H.8 record; a record that states others is not drawn. */
export const H8_FIXED: readonly FieldMatch[] = [
  { field: "unit", value: "USD" },
  { field: "unit_multiplier", value: "1000000" },
];

/** The six series of the table, with the description every record of each carries (the Board's series description). */
export const H8_MONTHLY_SERIES: readonly { code: string; description: string }[] = [
  { code: "B1020NCBDM", description: "Loans and leases in bank credit, all commercial banks, not seasonally adjusted" },
  { code: "B1023NCBDM", description: "Commercial and industrial loans, all commercial banks, not seasonally adjusted" },
  { code: "B1026NCBDM", description: "Real estate loans, all commercial banks, not seasonally adjusted" },
  { code: "B1048NCBDM", description: "Cash assets, all commercial banks, not seasonally adjusted" },
  { code: "B1058NCBDM", description: "Deposits, all commercial banks, not seasonally adjusted" },
  { code: "B1151NCBDM", description: "Total assets, all commercial banks, not seasonally adjusted" },
];

/** An H.8 series as the table's address: its code with the currency and multiplier its unit rests on. */
export const h8Series = (code: string) => ({ where: [{ field: "series", value: code }, ...H8_FIXED] });

/**
 * H.8 monthly headline balances (Assets and Liabilities of Commercial Banks in the United States): one record per
 * series and month, `series` (the Board's series name), `description`, `date` (the month's last day, the period
 * dimension), `value_native`, `status`, `unit` ("USD") and `unit_multiplier` ("1000000"). The Board's data package
 * states the unit of every series as currency USD with multiplier 1,000,000, so a value is in millions of dollars;
 * the release tables print the same data in billions. A record must carry "USD" and "1000000" to be drawn (`fixed`).
 * Monthly levels are pro rata averages of Wednesday values (the release's notes). The table has no indexed series
 * key: a series is a cell filter, allowed on 1,932 records, on `description` for a reader picking one (each of the six
 * descriptions belongs to one series code) or on `series` for a tile.
 * Checked on 26 Nov 2026: all 1,932 records (date, value and status of the six series, Jan 2000 to Oct 2026) equal
 * the Board's H.8 package retrieved that day.
 */
const h8Claims = (d: ProfileDataset) => d.source_id === "FED_H8" && d.id === H8_MONTHLY_DATASET;

function h8Profile(): Profile {
  return defineProfile(h8Claims, {
    family: "fed-h8",
    period: { from: "dimension", format: "iso-date" },
    cadence: "month",
    fixed: H8_FIXED,
    // "Level" is the Board's own word for these series (H8_UNITS="LEVEL" in the package)
    measures: [{ field: "value_native", label: "Level", unit: { from: "constant", text: H8_UNIT, evidence: H8_EVIDENCE }, grouping: "none" }],
    extraFields: ["date", "series"],
    addressing: {
      by: null,
      where: ["description"],
      scan: "table",
      rowsScanned: 1932,
      note: "A series is the records of one series description (one series code each), found by a cell filter with the unit fields; the table has 1,932 records.",
    },
    defaultSeries: () => ({ where: [{ field: "description", value: "Total assets, all commercial banks, not seasonally adjusted" }, ...H8_FIXED] }),
    firstLook: "series",
    proof: {
      snapshotId: H8_MONTHLY_SNAPSHOT,
      datasetId: H8_MONTHLY_DATASET,
      checked: FINANCE_CHECKED,
      documentation: [H8_PACKAGE, "https://www.federalreserve.gov/releases/h8/current/default.htm"],
    },
  });
}

export const FED_H8_ENTRY: ProfileEntry = { family: "fed-h8", claims: h8Claims, profile: h8Profile };

// ---------------------------------------------------------------------------------------------------------------
// Federal Reserve Z.1 Financial Accounts of the United States
// ---------------------------------------------------------------------------------------------------------------

export const Z1_PACKAGE = "https://www.federalreserve.gov/releases/z1/current/z1_csv_files.zip";
export const Z1_UNIT = "Millions of dollars";
export const Z1_PERCENT = "Percent";
/** The unit and basis the Z.1 data dictionary states, as written there. */
export const Z1_OUTSTANDING_NSA = "Millions of dollars; amounts outstanding end of period, not seasonally adjusted";
export const Z1_OUTSTANDING_SA = "Millions of dollars; amounts outstanding end of period, seasonally adjusted";
export const Z1_GROWTH_SAAR = "Percent growth rate, seasonally adjusted annual rate";

export const Z1_SECTORS_DATASET = "official_01_financials_data_fed_z1_financial_sector_headline_history_273e0e218c";
export const Z1_SECTORS_SNAPSHOT = "c306162046f21ea5677bc7b5355eac1140789c7d212cc10633e6dca9e6e35083";

/** A financial sector's series in the sector history: one series id with the unit and basis its unit rests on. */
export const z1Sector = (seriesId: string) => ({
  by: "entity_id" as const,
  key: seriesId,
  where: [{ field: "unit_and_basis", value: Z1_OUTSTANDING_NSA }],
});

/**
 * Z.1 financial-sector balance histories: one record per series and quarter for 39 series, the total financial
 * assets of each financial sector (S-tables of the release: money market funds, credit unions, pension funds,
 * insurers, hedge funds and the domestic financial sectors together). `series_id` is the indexed entity; the field
 * `period` holds the quarter as the Board writes it ("2026:Q2"; the table has no period dimension); `value_native` the figure;
 * `source_value_or_flag` the publisher's cell where it is a flag ("ND", no figure: then `value_native` is empty, a
 * gap); `unit_and_basis` the unit and basis from the Board's data dictionary. The profile draws the 36 series whose
 * dictionary entry is "Millions of dollars; amounts outstanding end of period, not seasonally adjusted" (`fixed`); the
 * three market-value series (mutual funds, closed-end funds, exchange-traded funds) are left out.
 * Checked on 26 Nov 2026: all 11,895 records equal the Board's z1_csv_files.zip of 11 Sep 2026 (the 2026:Q2 release),
 * value for value, the one "ND" (foreign hedge funds, 2026:Q2) kept as the flag.
 */
const z1SectorsClaims = (d: ProfileDataset) => d.source_id === "FED_Z1" && d.id === Z1_SECTORS_DATASET;

function z1SectorsProfile(): Profile {
  return defineProfile(z1SectorsClaims, {
    family: "fed-z1-sectors",
    entityNoun: { one: "series", many: "series" },
    period: { from: "field", field: "period", format: "quarter" },
    cadence: "quarter",
    fixed: [{ field: "unit_and_basis", value: Z1_OUTSTANDING_NSA }],
    measures: [
      {
        field: "value_native",
        label: "Total financial assets",
        unit: { from: "constant", text: Z1_UNIT, evidence: `${Z1_PACKAGE} (data_dictionary: "${Z1_OUTSTANDING_NSA}")` },
        grouping: "none",
      },
    ],
    extraFields: ["series_id", "description"],
    addressing: {
      by: "entity_id",
      where: ["unit_and_basis"],
      scan: "key",
      rowsScanned: 305,
      note: "A series is one series id through the entity index (305 quarters); its unit and basis are matched after the read.",
    },
    defaultSeries: () => z1Sector("FL794090005.Q"),
    firstLook: "series",
    proof: {
      snapshotId: Z1_SECTORS_SNAPSHOT,
      datasetId: Z1_SECTORS_DATASET,
      checked: FINANCE_CHECKED,
      documentation: [Z1_PACKAGE, "https://www.federalreserve.gov/releases/z1/"],
    },
  });
}

export const FED_Z1_SECTORS_ENTRY: ProfileEntry = { family: "fed-z1-sectors", claims: z1SectorsClaims, profile: z1SectorsProfile };

/**
 * One series of a Z.1 release table: its code (the field label), the Board's description, its label (the description
 * less the words the table's title already states, for the measure picker) and its unit as stated.
 */
export type Z1Series = { code: string; description: string; label: string; unit: typeof Z1_UNIT | typeof Z1_PERCENT };

/** A Z.1 release table as the store keeps it: a `date` column and one column per series, one record per quarter. */
export type Z1Table = {
  /** The Board's table, as its data dictionary names it. */
  table: string;
  datasetId: string;
  snapshotId: string;
  /** The unit and basis the data dictionary states for every series listed, as written there. */
  basis: string;
  series: readonly Z1Series[];
  /** The series a first look opens on. */
  first: string;
};

/** Checked on 26 Nov 2026: each table, every cell of its 305 records, equals the Board's csv file of the same name. */
export const Z1_TABLES: readonly Z1Table[] = [
  {
    table: "S1M.b Households and nonprofit organizations",
    datasetId: "official_01_financials_data_fed_z1_native_tables_csv_s1m_b_8a22b7d4e6",
    snapshotId: "14af3d2dc0294c69f4f7df640c28ae5f471c2740c1e76f92266449afaa0b309c",
    basis: Z1_OUTSTANDING_NSA,
    series: [
      { code: "FL152090005.Q", description: "Households and nonprofit organizations; net worth", label: "Net worth", unit: Z1_UNIT },
      { code: "FL152000005.Q", description: "Households and nonprofit organizations; total assets", label: "Total assets", unit: Z1_UNIT },
      { code: "FL154090005.Q", description: "Households and nonprofit organizations; total financial assets", label: "Total financial assets", unit: Z1_UNIT },
      { code: "FL154190005.Q", description: "Households and nonprofit organizations; total liabilities", label: "Total liabilities", unit: Z1_UNIT },
      { code: "FL153165105.Q", description: "Households and nonprofit organizations; one-to-four-family residential mortgages; liability", label: "One-to-four-family residential mortgages; liability", unit: Z1_UNIT },
      { code: "FL153166000.Q", description: "Households and nonprofit organizations; consumer credit; liability", label: "Consumer credit; liability", unit: Z1_UNIT },
    ],
    first: "FL152090005.Q",
  },
  {
    table: "D3.s Debt outstanding by sector",
    datasetId: "official_01_financials_data_fed_z1_native_tables_csv_d3_s_37623d2b04",
    snapshotId: "a455ab17ed3b8d37ba3540450b458eaf1939e45b4834ff26c5393edb1ed019f8",
    basis: Z1_OUTSTANDING_SA,
    series: [
      { code: "LA384104005.Q", description: "Domestic nonfinancial sectors; debt securities and loans; liability", label: "Domestic nonfinancial sectors; debt securities and loans", unit: Z1_UNIT },
      { code: "LA154104005.Q", description: "Households and nonprofit organizations; debt securities and loans; liability", label: "Households and nonprofit organizations; debt securities and loans", unit: Z1_UNIT },
      { code: "LA144104005.Q", description: "Nonfinancial business; debt securities and loans; liability", label: "Nonfinancial business; debt securities and loans", unit: Z1_UNIT },
      { code: "LA314104005.Q", description: "Federal government; debt securities and loans; liability", label: "Federal government; debt securities and loans", unit: Z1_UNIT },
      { code: "LA214104005.Q", description: "State and local governments; debt securities and loans; liability", label: "State and local governments; debt securities and loans", unit: Z1_UNIT },
      { code: "LA794104005.Q", description: "Domestic financial sectors; debt securities and loans; liability", label: "Domestic financial sectors; debt securities and loans", unit: Z1_UNIT },
      { code: "LA264104005.Q", description: "Rest of the world; debt securities and loans; liability", label: "Rest of the world; debt securities and loans", unit: Z1_UNIT },
    ],
    first: "LA384104005.Q",
  },
  {
    table: "D3.g Debt growth by sector",
    datasetId: "official_01_financials_data_fed_z1_native_tables_csv_d3_g_95c85e248e",
    snapshotId: "8a6a503939153c028cd056bdeaf5dc74fc745ecf2d59dc4341f5394b17965dd3",
    basis: Z1_GROWTH_SAAR,
    series: [
      { code: "FG384104005.Q", description: "Domestic nonfinancial sectors; debt securities and loans; liability", label: "Domestic nonfinancial sectors; debt securities and loans", unit: Z1_PERCENT },
      { code: "FG154104005.Q", description: "Households and nonprofit organizations; debt securities and loans; liability", label: "Households and nonprofit organizations; debt securities and loans", unit: Z1_PERCENT },
      { code: "FG144104005.Q", description: "Nonfinancial business; debt securities and loans; liability", label: "Nonfinancial business; debt securities and loans", unit: Z1_PERCENT },
      { code: "FG314104005.Q", description: "Federal government; debt securities and loans; liability", label: "Federal government; debt securities and loans", unit: Z1_PERCENT },
      { code: "FG214104005.Q", description: "State and local governments; debt securities and loans; liability", label: "State and local governments; debt securities and loans", unit: Z1_PERCENT },
    ],
    first: "FG384104005.Q",
  },
];

const Z1_BY_DATASET = new Map(Z1_TABLES.map((t) => [t.datasetId, t] as const));

/**
 * Z.1 release tables (the Board's csv files, one table each): `date` is the period dimension, written "2026:Q2";
 * every other field is one series, labelled by its series code. A measure is a series
 * listed in `Z1_TABLES` with the unit its data dictionary entry states ("Millions of dollars", or "Percent" for a
 * growth rate); the basis (amounts outstanding at the end of the quarter, seasonal adjustment, annual rate) is the
 * table's and goes in each tile's note. "ND" cells are the Board's own (no figure) and are gaps. A table is one
 * series per field: the whole snapshot (305 quarters) is read.
 */
const z1TableClaims = (d: ProfileDataset) => d.source_id === "FED_Z1" && Z1_BY_DATASET.has(d.id);

function z1TableProfile(dataset: ProfileDataset): Profile {
  const table = Z1_BY_DATASET.get(dataset.id);
  if (!table) throw new Error(`no checked Z.1 table for ${dataset.id}`);
  const first = table.series.find((s) => s.code === table.first) ?? table.series[0];
  const ordered = [first, ...table.series.filter((s) => s !== first)];
  const measures: MeasureSpec[] = ordered.map((s) => ({
    field: s.code,
    label: s.label,
    unit: { from: "constant", text: s.unit, evidence: `${Z1_PACKAGE} (data_dictionary, ${s.code}: "${table.basis}")` },
    grouping: "none",
  }));
  return defineProfile(z1TableClaims, {
    family: "fed-z1-table",
    period: { from: "dimension", format: "quarter" },
    cadence: "quarter",
    measures,
    extraFields: ["date"],
    addressing: {
      by: null,
      where: [],
      scan: "table",
      rowsScanned: 305,
      note: "One record per quarter, one field per series: the whole snapshot (305 records) is read in row order.",
    },
    defaultSeries: () => ({ whole: true }),
    firstLook: "series",
    proof: {
      snapshotId: table.snapshotId,
      datasetId: table.datasetId,
      checked: FINANCE_CHECKED,
      documentation: [Z1_PACKAGE, "https://www.federalreserve.gov/releases/z1/"],
    },
  });
}

export const FED_Z1_TABLE_ENTRY: ProfileEntry = { family: "fed-z1-table", claims: z1TableClaims, profile: z1TableProfile };

// ---------------------------------------------------------------------------------------------------------------
// OFR Short-term Funding Monitor, U.S. money market fund monthly data
// ---------------------------------------------------------------------------------------------------------------

export const OFR_MMF_DATASET = "official_01_financials_data_ofr_mmf_complete_monthly_history_e039b3593e";
export const OFR_MMF_SNAPSHOT = "9ec6d14fabd3bec203b84fb2c89d50305a4eb2b3d7acf4588fa70d81fdfcc69d";
export const OFR_API = "https://data.financialresearch.gov/v1/metadata/query?mnemonic=MMF-MMF_TOT-M";

/** An OFR money market fund series as the table's address. */
export const ofrSeries = (mnemonic: string) => ({ where: [{ field: "mnemonic", value: mnemonic }] });

/**
 * OFR U.S. Money Market Fund Data Release, monthly (from the funds' Form N-MFP filings): one record per series and
 * month, `mnemonic` (OFR's series code), `date` (the month's last day, the period dimension), `value_native` and
 * `unit` as OFR's metadata names it: "USD" for investment volumes (magnitude 0: dollars, not thousands or millions)
 * and "Percent" for median yields. The unit is read from each record, so a volume and a yield never share an axis.
 * OFR's metadata lists the five parts of "Money Market Mutual Fund Investments: Total" (Treasury, agency and GSE,
 * repurchase agreements, bank-related, other). A series is a cell filter on `mnemonic`, allowed on 6,848 records.
 * Checked on 26 Nov 2026: 7 series (the total, its five parts, the median repo yield), 1,279 records, equal OFR's API
 * that day; the five parts add up exactly to the total in each of the 192 months.
 */
const ofrClaims = (d: ProfileDataset) => d.source_id === "OFR_STFM" && d.id === OFR_MMF_DATASET;

function ofrProfile(): Profile {
  return defineProfile(ofrClaims, {
    family: "ofr-mmf",
    period: { from: "dimension", format: "iso-date" },
    cadence: "month",
    measures: [{ field: "value_native", label: "Value", unit: { from: "column", column: "unit" }, grouping: "none" }],
    extraFields: ["date"],
    addressing: {
      by: null,
      where: ["mnemonic"],
      scan: "table",
      rowsScanned: 6848,
      note: "A series is the records of one OFR mnemonic, found by a cell filter; the table has 6,848 records.",
    },
    defaultSeries: () => ofrSeries("MMF-MMF_TOT-M"),
    firstLook: "series",
    proof: {
      snapshotId: OFR_MMF_SNAPSHOT,
      datasetId: OFR_MMF_DATASET,
      checked: FINANCE_CHECKED,
      documentation: [OFR_API, "https://www.financialresearch.gov/short-term-funding-monitor/datasets/mmf/"],
    },
  });
}

export const OFR_MMF_ENTRY: ProfileEntry = { family: "ofr-mmf", claims: ofrClaims, profile: ofrProfile };

// ---------------------------------------------------------------------------------------------------------------
// NCUA 5300 call reports, June 2026: one record per credit union
// ---------------------------------------------------------------------------------------------------------------

export const NCUA_CORE_DATASET = "official_01_financials_data_ncua_all_credit_unions_2026q2_core_c7e2229231";
export const NCUA_CORE_SNAPSHOT = "5ee8aa51cfa3f5cbad5feb9ceccec44c8eff299a7c992f6d904b474691b386d2";
export const NCUA_PACKAGE = "https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip";
export const NCUA_SUMMARY = "https://ncua.gov/files/publications/analysis/quarterly-data-summary-2026-Q2.pdf";

/**
 * NCUA 2026Q2 credit-union financials: one record per credit union that filed a 5300 call report for the quarter
 * ending 30 June 2026 (`CU_NUMBER` the indexed entity, `CU_NAME` the entity name, `STATE` the indexed place), with
 * accounts of NCUA's FS220 file under the store's names: `assets_USD` (Acct_010 TOTAL ASSETS), `shares_and_deposits_USD`
 * (Acct_018), `loans_and_leases_USD` (Acct_025B). The dictionary states "USD" for each; NCUA's quarterly data summary
 * for 2026Q2 states the industry's total assets in dollars ($2.50 trillion), which Acct_010 of the federally insured
 * credit unions in the file adds up to ($2,498,852,640,655), so a figure is in dollars. The file also holds 85 credit
 * unions that are not federally insured (`CU_TYPE` 3), which NCUA's own counts leave out. The table has no period
 * dimension; `CYCLE_DATE` ("6/30/2026 0:00:00") is not a period form the reads parse, so it is kept as text and a
 * ranking reads the whole table (4,299 records).
 * Checked on 26 Nov 2026: all 4,299 records (CU_NUMBER, the three amounts and members; name, type and state) equal
 * NCUA's call report package for June 2026 (FS220.txt and FOICU.txt).
 */
const ncuaClaims = (d: ProfileDataset) => d.source_id === "NCUA_CALL" && d.id === NCUA_CORE_DATASET;

function ncuaProfile(): Profile {
  const usd = { from: "dictionary", text: "USD" } as const;
  return defineProfile(ncuaClaims, {
    family: "ncua-call",
    entityNoun: { one: "credit union", many: "credit unions" },
    period: { from: "field", field: "CYCLE_DATE", format: "text" },
    measures: [
      { field: "assets_USD", label: "Total assets", unit: usd, grouping: "none" },
      { field: "shares_and_deposits_USD", label: "Total amount of shares and deposits", unit: usd, grouping: "none" },
      { field: "loans_and_leases_USD", label: "Total amount of loans and leases", unit: usd, grouping: "none" },
    ],
    extraFields: ["CU_NUMBER", "CU_NAME", "CU_TYPE", "STATE"],
    addressing: {
      by: "entity_id",
      where: [],
      scan: "key",
      rowsScanned: 1,
      note: "One record per credit union: a credit union is one CU_NUMBER through the entity index; a ranking reads the whole table (4,299 records).",
    },
    defaultSeries: () => null,
    firstLook: "ranking",
    proof: {
      snapshotId: NCUA_CORE_SNAPSHOT,
      datasetId: NCUA_CORE_DATASET,
      checked: FINANCE_CHECKED,
      documentation: [NCUA_PACKAGE, NCUA_SUMMARY, "https://ncua.gov/analysis/credit-union-corporate-call-report-data"],
    },
  });
}

export const NCUA_CALL_ENTRY: ProfileEntry = { family: "ncua-call", claims: ncuaClaims, profile: ncuaProfile };

// ---------------------------------------------------------------------------------------------------------------
// FDIC failures and assistance transactions since 2000
// ---------------------------------------------------------------------------------------------------------------

export const FDIC_FAILURES_DATASET = "official_01_financials_data_fdic_failures_and_assistance_since_2000_dffd8efb1d";
export const FDIC_FAILURES_SNAPSHOT = "2be03758fb6e3e0dd3621b3aea9ad66a8d19fc224ae0ab4bc871bb9f3d867867";
export const FDIC_FAILURE_FIELDS = "https://api.fdic.gov/banks/docs/failure_properties.yaml";

/**
 * FDIC failures and assistance transactions since 2000 (BankFind failures): one record per failed or assisted
 * institution, `CERT` the indexed entity and `NAME` the entity name, `FAILYR` the year it ceased to exist as a
 * privately held going concern, `COST` the estimated loss to the Deposit Insurance Fund, `QBFASSET` and `QBFDEP` its
 * total assets and deposits at the last report before failure. The dictionary states "USD thousands" for the three,
 * and the FDIC's field definitions state "Thousands of US Dollars" (x-number-unit) for each. No CERT repeats.
 * Checked on 26 Nov 2026: 594 records, as the FDIC API counts them; the 14 largest by COST equal the FDIC API (CERT,
 * name, failure date, COST, QBFASSET, QBFDEP); 13 records have no COST (a gap, never a zero).
 */
const failuresClaims = (d: ProfileDataset) => d.source_id === "FDIC_FAILURES" && d.id === FDIC_FAILURES_DATASET;

function failuresProfile(): Profile {
  const thousands = { from: "dictionary", text: "USD thousands" } as const;
  return defineProfile(failuresClaims, {
    family: "fdic-failures",
    entityNoun: { one: "failed or assisted institution", many: "failed or assisted institutions" },
    period: { from: "field", field: "FAILYR", format: "year" },
    cadence: "year",
    measures: [
      { field: "COST", label: "Estimated loss", unit: thousands, grouping: "none" },
      { field: "QBFASSET", label: "Total assets", unit: thousands, grouping: "none" },
      { field: "QBFDEP", label: "Total deposits", unit: thousands, grouping: "none" },
    ],
    extraFields: ["CERT", "NAME", "FAILDATE", "RESTYPE"],
    addressing: {
      by: "entity_id",
      where: [],
      scan: "key",
      rowsScanned: 1,
      note: "One record per institution: an institution is one CERT through the entity index; a ranking reads the whole table (594 records).",
    },
    defaultSeries: () => null,
    firstLook: "ranking",
    proof: {
      snapshotId: FDIC_FAILURES_SNAPSHOT,
      datasetId: FDIC_FAILURES_DATASET,
      checked: FINANCE_CHECKED,
      documentation: ["https://api.fdic.gov/banks/failures", FDIC_FAILURE_FIELDS],
    },
  });
}

export const FDIC_FAILURES_ENTRY: ProfileEntry = { family: "fdic-failures", claims: failuresClaims, profile: failuresProfile };

/** Profile families of round 6 unit `finance`, each with its proof (see ../registry.ts for the rule). */
export const ENTRIES: readonly ProfileEntry[] = [
  FED_H8_ENTRY,
  FED_Z1_SECTORS_ENTRY,
  FED_Z1_TABLE_ENTRY,
  OFR_MMF_ENTRY,
  NCUA_CALL_ENTRY,
  FDIC_FAILURES_ENTRY,
];
