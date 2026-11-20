// Data-advance freshness: did the newest data row move within its expected cadence (not merely "did a
// job run")? Rows come from the `data_freshness()` database function (aggregated in SQL). Pure.
// Since 0066 most keys are ingest times (when we stored something), not event dates: an event date
// lags by nature and a future period end (federal fiscal year 2027) never ages.
import { nonTradingHours } from "./trading-days";

export interface DataCadence { key: string; label: string; maxAgeHours: number; /** dates are trading days: allow weekends/holidays */ trading?: boolean }

const H = 1, D = 24;
export const DATA_CADENCE: DataCadence[] = [
  { key: "market_bars", label: "Prices (SPY bar stored)", maxAgeHours: 30, trading: true },
  { key: "macro", label: "Macro (10y yield stored)", maxAgeHours: 1 * D },
  { key: "sec_filings", label: "SEC filings discovered", maxAgeHours: 12, trading: true },
  { key: "sec_discover", label: "SEC market-wide discovery run", maxAgeHours: 2 * H },
  { key: "insider_trades", label: "Form 4 trades discovered", maxAgeHours: 30, trading: true },
  { key: "earnings_events", label: "Earnings releases (8-K 2.02)", maxAgeHours: 7 * D, trading: true },
  { key: "filing_documents", label: "Filing document cache", maxAgeHours: 2 * D },
  { key: "alt_events", label: "Alt data: 8-K events (sec walk ok)", maxAgeHours: 1 * H },
  { key: "alt_ownership", label: "Alt data: 13D/13G ownership (slow pass ok)", maxAgeHours: 2 * D },
  { key: "alt_contracts", label: "Alt data: federal contracts (slow pass ok)", maxAgeHours: 2 * D },
  { key: "alt_recalls", label: "Alt data: recalls (slow pass ok)", maxAgeHours: 2 * D },
  { key: "alt_settlement", label: "Alt data: fails to deliver", maxAgeHours: 35 * D },
  { key: "alt_medicare", label: "Alt data: Medicare spending", maxAgeHours: 40 * D },
  { key: "analyst_estimates", label: "Analyst estimates", maxAgeHours: 1 * D },
  { key: "options_daily", label: "Options (Cboe, session coverage)", maxAgeHours: 30, trading: true },
  { key: "short_volume", label: "Short volume (FINRA)", maxAgeHours: 4 * D, trading: true },
  { key: "setup_results", label: "Short-term setups", maxAgeHours: 2 * D, trading: true },
  { key: "paper_bots", label: "Paper autopilots", maxAgeHours: 2 * D, trading: true },
  { key: "ir_documents", label: "IR documents", maxAgeHours: 2 * D },
  { key: "ir_kpi_facts", label: "IR figures", maxAgeHours: 1 * D },
  { key: "ir_company_series", label: "IR series payloads", maxAgeHours: 2 * D },
  { key: "ir_label_map", label: "IR label canon (run ok)", maxAgeHours: 3 * D },
  { key: "partner_mirror", label: "Partner IR mirror", maxAgeHours: 7 * D },
  { key: "partner_mirror_job", label: "Partner dataset mirror run", maxAgeHours: 1 * D },
  { key: "universe", label: "Universe file", maxAgeHours: 7 * D },
  { key: "xbrl_concentration", label: "Filing detail (XBRL)", maxAgeHours: 14 * D },
  { key: "supply_links", label: "Supply-chain links", maxAgeHours: 7 * D },
  { key: "supply_signals", label: "Supply intel", maxAgeHours: 8 * D },
  { key: "filing_redlines", label: "Filing redlines", maxAgeHours: 2 * D },
  { key: "reports", label: "Reports (ready runs)", maxAgeHours: 2 * D },
  { key: "ai_cache", label: "AI cache", maxAgeHours: 1 * D },
  { key: "vendor_backfill", label: "Vendor backfill", maxAgeHours: 2 * H },
  { key: "worker_heartbeat", label: "Render worker heartbeat", maxAgeHours: 1 * H },
  { key: "analytics_markets", label: "Markets & returns file", maxAgeHours: 3 * D },
  { key: "analytics_auctions", label: "Treasury auctions file", maxAgeHours: 2 * D },
  { key: "analytics_hedge", label: "Hedge funds file", maxAgeHours: 8 * D },
  { key: "analytics_context", label: "Company context files", maxAgeHours: 2 * D },
  { key: "analytics_hq", label: "Head-office positions (supply globe)", maxAgeHours: 9 * D },
];

export type DataStatus = "fresh" | "stale" | "missing";
export interface DataFreshness { key: string; label: string; newest: string | null; ageHours: number | null; maxAgeHours: number; status: DataStatus }

/** Limit for one dataset at `now`: trading-day data also gets 24 h for each weekend day or market holiday since its newest record. */
export function effectiveLimitHours(c: DataCadence, newestMs: number, nowMs: number): number {
  return c.trading ? c.maxAgeHours + nonTradingHours(newestMs, nowMs) : c.maxAgeHours;
}

export function dataFreshness(rows: { key: string; newest: string | null }[], now = new Date()): DataFreshness[] {
  const by = new Map(rows.map((r) => [r.key, r.newest]));
  return DATA_CADENCE.map((c) => {
    const newest = by.get(c.key) ?? null;
    const t = newest ? Date.parse(newest) : NaN;
    const ageHours = Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : null;
    const limit = ageHours == null ? c.maxAgeHours : effectiveLimitHours(c, t, now.getTime());
    const status: DataStatus = ageHours == null ? "missing" : ageHours > limit ? "stale" : "fresh";
    return { key: c.key, label: c.label, newest, ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10, maxAgeHours: Math.round(limit), status };
  }).sort((a, b) => (a.status === b.status ? 0 : a.status === "fresh" ? 1 : b.status === "fresh" ? -1 : 0));
}

/**
 * Rows in job_state that are bookkeeping, not pauses a person acts on: per-item receipts, provider
 * circuits (shown on their own), alert episodes, remedy receipts, loop requests and the
 * filing-steps accession marker.
 */
export const BOOKKEEPING_JOB_RE = /^(filing-steps-fail:|form4-seen:|reports-due-fail:|provider:|alert:|alert-digest$|remedy:|loop-request:|estimates-none:|filing-steps-accn$|earnings-repair$|options-night$|[a-z-]+-slice$)/;
/** Reasons that are normal operation (owner choices, vendor pacing). */
export const ROUTINE_REASON_RE = /^(owner|pacing):/;

/** job_state pause reasons that a person should see (bookkeeping rows and routine reasons excluded). */
export function pausedJobs(rows: { job: string; paused_reason: string | null; updated_at: string }[]) {
  return rows
    .filter((r) => r.paused_reason && !BOOKKEEPING_JOB_RE.test(r.job) && !ROUTINE_REASON_RE.test(r.paused_reason))
    .map((r) => ({ job: r.job, reason: r.paused_reason!, since: r.updated_at }));
}

export interface PausedGroup {
  /** job, or the prefix of per-company rows (`ir-prose-runner`) */
  job: string;
  /** companies (or 1 for a single job) */
  count: number;
  /** the most recent reason */
  reason: string;
  /** most recent pause */
  since: string;
  /** up to five tickers for a per-company group */
  sample: string[];
}

/** Paused jobs with per-company rows (`<job>:<TICKER>`) folded into one line each: "ir-prose-runner: 134 companies". */
export function groupPaused(rows: { job: string; reason: string; since: string }[]): PausedGroup[] {
  const groups = new Map<string, PausedGroup>();
  for (const r of rows) {
    const m = /^(.+?):([A-Z0-9.-]+)$/.exec(r.job);
    const key = m ? m[1] : r.job;
    const g = groups.get(key) ?? { job: key, count: 0, reason: r.reason, since: r.since, sample: [] };
    g.count++;
    if (r.since > g.since) {
      g.since = r.since;
      g.reason = r.reason;
    }
    if (m && g.sample.length < 5) g.sample.push(m[2]);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.since.localeCompare(a.since));
}
