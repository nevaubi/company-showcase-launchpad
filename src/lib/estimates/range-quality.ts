export interface ForecastValues {
  avg: number | null;
  low?: number | null;
  high?: number | null;
}

export function coverageLabel(count: number | null | undefined, mean: number | null) {
  if (count != null && Number.isInteger(count) && count > 0) return `${count} analyst${count === 1 ? "" : "s"}`;
  if (count === 0 && mean == null) return "No coverage reported";
  return count === 0 ? "Count unconfirmed" : "Count unavailable";
}

/** Read-time display only. The provider's three forecast fields and contributor count stay intact. */
export function forecastRange(raw: ForecastValues, count: number | null | undefined) {
  const { avg, low, high } = raw;
  const placeholder = count === 0 && avg === 0 && low === 0 && high === 0;
  const mean = placeholder || !Number.isFinite(avg) ? null : avg;
  let issue: string | null = null;
  let position: number | null = null;
  if (placeholder) issue = "No forecast reported";
  else if (low != null && high != null && Number.isFinite(low) && Number.isFinite(high)) {
    if (low > high) issue = "Reported low exceeds high";
    else if (mean != null && (mean < low || mean > high)) issue = "Mean outside reported range";
    else if (high > low && mean != null) position = (mean - low) / (high - low);
  }
  return { mean, position, issue, placeholder, coverage: coverageLabel(count, mean) };
}

export function forecastSource(raw: ForecastValues, count: number | null | undefined, format: (v: number | null) => string) {
  const q = forecastRange(raw, count);
  const coverage = count == null ? "contributor count not supplied" : `reported contributor count ${count}`;
  const warning = q.issue ? `. ${q.issue}.` : ".";
  const missing = q.mean != null && q.coverage.startsWith("Count") ? " The number of analysts supporting this mean is unconfirmed." : "";
  return `Yahoo Finance reported mean ${format(raw.avg)}, low ${format(raw.low ?? null)}, high ${format(raw.high ?? null)}, ${coverage}${warning}${missing}`;
}

/** Compact, qualified estimate for research tools. Raw contradictory endpoints stay out of analyst prose. */
export function forecastReading(raw: ForecastValues, count: number | null | undefined) {
  const q = forecastRange(raw, count);
  if (q.placeholder) return "no forecast reported (all-zero provider fields and zero contributors)";
  const mean = q.mean == null ? "mean unavailable" : `mean ${q.mean}`;
  const band = q.issue ? `bounds withheld: ${q.issue.toLowerCase()}`
    : Number.isFinite(raw.low) && Number.isFinite(raw.high) && q.mean != null ? `range ${raw.low} to ${raw.high}` : "range unavailable";
  return `${mean}, ${band}, ${q.coverage.toLowerCase()}`;
}
