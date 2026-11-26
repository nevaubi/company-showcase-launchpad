import { describe, expect, it } from "vitest";
import { GRID_PLACES } from "../geo/us-states";
import type { PeriodFormat } from "../periods";
import type { CellInput, RankCellInput, TileContext } from "./compute";
import { computeRankTile } from "./compute";
import {
  computeCompareTile,
  computeCurveTile,
  computeDistributionTile,
  computeMapTile,
  computeMixTile,
  computeRecordsTile,
  computeStatTile,
  yearEarlierText,
} from "./compute-forms";
import { fdicCrossSection, fredCells } from "./fixtures";
import { stateRule } from "./places";
import type {
  Cadence,
  CompareTileSpec,
  CurveTileSpec,
  DistributionTileSpec,
  MapTileSpec,
  MixTileSpec,
  RankTileSpec,
  RecordsTileSpec,
  StatTileSpec,
  TileResult,
} from "./types";

/** Every expected figure below was worked out by hand or with Python's Decimal from the same rows. */

const ctx = (datasetId: string, field: string, unit: string, format: PeriodFormat = "iso-date", cadence: Cadence = "month"): TileContext => ({
  datasetId,
  snapshotId: `snap-${datasetId}`,
  field,
  unit: { from: "fixed", text: unit },
  format,
  cadence,
  grouping: "none",
});
const fred = (code: string, unit = "Percent") => ({ context: ctx(code.toLowerCase(), code, unit), cells: fredCells(code) });
const ok = (r: TileResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const base = { collection: "00_universal", title: "Test", decimals: 2, verb: "was" as const };

describe("compare", () => {
  const spec: CompareTileSpec = {
    ...base,
    id: "rates",
    datasetId: "unrate",
    measure: "UNRATE",
    subject: "The unemployment rate",
    unit: "Percent",
    form: "compare",
    transform: "level",
    headline: "spread",
    spread: { of: 0, less: 1 },
    window: 24,
    lines: [
      { label: "Unemployment rate", subject: "the unemployment rate", series: { whole: true } },
      { datasetId: "fedfunds", measure: "FEDFUNDS", label: "Federal funds rate", subject: "the effective federal funds rate", series: { whole: true } },
    ],
  };

  it("draws series of one unit on one chart and leads with the spread of two named series", () => {
    const r = ok(computeCompareTile(spec, [fred("UNRATE"), fred("FEDFUNDS")]));
    expect(r.headline).toBe("The unemployment rate was 0.22 percentage points above the effective federal funds rate in Oct 2026.");
    expect(r.figure).toBe("+0.22");
    expect(r.figureUnit).toBe("pp");
    expect(r.shape).toMatchObject({ kind: "compare", layout: "overlay" });
    if (r.shape?.kind !== "compare") throw new Error("shape");
    expect(r.shape.lines.map((l) => [l.key, l.label, l.points.length])).toEqual([
      ["line0", "Unemployment rate", 24],
      ["line1", "Federal funds rate", 24],
    ]);
    expect(r.derivation?.inputs.map((i) => [i.text, i.row])).toEqual([
      ["4.1", 322],
      ["3.88", 322],
    ]);
  });

  it("draws series of different units as small multiples, never on two scales", () => {
    const mixed: CompareTileSpec = {
      ...spec,
      headline: "level",
      spread: undefined,
      lines: [spec.lines[0], { datasetId: "houst", measure: "HOUST", label: "Housing starts", unit: "Thousands of Units", decimals: 0, series: { whole: true } }],
    };
    const r = ok(computeCompareTile(mixed, [fred("UNRATE"), fred("HOUST", "Thousands of Units")]));
    expect(r.shape).toMatchObject({ kind: "compare", layout: "multiples" });
    expect(r.headline).toBe("The unemployment rate was 4.10% in Oct 2026.");
  });

  it("refuses the tile when one series refuses, naming it", () => {
    const r = computeCompareTile(spec, [fred("UNRATE"), fred("FEDFUNDS", "Number")]);
    expect(r).toEqual({ ok: false, reason: 'Federal funds rate: The source states the unit "Number" for FEDFUNDS; the tile expects "Percent".' });
  });

  it("refuses a spread between series of two units", () => {
    const r = computeCompareTile(
      { ...spec, lines: [spec.lines[0], { ...spec.lines[1], unit: "Index" }] },
      [fred("UNRATE"), { ...fred("FEDFUNDS", "Index") }],
    );
    expect(r.ok).toBe(false);
  });
});

/** A small whole and its parts, month by month. */
const monthly = (values: (string | null)[], start = 1): CellInput[] =>
  values.map((v, i) => ({ row: start + i, period: `2026-${String(i + 1).padStart(2, "0")}-01`, text: v }));

describe("mix", () => {
  const spec: MixTileSpec = {
    ...base,
    id: "pce-mix",
    datasetId: "pce",
    measure: "PCE",
    subject: "Services",
    verb: "were",
    unit: "Billions of Dollars",
    decimals: 1,
    form: "mix",
    transform: "share",
    headline: "share",
    draw: "columns",
    tolerance: "0.2",
    window: 3,
    whole: { label: "Personal consumption expenditures", subject: "personal consumption expenditures", series: { whole: true } },
    parts: [
      { datasetId: "pces", measure: "PCES", label: "Services", series: { whole: true } },
      { datasetId: "pcedg", measure: "PCEDG", label: "Durable goods", series: { whole: true } },
      { datasetId: "pcend", measure: "PCEND", label: "Nondurable goods", series: { whole: true } },
    ],
  };
  const line = (id: string, values: (string | null)[]) => ({ context: ctx(id, id.toUpperCase(), "Billions of Dollars"), cells: monthly(values) });

  it("shares each part of the publisher's whole, the first part leading", () => {
    const r = ok(
      computeMixTile(spec, line("pce", ["100.0", "200.0", "300.0"]), [line("pces", ["60.0", "130.1", "200.0"]), line("pcedg", ["10.0", "20.0", "30.0"]), line("pcend", ["30.0", "49.9", "70.1"])]),
    );
    expect(r.headline).toBe("Services were 66.7% of personal consumption expenditures in Mar 2026.");
    expect(r.figure).toBe("66.7");
    expect(r.shape).toMatchObject({ kind: "mix", share: true, largestGap: "0.1" });
    if (r.shape?.kind !== "mix") throw new Error("shape");
    expect(r.shape.parts[0].points.map((p) => p.display)).toEqual(["60.0", "65.1", "66.7"]);
  });

  it("refuses parts that do not sum to the whole within the publisher's rounding", () => {
    const r = computeMixTile(spec, line("pce", ["100.0", "200.0", "300.0"]), [line("pces", ["60.0", "130.0", "200.0"]), line("pcedg", ["10.0", "20.0", "30.0"]), line("pcend", ["30.0", "49.0", "70.0"])]);
    expect(r).toEqual({
      ok: false,
      reason: "In Feb 2026 the parts sum to 199.0 Billions of Dollars; the publisher's total is 200.0 Billions of Dollars, 1.0 apart, beyond the tolerance of 0.2.",
    });
  });

  it("leaves a period without every figure as a gap and leads with the latest complete one", () => {
    const r = ok(computeMixTile(spec, line("pce", ["100.0", "200.0", "300.0"]), [line("pces", ["60.0", "130.0", "200.0"]), line("pcedg", ["10.0", "20.0", null]), line("pcend", ["30.0", "50.0", "70.0"])]));
    expect(r.asOf).toBe("Feb 2026");
    expect(r.headline).toBe("Services were 65.0% of personal consumption expenditures in Feb 2026. No share for Mar 2026: the whole or a part has no figure.");
  });
});

/** One period across states, keyed as the source keys them. */
const states = (keys: string[], value: (i: number) => string | null, period = "2026-09", named = false): RankCellInput[] =>
  keys.map((key, i) => ({ row: i + 1, key, name: named ? key : null, period, text: value(i) }));

describe("map", () => {
  const spec: MapTileSpec = {
    ...base,
    id: "map",
    datasetId: "hpi",
    measure: "index_sa",
    subject: "house price index",
    unit: "Index, January 1991 = 100",
    decimals: 2,
    form: "map",
    transform: "level",
    headline: "rank",
    entities: "states",
    across: { by: "geo_code", period: "latest" },
  };
  const codes = GRID_PLACES.map((p) => p.code);
  const c = ctx("hpi", "index_sa", "Index, January 1991 = 100", "yyyy-mm", "month");

  it("fills every state, names the highest and lowest, and hatches a state without a figure", () => {
    const cells = states([...codes, "USA", "PR"], (i) => (i === 3 ? "" : (100 + i).toFixed(2)));
    const r = ok(computeMapTile(spec, c, cells, null));
    if (r.shape?.kind !== "map") throw new Error("shape");
    expect(r.shape.scale).toBe("sequential");
    expect(r.shape.places).toHaveLength(51);
    expect(r.shape.missing).toEqual([{ code: "NH", name: "New Hampshire" }]);
    expect(r.shape.others).toEqual(["USA"]);
    expect(r.shape.territories.map((t) => [t.code, t.display])).toEqual([["PR", "152.00"]]);
    expect(r.headline).toBe("Puerto Rico had the highest house price index of 51 states in Sep 2026, 152.00 (Index, January 1991 = 100); Alaska the lowest, 100.00 (Index, January 1991 = 100).");
    expect(r.gaps.empties).toBe(1);
  });

  it("matches two-digit FIPS codes and names the states from them, saying so", () => {
    const fips = GRID_PLACES.map((p) => p.fips);
    const r = ok(computeRankTile({ ...spec, form: "ranked-bars", transform: "rank", across: { by: "geo_code", period: "latest", top: 3 } } as RankTileSpec, c, states(fips, (i) => String(i))));
    expect(r.points.map((p) => p.label)).toEqual(["Florida", "Texas", "Hawaii"]);
    expect(r.sourceNote).toBe("State names from the FIPS codes the records carry.");
  });

  it("ranks lowest first when asked", () => {
    const r = ok(computeRankTile({ ...spec, verb: "had", form: "ranked-bars", transform: "rank", across: { by: "geo_code", period: "latest", top: 2, order: "lowest" } } as RankTileSpec, c, states(codes, (i) => String(i))));
    expect(r.headline).toBe("Alaska had the smallest house price index of 51 states in Sep 2026.");
  });

  it("maps a 12-month change on a diverging scale from the same period a year earlier", () => {
    const now = states(codes, (i) => (100 + i).toFixed(2));
    const then = states(codes, () => "120.00", "2025-09");
    const r = ok(computeMapTile({ ...spec, transform: "change-12m", changeAs: "percent" }, c, now, then));
    if (r.shape?.kind !== "map") throw new Error("shape");
    expect(r.shape.scale).toBe("diverging");
    expect(r.headline).toBe("Florida had the largest change in house price index of 51 states over the 12 months to Sep 2026, +25.0%; Alaska the smallest, −16.7%.");
    expect(r.derivation?.formula).toBe("for each state, 100 × (figure for Sep 2026 ÷ figure for Sep 2025 − 1), rounded to one decimal");
  });

  it("refuses places that are not states", () => {
    expect(computeMapTile(spec, c, states(["Northeast", "Midwest", "South", "West"], () => "1"), null)).toEqual({
      ok: false,
      reason: "The places of this table are not US states by one rule (postal code, FIPS code or name): fewer than 10 match.",
    });
  });

  it("writes the period a year earlier as the publisher does", () => {
    expect(yearEarlierText("2026-09", "yyyy-mm", "month")).toBe("2025-09");
    expect(yearEarlierText("20260930", "yyyymmdd", "quarter")).toBe("20250930");
    expect(yearEarlierText("2026Q3", "quarter", "quarter")).toBe("2025Q3");
    expect(yearEarlierText("2024-02-29", "iso-date", "month")).toBeNull();
    expect(yearEarlierText("2026-11-20", "iso-date", "week")).toBeNull();
  });

  it("reads a dimension's states by the rule that matches most keys", () => {
    expect(stateRule(["Texas", "Ohio", "Utah", "Iowa", "Maine", "Idaho", "Kansas", "Nevada", "Oregon", "Alaska"])?.kind).toBe("name");
  });
});

describe("distribution", () => {
  const spec: DistributionTileSpec = {
    ...base,
    id: "assets",
    collection: "01_financials",
    datasetId: "fdic",
    measure: "ASSET",
    subject: "total assets",
    unit: "USD thousands (monetary measures)",
    decimals: 0,
    form: "distribution",
    transform: "level",
    headline: "median",
    entities: "institutions in the FDIC cohort",
    across: { by: "entity_id", period: "latest" },
    draw: { as: "histogram", edges: ["1000000", "5000000", "10000000", "50000000"] },
  };
  const c = ctx("fdic", "ASSET", "USD thousands (monetary measures)", "yyyymmdd", "quarter");

  it("marks the median and quartiles of the cohort and counts every figure in a bin", () => {
    const r = ok(computeDistributionTile(spec, c, fdicCrossSection("ASSET")));
    expect(r.headline).toBe(
      // a report date that does not open its quarter names the day, as the cohort's ranking does
      "The median total assets of 496 institutions in the FDIC cohort was 6,115,843 USD thousands (monetary measures) on Sep 30, 2026; the middle half were between 3,564,855 and 15,901,271.",
    );
    if (r.shape?.kind !== "distribution") throw new Error("shape");
    expect(r.shape.count).toBe(496);
    expect(r.shape.bins?.reduce((s, b) => s + b.count, 0)).toBe(496);
    expect(r.shape.bins?.map((b) => b.label)).toEqual(["1000000 to 5000000", "5000000 to 10000000", "10000000 to 50000000", "50000000 and above"]);
    expect(r.derivation?.inputs).toHaveLength(2);
  });

  it("refuses bin edges that do not rise", () => {
    expect(computeDistributionTile({ ...spec, draw: { as: "histogram", edges: ["5", "1"] } }, c, fdicCrossSection("ASSET")).ok).toBe(false);
  });
});

describe("curve", () => {
  const spec: CurveTileSpec = {
    ...base,
    id: "curve",
    datasetId: "unrate",
    measure: "UNRATE",
    subject: "Rates",
    unit: "Percent",
    form: "curve",
    transform: "level",
    headline: "spread",
    yearEarlier: true,
    categories: [
      { label: "Unemployment", subject: "the unemployment rate", series: { whole: true } },
      { datasetId: "fedfunds", measure: "FEDFUNDS", label: "Funds", series: { whole: true } },
      { datasetId: "gs10", measure: "GS10", label: "10-year", subject: "the 10-year yield", series: { whole: true } },
    ],
  };

  it("takes the latest period every category has, names the ends and their spread", () => {
    const r = ok(computeCurveTile(spec, [fred("UNRATE"), fred("FEDFUNDS"), fred("GS10")]));
    expect(r.headline).toBe("The 10-year yield was 5.13% in Oct 2026, 1.03 percentage points above the unemployment rate.");
    if (r.shape?.kind !== "curve") throw new Error("shape");
    expect(r.shape.latest.map((p) => p.display)).toEqual(["4.10", "3.88", "5.13"]);
    // Oct 2025 has no unemployment rate in the source, so there is no curve a year earlier
    expect(r.shape.earlier).toBeNull();
    expect(r.gaps.noBase).toBe(3);
  });
});

describe("stat", () => {
  const spec: StatTileSpec = {
    ...base,
    id: "ff",
    datasetId: "fedfunds",
    measure: "FEDFUNDS",
    subject: "The effective federal funds rate",
    unit: "Percent",
    form: "stat",
    transform: "level",
    headline: "level",
    series: { whole: true },
    changeAs: "difference",
  };

  it("carries the level, its change over a year and 24 periods of sparkline", () => {
    const r = ok(computeStatTile(spec, fred("FEDFUNDS").context, fredCells("FEDFUNDS")));
    expect(r.figure).toBe("3.88");
    expect(r.shape).toEqual({ kind: "stat", change: { display: "−0.21", unit: "pp", sign: -1, against: "Oct 2025" } });
    expect(r.points).toHaveLength(24);
  });

  it("has no change where the period a year earlier has no figure", () => {
    const r = ok(computeStatTile({ ...spec, measure: "UNRATE", datasetId: "unrate" }, fred("UNRATE").context, fredCells("UNRATE")));
    expect(r.shape).toEqual({ kind: "stat", change: null });
  });
});

describe("records", () => {
  const about = { datasetId: "t", snapshotId: "s", retrieved: "24 Nov 2026" };
  const perYear: RecordsTileSpec = {
    id: "r",
    collection: "03_healthcare",
    datasetId: "t",
    title: "Records",
    subject: "The enforcement report",
    transform: "records",
    headline: "records",
    form: "bars",
    per: { dimension: "period", format: "yyyymm", by: "year" },
  };

  it("counts records per year from the store's exact counts per period, naming what has no period", () => {
    const r = ok(
      computeRecordsTile(
        perYear,
        {
          from: "facets",
          complete: true,
          values: [
            { value: "202501", label: null, rows: 10, exact: true },
            { value: "202502", label: null, rows: 5, exact: true },
            { value: "202601", label: null, rows: 7, exact: true },
            { value: "Source: the agency", label: null, rows: 1, exact: true },
          ],
        },
        about,
      ),
    );
    expect(r.headline).toBe('The enforcement report holds 23 records from 2025 to 2026; the most, 15, in 2025. 1 record has no period of the declared format ("Source: the agency").');
    if (r.shape?.kind !== "records") throw new Error("shape");
    expect(r.shape.counts.map((c) => [c.key, c.count, c.filter])).toEqual([
      ["2025", 15, null],
      ["2026", 7, { period: "202601" }],
    ]);
    expect(r.figureUnit).toBe("records");
  });

  it("refuses counts that are a floor or do not fit one read", () => {
    expect(computeRecordsTile(perYear, { from: "facets", complete: false, values: [] }, about).ok).toBe(false);
    expect(computeRecordsTile(perYear, { from: "facets", complete: true, values: [{ value: "202501", label: null, rows: 250000, exact: false }] }, about).ok).toBe(false);
  });

  it("ranks the values of a cell with the most records and sums the rest", () => {
    const r = ok(
      computeRecordsTile(
        { ...perYear, form: "ranked-bars", per: { field: "vendorProject", top: 2 }, noun: "vendors" },
        { from: "cells", cells: ["Microsoft", "Apple", "Microsoft", "Cisco", "Apple", "Microsoft", "", null] },
        about,
      ),
    );
    expect(r.headline).toBe("The enforcement report holds 8 records as retrieved on 24 Nov 2026; Microsoft has the most, 3, of 3 vendors.");
    if (r.shape?.kind !== "records") throw new Error("shape");
    expect(r.shape.counts.map((c) => [c.label, c.count])).toEqual([
      ["Microsoft", 3],
      ["Apple", 2],
    ]);
    expect(r.shape.rest).toBe(1);
    expect(r.shape.unplaced).toBe(2);
  });

  it("counts records by a date cell per month", () => {
    const r = ok(
      computeRecordsTile(
        { ...perYear, per: { field: "dateAdded", format: "iso-date", by: "month" } },
        { from: "cells", cells: ["2026-10-02", "2026-10-30", "2026-11-01", "not a date"] },
        about,
      ),
    );
    if (r.shape?.kind !== "records") throw new Error("shape");
    expect(r.shape.counts.map((c) => [c.label, c.count])).toEqual([
      ["Oct 2026", 2],
      ["Nov 2026", 1],
    ]);
    expect(r.shape.unplaced).toBe(1);
  });

  it("maps records per state from the counts of the place index", () => {
    const values = GRID_PLACES.map((p, i) => ({ value: p.code, label: null, rows: i + 1, exact: true }));
    const r = ok(computeRecordsTile({ ...perYear, form: "map", per: { dimension: "geo_code", top: 60 } }, { from: "facets", complete: true, values }, about));
    if (r.shape?.kind !== "map") throw new Error("shape");
    expect(r.shape.missing).toEqual([]);
    expect(r.headline).toBe("The enforcement report holds 1,326 records as retrieved on 24 Nov 2026; Florida has the most, 51, of 51 states and territories.");
  });
});

describe("rank wording by the profile's cadence", () => {
  const spec = {
    ...base,
    id: "r",
    datasetId: "d",
    measure: "v",
    subject: "figure",
    verb: "had" as const,
    unit: "Number",
    decimals: 0,
    form: "ranked-bars" as const,
    transform: "rank" as const,
    headline: "rank" as const,
    entities: "places",
    across: { by: "entity_id" as const, period: "latest", top: 2 },
  };
  const cells = (period: string, names = ["A", "B", "C"]): RankCellInput[] => names.map((name, i) => ({ row: i + 1, key: `k${i}`, name, period, text: String(10 - i) }));
  const at = (period: string, format: PeriodFormat, cadence: Cadence) => ok(computeRankTile(spec as RankTileSpec, ctx("d", "v", "Number", format, cadence), cells(period))).headline;

  it("names a year, a month, a quarter, and the day of a report date that does not open its period", () => {
    expect(at("2025", "year", "year")).toBe("A had the largest figure of 3 places in 2025.");
    expect(at("2026-10", "yyyy-mm", "month")).toBe("A had the largest figure of 3 places in Oct 2026.");
    expect(at("2026-10-01", "iso-date", "month")).toBe("A had the largest figure of 3 places in Oct 2026.");
    expect(at("2026Q3", "quarter", "quarter")).toBe("A had the largest figure of 3 places in Q3 2026.");
    expect(at("20260930", "yyyymmdd", "quarter")).toBe("A had the largest figure of 3 places on Sep 30, 2026.");
  });

  it("refuses bars that would carry one label twice", () => {
    const r = computeRankTile(spec as RankTileSpec, ctx("d", "v", "Number", "year", "year"), cells("2025", ["Harrison", "Harrison", "Polk"]));
    expect(r).toEqual({ ok: false, reason: 'Two bars would both read "Harrison" (rows 1 and 2); the tile must name a field that tells them apart (labelWith).' });
  });
});

describe("figures right-aligned with spaces", () => {
  const spec: StatTileSpec = {
    ...base,
    id: "padded",
    datasetId: "nmfp",
    measure: "TOTALVALUE",
    subject: "Total value",
    unit: "USD",
    decimals: 1,
    form: "stat",
    transform: "level",
    headline: "level",
    series: { whole: true },
    changeAs: "percent",
  };
  // Jan 2025 to Jan 2026, as a fixed-width file writes them
  const texts = ["   1000.0", "   1100.0", "", "  1200.5", "", "", "", "", "", "", "", "", "   1260.5"];
  const cells: CellInput[] = texts.map((text, i) => ({ row: i + 1, period: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, text }));

  it("are read when the measure declares the padding, and stay text when it does not", () => {
    const padded = ok(computeStatTile(spec, { ...ctx("nmfp", "TOTALVALUE", "USD"), padding: "leading-spaces" }, cells));
    expect(padded.figure).toBe("1,260.5");
    expect(padded.shape).toMatchObject({ kind: "stat", change: { display: "+26.1", unit: "%" } });
    expect(padded.points.find((p) => p.key === "2025-04-01")?.text).toBe("  1200.5");
    expect(computeStatTile(spec, ctx("nmfp", "TOTALVALUE", "USD"), cells)).toMatchObject({ ok: false });
  });
});
