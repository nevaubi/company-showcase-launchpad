/** An operator-placed cutoff pauses the company's broad historical campaign. The fresh-filing lane remains active. */
export const HISTORY_HOLD_PREFIX = "ir-historical-hold:";
export const holdKey = (ticker: string) => HISTORY_HOLD_PREFIX + ticker;
export const holdCutoff = (reason?: string | null): string | null => {
  const match = /^before:(\d{4}-\d{2}-\d{2})$/.exec(reason ?? "");
  return match ? match[1] : null;
};

/** Match the current-filing lane's time window, and do not treat pre-hold processing as new work. */
export function publicationWindow(
  cutoff: string,
  heldAt: string,
  builtAt: string,
  days: number,
  now = Date.now(),
) {
  const freshness = new Date(now - Math.max(1, days) * 86_400_000).toISOString().slice(0, 10);
  return {
    filedSince: cutoff > freshness ? cutoff : freshness,
    processedSince: new Date(Math.max(Date.parse(heldAt), Date.parse(builtAt))).toISOString(),
  };
}
