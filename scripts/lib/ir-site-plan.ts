/** Daily Firecrawl credit cap for the scheduled IR-website collector. */
export const IR_SITE_DAILY_CREDITS = 300;
/** Worst case per company: one site map + six page-link scrapes (one credit each). */
export const IR_SITE_RESERVE = 7;
export const IR_SITE_PAUSE_REASON = "Firecrawl credits exhausted (402); probing hourly";
export const IR_SITE_PROBE_MS = 3600_000;

export const canSpend = (used: number, reserve = IR_SITE_RESERVE, cap = IR_SITE_DAILY_CREDITS) => used + reserve <= cap;

/**
 * Order for today's run: companies that reported (8-K 2.02) in the last 14 days and whose IR site
 * wasn't read since that report, newest report first; then the rotation from `cursor`.
 */
export function irSiteOrder(recent: { ticker: string; filed: string }[], lastScan: Map<string, string>, rotation: string[], cursor: number) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of [...recent].sort((a, b) => b.filed.localeCompare(a.filed))) {
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    const last = lastScan.get(r.ticker);
    if (!last || last.slice(0, 10) < r.filed) out.push(r.ticker);
  }
  for (let i = 0; i < rotation.length; i++) {
    const t = rotation[(cursor + i) % rotation.length];
    if (!seen.has(t)) out.push(t);
  }
  return out;
}
export const isCreditError = (message: string) => /\b402\b|insufficient credits|credits? (are )?exhausted|payment required/i.test(message);
