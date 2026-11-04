/** Pure helpers for the company overview: next-earnings estimate and the events timeline. */

const DAY = 86_400_000;

/**
 * Estimate the next earnings release from past release dates (YYYY-MM-DD):
 * same calendar slot one year after the matching release, else last + median gap.
 * Returns null with fewer than two releases.
 */
export function estimateNextEarnings(dates: string[], today: string): { date: string; basis: string } | null {
  const ds = [...dates].sort();
  if (ds.length < 2) return null;
  const t = Date.parse(`${today}T00:00:00Z`);
  // Same quarter last year: the release ~1 year before the next expected one.
  for (const d of ds) {
    const nextYear = Date.parse(`${d}T00:00:00Z`) + 364 * DAY;
    if (nextYear > t && nextYear - t < 120 * DAY) {
      return { date: new Date(nextYear).toISOString().slice(0, 10), basis: `a year after the ${d} release` };
    }
  }
  const gaps = ds.slice(1).map((d, i) => Date.parse(d) - Date.parse(ds[i])).sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  let next = Date.parse(`${ds.at(-1)}T00:00:00Z`) + med;
  while (next <= t) next += med;
  return { date: new Date(next).toISOString().slice(0, 10), basis: "typical gap between releases" };
}

export type EventKind = "earnings" | "annual" | "quarterly" | "8k" | "proxy" | "insider_buy" | "insider_sell" | "pattern";

export interface TimelineEvent {
  date: string;
  kind: EventKind;
  title: string;
  detail?: string;
  /** Filing to open, when the event comes from one. */
  accn?: string;
  doc?: string;
  tone?: "positive" | "negative" | "neutral";
}

/** Merge, sort newest first, and drop 8-Ks that duplicate an earnings release. */
export function buildTimeline(events: TimelineEvent[], limit = 40): TimelineEvent[] {
  const earningsAccn = new Set(events.filter((e) => e.kind === "earnings").map((e) => e.accn));
  return events
    .filter((e) => !(e.kind === "8k" && e.accn && earningsAccn.has(e.accn)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}
