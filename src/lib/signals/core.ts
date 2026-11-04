// Trade-idea signals. Every signal is computed point-in-time (only prices up to the date and
// fundamentals already filed by then), so the same rules can be replayed over history to show
// how often they worked. Pure: shared by scripts/signals.ts, the app and tests.
import type { Bar, Cell, CompanyDataset, DerivedPart, InsiderTrade, SourceRef } from "../financials/types";
import { valuationHistory, type MultipleKey } from "../financials/valuation";

export type SignalKind = "cheap" | "rich" | "accel" | "decel" | "insiderBuy" | "pullback" | "breakdown";
export type Direction = "long" | "short";

export const SIGNAL_META: Record<SignalKind, { label: string; dir: Direction; rule: string }> = {
  cheap: { label: "Cheap vs own history", dir: "long", rule: "Multiple in the bottom 15% of its trailing 5-year range (point-in-time)" },
  rich: { label: "Stretched vs own history", dir: "short", rule: "Multiple in the top 10% of its trailing 5-year range (point-in-time)" },
  accel: { label: "Revenue accelerating", dir: "long", rule: "Year-over-year revenue growth up ≥3 pts vs the prior quarter, and positive" },
  decel: { label: "Revenue decelerating", dir: "short", rule: "Year-over-year revenue growth down ≥5 pts vs the prior quarter" },
  insiderBuy: { label: "Insider cluster buying", dir: "long", rule: "2+ different insiders bought on the open market (not a 10b5-1 plan) within 90 days" },
  pullback: { label: "Pullback in uptrend", dir: "long", rule: "14-day RSI below 35 while price holds above its 200-day average" },
  breakdown: { label: "Trend breakdown", dir: "short", rule: "Price crossed below its 200-day average with the 50-day average falling" },
};

export interface Evidence {
  label: string;
  value: number;
  unit: string;
  periodLabel?: string;
  src?: SourceRef;
  derived?: { formula: string; parts: DerivedPart[] };
  /** Whole document (Form 4) */
  doc?: { accn: string; doc: string; form: string; filed: string; title: string };
}

export interface Signal {
  kind: SignalKind;
  detail: string;
  evidence: Evidence[];
}

export interface BacktestStats {
  /** Number of historical (non-overlapping) firings */
  n: number;
  /** Mean forward return of the stock, in the signal's direction */
  avg: number | null;
  /** Mean forward return relative to SPY, in the signal's direction */
  avgExcess: number | null;
  /** Share of firings that beat SPY in the signal's direction */
  hitRate: number | null;
}

export const HORIZON_DAYS = 63; // ~3 months of trading days

const iso = (s: string) => s.slice(0, 10);

export function smaAt(closes: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += closes[k];
  return s / n;
}

export function rsiAt(closes: number[], i: number, n = 14): number | null {
  if (i < n) return null;
  let g = 0;
  let l = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const d = closes[k] - closes[k - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

export function atrAt(bars: Bar[], i: number, n = 14): number | null {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const [, , h, lo] = bars[k];
    const pc = bars[k - 1][4];
    s += Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc));
  }
  return s / n;
}

/** Technical signals on day i. */
export function technicalSignals(bars: Bar[], i: number): Signal[] {
  const closes = bars.map((b) => b[4]);
  const out: Signal[] = [];
  const s200 = smaAt(closes, i, 200);
  const r = rsiAt(closes, i);
  if (s200 != null && r != null && r < 35 && closes[i] > s200) {
    out.push({ kind: "pullback", detail: `RSI ${r.toFixed(0)} with price ${((closes[i] / s200 - 1) * 100).toFixed(1)}% above the 200-day average`, evidence: [] });
  }
  const p200 = smaAt(closes, i - 1, 200);
  const s50 = smaAt(closes, i, 50);
  const s50prev = smaAt(closes, i - 10, 50);
  if (s200 != null && p200 != null && s50 != null && s50prev != null && closes[i] < s200 && closes[i - 1] >= p200 && s50 < s50prev) {
    out.push({ kind: "breakdown", detail: `Closed below the 200-day average (${s200.toFixed(2)}) with the 50-day average falling`, evidence: [] });
  }
  return out;
}

/** Valuation percentile signal from a point-in-time multiple series (values up to and including idx). */
export function valuationSignal(series: { date: string; v: number | null; basis: string }[], idx: number, label: string): (Signal & { pct: number }) | null {
  const cur = series[idx]?.v;
  if (cur == null || !(cur > 0)) return null;
  const from = new Date(new Date(series[idx].date).getTime() - 5 * 365 * 86400000).toISOString().slice(0, 10);
  const hist: number[] = [];
  for (let k = 0; k <= idx; k++) {
    const p = series[k];
    if (p.date >= from && p.v != null && p.v > 0) hist.push(p.v);
  }
  if (hist.length < 104) return null; // need ~2 years of weekly history
  const pct = hist.filter((x) => x <= cur).length / hist.length;
  const sorted = [...hist].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const detail = `${label} ${cur.toFixed(1)}× vs 5-year median ${med.toFixed(1)}× (${Math.round(pct * 100)}th percentile, ${series[idx].basis} fundamentals)`;
  if (pct <= 0.15) return { kind: "cheap", detail, evidence: [], pct };
  if (pct >= 0.9) return { kind: "rich", detail, evidence: [], pct };
  return null;
}

interface QuarterGrowth {
  available: string;
  label: string;
  growth: number;
  prevGrowth: number;
  cells: { label: string; cell: Cell; periodLabel: string }[];
}

/** Year-over-year revenue growth per quarter, with the four sourced cells behind each comparison. */
export function revenueGrowthTimeline(d: CompanyDataset): QuarterGrowth[] {
  const inc = d.statements.quarterly.income;
  if (!inc) return [];
  const row = inc.rows.find((r) => r.key === "revenue");
  if (!row) return [];
  const filed = new Map(d.filings.map((f) => [f.accn, f.filed]));
  const periods = inc.periods;
  const out: QuarterGrowth[] = [];
  for (let i = 5; i < periods.length; i++) {
    const c = row.cells[i];
    const cy = row.cells[i - 4];
    const p = row.cells[i - 1];
    const py = row.cells[i - 5];
    if (!c || !cy || !p || !py || !(cy.v > 0) || !(py.v > 0)) continue;
    const accn = c.src?.accn ?? c.derived?.parts[0]?.accn;
    const avail = (accn && filed.get(accn)) || null;
    if (!avail) continue;
    out.push({
      available: avail,
      label: periods[i].label,
      growth: c.v / cy.v - 1,
      prevGrowth: p.v / py.v - 1,
      cells: [
        { label: "Revenue", cell: c, periodLabel: periods[i].label },
        { label: "Revenue, year earlier", cell: cy, periodLabel: periods[i - 4].label },
        { label: "Revenue, prior quarter", cell: p, periodLabel: periods[i - 1].label },
        { label: "Revenue, prior quarter year earlier", cell: py, periodLabel: periods[i - 5].label },
      ],
    });
  }
  return out.sort((a, b) => (a.available < b.available ? -1 : 1));
}

const pct1 = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export function growthSignal(q: QuarterGrowth): Signal | null {
  const delta = q.growth - q.prevGrowth;
  const evidence: Evidence[] = q.cells.map(({ label, cell, periodLabel }) => ({ label, value: cell.v, unit: "USD", periodLabel, src: cell.src, derived: cell.derived }));
  const detail = `${q.label} revenue growth ${pct1(q.growth)} year over year, vs ${pct1(q.prevGrowth)} the quarter before`;
  if (delta >= 0.03 && q.growth > 0) return { kind: "accel", detail, evidence };
  if (delta <= -0.05) return { kind: "decel", detail, evidence };
  return null;
}

/** Open-market purchases by 2+ distinct insiders within the 90 days ending on `date`. */
export function insiderSignal(trades: InsiderTrade[], date: string): Signal | null {
  const from = new Date(new Date(date).getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const buys = trades.filter((t) => t.code === "P" && !t.plan10b5 && t.date >= from && t.date <= date);
  const owners = new Set(buys.map((b) => b.owner));
  if (owners.size < 2) return null;
  const value = buys.reduce((s, b) => s + b.shares * (b.price ?? 0), 0);
  return {
    kind: "insiderBuy",
    detail: `${owners.size} insiders bought ${buys.length} times in 90 days, about $${(value / 1e6).toFixed(1)}M in total`,
    evidence: buys.slice(0, 8).map((b) => ({
      label: `${b.owner} (${b.role || "insider"}) bought`,
      value: b.shares,
      unit: "shares",
      periodLabel: b.date,
      doc: { accn: b.accn, doc: b.doc, form: "4", filed: b.filed, title: `Form 4 — ${b.owner}` },
    })),
  };
}

export interface ScanInput {
  ticker: string;
  dataset: CompanyDataset;
  bars: Bar[];
  bank: boolean;
  spy: Bar[];
}

export interface Idea {
  ticker: string;
  name: string;
  sector: string;
  asOf: string;
  price: number;
  direction: Direction;
  /** Aligned signals minus opposing ones */
  score: number;
  /** stats: pooled over every covered company; own: this company only */
  signals: (Signal & { stats: BacktestStats; own: BacktestStats })[];
  /** Mechanical risk plan: stop 2×ATR(14), target 2× the risk */
  plan: { entry: number; stop: number; target: number; atr: number };
  multiple: MultipleKey;
}

function forward(bars: Bar[], i: number, spyIdx: Map<string, number>, spy: Bar[], dir: Direction) {
  const j = i + HORIZON_DAYS;
  if (j >= bars.length) return null;
  const r = bars[j][4] / bars[i][4] - 1;
  const si = spyIdx.get(iso(bars[i][0]));
  const sj = spyIdx.get(iso(bars[j][0]));
  const sr = si != null && sj != null ? spy[sj][4] / spy[si][4] - 1 : null;
  const sign = dir === "long" ? 1 : -1;
  return { ret: sign * r, excess: sr == null ? null : sign * (r - sr) };
}

export function summarize(samples: { ret: number; excess: number | null }[]): BacktestStats {
  if (!samples.length) return { n: 0, avg: null, avgExcess: null, hitRate: null };
  const ex = samples.map((s) => s.excess).filter((x): x is number => x != null);
  return {
    n: samples.length,
    avg: samples.reduce((a, s) => a + s.ret, 0) / samples.length,
    avgExcess: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null,
    hitRate: ex.length ? ex.filter((x) => x > 0).length / ex.length : null,
  };
}

/** Index of the last bar on or before date. */
function barAt(dates: string[], date: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (dates[m] <= date) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans;
}

export interface CompanyScan {
  current: Signal[];
  /** Historical forward-return samples by signal (non-overlapping firings) */
  samples: Partial<Record<SignalKind, { ret: number; excess: number | null; date: string }[]>>;
  multiple: MultipleKey;
}

/** Current signals plus a point-in-time replay of every rule over the price history. */
export function scanCompany({ dataset, bars, bank, spy }: ScanInput): CompanyScan {
  const samples: CompanyScan["samples"] = {};
  const dates = bars.map((b) => iso(b[0]));
  const spyIdx = new Map(spy.map((b, k) => [iso(b[0]), k]));
  const lastFire: Partial<Record<SignalKind, number>> = {};
  const add = (kind: SignalKind, i: number) => {
    // non-overlapping: ignore re-firings within one horizon of the last counted firing
    if (lastFire[kind] != null && i - lastFire[kind]! < HORIZON_DAYS) return;
    const f = forward(bars, i, spyIdx, spy, SIGNAL_META[kind].dir);
    if (!f) return;
    lastFire[kind] = i;
    (samples[kind] ??= []).push({ ...f, date: dates[i] });
  };
  const current: Signal[] = [];
  const last = bars.length - 1;

  // Technicals, daily
  for (let i = 200; i <= last; i++) {
    for (const s of technicalSignals(bars, i)) {
      add(s.kind, i);
      if (i === last) current.push(s);
    }
  }

  // Valuation, weekly
  const multiple: MultipleKey = bank ? "pe" : "evEbitda";
  const label = bank ? "P/E" : "EV/EBITDA";
  const vh = valuationHistory(dataset, bars, bank);
  const series = vh.map((p) => ({ date: p.date, v: p.values[multiple] ?? null, basis: p.basis }));
  for (let k = 0; k < series.length; k++) {
    const s = valuationSignal(series, k, label);
    if (!s) continue;
    const i = barAt(dates, series[k].date);
    if (i >= 0) add(s.kind, i);
  }
  const lastVal = series.length ? valuationSignal(series, series.length - 1, label) : null;
  // only "current" if the latest weekly point is recent
  if (lastVal && series[series.length - 1].date >= dates[Math.max(0, last - 7)]) current.push({ kind: lastVal.kind, detail: lastVal.detail, evidence: lastVal.evidence });

  // Revenue growth, on each quarter's filing date
  const growth = revenueGrowthTimeline(dataset);
  for (const q of growth) {
    const s = growthSignal(q);
    if (!s) continue;
    const i = barAt(dates, q.available);
    if (i >= 0 && dates[i] >= q.available.slice(0, 10)) add(s.kind, i);
    else if (i >= 0 && i + 1 <= last) add(s.kind, i + 1);
  }
  const latestQ = growth[growth.length - 1];
  if (latestQ) {
    const age = (new Date(dates[last]).getTime() - new Date(latestQ.available).getTime()) / 86400000;
    const s = growthSignal(latestQ);
    if (s && age <= 100) current.push(s);
  }

  // Insiders (history is short, so stats are usually thin)
  const ins = insiderSignal(dataset.insiders, dates[last]);
  if (ins) current.push(ins);

  return { current, samples, multiple };
}

export function buildIdea(t: ScanInput, scan: CompanyScan, pooled: Partial<Record<SignalKind, BacktestStats>>): Idea | null {
  if (!scan.current.length) return null;
  const longs = scan.current.filter((s) => SIGNAL_META[s.kind].dir === "long").length;
  const shorts = scan.current.length - longs;
  if (longs === shorts) return null;
  const direction: Direction = longs > shorts ? "long" : "short";
  const last = t.bars.length - 1;
  const price = t.bars[last][4];
  const atr = atrAt(t.bars, last) ?? price * 0.02;
  const risk = 2 * atr;
  const empty: BacktestStats = { n: 0, avg: null, avgExcess: null, hitRate: null };
  return {
    ticker: t.ticker,
    name: t.dataset.profile.name,
    sector: t.dataset.profile.sector,
    asOf: iso(t.bars[last][0]),
    price,
    direction,
    score: Math.abs(longs - shorts),
    signals: scan.current.map((s) => ({ ...s, stats: pooled[s.kind] ?? empty, own: summarize(scan.samples[s.kind] ?? []) })),
    plan: {
      entry: price,
      stop: direction === "long" ? price - risk : price + risk,
      target: direction === "long" ? price + 2 * risk : price - 2 * risk,
      atr,
    },
    multiple: scan.multiple,
  };
}

/** Paper-trade return in the trade's direction. */
export function paperReturn(direction: Direction, entry: number, price: number): number {
  const r = price / entry - 1;
  return direction === "long" ? r : -r;
}
