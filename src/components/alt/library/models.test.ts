import { describe, expect, it } from "vitest";
import type { SourceColumn, SourceIngest } from "@/lib/sources/schema";
import { fieldRoles, formatCell } from "@/lib/sources/fields";
import { profileStatus } from "@/lib/sources/profiles";
import { columnHead, columnWidth, fieldGroups, openingFields, pickerRows, toggle } from "./columns-model";
import { fillBands, periodBars, yearBars } from "./coverage-model";
import {
  bytesText,
  canOrderNewest,
  count,
  effectiveOrder,
  profileFields,
  rangeFormat,
  recordDims,
  refreshState,
  rowChange,
  versionPosition,
} from "./dataset-model";
import { checkWords, noteLines, rest, scopeWords, sourceWords } from "./provenance-words";

const col = (label: string, extra: Partial<SourceColumn> = {}): SourceColumn => ({ key: `col${label}`, label, type: "string", ...extra });

describe("which fields the records table opens with", () => {
  const ingest = { dimensions: { entity_id: 0, period: 1, entity_name: 3 } } as unknown as SourceIngest;
  it("shows every field of a narrow table, its declared dimensions first", () => {
    const columns = ["CERT", "REPDTE", "ASSET", "NAME", "DEP"].map((l) => col(l));
    expect(openingFields(columns, ingest, [])).toEqual([3, 0, 1, 2, 4]);
  });
  it("puts a profile's measures after the dimensions in a wide table, and refuses a label carried twice", () => {
    const columns = Array.from({ length: 40 }, (_, i) => col(`F${i}`));
    columns[0] = col("CERT");
    columns[1] = col("REPDTE");
    columns[3] = col("NAME");
    columns[30] = col("ASSET");
    columns[31] = col("DEP");
    columns[32] = col("DEP");
    const out = openingFields(columns, ingest, ["ASSET", "DEP"]);
    expect(out.slice(0, 4)).toEqual([3, 0, 1, 30]);
    expect(out).not.toContain(31);
    expect(out).toHaveLength(8);
  });
});

describe("the column picker", () => {
  const columns = [
    col("CERT", { unit: "FDIC certificate identifier" }),
    col("ASSET", { unit: "USD thousands", native_type: "number", title: "Total assets" }),
    col("DEP", { unit: "USD thousands", native_type: "number", title: "Total deposits" }),
    col("ROA", { unit: "Percent", native_type: "number" }),
    col("NOTE"),
  ];
  const ingest = { dimensions: { entity_id: 0 } } as unknown as SourceIngest;
  it("groups the shown fields first, then index fields, then by stated unit, largest first", () => {
    const groups = fieldGroups(columns, ingest, [3], "");
    expect(groups.map((g) => [g.label, g.items.map((i) => i.position)])).toEqual([
      ["In the table", [3]],
      ["Index fields", [0]],
      ["USD thousands", [1, 2]],
      ["No stated unit", [4]],
    ]);
    expect(pickerRows(groups)).toHaveLength(4 + 5);
  });
  it("finds a field by every word of the search, in code, title or unit", () => {
    expect(fieldGroups(columns, ingest, [], "total dep").flatMap((g) => g.items.map((i) => i.position))).toEqual([2]);
  });
  it("keeps earlier choices in order and stops at the maximum", () => {
    expect(toggle([1, 2], 2, 24)).toEqual([1]);
    expect(toggle([1, 2], 5, 2)).toEqual([1, 2]);
    expect(toggle([1], 5, 24)).toEqual([1, 5]);
  });
  it("heads a reviewed measure with its profile's unit, else the dictionary's", () => {
    expect(columnHead(col("PAYEMS"))).toEqual({ title: "PAYEMS", sub: null, code: "PAYEMS" });
    expect(columnHead(col("PAYEMS"), "Thousands of Persons")).toEqual({ title: "PAYEMS", sub: "Thousands of Persons", code: "PAYEMS" });
    expect(columnHead(col("ASSET", { unit: "USD thousands" }))).toMatchObject({ sub: "USD thousands" });
    expect(columnWidth(col("X"), true, false, 0, "Millions of 1982-84 CPI Adjusted Dollars")).toBeGreaterThan(columnWidth(col("X"), true));
  });
  it("shows a profiled FRED value grouped, with the unit FRED states in the head", () => {
    // the dictionary of a FRED series file as production stores it: no unit, no native type
    const columns: SourceColumn[] = [
      { key: "col0001", label: "observation_date", type: "string" },
      { key: "col0002", label: "AMTMNO", type: "string" },
    ];
    const status = profileStatus({ id: "official_06_industrials_raw_fred_amtmno_17ff88a923", source_id: "FRED_AMTMNO" }, columns);
    expect(status.state).toBe("on");
    const reviewed = profileFields(status.state === "on" ? status.profile : null, columns);
    const roles = fieldRoles(columns, { dimensions: { period: 0 } } as unknown as SourceIngest, reviewed.hints);
    expect(roles).toEqual(["date", "quantity"]);
    expect(formatCell("677247", roles[1], columns[1])).toEqual({ text: "677,247", align: "right", title: "677247" });
    expect(columnHead(columns[1], reviewed.units.get(1)).sub).toBe("Millions of Dollars");
    // without a profile the same cell stays as stored and the head names no unit
    const plain = fieldRoles(columns, { dimensions: { period: 0 } } as unknown as SourceIngest);
    expect(formatCell("677247", plain[1], columns[1]).text).toBe("677247");
    expect(columnHead(columns[1]).sub).toBeNull();
  });
  it("gives a column of names room whatever its head says", () => {
    expect(columnWidth(col("NAME"), false, true)).toBeGreaterThanOrEqual(232);
    expect(columnWidth(col("X"), true)).toBe(112);
    expect(columnWidth(col("X"), false, false, 13)).toBeGreaterThan(columnWidth(col("X"), false));
  });
});

describe("facts of a snapshot", () => {
  it("knows which dimensions a snapshot fills, constants and composites included", () => {
    expect(recordDims({ dimensions: { entity_id: 2, entity_name: 3 }, constants: { period: "11510" } } as unknown as SourceIngest)).toEqual({
      entityId: true,
      entityName: true,
      geoCode: false,
      geoName: false,
      period: true,
    });
  });
  it("orders records newest first only for a period that sorts as a date, and keeps old cursors in file order", () => {
    expect(rangeFormat({ first: "20000331", last: "20260630" })).toBe("yyyymmdd");
    expect(canOrderNewest(true, "yyyymmdd")).toBe(true);
    expect(canOrderNewest(true, "text")).toBe(false);
    expect(effectiveOrder({}, true)).toBe("new");
    // an old Source explorer link carries a file-order cursor and no order
    expect(effectiveOrder({ after: 50 }, true)).toBe("file");
    expect(effectiveOrder({ after: 50, order: "new" }, true)).toBe("new");
    expect(effectiveOrder({ q: "bank", order: "new" }, true)).toBe("file");
  });
  it("claims a refresh only from the snapshot's own evidence", () => {
    expect(refreshState({ refresh_provenance: { family: "fred" } }, "24 Nov 2026")).toEqual({ kind: "checked", words: "Checked daily" });
    expect(refreshState({}, "24 Nov 2026")).toEqual({ kind: "static", words: "Static copy of 24 Nov 2026" });
  });
  it("numbers versions oldest first and states changes with a true minus", () => {
    const versions = [
      { id: "b", publishedAt: "2026-11-25T07:01:53Z" },
      { id: "a", publishedAt: "2026-11-25T05:32:09Z" },
    ];
    expect(versionPosition(versions, "b")).toEqual({ n: 2, of: 2 });
    expect(rowChange(187213, 186031)).toBe("+1,182");
    expect(rowChange(10, 12)).toBe("−2");
    expect(rowChange(5, null)).toBe("first");
    expect(count(-1500)).toBe("−1,500");
    expect(bytesText(825908065)).toBe("826 MB");
    expect(bytesText(26686)).toBe("26.7 kB");
  });
});

describe("first look without parsing", () => {
  it("puts every field in exactly one band of filled share", () => {
    const fills = [1, 0.95, 0.5, 0.2, 0].map((share, position) => ({ position, key: "", label: "", filled: 0, blank: 0, share }));
    expect(fillBands(fills).map((b) => b.fields)).toEqual([1, 1, 1, 1, 1]);
  });
  it("counts records per period oldest first, by year when asked, with a floor said as one", () => {
    const values = [
      { value: "20260630", label: null, rows: 500, exact: true },
      { value: "20260331", label: null, rows: 500, exact: false },
      { value: "20251231", label: null, rows: 499, exact: true },
    ];
    expect(periodBars(values, "yyyymmdd").map((b) => [b.key, b.text])).toEqual([
      ["20251231", "499"],
      ["20260331", "500 or more"],
      ["20260630", "500"],
    ]);
    expect(yearBars(values, "yyyymmdd")?.map((b) => [b.key, b.value, b.text])).toEqual([
      ["2025", 499, "499"],
      ["2026", 1000, "1,000 or more"],
    ]);
  });
});

describe("provenance in words", () => {
  it("says how the file was obtained and lists unknown keys as stored", () => {
    const { said, used } = sourceWords({ direct_url: "https://x/y.csv", direct_download_sha256_verified: true, http_status: 200, custom_thing: 3 }, "https://x");
    expect(said.map((s) => s.label)).toEqual(["Publisher address", "File address", "Download", "HTTP status"]);
    expect(rest({ direct_url: "a", custom_thing: 3 }, used)).toEqual([{ key: "custom_thing", value: "3" }]);
  });
  it("names markers with their counts and never as numbers", () => {
    const { said } = checkWords({ row_width_verified: true, source_lexical_marker_counts: { NM: 21709, "": 0 } });
    expect(said.find((s) => s.label === "Markers")?.text).toContain('"NM" appears 21,709 times');
  });
  it("turns scope declarations into sentences", () => {
    const { said } = scopeWords({ population_role: "projection_or_subset", overlaps_files: ["MER_ALL.csv"], publication_time_known: false });
    expect(said.map((s) => s.label)).toEqual(["Population", "Overlaps", "Time"]);
    expect(noteLines("a\n\nb \n")).toEqual(["a", "b"]);
  });
});
