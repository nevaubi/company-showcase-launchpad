/** Scheduled standard reports: what is due, and how a credit outage pauses the job. */
export const REPORTS_JOB = "reports-due";
export const REPORTS_PROBE_MS = 3600_000;
export const STUCK_LOCK_MS = 2 * 3600_000;
export const isAiCreditError = (m: string) => /credits are exhausted|\b402\b|payment required|insufficient credits/i.test(m);

export interface DueSlot { ticker: string; kind: "recap" | "preview"; reason: string }

/**
 * Recaps: a covered company with an earnings 8-K (item 2.02) in the last 3 days whose shared recap
 * was not written for that accession. Previews: an expected report date in the next 7 days and no
 * preview written this ISO week for the current data. Recaps first (newest filing first).
 */
export function dueSlots(
  events: { ticker: string; accn: string; filed: string }[],
  upcoming: { ticker: string; date: string }[],
  reports: { ticker: string; kind: string; status: string; data_version: string; updated_at: string }[],
  covered: Set<string>,
  today: string,
): DueSlot[] {
  const by = new Map(reports.map((r) => [`${r.ticker}:${r.kind}`, r]));
  const out: DueSlot[] = [];
  const latest = new Map<string, { accn: string; filed: string }>();
  for (const e of events) if (covered.has(e.ticker) && (!latest.has(e.ticker) || e.filed > latest.get(e.ticker)!.filed)) latest.set(e.ticker, e);
  for (const [ticker, e] of [...latest].sort((a, b) => b[1].filed.localeCompare(a[1].filed))) {
    const r = by.get(`${ticker}:recap`);
    if (r && r.status === "ready" && r.data_version.split("|")[1] === e.accn) continue;
    out.push({ ticker, kind: "recap", reason: `8-K 2.02 ${e.accn} filed ${e.filed}` });
  }
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString();
  for (const u of [...upcoming].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!covered.has(u.ticker) || latest.has(u.ticker)) continue;
    const r = by.get(`${u.ticker}:preview`);
    if (r && r.status === "ready" && r.updated_at >= weekAgo) continue;
    out.push({ ticker: u.ticker, kind: "preview", reason: `expected report ${u.date}` });
  }
  return out;
}
