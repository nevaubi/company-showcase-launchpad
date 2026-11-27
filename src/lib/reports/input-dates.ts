// Historical market and consensus snapshots can contain undated observations.
import { forecastRange } from "@/lib/estimates/range-quality";
import type { Estimates, Range } from "@/lib/estimates/core";
import type { Bar } from "@/lib/financials/types";

export function hasReportDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return false;
  const day = value.slice(0, 10);
  const ms = Date.parse(day);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(day);
}

export function reportBars(bars?: Bar[] | null): Bar[] | null {
  const dated = bars?.filter((bar) => hasReportDate(bar?.[0]) && Number.isFinite(bar[4]) && bar[4] > 0);
  return dated?.length ? dated : null;
}

function reportForecast(raw: Range): Range {
  const q = forecastRange(raw, raw.analysts);
  return {
    ...raw, avg: q.mean, low: q.issue ? null : raw.low, high: q.issue ? null : raw.high,
    analysts: raw.analysts != null && Number.isInteger(raw.analysts) && raw.analysts > 0 ? raw.analysts : null,
    growth: q.mean == null ? null : raw.growth,
  };
}

export function reportEstimates(snapshot: Estimates | null, ticker: string): Estimates | null {
  if (!snapshot || snapshot.ticker !== ticker || !hasReportDate(snapshot.asOf)) return null;
  const target = snapshot.target ?? { mean: null, median: null, low: null, high: null, analysts: null };
  const targetReview = forecastRange({ avg: target.mean, low: target.low, high: target.high }, target.analysts);
  return {
    ...snapshot,
    target: { ...target, mean: targetReview.mean, low: targetReview.issue ? null : target.low, high: targetReview.issue ? null : target.high },
    periods: (snapshot.periods ?? []).filter((p) => p?.eps && p.revenue && p.trend && p.revisions)
      .map((p) => ({ ...p, eps: reportForecast(p.eps), revenue: reportForecast(p.revenue) })),
    ratings: (snapshot.ratings ?? []).filter((r) => typeof r?.period === "string"),
    actions: (snapshot.actions ?? []).filter((a) => hasReportDate(a?.date)),
    surprises: (snapshot.surprises ?? []).filter((s) => hasReportDate(s?.quarter)),
  };
}
