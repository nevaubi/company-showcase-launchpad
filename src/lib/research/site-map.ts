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
  "/app/companies": "Every covered company, searchable",
  "/app/screener": "Filter companies on fundamentals",
  "/app/compare": "Side-by-side comparison of companies",
  "/app/kpis": "Company-reported KPIs across companies",
  "/app/exposures":
    "Revenue by country/region and lender credit metrics compared across companies (10-K tags)",
  "/app/filings": "Recent SEC filings across coverage",
  "/app/earnings": "Recent and upcoming earnings",
  "/app/calendars": "Earnings, economic and Treasury calendars",
  "/app/markets": "Market technicals and breadth",
  "/app/options":
    "Options market across stocks: moves priced into upcoming reports vs past reactions, implied volatility and rank, put/call, unusual volume, skew (Cboe)",
  "/app/sectors": "Sector and industry fundamentals",
  "/app/macro": "FRED economic series",
  "/app/hedge-funds": "Hedge fund leverage, positioning and crowding",
  "/app/supply-chain":
    "Named customers and suppliers in Network (flows by stated dollars), Globe (where they are based) and Chain views, shock simulation (add ?t=TICKER)",
  "/app/alt-data": "Public alternative data: contracts, FDA, recalls, complaints",
  "/app/setups":
    "Published short-term strategies re-tested nightly, judged on out-of-sample trades",
  "/app/ideas": "Rule-based trade ideas",
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
    note: "Headline metrics, what changed, price and technical read, catalysts, peers",
  },
  {
    sub: "/financials",
    label: "Statements",
    note: "Income statement, balance sheet, cash flow; every figure opens its filing. ?basis=detail: Segments & detail (revenue by product/geography/state, segment P&L, customer concentration, obligations by year, inventory)",
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
    note: "Segments and KPIs from releases, supplements and presentations",
  },
  {
    sub: "/earnings",
    label: "Results & promises",
    note: "Earnings results, the options-priced move for the next report vs past reactions, and the management promise tracker",
  },
  { sub: "/calls", label: "Earnings calls", note: "Transcripts by speaker" },
  { sub: "/filings", label: "Filings & IR", note: "SEC filings and IR documents" },
  {
    sub: "/redline",
    label: "Filing changes",
    note: "What changed between consecutive 10-Ks or 10-Qs",
  },
  { sub: "/reports", label: "Reports", note: "Primer, earnings preview and recap, IC memo" },
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
