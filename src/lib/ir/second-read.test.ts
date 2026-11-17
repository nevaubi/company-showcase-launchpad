import { describe, expect, it } from "vitest";
import { cellKey, crossCheckBy } from "./second-read";

const cell = (r: number, period_end: string, months = 3, value = 100) => ({ locator: { t: 0, r, c: 1, text: "100" }, period_end, months, value });

describe("table/page second reader cross-check", () => {
  it("keeps a figure both readers date the same (within a week)", () => {
    const r = crossCheckBy([cell(1, "2025-12-31")], [cell(1, "2025-12-27")], cellKey);
    expect(r.rows).toHaveLength(1);
    expect(r.agreed).toBe(1);
  });
  it("drops a figure the readers date a year apart", () => {
    const r = crossCheckBy([cell(1, "2025-12-31")], [cell(1, "2024-12-31")], cellKey);
    expect(r.rows).toHaveLength(0);
    expect(r.conflicts).toBe(1);
  });
  it("drops a quarter the second reader calls year-to-date", () => {
    expect(crossCheckBy([cell(1, "2025-06-30", 3)], [cell(1, "2025-06-30", 6)], cellKey).rows).toHaveLength(0);
  });
  it("keeps primary solo finds and never stores the second reader's solo finds", () => {
    const r = crossCheckBy([cell(1, "2025-12-31")], [cell(2, "2025-12-31")], cellKey);
    expect(r.rows.map((x) => x.locator.r)).toEqual([1]);
    expect(r.secondOnly).toBe(1);
  });
});
