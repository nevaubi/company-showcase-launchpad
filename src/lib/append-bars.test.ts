import { describe, expect, it } from "vitest";
import { mergeStoredBars, type StoredBar } from "./append-bars";
import type { Bar } from "@/lib/financials/types";

// The bundle adjusts closes by 0.98 (dividends up to its build date).
const bundle: Bar[] = [
  ["2026-10-29", 100, 101, 99, 100, 98, 1000],
  ["2026-10-30", 100, 102, 99, 101, 98.98, 1200],
];
const row = (date: string, close: number, adj: number | null, volume = 10): StoredBar => ({ date, open: close, high: close, low: close, close, adj_close: adj, volume });

describe("mergeStoredBars", () => {
  it("puts later rows on the bundle's adjusted basis when a dividend went ex in between", () => {
    // The stored series is adjusted by 0.97 throughout (one more dividend than the bundle knows).
    const rows = [row("2026-10-30", 101, 101 * 0.97), row("2026-11-02", 97, 97 * 0.97), row("2026-11-03", 98, 98 * 0.97)];
    const out = mergeStoredBars(bundle, rows);
    expect(out.map((b) => b[0])).toEqual(["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"]);
    // Across the seam the adjusted return is the raw return: no step.
    expect(out[2][5] / out[1][5]).toBeCloseTo(97 / 101, 10);
    expect(out[3][5] / out[2][5]).toBeCloseTo(98 / 97, 10);
    expect(out[2][5]).toBeCloseTo(97 * 0.98, 10);
    // Raw closes are untouched.
    expect(out[2][4]).toBe(97);
  });

  it("replaces a mid-session last bar of the bundle with the official bar for that day", () => {
    // The pipeline ran before the close: the bundle's last bar holds 95 and a partial volume.
    const partial: Bar[] = [bundle[0], ["2026-10-30", 100, 100, 94, 95, 95 * 0.98, 300]];
    const out = mergeStoredBars(partial, [{ date: "2026-10-30", open: 100, high: 102, low: 94, close: 101, adj_close: 101 * 0.97, volume: 1200 }, row("2026-11-02", 97, 97 * 0.97)]);
    expect(out[1]).toEqual(["2026-10-30", 100, 102, 94, 101, 101 * 0.98, 1200]);
    // The partial level does not leak into later adjusted closes.
    expect(out[2][5]).toBeCloseTo(97 * 0.98, 10);
    expect(out[2][5] / out[1][5]).toBeCloseTo(97 / 101, 10);
    // Earlier bars are the bundle's own.
    expect(out[0]).toBe(partial[0]);
  });

  it("uses the stored adjusted closes as they are when the shared day is missing", () => {
    const out = mergeStoredBars(bundle, [row("2026-11-02", 97, 94)]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(bundle[1]);
    expect(out[2][5]).toBe(94);
  });

  it("takes the close on the bundle's factor for a row without an adjusted close", () => {
    const out = mergeStoredBars(bundle, [row("2026-10-30", 101, null), row("2026-11-02", 97, null)]);
    expect(out[1][5]).toBeCloseTo(101 * 0.98, 10);
    expect(out[2][5]).toBeCloseTo(97 * 0.98, 10);
    // An unusable stored factor on the shared day leaves later stored adjusted closes as they are.
    expect(mergeStoredBars(bundle, [row("2026-10-30", 101, 0), row("2026-11-02", 97, 94)])[2][5]).toBe(94);
  });

  it("drops rows before the bundle's last day, orders the rest, and returns the same array when nothing is added", () => {
    const out = mergeStoredBars(bundle, [row("2026-11-03", 98, 98 * 0.98), row("2026-10-29", 100, 98), row("2026-11-02", 97, 97 * 0.98)]);
    expect(out.map((b) => b[0])).toEqual(["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"]);
    expect(mergeStoredBars(bundle, [])).toBe(bundle);
    expect(mergeStoredBars(bundle, [row("2026-10-29", 100, 98)])).toBe(bundle);
  });

  it("handles an empty bundle", () => {
    expect(mergeStoredBars([], [])).toEqual([]);
    expect(mergeStoredBars([], [row("2026-11-02", 97, 96)])).toEqual([["2026-11-02", 97, 97, 97, 97, 96, 10]]);
  });
});
