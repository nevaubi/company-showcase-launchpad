import { describe, expect, it } from "vitest";
import { basisLine, cappedLine, readStoredRow, storedCounts, storedPositions } from "./stored-counts";

/** A stored row as PostgREST returns it: a field of 100 records, 3 values. */
const row = (position: number, over: Record<string, unknown> = {}) => ({
  position, filled: 90, blank: 6, missing: 4, numeric_rows: 0, value_cap: 1000, distinct_values: 3, capped: null,
  top: [["Moody's", 50, 2], ["S&P", 30, 1], ["Fitch", 10, 7]], other_rows: 0, other_values: 0, computed_at: "2026-11-26T08:00:00+00:00", ...over,
});
const capped = (position: number) => row(position, { distinct_values: null, capped: "values", top: [], other_rows: 90, other_values: null, numeric_rows: 90 });

describe("readStoredRow", () => {
  it("turns a stored row into the counts the charts take", () => {
    expect(readStoredRow(row(4), 100)).toEqual({
      position: 4,
      exact: {
        position: 4, filled: 90, blank: 6, missing: 4, distinct: 3, otherRows: 0, otherValues: 0, numeric: false,
        top: [{ value: "Moody's", rows: 50, row: 2 }, { value: "S&P", rows: 30, row: 1 }, { value: "Fitch", rows: 10, row: 7 }],
      },
    });
    expect(readStoredRow(capped(2), 100)).toEqual({ position: 2, capped: { position: 2, filled: 90, blank: 6, missing: 4, cap: 1000, reason: "values" } });
  });

  it("folds a stored list past ten values into the remainder, and reads numbers as the app does", () => {
    const top = Array.from({ length: 50 }, (_, i) => [String(i).padStart(2, "0"), 2, i + 1]);
    const r = readStoredRow(row(0, { filled: 110, blank: 0, missing: 0, distinct_values: 60, top, other_rows: 10, other_values: 10, numeric_rows: 99 }), 110);
    expect(r && "exact" in r && r.exact).toMatchObject({ otherRows: 90, otherValues: 50, numeric: true, distinct: 60 });
    expect(r && "exact" in r && r.exact.top).toHaveLength(10);
  });

  it("refuses a row that does not add up or is not what the worker writes", () => {
    const bad: [string, Record<string, unknown>][] = [
      ["records", { blank: 7 }],
      ["list rows", { other_rows: 1 }],
      ["list values", { other_values: 1 }],
      ["order", { top: [["S&P", 30, 1], ["Moody's", 50, 2], ["Fitch", 10, 7]] }],
      ["empty value", { top: [["", 50, 2], ["S&P", 30, 1], ["Fitch", 10, 7]] }],
      ["first record past the end", { top: [["Moody's", 50, 101], ["S&P", 30, 1], ["Fitch", 10, 7]] }],
      ["fraction", { filled: 90.5 }],
      ["text", { filled: "90" }],
      ["numbers", { numeric_rows: 91 }],
      ["cap", { value_cap: 2 }],
      ["reason", { capped: "length" }],
      ["capped with a list", { capped: "values", distinct_values: null, other_values: null }],
    ];
    for (const [why, over] of bad) expect(readStoredRow(row(1, over), 100), why).toBeNull();
    expect(readStoredRow(null, 100)).toBeNull();
  });
});

describe("storedCounts", () => {
  const width = 6;
  it("answers the fields asked for, in their order, when the last field's row is there", () => {
    const got = storedCounts([row(1), capped(2), row(5, { computed_at: "2026-11-26T09:00:00+00:00" })], [2, 1], width, 100);
    expect(got?.fields.map((f) => f.position)).toEqual([1]);
    expect(got?.capped.map((f) => f.position)).toEqual([2]);
    expect(got?.computedAt).toBe("2026-11-26T09:00:00+00:00");
  });

  it("is no answer when the counts are not complete or a row is wrong", () => {
    expect(storedCounts([row(1), capped(2)], [1, 2], width, 100)).toBeNull();
    expect(storedCounts([row(1), row(5)], [1, 2], width, 100)).toBeNull();
    expect(storedCounts([row(1), row(1), row(5)], [1], width, 100)).toBeNull();
    expect(storedCounts([row(1), row(5, { blank: 9 })], [1], width, 100)).toBeNull();
    expect(storedCounts([row(1), row(6), row(5)], [1], width, 100)).toBeNull();
    expect(storedCounts([], [1], width, 100)).toBeNull();
  });

  it("asks for the fields wanted and the last field, once each", () => {
    expect(storedPositions([3, 1], 6)).toEqual([1, 3, 5]);
    expect(storedPositions([5, 0], 6)).toEqual([0, 5]);
  });
});

describe("lines", () => {
  it("says where the counts come from", () => {
    expect(basisLine({ from: "stored", records: 16680, computedAt: null })).toBe("Counted over all 16,680 records of this version as published.");
    expect(basisLine({ from: "records", records: 2462 })).toBe("Counted over all 2,462 records of this version.");
  });

  it("names the fields not counted value by value", () => {
    const c = (position: number, reason: "values" | "memory") => ({ position, filled: 1, blank: 0, missing: 0, cap: 1000, reason });
    expect(cappedLine([], 12)).toBeNull();
    expect(cappedLine([c(1, "values")], 12)).toBe("One of the 12 fields counted holds more than 1,000 values, so it is not drawn by category.");
    expect(cappedLine([c(1, "values"), c(2, "values"), c(3, "memory")], 12)).toBe(
      "2 of the 12 fields counted hold more than 1,000 values, so they are not drawn by category. One field was not counted value by value: its values were too many or too long to hold.",
    );
  });
});
