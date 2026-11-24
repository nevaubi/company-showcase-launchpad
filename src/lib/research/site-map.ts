// The app's pages as the assistant sees them: every sidebar page (grouped by its sidebar entry), the account
// pages and every company tab, with its path and one line on what is there. Built from the real navigation so
// it cannot drift from the sidebar.
import { COVERAGE } from "@/lib/coverage";
import { HUB_GROUPS } from "@/lib/nav";

/** Sector pages (`/app/sectors/$sector`) take the sector name as written in coverage. */
const SECTOR_NAMES = new Set(COVERAGE.map((c) => c.sector));

const NOTES: Record<string, string> = {
  "/app": "Watchlist, market moves and what changed today",
  "/app/feed": "Ranked events across covered companies: filings, insider trades, alt data",
  "/app/situations": "Special situations found by rules",
  "/app/insights":
    "Reported KPIs read against their own history, peers, guidance, contracts, lobbying and trading records",
  "/app/agents":
    "Scheduled tasks that deliver sourced reports, and monitors that alert on new matching data",
  "/app/companies":
    "Every covered company in one sortable list (sections Company filters, Company list): search, sector, Filter industry group, Following switch; columns Price, Day, Mkt cap, Revenue, Rev. YoY, Gross mgn, P/E, FCF yld, Filed (latest 10-K or 10-Q; the year is in the cell's hover text). Follow buttons add a company to the watchlist; a row opens the company",
  "/app/screener":
    "Screen companies in words or with filters (sections Screen builder, Screen results): Add filter (pick a field, then above, below, between, top %, bottom %, is reported, or is yes / is no), Presets, filter chips (click to edit, Remove to drop), Clear screen, Copy link, Fundamentals-only switch, Group by, Choose columns (column sets Overview, Valuation, Growth, Quality, Momentum, Risk, Income, or single fields), CSV of what is shown. Fields include valuation, growth, quality, momentum, risk, liquidity (20-day dollar volume, short-volume share), correlations and insiders. Address param: screen=CODE (shareable screen, written by Copy link); a link that cannot be read or is too long opens the default screen with a notice saying so (\"This shared link could not be read; showing the default screen.\")",
  "/app/compare":
    "Up to eight companies side by side (sections Compare picker, Comparison table, Compare charts, Annual revenue); best and worst tinted; reported lines open their filings. Annual columns line up by fiscal year: heads read FY2025 when every company's year ends in December, Ended 2025 when year ends differ, with an en dash for a year a company has not reported. Address param: t=AAPL,MSFT",
  "/app/kpis":
    "Standardized company KPIs across companies (sections KPI matrix controls, KPI matrix): Choose KPIs (popover with the KPI toggles and Most reported), quarter or year, value or change, Last 18 months only switch; units and period in each column head; click a value for the release it was read from, a row for the company",
  "/app/exposures":
    "Revenue by country/region and lender credit metrics compared across companies (10-K tags), in sections such as Banks and lenders; the Exposure coverage line at the foot says how many companies are covered",
  "/app/filings":
    "Every SEC filing across coverage, one filing day at a time (sections Feed controls, Filing day, Largest disclosure changes, Verified filing insights). Controls: View (Filings or Changes), Form family, sector, Watchlist only switch, search, Filing days nav (earlier, later, latest); the Changes view (disclosure changes in recent 10-K and 10-Q filings) has Form, Window (7, 30, 90 days) and a Signal select. Address params: view=filings|changes, day=YYYY-MM-DD, fam, sector, watch=true, q, page, form=all|10-K|10-Q, days=7|30|90, signal",
  "/app/earnings":
    "Earnings season: recent and upcoming reports (sections Beat rate by sector, Does a beat move the stock?, Coming up, Reported)",
  "/app/calendars": "Earnings, economic and Treasury calendars",
  "/app/markets":
    "Technical analysis (sidebar tab Technicals). With a symbol it shows one stock: sections Quote, Technicals navigation (View: the symbol or Market; the symbol picker \"Symbol: X. Change symbol\" with Search symbols; section links Chart, Read, Evidence, Levels and risk, Volatility, Relative strength, Short interest (covered companies only), Events), Price chart (Range 1D to Max, Chart type Candles or Line, Price scale Linear or Log, toggle groups Averages, Show, Panes, Compare), Technical read (six sentences; each opens the figures behind it in the Evidence table sheet), Evidence (tested conditions at Horizon 5, 20 or 60 days; a condition name opens its cases), Levels and risk, Volatility, Relative strength, Short interest and flows (Short interest, Short-sale volume, Off-exchange volume), Events. Without a symbol, or with view=market, it opens the market view: Market breadth, Events across companies, Technical scan (Horizon, Fired within, Show, sortable heads, Previous and Next), Cross-section (axis selects, Companies shown). Verdict words: a condition is called reliable only when it clears every check (at least 20 non-overlapping cases, false-discovery control across everything tested for the symbol, a bootstrap interval excluding zero, an excess above 0.2% trading costs, the same sign in both halves of the history, cross-company support for chart events); the usual verdict is \"No statistically reliable signal today\", a normal state, not missing data. On one stock's history the test can detect only very large effects, so that verdict is not evidence that nothing is there. A condition in force is a description of the record, never a forecast, a buy or sell signal or advice; stop and position-size rows are arithmetic. Address params: symbol=TICKER, range=1d|5d|1mo|3mo|6mo|ytd|1y|2y|5y|10y|max (default 1y), view=symbol|market",
  "/app/options":
    "Options market across stocks: moves priced into upcoming reports vs past reactions, implied volatility and rank, put/call, unusual volume, skew (Cboe)",
  "/app/sectors":
    "Sectors and industries compared (sections Sector board, titled Sectors compared, with Level (Sectors or Industries) and Columns (Overview, Fundamentals, Risk and signals), sortable heads; Relative performance (Relative performance window 3M, 6M, 1Y); Sector rotation (Rotation tail 4w or 10w); Fund correlation; Weekly notes (this week's notes only, \"Week of\" a date; an underlined number opens the aggregate it cites); Macro context). A sector name opens /app/sectors/SECTOR (the sector name as written, e.g. /app/sectors/Information%20Technology) and an industry opens /app/sectors/g/SLUG (e.g. /app/sectors/g/hotels-restaurants-and-leisure); both are the same page: Breadcrumb, Section nav (Summary, Industries or Peer industries, Performance, Fundamentals, Risk and signals, Distribution, Companies, Macro, Insiders and filings, Exposure when there are any), sections Summary (tiles open the Aggregate breakdown sheet), Peer industries, Performance (Performance window), Valuation, Quarterly aggregates (Metric, Trend span), Weekly notes, Risk and signals, Distribution (Distribution metric), Constituents (Company columns Fundamentals or Risk and signals, Industry filter on a sector page), Macro sensitivity, Macro drivers (Official drivers), Industry KPIs, Insider activity, Recent filings, Segment exposure. Address params, board: level=industry, cols=fundamentals|risk, sort, dir=asc|desc, span=3M|6M|1Y, tail=4w|10w; group pages: m (trend metric), q (quarter whose breakdown opens), span=5y|10y|all, pw=6m|1y|2y, cols=risk, sort, dir, dm (distribution metric), ind (industry filter)",
  "/app/macro": "FRED economic series",
  "/app/hedge-funds": "Hedge fund leverage, positioning and crowding",
  "/app/supply-chain":
    "Named customers, suppliers, partners and competitors in Network (bands sized by stated revenue, purchase or contract figures or shares), Globe (where they are based; shapes mark the relation) and Chain views (tiers of suppliers through to customers' customers; a click isolates one pathway and lists each link's stated figure and source), with a stats strip (Supply stats) and an evidence panel beside the map (#supply-analysis, tabs Evidence, Exposure, Shock, Changes, Moves). Section links (Sections of this page): Map, Summary, Regions, Contracts, Market, Coverage; they scroll without changing the address. Controls: the company picker (combobox \"Company: NAME (TICKER). Change company\", field Search ticker or company), View (Network, Globe, Chain), Depth (Direct, 2nd order) or in Chain Chain depth (1 to 3 tiers), Show (All links, Suppliers only, Customers only), Flag names on the map (Single source, 10%+ share, Hotspot, Dollar figure; one at a time, pressing the lit one turns it off), Relations shown on the map; in Chain also Size lines by (Share, Dollars) and What flows. Isolation keeps one side, one name or one pathway lit and dims the rest: Isolate suppliers (customers, partners, competitors) in each Network group head, Isolate NAME on the open card, Isolate in the evidence head, in Chain any company box or line and \"Isolate the pathway through A → B\" per row; the Isolation line names what is isolated, with Clear; Escape also clears. Globe: zoom with Zoom in and Zoom out, Ctrl or ⌘ + wheel or a pinch at any time; a plain wheel zooms toward the pointer only after the map has been pressed and scrolls the page otherwise (again once the pointer leaves the map); on touch one finger pans the page until a tap engages the map; arrow keys move, plus and minus zoom, 0 returns to the company; Back to the company, Show as a flat map or Show as a globe (the flat map works the same way). Isolated names stay lit while the rest dim, the map frames them, and a caption reads \"Isolated: LABEL · N on the map\" with Show all; the selected name's bar has Isolate this pathway, and a relation in the map key isolates that relation. Shock: pick the company to shock and the size of the shock; its suppliers lose sales sized by the revenue share they disclose, its customers face disruption, two steps out. Below the map: Summary, Regions (region risk and a Region shock for one country), Contracts and calls, Market (the company's ecosystem basket), Coverage (across coverage). Figures, single-source flags and regions appear only when the quoted sentence states them for that counterparty (never the filer's own total or another party's figure); guarantees, investments, asset purchases and financing are listed apart, never added; a figure only an older 10-K or 10-Q states is shown with that filing. The Dollar figure flag marks names with a stated flow or a stated share × SEC revenue. Address params: t=TICKER, view=network|globe|chain, sel=relation:TICKER or relation:Name (opens that name's evidence, e.g. sel=supplier:TSM), overlay=single|concentration|geo|dollars, depth=2 (second-order names), tab=evidence|reactions|changes|shock|exposure (reactions is the Moves tab), iso=rel:supplier|rel:customer|rel:partner|rel:competitor (one side), iso=node:supplier:TSM (one name, same form as sel), iso=path:ENTG>TSM>NVDA>HPE (one pathway, upstream to downstream, the company in its place). Example: /app/supply-chain?t=NVDA&view=chain&iso=path:TSM>NVDA>HPE",
  "/app/alt-data":
    "Public registries (17 datasets: contracts, Federal Register, FDA, trials, recalls, 13D/G, capital-markets filings, fails to deliver, pageviews, bank call reports, deposits, complaints, 8-K items and more) scored against each company's own history. Sections: Alt data filters (Theme: All, Government, Products, Market, Banking, Corporate events; Filter by ticker), Unusual now, Leaderboard (Leaderboard series select, Rank by Size or vs normal), Material filings (activist 13D stakes and red-flag 8-K items, last 90 days), Datasets (the catalogue: one row per dataset with theme, what one row is, source and coverage; a dataset button opens its records), Dataset records, Plants under live warnings. Unusual now compares only periods a source has fully published (windows end at the source's publication delay, the month in progress is left out, history counts only from the first stored record, a company with under a year of stored history is set aside, and regulatory, contracts and trials are not watched); a count is listed only when it is above every earlier window by an exact test, a reading only when it is outside the company's own range. An empty list (\"Nothing unusual right now\") is the normal result, not missing data. Address param: d=DATASET (opens that dataset's records)",
  "/app/setups":
    "Short-term trading rules (46 published strategy versions) re-tested nightly and judged against luck: with that many rules tried, a rule is listed only if its monthly record since 2022 stands out under false-discovery control. The page opens on the short list. Today no rule may clear the bar, so the list is empty and says why: the bar, and how strong a rule would have to be to clear it (an empty list means nothing is exceptional, not that nothing has any edge). The Watch list tab holds up to 20 signals from the rules nearest the bar, with no stop or target; it is not a recommendation and not evidence. Sections: Page sections (links Today's setups, Scoreboard, How this is tested), Market context (last tile: Rules that clear the bar), Today's setups, Strategy scoreboard (every rule, backtest against live; sortable heads; a row opens its record, checks and regimes), Methodology. Controls: Which signals to show (Short list, Watch list, All fired), Side, Holding period, Family, Sector, Traded a day, Reset filters, the empty-state button \"Watch list: N signals of rules that are not listed\", Scoreboard family; a setup row opens Open TICKER and, for a rule that is not listed, quiet Paper trade and Automate this rule buttons under \"If you paper-trade it anyway\" (paper only). A row whose stored price disagrees with its session's bar carries a warning mark. Live record: probation counts independent holding periods with live signals, not calendar days (six periods and thirty trades before a live record can demote a rule); rules with identical live trades are shown as one record. Address params: view=short|closest|all (closest is the Watch list), side=long|short, hold=week|fortnight|month, family=reversal|momentum|events|links|multi, sector, liq=5|20|100|500 ($M a day). Words: a rule is listed (proven, candidate, on watch) or not listed; luck rate is the q-value; expected edge exists only for listed rules",
  "/app/ideas":
    "Three-month, fundamentals-led trade ideas in one table (sections Trade ideas, Rule record, Paper trades), each rule's history read against a coin flip, not as a forecast. Controls: Side (Any side, Long, Short), Which ideas to show (Short list, Every idea); a row opens the filed figures and Paper trade",
  "/app/autopilots":
    "Paper autopilots that trade the short-term setup signals automatically, tracked against the S&P 500",
  "/app/portfolio": "Paper portfolio",
  "/app/research": "Research agent history",
  "/app/theses": "Saved investment theses",
  "/app/reports": "Generated primers, earnings previews and recaps, memos",
  "/app/office": "Office Studio: Writer, Sheets, Slides and PDF with the OfficeAI assistant",
  "/app/settings": "Your profile and appearance settings, including the theme",
  "/app/firm": "Firm workspace: members, invites, coverage list and branding",
  "/app/billing": "Plan, trial and AI usage",
};

/** Company tabs, as paths under /app/companies/TICKER. */
export const COMPANY_TABS: { sub: string; label: string; note: string }[] = [
  {
    sub: "",
    label: "Overview",
    note: "Company header on every company tab (section Company header: logo, name, Price and Price facts, Company actions with Follow, Compare, Filings menu of the latest 10-K and 10-Q, IR site, More; tab groups Overview, Financials, Valuation, IR data, Earnings, Filings, Ownership, with their pages beneath, then the Technicals link, which opens /app/markets?symbol=TICKER (Technical analysis on the Markets page); a Pinned company bar stays at the top once the header scrolls away). The Overview itself is fully expanded with a Section nav: Financials (Financial analysis: Key figures, Financial read with Strengths and Concerns computed from the statements, Not in these figures yet), Latest quarter (Why it moved, when there is one), What changed (brief, What changed or Recent events, Filing changes), Price (Price and technical read: the price chart; Levels and signals: the nearest clustered support and resistance and the fixed chart rules that fired in the last ten sessions, each with its past record on this stock, no forecast), Earnings (Earnings, Earnings reactions, Latest earnings call), Business (About, Management and board), Relationships (Key relationships: Customers, Suppliers, Stated concentration), Operating data (What the company reports, KPI insights), Ownership (Ownership and positioning: Insider activity, Short volume, Options context), Peers, News (News narratives, Firm notes); a section with nothing for the company is left out",
  },
  {
    sub: "/financials",
    label: "Statements",
    note: "Income statement, balance sheet, cash flow and KPIs; every figure opens its filing. Sections: Statement currency (one line saying how current the statements are: the quarter or fiscal year they run through and the latest 10-Q/10-K on file, or that a newer report or earnings release is not in the tables yet), Statement controls, Statement chart, Financial statements. Extended from the latest filing: on the Normalized basis, when the scheduled build lacks a 10-Q or 10-K the company has filed, the tab reads up to four such filings when the page opens and adds their periods as new columns (values sourced to that filing; existing columns are never rewritten), and the currency line names those columns. Other tabs, the Overview and get_financials use the scheduled build only. Controls: Statement basis (Normalized, As reported, Industry template, Adjusted, Segments & detail), statement buttons, Frequency, Periods, View, scale, CSV, Excel. Address params: basis=normalized|reported|template|adjusted|detail (detail: revenue by product/geography/state, segment P&L, customer concentration, obligations by year, inventory), statement=income|balance|cashflow|kpis, freq=annual|quarterly, span=10|20|all, view=values|yoy|common",
  },
  { sub: "/valuation", label: "Valuation", note: "Multiples and valuation history" },
  {
    sub: "/estimates",
    label: "Estimates & analysts",
    note: "Consensus, revisions, ratings and price targets",
  },
  {
    sub: "/ir",
    label: "IR data",
    note: "Segments and KPIs from releases, supplements and presentations. Sections: Investor-relations summary (with the IR checks line), Key metrics, Financial map, Segment and KPI breakdowns (Quarterly, Annual or Monthly; period span; $ scale; Excel), Source documents (Library, Tables, Search). When the page opens, figures that are also in the SEC statements are cross-checked against the 10-Q/10-K: the IR checks line says how many of the shown figures are also in the 10-Q/10-K and how many agree, are held, differ, or match only a later filing (\"only in a later filing (possibly recast)\": a later filing's comparative differs, which can be a restatement, so it is not counted as differing and not marked), plus how many quarters were checked against their year and calculated values against their formula; a figure agrees when it has the same sign and is equal within 0.5% (per share: one cent or 1%; a round figure at the precision it is printed), and an opposite sign is always marked; while the statements are still loading the line says the SEC check has not run yet and nothing is checked or marked; its Which button lists each checked figure with the release and filing values and a status (agrees, held, differs, agrees, shown again, later filing only), each opening its source. Marks: every value opens its stored source cell; a dotted underline marks a calculated value; a small amber dot marks a total whose parts do not add up (listed under the table as Totals whose parts don't add up) or a figure that fails a check: differs from the 10-Q/10-K, quarters that don't add up to the year, or a calculated value that doesn't match its formula (listed under the table in Failed checks); a hollow amber ring marks a figure held back because the documents or the 10-Q/10-K contradict its unit, sign or period (kept out of totals and charts); a hollow grey ring marks a value another document prints differently (Printed differently, with both sources). Nothing is corrected. The check covers only consolidated lines both sides carry (revenue, operating income, net income, diluted EPS; for banks net interest income and the credit-loss provision) and can still miss wrong values (sign errors, restatements, derived fourth quarters): a figure with no mark is not guaranteed. Count tables may scale per row.",
  },
  {
    sub: "/earnings",
    label: "Results & promises",
    note: "Sections: Page sections (anchors #latest, #history, #promises, #next, #options), Latest quarter, Newest release, Quarterly history, History charts, Promise tracker (grouped as Promises still open, Promises missed, Promises partly kept, Promises kept), Next report, Options market (the options-priced move for the next report vs past reactions; shown only for an expiry within 10 days after the report, otherwise a dash saying why). Figures open their filing or release. A quarter's release is the last Item 2.02 8-K filed after the quarter end and on or before its 10-Q/10-K; when that cannot be established the quarter shows \"No earnings release matched to this quarter\" rather than a guess, and releases filed after the latest 10-Q/10-K are noted as filed, not yet in the tables. A value marked † is calculated: fourth-quarter EPS from Q4 net income ÷ Q4 weighted diluted shares when the 10-K states only the year, used only when that rule reproduces reported EPS (otherwise a dash with a footnote). Text written by a language model carries a Machine-written label (promise tracker summaries and grades, the model's summary under each guidance quote, Suggested questions); quotes lead and are verified word for word",
  },
  {
    sub: "/calls",
    label: "Earnings calls",
    note: "Sections: Call picker (one tab per call), Page sections, Call summary (the transcript publisher's summary, labelled Machine-written and not the company's words; sentences with a number not found in management's words are removed), Publisher's takeaways (also Machine-written; only items whose figures management said are kept), Call themes (Find in transcript buttons), Analyst questions (a question or analyst name jumps to the exchange), Transcript controls (Full call, Prepared remarks, Q&A; Show one speaker select; Search the call with Previous match and Next match), Transcript. Speakers are labelled Management, Analyst, Operator, or Role not identified when the call does not establish the role (never guessed). Address params: call, section=all|prepared|qa, speaker",
  },
  {
    sub: "/filings",
    label: "Filings & IR",
    note: "Latest annual, quarterly, earnings and proxy documents; every SEC filing grouped by kind with plain 8-K item names, Form 4 history, SEC letters and stored IR documents. Sections: Latest documents, Filing list, SEC comment letters, Search inside filings. A coverage line says what is listed (N filings on file, first to last date, every filing since the first live day, with a link to EDGAR's full list; for ownership, Form 4s before that come from the insider trade record); a year with nothing says \"Nothing on file for YEAR in this view\" with an EDGAR link. Controls: Filing kind, Year, Filter filings by words, filing pages. Address params: kind=key|all|periodic|current|ownership|proxy|offerings|correspondence|other|ir, year, q, page",
  },
  {
    sub: "/redline",
    label: "Filing changes",
    note: "Verdict first: share of the filing changed, graded against stored comparisons of the same form (Unusually large change for the top 5%, More change than usual, Typical amount of change, Less change than usual; the basis line says e.g. \"Less change than 91 in 100 annual reports on file\" and the typical share), the sections that drive it and any core section not compared, then each change ranked by materiality. A 10-Q is compared with the same quarter a year earlier when that report is on file, otherwise with the previous quarterly report, and the caption says which. Sections: Comparison (form and the two filings, the second labelled against), Verdict (section buttons), What changed, Changes (Section select, All sections, previous/next section, Materiality, Change type, Search changes, change pages)",
  },
  {
    sub: "/reports",
    label: "Reports",
    note: "Primer, earnings preview and recap, IC memo (sections Report type, Report actions, Report)",
  },
  {
    sub: "/insiders",
    label: "Insiders & influence",
    note: "Form 4 trades, proposed sales, Congress trades, holders, lobbying",
  },
  {
    sub: "/alt-data",
    label: "Alt data",
    note: "The company's public-registry data by theme (section Alternative data): the in-page nav Alt data sections, What changed, Alt data coverage, then one section per theme (Government and regulation, Products and safety, Market, ownership and attention, Banking, Corporate events; anchors #alt-gov, #alt-products, #alt-market, #alt-banking, #alt-events) holding one panel per dataset, named by its label (e.g. Government contracts, Fails to deliver, Bank call reports, 8-K filings; also Medicare drugs, Medicare drugs by state, Plants, Deposits by state) with anchor #alt-ds-DATASET (e.g. #alt-ds-events). A dataset with too little to show is one quiet line. A panel's flag means its latest whole period is unusual by the same rules as the Alt data page's Unusual now; counts cover only what is on file since the first stored record, and a figure opens its rows",
  },
];

const pages = () =>
  HUB_GROUPS.filter((g) => !g.admin).flatMap((g) =>
    g.hubs.flatMap((h) =>
      h.pages.map((p) => ({
        hub: h.label,
        hubId: h.id,
        inMenu: g.menu === false,
        path: p.to as string,
        label: p.label,
      })),
    ),
  );

/** Where the app's own navigation sits, so the assistant can say where a page is and point at its entry. */
export const LAYOUT_NOTE = [
  'Each "Sidebar:" heading below is an entry in the left sidebar, and its pages are the tabs across the top of that page; the sidebar has no other entries.',
  'Pages under "Account menu" are not in the sidebar: they open from the account menu, the avatar at the bottom of the sidebar. Admin pages (admins only) are also in that menu and are not listed here.',
  "The theme switch (Light, Dark, System) is in the account menu and on the Settings page under Appearance.",
  "To point at a sidebar entry or the account menu button, use highlight or guide with the selector shown after its heading. They can be pointed at but not pressed, and only while the sidebar is on screen; on phones, name them in words.",
].join(" ");

export const ACCOUNT_SELECTOR = "[data-tour='account']";
const hubSelector = (id: string) => `[data-tour='hub-${id}']`;

/** True for a path the assistant may open: a sidebar page, or a company tab for a ticker-shaped symbol. */
export function isAppPath(path: string): boolean {
  const clean = path.split("?")[0].replace(/\/$/, "") || "/app";
  if (pages().some((p) => p.path === clean)) return true;
  if (/^\/app\/sectors\/g\/[a-z0-9-]{1,80}$/.test(clean)) return true;
  const sector = clean.match(/^\/app\/sectors\/([^/]{1,80})$/);
  if (sector) {
    let name = sector[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      return false;
    }
    return SECTOR_NAMES.has(name);
  }
  const m = clean.match(/^\/app\/companies\/([A-Za-z][A-Za-z0-9.-]{0,9})(\/[a-z-]+)?$/);
  return !!m && COMPANY_TABS.some((t) => t.sub === (m[2] ?? ""));
}

/** The map as text. With a ticker, company tab paths are filled in for it. */
export function siteMapText(ticker?: string | null): string {
  const t = ticker?.toUpperCase() || "TICKER";
  const lines: string[] = [`App pages (open with go_to_path). ${LAYOUT_NOTE}`];
  let hub = "";
  for (const p of pages()) {
    if (p.hub !== hub) {
      hub = p.hub;
      lines.push(
        p.inMenu
          ? `Account menu (avatar at the bottom of the sidebar) · point with ${ACCOUNT_SELECTOR}`
          : `Sidebar: ${hub} · point with ${hubSelector(p.hubId)}`,
      );
    }
    lines.push(`- ${p.label} · ${p.path}${NOTES[p.path] ? ` · ${NOTES[p.path]}` : ""}`);
  }
  lines.push(`Company pages (${ticker ? `for ${t}` : "replace TICKER"}):`);
  for (const tab of COMPANY_TABS)
    lines.push(`- ${tab.label} · /app/companies/${t}${tab.sub} · ${tab.note}`);
  return lines.join("\n");
}
