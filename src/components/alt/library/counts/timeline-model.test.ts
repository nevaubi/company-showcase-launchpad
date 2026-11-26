import { describe, expect, it } from "vitest";
import type { SourceLibrary, SourceLibraryRow } from "@/lib/sources/read-types";
import type { TablePeriod } from "./wire";
import { latestYearsCaption, publishersByTables, recordsByCollection, tablesByLatestYear } from "./store-model";
import { collectionTimeline, tableRange, timelineCaption, yearTicks } from "./timeline-model";

function row(id: string, over: Partial<SourceLibraryRow> = {}): SourceLibraryRow {
  return {
    id, title: `Table ${id}`, code: null, storedName: null, publisherId: "eia", collectionId: "04_energy", kind: "native", parentId: null,
    sector: "04_energy", agency: "US EIA", sourceId: null, grain: "", rows: 100, fields: 5, publishedAt: null, retrievedAt: null,
    dimensions: ["period"], replaced: false, refreshFamily: null, hidden: false, ...over,
  };
}
const p = (id: string, first: string | null, last: string | null, periods: number | null = 2, note = false): [string, TablePeriod & { note: boolean }] => [id, { id, first, last, periods, note }];
const names = (id: string) => ({ eia: { name: "US Energy Information Administration", short: "EIA" }, msha: { name: "Mine Safety and Health Administration", short: "MSHA" } } as Record<string, { name: string; short: string }>)[id];

describe("tableRange", () => {
  it("places a range only when both ends parse in one format", () => {
    expect(tableRange(p("a", "1960-01", "2024-12")[1], true)).toEqual({ ok: true, start: "1960-01-01", end: "2024-12-31", firstLabel: "Jan 1960", lastLabel: "Dec 2024" });
    expect(tableRange(p("b", "1945:Q4", "2026:Q2")[1], true)).toMatchObject({ ok: true, start: "1945-10-01", end: "2026-06-30" });
    expect(tableRange(p("c", "2024", "Note- totals")[1], true)).toEqual({ ok: false, reason: "not-dates" });
    expect(tableRange(p("d", null, null, null, true)[1], true)).toEqual({ ok: false, reason: "not-dates" });
    expect(tableRange(undefined, true)).toEqual({ ok: false, reason: "not-counted" });
    expect(tableRange(p("e", null, null, null)[1], true)).toEqual({ ok: false, reason: "not-counted" });
    expect(tableRange(p("f", "2020", "2021")[1], false)).toEqual({ ok: false, reason: "no-period" });
  });
});

describe("collectionTimeline", () => {
  const rows = [
    row("a", { title: "Coal by state", publisherId: "msha" }),
    row("b", { title: "Monthly energy review" }),
    row("c", { title: "Plants 2025", dimensions: [] }),
    row("d", { title: "Notes" }),
    row("e", { title: "Generation 2020", rows: 15115 }),
  ];
  const periods = new Map([p("a", "2000", "2026", 27), p("b", "1973-01", "2026-08", 644), p("d", null, null, -1, true), p("e", "2020", "2020", 1)]);

  it("sorts by the last period, newest first, colours by publisher in slot order, and counts what it cannot place", () => {
    const t = collectionTimeline(rows, periods, names);
    expect(t.rows.map((r) => r.id)).toEqual(["a", "b", "e"]);
    expect(t.rows[0]).toMatchObject({ publisher: "MSHA", slot: 1, firstLabel: "2000", lastLabel: "2026" });
    expect(t.rows[1].slot).toBe(0);
    expect(t.rows[2].tip).toBe("Generation 2020 (EIA): 2020, 1 period, 15,115 records");
    expect(t.publishers).toEqual([{ id: "eia", short: "EIA", slot: 0, tables: 2 }, { id: "msha", short: "MSHA", slot: 1, tables: 1 }]);
    expect([t.fromYear, t.toYear]).toEqual([1973, 2026]);
    expect(timelineCaption(t)).toBe("3 of 5 tables placed by their periods, from 1973 to 2026; newest last period first. 1 has no period, 1 has periods that are not dates.");
  });

  it("gives a sixth publisher and beyond the quiet grey, as one legend entry", () => {
    const many = Array.from({ length: 7 }, (_, i) => row(`t${i}`, { publisherId: `p${i}` }));
    const t = collectionTimeline(many, new Map(many.map((r) => p(r.id, "2001", "2002"))), () => undefined);
    expect(t.publishers.map((x) => x.slot)).toEqual([0, 1, 2, 3, 4, null]);
    expect(t.publishers[5]).toEqual({ id: "other", short: "2 other publishers", slot: null, tables: 2 });
    expect(t.rows.filter((r) => r.slot === null)).toHaveLength(2);
  });

  it("names the axis's years on clean steps and always the last", () => {
    expect(yearTicks(1973, 2026, 6)).toEqual([1980, 1990, 2000, 2010, 2026]);
    expect(yearTicks(2017, 2026, 12)).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(yearTicks(2025, 2026, 4)).toEqual([2025, 2026]);
  });
});

describe("what the library holds", () => {
  const lib = {
    totals: {} as SourceLibrary["totals"],
    collections: [],
    publishers: [],
    changes: [],
    changesSince: null,
    via: "direct",
    builtAt: "",
    datasets: [
      row("a", { collectionId: "04_energy", rows: 1000, publisherId: "eia" }),
      row("b", { collectionId: "04_energy", rows: 500, publisherId: "msha" }),
      row("c", { collectionId: "04_energy", rows: 500, kind: "projection", parentId: "a", publisherId: "eia" }),
      row("d", { collectionId: "07_materials", rows: 7000, publisherId: "msha" }),
      row("h", { collectionId: "07_materials", rows: 9, hidden: true }),
    ],
  } as unknown as SourceLibrary;

  it("adds records by collection without the views, and ranks publishers by tables", () => {
    const bars = recordsByCollection(lib, names);
    const energy = bars.find((b) => b.key === "04_energy")!;
    expect(energy).toMatchObject({ value: 1500, sub: "3 tables" });
    expect(energy.title).toMatch(/500 more in 1 views repeat them and are not added/);
    expect(bars[0].key).toBe("07_materials");
    const pubs = publishersByTables(lib, names);
    // a tie in tables goes to the publisher with more records (views not added)
    expect(pubs.map((b) => [b.key, b.value])).toEqual([["msha", 2], ["eia", 2]]);
  });

  it("counts tables by the year of their latest period, with one quiet column for earlier years", () => {
    const rows = [row("a"), row("b"), row("c"), row("d"), row("e", { dimensions: [] }), row("f"), row("g")];
    const periods = new Map([p("a", "2000", "2026"), p("b", "2001-01", "2025-06"), p("c", "1950", "1990"), p("d", "20200101", "20450930"), p("f", null, null, -1, true), p("g", "2026:Q1", "2026:Q2")]);
    const t = tablesByLatestYear(rows, periods, 2026, 15);
    expect(t.columns[0]).toMatchObject({ key: "earlier", label: "Before 2012", value: 1, quiet: true });
    expect(t.columns.map((c) => c.label).slice(-2)).toEqual(["2025", "2026"]);
    expect(t.columns.find((c) => c.key === "2026")).toMatchObject({ value: 2, tables: ["Table a", "Table g"] });
    expect(t).toMatchObject({ dated: 5, later: 1, noPeriod: 1, notDates: 1, notCounted: 0 });
    expect(latestYearsCaption(t)).toBe("Of 7 tables, 5 have periods that are dates; 2 end in 2026, 1 after it. 1 has no period, 1 has periods that are not dates.");
  });
});
