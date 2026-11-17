/**
 * Period-end dates printed in a document, and fixing a reader's calendar month-end guess for a
 * 52/53-week period ("12 Weeks Ended November 23, 2025" read as 2025-11-30). Pure.
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const MDY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`, "gi");
const DMY = new RegExp(`\\b(\\d{1,2})\\s+${MONTH},?\\s+((?:19|20)\\d{2})\\b`, "gi");
const NUM = /\b(\d{1,2})\/(\d{1,2})\/((?:19|20)?\d{2})\b/g;
const ISO_RE = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g;

const iso = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? t.toISOString().slice(0, 10) : null;
};
const monthNum = (s: string) => MONTHS[s.toLowerCase().replace(/\.$/, "").slice(0, s.toLowerCase().startsWith("sept") ? 4 : 3)] ?? MONTHS[s.toLowerCase().slice(0, 3)];

/** Words that make a date a period end ("12 weeks ended November 23, 2025", "as of May 10"). */
const PERIOD_CONTEXT = /\b(ended|ending|end of|ends|as of|as at|through|thru|year[- ]end(?:ed)?)\s*[:,]?\s*(?:the\s+)?$/i;
/** "November 23, 2025 and November 24, 2024": a date right after a period end is one too. */
const CHAIN = /^\s*(?:,|and|&|vs\.?|versus|compared (?:to|with))?\s*$/i;

/**
 * Calendar dates printed in the text, as YYYY-MM-DD. With `periodOnly`, only dates printed as a
 * period end (a period word in the 60 characters before them), not dateline or event dates.
 */
export function printedDates(text: string, periodOnly = false): Set<string> {
  const found: { d: string; at: number; end: number }[] = [];
  const add = (d: string | null, at: number, len: number) => d && found.push({ d, at, end: at + len });
  for (const m of text.matchAll(MDY)) add(iso(+m[3], monthNum(m[1]), +m[2]), m.index!, m[0].length);
  for (const m of text.matchAll(DMY)) add(iso(+m[3], monthNum(m[2]), +m[1]), m.index!, m[0].length);
  for (const m of text.matchAll(NUM)) add(iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]), m.index!, m[0].length);
  for (const m of text.matchAll(ISO_RE)) add(iso(+m[1], +m[2], +m[3]), m.index!, m[0].length);
  if (!periodOnly) return new Set(found.map((f) => f.d));
  found.sort((a, b) => a.at - b.at);
  const out = new Set<string>();
  let prev = null as { end: number; ok: boolean } | null;
  for (const f of found) {
    const ok: boolean = PERIOD_CONTEXT.test(text.slice(Math.max(0, f.at - 40), f.at)) || (!!prev?.ok && f.at - prev.end <= 24 && CHAIN.test(text.slice(prev.end, f.at)));
    if (ok) out.add(f.d);
    prev = { end: f.end, ok };
  }
  return out;
}

const DAY = 86_400_000;
const isMonthEnd = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return new Date(t.getTime() + DAY).getUTCDate() === 1;
};

/**
 * A period end the document never prints, sitting on a calendar month-end, is a guess: when the
 * document prints exactly one period-end date within ten days of it, that date is the period end.
 * Pass `printedDates(text, true)` so a dateline or call date is never taken for a period end.
 * Returns the corrected date, or the original when there's no single printed candidate.
 */
export function fixPeriodEnd(end: string, printed: Set<string>): string {
  if (printed.has(end) || !isMonthEnd(end)) return end;
  const t = Date.parse(`${end}T00:00:00Z`);
  const near = [...printed].filter((d) => Math.abs(Date.parse(`${d}T00:00:00Z`) - t) <= 10 * DAY && d !== end);
  return near.length === 1 ? near[0] : end;
}

/** Apply fixPeriodEnd to a fact row, shifting its start by the same number of days. */
export function fixRowDates<T extends { period_end: string; period_start: string | null; months: number; period_label?: string }>(row: T, printed: Set<string>): T {
  const end = fixPeriodEnd(row.period_end, printed);
  if (end === row.period_end) return row;
  const shift = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${row.period_end}T00:00:00Z`);
  const start = row.period_start ? new Date(Date.parse(`${row.period_start}T00:00:00Z`) + shift).toISOString().slice(0, 10) : null;
  return { ...row, period_end: end, period_start: start, ...(row.period_label !== undefined ? { period_label: row.months ? `${row.months}M ending ${end}` : `As of ${end}` } : {}) };
}
