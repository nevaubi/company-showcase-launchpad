import { describe, expect, it } from "vitest";
import { computeSeriesTile, type CellInput, type TileContext } from "../../boards/compute";
import { tileSpec } from "../../boards/specs";
import type { SeriesTileSpec } from "../../boards/types";
import type { SourceColumn } from "../../schema";
import { addressRefusal, measureOf, profileFor, profileStatus } from "../index";
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
