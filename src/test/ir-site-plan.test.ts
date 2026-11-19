import { describe, expect, it } from "vitest";
import { canSpend, irSiteOrder, isCreditError } from "../../scripts/lib/ir-site-plan";
describe("scheduled IR-site collection", () => {
  it("never starts a company that could pass 300 credits in a day", () => {
    expect(canSpend(293)).toBe(true);
    expect(canSpend(294)).toBe(false);
  });
  it("puts companies that reported in the last 14 days first, newest first, unless already read since", () => {
    const order = irSiteOrder([{ ticker: "B", filed: "2026-11-10" }, { ticker: "C", filed: "2026-11-18" }, { ticker: "D", filed: "2026-11-12" }], new Map([["D", "2026-11-13T00:00:00Z"]]), ["A", "B", "C", "D", "E"], 3);
    expect(order).toEqual(["C", "B", "E", "A"]);
  });
  it("treats a 402 as a credit pause", () => {
    expect(isCreditError("Firecrawl map failed (402): Insufficient credits")).toBe(true);
    expect(isCreditError("Firecrawl scrape failed (500)")).toBe(false);
  });
});
