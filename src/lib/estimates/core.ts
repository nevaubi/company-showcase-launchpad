// Pure normalisation + analytics for consensus estimates and analyst actions.
// Input is the raw quoteSummary result from the market-data provider; output is plain DTOs.

type Raw = Record<string, any>;
const num = (v: any): number | null => {
  const x = v && typeof v === "object" ? v.raw : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

export type PeriodCode = "0q" | "+1q" | "0y" | "+1y";
export const PERIOD_LABEL: Record<PeriodCode, string> = { "0q": "Current quarter", "+1q": "Next quarter", "0y": "Current fiscal year", "+1y": "Next fiscal year" };

export interface Range { avg: number | null; low: number | null; high: number | null; analysts: number | null; yearAgo: number | null; growth: number | null }
export interface PeriodEstimate {
  code: PeriodCode;
  endDate: string | null;
  eps: Range;
  revenue: Range;
  /** Consensus EPS now and N days ago. */
  trend: { current: number | null; d7: number | null; d30: number | null; d60: number | null; d90: number | null };
  revisions: { up7: number | null; down7: number | null; up30: number | null; down30: number | null };
}
export interface Surprise { quarter: string; actual: number | null; estimate: number | null; surprisePct: number | null }
export interface RatingMonth { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
export interface AnalystAction {
  date: string; firm: string; action: string; fromGrade: string; toGrade: string;
  targetAction: string | null; target: number | null; priorTarget: number | null;
}
export interface Estimates {
  ticker: string;
  asOf: string;
  price: number | null;
  currency: string;
  target: { mean: number | null; median: number | null; high: number | null; low: number | null; analysts: number | null };
  rating: { mean: number | null; key: string | null };
  periods: PeriodEstimate[];
  surprises: Surprise[];
  ratings: RatingMonth[];
  actions: AnalystAction[];
  nextEarnings: { start: string | null; end: string | null; epsAvg: number | null; revenueAvg: number | null } | null;
}

const isoFromEpoch = (s: any) => {
  const n = num(s);
  return n == null ? null : new Date(n * 1000).toISOString().slice(0, 10);
};
const range = (r: Raw | undefined, yearAgoKey: string): Range => ({
  avg: num(r?.avg), low: num(r?.low), high: num(r?.high),
  analysts: num(r?.numberOfAnalysts), yearAgo: num(r?.[yearAgoKey]), growth: num(r?.growth),
});

export function normalizeEstimates(ticker: string, q: Raw, asOf: string): Estimates {
  const fd = q.financialData ?? {};
  const periods: PeriodEstimate[] = (q.earningsTrend?.trend ?? [])
    .filter((t: Raw) => ["0q", "+1q", "0y", "+1y"].includes(t.period))
    .map((t: Raw) => ({
      code: t.period as PeriodCode,
      endDate: t.endDate ?? null,
      eps: range(t.earningsEstimate, "yearAgoEps"),
      revenue: range(t.revenueEstimate, "yearAgoRevenue"),
      trend: {
        current: num(t.epsTrend?.current), d7: num(t.epsTrend?.["7daysAgo"]), d30: num(t.epsTrend?.["30daysAgo"]),
        d60: num(t.epsTrend?.["60daysAgo"]), d90: num(t.epsTrend?.["90daysAgo"]),
      },
      revisions: {
        up7: num(t.epsRevisions?.upLast7days), down7: num(t.epsRevisions?.downLast7Days ?? t.epsRevisions?.downLast7days),
        up30: num(t.epsRevisions?.upLast30days), down30: num(t.epsRevisions?.downLast30days),
      },
    }));
  const surprises: Surprise[] = (q.earningsHistory?.history ?? [])
    .map((h: Raw) => ({ quarter: isoFromEpoch(h.quarter) ?? h.quarter?.fmt ?? "", actual: num(h.epsActual), estimate: num(h.epsEstimate), surprisePct: num(h.surprisePercent) }))
    .filter((s: Surprise) => s.quarter)
    .sort((a: Surprise, b: Surprise) => a.quarter.localeCompare(b.quarter));
  const ratings: RatingMonth[] = (q.recommendationTrend?.trend ?? []).map((r: Raw) => ({
    period: r.period, strongBuy: r.strongBuy ?? 0, buy: r.buy ?? 0, hold: r.hold ?? 0, sell: r.sell ?? 0, strongSell: r.strongSell ?? 0,
  }));
  const actions: AnalystAction[] = (q.upgradeDowngradeHistory?.history ?? [])
    .map((h: Raw) => ({
      date: isoFromEpoch(h.epochGradeDate) ?? "", firm: h.firm ?? "", action: h.action ?? "",
      fromGrade: h.fromGrade ?? "", toGrade: h.toGrade ?? "",
      targetAction: h.priceTargetAction || null,
      target: num(h.currentPriceTarget) || null, priorTarget: num(h.priorPriceTarget) || null,
    }))
    .filter((a: AnalystAction) => a.date && a.firm)
    .sort((a: AnalystAction, b: AnalystAction) => b.date.localeCompare(a.date));
  fixPeriodEnds(periods, surprises);
  const ce = q.calendarEvents?.earnings;
  const dates = (ce?.earningsDate ?? []).map(isoFromEpoch).filter(Boolean) as string[];
  return {
    ticker, asOf,
    price: num(fd.currentPrice),
    currency: fd.financialCurrency ?? "USD",
    target: { mean: num(fd.targetMeanPrice), median: num(fd.targetMedianPrice), high: num(fd.targetHighPrice), low: num(fd.targetLowPrice), analysts: num(fd.numberOfAnalystOpinions) },
    rating: { mean: num(fd.recommendationMean), key: fd.recommendationKey ?? null },
    periods, surprises, ratings, actions,
    nextEarnings: ce ? { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null, epsAvg: num(ce.earningsAverage), revenueAvg: num(ce.revenueAverage) } : null,
  };
}

const addMonths = (iso: string, m: number) => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m + 1, 0); // last day of the target month
  return d.toISOString().slice(0, 10);
};
/**
 * The provider sometimes keeps a reported quarter's end date on the "current quarter" row, and
 * repeats the fiscal-year end on "next fiscal year". Re-anchor: the current quarter is the one after
 * the latest reported quarter, and each later period must end after the one before it.
 */
export function fixPeriodEnds(periods: PeriodEstimate[], surprises: Surprise[]) {
  const last = surprises.map((x) => x.quarter).filter(Boolean).sort().pop();
  const q0 = periods.find((p) => p.code === "0q");
  const q1 = periods.find((p) => p.code === "+1q");
  if (q0?.endDate && last && q0.endDate.slice(0, 7) <= last.slice(0, 7)) q0.endDate = addMonths(last, 3);
  if (q0?.endDate && q1 && (!q1.endDate || q1.endDate <= q0.endDate)) q1.endDate = addMonths(q0.endDate, 3);
  const y0 = periods.find((p) => p.code === "0y");
  const y1 = periods.find((p) => p.code === "+1y");
  if (y0?.endDate && y1 && (!y1.endDate || y1.endDate <= y0.endDate)) y1.endDate = addMonths(y0.endDate, 12);
  // Year-ago quarterly EPS: prefer the reported figure for the same quarter a year earlier.
  for (const p of [q0, q1]) {
    if (!p?.endDate) continue;
    const ya = surprises.find((x) => x.quarter.slice(0, 7) === addMonths(p.endDate!, -12).slice(0, 7));
    if (ya?.actual != null) {
      p.eps.yearAgo = ya.actual;
      p.eps.growth = p.eps.avg != null && ya.actual !== 0 ? (p.eps.avg - ya.actual) / Math.abs(ya.actual) : null;
    }
  }
}

/** % change of consensus EPS from `then` to `now`; sign-safe for negative EPS. */
export function revisionPct(now: number | null, then: number | null): number | null {
  if (now == null || then == null || then === 0) return null;
  return (now - then) / Math.abs(then);
}

export type ActionKind = "upgrade" | "downgrade" | "initiate" | "reiterate" | "other";
export function actionKind(a: Pick<AnalystAction, "action">): ActionKind {
  switch (a.action) {
    case "up": return "upgrade";
    case "down": return "downgrade";
    case "init": return "initiate";
    case "main": case "reit": return "reiterate";
    default: return "other";
  }
}

/** Analyst momentum over a window: rating changes and price-target moves. */
export function actionSummary(actions: AnalystAction[], since: string) {
  const w = actions.filter((a) => a.date >= since);
  const moved = w.filter((a) => a.target != null && a.priorTarget != null && a.target !== a.priorTarget);
  return {
    count: w.length,
    upgrades: w.filter((a) => actionKind(a) === "upgrade").length,
    downgrades: w.filter((a) => actionKind(a) === "downgrade").length,
    initiations: w.filter((a) => actionKind(a) === "initiate").length,
    targetRaises: moved.filter((a) => a.target! > a.priorTarget!).length,
    targetCuts: moved.filter((a) => a.target! < a.priorTarget!).length,
    /** Median % change in price target across firms that moved it. */
    medianTargetMove: median(moved.map((a) => a.target! / a.priorTarget! - 1)),
  };
}

/** Latest target per firm (most recent action carrying a target), for a dispersion view. */
export function latestTargets(actions: AnalystAction[], since: string) {
  const seen = new Map<string, AnalystAction>();
  for (const a of actions) if (a.date >= since && a.target != null && !seen.has(a.firm)) seen.set(a.firm, a);
  return [...seen.values()].sort((a, b) => b.target! - a.target!);
}

/** Beat rate and average surprise over the reported history. */
export function beatStats(s: Surprise[]) {
  const r = s.filter((x) => x.actual != null && x.estimate != null);
  if (!r.length) return null;
  return { n: r.length, beats: r.filter((x) => x.actual! > x.estimate!).length, avgSurprise: mean(r.map((x) => x.surprisePct).filter((v): v is number => v != null)) };
}

/** Where a value sits inside [low, high], 0..1, clamped. */
export function positionIn(v: number | null, low: number | null, high: number | null): number | null {
  if (v == null || low == null || high == null || high <= low) return null;
  return Math.min(1, Math.max(0, (v - low) / (high - low)));
}

/** Rating mean on the 1 (strong buy) .. 5 (strong sell) scale → plain label. */
export function ratingLabel(m: number | null): string {
  if (m == null) return "—";
  if (m <= 1.5) return "Strong buy";
  if (m <= 2.5) return "Buy";
  if (m <= 3.5) return "Hold";
  if (m <= 4.5) return "Sell";
  return "Strong sell";
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
