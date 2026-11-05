// Pure alt-data signal math. Input: event counts per (ticker, dataset) in 90-day buckets
// counted back from today (bucket 0 = last 90 days, 1 = 90–180 days ago, …, 8).

export interface Bucket { ticker: string; dataset: string; bucket: number; n: number; last_date: string | null }

export interface Signal {
  ticker: string;
  dataset: string;
  recent: number;      // events in the last 90 days
  baseline: number;    // mean events per 90 days over the prior 8 windows
  z: number;           // (recent − baseline) / spread
  ratio: number | null; // recent / baseline
  lastDate: string | null;
  history: number[];   // oldest → newest, 9 windows
}

export const WINDOWS = 9;

/** Activity vs each company's own history. Spread floors at √baseline (Poisson) and 1 so rare series don't explode. */
export function computeSignals(rows: Bucket[]): Signal[] {
  const m = new Map<string, { h: number[]; last: string | null; ticker: string; dataset: string }>();
  for (const r of rows) {
    if (r.bucket < 0 || r.bucket >= WINDOWS) continue;
    const k = `${r.ticker}|${r.dataset}`;
    const e = m.get(k) ?? { h: Array(WINDOWS).fill(0), last: null, ticker: r.ticker, dataset: r.dataset };
    e.h[WINDOWS - 1 - r.bucket] += Number(r.n);
    if (r.last_date && (!e.last || r.last_date > e.last)) e.last = r.last_date;
    m.set(k, e);
  }
  return [...m.values()].map(({ h, last, ticker, dataset }) => {
    const recent = h[WINDOWS - 1];
    const prior = h.slice(0, WINDOWS - 1);
    const baseline = prior.reduce((a, b) => a + b, 0) / prior.length;
    const sd = Math.sqrt(prior.reduce((a, b) => a + (b - baseline) ** 2, 0) / prior.length);
    const spread = Math.max(sd, Math.sqrt(baseline), 1);
    return { ticker, dataset, recent, baseline, z: (recent - baseline) / spread, ratio: baseline > 0 ? recent / baseline : null, lastDate: last, history: h };
  });
}

/** Biggest unusual moves: needs at least `minRecent` events or a clear drop from a busy baseline. */
export function topChanges(signals: Signal[], limit = 12, minRecent = 2): Signal[] {
  return signals
    .filter((s) => (s.z >= 1.5 && s.recent >= minRecent) || (s.z <= -1.5 && s.baseline >= 3))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z) || b.recent - a.recent)
    .slice(0, limit);
}

export function signalLabel(s: Signal): string {
  if (s.baseline === 0) return s.recent ? `${s.recent} new — none in the prior 2 years` : "quiet";
  const r = s.recent / s.baseline;
  return r >= 1 ? `${r.toFixed(1)}× its usual pace` : `${Math.round((1 - r) * 100)}% below its usual pace`;
}

/** Heat bucket for a z-score: −2..+3. */
export function heat(z: number): number {
  return z >= 3 ? 3 : z >= 2 ? 2 : z >= 1 ? 1 : z <= -2 ? -2 : z <= -1 ? -1 : 0;
}

/** 8-K items that usually matter to the stock. */
export const RED_FLAG_ITEMS: Record<string, string> = {
  "1.03": "Bankruptcy", "1.05": "Cyber incident", "2.06": "Impairment", "4.01": "Auditor change",
  "4.02": "Restatement", "3.01": "Listing notice", "1.01": "Material agreement", "2.01": "Acquisition/disposal",
  "5.02": "Executive change",
};
