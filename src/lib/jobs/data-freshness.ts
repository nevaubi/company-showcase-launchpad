// Data-advance freshness: did the newest data row move within its expected cadence (not merely "did a
// job run")? Rows come from the `data_freshness()` database function (aggregated in SQL). Pure.

export interface DataCadence { key: string; label: string; maxAgeHours: number; /** dates are trading days: allow weekends/holidays */ trading?: boolean }

const H = 1, D = 24;
export const DATA_CADENCE: DataCadence[] = [
  { key: "market_bars", label: "Prices (SPY daily bar)", maxAgeHours: 4 * D, trading: true },
  { key: "macro", label: "Macro (10y yield)", maxAgeHours: 5 * D, trading: true },
  { key: "sec_filings", label: "SEC filings", maxAgeHours: 4 * D, trading: true },
  { key: "sec_discover", label: "SEC market-wide discovery run", maxAgeHours: 2 * H },
  { key: "insider_trades", label: "Form 4 trades", maxAgeHours: 5 * D, trading: true },
  { key: "earnings_events", label: "Earnings releases (8-K 2.02)", maxAgeHours: 7 * D },
  { key: "filing_documents", label: "Filing document cache", maxAgeHours: 2 * D },
  { key: "alt_events", label: "Alt data: 8-K events", maxAgeHours: 5 * D },
  { key: "alt_ownership", label: "Alt data: 13D/13G ownership", maxAgeHours: 14 * D },
  { key: "alt_contracts", label: "Alt data: federal contracts", maxAgeHours: 21 * D },
  { key: "alt_recalls", label: "Alt data: recalls", maxAgeHours: 30 * D },
  { key: "alt_settlement", label: "Alt data: fails to deliver", maxAgeHours: 35 * D },
  { key: "alt_medicare", label: "Alt data: Medicare spending", maxAgeHours: 40 * D },
  { key: "analyst_estimates", label: "Analyst estimates", maxAgeHours: 1 * D },
  { key: "options_daily", label: "Options (Cboe)", maxAgeHours: 4 * D, trading: true },
  { key: "short_volume", label: "Short volume (FINRA)", maxAgeHours: 4 * D, trading: true },
  { key: "setup_results", label: "Short-term setups", maxAgeHours: 4 * D, trading: true },
  { key: "paper_bots", label: "Paper autopilots", maxAgeHours: 4 * D, trading: true },
  { key: "ir_documents", label: "IR documents", maxAgeHours: 2 * D },
  { key: "ir_kpi_facts", label: "IR figures", maxAgeHours: 1 * D },
  { key: "ir_company_series", label: "IR series payloads", maxAgeHours: 2 * D },
  { key: "ir_label_map", label: "IR label canon", maxAgeHours: 3 * D },
  { key: "partner_mirror", label: "Partner IR mirror", maxAgeHours: 7 * D },
  { key: "partner_mirror_job", label: "Partner dataset mirror run", maxAgeHours: 1 * D },
  { key: "universe", label: "Universe file", maxAgeHours: 7 * D },
  { key: "xbrl_concentration", label: "Filing detail (XBRL)", maxAgeHours: 14 * D },
  { key: "supply_links", label: "Supply-chain links", maxAgeHours: 7 * D },
  { key: "supply_signals", label: "Supply intel", maxAgeHours: 8 * D },
  { key: "filing_redlines", label: "Filing redlines", maxAgeHours: 2 * D },
  { key: "reports", label: "Reports", maxAgeHours: 2 * D },
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

export function dataFreshness(rows: { key: string; newest: string | null }[], now = new Date()): DataFreshness[] {
  const by = new Map(rows.map((r) => [r.key, r.newest]));
  return DATA_CADENCE.map((c) => {
    const newest = by.get(c.key) ?? null;
    const ageHours = newest ? (now.getTime() - Date.parse(newest)) / 3_600_000 : null;
    const status: DataStatus = ageHours == null ? "missing" : ageHours > c.maxAgeHours ? "stale" : "fresh";
    return { key: c.key, label: c.label, newest, ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10, maxAgeHours: c.maxAgeHours, status };
  }).sort((a, b) => (a.status === b.status ? 0 : a.status === "fresh" ? 1 : b.status === "fresh" ? -1 : 0));
}

/** job_state pause reasons that a person should see (per-item receipts excluded). */
export function pausedJobs(rows: { job: string; paused_reason: string | null; updated_at: string }[]) {
  return rows.filter((r) => r.paused_reason && !/^(filing-steps-fail:|form4-seen:)/.test(r.job) && !/^owner:/.test(r.paused_reason)).map((r) => ({ job: r.job, reason: r.paused_reason!, since: r.updated_at }));
}
