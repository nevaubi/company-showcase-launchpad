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

  it("carries tonight's header, Overview, supply, globe, technicals and IR changes as the code has them", () => {
    const map = siteMapText("NVDA");
    const overview = map.split("\n").find((l) => l.includes("· /app/companies/NVDA ·"))!;
    for (const s of [
      // header: the IR site is the last item of the Filings menu; notices under the tabs
      "Research (asks the assistant for a sourced brief)",
      "EDGAR filing index and, last, Investor relations site",
      "More actions",
      "Company notices: the firm's restricted-list warning and Since your last visit",
      // Overview: view-time statements, Alt data section, read rules, narrow columns
      "Alt data (Alt data snapshot, titled Alternative data",
      "All alt data",
      "revenue returning to growth",
      "Holder yield column",
      "1400 px",
      "Reading the newer filing from SEC.",
      "the panels keep their height",
      "Quarter drivers (titled with the quarter it explains, e.g. \"Q3 FY26: what moved\"",
      "the subtitle names the newer one",
      "Summary built from SEC registration data · facts from SEC EDGAR",
      "Summary from Wikipedia · facts from SEC EDGAR",
      "no rows in any of its panels",
      "at most 1.2 seconds",
      "a wide wordmark gets a plate widened to its shape",
      "the company's own site icon or its ticker letters",
    ])
      expect(overview).toContain(s);
    expect(overview).not.toMatch(/IR site,|Latest quarter \(Why it moved|the served quarter's cards stay/);
    const statements = map.split("\n").find((l) => l.includes("· /app/companies/NVDA/financials ·"))!;
    expect(statements).toContain("and the assistant's get_financials use the same read");
    expect(statements).toContain("about 25 MB");
    expect(statements).not.toContain("the Overview and get_financials use the scheduled build only");
    expect(statements).toContain("the Earnings tab's results (Latest quarter, Quarterly history)");
    expect(statements).toContain("\"10-K · new\"");
    expect(statements).toContain("EPS, basic; EPS, diluted; Weighted avg. shares, basic; Weighted avg. shares, diluted");
    expect(statements).not.toMatch(/ — /);
    const earnings = map.split("\n").find((l) => l.includes("· /app/companies/NVDA/earnings ·"))!;
    for (const s of [
      "a line titled Read at view time above the Latest quarter table",
      "the scheduled rebuild has not added it yet",
      "so Q4 FY26 is derived: the year less the first nine months.",
      "Reading the 10-K filed on DATE from SEC.",
      "could not be read here; the scheduled rebuild will add it.",
    ])
      expect(earnings).toContain(s);
    const filings = map.split("\n").find((l) => l.includes("· /app/companies/NVDA/filings ·"))!;
    expect(filings).toContain("Form 25-NSE \"Exchange removal of a listed security\"");
    expect(filings).toContain("Form 25 \"Removal of a class of securities from listing\"");
    expect(filings).toContain("\"Deregistration of a class of securities\"");

    const supply = line(map, "/app/supply-chain");
    for (const s of [
      "Stated exposure, which reads Estimated exposure or Exposure (stated, est.)",
      "Shares of 10% or more",
      "Single-source inputs",
      "Hotspot regions, its hint ending \"in link sentences\" or \"in filings and calls\"",
      "is 2nd order, not drawn at Direct\" with a Show 2nd order button (sets depth=2)",
      "one wheel notch zooms about 1.25 times",
      "opens centred between its sides",
      "a U.S. state, city or basin counts toward the United States",
      "The Dependency score counts the company's own 10-K and 10-Q only",
      "reads \"not scored\", never 0 points",
      "\"Not scored:\" and the reason",
      "an unnamed customer's share of revenue stated in the company's own filing counts in the customer part",
      "a name is rated as a country only when it is a known country name",
      "Rest of world is no place at all",
    ])
      expect(supply).toContain(s);
    expect(supply).not.toMatch(/Concentrated, 10% or more|Disclosed exposure|Stated and estimated exposure|Hotspots in link sentences|Hotspots in filings and calls/);

    const tech = line(map, "/app/markets");
    expect(tech).toContain("Log excess");
    expect(tech).toContain("Across companies, simple return column");
    expect(tech).toContain("Other conditions sentence of counts");
    expect(tech).toContain("with an All N conditions button that opens every condition tested");
    expect(tech).toContain("Not in force, with a verdict at H days · N");
    expect(tech).toContain("only a condition after which the average return differs from days without it by about X% over 5 days");
    expect(tech).not.toContain("only an average effect of about");
    expect(tech).not.toContain("Across companies column");
    expect(tech).toContain("Not detectable on SYM's own history, but reliable across companies");
    expect(tech).toContain("would have an even chance of showing up as reliable");
    expect(tech).toContain("on phones 5D, 2Y and 10Y are left out");

    const ir = map.split("\n").find((l) => l.includes("· /app/companies/NVDA/ir ·"))!;
    expect(ir).toContain("the check runs when they arrive");
    expect(ir).toContain("1,000 or 1,000,000 times it");
    expect(ir).toContain("calculated values were checked against the figures they use");
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

  it("describes the Alt data sections and the Data library as the code has them", () => {
    const hub = line(siteMapText(), "/app/alt-data");
    for (const s of [
      "tab row Alt data sections: Company signals (this page), Data library (/app/alt-data/library) and Securitized credit (/app/alt-data/credit)",
      "Library search (Search tables, publishers, series codes",
      "Shape: All, Series, Panels, By place, Reference",
      "Order: Best match while searching, Newest, Largest, A to Z",
      "Library facts (Tables; Records, counted over original tables only",
      "What the data says",
      "Collections (one card per collection",
      "What changed (publications grouped by hour, publisher and kind",
      "Publishers (a row filters the library to that publisher)",
      "Library tables replaces the overview",
      "q=words, shape=series|panel|places|table, pub=PUBLISHER_ID, sort=match|new|size|name, view=changes",
      "/app/alt-data/library/c/SLUG",
      "Collection facts, COLLECTION board (charts), Related pages",
      "Collection tables (Collection search",
      "/app/alt-data/library/d/DATASET_ID",
      "entity= native identifier or exact name",
      "Old links /app/alt-data?view=sources&source=ID open that table page",
    ])
      expect(hub).toContain(s);
    // the switch and the explorer are gone
    expect(hub).not.toMatch(/Alternative data view|Source explorer|Source catalogue|Alt data view/);
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
    expect(sectors).toContain("the caption names them \"on a wider window\"");
    expect(sectors).toContain("company names are shortened, the full name on hover");
    const kpis = line(siteMapText(), "/app/kpis");
    expect(kpis).toContain("a KPI matrix groups row (Industry group)");
    expect(kpis).toContain("Whole sector");
    expect(kpis).toContain("\"Left out: N companies report none of these KPIs\" with a Show them button (Leave them out to undo)");
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
    expect(isAppPath("/app/alt-data/library?q=bank")).toBe(true);
    expect(isAppPath("/app/alt-data/library/c/financials")).toBe(true);
    expect(isAppPath("/app/alt-data/library/d/official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b?entity=%22628%22")).toBe(true);
    expect(isAppPath("/app/alt-data/credit")).toBe(true);
    expect(isAppPath("/app/alt-data/library/d/../../admin")).toBe(false);
    expect(isAppPath("/app/alt-data/library/x/financials")).toBe(false);
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
