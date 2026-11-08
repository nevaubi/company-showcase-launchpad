import type { AppPath } from "@/lib/workspace";

/** A sidebar entry that groups several related pages under one set of tabs. */
export type Hub = { id: string; label: string; pages: { to: AppPath; label: string; exact?: boolean }[] };

export const HUB_GROUPS: { heading: string; admin?: boolean; hubs: Hub[] }[] = [
  {
    heading: "Home",
    hubs: [
      { id: "dashboard", label: "Dashboard", pages: [{ to: "/app", label: "Dashboard", exact: true }] },
      {
        id: "signals",
        label: "Signals",
        pages: [
          { to: "/app/feed", label: "What changed" },
          { to: "/app/situations", label: "Situations" },
          { to: "/app/insights", label: "Insights" },
          { to: "/app/agents", label: "Alerts" },
        ],
      },
    ],
  },
  {
    heading: "Research",
    hubs: [
      {
        id: "companies",
        label: "Companies",
        pages: [
          { to: "/app/companies", label: "All companies" },
          { to: "/app/screener", label: "Screener" },
          { to: "/app/compare", label: "Compare" },
          { to: "/app/kpis", label: "KPI matrix" },
        ],
      },
      {
        id: "filings",
        label: "Filings",
        pages: [
          { to: "/app/filings", label: "Filings" },
          { to: "/app/earnings", label: "Earnings" },
          { to: "/app/calendars", label: "Calendars" },
        ],
      },
      {
        id: "markets",
        label: "Markets",
        pages: [
          { to: "/app/markets", label: "Technicals" },
          { to: "/app/sectors", label: "Sectors" },
          { to: "/app/macro", label: "Macro" },
          { to: "/app/hedge-funds", label: "Hedge funds" },
        ],
      },
      { id: "supply", label: "Supply chain", pages: [{ to: "/app/supply-chain", label: "Supply chain" }] },
      { id: "alt", label: "Alt data", pages: [{ to: "/app/alt-data", label: "Alt data" }] },
      {
        id: "ideas",
        label: "Ideas",
        pages: [
          { to: "/app/ideas", label: "Trade ideas" },
          { to: "/app/portfolio", label: "Paper portfolio" },
        ],
      },
    ],
  },
  {
    heading: "Workspace",
    hubs: [
      { id: "agent", label: "Research agent", pages: [{ to: "/app/research", label: "Research agent" }] },
      {
        id: "library",
        label: "Library",
        pages: [
          { to: "/app/theses", label: "Theses" },
          { to: "/app/reports", label: "Reports" },
          { to: "/app/docs", label: "Docs & sheets" },
        ],
      },
      { id: "firm", label: "Firm", pages: [{ to: "/app/firm", label: "Firm" }] },
    ],
  },
  {
    heading: "Admin",
    admin: true,
    hubs: [
      {
        id: "admin",
        label: "Admin",
        pages: [
          { to: "/app/admin", label: "Waitlist" },
          { to: "/app/freshness", label: "Freshness" },
          { to: "/app/status", label: "Data status" },
        ],
      },
    ],
  },
];

const matches = (p: { to: string; exact?: boolean }, pathname: string) =>
  p.exact ? pathname === p.to : pathname === p.to || pathname.startsWith(p.to + "/");

/** The hub whose page owns this pathname (longest match wins). */
export function hubFor(pathname: string): Hub | undefined {
  let best: { hub: Hub; len: number } | undefined;
  for (const g of HUB_GROUPS)
    for (const hub of g.hubs)
      for (const p of hub.pages)
        if (matches(p, pathname) && (!best || p.to.length > best.len)) best = { hub, len: p.to.length };
  return best?.hub;
}

export function isPageActive(p: { to: string; exact?: boolean }, pathname: string) {
  return matches(p, pathname);
}

/** Admin-only paths: regular users are sent back to the dashboard. */
export const ADMIN_PATHS = ["/app/admin", "/app/freshness", "/app/status"];
export const isAdminPath = (pathname: string) => ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
