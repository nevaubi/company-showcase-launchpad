import { describe, expect, it } from "vitest";
import { HUB_GROUPS, SIDEBAR_HUBS } from "@/lib/nav";
import { isAppPath, siteMapText } from "./site-map";

describe("site map", () => {
  it("lists sidebar pages and company tabs with paths, leaving admin pages out", () => {
    const map = siteMapText("nvda");
    expect(map).toContain("- Screener · /app/screener · Screen companies in words or with filters (sections Screen builder, Screen results)");
    expect(map).toContain("- Insiders & influence · /app/companies/NVDA/insiders");
    expect(map).not.toContain("/app/admin");
    expect(siteMapText()).toContain("/app/companies/TICKER/financials");
  });

  it("names the rebuilt pages' sections, controls and address params as the code has them", () => {
    const map = siteMapText("AAPL");
    // Company tabs
    expect(map).toContain("Statement currency (one line saying how current the statements are");
    expect(map).toContain("Extended from the latest filing");
    expect(map).toContain("basis=normalized|reported|template|adjusted|detail");
    expect(map).toContain("IR checks line");
    expect(map).toContain("Failed checks");
    expect(map).toContain("a figure with no mark is not guaranteed");
    expect(map).toContain("Promise tracker (grouped as Promises still open");
    expect(map).toContain("Transcript controls (Full call, Prepared remarks, Q&A; Show one speaker select");
    expect(map).toContain("kind=key|all|periodic|current|ownership|proxy|offerings|correspondence|other|ir");
    expect(map).toContain("Verdict first: share of the filing changed");
    expect(map).toContain("tab groups Overview, Financials, Valuation, IR data, Earnings, Filings, Ownership");
    // Hub pages
    expect(map).toContain("sections Feed controls, Filing day, Largest disclosure changes, Verified filing insights");
    expect(map).toContain("sections KPI matrix controls, KPI matrix");
    expect(map).toContain("sections Compare picker, Comparison table, Compare charts, Annual revenue");
    expect(map).toContain("sections Company filters, Company list");
    // Removed sections and controls are gone
    expect(map).not.toMatch(/Latest quarter recap|Next earnings preview|Speakers panel|Columns segmented|Pairs panel|Strategies passing/);
  });

  it("never describes setups, signals or ideas as proven, working or predictive", () => {
    const map = siteMapText();
    const setups = map.split("\n").find((l) => l.includes("· /app/setups"))!;
    expect(setups).toContain("judged against luck");
    expect(setups).toContain("Closest, a watch list of up to 20 signals");
    expect(setups).toContain("not a recommendation and not evidence");
    expect(setups).not.toMatch(/out-of-sample trades|predict|works|tested and working/i);
    const ideas = map.split("\n").find((l) => l.includes("· /app/ideas"))!;
    expect(ideas).toContain("against a coin flip, not as a forecast");
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

  it("lists every non-admin page in the navigation and no admin page", () => {
    const map = siteMapText();
    for (const g of HUB_GROUPS)
      for (const h of g.hubs)
        for (const p of h.pages) {
          const line = `- ${p.label} · ${p.to}`;
          if (g.admin) expect(map).not.toContain(line);
          else expect(map).toContain(line);
        }
  });

  it("says which entries are in the sidebar and which open from the account menu", () => {
    const map = siteMapText();
    for (const h of SIDEBAR_HUBS)
      expect(map).toContain(`Sidebar: ${h.label} · point with [data-tour='hub-${h.id}']`);
    expect(map).toContain(
      "Account menu (avatar at the bottom of the sidebar) · point with [data-tour='account']",
    );
    expect(map).not.toContain("Sidebar: Account");
    expect(map).toContain("open from the account menu, the avatar at the bottom of the sidebar");
    expect(map).toContain("Admin pages (admins only) are also in that menu");
    expect(map).toContain(
      "The theme switch (Light, Dark, System) is in the account menu and on the Settings page under Appearance.",
    );
    const lines = map.split("\n");
    const menu = lines.findIndex((l) => l.startsWith("Account menu"));
    expect(lines.slice(menu + 1, menu + 4)).toEqual([
      expect.stringContaining("- Settings · /app/settings"),
      expect.stringContaining("- Firm · /app/firm"),
      expect.stringContaining("- Plan and billing · /app/billing"),
    ]);
  });
});
