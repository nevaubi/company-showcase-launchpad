import { describe, expect, it } from "vitest";
import { groupUpcoming, pct } from "./workflow";

describe("earnings workflow helpers", () => {
  it("formats signed percentages", () => {
    expect(pct(0.1234)).toBe("+12.3%");
    expect(pct(-0.05, 0)).toBe("-5%");
    expect(pct(null)).toBe("–");
  });
  it("groups upcoming reports by date and filters to a ticker set", () => {
    const rows = [
      { ticker: "B", name: "B", sector: "x", date: "2026-11-10", is_estimate: false, eps: 1, revenue: null, median_abs_move: null },
      { ticker: "A", name: "A", sector: "x", date: "2026-11-09", is_estimate: true, eps: null, revenue: null, median_abs_move: 0.03 },
      { ticker: "C", name: "C", sector: "x", date: "2026-11-10", is_estimate: false, eps: 2, revenue: null, median_abs_move: null },
    ];
    expect(groupUpcoming(rows).map(([d, r]) => [d, r.map((x) => x.ticker)])).toEqual([
      ["2026-11-09", ["A"]],
      ["2026-11-10", ["B", "C"]],
    ]);
    expect(groupUpcoming(rows, new Set(["C"])).map(([d]) => d)).toEqual(["2026-11-10"]);
  });
});
