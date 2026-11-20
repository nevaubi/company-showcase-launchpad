// Pure parsers for market-wide SEC filing discovery (shared by the scheduled job and the catch-up
// script). EDGAR's daily master index is the complete list for a finished day; the current-filings
// Atom feed covers today within minutes and carries 8-K item numbers.

export interface DiscoveredFiling {
  cik: string; // unpadded
  accn: string;
  form: string;
  filed: string; // YYYY-MM-DD
  items: string | null; // "2.02,9.01" for 8-Ks from the Atom feed, null when unknown
}

/** Same exclusions as the per-company walk, so a discovered filing is one the walk would store. */
export const SKIP_FORMS = /^(424B|FWP|SC 13|S-3)/;
/** Item 2.02 on an original 8-K. An amendment (8-K/A) restates a release already dated by its original, so it is not a second earnings date (review R11). */
export const isEarnings = (form: string, items: string | null) => /^8-K$/.test(form.trim()) && /(^|,)\s*2\.02/.test(items ?? "");

/** Split a list into chunks for `.in()` filters, so a request stays far below URL limits (review R6). */
export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** `master.YYYYMMDD.idx`: CIK|Company|Form|Date|edgar/data/CIK/ACCN.txt */
export function parseMasterIndex(text: string): DiscoveredFiling[] {
  const out: DiscoveredFiling[] = [];
  for (const line of text.split("\n")) {
    const p = line.split("|");
    if (p.length !== 5 || !/^\d+$/.test(p[0]) || !/^\d{8}$/.test(p[3])) continue;
    const accn = p[4].match(/(\d{10}-\d{2}-\d{6})\.txt\s*$/)?.[1];
    if (!accn) continue;
    out.push({ cik: String(Number(p[0])), accn, form: p[2].trim(), filed: `${p[3].slice(0, 4)}-${p[3].slice(4, 6)}-${p[3].slice(6, 8)}`, items: null });
  }
  return out;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** `browse-edgar?action=getcurrent&output=atom` entries. */
export function parseCurrentAtom(xml: string): DiscoveredFiling[] {
  const out: DiscoveredFiling[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const accn = e.match(/accession-number=(\d{10}-\d{2}-\d{6})/)?.[1];
    const cik = e.match(/\((\d{10})\)/)?.[1];
    const form = e.match(/term="([^"]+)"/)?.[1];
    const summary = decode(e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "");
    const filed = summary.match(/Filed:<\/b>\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!accn || !cik || !form || !filed) continue;
    const items = [...summary.matchAll(/Item (\d+\.\d+)/g)].map((x) => x[1]);
    out.push({ cik: String(Number(cik)), accn, form, filed, items: items.length ? items.join(",") : null });
  }
  return out;
}

/** Keep covered filers' filings the walk would store; dedupe by accession (Atom lists filer + subject). */
export function coveredOnly(rows: DiscoveredFiling[], ciks: Map<string, string>): (DiscoveredFiling & { ticker: string })[] {
  const seen = new Set<string>();
  const out: (DiscoveredFiling & { ticker: string })[] = [];
  for (const r of rows) {
    const ticker = ciks.get(r.cik);
    if (!ticker || SKIP_FORMS.test(r.form) || seen.has(`${r.accn}:${ticker}`)) continue;
    seen.add(`${r.accn}:${ticker}`);
    out.push({ ...r, ticker });
  }
  return out;
}

/** Feed pages rotated by the scheduled job (newest 100 of each type). */
export const FEED_TYPES = ["8-K", "10-Q", "10-K", "4", "6-K", "DEF 14A", "S-1", "20-F", "3", "144"];
export const feedUrl = (type: string) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=include&start=0&count=100&output=atom`;
export const masterUrl = (day: string) => {
  const [y, m, d] = day.split("-");
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${Math.ceil(Number(m) / 3)}/master.${y}${m}${d}.idx`;
};
export const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** No-progress runs before the day pass gives up on a finished day's stragglers. */
export const DAY_NO_PROGRESS_MAX = 20;

export interface DayState {
  day: string | null;
  /** consecutive runs where the missing-company count did not fall */
  tries: number;
  /** companies missing at the start of the last run (null when unknown) */
  left: number | null;
  /** runs on this day so far (rotates the resolve order) */
  run: number;
}

/** `"tries N on DAY (M left, run R)"`; older rows (`"tries N on DAY"`) read with `left` unknown. */
export function parseDayState(reason: string | null | undefined): DayState {
  const m = /^tries (\d+) on (\d{4}-\d{2}-\d{2})(?: \((\d+) left(?:, run (\d+))?\))?/.exec(reason ?? "");
  if (!m) return { day: null, tries: 0, left: null, run: 0 };
  return { day: m[2], tries: Number(m[1]), left: m[3] == null ? null : Number(m[3]), run: m[4] == null ? 0 : Number(m[4]) };
}

export const formatDayState = (s: DayState & { day: string }) => `tries ${s.tries} on ${s.day} (${s.left ?? 0} left, run ${s.run})`;

export type DayDecision =
  | { kind: "next"; reason: string | null; complete: boolean }
  | { kind: "stay"; state: DayState & { day: string } };

/**
 * After a day-pass run: `companies` were missing at the start, `resolved` were synced without an
 * error. Complete when every missing company was synced this run (what is still missing is not in
 * the companies' submissions, e.g. co-registrant filings). Tries count only runs that made no
 * progress (the missing count did not fall), so a busy day is worked through instead of given up
 * after a fixed number of runs.
 */
export function dayProgress(prev: DayState, day: string, companies: number, resolved: number, maxNoProgress = DAY_NO_PROGRESS_MAX): DayDecision {
  if (companies === 0 || resolved >= companies) return { kind: "next", reason: null, complete: true };
  const same = prev.day === day;
  const progressed = same && prev.left != null ? companies < prev.left : true;
  const tries = same ? (progressed ? 0 : prev.tries + 1) : 0;
  const run = same ? prev.run + 1 : 1;
  if (tries >= maxNoProgress) return { kind: "next", reason: `gave up on ${day}: ${companies - resolved} companies unresolved after ${tries} runs without progress`, complete: false };
  return { kind: "stay", state: { day, tries, left: companies, run } };
}

/** Rotate the order companies are resolved in, so one that never resolves cannot take the first slot every run. */
export function rotate<T>(list: readonly T[], by: number): T[] {
  if (!list.length) return [];
  const k = ((Math.floor(by) % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/** Earnings 8-Ks (item 2.02) in `filings` with no `earnings_events` row: the repair set. */
export function missingEarnings(
  filings: readonly { accn: string; ticker: string; form: string; filed: string; items: string | null }[],
  events: readonly { accn: string; ticker: string }[],
): { ticker: string; accn: string; filed: string; source: string }[] {
  const have = new Set(events.map((e) => `${e.ticker}|${e.accn}`));
  return filings.filter((f) => isEarnings(f.form, f.items) && !have.has(`${f.ticker}|${f.accn}`)).map((f) => ({ ticker: f.ticker, accn: f.accn, filed: f.filed, source: "sec-8k-2.02" }));
}

/** Earnings repair walks back `REPAIR_SPAN_DAYS` at a time from two days ago to `REPAIR_LOOKBACK_DAYS`, then wraps. */
export const REPAIR_SPAN_DAYS = 5;
export const REPAIR_LOOKBACK_DAYS = 60;

/** The window [from, to] (inclusive dates) for repair step `step`, and the next step. */
export function repairWindow(step: number, today: string): { from: string; to: string; next: number } {
  const laps = Math.ceil((REPAIR_LOOKBACK_DAYS - 2) / REPAIR_SPAN_DAYS);
  const k = ((Math.floor(step) % laps) + laps) % laps;
  const base = Date.parse(`${today}T00:00:00Z`);
  const to = new Date(base - (2 + k * REPAIR_SPAN_DAYS) * 86400000).toISOString().slice(0, 10);
  const from = new Date(base - (2 + (k + 1) * REPAIR_SPAN_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to, next: (k + 1) % laps };
}
