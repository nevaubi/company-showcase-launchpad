import { describe, expect, it } from "vitest";
import { isAppPath, siteMapText } from "./site-map";

describe("site map", () => {
  it("lists sidebar pages and company tabs with paths, leaving admin pages out", () => {
    const map = siteMapText("nvda");
    expect(map).toContain("- Screener · /app/screener · Filter companies on fundamentals");
    expect(map).toContain("- Insiders & influence · /app/companies/NVDA/insiders");
    expect(map).not.toContain("/app/admin");
    expect(siteMapText()).toContain("/app/companies/TICKER/financials");
  });

  it("only lets the assistant open real app pages", () => {
    expect(isAppPath("/app/supply-chain?t=RTX")).toBe(true);
    expect(isAppPath("/app/companies/BRK.B/financials")).toBe(true);
    expect(isAppPath("/app/companies/NVDA")).toBe(true);
    expect(isAppPath("/app/admin")).toBe(false);
    expect(isAppPath("/app/companies/NVDA/delete")).toBe(false);
    expect(isAppPath("https://example.com")).toBe(false);
    expect(isAppPath("/app/billing/../admin")).toBe(false);
  });
});
