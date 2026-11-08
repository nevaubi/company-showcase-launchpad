import { describe, expect, it } from "vitest";
import { describeCron, scopeLabel } from "./client";

describe("describeCron", () => {
  it("reads the template schedules in plain English", () => {
    expect(describeCron("45 6 * * 1-5", "America/Chicago")).toBe("Weekdays at 6:45 am (Chicago)");
    expect(describeCron("0 7 * * 1")).toBe("Mondays at 7:00 am");
    expect(describeCron("0 18 * * *")).toBe("Daily at 6:00 pm");
    expect(describeCron("0 7 1 * *")).toBe("Monthly on day 1 at 7:00 am");
    expect(describeCron("15 * * * *")).toBe("Hourly at :15");
  });
  it("falls back to the expression for shapes it does not name", () => {
    expect(describeCron("*/10 9-16 * * 1-5")).toBe("*/10 9-16 * * 1-5");
    expect(describeCron("bad")).toBe("bad");
  });
});

describe("scopeLabel", () => {
  it("names each scope", () => {
    expect(scopeLabel({ kind: "tickers", tickers: ["NVDA", "AMD"] })).toBe("NVDA, AMD");
    expect(scopeLabel({ kind: "universe" })).toBe("All covered companies");
    expect(scopeLabel({ kind: "sector", sector: "Energy" })).toBe("Energy");
  });
});
