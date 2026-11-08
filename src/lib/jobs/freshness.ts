// Data freshness rules for the admin view. Pure: takes job runs, returns a status per source.

export interface FreshnessSource {
  job: string;
  label: string;
  /** Expected minutes between runs. */
  everyMin: number;
  /** Only expected to run on weekdays 13:00–22:59 UTC (US market hours). */
  marketHours?: boolean;
}

export const SOURCES: FreshnessSource[] = [
  { job: "prices", label: "Prices", everyMin: 6, marketHours: true },
  { job: "sec", label: "SEC filings & Form 4", everyMin: 6 },
  { job: "macro", label: "Macro (FRED, Treasury)", everyMin: 10 },
  { job: "filing-cache", label: "Filing documents", everyMin: 15 },
  { job: "ir-docs", label: "IR documents", everyMin: 5 },
  { job: "estimates", label: "Analyst estimates", everyMin: 60 },
  { job: "alt-data", label: "Alt data", everyMin: 3 },
];

export interface Run {
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  items: number;
}

export type FreshStatus = "on-time" | "late" | "failing" | "never";

export interface Freshness {
  source: FreshnessSource;
  status: FreshStatus;
  lastOk: string | null;
  lastRun: string | null;
  itemsDay: number;
}

const inMarketHours = (d: Date) => {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  return day >= 1 && day <= 5 && h >= 13 && h <= 22;
};

/** Late = last success older than 2× the cadence; failing = the last 3 finished runs all errored. */
export function freshnessOf(source: FreshnessSource, runs: Run[], now = new Date()): Freshness {
  const mine = runs.filter((r) => r.job === source.job).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const finished = mine.filter((r) => r.finished_at);
  const lastOk = finished.find((r) => r.ok)?.started_at ?? null;
  const dayAgo = now.getTime() - 86400000;
  const itemsDay = finished.filter((r) => r.ok && Date.parse(r.started_at) >= dayAgo).reduce((s, r) => s + r.items, 0);
  const base = { source, lastOk, lastRun: mine[0]?.started_at ?? null, itemsDay };
  if (!mine.length) return { ...base, status: "never" };
  const last3 = finished.slice(0, 3);
  if (last3.length === 3 && last3.every((r) => r.ok === false)) return { ...base, status: "failing" };
  const expected = !source.marketHours || inMarketHours(now);
  const age = lastOk ? now.getTime() - Date.parse(lastOk) : Infinity;
  if (expected && age > 2 * source.everyMin * 60000) return { ...base, status: "late" };
  return { ...base, status: "on-time" };
}

const RANK: Record<FreshStatus, number> = { failing: 0, late: 1, never: 2, "on-time": 3 };

/** Every source, problems first. */
export function freshnessReport(runs: Run[], now = new Date()): Freshness[] {
  return SOURCES.map((s) => freshnessOf(s, runs, now)).sort((a, b) => RANK[a.status] - RANK[b.status]);
}
