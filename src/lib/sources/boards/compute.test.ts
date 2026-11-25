import { describe, expect, it } from "vitest";
import type { PeriodFormat } from "../periods";
import { computeRankTile, computeSeriesTile, computeShareTile, periodId, yearEarlierId, type CellInput, type TileContext } from "./compute";
import { fdicCrossSection, fdicSummaryCells, fhfaCells, fredCells, merCells } from "./fixtures";
import { tileSpec } from "./specs";
import type { Cadence, RankTileSpec, SeriesTileSpec, TileResult } from "./types";

/** Every expected figure below was computed independently from the same rows with Python's Decimal. */

const series = (id: string) => {
  const spec = tileSpec(id);
  if (!spec || spec.transform === "rank" || spec.transform === "share") throw new Error(`no series tile ${id}`);
  return spec;
};
const rank = (id: string) => {
  const spec = tileSpec(id);
  if (!spec || spec.transform !== "rank") throw new Error(`no rank tile ${id}`);
  return spec;
};

function context(spec: { datasetId: string; measure: string; unit: string }, format: PeriodFormat, cadence: Cadence, unit: "fixed" | "column" = "fixed"): TileContext {
  return {
    datasetId: spec.datasetId,
    snapshotId: "snapshot",
    field: spec.measure,
    unit: unit === "fixed" ? { from: "fixed", text: spec.unit } : { from: "column" },
    format,
    cadence,
    grouping: "none",
  };
}

const fred = (id: string, cadence: Cadence = "month") => {
  const spec = series(id);
  return computeSeriesTile(spec, context(spec, "iso-date", cadence), fredCells(spec.measure));
};
const mer = (id: string, msn: string) => {
  const spec = series(id);
  return computeSeriesTile(spec, context(spec, "yyyymm", "month", "column"), merCells(msn));
};
const ok = (r: TileResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe("FRED tiles on the stored rows of 24 Nov 2026", () => {
  it("states a 12-month change of a price index", () => {
    const r = ok(fred("pce-prices-12m"));
    expect(r.headline).toBe("The PCE price index rose 3.6% over the 12 months to Sep 2026.");
    expect(r.figure).toBe("+3.6");
    expect(r.figureUnit).toBe("%");
    expect(r.plotUnit).toBe("%");
    expect(r.derivation?.inputs.map((i) => [i.period, i.text, i.row])).toEqual([
      ["2026-09-01", "132.257", 321],
      ["2025-09-01", "127.601", 309],
    ]);
    expect(r.points).toHaveLength(36);
  });

  it("keeps the latest level when the month a year earlier is empty, and says so", () => {
    const r = ok(fred("unemployment-rate"));
    expect(r.headline).toBe("The unemployment rate was 4.1% in Oct 2026. No comparison with a year earlier: Oct 2025 has no figure (empty in the source).");
    const gap = r.points.find((p) => p.key === "2025-10-01");
    expect(gap).toMatchObject({ value: null, display: "–", text: "" });
    expect(r.gaps).toMatchObject({ count: 1, empties: 1 });
  });

  it("states a rate's change in percentage points with a true minus sign in the figure", () => {
    const r = ok(fred("fed-funds-rate"));
    expect(r.headline).toBe("The effective federal funds rate was 3.88% in Oct 2026, 0.21 percentage points below Oct 2025.");
    expect(ok(fred("treasury-10y")).headline).toBe(
      "The 10-year Treasury constant maturity yield was 5.13% in Oct 2026, 1.07 percentage points above Oct 2025.",
    );
  });

  it("compares a quarter with the same quarter a year earlier", () => {
    const r = ok(fred("real-gdp-4q", "quarter"));
    expect(r.headline).toBe("Real gross domestic product rose 2.1% over the four quarters to Q3 2026.");
    expect(r.asOf).toBe("Q3 2026");
  });

  it("finds the week 52 weeks earlier and names weeks by the day they end", () => {
    const claims = ok(fred("initial-claims", "week"));
    expect(claims.headline).toBe(
      "Initial claims for unemployment insurance were 203,000 in the week ending Nov 14, 2026, 8.6% below the week ending Nov 15, 2025.",
    );
    const mortgage = ok(fred("mortgage-rate-30y", "week"));
    expect(mortgage.headline).toBe(
      "The 30-year fixed mortgage rate average was 7.28% in the week ending Nov 19, 2026, 1.02 percentage points above the week ending Nov 20, 2025.",
    );
    expect(mortgage.points).toHaveLength(104);
  });

  it("writes levels with the publisher's unit", () => {
    expect(ok(fred("housing-starts")).headline).toBe("Housing starts were 1,309 Thousands of Units in Oct 2026, 2.8% above Oct 2025.");
    expect(ok(fred("new-home-price")).headline).toBe("The median sales price of new houses sold was 400,400 Dollars in Sep 2026, 3.9% below Sep 2025.");
    expect(ok(fred("retail-sales")).headline).toBe("Retail and food services sales were 748,220 Millions of Dollars in Oct 2026, 6.8% above Oct 2025.");
    expect(ok(fred("vehicle-sales")).headline).toBe("Total vehicle sales were 16.003 Millions of Units in Oct 2026, 0.1% below Oct 2025.");
    expect(ok(fred("ecommerce-share", "quarter")).headline).toBe(
      "E-commerce retail sales as a percent of total sales was 17.9% in Q3 2026, 0.8 percentage points above Q3 2025.",
    );
    expect(ok(fred("durable-goods-orders")).headline).toBe("New orders for durable goods were 345,672 Millions of Dollars in Sep 2026, 10.0% above Sep 2025.");
    expect(ok(fred("freight-services-index")).headline).toBe(
      "The freight transportation services index was 134.4 (Index 2000=100) in Aug 2026, 3.0% below Aug 2025.",
    );
    expect(ok(fred("manufacturing-employment")).headline).toBe(
      "Manufacturing employment was 12,681 Thousands of Persons in Oct 2026, 78 Thousands of Persons above Oct 2025.",
    );
    expect(ok(fred("case-shiller-12m")).headline).toBe("The Case-Shiller U.S. National Home Price Index rose 2.1% over the 12 months to Aug 2026.");
  });

  it("names the latest change that exists when the latest month has no year-earlier figure", () => {
    const r = ok(fred("cpi-all-items-12m"));
    expect(r.headline).toBe(
      "The CPI-U all items index rose 3.7% over the 12 months to Sep 2026. No change for Oct 2026: Oct 2025 has no figure (empty in the source).",
    );
    expect(r.asOf).toBe("Sep 2026");
    const last = r.points[r.points.length - 1];
    expect(last).toMatchObject({ key: "2026-10-01", value: null, display: "–" });
    expect(ok(fred("cpi-food-12m")).headline.startsWith("The CPI-U food index rose 2.5% over the 12 months to Sep 2026.")).toBe(true);
    expect(ok(fred("cpi-food-away-12m")).headline.startsWith("The CPI-U food away from home index rose 3.5% over the 12 months to Sep 2026.")).toBe(true);
  });
});

describe("EIA Monthly Energy Review tiles", () => {
  it("reads the unit from each record and leaves EIA's annual rows out", () => {
    const r = ok(mer("energy-consumption", "TETCBUS"));
    expect(r.headline).toBe("Total primary energy consumption was 8.29 Quadrillion Btu in Aug 2026, 1.7% above Aug 2025.");
    expect(r.gaps.otherPeriods).toBe(3);
    expect(r.points.every((p) => !p.key.endsWith("13"))).toBe(true);
    expect(r.refs.rows).toEqual([8652, 8639]);
  });

  it("states production, generation and prices", () => {
    expect(ok(mer("crude-oil-production", "PAPRPUS")).headline).toBe(
      "U.S. crude oil production was 13,761 Thousand Barrels per Day in Oct 2026, 1.7% below Oct 2025.",
    );
    expect(ok(mer("electricity-generation", "ELETPUS")).headline).toBe(
      "Total electricity net generation was 449.4 Billion Kilowatthours in Aug 2026, 6.9% above Aug 2025.",
    );
    expect(ok(mer("gasoline-price", "RMRTUUS")).headline).toBe(
      "The retail price of regular gasoline was 4.31 Dollars per Gallon Including Taxes in Oct 2026, 40.8% above Oct 2025.",
    );
  });

  it("refuses a record that states another unit or another series name", () => {
    const spec = series("energy-consumption");
    const cells = merCells("TETCBUS");
    const renamed = cells.map((c, i) => (i === cells.length - 1 ? { ...c, unit: "Trillion Btu" } : c));
    const r = computeSeriesTile(spec, context(spec, "yyyymm", "month", "column"), renamed);
    expect(r).toEqual({ ok: false, reason: 'Row 8652 (202608) states the unit "Trillion Btu"; the tile expects "Quadrillion Btu".' });
    const other = cells.map((c, i) => (i === 0 ? { ...c, check: "Total Primary Energy Production" } : c));
    expect(computeSeriesTile(spec, context(spec, "yyyymm", "month", "column"), other).ok).toBe(false);
  });

  it("refuses two records for one month (one MSN under two columns)", () => {
    const spec = series("energy-consumption");
    const cells = merCells("TETCBUS");
    const r = computeSeriesTile(spec, context(spec, "yyyymm", "month", "column"), [...cells, { ...cells[cells.length - 1], row: 9999 }]);
    expect(r).toEqual({ ok: false, reason: "Two records for Aug 2026 (rows 8652 and 9999): the selection is not one series." });
  });
});

describe("FDIC tiles", () => {
  it("ranks every institution of the latest quarter and names the cohort", () => {
    const spec = rank("largest-banks-assets") as RankTileSpec;
    const r = ok(computeRankTile(spec, context(spec, "yyyymmdd", "day"), fdicCrossSection("ASSET")));
    expect(r.headline).toBe(
      "JPMORGAN CHASE BANK NA had the largest total assets of 496 institutions in the FDIC cohort on Sep 30, 2026.",
    );
    expect(r.figure).toBe("4,174,631,000");
    expect(r.figureUnit).toBe("USD thousands (monetary measures)");
    expect(r.points.map((p) => p.key)).toEqual(["628", "3510", "7213", "3511", "33124", "6548", "4297", "6384", "9846", "32992"]);
    expect(r.points[4]).toMatchObject({ label: "GOLDMAN SACHS BANK USA", display: "789,723,000", text: "789723000", row: 356 });
    const deposits = ok(computeRankTile(rank("largest-banks-deposits"), context(rank("largest-banks-deposits"), "yyyymmdd", "day"), fdicCrossSection("DEP")));
    expect(deposits.points.map((p) => p.key)).toEqual(["628", "3510", "7213", "3511", "6548", "33124", "4297", "6384", "9846", "639"]);
  });

  it("refuses a cross-section of several periods and a repeated institution", () => {
    const spec = rank("largest-banks-assets");
    const cells = fdicCrossSection("ASSET");
    expect(computeRankTile(spec, context(spec, "yyyymmdd", "day"), [...cells, { ...cells[0], period: "20260630", key: "x" }]).ok).toBe(false);
    expect(computeRankTile(spec, context(spec, "yyyymmdd", "day"), [...cells, { ...cells[0], row: 999 }])).toEqual({
      ok: false,
      reason: "14 appears twice in the cross-section (row 999).",
    });
  });

  it("states the industry series of commercial banks by year", () => {
    const assets = series("commercial-banks-assets");
    expect(ok(computeSeriesTile(assets, context(assets, "year", "year"), fdicSummaryCells("ASSET"))).headline).toBe(
      "Total assets of FDIC-insured commercial banks were 24,067,204,474 USD thousands (monetary measures) in 2025, 5.1% above 2024.",
    );
    const income = series("commercial-banks-income");
    const r = ok(computeSeriesTile(income, context(income, "year", "year"), fdicSummaryCells("NETINC")));
    expect(r.headline).toBe("Net income of FDIC-insured commercial banks was 282,555,198 USD thousands (monetary measures) in 2025, 8.9% above 2024.");
    expect(r.points.find((p) => p.key === "2009")).toMatchObject({ display: "−11,619,811", text: "-11619811" });
  });
});

describe("reader scale of a level in a whitelisted unit", () => {
  it("adds the figure in reader scale and the stored figure as filed, and keeps the headline as stored", () => {
    const assets = series("commercial-banks-assets");
    const r = ok(computeSeriesTile(assets, context(assets, "year", "year"), fdicSummaryCells("ASSET")));
    expect(r.headline).toContain("24,067,204,474 USD thousands (monetary measures) in 2025");
    expect(r.figure).toBe("24,067,204,474");
    expect(r.plotUnit).toBe("USD thousands (monetary measures)");
    expect(r.reader).toMatchObject({
      figure: "$24.07 trillion",
      unit: "",
      filed: "24,067,204,474 USD thousands (monetary measures) as filed",
      axis: { title: "USD trillions", divisor: 1e9, decimals: 2 },
    });
    // the bars and the table keep the stored figure; the chart's labels are in trillions
    expect(r.points[r.points.length - 1]).toMatchObject({ display: "24,067,204,474", text: "24067204474", axisDisplay: "24.07" });
    const income = series("commercial-banks-income");
    const net = ok(computeSeriesTile(income, context(income, "year", "year"), fdicSummaryCells("NETINC")));
    expect(net.reader).toMatchObject({ figure: "$282.6 billion", axis: { title: "USD billions" } });
    expect(net.points.find((p) => p.key === "2009")).toMatchObject({ display: "−11,619,811", axisDisplay: "−11.6" });
  });

  it("scales FRED and EIA levels and names the base unit after the figure", () => {
    expect(ok(fred("housing-starts")).reader).toMatchObject({ figure: "1.309 million", unit: "units", filed: "1,309 Thousands of Units as filed" });
    expect(ok(fred("retail-sales")).reader).toMatchObject({ figure: "$748.2 billion", axis: { title: "Billions of Dollars" } });
    expect(ok(fred("durable-goods-orders")).reader?.figure).toBe("$345.7 billion");
    expect(ok(fred("manufacturing-employment")).reader).toMatchObject({ figure: "12.68 million", unit: "persons" });
    const oil = ok(mer("crude-oil-production", "PAPRPUS"));
    expect(oil.reader).toMatchObject({ figure: "13.76 million", unit: "barrels per day", axis: { title: "Million Barrels per Day" } });
    expect(oil.headline).toBe("U.S. crude oil production was 13,761 Thousand Barrels per Day in Oct 2026, 1.7% below Oct 2025.");
  });

  it("ranks in the stored unit and labels every bar in the leader's scale", () => {
    const spec = rank("largest-banks-assets");
    const r = ok(computeRankTile(spec, context(spec, "yyyymmdd", "day"), fdicCrossSection("ASSET")));
    expect(r.reader).toMatchObject({ figure: "$4.175 trillion", filed: "4,174,631,000 USD thousands (monetary measures) as filed" });
    expect(r.points.slice(0, 3).map((p) => [p.display, p.axisDisplay])).toEqual([
      ["4,174,631,000", "4.175"],
      ["2,657,391,000", "2.657"],
      ["2,018,870,000", "2.019"],
    ]);
  });

  it("leaves other units, and every change tile, as filed", () => {
    for (const r of [ok(fred("vehicle-sales")), ok(fred("unemployment-rate")), ok(fred("pce-prices-12m")), ok(mer("energy-consumption", "TETCBUS"))]) {
      expect(r.reader).toBeUndefined();
      expect(r.points.every((p) => p.axisDisplay === undefined)).toBe(true);
    }
  });
});

describe("FHFA tile", () => {
  it("composes the month from the year and period fields and states the 12-month change", () => {
    const spec = series("house-prices-12m");
    const r = ok(computeSeriesTile(spec, context(spec, "yyyy-mm", "month"), fhfaCells("index_sa")));
    expect(r.headline).toBe("The FHFA purchase-only house price index for the United States rose 2.5% over the 12 months to Sep 2026.");
    expect(r.refs.rows).toEqual([4290, 4278]);
  });
});

describe("rules", () => {
  const spec: SeriesTileSpec = {
    id: "t",
    collection: "c",
    datasetId: "d",
    measure: "v",
    title: "t",
    subject: "The series",
    unit: "Percent",
    decimals: 1,
    form: "line",
    transform: "level",
    headline: "level",
    series: { whole: true },
    window: 12,
  };
  const ctx = context(spec, "yyyy-mm", "month");
  const cells = (texts: (string | null)[]): CellInput[] => texts.map((t, i) => ({ row: i + 1, period: `2026-${String(i + 1).padStart(2, "0")}`, text: t }));

  it("refuses a percent change of a rate stated in percent; a difference in points is shown (review int-code N5)", () => {
    const rate = cells(Array.from({ length: 13 }, (_, i) => (i === 12 ? "4.4" : "4.0"))).map((c, i) => ({ ...c, period: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}` }));
    const reason = "A rate stated in percent changes by a difference in percentage points; a percent change of it is not shown.";
    expect(computeSeriesTile({ ...spec, transform: "change-12m", headline: "change", changeAs: "percent" }, ctx, rate)).toEqual({ ok: false, reason });
    expect(computeSeriesTile({ ...spec, changeAs: "percent" }, ctx, rate)).toEqual({ ok: false, reason });
    const points = ok(computeSeriesTile({ ...spec, transform: "change-12m", headline: "change", changeAs: "difference" }, ctx, rate));
    expect(points.headline).toContain("0.4 percentage points");
  });

  it("never shows an older figure as the latest", () => {
    expect(computeSeriesTile(spec, ctx, cells(["1.0", "2.0", ""]))).toEqual({ ok: false, reason: "The latest period, Mar 2026, has no figure (empty in the source)." });
    expect(computeSeriesTile(spec, { ...ctx, markers: ["NA"] }, cells(["1.0", "NA"]))).toEqual({
      ok: false,
      reason: 'The latest period, Feb 2026, has no figure (marked "NA").',
    });
  });

  it("counts gaps by kind and never reads them as zero", () => {
    const r = ok(computeSeriesTile(spec, { ...ctx, markers: ["NA"] }, cells([null, "", "NA", "n/a", "0", "1.5"])));
    expect(r.gaps).toMatchObject({ count: 4, nulls: 1, empties: 1, markers: 1, texts: 1 });
    expect(r.points.map((p) => p.value)).toEqual([null, null, null, null, 0, 1.5]);
  });

  it("refuses a unit the source does not state", () => {
    expect(computeSeriesTile(spec, { ...ctx, unit: { from: "fixed", text: "Index" } }, cells(["1.0"]))).toEqual({
      ok: false,
      reason: 'The source states the unit "Index" for v; the tile expects "Percent".',
    });
  });

  it("has no year-earlier comparison for a daily series", () => {
    expect(computeSeriesTile({ ...spec, changeAs: "difference" }, { ...ctx, cadence: "day" }, cells(["1.0"])).ok).toBe(false);
  });

  it("knows which period is a year earlier", () => {
    expect(yearEarlierId("2026-10-01", "month")).toBe("2025-10");
    expect(yearEarlierId("2026-07-01", "quarter")).toBe("2025Q3");
    expect(yearEarlierId("2026-11-19", "week")).toBe("2025-11-20");
    expect(yearEarlierId("2026-11-19", "day")).toBeNull();
    expect(periodId("2026-06-30", "quarter")).toBe("2026Q2");
  });

  it("computes a share period by period from exact digits", () => {
    const share = {
      ...spec,
      transform: "share" as const,
      headline: "level" as const,
      unit: "Billion Kilowatthours",
      subject: "Natural gas",
      of: { whole: true as const },
      ofSubject: "total net generation",
    };
    const r = ok(
      computeShareTile(share, { ...ctx, unit: { from: "fixed", text: "Billion Kilowatthours" } }, cells(["150.5", "160.25"]), cells(["400", "401"])),
    );
    expect(r.headline).toBe("Natural gas was 40.0% of total net generation in Feb 2026.");
    expect(r.points.map((p) => p.display)).toEqual(["37.6", "40.0"]);
  });
});
