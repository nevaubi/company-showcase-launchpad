// Pure scheduling rules for the slow alt-data step (scripts/alt-slow.ts).
export const SLOW_SETS = "ownership,contracts,recalls";
export const MEDICARE_EVERY_MS = 30 * 86_400_000;

/** One seventh of the covered list per UTC day, so the whole list is refreshed every week. */
export function weekSlice(tickers: string[], day = new Date()): string[] {
  const d = Math.floor(day.getTime() / 86_400_000) % 7;
  return [...tickers].sort().filter((_, i) => i % 7 === d);
}

/** Covered companies the alt registry has never seen (a newly covered company). */
export function missingFromRegistry(tickers: string[], registry: Record<string, unknown>): string[] {
  return tickers.filter((t) => !(t in registry));
}
