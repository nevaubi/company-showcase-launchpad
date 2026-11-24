/**
 * Pipeline status for the freshness page (pure): provider circuits, open alerts, job health with
 * problems first, rotation cursors that stopped moving, and the top-1,000 coverage table.
 */
import { decide, parseReason, PROVIDER_IDS, providerIdOf, type CircuitRow } from "./provider-health";
import { SOURCES } from "./freshness";
import { HTTP_JOBS } from "./reaper";
import type { HealthRow } from "./job-health";
import type { JobHealthRow, StateRow } from "./watchdog";

export interface ProviderStatus {
  id: string;
  state: "closed" | "open" | "probe";
  cls: string | null;
  message: string | null;
  /** when the row last changed (trip, probe or heal) */
  since: string | null;
  /** next probe (open only) */
  retryAt: string | null;
  failures: number;
}

/** One row per known provider (a provider never tripped reads closed). Open first, then probe, then closed. */
export function providerStatus(rows: readonly StateRow[], nowMs: number): ProviderStatus[] {
  const by = new Map(rows.filter((r) => providerIdOf(r.job)).map((r) => [providerIdOf(r.job)!, r]));
  const order = { open: 0, probe: 1, closed: 2 } as const;
  return PROVIDER_IDS.map((id) => {
    const row = by.get(id) as CircuitRow | undefined;
    const d = decide(row ?? null, nowMs);
    const p = parseReason(row?.paused_reason ?? null);
    return {
      id,
      state: d.state,
      cls: p?.cls ?? null,
      message: p?.message ?? null,
      since: row?.updated_at ?? null,
      retryAt: d.state === "open" && d.retryAt ? new Date(d.retryAt * 1000).toISOString() : null,
      failures: p?.failures ?? 0,
    };
  }).sort((a, b) => order[a.state] - order[b.state]);
}

export interface AlertStatus {
  key: string;
  title: string;
  sent: boolean;
  since: string;
}

export function openAlerts(rows: readonly StateRow[]): AlertStatus[] {
  return rows
    // A cleared episode waits out its recovery hold; it is not an open alert.
    .filter((r) => r.job.startsWith("alert:") && !(r.paused_reason ?? "").startsWith("cleared "))
    .map((r) => ({
      key: r.job.slice("alert:".length),
      title: (r.paused_reason ?? "").replace(/^(open|sent):\s*/, ""),
      sent: /^sent:/.test(r.paused_reason ?? ""),
      since: new Date(Number(r.cursor ?? 0) * 1000).toISOString(),
    }))
    .sort((a, b) => a.since.localeCompare(b.since));
}

export interface JobStatus extends HealthRow {
  label: string;
  kind: "http" | "worker";
  /** share of runs with no recorded finish, 0 to 1 */
  unfinishedShare: number;
  problem: "failing" | "unfinished" | "silent" | null;
}

const inMarketHours = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && d.getUTCHours() >= 13 && d.getUTCHours() <= 22;

/** Job health rows, labelled, problems first (failing, then unfinished, then silent), then by name. */
export function jobStatus(rows: readonly HealthRow[], nowMs: number, unread: readonly string[] = []): JobStatus[] {
  const notRead = new Set(unread);
  const src = new Map(SOURCES.map((s) => [s.job, s]));
  const rank = { failing: 0, unfinished: 1, silent: 2 } as const;
  const out: JobStatus[] = rows.map((r) => {
    const s = src.get(r.job);
    const runs = Number(r.runs) || 0;
    const unfinishedShare = runs ? Number(r.unfinished) / runs : 0;
    const loop = r.job.startsWith("loop:");
    const silentLimit = s && 3 * s.everyMin <= 24 * 60 && !(s.marketHours && !inMarketHours(new Date(nowMs))) ? 3 * s.everyMin * 60_000 : null;
    const silent = silentLimit != null && !notRead.has(r.job) && (!r.last_run || nowMs - Date.parse(r.last_run) > silentLimit);
    const problem = r.job !== "freshness" && Number(r.fail_streak) >= (loop ? 2 : 5) ? "failing" : runs >= 20 && unfinishedShare >= 0.3 ? "unfinished" : silent ? "silent" : null;
    return { ...r, runs, unfinished: Number(r.unfinished), failed: Number(r.failed), fail_streak: Number(r.fail_streak), label: s?.label ?? r.job, kind: HTTP_JOBS.includes(r.job) ? "http" : "worker", unfinishedShare, problem };
  });
  return out.sort((a, b) => (a.problem ? rank[a.problem] : 9) - (b.problem ? rank[b.problem] : 9) || a.job.localeCompare(b.job));
}

/** Unfinished share across all scheduled HTTP jobs (the scheduler cut-off rate). */
export function unfinishedRate(rows: readonly JobHealthRow[]): { runs: number; unfinished: number; share: number } {
  const http = rows.filter((r) => HTTP_JOBS.includes(r.job));
  const runs = http.reduce((n, r) => n + Number(r.runs), 0);
  const unfinished = http.reduce((n, r) => n + Number(r.unfinished), 0);
  return { runs, unfinished, share: runs ? unfinished / runs : 0 };
}

/** Rotation cursors: the job_state row a job moves only after stored work (commit-after-work, slice.ts). */
export const ROTATION_CURSORS: { job: string; source: string }[] = [
  { job: "prices", source: "prices" },
  { job: "macro", source: "macro" },
  { job: "sec", source: "sec" },
  { job: "alt-data", source: "alt-data" },
  { job: "filing-cache", source: "filing-cache" },
  { job: "options", source: "options" },
];

export interface StalledCursor {
  job: string;
  label: string;
  cursor: number;
  movedAt: string | null;
  /** expected to move within (minutes) */
  limitMin: number;
  /** attempts on the current slice (from `<job>-slice`) */
  attempts: number;
}

/** True inside the options schedule: 22:00-23:59 UTC Monday to Friday and 00:00-05:59 Tuesday to Saturday (review R13: weekend nights are not stalls). */
export function optionsScheduled(d: Date): boolean {
  const h = d.getUTCHours();
  const day = d.getUTCDay();
  return (h >= 22 && day >= 1 && day <= 5) || (h < 6 && day >= 2 && day <= 6);
}

/** Cursors that have not moved for three times their job's cadence (not counted while the job is not expected to run). */
export function stalledCursors(rows: readonly StateRow[], nowMs: number): StalledCursor[] {
  const by = new Map(rows.map((r) => [r.job, r]));
  const src = new Map(SOURCES.map((s) => [s.job, s]));
  const now = new Date(nowMs);
  const out: StalledCursor[] = [];
  for (const c of ROTATION_CURSORS) {
    const s = src.get(c.source);
    const row = by.get(c.job);
    if (!s || !row) continue;
    if (s.marketHours && !inMarketHours(now)) continue;
    // Options run 22:00 to 05:59 UTC on weekday nights only (cron: 22-23 Mon-Fri, 0-5 Tue-Sat).
    if (c.job === "options" && !optionsScheduled(now)) continue;
    const limitMin = c.job === "options" ? 30 : 3 * s.everyMin;
    const moved = row.updated_at ? Date.parse(row.updated_at) : 0;
    if (nowMs - moved <= limitMin * 60_000) continue;
    const tries = Number(by.get(`${c.job}-slice`)?.cursor ?? 0) % 10;
    out.push({ job: c.job, label: s.label, cursor: Number(row.cursor ?? 0), movedAt: row.updated_at, limitMin, attempts: tries });
  }
  return out;
}

export interface CoverageRow {
  dataset: string;
  top100: number;
  top500: number;
  top1000: number;
  median_age_hours: number | null;
  p90_age_hours: number | null;
}

/** Coverage rows, least covered of the top 1,000 first. */
export const coverageOrder = (rows: readonly CoverageRow[]) =>
  [...rows].map((r) => ({ ...r, top100: Number(r.top100), top500: Number(r.top500), top1000: Number(r.top1000), median_age_hours: r.median_age_hours == null ? null : Number(r.median_age_hours), p90_age_hours: r.p90_age_hours == null ? null : Number(r.p90_age_hours) })).sort((a, b) => a.top1000 - b.top1000 || a.dataset.localeCompare(b.dataset));

/** Plain names for the coverage table. */
export const DATASET_LABEL: Record<string, string> = {
  alt_attention: "Alt: attention",
  alt_events: "Alt: 8-K events",
  alt_ownership: "Alt: 13D/13G ownership",
  alt_regulatory: "Alt: Federal Register",
  alt_settlement: "Alt: fails to deliver",
  analyst_estimates: "Analyst estimates",
  earnings_events: "Earnings releases",
  filing_redlines: "Filing redlines",
  insider_trades: "Form 4 trades",
  ir_company_series: "IR series",
  ir_documents: "IR documents",
  ir_kpi_facts: "IR figures",
  ir_label_map: "IR label canon",
  market_bars: "Daily prices",
  options_daily: "Options",
  reports: "Reports",
  sec_filings: "SEC filings (60 days)",
  setup_signals: "Short-term setups",
  short_volume: "Short volume",
  supply_links: "Supply-chain links",
  supply_signals: "Supply intel",
  xbrl_concentration: "Filing detail (XBRL)",
};
