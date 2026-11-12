// The app's pages as the assistant sees them: every sidebar page and every company tab, with its path and
// one line on what is there. Built from the real navigation so it cannot drift from the sidebar.
import { HUB_GROUPS } from "@/lib/nav";

const NOTES: Record<string, string> = {
  "/app": "Watchlist, market moves and what changed today",
  "/app/feed": "Ranked events across covered companies: filings, insider trades, alt data",
  "/app/situations": "Special situations found by rules",
  "/app/companies": "Every covered company, searchable",
  "/app/screener": "Filter companies on fundamentals",
  "/app/compare": "Side-by-side comparison of companies",
  "/app/kpis": "Company-reported KPIs across companies",
  "/app/filings": "Recent SEC filings across coverage",
  "/app/earnings": "Recent and upcoming earnings",
  "/app/calendars": "Earnings, economic and Treasury calendars",
  "/app/markets": "Market technicals and breadth",
  "/app/sectors": "Sector and industry fundamentals",
  "/app/macro": "FRED economic series",
  "/app/hedge-funds": "Hedge fund leverage, positioning and crowding",
  "/app/supply-chain": "Named customers and suppliers, flow and map views, shock simulation (add ?t=TICKER)",
  "/app/alt-data": "Public alternative data: contracts, FDA, recalls, complaints",
  "/app/ideas": "Rule-based trade ideas",
  "/app/portfolio": "Paper portfolio",
  "/app/research": "Research agent history",
  "/app/theses": "Saved investment theses",
  "/app/reports": "Generated primers, earnings previews and recaps, memos",
  "/app/docs": "Documents and sheets",
};

/** Company tabs, as paths under /app/companies/TICKER. */
export const COMPANY_TABS: { sub: string; label: string; note: string }[] = [
  { sub: "", label: "Overview", note: "Headline metrics, what changed, price and technical read, catalysts, peers" },
  { sub: "/financials", label: "Statements", note: "Income statement, balance sheet, cash flow; every figure opens its filing" },
  { sub: "/valuation", label: "Valuation", note: "Multiples and valuation history" },
  { sub: "/estimates", label: "Estimates & analysts", note: "Consensus, revisions, ratings and price targets" },
  { sub: "/ir", label: "IR data", note: "Segments and KPIs from releases, supplements and presentations" },
  { sub: "/earnings", label: "Results & promises", note: "Earnings results and the management promise tracker" },
  { sub: "/calls", label: "Earnings calls", note: "Transcripts by speaker" },
  { sub: "/filings", label: "Filings & IR", note: "SEC filings and IR documents" },
  { sub: "/redline", label: "Filing changes", note: "What changed between consecutive 10-Ks or 10-Qs" },
  { sub: "/reports", label: "Reports", note: "Primer, earnings preview and recap, IC memo" },
  { sub: "/insiders", label: "Insiders & influence", note: "Form 4 trades, proposed sales, Congress trades, holders, lobbying" },
  { sub: "/alt-data", label: "Alt data", note: "Company-level alternative data" },
];

const pages = () => HUB_GROUPS.filter((g) => !g.admin).flatMap((g) => g.hubs.flatMap((h) => h.pages.map((p) => ({ group: g.heading, hub: h.label, path: p.to as string, label: p.label }))));

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
  const lines: string[] = ["App pages (open with go_to_path):"];
  let group = "";
  for (const p of pages()) {
    if (p.group !== group) {
      group = p.group;
      lines.push(`${group}`);
    }
    lines.push(`- ${p.label} · ${p.path}${NOTES[p.path] ? ` · ${NOTES[p.path]}` : ""}`);
  }
  lines.push(`Company pages (${ticker ? `for ${t}` : "replace TICKER"}):`);
  for (const tab of COMPANY_TABS) lines.push(`- ${tab.label} · /app/companies/${t}${tab.sub} · ${tab.note}`);
  return lines.join("\n");
}
