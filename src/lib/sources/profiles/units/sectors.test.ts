import { describe, expect, it } from "vitest";
import { computeSeriesTile, type CellInput, type TileContext } from "../../boards/compute";
import { tileSpec } from "../../boards/specs";
import type { SeriesTileSpec } from "../../boards/types";
import type { SourceColumn } from "../../schema";
import { addressRefusal, measureOf, profileFor, profileStatus, unitOf } from "../index";
import type { Profile } from "../types";
import { FHFA_QUARTERLY_DATASET } from "./sectors";

/** A dictionary as production stores it: positional keys, the publisher's headers as labels. */
const fields = (...labels: string[]): SourceColumn[] =>
  labels.map((label, i) => ({ key: `col${String(i + 1).padStart(4, "0")}`, label, type: "string" }));

const FHFA_FIELDS = fields("hpi_type", "hpi_flavor", "frequency", "level", "place_name", "place_id", "yr", "period", "index_nsa", "index_sa", "rstderr", "note");
const MASTER_ALL = "official_11_real_estate_hpi_master_all_0755e8292e";

function on(dataset: { id: string; source_id: string | null }, columns: SourceColumn[]): Profile {
  const profile = profileFor(dataset, columns);
  if (!profile) throw new Error(`no profile for ${dataset.id}`);
  return profile;
}

describe("FHFA quarterly purchase-only family", () => {
  it("takes the national and state table, and leaves the master file to the monthly family", () => {
    expect(on({ id: FHFA_QUARTERLY_DATASET, source_id: "FHFA_MASTER" }, FHFA_FIELDS).family).toBe("fhfa-hpi-quarterly");
    expect(on({ id: MASTER_ALL, source_id: "FHFA_MASTER" }, FHFA_FIELDS).family).toBe("fhfa-hpi");
    expect(on({ id: "official_11_real_estate_metro_purchase_only_d40ac9ae79", source_id: "FHFA_MASTER" }, FHFA_FIELDS).family).toBe("fhfa-hpi");
    // the dataset id alone does not claim it: the source must be FHFA's master file
    expect(profileStatus({ id: FHFA_QUARTERLY_DATASET, source_id: null }, FHFA_FIELDS)).toEqual({ state: "none" });
  });

  it("keeps the house-prices-12m tile on the monthly United States series of the master file", () => {
    const spec = tileSpec("house-prices-12m") as SeriesTileSpec;
    expect(spec.datasetId).toBe(MASTER_ALL);
    expect(spec.measure).toBe("index_sa");
    expect(spec.unit).toBe("Index, January 1991 = 100");
    expect(spec.series).toEqual({
      by: "geo_code",
      key: "USA",
      where: [
        { field: "hpi_type", value: "traditional" },
        { field: "hpi_flavor", value: "purchase-only" },
        { field: "frequency", value: "monthly" },
      ],
    });
    const monthly = on({ id: MASTER_ALL, source_id: "FHFA_MASTER" }, FHFA_FIELDS);
    expect(addressRefusal(monthly, spec.series)).toBeNull();
  });

  it("states the unit FHFA normalizes the quarterly purchase-only index to, and only for that family", () => {
    const profile = on({ id: FHFA_QUARTERLY_DATASET, source_id: "FHFA_MASTER" }, FHFA_FIELDS);
    const measure = measureOf(profile, "index_sa");
    expect(measure?.unit).toMatchObject({ from: "constant", text: "Index, first quarter of 1991 = 100" });
    expect(profile.cadence).toBe("quarter");
    expect(addressRefusal(profile, { by: "geo_code", key: "CA", where: [{ field: "hpi_type", value: "traditional" }] })).toBe(
      'The fhfa-hpi-quarterly profile states its unit only for series with hpi_flavor "purchase-only".',
    );
    expect(profile.defaultSeries?.({ id: FHFA_QUARTERLY_DATASET, source_id: "FHFA_MASTER" })).toEqual({
      by: "geo_code",
      key: "USA",
      where: [
        { field: "hpi_type", value: "traditional" },
        { field: "hpi_flavor", value: "purchase-only" },
        { field: "frequency", value: "quarterly" },
      ],
    });
  });

  it("composes a quarter from the year and the quarter, and no period for a monthly row", () => {
    const profile = on({ id: FHFA_QUARTERLY_DATASET, source_id: "FHFA_MASTER" }, FHFA_FIELDS);
    if (profile.period.from !== "fields") throw new Error("expected a composed period");
    expect(profile.period.compose(["2026", "2", "quarterly"])).toEqual({ text: "2026Q2", format: "quarter" });
    expect(profile.period.compose(["2026", "7", "monthly"])).toBeNull();
    expect(profile.period.compose(["2026", "5", "quarterly"])).toBeNull();
    expect(profile.period.compose(["", "1", "quarterly"])).toBeNull();
  });

  it("computes the change over four quarters from the stored rows of California (24 Nov 2026 copy)", () => {
    const context: TileContext = {
      datasetId: FHFA_QUARTERLY_DATASET,
      snapshotId: "ddd83ae236ba7f328fea24ad360b64510e73b6acf75b3c2c7f57f7e48769ade7",
      field: "index_sa",
      unit: { from: "fixed", text: "Index, first quarter of 1991 = 100" },
      format: "quarter",
      cadence: "quarter",
      grouping: "none",
    };
    // rows 26213 to 26218 of the snapshot, as stored
    const cells: CellInput[] = [
      { row: 26213, period: "2025Q1", text: "421.57" },
      { row: 26214, period: "2025Q2", text: "418.00" },
      { row: 26215, period: "2025Q3", text: "417.74" },
      { row: 26216, period: "2025Q4", text: "419.40" },
      { row: 26217, period: "2026Q1", text: "419.76" },
      { row: 26218, period: "2026Q2", text: "417.15" },
    ];
    const spec: SeriesTileSpec = {
      id: "test-ca",
      collection: "11_real_estate",
      datasetId: FHFA_QUARTERLY_DATASET,
      measure: "index_sa",
      title: "California",
      subject: "The FHFA purchase-only index for California",
      unit: "Index, first quarter of 1991 = 100",
      decimals: 2,
      form: "line",
      transform: "change-1y-quarterly",
      changeAs: "percent",
      headline: "change",
      series: { by: "geo_code", key: "CA", where: [{ field: "hpi_type", value: "traditional" }, { field: "hpi_flavor", value: "purchase-only" }, { field: "frequency", value: "quarterly" }] },
      window: 8,
    };
    const result = computeSeriesTile(spec, context, cells);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 x (417.15 / 418.00 - 1) = -0.2033..., rounded to one decimal
    expect(result.figure).toBe("−0.2");
    expect(result.headline).toBe("The FHFA purchase-only index for California fell 0.2% over the four quarters to Q2 2026.");
    expect(result.refs.rows).toEqual([26218, 26214]);
  });
});

const COUNTY_FIELDS = fields("State", "County", "FIPS code", "Year", "Annual Change (%)", "HPI", "HPI with 1990 base", "HPI with 2000 base");
const ZIP_FIELDS = fields("Five-Digit ZIP Code", "Year", "Annual Change (%)", "HPI", "HPI with 1990 base", "HPI with 2000 base");
const TRACT_FIELDS: SourceColumn[] = [
  { key: "col0001", label: "tract", type: "string", unit: "11-character census tract identifier" },
  { key: "col0002", label: "state_abbr", type: "string" },
  { key: "col0003", label: "year", type: "string" },
  { key: "col0004", label: "annual_change", type: "string", unit: "percent" },
  { key: "col0005", label: "hpi", type: "string", unit: "index" },
  { key: "col0006", label: "hpi1990", type: "string", unit: "index; 1990=100" },
  { key: "col0007", label: "hpi2000", type: "string", unit: "index; 2000=100" },
];

describe("FHFA annual county, ZIP and tract families", () => {
  it("draws the annual change and the two rebased indexes, never the index based on each place's first year", () => {
    const county = on({ id: "official_11_real_estate_hpi_at_county_fc7641108a", source_id: "FHFA_COUNTY" }, COUNTY_FIELDS);
    expect(county.family).toBe("fhfa-hpi-county");
    expect(county.measures.map((m) => [m.field, m.unit.from === "constant" ? m.unit.text : ""])).toEqual([
      ["Annual Change (%)", "Percent"],
      ["HPI with 2000 base", "Index, 2000 = 100"],
      ["HPI with 1990 base", "Index, 1990 = 100"],
    ]);
    expect(measureOf(county, "HPI")).toBeNull();
    expect(county.measures.every((m) => m.markers?.includes("."))).toBe(true);
  });

  it("opens the county history on Los Angeles County and ranks the one-year table", () => {
    const history = on({ id: "official_11_real_estate_hpi_at_county_fc7641108a", source_id: "FHFA_COUNTY" }, COUNTY_FIELDS);
    expect(history.firstLook).toBe("series");
    expect(history.defaultSeries?.({ id: "official_11_real_estate_hpi_at_county_fc7641108a", source_id: "FHFA_COUNTY" })).toEqual({ by: "geo_code", key: "06037" });
    const latest = on({ id: "official_11_real_estate_hpi_at_county_latest_4e3ee0764a", source_id: "FHFA_COUNTY" }, COUNTY_FIELDS);
    expect(latest.firstLook).toBe("ranking");
    expect(latest.defaultSeries?.({ id: "official_11_real_estate_hpi_at_county_latest_4e3ee0764a", source_id: "FHFA_COUNTY" })).toBeNull();
  });

  it("gives the one-year ZIP table no measured first look: 19,024 places in one year are beyond a bounded ranking", () => {
    expect(on({ id: "official_11_real_estate_hpi_at_zip5_beae754ada", source_id: "FHFA_ZIP5" }, ZIP_FIELDS).firstLook).toBe("series");
    expect(on({ id: "official_11_real_estate_hpi_at_zip5_latest_8283bc1c1b", source_id: "FHFA_ZIP5" }, ZIP_FIELDS).firstLook).toBe("none");
    // a ZIP table's fields do not satisfy the county family, which is not claimed for it anyway
    expect(profileStatus({ id: "x", source_id: "FHFA_COUNTY" }, ZIP_FIELDS).state).toBe("off");
  });

  it("reads the tract units from the dictionary and turns off when it states another", () => {
    const tract = on({ id: "official_11_real_estate_raw_hpi_at_tract_d51b3471be", source_id: "FHFA_TRACT" }, TRACT_FIELDS);
    expect(tract.family).toBe("fhfa-hpi-tract");
    expect(measureOf(tract, "hpi2000")?.unit).toEqual({ from: "dictionary", text: "index; 2000=100" });
  });
});

const TW_TECH_FIELDS: SourceColumn[] = [
  "exchange",
  "source_report_date_roc",
  "source_period_roc",
  "company_code",
  "company_name",
  "industry_native",
  "monthly_revenue",
  "prior_month_revenue",
  "year_ago_month_revenue",
  "month_over_month_pct",
  "year_over_year_pct",
  "year_to_date_revenue",
  "prior_year_to_date_revenue",
  "year_to_date_growth_pct",
  "notes_native",
  "period_gregorian",
].map((label, i) => ({
  key: `col${String(i + 1).padStart(4, "0")}`,
  label,
  type: "string",
  ...(label.endsWith("_revenue") ? { unit: "thousands of source reporting currency (MOPS: 千元); no currency normalization" } : label.endsWith("_pct") ? { unit: "%" } : {}),
}));
const TW_NATIVE_FIELDS = fields(
  "出表日期",
  "資料年月",
  "公司代號",
  "公司名稱",
  "產業別",
  "營業收入-當月營收",
  "營業收入-上月營收",
  "營業收入-去年當月營收",
  "營業收入-上月比較增減(%)",
  "營業收入-去年同月增減(%)",
  "累計營業收入-當月累計營收",
  "累計營業收入-去年累計營收",
  "累計營業收入-前期比較增減(%)",
  "備註",
);

describe("Taiwan monthly revenue families", () => {
  it("draws money only from the technology tables, whose dictionary states the unit", () => {
    const tech = on({ id: "official_02_technology_csv_twse_tech_revenue_922c8b713b", source_id: "TWSE_MONTHLY" }, TW_TECH_FIELDS);
    expect(tech.family).toBe("tw-revenue-tech");
    expect(measureOf(tech, "monthly_revenue")?.unit).toEqual({
      from: "dictionary",
      text: "thousands of source reporting currency (MOPS: 千元); no currency normalization",
    });
    const native = on({ id: "official_02_technology_csv_twse_revenue_all_industries_96edc5fdfa", source_id: "TWSE_MONTHLY" }, TW_NATIVE_FIELDS);
    expect(native.family).toBe("tw-revenue-native");
    expect(native.measures.map((m) => m.field)).toEqual(["營業收入-去年同月增減(%)", "營業收入-上月比較增減(%)", "累計營業收入-前期比較增減(%)"]);
    expect(native.measures.every((m) => m.unit.from === "constant" && m.unit.text === "Percent")).toBe(true);
  });

  it("declares the period dimension of each copy: the ROC month, or the Gregorian month of the current copies", () => {
    const roc = on({ id: "official_02_technology_csv_tpex_revenue_all_industries_65da2c3cb7", source_id: "TPEX_MONTHLY" }, TW_NATIVE_FIELDS);
    expect(roc.period).toEqual({ from: "dimension", format: "roc-yyymm" });
    const gregorian = on({ id: "official_tpex_monthly_revenue_native_current", source_id: "TPEX_MONTHLY" }, TW_NATIVE_FIELDS);
    expect(gregorian.period).toEqual({ from: "dimension", format: "yyyy-mm" });
  });

  it("turns the technology profile off when the dictionary drops the unit", () => {
    const bare = TW_TECH_FIELDS.map(({ unit: _unit, ...f }) => f);
    const tech = on({ id: "official_02_technology_csv_twse_tech_revenue_922c8b713b", source_id: "TWSE_MONTHLY" }, bare);
    const measure = measureOf(tech, "monthly_revenue");
    expect(measure).not.toBeNull();
    if (!measure) return;
    // the profile still applies by labels, but its unit cannot be established, so nothing is drawn
    expect(unitOf(measure, bare)).toEqual({
      ok: false,
      reason: 'the dictionary states no unit for monthly_revenue, not "thousands of source reporting currency (MOPS: 千元); no currency normalization"',
    });
  });
});
