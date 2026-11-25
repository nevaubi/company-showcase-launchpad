import { defineProfile } from "./define";
import type { Cadence, Profile, ProfileDataset, ProfileEntry } from "./types";

/**
 * FRED single-series files: two fields, `observation_date` (the record's period, declared as the period
 * dimension) and a field named after the series code that holds the value. The dictionary states no unit
 * and no type, so a series is drawn only when it is listed here with the unit FRED states on its series
 * page, checked on 25 Nov 2026 against that page, the store's own series catalogue (retrieved with the
 * data) and FRED's graph file (every stored value of the checked window equal, or a later revision named
 * in the report). A series that is not listed gets no measure chart.
 *
 * FRED dates every observation by the first day of its period (a month, a quarter) or, for a weekly
 * series, by the day the week ends; the cadence says which, so "2026-10-01" is read as Oct 2026.
 */
export type FredSeries = {
  code: string;
  /** FRED's title of the series. */
  title: string;
  /** "Units:" as FRED's series page states it, without the adjustment. */
  unit: string;
  /** The adjustment FRED states beside the unit. */
  adjustment: "Seasonally Adjusted" | "Not Seasonally Adjusted" | "Seasonally Adjusted Annual Rate";
  cadence: Cadence;
  /** For a weekly series: the day each week ends, as FRED states the frequency. */
  weekEnding?: string;
  /** The snapshot the check read. */
  snapshotId: string;
  datasetId: string;
  /** Rows of that snapshot: the whole series is read in row order. */
  rows: number;
};

export const FRED_SERIES: readonly FredSeries[] = [
  { code: "CPIAUCNS", title: "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "4578f05e3ab18846e819eb29dda922f3ee6a9cbe2bf2b10192be7ad68c771e31", datasetId: "official_09_consumer_staples_raw_fred_cpiaucns_c8a57a978a", rows: 322 },
  { code: "CPIUFDSL", title: "Consumer Price Index for All Urban Consumers: Food in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "afbb53f6a90390e184e0ea12d0a39d8fce92c3eae79ca79c0f03b67c729fa54d", datasetId: "official_09_consumer_staples_raw_fred_cpiufdsl_7b34566789", rows: 322 },
  { code: "CUSR0000SEFV", title: "Consumer Price Index for All Urban Consumers: Food Away from Home in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "9a221bef66298b31858f5e1539174fb3f69ffbe25e778f4b4c9aa0ffd08ecbfa", datasetId: "official_09_consumer_staples_raw_fred_cusr0000sefv_80c6f8b4c5", rows: 322 },
  { code: "PCEPI", title: "Personal Consumption Expenditures: Chain-type Price Index", unit: "Index 2017=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "0a1c78c13aa469b86cfa1a3fb34e010204d33cf0ad2cd52f0abf66e7ab703f14", datasetId: "official_00_universal_raw_fred_pcepi_6220e72d37", rows: 321 },
  { code: "UNRATE", title: "Unemployment Rate", unit: "Percent", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "0d1a5ef3747ea9e1757d97d83ac82c78cc9b439fb7770a3c99b5afc4f8acc82c", datasetId: "official_00_universal_raw_fred_unrate_3286ca8718", rows: 322 },
  { code: "FEDFUNDS", title: "Federal Funds Effective Rate", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "c38dfc80c540d43a41ed7ce46ae200e6f870b55f788e91f152d7b9f1bbd1d8b5", datasetId: "official_00_universal_raw_fred_fedfunds_60a510e6af", rows: 322 },
  { code: "GS10", title: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity, Quoted on an Investment Basis", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "0bf14d29c40d719b45cc8b45c805275e664ab5853c54c795899d5d36eb479986", datasetId: "official_00_universal_raw_fred_gs10_83de07f258", rows: 322 },
  { code: "GDPC1", title: "Real Gross Domestic Product", unit: "Billions of Chained 2017 Dollars", adjustment: "Seasonally Adjusted Annual Rate", cadence: "quarter", snapshotId: "35e62d99d9992a378e520e20a772c9972c158463dda6cfcc255c5493a556242c", datasetId: "official_00_universal_raw_fred_gdpc1_66c002f48e", rows: 107 },
  { code: "ICSA", title: "Initial Claims", unit: "Number", adjustment: "Seasonally Adjusted", cadence: "week", weekEnding: "Saturday", snapshotId: "7126f433d670aba2309f1498a02bde172e94d2ce8ee4606f6abdfd531f16cc0c", datasetId: "official_00_universal_raw_fred_icsa_6f2afbca3c", rows: 1403 },
  { code: "MORTGAGE30US", title: "30-Year Fixed Rate Mortgage Average in the United States", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "week", weekEnding: "Thursday", snapshotId: "a2e3b524f380e483dac7d515bcb7ae35d0dc69a53b5a65e35e5ad4fab3a6cbcf", datasetId: "official_11_real_estate_raw_fred_mortgage30us_dbaf839e72", rows: 1403 },
  { code: "HOUST", title: "New Privately-Owned Housing Units Started: Total Units", unit: "Thousands of Units", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "577742bdeb059e560cec273b2e0496f48b60f1193c435cd105db5f9d635ed41b", datasetId: "official_11_real_estate_raw_fred_houst_2f8d88288f", rows: 322 },
  { code: "CSUSHPINSA", title: "S&P Cotality Case-Shiller U.S. National Home Price Index", unit: "Index Jan 2000=100", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "8dd4cda6be52c0c0a19ade14d160f379f0b486bea259fca5ffd8d0e8e33c2187", datasetId: "official_11_real_estate_raw_fred_csushpinsa_4546d8e855", rows: 320 },
  { code: "MSPNHSUS", title: "Median Sales Price for New Houses Sold in the United States", unit: "Dollars", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "ccd327892c5ff750925b39495297b7b2d858100dd88dea029f5107dab9bdcac5", datasetId: "official_11_real_estate_raw_fred_mspnhsus_cbb7225da9", rows: 321 },
  { code: "RSAFS", title: "Advance Retail Sales: Retail Trade and Food Services", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "0478b7c9df0a6bf39350690304b4a707326402356f2fef74a38d3e09d0127c87", datasetId: "official_08_consumer_discretionary_raw_fred_rsafs_a6e0a3815f", rows: 322 },
  { code: "TOTALSA", title: "Total Vehicle Sales", unit: "Millions of Units", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "ea1adfbfd08f14d07025c2112d2b19dada952b06c4bbba442025cac7315b49e0", datasetId: "official_08_consumer_discretionary_raw_fred_totalsa_b2b7f5ec9c", rows: 322 },
  { code: "ECOMPCTSA", title: "E-Commerce Retail Sales as a Percent of Total Sales", unit: "Percent", adjustment: "Seasonally Adjusted", cadence: "quarter", snapshotId: "0c9696b5e688ab708ed9ca84c894701e08fb65d6ab4d48f5ca83d2c7620af5d0", datasetId: "official_08_consumer_discretionary_raw_fred_ecompctsa_98e8171a3a", rows: 107 },
  { code: "DGORDER", title: "Manufacturers' New Orders: Durable Goods", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "4e81de424914a7f9a9bfa2e16fedad2e4b9a6b0be79ecd6be2c6d15b7a568ef9", datasetId: "official_06_industrials_raw_fred_dgorder_8974ef3329", rows: 321 },
  { code: "TSIFRGHT", title: "Freight Transportation Services Index", unit: "Index 2000=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "d16a96b1376f417effe5465aeadeac29afe27aabf11e065fb44dd573b64df8f1", datasetId: "official_06_industrials_raw_fred_tsifrght_19732278ec", rows: 320 },
  { code: "MANEMP", title: "All Employees, Manufacturing", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "3f342f7dade37c520340195cee324f8e0e5059d797e32cd7ac3a56c34623ec16", datasetId: "official_06_industrials_raw_fred_manemp_ae6a27a459", rows: 322 },
];

/**
 * Series that were checked and refused, with the reason, so nobody adds them back without a new check.
 * IPMAN: the stored values are on the base the store's catalogue states (Index 2017=100); FRED's page now
 * states Index 2022=100 and every value of the checked window differs, so the stored unit cannot be
 * established at the publisher.
 */
export const FRED_REFUSED: Readonly<Record<string, string>> = {
  IPMAN: "Stored on Index 2017=100 as catalogued at retrieval; FRED now states Index 2022=100 and all 48 checked values differ.",
};

const BY_CODE = new Map(FRED_SERIES.map((s) => [s.code, s] as const));

/** The series code of a FRED file, from its registered source id ("FRED_UNRATE"). */
export function fredCode(dataset: ProfileDataset): string | null {
  return dataset.source_id?.startsWith("FRED_") ? dataset.source_id.slice(5) : null;
}

export function fredSeries(dataset: ProfileDataset): FredSeries | null {
  const code = fredCode(dataset);
  return code ? (BY_CODE.get(code) ?? null) : null;
}

const claims = (dataset: ProfileDataset) => fredSeries(dataset) !== null;

function fredProfile(dataset: ProfileDataset): Profile {
  const series = fredSeries(dataset);
  if (!series) throw new Error(`no checked FRED series for ${dataset.id}`);
  return defineProfile(claims, {
    family: "fred",
    period: { from: "dimension", format: "iso-date" },
    cadence: series.cadence,
    measures: [
      {
        field: series.code,
        label: series.title,
        unit: { from: "constant", text: series.unit, evidence: `https://fred.stlouisfed.org/series/${series.code}` },
        grouping: "none",
      },
    ],
    extraFields: ["observation_date"],
    addressing: {
      by: null,
      where: [],
      scan: "table",
      rowsScanned: series.rows,
      note: "One series per file: the whole snapshot is read in row order, at most five pages of 1,000 rows.",
    },
    defaultSeries: () => ({ whole: true }),
    firstLook: "series",
    proof: {
      snapshotId: series.snapshotId,
      datasetId: series.datasetId,
      checked: "2026-11-25",
      documentation: [`https://fred.stlouisfed.org/series/${series.code}`, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series.code}`],
    },
  });
}

export const FRED_ENTRY: ProfileEntry = { family: "fred", claims, profile: fredProfile };
