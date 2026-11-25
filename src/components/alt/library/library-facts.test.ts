import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import type { SourceLibraryChange } from "@/lib/sources/read-types";
import {
  changeLines,
  changeText,
  changeWhen,
  collectionCards,
  libraryFacts,
  publisherLabel,
  publisherNames,
  publisherRows,
} from "./library-facts";
import { shapeSegments, shapeSummary } from "./shape-bar";
import { lib, libRow } from "./test-rows";

const SNAP = "b".repeat(64);
const ROWS = [
  libRow({ id: "fdic_panel", rows: 51453, retrievedAt: "2026-11-24T20:00:00Z", refreshFamily: "fdic" }),
  libRow({ id: "fdic_view", rows: 2000, kind: "projection", parentId: "fdic_panel", retrievedAt: "2026-11-25T01:00:00Z" }),
  libRow({ id: "ncua", publisherId: "ncua", agency: "National Credit Union Administration", rows: 500, dimensions: ["geo_code"] }),
  libRow({ id: "eia_a", publisherId: "eia", collectionId: "04_energy", rows: 10, dimensions: ["period"], publishedAt: "2026-11-25T12:27:00Z" }),
  libRow({ id: "eia_b", publisherId: "eia", collectionId: "04_energy", rows: 20, dimensions: [] }),
  libRow({ id: "atlas", collectionId: "14_source_atlas", hidden: true, kind: "internal", rows: 7 }),
  libRow({ id: "ccsa", publisherId: "bls", collectionId: "00_universal", agency: "U.S. Employment and Training Administration via Federal Reserve Bank of St. Louis", rows: 3000, dimensions: ["period"] }),
];
const change = (patch: Partial<SourceLibraryChange>): SourceLibraryChange => ({
  from: "2026-11-25T12:27:00Z",
  to: "2026-11-25T12:27:00Z",
  publisherId: "eia",
  publisherName: "U.S. Energy Information Administration",
  kind: "version",
  datasets: 31,
  datasetIds: [],
  single: null,
  ...patch,
});

describe("library facts", () => {
  it("counts records over original tables only, and states views and hidden tables apart", () => {
    const f = libraryFacts(lib(ROWS));
    expect(f.tables).toBe(6);
    expect(f.hidden).toBe(1);
    expect(f.views).toBe(1);
    expect(f.records).toBe(51453 + 500 + 10 + 20 + 3000);
    expect(f.viewRecords).toBe(2000);
    expect(f.publishers).toBe(4);
    expect(f.refreshed).toBe(1);
    expect(f.newest).toBe("2026-11-25T12:27:00Z");
    expect(f.collected).toEqual({ first: "2026-11-24T20:00:00Z", last: "2026-11-25T01:00:00Z" });
  });

  it("builds one card per collection in the catalogue's order, internal ones left out", () => {
    const cards = collectionCards(lib(ROWS));
    expect(cards.map((c) => c.id)).toEqual(["00_universal", "01_financials", "04_energy"]);
    const banks = cards.find((c) => c.id === "01_financials")!;
    expect(banks).toMatchObject({ tables: 3, records: 51953, views: 1, href: "/app/alt-data/library/c/financials", publishers: ["FDIC", "NCUA"], morePublishers: 0 });
    expect(banks.shapes).toEqual({ series: 0, panel: 2, places: 1, table: 0 });
    expect(cards.find((c) => c.id === "04_energy")!.shapes).toEqual({ series: 1, panel: 0, places: 0, table: 1 });
  });

  it("lists publishers by tables, with records of original tables", () => {
    const rows = publisherRows(lib(ROWS));
    expect(rows.map((r) => [r.short, r.tables, r.records])).toEqual([
      ["FDIC", 2, 51453],
      ["EIA", 2, 30],
      ["BLS", 1, 3000],
      ["NCUA", 1, 500],
    ]);
  });

  it("says when a series is a copy republished by FRED", () => {
    const names = publisherNames(lib(ROWS));
    expect(publisherLabel(ROWS[6], names)).toBe("BLS via FRED");
    expect(publisherLabel(ROWS[0], names)).toBe("FDIC");
  });
});

describe("what changed", () => {
  it("writes a group in words and a group of one with its record counts", () => {
    expect(changeText(change({}))).toBe("31 tables, new version");
    expect(changeText(change({ kind: "first", datasets: 1053 }))).toBe("1,053 tables, first published");
    const single = { datasetId: "hpi", title: "House Price Index master", rows: 187213, previousRows: 186031, snapshotId: SNAP, previousSnapshotId: "c".repeat(64) };
    expect(changeText(change({ datasets: 1, single }))).toBe("House Price Index master, new version, 186,031 to 187,213 records");
    expect(changeText(change({ datasets: 1, single: { ...single, previousRows: 187213 } }))).toBe("House Price Index master, new version, 187,213 records as before");
    expect(changeText(change({ datasets: 1, kind: "first", single: { ...single, previousRows: null } }))).toBe("House Price Index master, first published, 187,213 records");
  });

  it("writes the time of a group in UTC", () => {
    expect(changeWhen("2026-11-25T12:27:10Z", "2026-11-25T12:27:50Z")).toBe("25 Nov 12:27");
    expect(changeWhen("2026-11-25T05:30:00Z", "2026-11-25T06:36:00Z")).toBe("25 Nov 05:30 to 06:36");
    expect(changeWhen("2026-11-24T23:10:00Z", "2026-11-25T00:40:00Z")).toBe("24 Nov 23:10 to 25 Nov 00:40");
  });

  it("opens a group of one at its snapshot and a larger group as that publisher's newest tables", () => {
    const single = { datasetId: "hpi", title: "HPI", rows: 2, previousRows: 1, snapshotId: SNAP, previousSnapshotId: null };
    const [one, many] = changeLines(lib(ROWS, { changes: [change({ datasets: 1, single }), change({})] }));
    expect(one.href).toBe(`/app/alt-data/library/d/hpi?snapshot=${SNAP}`);
    expect(many.publisher).toBe("EIA");
    const url = new URL(many.href, "https://example.test");
    expect(url.pathname).toBe("/app/alt-data/library");
    expect(defaultParseSearch(url.search)).toEqual({ pub: "eia", sort: "new" });
  });
});

describe("shape bar", () => {
  it("splits the whole in fixed order and leaves zero parts out", () => {
    const parts = shapeSegments({ series: 0, panel: 3, places: 1, table: 0 });
    expect(parts.map((p) => [p.shape, p.count, p.share])).toEqual([
      ["panel", 3, 0.75],
      ["places", 1, 0.25],
    ]);
    expect(shapeSegments({ series: 0, panel: 0, places: 0, table: 0 })).toEqual([]);
    expect(shapeSummary({ series: 1, panel: 3, places: 0, table: 0 })).toBe("Tables by shape: 1 series (25%), 3 panels (75%)");
  });
});
