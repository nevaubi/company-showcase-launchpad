/**
 * Pure analytics over the OFR Hedge Fund Monitor and Treasury auction snapshots.
 * Every derived number names the published series it came from.
 */

export type Point = [string, number];

export interface SeriesStats {
  latest: Point;
  /** Value one year before the latest observation (nearest on/before). */
  yearAgo: Point | null;
  /** Change vs a year ago: pct for levels, absolute for percent/ratio/net-count series. */
  yoy: { pct?: number; abs?: number } | null;
  /** Standard score of the latest value vs the full history. */
  z: number | null;
  /** Share of history at or below the latest value, 0–100. */
  percentile: number;
  high: Point;
  low: Point;
  /** True when the latest value is the highest/lowest on record. */
  record: "high" | "low" | null;
  n: number;
}

const isRate = (unit: string) => /percent|ratio|count of respondents|net count/i.test(unit);

export function seriesStats(data: Point[], unit = ""): SeriesStats | null {
  if (!data.length) return null;
  const latest = data[data.length - 1];
  const vals = data.map((d) => d[1]);
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const z = n >= 8 && sd > 0 ? (latest[1] - mean) / sd : null;
  const percentile = (vals.filter((v) => v <= latest[1]).length / n) * 100;
  let high = data[0], low = data[0];
  for (const d of data) { if (d[1] > high[1]) high = d; if (d[1] < low[1]) low = d; }
  const target = new Date(`${latest[0]}T00:00:00Z`); target.setUTCFullYear(target.getUTCFullYear() - 1);
  const tIso = target.toISOString().slice(0, 10);
  let yearAgo: Point | null = null;
  for (let i = data.length - 2; i >= 0; i--) if (data[i][0] <= tIso) { yearAgo = data[i]; break; }
  let yoy: SeriesStats["yoy"] = null;
  if (yearAgo) {
    if (isRate(unit) || yearAgo[1] <= 0 || latest[1] < 0) yoy = { abs: latest[1] - yearAgo[1] };
    else yoy = { pct: (latest[1] / yearAgo[1] - 1) * 100 };
  }
  const record = n >= 8 && latest === high ? "high" : n >= 8 && latest === low ? "low" : null;
  return { latest, yearAgo, yoy, z, percentile, high, low, record, n };
}

/** Divide two aligned series by date (only dates present in both). */
export function ratioSeries(a: Point[], b: Point[]): Point[] {
  const m = new Map(b.map(([d, v]) => [d, v]));
  return a.filter(([d]) => m.has(d) && m.get(d) !== 0).map(([d, v]) => [d, v / m.get(d)!]);
}

/** Sum aligned series by date (only dates present in all). */
export function sumSeries(list: Point[][]): Point[] {
  if (!list.length) return [];
  const maps = list.slice(1).map((s) => new Map(s));
  return list[0].filter(([d]) => maps.every((m) => m.has(d))).map(([d, v]) => [d, maps.reduce((a, m) => a + m.get(d)!, v)]);
}

export interface Unusual { m: string; name: string; z: number; percentile: number; record: "high" | "low" | null; date: string }

/**
 * Most unusual latest readings across many series: |z| ranked, records first,
 * ignoring stale series (latest older than `staleBefore`) and short histories.
 */
export function mostUnusual(
  series: { m: string; name: string; unit: string; data: Point[] }[],
  staleBefore: string,
  limit = 20,
): Unusual[] {
  const out: Unusual[] = [];
  for (const s of series) {
    const st = seriesStats(s.data, s.unit);
    if (!st || st.z == null || st.latest[0] < staleBefore || st.n < 12) continue;
    out.push({ m: s.m, name: s.name, z: st.z, percentile: st.percentile, record: st.record, date: st.latest[0] });
  }
  return out.sort((a, b) => Number(!!b.record) - Number(!!a.record) || Math.abs(b.z) - Math.abs(a.z)).slice(0, limit);
}

/**
 * Crowding composite: average z-score of the inputs, each signed so that
 * "more crowded / more fragile" is positive. Returns null with fewer than 2 inputs.
 */
export function composite(parts: { z: number | null; sign: 1 | -1 }[]): number | null {
  const zs = parts.filter((p) => p.z != null).map((p) => p.z! * p.sign);
  return zs.length >= 2 ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
}

export function zLabel(z: number | null): string {
  if (z == null) return "n/a";
  const a = Math.abs(z);
  return a >= 2 ? (z > 0 ? "extreme high" : "extreme low") : a >= 1 ? (z > 0 ? "elevated" : "depressed") : "normal";
}

// ---------------- Treasury auctions ----------------

export interface Auction {
  date: string;
  term: string;
  type: string;
  cusip: string;
  /** High (stop-out) yield or discount rate, percent. */
  rate: number | null;
  btc: number | null;
  /** Shares of competitive accepted, percent. */
  indirect: number | null;
  direct: number | null;
  dealer: number | null;
  amount: number;
  /** Term as printed (reopenings show remaining life). */
  printedTerm?: string;
}

export interface AuctionRead extends Auction {
  /** Averages over the prior `window` auctions of the same term. */
  avgBtc: number | null;
  avgIndirect: number | null;
  avgDealer: number | null;
  /** Demand score: positive = stronger than recent auctions of this term. */
  score: number | null;
  verdict: "strong" | "weak" | "average" | null;
}

const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/**
 * Compare each auction to the previous `window` auctions of the same term.
 * Score = (bid-to-cover − avg) × 10 + (indirect − avg)/2 − (dealer − avg)/2;
 * dealers absorbing more = weaker demand. |score| ≥ 3 → strong/weak.
 */
export function readAuctions(list: Auction[], window = 6): AuctionRead[] {
  const byTerm = new Map<string, Auction[]>();
  for (const a of [...list].sort((x, y) => (x.date < y.date ? -1 : 1))) {
    const k = `${a.type}|${a.term}`;
    if (!byTerm.has(k)) byTerm.set(k, []);
    byTerm.get(k)!.push(a);
  }
  const out: AuctionRead[] = [];
  for (const arr of byTerm.values()) {
    arr.forEach((a, i) => {
      const prev = arr.slice(Math.max(0, i - window), i);
      const avgBtc = avg(prev.map((p) => p.btc)), avgIndirect = avg(prev.map((p) => p.indirect)), avgDealer = avg(prev.map((p) => p.dealer));
      let score: number | null = null;
      if (prev.length >= 3 && a.btc != null && avgBtc != null && a.indirect != null && avgIndirect != null && a.dealer != null && avgDealer != null) {
        score = (a.btc - avgBtc) * 10 + (a.indirect - avgIndirect) / 2 - (a.dealer - avgDealer) / 2;
      }
      out.push({ ...a, avgBtc, avgIndirect, avgDealer, score, verdict: score == null ? null : score >= 3 ? "strong" : score <= -3 ? "weak" : "average" });
    });
  }
  return out.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}
