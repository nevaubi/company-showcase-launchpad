import { describe, expect, it } from "vitest";
import type { Note } from "./groups";
import { noteWeek } from "./notes";

const SECTORS = ["Communication Services", "Consumer Discretionary", "Consumer Staples", "Energy", "Financials", "Health Care", "Industrials", "Information Technology", "Materials", "Real Estate", "Utilities"];
const slug = (s: string) => s.toLowerCase().replace(/ /g, "-");
const N = (sector: string, week: string, p: Partial<Note> = {}): Note => ({ slug: slug(sector), sector, week, title: `${sector} ${week}`, text: "", facts: {}, generated_at: `${week}T09:00:00Z`, model: "m", ...p });

// What the pipeline stores: every Monday's notes, earlier weeks kept (etl/sectors.py notes()), in no set order.
const WEEKS = ["2026-11-02", "2026-11-16", "2026-11-09"];
const FILE = WEEKS.flatMap((w) => [...SECTORS].reverse().map((s) => N(s, w)));

describe("weekly notes: current week only", () => {
  it("shows the newest week's 11 notes, however many weeks the file keeps", () => {
    const w = noteWeek(FILE);
    expect(FILE).toHaveLength(33);
    expect(w.week).toBe("2026-11-16");
    expect(w.notes).toHaveLength(11);
    expect(new Set(w.notes.map((n) => n.week))).toEqual(new Set(["2026-11-16"]));
    expect(w.notes.map((n) => n.sector)).toEqual(SECTORS); // by sector name
  });
  it("gives a sector page its current-week note only", () => {
    const w = noteWeek(FILE, { only: "energy" });
    expect(w.notes.map((n) => n.title)).toEqual(["Energy 2026-11-16"]);
  });
  it("shows nothing for a sector that missed the current week, not an older note", () => {
    const file = FILE.filter((n) => !(n.slug === "energy" && n.week === "2026-11-16"));
    const w = noteWeek(file, { only: "energy" });
    expect(w).toEqual({ week: "2026-11-16", notes: [] });
    expect(noteWeek(file).notes).toHaveLength(10);
    expect(noteWeek(file, { only: "no-such-group" }).notes).toEqual([]);
  });
  it("keeps one note per sector, the last generated", () => {
    const dup = [N("Energy", "2026-11-16", { title: "first", generated_at: "2026-11-16T09:00:00Z" }), N("Energy", "2026-11-16", { title: "rewritten", generated_at: "2026-11-17T09:00:00Z" })];
    expect(noteWeek(dup).notes.map((n) => n.title)).toEqual(["rewritten"]);
    expect(noteWeek(null)).toEqual({ week: null, notes: [] });
  });
});

describe("notes from the verified sector release", () => {
  it("publishes each figure with its own denominator, quarter and drill-down", async () => {
    const { releaseNotes } = await import("./notes");
    const snapshot = {
      sector_release: { as_of: "2026-11-27", period: "2026Q3" },
      groups: [{ name: "Financials", sector: "Financials", slug: "financials", kind: "sector", n: 324, q: "2026Q3",
        latest: { rev_growth: ["2026Q3", .0393174, 298], ni_growth: ["2026Q3", -.018841, 318], nm: ["2026Q2", .2, 279] } }],
    } as unknown as import("./groups").Overview;
    const n = releaseNotes(snapshot)[0];
    expect(n.week).toBe("2026-11-27");
    expect(n.facts.rev_growth).toMatchObject({ text: "3.93% (298 of 324)", ref: { type: "agg", metric: "rev_growth", q: "2026Q3" } });
    expect(n.facts.ni_growth.text).toBe("-1.88% (318 of 324)");
    expect(n.facts.nm).toBeUndefined();
    expect(releaseNotes({ ...snapshot, filing_notes: { as_of: n.week, notes: [n] } })).toEqual([n]);
  });
});
