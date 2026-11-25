import { describe, expect, it } from "vitest";
import eiaMer from "@/test/fixtures/sources/details/eia-mer.json";
import fdicPanel from "@/test/fixtures/sources/details/fdic-panel.json";
import fdicSod from "@/test/fixtures/sources/details/fdic-sod-branches.json";
import fhfa from "@/test/fixtures/sources/details/fhfa-hpi-master.json";
import frbDaily from "@/test/fixtures/sources/details/frb-daily-weekly.json";
import ccsa from "@/test/fixtures/sources/details/fred-ccsa.json";
import msha from "@/test/fixtures/sources/details/msha-coal.json";
import twse from "@/test/fixtures/sources/details/twse-revenue.json";
import copper from "@/test/fixtures/sources/details/usgs-copper.json";
import { defaultFields } from "./fields";
import { filledShares, firstLook, recordsPerPeriod, topByRecords, type FirstLookPlan } from "./first-look";
import type { SourceFacetValue } from "./read-types";
import type { SourceColumn, SourceDatasetDetail, SourceSnapshot } from "./schema";

const detail = (fixture: unknown) => fixture as SourceDatasetDetail;
const plan = (fixture: unknown, counts: { entities?: number; periods?: number; geographies?: number } = {}): FirstLookPlan => {
  const d = detail(fixture);
  const snapshot = d.snapshot!;
  return firstLook({ datasetId: d.dataset.id, snapshot, ...counts, fields: defaultFields(snapshot.columns, snapshot.ingest) });
};
const kinds = (p: FirstLookPlan) => p.views.map((v) => v.kind);

/** The FDIC panel at full width: its 18 complete descriptors in place, the other fields as the live shape types them. */
function fdicFullWidth(): SourceSnapshot {
  const fixture = fdicPanel as unknown as { snapshot: SourceSnapshot; columns_total: number; columns_complete: (SourceColumn & { position: number })[] };
  const columns: SourceColumn[] = Array.from({ length: fixture.columns_total }, (_, i) => ({
    key: `col${String(i).padStart(4, "0")}`,
    label: `F${i}`,
    type: "string",
    native_type: "number",
    unit: "Not explicitly specified in retrieved field metadata",
  }));
  for (const { position, ...column } of fixture.columns_complete) columns[position] = column;
  return { ...fixture.snapshot, columns };
}

describe("firstLook on the live table shapes", () => {
  it("opens a FRED series on its records per period", () => {
    const p = plan(ccsa);
    expect(p.shape).toBe("series");
    expect(kinds(p)).toEqual(["records-per-period", "fields"]);
    const [perPeriod] = p.views;
    expect(perPeriod.read).toEqual({ read: "facets", args: { datasetId: detail(ccsa).dataset.id, snapshotId: detail(ccsa).snapshot!.id, dimension: "period", limit: 1000 } });
    expect(perPeriod.fallback).toEqual({ read: "periodRange", args: { datasetId: detail(ccsa).dataset.id, snapshotId: detail(ccsa).snapshot!.id } });
    expect(p.note).toBe("No field of this table states a numeric type and unit, so values are shown as published.");
  });

  it("opens a panel on its entities, then places, then periods", () => {
    expect(kinds(plan(eiaMer))).toEqual(["entities", "records-per-period", "fields"]);
    const coal = plan(msha);
    expect(coal.shape).toBe("panel");
    expect(kinds(coal)).toEqual(["entities", "places", "records-per-period", "fields"]);
    expect(coal.views[0].read).toMatchObject({ read: "facets", args: { dimension: "entity_id" } });
    expect(coal.views[0].fallback).toMatchObject({ read: "entities", args: { dimension: "entity" } });
    expect(coal.views[1].read).toMatchObject({ read: "facets", args: { dimension: "geo_code" } });
    expect(coal.views[1].fallback).toMatchObject({ read: "entities", args: { dimension: "geo" } });
    expect(kinds(plan(fdicSod))).toEqual(["entities", "places", "records-per-period", "fields"]);
    expect(kinds(plan(frbDaily))).toEqual(["entities", "fields"]);
  });

  it("opens a place table on its places", () => {
    const p = plan(fhfa);
    expect(p.shape).toBe("places");
    expect(kinds(p)).toEqual(["places", "records-per-period", "fields"]);
  });

  it("gives a table whose period is a constant no period view and no strip", () => {
    const p = plan(twse);
    expect(detail(twse).snapshot!.ingest.constants?.period).toBeDefined();
    expect(kinds(p)).toEqual(["entities", "fields"]);
    expect(p.strip).toBeNull();
  });

  it("drops a view whose dimension a count shows holds one value", () => {
    const p = plan(msha, { periods: 1, geographies: 1 });
    expect(kinds(p)).toEqual(["entities", "fields"]);
    expect(p.strip).toBeNull();
    expect(plan(msha, { entities: 1 }).shape).toBe("places");
  });

  it("knows the FDIC panel types measures in its dictionary, at 2,379 fields", () => {
    const snapshot = fdicFullWidth();
    expect(snapshot.columns).toHaveLength(2379);
    const started = Date.now();
    const p = firstLook({ datasetId: detail(fdicPanel).dataset.id, snapshot, fields: defaultFields(snapshot.columns, snapshot.ingest) });
    expect(Date.now() - started).toBeLessThan(500);
    expect(p.shape).toBe("panel");
    expect(kinds(p)).toEqual(["entities", "places", "records-per-period", "fields"]);
    expect(p.dictionaryQuantities).toBeGreaterThan(0);
    expect(p.note).toBe("No reviewed profile names a measure of this table yet, so values are shown as published.");
    // Opens on the declared dimensions: CERT (0), REPDTE (1), NAME (1176), the place code (2050).
    expect(p.views.at(-1)!.positions!.slice(0, 4).sort((a, b) => a - b)).toEqual([0, 1, 1176, 2050]);
  });

  it("says an empty snapshot holds no records and shows only its fields", () => {
    const snapshot = { ...detail(ccsa).snapshot!, loaded_rows: 0 };
    const p = firstLook({ datasetId: "empty", snapshot });
    expect(p.shape).toBe("table");
    expect(kinds(p)).toEqual(["fields"]);
    expect(p.note).toBe("This snapshot holds no records.");
  });

  it("plans an empty dictionary without a field to show", () => {
    const snapshot = { ...detail(ccsa).snapshot!, columns: [], quality: {} };
    const p = firstLook({ datasetId: "x", snapshot });
    expect(p.views.at(-1)).toMatchObject({ kind: "fields", positions: [] });
    expect(p.dictionaryQuantities).toBe(0);
    expect(filledShares(snapshot, [0])).toBeNull();
  });

  it("shows the first eight fields when no default view is given, and never a position outside the dictionary", () => {
    const snapshot = detail(copper).snapshot!;
    expect(firstLook({ datasetId: "x", snapshot }).views.at(-1)!.positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(firstLook({ datasetId: "x", snapshot, fields: [12, 13, -1, 2] }).views.at(-1)!.positions).toEqual([12, 2]);
  });
});

const facet = (value: string, rows: number, exact = true): SourceFacetValue => ({ value, label: null, rows, exact });

describe("recordsPerPeriod", () => {
  it("draws one bar per period, oldest first, with the reader's label", () => {
    const shaped = recordsPerPeriod([facet("202603", 120), facet("202601", 118), facet("202602", 119, false)], "yyyymm");
    expect(shaped.grouping).toBe("period");
    expect(shaped.bars).toEqual([
      { label: "Jan 2026", title: "202601", rows: 118, exact: true, periods: ["202601"] },
      { label: "Feb 2026", title: "202602", rows: 119, exact: false, periods: ["202602"] },
      { label: "Mar 2026", title: "202603", rows: 120, exact: true, periods: ["202603"] },
    ]);
  });

  it("groups more than sixty dated periods by year, counting records only", () => {
    const days = Array.from({ length: 400 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      return facet(date, 1, i !== 10);
    });
    const shaped = recordsPerPeriod([...days, facet("n/a", 3)], "iso-date");
    expect(shaped.grouping).toBe("year");
    expect(shaped.bars.map((b) => [b.label, b.rows, b.exact])).toEqual([
      ["2025", 365, false],
      ["2026", 35, true],
    ]);
    expect(shaped.unplaced).toBe(1);
  });

  it("draws nothing for more than sixty periods it cannot place on a calendar", () => {
    const codes = Array.from({ length: 61 }, (_, i) => facet(`P${i}`, 2));
    expect(recordsPerPeriod(codes, "text")).toEqual({ bars: [], grouping: "none", unplaced: 0 });
    expect(recordsPerPeriod([facet("P2", 1), facet("P10", 1), facet("P1", 1)], "text").bars.map((b) => b.label)).toEqual(["P1", "P10", "P2"]);
  });
});

describe("topByRecords and filledShares", () => {
  it("ranks by records, ties in code-point order", () => {
    const ranked = topByRecords([facet("0300", 5), facet("0100", 9), facet("0200", 9), facet("0400", 1)], 3);
    expect(ranked.map((v) => v.value)).toEqual(["0100", "0200", "0300"]);
    expect(topByRecords([facet("a", 1)], 0)).toEqual([]);
  });

  it("reads the snapshot's own blank counts and refuses counts that do not fit the dictionary", () => {
    const snapshot = detail(copper).snapshot!;
    const shares = filledShares(snapshot, [0, 1]);
    const blanks = (snapshot.quality as { blank_counts_by_column: number[] }).blank_counts_by_column;
    expect(shares).toEqual([0, 1].map((p) => ({
      position: p,
      key: snapshot.columns[p].key,
      label: snapshot.columns[p].label,
      filled: snapshot.loaded_rows - blanks[p],
      blank: blanks[p],
      share: (snapshot.loaded_rows - blanks[p]) / snapshot.loaded_rows,
    })));
    expect(filledShares(detail(fdicSod).snapshot!, [0])).toBeNull();
    expect(filledShares({ ...snapshot, quality: { blank_counts_by_column: [0] } }, [0])).toBeNull();
  });
});
