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
