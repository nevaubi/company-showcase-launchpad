import { describe, expect, it } from "vitest";
import { toneOf } from "./map";

describe("financial map tones", () => {
  it("rising revenue on both views is better", () => {
    expect(toneOf(4, 9, false)).toBe("better");
  });
  it("rising costs are worse", () => {
    expect(toneOf(4, 9, true)).toBe("worse");
  });
  it("down on the quarter but up on the year is mixed", () => {
    expect(toneOf(-5.1, 3.2, false)).toBe("mixed");
  });
  it("moves under 2% are flat", () => {
    expect(toneOf(1.5, -1.9, false)).toBe("flat");
  });
  it("percent lines are judged in points", () => {
    expect(toneOf(null, -0.7, false, "pct")).toBe("worse");
    expect(toneOf(null, 0.1, false, "pct")).toBe("flat");
  });
});

describe("financial map zones", () => {
  it("puts a bank's revenue KPI table in Revenue and loans in Balances", async () => {
    const { zoneOf } = await import("./map");
    expect(zoneOf({ cat: "kpi", met: "revenue" })).toBe("revenue");
    expect(zoneOf({ cat: "kpi", met: "loans" })).toBe("balance");
    expect(zoneOf({ cat: "kpi", met: "expense" })).toBe("cost");
  });
});
