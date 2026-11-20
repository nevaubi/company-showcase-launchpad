/**
 * Write-time sanity check for daily bars (pure). Yahoo's bar taken right after the close sometimes
 * carries an open or close outside that day's high-low range (104 of 1,851 bars for 19 Nov). Such a
 * bar is rejected and reported, never widened or otherwise repaired: the next fetch replaces it.
 */
export function barProblem(b: { open: number; high: number; low: number; close: number }): string | null {
  const vals = [b.open, b.high, b.low, b.close];
  if (vals.some((v) => !Number.isFinite(v) || v <= 0)) return "non-positive or missing price";
  // a few hundredths of a cent of rounding between fields is not a problem
  const tol = Math.max(1e-6, b.high * 1e-6);
  if (b.high + tol < b.low) return `high ${b.high} below low ${b.low}`;
  if (Math.max(b.open, b.close) > b.high + tol) return `${b.open > b.close ? `open ${b.open}` : `close ${b.close}`} above high ${b.high}`;
  if (Math.min(b.open, b.close) < b.low - tol) return `${b.open < b.close ? `open ${b.open}` : `close ${b.close}`} below low ${b.low}`;
  return null;
}
