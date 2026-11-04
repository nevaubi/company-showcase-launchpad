// Pure market analytics shared by the app, scripts and tests: earnings reactions,
// correlation matrices / rolling correlations, and point-in-time chart patterns.
// Bars are [date, open, high, low, close, adjClose, volume].
import type { Bar } from "../financials/types";

const ADJ = 5;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** Index of the first bar on or after `date`. */
export function barIndexOnOrAfter(bars: Bar[], date: string): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid][0] < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const ret = (bars: Bar[], from: number, to: number) =>
  from >= 0 && to < bars.length && to >= from ? bars[to][ADJ] / bars[from][ADJ] - 1 : null;

// ───────────────────────── Earnings reactions ─────────────────────────

export interface Reaction {
  date: string;
  accn: string;
  doc: string;
  /** Close before the release → close on the day after (covers pre-market and after-hours releases). */
  move: number;
  /** Same window minus SPY. */
  excess: number | null;
  /** Largest single-day gap open in the window, vs prior close. */
  gap: number;
  /** Run-up into the print: 5 sessions before. */
  preRun: number | null;
  /** Drift after the reaction window. */
  drift5: number | null;
  drift20: number | null;
  /** Reaction volume vs 20-day average. */
  volRatio: number | null;
  /** |move| in units of the stock's normal daily volatility (60d before). */
  sigma: number | null;
}

export interface ReactionStats {
  n: number;
  avgAbsMove: number;
  medianMove: number;
  upRate: number;
  avgExcess: number | null;
  avgDrift20: number | null;
  /** Share of prints where the 20-day drift continued the reaction's direction. */
  continuation: number | null;
  avgPreRun: number | null;
  biggest: Reaction | null;
  avgSigma: number | null;
}

export function earningsReactions(bars: Bar[], releases: { filed: string; accn: string; doc: string }[], spy?: Bar[]): Reaction[] {
  const out: Reaction[] = [];
  const seen = new Set<string>();
  for (const r of releases) {
    const d = r.filed.slice(0, 10);
    if (seen.has(d)) continue;
    seen.add(d);
    const i = barIndexOnOrAfter(bars, d);
    if (i <= 0 || i + 1 >= bars.length) continue;
    const pre = i - 1;
    const end = i + 1;
    const move = ret(bars, pre, end)!;
    let excess: number | null = null;
    if (spy?.length) {
      const si = barIndexOnOrAfter(spy, bars[pre][0]);
      const se = barIndexOnOrAfter(spy, bars[end][0]);
      if (spy[si]?.[0] === bars[pre][0] && spy[se]?.[0] === bars[end][0]) excess = move - (ret(spy, si, se) ?? 0);
    }
    const gapA = bars[i][1] / bars[pre][4] - 1;
    const gapB = bars[i + 1][1] / bars[i][4] - 1;
    const gap = Math.abs(gapA) >= Math.abs(gapB) ? gapA : gapB;
    const vols = bars.slice(Math.max(0, pre - 20), pre).map((b) => b[6]).filter((v) => v > 0);
    const volRatio = vols.length ? Math.max(bars[i][6], bars[i + 1][6]) / mean(vols) : null;
    const daily: number[] = [];
    for (let k = Math.max(1, pre - 60); k <= pre; k++) daily.push(bars[k][ADJ] / bars[k - 1][ADJ] - 1);
    const dvol = sd(daily);
    out.push({
      date: d,
      accn: r.accn,
      doc: r.doc,
      move,
      excess,
      gap,
      preRun: ret(bars, pre - 5, pre),
      drift5: end + 5 < bars.length ? ret(bars, end, end + 5) : null,
      drift20: end + 20 < bars.length ? ret(bars, end, end + 20) : null,
      volRatio,
      // Two-day window → scale daily vol by √2.
      sigma: Number.isFinite(dvol) && dvol > 0 ? Math.abs(move) / (dvol * Math.SQRT2) : null,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function reactionStats(rs: Reaction[]): ReactionStats {
  const nn = <T,>(xs: (T | null)[]) => xs.filter((x): x is T => x != null);
  const drifts = rs.filter((r) => r.drift20 != null);
  const ex = nn(rs.map((r) => r.excess));
  const pr = nn(rs.map((r) => r.preRun));
  const sg = nn(rs.map((r) => r.sigma));
  return {
    n: rs.length,
    avgAbsMove: mean(rs.map((r) => Math.abs(r.move))),
    medianMove: median(rs.map((r) => r.move)),
    upRate: rs.length ? rs.filter((r) => r.move > 0).length / rs.length : NaN,
    avgExcess: ex.length ? mean(ex) : null,
    avgDrift20: drifts.length ? mean(drifts.map((r) => r.drift20!)) : null,
    continuation: drifts.length ? drifts.filter((r) => Math.sign(r.drift20!) === Math.sign(r.move)).length / drifts.length : null,
    avgPreRun: pr.length ? mean(pr) : null,
    biggest: rs.reduce<Reaction | null>((b, r) => (!b || Math.abs(r.move) > Math.abs(b.move) ? r : b), null),
    avgSigma: sg.length ? mean(sg) : null,
  };
}

// ───────────────────────── Correlations ─────────────────────────

/** Daily log-free simple returns keyed by date. */
export function returnsByDate(bars: Bar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) m.set(bars[i][0], bars[i][ADJ] / bars[i - 1][ADJ] - 1);
  return m;
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    cov += x * y; va += x * x; vb += y * y;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

/** Paired returns on common dates, optionally limited to the last `days` common dates. */
export function paired(a: Map<string, number>, b: Map<string, number>, days?: number) {
  const dates = [...a.keys()].filter((d) => b.has(d)).sort();
  const use = days ? dates.slice(-days) : dates;
  return { dates: use, a: use.map((d) => a.get(d)!), b: use.map((d) => b.get(d)!) };
}

export function correlationMatrix(series: Map<string, number>[], days: number): (number | null)[][] {
  const m: (number | null)[][] = series.map(() => series.map(() => null));
  for (let i = 0; i < series.length; i++) {
    m[i][i] = 1;
    for (let j = i + 1; j < series.length; j++) {
      const p = paired(series[i], series[j], days);
      m[i][j] = m[j][i] = pearson(p.a, p.b);
    }
  }
  return m;
}

export function rollingCorrelation(a: Map<string, number>, b: Map<string, number>, window: number) {
  const p = paired(a, b);
  const out: { date: string; value: number }[] = [];
  for (let i = window; i <= p.dates.length; i += 1) {
    const c = pearson(p.a.slice(i - window, i), p.b.slice(i - window, i));
    if (c != null) out.push({ date: p.dates[i - 1], value: c });
  }
  return out;
}

/** OLS beta of a on b and the share of a's variance explained (R²). */
export function betaR2(a: number[], b: number[]) {
  const r = pearson(a, b);
  const sa = sd(a), sb = sd(b);
  if (r == null || !sb) return null;
  return { beta: (r * sa) / sb, r2: r * r };
}

/** Correlation in down-market days (b < 0) vs up days — does it fall together harder than it rises? */
export function downsideCorrelation(a: number[], b: number[]) {
  const dn = a.map((x, i) => [x, b[i]] as const).filter(([, y]) => y < 0);
  const up = a.map((x, i) => [x, b[i]] as const).filter(([, y]) => y >= 0);
  return { down: pearson(dn.map((p) => p[0]), dn.map((p) => p[1])), up: pearson(up.map((p) => p[0]), up.map((p) => p[1])) };
}

// ───────────────────────── Chart patterns ─────────────────────────

export type PatternKind =
  | "golden_cross"
  | "death_cross"
  | "breakout_52w"
  | "breakdown_52w"
  | "rsi_oversold"
  | "rsi_overbought"
  | "bb_squeeze"
  | "double_bottom"
  | "double_top"
  | "gap_up"
  | "gap_down"
  | "volume_climax";

export const PATTERN_META: Record<PatternKind, { label: string; bias: "bullish" | "bearish" | "neutral"; rule: string }> = {
  golden_cross: { label: "Golden cross", bias: "bullish", rule: "50-day average crosses above the 200-day" },
  death_cross: { label: "Death cross", bias: "bearish", rule: "50-day average crosses below the 200-day" },
  breakout_52w: { label: "52-week breakout", bias: "bullish", rule: "Close above the prior 52-week high" },
  breakdown_52w: { label: "52-week breakdown", bias: "bearish", rule: "Close below the prior 52-week low" },
  rsi_oversold: { label: "RSI oversold", bias: "bullish", rule: "14-day RSI drops below 30" },
  rsi_overbought: { label: "RSI overbought", bias: "bearish", rule: "14-day RSI rises above 70" },
  bb_squeeze: { label: "Volatility squeeze", bias: "neutral", rule: "Bollinger width at its tightest in 6 months" },
  double_bottom: { label: "Double bottom", bias: "bullish", rule: "Two lows within 3% of each other, 15+ sessions apart, then a close above the peak between them" },
  double_top: { label: "Double top", bias: "bearish", rule: "Two highs within 3% of each other, 15+ sessions apart, then a close below the trough between them" },
  gap_up: { label: "Gap up on volume", bias: "bullish", rule: "Opens 3%+ above prior close on 2× average volume" },
  gap_down: { label: "Gap down on volume", bias: "bearish", rule: "Opens 3%+ below prior close on 2× average volume" },
  volume_climax: { label: "Volume climax", bias: "neutral", rule: "Volume 3× the 50-day average" },
};

export interface PatternHit {
  kind: PatternKind;
  index: number;
  date: string;
  price: number;
  /** Forward 20-session return after the signal, if known yet. */
  fwd20: number | null;
  /** Price levels that defined the pattern (for drawing). */
  levels?: number[];
}

function smaArr(xs: number[], n: number) {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += xs[i];
    if (i >= n) s -= xs[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

function rsiArr(xs: number[], n = 14) {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l ? 100 - 100 / (1 + g / l) : 100; }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l ? 100 - 100 / (1 + g / l) : 100; }
  }
  return out;
}

/** Scan every bar for pattern triggers using only data up to that bar (no look-ahead). */
export function detectPatterns(bars: Bar[]): PatternHit[] {
  const c = bars.map((b) => b[ADJ]);
  // Highs/lows scaled to adjusted closes so splits/dividends don't fake breakouts.
  const k = bars.map((b) => (b[4] ? b[ADJ] / b[4] : 1));
  const hi = bars.map((b, i) => b[2] * k[i]);
  const lo = bars.map((b, i) => b[3] * k[i]);
  const s50 = smaArr(c, 50), s200 = smaArr(c, 200), s20 = smaArr(c, 20), v50 = smaArr(bars.map((b) => b[6]), 50);
  const r = rsiArr(c);
  const width: (number | null)[] = c.map((_, i) => {
    if (i < 19 || s20[i] == null) return null;
    const w = c.slice(i - 19, i + 1);
    return (4 * sd(w)) / s20[i]!;
  });
  const hits: PatternHit[] = [];
  const push = (kind: PatternKind, i: number, levels?: number[]) =>
    hits.push({ kind, index: i, date: bars[i][0], price: c[i], fwd20: i + 20 < c.length ? c[i + 20] / c[i] - 1 : null, levels });
  const last: Partial<Record<PatternKind, number>> = {};
  const cool = (kind: PatternKind, i: number, gap = 20) => {
    if (last[kind] != null && i - last[kind]! < gap) return false;
    last[kind] = i;
    return true;
  };

  for (let i = 1; i < bars.length; i++) {
    if (s50[i] != null && s200[i] != null && s50[i - 1] != null && s200[i - 1] != null) {
      if (s50[i - 1]! <= s200[i - 1]! && s50[i]! > s200[i]! && cool("golden_cross", i)) push("golden_cross", i);
      if (s50[i - 1]! >= s200[i - 1]! && s50[i]! < s200[i]! && cool("death_cross", i)) push("death_cross", i);
    }
    if (i >= 252) {
      let h = -Infinity, l = Infinity;
      for (let j = i - 252; j < i; j++) { if (c[j] > h) h = c[j]; if (c[j] < l) l = c[j]; }
      if (c[i] > h && c[i - 1] <= h && cool("breakout_52w", i)) push("breakout_52w", i, [h]);
      if (c[i] < l && c[i - 1] >= l && cool("breakdown_52w", i)) push("breakdown_52w", i, [l]);
    }
    if (r[i] != null && r[i - 1] != null) {
      if (r[i - 1]! >= 30 && r[i]! < 30 && cool("rsi_oversold", i, 10)) push("rsi_oversold", i);
      if (r[i - 1]! <= 70 && r[i]! > 70 && cool("rsi_overbought", i, 10)) push("rsi_overbought", i);
    }
    if (width[i] != null && i >= 145) {
      const past = width.slice(i - 125, i).filter((x): x is number => x != null);
      if (past.length > 100 && width[i]! < Math.min(...past) && cool("bb_squeeze", i, 30)) push("bb_squeeze", i);
    }
    if (v50[i - 1] != null && bars[i][6] > 0) {
      const vr = bars[i][6] / v50[i - 1]!;
      const gap = bars[i][1] / bars[i - 1][4] - 1;
      if (vr >= 2 && gap >= 0.03 && cool("gap_up", i, 5)) push("gap_up", i);
      if (vr >= 2 && gap <= -0.03 && cool("gap_down", i, 5)) push("gap_down", i);
      if (vr >= 3 && cool("volume_climax", i, 10)) push("volume_climax", i);
    }
  }

  // Double bottoms/tops from swing pivots (5 bars each side), confirmed on the neckline cross.
  const piv = (arr: number[], isLow: boolean) => {
    const out: number[] = [];
    for (let i = 5; i < arr.length - 5; i++) {
      let ok = true;
      for (let j = i - 5; j <= i + 5 && ok; j++) if (j !== i && (isLow ? arr[j] < arr[i] : arr[j] > arr[i])) ok = false;
      if (ok) out.push(i);
    }
    return out;
  };
  const lows = piv(lo, true), highs = piv(hi, false);
  const doubles = (pv: number[], isLow: boolean, kind: PatternKind) => {
    for (let a = 0; a < pv.length - 1; a++) {
      const i1 = pv[a], i2 = pv[a + 1];
      if (i2 - i1 < 15 || i2 - i1 > 120) continue;
      const p1 = isLow ? lo[i1] : hi[i1], p2 = isLow ? lo[i2] : hi[i2];
      if (Math.abs(p2 / p1 - 1) > 0.03) continue;
      const mid = isLow ? Math.max(...hi.slice(i1, i2 + 1)) : Math.min(...lo.slice(i1, i2 + 1));
      // The swing must be meaningful (≥5% between the extremes and the neckline).
      if (Math.abs(mid / p1 - 1) < 0.05) continue;
      // Pivot is only known 5 bars later; confirmation must come after that and within 40 bars.
      for (let i = i2 + 5; i < Math.min(c.length, i2 + 40); i++) {
        if (isLow ? c[i] > mid : c[i] < mid) {
          if (cool(kind, i, 30)) push(kind, i, [p1, p2, mid]);
          break;
        }
        if (isLow ? lo[i] < Math.min(p1, p2) * 0.98 : hi[i] > Math.max(p1, p2) * 1.02) break;
      }
    }
  };
  doubles(lows, true, "double_bottom");
  doubles(highs, false, "double_top");
  return hits.sort((a, b) => a.index - b.index);
}

export interface PatternEdge {
  kind: PatternKind;
  n: number;
  avgFwd20: number | null;
  hitRate: number | null;
}

/** How each pattern has played out historically: hit = moved in the pattern's bias direction. */
export function patternEdges(hits: PatternHit[]): PatternEdge[] {
  const by = new Map<PatternKind, PatternHit[]>();
  for (const h of hits) if (h.fwd20 != null) (by.get(h.kind) ?? by.set(h.kind, []).get(h.kind)!).push(h);
  return [...by].map(([kind, hs]) => {
    const bias = PATTERN_META[kind].bias;
    const f = hs.map((h) => h.fwd20!);
    return {
      kind,
      n: hs.length,
      avgFwd20: mean(f),
      hitRate: bias === "neutral" ? null : f.filter((x) => (bias === "bullish" ? x > 0 : x < 0)).length / f.length,
    };
  });
}

/** Nearby support/resistance from clustered swing pivots of the last ~year. */
export function supportResistance(bars: Bar[], lookback = 252) {
  const sl = bars.slice(-lookback);
  const c = sl.map((b) => b[ADJ]);
  const last = c.at(-1) ?? 0;
  const levels: number[] = [];
  for (let i = 5; i < c.length - 5; i++) {
    const w = c.slice(i - 5, i + 6);
    if (c[i] === Math.max(...w) || c[i] === Math.min(...w)) levels.push(c[i]);
  }
  levels.sort((a, b) => a - b);
  const clusters: { price: number; touches: number }[] = [];
  for (const l of levels) {
    const cl = clusters.at(-1);
    if (cl && l / cl.price - 1 < 0.015) { cl.price = (cl.price * cl.touches + l) / (cl.touches + 1); cl.touches++; }
    else clusters.push({ price: l, touches: 1 });
  }
  const strong = clusters.filter((x) => x.touches >= 2);
  return {
    support: strong.filter((x) => x.price < last).sort((a, b) => b.price - a.price).slice(0, 3),
    resistance: strong.filter((x) => x.price > last).sort((a, b) => a.price - b.price).slice(0, 3),
  };
}
