import { describe, expect, it } from "vitest";
import { appendStoredBars, type StoredBar } from "./append-bars";
import type { Bar } from "@/lib/financials/types";

const bundle: Bar[] = [
  ["2026-10-29", 100, 101, 99, 100, 98, 1000],
  ["2026-10-30", 100, 102, 99, 101, 98.98, 1200],
];
const row = (date: string, close: number, adj: number | null): StoredBar => ({ date, open: close, high: close, low: close, close, adj_close: adj, volume: 10 });

describe("appendStoredBars", () => {
  it("rebases stored adjusted closes onto the bundle at the shared day", () => {
    // A dividend went ex after the bundle was built: the stored series is adjusted 1% lower throughout.
    const rows = [row("2026-10-30", 101, 97.9902), row("2026-11-02", 97.273, 94.37424), row("2026-11-03", 98, 95.0796)];
    const out = appendStoredBars(bundle, rows);
    expect(out.map((b) => b[0])).toEqual(["2026-11-02", "2026-11-03"]);
    // The return across the seam is the stored series' own return, not a step.
    const seam = out[0][5] / bundle[1][5] - 1;
    expect(seam).toBeCloseTo(94.37424 / 97.9902 - 1, 10);
    expect(out[1][5] / out[0][5]).toBeCloseTo(95.0796 / 94.37424, 10);
    // Raw closes are untouched.
    expect(out[0][4]).toBe(97.273);
  });

  it("uses the stored adjusted closes as they are when the shared day is missing", () => {
    const out = appendStoredBars(bundle, [row("2026-11-02", 97, 94)]);
    expect(out).toHaveLength(1);
    expect(out[0][5]).toBe(94);
  });

  it("ignores an anchor without a usable adjusted close, and falls back to the close for a row without one", () => {
    const out = appendStoredBars(bundle, [row("2026-10-30", 101, null), row("2026-11-02", 97, null)]);
    expect(out[0][5]).toBe(97);
    expect(appendStoredBars(bundle, [row("2026-10-30", 101, 0), row("2026-11-02", 97, 94)])[0][5]).toBe(94);
  });

  it("drops rows on or before the bundle's last day and orders the rest", () => {
    const out = appendStoredBars(bundle, [row("2026-11-03", 98, 98), row("2026-10-29", 100, 98), row("2026-10-30", 101, 98.98), row("2026-11-02", 97, 97)]);
    expect(out.map((b) => b[0])).toEqual(["2026-11-02", "2026-11-03"]);
    expect(out[0][5]).toBe(97);
  });

  it("returns nothing for an empty bundle only when there are no rows", () => {
    expect(appendStoredBars([], [])).toEqual([]);
    expect(appendStoredBars([], [row("2026-11-02", 97, 96)])[0][5]).toBe(96);
  });
});
