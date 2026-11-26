// The worker's field counter (scripts/lib/field-counter.ts): exact counts that the app turns into the same counts its
// own request-time read gives (countFields), the 1,000-value cap, the list of 50, empty cells and nulls apart, and the
// memory bound over a whole snapshot.
import { describe, expect, it } from "vitest";
import { FIELD_TOP_VALUES, FIELD_VALUE_CAP, FieldCounter } from "../../scripts/lib/field-counter";
import { countFields, TOP_VALUES } from "@/components/alt/library/counts/category-model";
import { readStoredRow } from "@/components/alt/library/counts/stored-counts";

/** A small deterministic generator, so a failure names its seed. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function records(seed: number, count: number, width: number): (string | null)[][] {
  const r = random(seed);
  const pools = [
    ["A", "B", "C"],
    ["10", "20", "30", "40", "ND"],
    Array.from({ length: 40 }, (_, i) => `code ${i}`),
    Array.from({ length: 12 }, (_, i) => String(2000 + i)),
    ["Zürich", "zurich", "Zurich", "ZÜRICH"],
    Array.from({ length: 300 }, (_, i) => `v${i}`),
  ];
  return Array.from({ length: count }, () =>
    Array.from({ length: width }, (_, f) => {
      const x = r();
      if (x < 0.05) return null;
      if (x < 0.12) return "";
      const pool = pools[f % pools.length];
      // a skewed pick, so counts differ and ties are rare but present
      return pool[Math.floor(pool.length * r() * r())];
    }),
  );
}

const fed = (rows: (string | null)[][], width: number, options?: ConstructorParameters<typeof FieldCounter>[1]) => {
  const counter = new FieldCounter(width, options);
  rows.forEach((values, i) => counter.add(i + 1, values));
  return counter;
};

describe("FieldCounter", () => {
  it("gives, once read by the app, exactly the counts of the app's own read of the same records", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const width = 6;
      const rows = records(seed, 2500, width);
      const stored = fed(rows, width).rows("s");
      const positions = Array.from({ length: width }, (_, i) => i);
      const app = countFields(positions, rows.map((cells, i) => ({ row: i + 1, cells })));
      const read = stored.map((row) => readStoredRow(row, rows.length));
      for (const p of positions) {
        expect(read[p], `seed ${seed} field ${p}`).not.toBeNull();
        expect(read[p] && "exact" in read[p]! ? read[p]!.exact : null, `seed ${seed} field ${p}`).toEqual(app[p]);
      }
    }
  });

  it("keeps the 50 most common values, most first and ties in string order, with the first record of each", () => {
    const rows = Array.from({ length: 300 }, (_, i) => [`v${String(i % 120).padStart(3, "0")}`]);
    const [row] = fed(rows, 1).rows("s");
    expect(row.distinct_values).toBe(120);
    expect(row.top).toHaveLength(FIELD_TOP_VALUES);
    // v000 to v059 hold three records each, v060 to v119 two: ties go by value
    expect(row.top.slice(0, 3)).toEqual([["v000", 3, 1], ["v001", 3, 2], ["v002", 3, 3]]);
    expect(row.top.at(-1)).toEqual(["v049", 3, 50]);
    expect(row.other_rows).toBe(300 - 150);
    expect(row.other_values).toBe(70);
    // the app names ten and folds the rest into "All other values"
    const read = readStoredRow(row, 300);
    expect(read && "exact" in read && read.exact.top).toHaveLength(TOP_VALUES);
    expect(read && "exact" in read && read.exact.otherValues).toBe(110);
  });

  it("counts empty strings and nulls apart from values, and a marker as a value", () => {
    const [row] = fed([["x"], [""], [null], ["ND"], ["x"], [""], ["0"]], 1).rows("s");
    expect(row).toMatchObject({ filled: 4, blank: 2, missing: 1, distinct_values: 3, numeric_rows: 1, top: [["x", 2, 1], ["0", 1, 7], ["ND", 1, 4]] });
  });

  it("stays exact at 1,000 distinct values and marks the field past them, keeping its record counts", () => {
    const at = Array.from({ length: 2000 }, (_, i) => [String(i % FIELD_VALUE_CAP)]);
    expect(fed(at, 1).rows("s")[0]).toMatchObject({ distinct_values: 1000, capped: null, other_values: 950 });
    const past = [...at, ["one more"], [""], [null], ["7"]];
    const [row] = fed(past, 1).rows("s");
    expect(row).toEqual({
      snapshot_id: "s", position: 0, filled: 2002, blank: 1, missing: 1, numeric_rows: 2001, value_cap: 1000,
      distinct_values: null, capped: "values", top: [], other_rows: 2002, other_values: null,
    });
    expect(readStoredRow(row, past.length)).toEqual({ position: 0, capped: { position: 0, filled: 2002, blank: 1, missing: 1, cap: 1000, reason: "values" } });
  });

  it("ends a list sooner when its values would pass the characters a row keeps", () => {
    const long = (c: string) => c.repeat(400);
    const rows = Array.from({ length: 30 }, (_, i) => [long(String.fromCharCode(65 + (i % 10)))]);
    const [row] = fed(rows, 1, { topChars: 1000 }).rows("s");
    expect(row.top.map((t) => t[0].length)).toEqual([400, 400]);
    expect(row).toMatchObject({ distinct_values: 10, other_values: 8, other_rows: 24 });
  });

  it("bounds what a whole snapshot holds: the field holding the most is dropped first, and only that one", () => {
    // field 0 has many values, field 1 a few, field 2 one: a bound of 60 values drops field 0 alone
    const rows = Array.from({ length: 500 }, (_, i) => [`id${i}`, `k${i % 7}`, "same"]);
    const counter = fed(rows, 3, { heldValues: 60 });
    const out = counter.rows("s");
    expect(out.map((r) => r.capped)).toEqual(["memory", null, null]);
    expect(out[1]).toMatchObject({ distinct_values: 7, filled: 500 });
    expect(counter.held()).toEqual({ values: 8, chars: 2 * 7 + 4, capped: 1 });
    // long texts: a bound of characters drops the field holding the most characters, then holds
    const texts = Array.from({ length: 50 }, (_, i) => [`${"t".repeat(300)}${i}`, `n${i % 3}`]);
    const byChars = fed(texts, 2, { heldChars: 5000 });
    expect(byChars.rows("s").map((r) => r.capped)).toEqual(["memory", null]);
    expect(byChars.held().chars).toBeLessThanOrEqual(5000);
    // a value longer than the whole bound caps its own field
    expect(fed([["x".repeat(50)], ["y"]], 1, { heldChars: 10 }).rows("s")[0]).toMatchObject({ capped: "memory", filled: 2 });
  });

  it("gives the same rows for the same records, whatever was counted before", () => {
    const rows = records(9, 3000, 6);
    expect(fed(rows, 6, { heldValues: 200 }).rows("s")).toEqual(fed(rows, 6, { heldValues: 200 }).rows("s"));
  });

  it("counts a wide table and refuses records out of order or of another width", () => {
    const width = 2400;
    const counter = new FieldCounter(width);
    for (let r = 1; r <= 40; r++) counter.add(r, Array.from({ length: width }, (_, f) => (f % 3 === 0 ? String(r * f) : f % 3 === 1 ? "Y" : "")));
    const out = counter.rows("s");
    expect(out).toHaveLength(width);
    expect(out[1]).toMatchObject({ filled: 40, distinct_values: 1, top: [["Y", 40, 1]] });
    expect(out[2]).toMatchObject({ blank: 40, filled: 0, distinct_values: 0, top: [] });
    expect(() => counter.add(40, Array.from({ length: width }, () => "x"))).toThrow(/does not come after/);
    expect(() => counter.add(41, ["x"])).toThrow(/cells/);
    expect(() => new FieldCounter(0)).toThrow();
  });
});
