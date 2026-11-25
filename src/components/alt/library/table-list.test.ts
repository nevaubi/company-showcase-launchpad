import { describe, expect, it } from "vitest";
import { indexedBy, orderWithViews, utcDay, utcDayRange, utcMinute } from "./table-list";
import { libRow } from "./test-rows";

const parent = libRow({ id: "hpi_master", title: "House Price Index master", retrievedAt: "2026-11-25T07:01:00Z" });
const view = libRow({ id: "hpi_states", title: "House prices by state", kind: "projection", parentId: "hpi_master", retrievedAt: "2026-11-24T20:00:00Z" });
const other = libRow({ id: "sod", title: "Summary of Deposits" });
const all = new Map([parent, view, other].map((r) => [r.id, r]));

describe("table list order", () => {
  it("lists a view directly under its parent when both are listed", () => {
    const items = orderWithViews([view, other, parent], all);
    expect(items.map((i) => [i.row.id, i.depth])).toEqual([
      ["sod", 0],
      ["hpi_master", 0],
      ["hpi_states", 1],
    ]);
    expect(items[2].parent).toEqual({ id: "hpi_master", title: "House Price Index master" });
  });

  it("keeps a view in place, still marked, when its parent is filtered out", () => {
    const items = orderWithViews([view, other], all);
    expect(items.map((i) => [i.row.id, i.depth])).toEqual([
      ["hpi_states", 0],
      ["sod", 0],
    ]);
    expect(items[0].parent?.title).toBe("House Price Index master");
  });

  it("flags a view collected before its parent, and names an unknown parent by id", () => {
    expect(orderWithViews([parent, view], all)[1].olderThanParent).toBe(true);
    const orphan = libRow({ id: "x", kind: "derived", parentId: "gone" });
    expect(orderWithViews([orphan], all)[0].parent).toEqual({ id: "gone", title: "gone" });
    expect(orderWithViews([other], all)[0].parent).toBeNull();
  });

  it("never lists a row twice", () => {
    const self = libRow({ id: "self", parentId: "self", kind: "projection" });
    const items = orderWithViews([self, parent, view, view], new Map([...all, ["self", self]]));
    expect(items.map((i) => i.row.id)).toEqual(["self", "hpi_master", "hpi_states"]);
  });
});

describe("table list words", () => {
  it("names what a table is indexed by", () => {
    expect(indexedBy(["entity_id", "entity_name", "period"])).toBe("Entity and period");
    expect(indexedBy(["entity_id", "geo_code", "period", "source_url"])).toBe("Entity, place and period");
    expect(indexedBy(["geo_name"])).toBe("Place");
    expect(indexedBy(["source_url"])).toBe("");
  });

  it("writes UTC dates the way the app does", () => {
    expect(utcDay("2026-11-24T23:59:00Z")).toBe("24 Nov 2026");
    expect(utcMinute("2026-11-25T12:27:41Z")).toBe("25 Nov 2026, 12:27 UTC");
    expect(utcDay(null)).toBe("–");
    expect(utcDay("not a date")).toBe("–");
    expect(utcDayRange("2026-11-24T20:00:00Z", "2026-11-25T07:00:00Z")).toBe("24 to 25 Nov 2026");
    expect(utcDayRange("2026-10-30T20:00:00Z", "2026-11-02T07:00:00Z")).toBe("30 Oct to 2 Nov 2026");
    expect(utcDayRange("2025-12-31T20:00:00Z", "2026-01-02T07:00:00Z")).toBe("31 Dec 2025 to 2 Jan 2026");
    expect(utcDayRange("2026-11-25T01:00:00Z", "2026-11-25T07:00:00Z")).toBe("25 Nov 2026");
    expect(utcDayRange(null, "2026-11-25T07:00:00Z")).toBe("25 Nov 2026");
  });
});
