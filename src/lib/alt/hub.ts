// What is unusual now across every covered company, by the same rules the company tab uses
// (`countVerdict` for event counts, `seriesFlag` for series). Pure.
import { countVerdict } from "@/lib/alt/derive";
import { seriesFlag, type CompanyAltRow, type Flag } from "@/lib/alt/company";
import { BASELINE_WINDOWS, NO_SIGNAL, WINDOWS } from "@/lib/alt/signals";
import { FTD_TITLE } from "@/lib/alt/ftd";
import type { EventBucket } from "@/lib/alt/screen";

export interface UnusualItem {
  ticker: string;
  dataset: string;
  direction: "up" | "down";
  text: string;
  /** |z| against the company's own history; the ranking key */
  z: number;
  date: string | null;
  rule: string;
  /** windows oldest first, for a spark (event counts only) */
  history?: number[];
}

const NOUN: Record<string, [string, string]> = {
  events: ["8-K item", "8-K items"], ownership: ["13D/G filing", "13D/G filings"], capital: ["capital-markets filing", "capital-markets filings"],
  regulatory: ["Federal Register document", "Federal Register documents"], contracts: ["award action", "award actions"], fda: ["FDA record", "FDA records"],
  recalls: ["recall campaign", "recall campaigns"], consumer: ["recall", "recalls"],
};

/** Event-count verdicts for every company × dataset in the 90-day buckets; also how many were only new coverage. */
export function unusualFromBuckets(buckets: EventBucket[]): { items: UnusualItem[]; newCoverage: number } {
  const m = new Map<string, { h: number[]; last: string | null; ticker: string; dataset: string }>();
  for (const b of buckets) {
    if (b.bucket < 0 || b.bucket >= WINDOWS || NO_SIGNAL.has(b.dataset)) continue;
    const k = `${b.ticker}|${b.dataset}`;
    const e = m.get(k) ?? { h: Array(WINDOWS).fill(0), last: null, ticker: b.ticker, dataset: b.dataset };
    e.h[WINDOWS - 1 - b.bucket] += Number(b.n);
    if (b.last_date && (!e.last || b.last_date > e.last)) e.last = b.last_date;
    m.set(k, e);
  }
  let newCoverage = 0;
  const items: UnusualItem[] = [];
  for (const e of m.values()) {
    const v = countVerdict(e.h, { maxPrior: BASELINE_WINDOWS[e.dataset] });
    if (v.status === "new" && v.recent >= 3) newCoverage++;
    if (v.status !== "spike" && v.status !== "drop") continue;
    const [one, many] = NOUN[e.dataset] ?? ["record", "records"];
    items.push({
      ticker: e.ticker, dataset: e.dataset, direction: v.status === "spike" ? "up" : "down", z: Math.abs(v.z), date: e.last, history: e.h,
      text: `${v.recent} ${v.recent === 1 ? one : many} in 90 days; normal ${v.baseline.toFixed(1)}`,
      rule: `Normal = mean per 90 days over the prior ${v.prior * 3} months; Poisson tail p = ${v.p < 0.0001 ? v.p.toExponential(1) : v.p.toFixed(4)}, z = ${v.z.toFixed(1)}`,
    });
  }
  return { items, newCoverage };
}

export interface SeriesWatch {
  dataset: string;
  title: string;
  what: string;
  log?: boolean;
  window: number;
  floor?: number;
  minValue?: number;
  upOnly?: boolean;
  /** pre-screen on the leaderboard: latest ÷ trailing-year median at least this (log series) */
  ratio?: number;
  /** pre-screen for rates: latest − trailing-year median at least this */
  diff?: number;
}

/** Series checked across all companies. The leaderboard pre-screens; the full rule confirms. */
export const SERIES_WATCH: SeriesWatch[] = [
  { dataset: "settlement", title: FTD_TITLE, what: "Fails to deliver averaged", log: true, window: 24, minValue: 1e6, upOnly: true, ratio: 3 },
  { dataset: "attention", title: "Wikipedia pageviews", what: "Pageviews", log: true, window: 12, minValue: 1e4, ratio: 1.8 },
  { dataset: "bank", title: "Net charge-off rate", what: "Net charge-off rate", window: 8, floor: 0.02, upOnly: true, diff: 0.15 },
  { dataset: "bank", title: "Noncurrent loans / loans", what: "Noncurrent loans / loans", window: 8, floor: 0.02, upOnly: true, diff: 0.2 },
];

/** Companies whose latest reading stands far enough from their trailing-year median to be worth the full test. */
export function seriesCandidates(leaders: { ticker: string; value: number; base_median: number | null; base_n: number | null }[], w: SeriesWatch, limit = 60): string[] {
  return leaders
    .filter((r) => r.base_median != null && (r.base_n ?? 0) >= 3 && (w.minValue == null || Math.abs(r.value) >= w.minValue))
    .map((r) => ({ t: r.ticker, s: w.ratio ? r.value / Math.max(r.base_median!, 1e-9) : r.value - r.base_median! }))
    .filter((x) => (w.ratio ? x.s >= w.ratio || (!w.upOnly && x.s <= 1 / w.ratio) : x.s >= (w.diff ?? 0)))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.t);
}

/** Confirm candidates with the company tab's own series rule. */
export function confirmSeries(rows: CompanyAltRow[], w: SeriesWatch, today: string): UnusualItem[] {
  const by = new Map<string, CompanyAltRow[]>();
  for (const r of rows) if (r.title === w.title && r.value != null && r.date) (by.get(r.ticker) ?? by.set(r.ticker, []).get(r.ticker)!).push(r);
  const out: UnusualItem[] = [];
  for (const [ticker, rs] of by) {
    rs.sort((a, b) => a.date!.localeCompare(b.date!));
    const f: Flag | undefined = seriesFlag(w.dataset, rs, today, { log: w.log, window: w.window, floor: w.floor, minValue: w.minValue, upOnly: w.upOnly, what: w.what });
    if (f) out.push({ ticker, dataset: w.dataset, direction: f.direction, text: f.text, z: f.score, date: f.date, rule: f.rule });
  }
  return out;
}

/** Rank everything unusual: largest |z| first, then newest. */
export function rankUnusual(items: UnusualItem[]): UnusualItem[] {
  return [...items].sort((a, b) => b.z - a.z || (b.date ?? "").localeCompare(a.date ?? ""));
}
