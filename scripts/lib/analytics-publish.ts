export const CONTEXT_PER_RUN = 20;
/** Rolling slice of the covered list: wraps around so a finished lap keeps refreshing from the start. */
export function contextSlice(all: string[], cursor: number, n = CONTEXT_PER_RUN): { tickers: string[]; next: number } {
  if (!all.length) return { tickers: [], next: 0 };
  const start = ((cursor % all.length) + all.length) % all.length;
  const tickers = Array.from({ length: Math.min(n, all.length) }, (_, i) => all[(start + i) % all.length]);
  return { tickers, next: (start + tickers.length) % all.length };
}
