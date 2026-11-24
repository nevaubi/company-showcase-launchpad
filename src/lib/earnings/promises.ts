// Management promise tracker — pure helpers (no I/O). The model proposes promises and
// outcomes; these functions keep only the ones whose quotes appear verbatim in the cited
// call, so every promise and every grade opens its exact source sentence.

export type PromiseStatus = "kept" | "missed" | "partial" | "pending";

export interface CallText {
  url: string;
  date: string;
  quarter: string | null;
  /** Management remarks only */
  text: string;
}

export interface RawPromise {
  quote: string;
  callDate: string;
  category: string;
  summary: string;
  deadline: string | null;
  status: PromiseStatus;
  outcomeQuote: string | null;
  outcomeCallDate: string | null;
  note: string;
}

export interface TrackedPromise extends RawPromise {
  callUrl: string;
  callQuarter: string | null;
  outcomeUrl: string | null;
}

export const normText = (s: string) =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** True when the quote appears verbatim (ignoring case, curly quotes and whitespace). */
export function quoteIn(text: string, quote: string): boolean {
  const q = normText(quote);
  return q.length >= 20 && normText(text).includes(q);
}

/**
 * Keep promises whose quote is verbatim in the call it cites. A grade other than
 * "pending" needs a verbatim outcome quote from a *later* call; otherwise it is
 * downgraded to pending so no outcome is ever asserted without its source.
 */
export function vetPromises(raw: RawPromise[], calls: CallText[]): TrackedPromise[] {
  const byDate = new Map(calls.map((c) => [c.date, c]));
  const out: TrackedPromise[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    const call = byDate.get(p.callDate) ?? calls.find((c) => quoteIn(c.text, p.quote));
    if (!call || !quoteIn(call.text, p.quote)) continue;
    const key = normText(p.quote).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    let status = p.status;
    let outcome: CallText | undefined;
    if (status !== "pending") {
      outcome = (p.outcomeCallDate ? byDate.get(p.outcomeCallDate) : undefined) ?? calls.find((c) => c.date > call.date && !!p.outcomeQuote && quoteIn(c.text, p.outcomeQuote));
      if (!outcome || outcome.date <= call.date || !p.outcomeQuote || !quoteIn(outcome.text, p.outcomeQuote)) {
        status = "pending";
        outcome = undefined;
      }
    }
    out.push({
      ...p,
      callDate: call.date,
      status,
      outcomeQuote: outcome ? p.outcomeQuote : null,
      outcomeCallDate: outcome?.date ?? null,
      callUrl: call.url,
      callQuarter: call.quarter,
      outcomeUrl: outcome?.url ?? null,
    });
  }
  return out.sort((a, b) => b.callDate.localeCompare(a.callDate));
}

/** Share of graded promises kept (partial counts half). Null until at least 3 are graded. */
export function credibility(ps: Pick<TrackedPromise, "status">[]) {
  const n = { kept: 0, missed: 0, partial: 0, pending: 0 };
  for (const p of ps) n[p.status]++;
  const graded = n.kept + n.missed + n.partial;
  return { ...n, graded, score: graded >= 3 ? (n.kept + n.partial / 2) / graded : null };
}
