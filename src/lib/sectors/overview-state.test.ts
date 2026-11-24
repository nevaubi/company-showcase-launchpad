import { describe, expect, it } from "vitest";
import { overviewState, rememberOverview } from "./overview-state";

describe("overview state for the breadcrumb", () => {
  it("keeps the board's level, columns and sort as last seen", () => {
    rememberOverview({ level: "industry", sort: "r21", dir: "asc", cols: "risk" });
    expect(overviewState()).toEqual({ level: "industry", sort: "r21", dir: "asc", cols: "risk" });
  });
  it("forgets keys the overview no longer shows and ignores unknown or empty ones", () => {
    rememberOverview({ level: "industry", sort: "r21" });
    rememberOverview({ span: "1Y", sector: "Energy", q: "x", sort: "" });
    expect(overviewState()).toEqual({ span: "1Y" });
  });
  it("hands out a copy", () => {
    rememberOverview({ tail: "10w" });
    const s = overviewState();
    s.tail = "4w";
    expect(overviewState().tail).toBe("10w");
  });
});
