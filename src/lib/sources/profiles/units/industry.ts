import { defineProfile } from "../define";
import type { MeasureSpec, Profile, ProfileDataset, ProfileEntry } from "../types";
import { DS140_TABLES, type Ds140Table } from "./industry-ds140";

/**
 * Profile families of round 6 unit `industry` (materials, industrials, consumer discretionary and staples), each
 * proven on production rows against the publisher's own file on 26 Nov 2026 (industry.checks.json, and the unit's
 * report). Families of these collections without a profile, and why, are listed in that report.
 */

// ---------------------------------------------------------------- USGS DS140

const DS140_DATASET_PREFIX = "official_07_materials_csv_";
const DS140_HOST = "https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/";
const DS140_PAGE = "https://www.usgs.gov/centers/national-minerals-information-center/historical-statistics-mineral-commodities-united";
/** The sheets' footnotes: "NA Not available. W Withheld to avoid disclosing company proprietary data.", "E Exporter.", "2Less than ½ unit." */
const DS140_MARKERS = ["NA", "W", "E", "(2)"] as const;

const DS140_BY_ID = new Map<string, Ds140Table>(DS140_TABLES.map((t) => [`${DS140_DATASET_PREFIX}${t.id}`, t]));

/** The workbook of a DS140 table, as USGS serves it. */
export function ds140Workbook(table: Pick<Ds140Table, "workbook">): string {
  return `${DS140_HOST}${table.workbook}`;
}

/** The unit of one DS140 measure, from its code in the table list. */
export function ds140Unit(table: Pick<Ds140Table, "unit">, code: string): string {
  if (code === "s") return table.unit;
  if (code === "$") return "$/t";
  if (code === "98") return "98$/t";
  if (code === "%") return "Percent";
  if (code === "usd") return "$";
  return code;
}

function ds140Measure(table: Ds140Table, [field, code, label]: Ds140Table["measures"][number]): MeasureSpec {
  const where = ds140Workbook(table);
  const evidence =
    code === "s"
      ? `${where} (unit statement above the header: ${table.statement})`
      : code === "$"
        ? `${where} (header "${field}"; the notes define unit value as the value of 1 metric ton in current dollars)`
        : code === "98"
          ? `${where} (header "${field}"; the notes: unit value in constant 1998 U.S. dollars, by the Consumer Price Index)`
          : `${where} (header "${field}")`;
  return {
    field,
    label: label ?? field,
    unit: { from: "constant", text: ds140Unit(table, code), evidence },
    grouping: "none",
    markers: DS140_MARKERS,
  };
}

const ds140Claims = (d: ProfileDataset) => d.source_id === "USGS_DS140" && DS140_BY_ID.has(d.id);

/**
 * USGS DS140 commodity sheets: one record per year (`Year`, the period dimension), one field per statistic with the
 * sheet's header as its label. The unit of each measure is the sheet's own statement or the unit its header states
 * (`industry-ds140.ts`); figures are printed as stored, never converted (the workbooks themselves convert carats,
 * troy ounces and flasks to metric tons, as their notes say). A table is one series, read whole (at most 123 records).
 */
function ds140Profile(dataset: ProfileDataset): Profile {
  const table = DS140_BY_ID.get(dataset.id);
  if (!table) throw new Error(`no checked DS140 table for ${dataset.id}`);
  return defineProfile(ds140Claims, {
    family: "usgs-ds140",
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: table.measures.map((m) => ds140Measure(table, m)),
    extraFields: ["Year"],
    addressing: {
      by: null,
      where: [],
      scan: "table",
      rowsScanned: table.rows,
      note: "One commodity sheet per table and one record per year: the whole snapshot is read in row order.",
    },
    defaultSeries: () => ({ whole: true }),
    firstLook: "series",
    proof: {
      snapshotId: table.snapshotId,
      datasetId: dataset.id,
      checked: "2026-11-26",
      documentation: [ds140Workbook(table), DS140_PAGE],
    },
  });
}

export const DS140_ENTRY: ProfileEntry = { family: "usgs-ds140", claims: ds140Claims, profile: ds140Profile };

// ---------------------------------------------------------------- USDA ERS food price outlook

const ERS_PAGE = "https://www.ers.usda.gov/data-products/food-price-outlook";

/** The annual percent changes of 1974 onward: one record per item and year. */
const ERS_ANNUAL = {
  ERS_CPI_ANNUAL: {
    item: "Consumer Price Index item",
    csv: "https://www.ers.usda.gov/media/6462/annual-percent-changes-in-selected-consumer-price-indexes-1974-through-2025.csv",
    first: "All food",
    rows: 1144,
    snapshotId: "c4a3768851d6047783e7fb38268a14a5d8cda3c38f0d5921954aa5559dbbeffd",
    datasetId: "official_09_consumer_staples_raw_annual_percent_changes_in_selected_consumer_price_indexes_1974_through_2025_56b8bc80d1",
  },
  ERS_PPI_ANNUAL: {
    item: "Producer Price Index item",
    csv: "https://www.ers.usda.gov/media/6470/annual-percent-changes-in-selected-producer-price-indexes-1974-through-2025.csv",
    first: "Finished consumer foods",
    rows: 832,
    snapshotId: "7cfee9440c21c71655cf61fe9176aa129ac6030df9e9491134f5f4b53fd7197b",
    datasetId: "official_09_consumer_staples_raw_annual_percent_changes_in_selected_producer_price_indexes_1974_through_2025_f0035409fd",
  },
} as const;

type AnnualSource = keyof typeof ERS_ANNUAL;
const isAnnual = (s: string | null): s is AnnualSource => s === "ERS_CPI_ANNUAL" || s === "ERS_PPI_ANNUAL";
const ersAnnualClaims = (d: ProfileDataset) => isAnnual(d.source_id);

/**
 * ERS annual percent changes in selected consumer and producer price indexes, 1974 onward: one record per item
 * (`Consumer Price Index item` or `Producer Price Index item`) and year (`Year`, the period dimension). The value
 * field's header is the unit: "Percent change", the change of the year's average index over the previous year's, in
 * percent. An item is a cell filter on a table of at most 1,144 records. The store keeps the CSV as published and a
 * normalized copy with the same fields and rows; both are claimed, and tiles read the CSV copy.
 */
function ersAnnualProfile(dataset: ProfileDataset): Profile {
  if (!isAnnual(dataset.source_id)) throw new Error(`not an ERS annual table: ${dataset.id}`);
  const src = ERS_ANNUAL[dataset.source_id];
  return defineProfile(ersAnnualClaims, {
    family: "ers-annual-change",
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: [
      {
        field: "Percent change",
        label: "Percent change",
        unit: { from: "constant", text: "Percent", evidence: `${src.csv} (value header "Percent change")` },
        grouping: "none",
      },
    ],
    extraFields: ["Year"],
    addressing: {
      by: null,
      where: [src.item],
      scan: "table",
      rowsScanned: src.rows,
      note: `An item is a cell filter on ${src.item} over a table of ${src.rows.toLocaleString("en-US")} records.`,
    },
    defaultSeries: () => ({ where: [{ field: src.item, value: src.first }] }),
    firstLook: "series",
    proof: { snapshotId: src.snapshotId, datasetId: src.datasetId, checked: "2026-11-26", documentation: [src.csv, ERS_PAGE] },
  });
}

export const ERS_ANNUAL_ENTRY: ProfileEntry = { family: "ers-annual-change", claims: ersAnnualClaims, profile: ersAnnualProfile };

/** The forecasts each monthly outlook published, by the month and year it was published. */
const ERS_FORECAST = {
  ERS_CPI_HISTORY: {
    item: "Consumer Price Index item",
    csv: "https://www.ers.usda.gov/media/6464/historical-consumer-price-index-cpi-forecast-series.csv",
    first: { item: "All food", year: "2026", attribute: "Midpoint of forecast interval" },
    rows: 28622,
    snapshotId: "a78b067396e2cef1c388bc98330e4f8ddcba3a3aff331140cc3efc41ecb7a87f",
    datasetId: "official_09_consumer_staples_raw_historical_consumer_price_index_cpi_forecast_series_5ceebbebcd",
  },
  ERS_PPI_HISTORY: {
    item: "Producer Price Index item",
    csv: "https://www.ers.usda.gov/media/6466/historical-producer-price-index-ppi-forecast-series.csv",
    first: { item: "Farm-level cattle", year: "2026", attribute: "Midpoint of forecast interval" },
    rows: 16952,
    snapshotId: "148a9dfde7eab06a891f752ca63f1c5cbfe2446864116aa371583ea385611bb6",
    datasetId: "official_09_consumer_staples_raw_historical_producer_price_index_ppi_forecast_series_41f68256bb",
  },
  ERS_CPI_ARCHIVE: {
    item: "Consumer Price Index item",
    csv: "https://www.ers.usda.gov/media/6456/consumer-price-index-cpi-forecasts-previously-published-estimates.csv",
    first: { item: "All food", year: "2023", attribute: "Mid point of prediction interval" },
    rows: 16676,
    snapshotId: "5d4a2c66341e54d2943a5ede0677b0ef252a0ab39b0e98a1b87ec298f5b9ee5b",
    datasetId: "official_09_consumer_staples_raw_consumer_price_index_cpi_forecasts_previously_published_estimates_3ccb2698f7",
  },
  ERS_PPI_ARCHIVE: {
    item: "Producer Price Index item",
    csv: "https://www.ers.usda.gov/media/6458/producer-price-index-ppi-forecasts-previously-published-estimates.csv",
    first: { item: "Farm-level cattle", year: "2023", attribute: "Mid point of prediction interval" },
    rows: 4862,
    snapshotId: "1726c11e12872115f3600af72fee10238a86068f50a99c2b4bdf482b794d33e3",
    datasetId: "official_09_consumer_staples_raw_producer_price_index_ppi_forecasts_previously_published_estimates_9e39ee6a01",
  },
} as const;

type ForecastSource = keyof typeof ERS_FORECAST;
const isForecast = (s: string | null): s is ForecastSource => s !== null && s in ERS_FORECAST;
const ersForecastClaims = (d: ProfileDataset) => isForecast(d.source_id);

/** The month an outlook was published, from `Year of forecast` and `Month of forecast` ("2026", "10" is Oct 2026). */
export function forecastMonth([year, month]: readonly (string | null)[]): { text: string; format: "yyyy-mm" } | null {
  if (!year || !month || !/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month)) return null;
  const m = Number(month);
  if (m < 1 || m > 12) return null;
  return { text: `${year}-${String(m).padStart(2, "0")}`, format: "yyyy-mm" };
}

/**
 * ERS food price forecasts as each monthly outlook published them: one record per item, outlook month (`Year of
 * forecast`, `Month of forecast`), year forecast (`Year being forecast`) and bound (`Attribute`: the lower bound, the
 * midpoint or the upper bound of the forecast interval; the archive names them "prediction interval" and "forecast
 * range"). The value's header is the unit: "Forecast percent change", the annual change forecast for that year, in
 * percent. A series is one item, one year forecast and one bound, over the outlook months: three cell filters on a
 * table of at most 28,622 records. A blank value is a month ERS did not publish (Oct to Dec 2025 in the history). The
 * first look draws the default series only: a picker of one field cannot name a series of three.
 */
function ersForecastProfile(dataset: ProfileDataset): Profile {
  if (!isForecast(dataset.source_id)) throw new Error(`not an ERS forecast table: ${dataset.id}`);
  const src = ERS_FORECAST[dataset.source_id];
  return defineProfile(ersForecastClaims, {
    family: "ers-forecast",
    period: { from: "fields", fields: ["Year of forecast", "Month of forecast"], format: "yyyy-mm", compose: forecastMonth },
    cadence: "month",
    measures: [
      {
        field: "Forecast percent change",
        label: "Forecast percent change",
        unit: { from: "constant", text: "Percent", evidence: `${src.csv} (value header "Forecast percent change")` },
        grouping: "none",
      },
    ],
    addressing: {
      by: null,
      where: [src.item, "Year being forecast", "Attribute"],
      scan: "table",
      rowsScanned: src.rows,
      note: `A series is three cell filters (${src.item}, Year being forecast, Attribute) over ${src.rows.toLocaleString("en-US")} records.`,
    },
    defaultSeries: () => ({
      where: [
        { field: src.item, value: src.first.item },
        { field: "Year being forecast", value: src.first.year },
        { field: "Attribute", value: src.first.attribute },
      ],
    }),
    firstLook: "none",
    proof: { snapshotId: src.snapshotId, datasetId: src.datasetId, checked: "2026-11-26", documentation: [src.csv, ERS_PAGE] },
  });
}

export const ERS_FORECAST_ENTRY: ProfileEntry = { family: "ers-forecast", claims: ersForecastClaims, profile: ersForecastProfile };

// ---------------------------------------------------------------- MSHA

const MSHA_PRODUCTION_DEFINITIONS = "https://arlweb.msha.gov/OpenGovernmentData/DataSets/MineSProdYearly_Definition_File.txt";
const MSHA_PRODUCTION_FILE = "https://arlweb.msha.gov/OpenGovernmentData/DataSets/MinesProdYearly.zip";
const MSHA_STATE_SUBUNIT = "official_07_materials_csv_employment_state_history_1a337a72d0";

const mshaStateClaims = (d: ProfileDataset) => d.source_id === "MSHA_EMPLOYMENT" && d.id === MSHA_STATE_SUBUNIT;

/**
 * MSHA metal and nonmetal employment by state, subunit and year, 2000 onward: the store's sums of MSHA's yearly mine
 * file (`MinesProdYearly`, metal and nonmetal mines) by `CALENDAR_YR` (the period dimension), `STATE_ABBR` (the place
 * dimension) and `SUBUNIT_CD` (underground, surface at underground, strip, quarry or open pit, dredge, other surface,
 * mill or preparation plant, office). MSHA defines the hours as "the annual summation of hours" and the employees as
 * "the average of the quarterly average employee count"; the dictionary states "employee-hours" for the hours (read
 * from it) and "sum of subunit average employees" for the employees (printed "average employees", as MSHA defines the
 * figure). A series is one state and one subunit (at most 208 records through the place index).
 * The latest year holds only the quarters reported so far. No state total is stored, and none is added up here.
 */
function mshaStateProfile(): Profile {
  return defineProfile(mshaStateClaims, {
    family: "msha-state-subunit",
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: [
      { field: "ANNUAL_HRS", label: "Annual employee hours", unit: { from: "dictionary", text: "employee-hours" }, grouping: "none" },
      {
        field: "AVG_ANNUAL_EMPL",
        label: "Average employees",
        unit: {
          from: "constant",
          text: "average employees",
          evidence: `${MSHA_PRODUCTION_DEFINITIONS} (AVG_EMPLOYEE_CNT: "The average of the quarterly average employee count"; the store's dictionary: "sum of subunit average employees")`,
        },
        grouping: "none",
      },
    ],
    extraFields: ["CALENDAR_YR", "STATE_ABBR", "SUBUNIT_DESC"],
    addressing: {
      by: "geo_code",
      where: ["SUBUNIT_CD"],
      scan: "key",
      rowsScanned: 208,
      note: "A state is one STATE_ABBR through the place index (California has 208 records over seven subunits); the subunit is matched after the read.",
    },
    defaultSeries: () => ({ by: "geo_code", key: "TX", where: [{ field: "SUBUNIT_CD", value: "03" }] }),
    firstLook: "none",
    proof: {
      snapshotId: "4509b7211106640b154fa0a453aaeaeecf70efd74274179dfc1176acaaeb08dc",
      datasetId: MSHA_STATE_SUBUNIT,
      checked: "2026-11-26",
      documentation: [MSHA_PRODUCTION_DEFINITIONS, MSHA_PRODUCTION_FILE],
    },
  });
}

export const MSHA_STATE_ENTRY: ProfileEntry = { family: "msha-state-subunit", claims: mshaStateClaims, profile: mshaStateProfile };

/** Profile families of round 6 unit `industry`, each with its proof (see ../registry.ts for the rule). */
export const ENTRIES: readonly ProfileEntry[] = [DS140_ENTRY, ERS_ANNUAL_ENTRY, ERS_FORECAST_ENTRY, MSHA_STATE_ENTRY];
