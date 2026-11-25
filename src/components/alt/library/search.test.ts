import { describe, expect, it } from "vitest";
import {
  collectionSearch,
  effectiveSort,
  filterTables,
  fold,
  isFiltering,
  librarySearch,
  queryWords,
  resultsCaption,
  rowShape,
  shapeOfParam,
  sortTables,
} from "./search";
import { libRow } from "./test-rows";

const names = (id: string) =>
  ({ fdic: { name: "Federal Deposit Insurance Corporation", short: "FDIC" }, eia: { name: "U.S. Energy Information Administration", short: "EIA" }, bls: { name: "U.S. Bureau of Labor Statistics", short: "BLS" } })[id];

const ROWS = [
  libRow({ id: "fdic_panel", title: "FDIC bank financial statements, all reported quarters", storedName: "fdic top500 all native quarterly", rows: 51453, publishedAt: "2026-11-25T05:31:00Z" }),
  libRow({ id: "eia_mer", title: "Primary energy overview", code: "MER 1.1", publisherId: "eia", agency: "U.S. Energy Information Administration", collectionId: "04_energy", rows: 900, publishedAt: "2026-11-25T12:27:00Z", dimensions: ["entity_id", "period"] }),
  libRow({ id: "fred_ccsa", title: "CCSA", sourceId: "FRED_CCSA", publisherId: "bls", agency: "U.S. Employment and Training Administration via Federal Reserve Bank of St. Louis", collectionId: "00_universal", rows: 3000, dimensions: ["period"], grain: "US aggregate time series" }),
  libRow({ id: "sod_states", title: "Deposits by state", rows: 52, dimensions: ["geo_code", "geo_name"] }),
  libRow({ id: "atlas_spec", title: "Collection specification", collectionId: "14_source_atlas", hidden: true, kind: "internal", dimensions: [] }),
];

describe("library search", () => {
  it("needs every word, in the title, stored name, code, publisher, source id or grain", () => {
    const ids = (q: string) => filterTables(ROWS, { q }, names).map((x) => x.row.id);
    expect(ids("fdic quarterly")).toEqual(["fdic_panel"]);
    expect(ids("mer 1.1")).toEqual(["eia_mer"]);
    expect(ids("energy information")).toEqual(["eia_mer"]);
    expect(ids("fred_ccsa")).toEqual(["fred_ccsa"]);
    expect(ids("aggregate time")).toEqual(["fred_ccsa"]);
    expect(ids("fdic zzzz")).toEqual([]);
  });

  it("folds case and accents and ignores surrounding quotes", () => {
    expect(fold("Société GÉNÉRALE")).toBe("societe generale");
    expect(queryWords('  "CCSA",  weekly ')).toEqual(["ccsa", "weekly"]);
    expect(queryWords("")).toEqual([]);
  });

  it("leaves hidden tables out unless asked", () => {
    expect(filterTables(ROWS, {}, names).map((x) => x.row.id)).not.toContain("atlas_spec");
    expect(filterTables(ROWS, { includeHidden: true }, names).map((x) => x.row.id)).toContain("atlas_spec");
  });

  it("filters by collection, publisher and shape", () => {
    expect(filterTables(ROWS, { collection: "04_energy" }, names).map((x) => x.row.id)).toEqual(["eia_mer"]);
    expect(filterTables(ROWS, { pub: "fdic" }, names).map((x) => x.row.id)).toEqual(["fdic_panel", "sod_states"]);
    expect(filterTables(ROWS, { shape: "series" }, names).map((x) => x.row.id)).toEqual(["fred_ccsa"]);
    expect(filterTables(ROWS, { shape: "places" }, names).map((x) => x.row.id)).toEqual(["sod_states"]);
  });

  it("takes the shape from the dimensions a snapshot fills", () => {
    expect(rowShape({ dimensions: ["entity_id", "period"], rows: 10 })).toBe("panel");
    expect(rowShape({ dimensions: ["geo_code", "period"], rows: 10 })).toBe("places");
    expect(rowShape({ dimensions: ["period"], rows: 10 })).toBe("series");
    expect(rowShape({ dimensions: [], rows: 10 })).toBe("table");
    expect(rowShape({ dimensions: ["period"], rows: 0 })).toBe("table");
  });

  it("ranks title matches first and keeps every order stable", () => {
    const hits = filterTables(ROWS, { q: "energy" }, names);
    expect(sortTables(hits, "match").map((r) => r.id)).toEqual(["eia_mer"]);
    const all = filterTables(ROWS, {}, names);
    expect(sortTables(all, "new").map((r) => r.id)[0]).toBe("eia_mer");
    expect(sortTables(all, "size").map((r) => r.id)).toEqual(["fdic_panel", "fred_ccsa", "eia_mer", "sod_states"]);
    expect(sortTables(all, "name").map((r) => r.id)).toEqual(["fred_ccsa", "sod_states", "fdic_panel", "eia_mer"]);
  });

  it("opens on best match only while there is a query", () => {
    expect(effectiveSort(undefined, "bank", "new")).toBe("match");
    expect(effectiveSort(undefined, "", "size")).toBe("size");
    expect(effectiveSort("match", " ", "new")).toBe("new");
    expect(effectiveSort("name", "bank", "new")).toBe("name");
  });

  it("validates its address state and drops what it does not know", () => {
    expect(librarySearch.parse({ q: "bank", shape: "panel", pub: "fdic", sort: "size", view: "changes" })).toEqual({ q: "bank", shape: "panel", pub: "fdic", sort: "size", view: "changes" });
    expect(librarySearch.parse({ shape: "pie", sort: 3, view: "all", q: "x".repeat(201) })).toEqual({});
    expect(librarySearch.parse({ shape: "places" })).toEqual({});
    expect(shapeOfParam("place")).toBe("places");
    expect(shapeOfParam("reference")).toBe("table");
    expect(shapeOfParam(undefined)).toBeUndefined();
    expect(collectionSearch.parse({ view: "changes", q: "a" })).toEqual({ q: "a" });
    expect(isFiltering({})).toBe(false);
    expect(isFiltering({ q: "  " })).toBe(false);
    expect(isFiltering({ pub: "eia" })).toBe(true);
    expect(isFiltering({ view: "changes" })).toBe(true);
    expect(isFiltering({ chg: "2026-11-25T12:27:00.000Z~version~eia" })).toBe(true);
  });

  it("says what a result list holds", () => {
    expect(resultsCaption({ count: 38, q: " mortgage " })).toBe("38 tables match “mortgage”");
    expect(resultsCaption({ count: 1, q: "ccsa" })).toBe("1 table matches “ccsa”");
    expect(resultsCaption({ count: 216, publisher: "EIA", shape: "Panels" })).toBe("216 tables from EIA · Panels");
    expect(resultsCaption({ count: 1037, changes: true })).toBe("1,037 tables · by latest publication, newest first");
    expect(resultsCaption({ count: 31, group: "EIA, new version, 25 Nov 12:27 UTC" })).toBe("31 tables · EIA, new version, 25 Nov 12:27 UTC");
  });
});
