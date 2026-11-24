// The app's pages as the assistant sees them: every sidebar page (grouped by its sidebar entry), the account
// pages and every company tab, with its path and one line on what is there. Built from the real navigation so
// it cannot drift from the sidebar.
import { HUB_GROUPS } from "@/lib/nav";

const NOTES: Record<string, string> = {
  "/app": "Watchlist, market moves and what changed today",
  "/app/feed": "Ranked events across covered companies: filings, insider trades, alt data",
  "/app/situations": "Special situations found by rules",
  "/app/insights":
    "Reported KPIs read against their own history, peers, guidance, contracts, lobbying and trading records",
  "/app/agents":
    "Scheduled tasks that deliver sourced reports, and monitors that alert on new matching data",
  "/app/companies":
    "Every covered company in one sortable list (sections Company filters, Company list): search, sector, Filter industry group, Following switch; price, day change, market cap, revenue, growth, margins, P/E, FCF yield, last filing. Follow buttons add a company to the watchlist; a row opens the company",
  "/app/screener":
    "Screen companies in words or with filters (sections Screen builder, Screen results): Add filter (pick a field, then above, below, between, top %, bottom %, is reported, or is yes / is no), Presets, filter chips (click to edit, Remove to drop), Clear screen, Copy link, Fundamentals-only switch, Group by, Choose columns (column sets Overview, Valuation, Growth, Quality, Momentum, Risk, Income, or single fields), CSV of what is shown. Fields include valuation, growth, quality, momentum, risk, liquidity (20-day dollar volume, short-volume share), correlations and insiders. Address param: screen=CODE (shareable screen, written by Copy link)",
  "/app/compare":
    "Up to eight companies side by side (sections Compare picker, Comparison table, Compare charts, Annual revenue); best and worst tinted; reported lines open their filings. Address param: t=AAPL,MSFT",
  "/app/kpis":
    "Standardized company KPIs across companies (sections KPI matrix controls, KPI matrix): Choose KPIs (popover with the KPI toggles and Most reported), quarter or year, value or change, Last 18 months only switch; units and period in each column head; click a value for the release it was read from, a row for the company",
  "/app/exposures":
    "Revenue by country/region and lender credit metrics compared across companies (10-K tags), in sections such as Banks and lenders; the Exposure coverage line at the foot says how many companies are covered",
  "/app/filings":
    "Every SEC filing across coverage, one filing day at a time (sections Feed controls, Filing day, Largest disclosure changes, Verified filing insights). Controls: View (Filings or Changes), Form family, sector, Watchlist only switch, search, Filing days nav (earlier, later, latest). Address params: view=filings|changes, day=YYYY-MM-DD, fam, sector, watch=true, q, page, form=all|10-K|10-Q, days",
  "/app/earnings":
    "Earnings season: recent and upcoming reports (sections Beat rate by sector, Does a beat move the stock?, Coming up, Reported)",
  "/app/calendars": "Earnings, economic and Treasury calendars",
  "/app/markets": "Market technicals and breadth",
  "/app/options":
    "Options market across stocks: moves priced into upcoming reports vs past reactions, implied volatility and rank, put/call, unusual volume, skew (Cboe)",
  "/app/sectors": "Sector and industry fundamentals",
  "/app/macro": "FRED economic series",
  "/app/hedge-funds": "Hedge fund leverage, positioning and crowding",
  "/app/supply-chain":
    "Named customers, suppliers, partners and competitors in Network (bands sized by stated revenue, purchase or contract figures or shares), Globe (where they are based; shapes mark the relation) and Chain views, plus stats, link evidence, shock simulation and stated exposure. Figures, single-source flags and regions appear only when the quoted sentence states them for that counterparty (never the filer's own total or another party's figure); guarantees, investments, asset purchases and financing are listed apart, never added; a figure only an older 10-K or 10-Q states is shown with that filing. The dollars overlay marks names with a stated flow or a stated share × SEC revenue. Address params: t=TICKER, view=network|globe|chain, sel=relation:TICKER or relation:Name (opens that name's evidence, e.g. sel=supplier:TSM), overlay=single|concentration|geo|dollars, depth=2 (second-order names), tab=evidence|reactions|changes|shock|exposure. Example: /app/supply-chain?t=NVDA&view=globe&sel=supplier:TSM",
  "/app/alt-data": "Public alternative data: contracts, FDA, recalls, complaints",
  "/app/setups":
    "Short-term trading rules (46 published strategy versions) re-tested nightly and judged against luck: with that many rules tried, a rule is listed only if its monthly record since 2022 stands out under false-discovery control. Today no rule may clear the bar; the page then opens on Closest, a watch list of up to 20 signals from the rules nearest the bar, which is not a recommendation and not evidence. Sections: Page sections (links Today's setups, Scoreboard, How this is tested), Market context (last tile: Rules that clear the bar), Today's setups, Strategy scoreboard (every rule, backtest against live; sortable heads; a row opens its record, checks and regimes), Methodology. Controls: Which signals to show (Short list, Closest, All fired), Side, Holding period, Family, Sector, Traded a day, Reset filters, See the N closest, Scoreboard family; a setup row opens Paper trade, Automate this rule, Open TICKER. Address params: view=short|closest|all, side=long|short, hold=week|fortnight|month, family=reversal|momentum|events|links|multi, sector, liq=5|20|100|500 ($M a day). Words: a rule is listed (proven, candidate, on watch) or not listed; luck rate is the q-value; expected edge exists only for listed rules",
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
    note: "Company header on every company tab (section Company header: logo, name, Price and Price facts, Company actions with Follow, Compare, Filings menu of the latest 10-K and 10-Q, IR site, More; tab groups Overview, Financials, Valuation, IR data, Earnings, Filings, Ownership, with their pages beneath; a Pinned company bar stays at the top once the header scrolls away). The Overview itself is fully expanded with a Section nav: Financials (Financial analysis: Key figures, Financial read with Strengths and Concerns computed from the statements, Not in these figures yet), Latest quarter (Why it moved, when there is one), What changed (brief, What changed or Recent events, Filing changes), Price (Price and technical read, Levels and signals), Earnings (Earnings, Earnings reactions, Latest earnings call), Business (About, Management and board), Relationships (Key relationships: Customers, Suppliers, Stated concentration), Operating data (What the company reports, KPI insights), Ownership (Ownership and positioning: Insider activity, Short volume, Options context), Peers, News (News narratives, Firm notes); a section with nothing for the company is left out",
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
    note: "Segments and KPIs from releases, supplements and presentations. Sections: Investor-relations summary (with the IR checks line), Key metrics, Financial map, Segment and KPI breakdowns (Quarterly, Annual or Monthly; period span; $ scale; Excel), Source documents (Library, Tables, Search). When the page opens, figures that are also in the SEC statements are cross-checked against the 10-Q/10-K: the IR checks line says how many were checked and how many agree, are held or differ, plus how many quarters were checked against their year and calculated values against their formula; its Which button lists each checked figure with the release and filing values, each opening its source. Marks: every value opens its stored source cell; a dotted underline marks a calculated value; a small amber dot marks a total whose parts do not add up (listed under the table as Totals whose parts don't add up) or a figure that fails a check: differs from the 10-Q/10-K, quarters that don't add up to the year, or a calculated value that doesn't match its formula (listed under the table in Failed checks); a hollow amber ring marks a figure held back because the documents or the 10-Q/10-K contradict its unit, sign or period (kept out of totals and charts); a hollow grey ring marks a value another document prints differently (Printed differently, with both sources). Nothing is corrected. The check covers only consolidated lines both sides carry (revenue, operating income, net income, diluted EPS; for banks net interest income and the credit-loss provision) and can still miss wrong values (sign errors, restatements, derived fourth quarters): a figure with no mark is not guaranteed. Count tables may scale per row.",
  },
  {
    sub: "/earnings",
    label: "Results & promises",
    note: "Sections: Page sections (anchors #latest, #history, #promises, #next, #options), Latest quarter, Newest release, Quarterly history, History charts, Promise tracker (grouped as Promises still open, Promises missed, Promises partly kept, Promises kept), Next report, Options market (the options-priced move for the next report vs past reactions). Figures open their filing or release",
  },
  {
    sub: "/calls",
    label: "Earnings calls",
    note: "Sections: Call picker (one tab per call), Page sections, Call summary, Call themes (Find in transcript buttons), Analyst questions (a question or analyst name jumps to the exchange), Transcript controls (Full call, Prepared remarks, Q&A; Show one speaker select; Search the call with Previous match and Next match), Transcript. Address params: call, section=all|prepared|qa, speaker",
  },
  {
    sub: "/filings",
    label: "Filings & IR",
    note: "Latest annual, quarterly, earnings and proxy documents; every SEC filing grouped by kind with plain 8-K item names, Form 4 history, SEC letters and stored IR documents. Sections: Latest documents, Filing list, SEC comment letters, Search inside filings. Controls: Filing kind, Year, Filter filings by words, filing pages. Address params: kind=key|all|periodic|current|ownership|proxy|offerings|correspondence|other|ir, year, q, page",
  },
  {
    sub: "/redline",
    label: "Filing changes",
    note: "Verdict first: share of the filing changed, the sections that drive it, then each change ranked by materiality. Sections: Comparison (form and the two filings, the second labelled against), Verdict (section buttons), What changed, Changes (Section select, All sections, previous/next section, Materiality, Change type, Search changes, change pages)",
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
  { sub: "/alt-data", label: "Alt data", note: "Company-level alternative data" },
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
