// Pure helpers over "what changed" events: labels, filters, day grouping, since-last-visit counts and the digest.
import type { ChangeEvent, ChangeTier, ChangeType } from "./types";

export const TYPE_LABEL: Record<ChangeType, string> = {
  filing_change: "Filing changes",
  filing_8k: "8-K events",
  insider: "Insiders",
  contracts: "Federal contracts",
  analyst: "Analysts",
  earnings: "Earnings",
  ir_doc: "IR documents",
  technical: "Technicals",
  dividend: "Dividends",
  ipo: "IPOs",
  macro: "Macro",
  sec_review: "SEC reviews",
  short_interest: "Short interest",
};

/** Short singular label for chips and badges. */
export const TYPE_SHORT: Record<ChangeType, string> = {
  filing_change: "filing change",
  filing_8k: "8-K",
  insider: "insider",
  contracts: "contracts",
  analyst: "analyst",
  earnings: "earnings",
  ir_doc: "IR doc",
  technical: "technical",
  dividend: "dividend",
  ipo: "IPO",
  macro: "macro",
  sec_review: "SEC review",
  short_interest: "short interest",
};

export const TIER_LABEL: Record<ChangeTier, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
const TIER_ORDER: Record<ChangeTier, number> = { high: 0, medium: 1, low: 2 };

export interface ChangeFilter {
  types?: ChangeType[];
  /** minimum tier to keep ("medium" keeps high and medium) */
  minTier?: ChangeTier;
  sector?: string | null;
  /** keep only these tickers (universe-level events are dropped when set) */
  tickers?: Set<string> | null;
  query?: string;
  includeUpcoming?: boolean;
}

export function filterEvents(events: ChangeEvent[], f: ChangeFilter): ChangeEvent[] {
  const q = f.query?.trim().toLowerCase();
  return events.filter((e) => {
    if (f.types?.length && !f.types.includes(e.type)) return false;
    if (f.minTier && TIER_ORDER[e.tier] > TIER_ORDER[f.minTier]) return false;
    if (f.sector && e.sector !== f.sector) return false;
    if (f.tickers && (!e.t || !f.tickers.has(e.t))) return false;
    if (f.includeUpcoming === false && e.upcoming) return false;
    if (q) {
      const hay =
        `${e.t ?? ""} ${e.name ?? ""} ${e.title} ${e.detail ?? ""} ${e.reason}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** The event's own size for ordering within a tier (share of market cap, then dollars, then relative change). */
export function magnitude(e: ChangeEvent): number {
  const m = e.metrics ?? {};
  const num = (k: string) =>
    typeof m[k] === "number" && Number.isFinite(m[k] as number) ? (m[k] as number) : null;
  const bps = num("bps_mcap");
  if (bps != null) return Math.abs(bps);
  for (const k of ["value", "amount"]) {
    const v = num(k);
    if (v) return Math.abs(v) / 1e8;
  }
  for (const k of ["change", "surprise_pct", "median_target_move"]) {
    const v = num(k);
    if (v != null) return Math.abs(v) * 10;
  }
  return 0;
}

/** Tier, then size, then newest first. */
export function rankEvents(events: ChangeEvent[]): ChangeEvent[] {
  return [...events].sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      magnitude(b) - magnitude(a) ||
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
  );
}

export interface DayGroup {
  date: string;
  upcoming: boolean;
  events: ChangeEvent[];
}

/** Newest day first; inside a day, by tier and size. Upcoming events (future dates) come first in their own groups. */
export function groupByDay(events: ChangeEvent[]): DayGroup[] {
  const by = new Map<string, ChangeEvent[]>();
  for (const e of events) {
    const list = by.get(e.date);
    if (list) list.push(e);
    else by.set(e.date, [e]);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, evs]) => ({
      date,
      upcoming: evs.every((e) => e.upcoming),
      events: rankEvents(evs),
    }));
}

/** When an event became visible: the pipeline's first-seen time, or the event date for older files. */
export function seenAt(e: ChangeEvent): string {
  return e.first_seen ?? `${e.date}T00:00:00Z`;
}

export function newSince(events: ChangeEvent[], since: string | null | undefined): ChangeEvent[] {
  if (!since) return [];
  return events.filter((e) => !e.upcoming && seenAt(e) > since);
}

export function countByType(events: ChangeEvent[]): { type: ChangeType; n: number }[] {
  const m = new Map<ChangeType, number>();
  for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return [...m.entries()].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n);
}

export interface DigestItem {
  event: ChangeEvent;
  /** true when the event appeared after the user's last visit to that company */
  isNew: boolean;
}

export interface Digest {
  generated: string;
  tickers: string[];
  items: DigestItem[];
  /** events considered (after the tier floor and window) */
  considered: number;
  /** per-ticker count of events new since the last visit */
  newByTicker: Record<string, number>;
}

/**
 * Daily digest for one user: the top events across their companies in the last `days` days, high and medium tier
 * by default, at most `maxPerTicker` per company so one busy name doesn't fill the list. Pure; the caller supplies
 * the per-company files (browser: partner files; server: partner key) and last-visit times.
 */
export function buildDigest(opts: {
  files: { ticker: string; events: ChangeEvent[] }[];
  lastSeen?: Record<string, string | undefined>;
  today: string;
  days?: number;
  limit?: number;
  maxPerTicker?: number;
  minTier?: ChangeTier;
  now?: string;
}): Digest {
  const {
    files,
    lastSeen = {},
    today,
    days = 7,
    limit = 10,
    maxPerTicker = 3,
    minTier = "medium",
  } = opts;
  const floor = new Date(`${today}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - days);
  const from = floor.toISOString().slice(0, 10);
  const pool = files.flatMap((f) =>
    filterEvents(f.events, { minTier, includeUpcoming: false }).filter(
      (e) => e.date >= from && e.date <= today,
    ),
  );
  const per = new Map<string, number>();
  const items: DigestItem[] = [];
  for (const e of rankEvents(pool)) {
    const t = e.t ?? "";
    if ((per.get(t) ?? 0) >= maxPerTicker) continue;
    per.set(t, (per.get(t) ?? 0) + 1);
    const since = lastSeen[t];
    items.push({ event: e, isNew: since ? seenAt(e) > since : true });
    if (items.length >= limit) break;
  }
  const newByTicker: Record<string, number> = {};
  for (const f of files) newByTicker[f.ticker] = newSince(f.events, lastSeen[f.ticker]).length;
  return {
    generated: opts.now ?? new Date().toISOString(),
    tickers: files.map((f) => f.ticker),
    items,
    considered: pool.length,
    newByTicker,
  };
}

/** Plain-text digest (email body, agent inbox, notifications). */
export function digestText(d: Digest, appUrl = ""): string {
  if (!d.items.length)
    return "Nothing at medium or high materiality across your companies in the window.";
  return d.items
    .map(({ event: e, isNew }) => {
      const src = e.evidence.find((x) => x.kind !== "app") ?? e.evidence[0];
      const link = src ? (src.kind === "app" ? `${appUrl}${src.url}` : src.url) : "";
      return `${isNew ? "[new] " : ""}${e.t ?? ""} ${e.date}: ${e.title}\n  Why it ranks: ${e.reason}${link ? `\n  Source: ${link}` : ""}`;
    })
    .join("\n\n");
}

export function fmtBaseRate(b: ChangeEvent["base_rate"]): string | null {
  if (!b || b.excess == null) return null;
  const p = (v: number | null) =>
    v == null ? "n/a" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  return `After similar events since ${b.since?.slice(0, 4) ?? "2008"}, the ${b.horizon_days}-day return averaged ${p(b.excess)} versus an average stock-day (95% range ${p(b.excess_ci[0])} to ${p(b.excess_ci[1])}, n=${(b.n ?? 0).toLocaleString("en-US")}), ${b.verdict}. Past frequencies, not a forecast.`;
}

export interface CompanyVisit {
  ticker: string;
  last_seen_at: string;
  previous_seen_at: string | null;
}

/** A visit within this long counts as the same session: badges keep measuring against the visit before it. */
const SESSION_MS = 30 * 60_000;

/** The baseline a page view is measured against: the last visit, or the one before it if that was this session. */
export function visitBaseline(v: CompanyVisit | undefined, now = Date.now()): string | null {
  if (!v) return null;
  return now - new Date(v.last_seen_at).getTime() < SESSION_MS
    ? v.previous_seen_at
    : v.last_seen_at;
}
