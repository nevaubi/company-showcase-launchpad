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
    expect(setups).toContain("The page opens on the short list");
    expect(setups).toContain("The Watch list tab holds up to 20 signals");
    expect(setups).toContain("with no stop or target");
    expect(setups).toContain("not a recommendation and not evidence");
    expect(setups).not.toMatch(/out-of-sample trades|predict|works|tested and working/i);
    const ideas = map.split("\n").find((l) => l.includes("· /app/ideas"))!;
    expect(ideas).toContain("against a coin flip, not as a forecast");
  });

  const line = (map: string, path: string) => map.split("\n").find((l) => l.includes(`· ${path} ·`))!;

  it("describes the rebuilt supply chain page and its globe as the code has them", () => {
    const supply = line(siteMapText(), "/app/supply-chain");
    for (const s of [
      "Sections of this page): Map, Summary, Regions, Contracts, Market, Coverage",
      "#supply-analysis, tabs Evidence, Exposure, Shock, Changes, Moves",
      "Flag names on the map (Single source, 10%+ share, Hotspot, Dollar figure",
      "Show (All links, Suppliers only, Customers only)",
      "Isolate the pathway through A → B",
      "iso=rel:supplier|rel:customer|rel:partner|rel:competitor",
      "iso=node:supplier:TSM",
      "iso=path:ENTG>TSM>NVDA>HPE",
      "tab=evidence|reactions|changes|shock|exposure",
      // globe
      "a plain wheel zooms toward the pointer only after the map has been pressed",
      "Ctrl or ⌘ + wheel or a pinch at any time",
      "Show as a flat map or Show as a globe",
      "\"Isolated: LABEL · N on the map\" with Show all",
      "Isolate this pathway",
    ])
      expect(supply).toContain(s);
    // the old overlay select and the "dollars overlay" wording are gone
    expect(supply).not.toMatch(/dollars overlay|Chain evidence/);
  });

  it("describes technical analysis without presenting any condition as a signal to trade", () => {
    const tech = line(siteMapText(), "/app/markets");
    for (const s of [
      "Price chart", "Technical read", "Evidence (tested conditions at Horizon 5, 20 or 60 days", "Levels and risk", "Volatility",
      "Relative strength", "Short interest and flows", "Events.",
      "Without a symbol, or with view=market, it opens the market view: Market breadth, Events across companies, Technical scan",
      "Cross-section",
      "\"No statistically reliable signal today\"",
      "the test can detect only very large effects, so that verdict is not evidence that nothing is there",
      "never a forecast, a buy or sell signal or advice",
      "view=symbol|market",
    ])
      expect(tech).toContain(s);
    expect(tech).not.toMatch(/Indicators|Market scan|Quant|default NVDA/);
    const overview = siteMapText("NVDA").split("\n").find((l) => l.includes("· /app/companies/NVDA ·"))!;
    expect(overview).toContain("Price (Price and technical read");
    expect(overview).toContain("Levels and signals");
    expect(overview).toContain("the Technicals link, which opens /app/markets?symbol=TICKER");
  });

  it("describes alt data with the renamed anchors and what Unusual now means", () => {
    const map = siteMapText("LMT");
    const hub = line(map, "/app/alt-data");
    expect(hub).toContain("Alt data filters (Theme: All, Government, Products, Market, Banking, Corporate events; Filter by ticker), Unusual now, Leaderboard");
    expect(hub).toContain("compares only periods a source has fully published");
    expect(hub).toContain("An empty list (\"Nothing unusual right now\") is the normal result");
    const tab = map.split("\n").find((l) => l.includes("/app/companies/LMT/alt-data"))!;
    expect(tab).toContain("#alt-ds-DATASET");
    expect(tab).toContain("8-K filings");
    expect(tab).not.toMatch(/#alt-DATASET|Every event/);
  });

  it("describes the sector board and the shared sector and industry page", () => {
    const sectors = line(siteMapText(), "/app/sectors");
    for (const s of [
      "Level (Sectors or Industries) and Columns (Overview, Fundamentals, Risk and signals)",
      "Weekly notes (this week's notes only",
      "/app/sectors/g/SLUG",
      "Quarterly aggregates (Metric, Trend span)",
      "Constituents (Company columns",
      "level=industry, cols=fundamentals|risk",
      "pw=6m|1y|2y",
    ])
      expect(sectors).toContain(s);
    expect(sectors).not.toMatch(/scorecard|heatmap|deep dive|wk=/i);
  });

  it("carries the review fixes of filings, earnings, companies and IR data", () => {
    const map = siteMapText("AAPL");
    expect(map).toContain("Unusually large change for the top 5%, More change than usual, Typical amount of change, Less change than usual");
    expect(map).toContain("Nothing on file for YEAR in this view");
    expect(map).toContain("days=7|30|90, signal");
    expect(map).toContain("Role not identified");
    expect(map).toContain("No earnings release matched to this quarter");
    expect(map).toContain("A value marked † is calculated");
    expect(map).toContain("Machine-written");
    expect(map).toContain("columns Price, Day, Mkt cap, Revenue, Rev. YoY, Gross mgn, P/E, FCF yld, Filed");
    expect(map).toContain("heads read FY2025 when every company's year ends in December, Ended 2025");
    expect(map).toContain("This shared link could not be read; showing the default screen.");
    expect(map).toContain("only in a later filing (possibly recast)");
    expect(map).toContain("the SEC check has not run yet");
  });

  it("only lets the assistant open real app pages", () => {
    expect(isAppPath("/app/sectors/Information%20Technology")).toBe(true);
    expect(isAppPath("/app/sectors/g/hotels-restaurants-and-leisure")).toBe(true);
    expect(isAppPath("/app/sectors/Nowhere")).toBe(false);
    expect(isAppPath("/app/sectors/%E0%A4%A")).toBe(false);
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
