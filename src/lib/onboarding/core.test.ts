import { describe, expect, it } from "vitest";
import { seedPlan, starterCells } from "./core";

describe("starter workspace", () => {
  it("seeds NVDA, MSFT, COST for a brand-new user", () => expect(seedPlan(null, 0).tickers).toEqual(["NVDA", "MSFT", "COST"]));
  it("never seeds twice, even after the user deletes everything", () => expect(seedPlan({ seeded_at: "2026-11-17" }, 0).seed).toBe(false));
  it("leaves an existing watchlist alone", () => expect(seedPlan(null, 2).tickers).toEqual([]));
  it("starter model uses only sourced formulas", () => expect(starterCells().B4).toBe('=FU("NVDA","revenue","FY2024")'));
});
