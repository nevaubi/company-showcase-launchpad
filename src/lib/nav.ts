import type { AppPath } from "@/lib/workspace";

/** Paths a nav page may point at: the app's pages plus the account settings page. */
export type NavPath = AppPath | "/app/settings";

/** A sidebar entry that groups several related pages under one set of tabs. */
export type Hub = {
  id: string;
  label: string;
  pages: { to: NavPath; label: string; exact?: boolean }[];
};

/**
 * `admin` groups show only to admins; `menu: false` groups stay out of the sidebar (reached from the
 * account menu) but still give their pages hub tabs and a place in the assistant's site map.
 * The sidebar shows no group headings; `heading` names the group for other consumers.
 */
export const HUB_GROUPS: { heading: string; admin?: boolean; menu?: false; hubs: Hub[] }[] = [
  {
    heading: "Pages",
    hubs: [
      {
        id: "dashboard",
        label: "Overview",
        pages: [{ to: "/app", label: "Overview", exact: true }],
      },
      {
        id: "companies",
        label: "Companies",
        pages: [
          { to: "/app/companies", label: "All companies" },
          { to: "/app/screener", label: "Screener" },
          { to: "/app/compare", label: "Compare" },
          { to: "/app/kpis", label: "KPI matrix" },
          { to: "/app/exposures", label: "Exposures" },
        ],
      },
      {
        id: "filings",
        label: "Filings and data",
        pages: [
          { to: "/app/filings", label: "Filings" },
          { to: "/app/earnings", label: "Earnings" },
          { to: "/app/calendars", label: "Calendars" },
          { to: "/app/supply-chain", label: "Supply chain" },
          { to: "/app/alt-data", label: "Alt data" },
        ],
      },
      {
        id: "markets",
        label: "Markets",
        pages: [
          { to: "/app/markets", label: "Technicals" },
          { to: "/app/options", label: "Options" },
          { to: "/app/sectors", label: "Sectors" },
          { to: "/app/macro", label: "Macro" },
          { to: "/app/hedge-funds", label: "Hedge funds" },
        ],
      },
      {
        id: "signals",
        label: "Signals",
        pages: [
          { to: "/app/feed", label: "What changed" },
          { to: "/app/situations", label: "Situations" },
          { to: "/app/insights", label: "Insights" },
          { to: "/app/agents", label: "Alerts" },
          { to: "/app/setups", label: "Short-term setups" },
          { to: "/app/ideas", label: "Trade ideas" },
          { to: "/app/autopilots", label: "Autopilots" },
          { to: "/app/portfolio", label: "Paper portfolio" },
        ],
      },
      {
        id: "research",
        label: "Research",
        pages: [
          { to: "/app/research", label: "Research agent" },
          { to: "/app/theses", label: "Theses" },
          { to: "/app/reports", label: "Reports" },
          { to: "/app/office", label: "Office Studio" },
        ],
      },
    ],
  },
  {
    heading: "Account",
    menu: false,
    hubs: [
      {
        id: "account",
        label: "Account",
        pages: [
          { to: "/app/settings", label: "Settings" },
          { to: "/app/firm", label: "Firm" },
          { to: "/app/billing", label: "Plan and billing" },
        ],
      },
    ],
  },
  {
    heading: "Admin",
    admin: true,
    menu: false,
    hubs: [
      {
        id: "admin",
        label: "Admin",
        pages: [
          { to: "/app/admin", label: "Waitlist" },
          { to: "/app/freshness", label: "Freshness" },
          { to: "/app/status", label: "Data status" },
          { to: "/app/worker", label: "Live worker" },
        ],
      },
    ],
  },
];

/** The hubs shown as sidebar rows, in order: every non-admin group that is not `menu: false`. */
export const SIDEBAR_HUBS: Hub[] = HUB_GROUPS.filter((g) => !g.admin && g.menu !== false).flatMap(
  (g) => g.hubs,
);

const matches = (p: { to: string; exact?: boolean }, pathname: string) =>
  p.exact ? pathname === p.to : pathname === p.to || pathname.startsWith(p.to + "/");

/** The hub whose page owns this pathname (longest match wins). */
export function hubFor(pathname: string): Hub | undefined {
  let best: { hub: Hub; len: number } | undefined;
  for (const g of HUB_GROUPS)
    for (const hub of g.hubs)
      for (const p of hub.pages)
        if (matches(p, pathname) && (!best || p.to.length > best.len))
          best = { hub, len: p.to.length };
  return best?.hub;
}

/**
 * Sorts path-keyed items under the hub that owns each path, in sidebar order followed by the account pages,
 * and within a hub in tab order. Admin hubs and paths that belong to no hub are left out.
 */
export function groupByHub<T extends { to: string }>(items: T[]): { hub: Hub; items: T[] }[] {
  const hubs = HUB_GROUPS.filter((g) => !g.admin).flatMap((g) => g.hubs);
  const tab = (hub: Hub, to: string) => hub.pages.findIndex((p) => matches(p, to));
  return hubs
    .map((hub) => ({
      hub,
      items: items
        .filter((i) => hubFor(i.to)?.id === hub.id)
        .sort((x, y) => tab(hub, x.to) - tab(hub, y.to)),
    }))
    .filter((g) => g.items.length > 0);
}

export function isPageActive(p: { to: string; exact?: boolean }, pathname: string) {
  return matches(p, pathname);
}

/** Admin-only paths: regular users are sent back to the dashboard. */
export const ADMIN_PATHS = ["/app/admin", "/app/freshness", "/app/status", "/app/worker"];
export const isAdminPath = (pathname: string) =>
  ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
