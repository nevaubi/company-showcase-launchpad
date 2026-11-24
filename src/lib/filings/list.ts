// The company Filings tab's list logic: scope (kind, year, words) held in the address, counts per
// kind, year groups and pages, and the strip of latest key documents. Pure, so the page stays thin.
import { describeFiling, familyOf, filedByIssuer, formName, isActiveStake, type FilingFamily } from "./kinds";
import { INSIDER_CODES } from "@/lib/format";

export interface ListFiling {
  accn: string;
  form: string;
  filed: string;
  report?: string;
  doc: string;
  desc?: string;
  items?: string;
}

/** "key" is every SEC filing except insider and holder forms (the default); "all" covers every SEC filing; "ir" is the stored IR document library (not SEC filings). */
export type ListKind = "key" | "all" | FilingFamily | "ir";

export interface ListScope {
  kind: ListKind;
  year: number | null;
  q: string;
  /** The company's CIK: tells its own Schedule 13D/G filings (about other issuers) from stakes in it. */
  cik?: string;
}

export const PAGE_SIZE = 50;

/** Newest first, then by accession so same-day filings keep a stable order. */
export const byFiledDesc = <T extends { filed: string; accn: string }>(a: T, b: T) =>
  b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn);

/** One copy per accession (the dataset and the live 60-day table can both list a filing). */
export function dedupeFilings<T extends { accn: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.accn) && (seen.add(r.accn), true));
}

/** Filings in each family, for the kind tabs. */
export function countByFamily(rows: ListFiling[]): Record<FilingFamily, number> {
  const out: Record<FilingFamily, number> = { periodic: 0, current: 0, ownership: 0, proxy: 0, offerings: 0, correspondence: 0, other: 0 };
  for (const r of rows) out[familyOf(r.form)]++;
  return out;
}

/** Calendar years that have filings, newest first. */
export const yearsOf = (rows: { filed: string }[]): number[] =>
  [...new Set(rows.map((r) => Number(r.filed.slice(0, 4))).filter((y) => y > 1990))].sort((a, b) => b - a);

/** Words a reader might type for a filing: form, plain description, item words, EDGAR description, dates. */
export function searchText(r: ListFiling, cik?: string): string {
  const d = describeFiling({ ...r, selfFiled: filedByIssuer(r.accn, cik) });
  // The accession is left out: its digits ("...-16-020258") matched year searches for other years.
  return [r.form, formName(r.form), d.title, d.detail, r.desc, r.items, r.filed, r.report].filter(Boolean).join(" ").toLowerCase();
}

/** Every term of the query must appear (so "results 2025" finds 2025 earnings releases). */
export function matchesQuery(text: string, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => text.includes(t));
}

/** Filings in scope, newest first. Kind "ir" is not a filing scope and returns nothing. */
export function scopeFilings(rows: ListFiling[], s: ListScope): ListFiling[] {
  if (s.kind === "ir") return [];
  return rows
    .filter((r) => (s.kind === "all" || (s.kind === "key" ? isKeyFiling(r, s.cik) : familyOf(r.form) === s.kind)) && (s.year == null || r.filed.startsWith(String(s.year))) && (!s.q.trim() || matchesQuery(searchText(r, s.cik), s.q)))
    .sort(byFiledDesc);
}

/**
 * Key filings: everything but ownership forms, except a Schedule 13D (an active, possibly activist
 * stake) filed by someone else about the company, which a reader wants to see first.
 */
export function isKeyFiling(r: ListFiling, cik?: string): boolean {
  if (familyOf(r.form) !== "ownership") return true;
  return isActiveStake(r.form) && !!cik && !filedByIssuer(r.accn, cik);
}

export interface Page<T> {
  rows: T[];
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
}

/** One page of rows (1-based); an out-of-range page is clamped. */
export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: p, pages, from: slice.length ? start + 1 : 0, to: start + slice.length, total: rows.length };
}

/** Consecutive rows grouped under their filing year (rows must already be sorted newest first). */
export function groupByYear<T extends { filed: string | null }>(rows: T[]): { year: string; rows: T[] }[] {
  const out: { year: string; rows: T[] }[] = [];
  for (const r of rows) {
    const y = r.filed ? r.filed.slice(0, 4) : "Undated";
    const last = out[out.length - 1];
    if (last && last.year === y) last.rows.push(r);
    else out.push({ year: y, rows: [r] });
  }
  return out;
}

export interface KeyDocs<F extends ListFiling, R> {
  annual: F | null;
  quarterly: F | null;
  release: { release: R; filing: F | null } | null;
  proxy: F | null;
}

/**
 * The latest of each document a reader opens first: annual report, quarterly report, earnings
 * release (the 8-K Item 2.02 exhibit) and proxy statement. Amendments do not replace an original.
 */
export function latestKeyDocs<F extends ListFiling, R extends { accn: string; filed: string }>(rows: F[], releases: R[]): KeyDocs<F, R> {
  const sorted = [...rows].sort(byFiledDesc);
  const first = (forms: string[]) => sorted.find((r) => forms.includes(r.form.toUpperCase()) && !!r.doc) ?? null;
  const rel = [...releases].sort((a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn))[0];
  return {
    annual: first(["10-K", "20-F", "40-F", "10-KT"]),
    quarterly: first(["10-Q"]),
    release: rel ? { release: rel, filing: sorted.find((r) => r.accn === rel.accn) ?? null } : null,
    proxy: first(["DEF 14A"]),
  };
}

/** Filing changes can be computed for a 10-K or 10-Q that has an earlier filing of the same form. */
export function canCompare(f: ListFiling, rows: ListFiling[]): boolean {
  const form = f.form.toUpperCase();
  if (form !== "10-K" && form !== "10-Q") return false;
  return rows.some((r) => r.form.toUpperCase() === form && r.filed < f.filed && !!r.doc);
}

/** Read and validate the Filings tab's address state; anything unknown falls back to the defaults. */
export const LIST_KINDS: ListKind[] = ["key", "all", "periodic", "current", "ownership", "proxy", "offerings", "correspondence", "other", "ir"];

export interface InsiderLike {
  accn: string;
  filed: string;
  date: string;
  owner: string;
  role: string;
  code: string;
  plan10b5: boolean;
  doc: string;
}

/**
 * Form 4 filings rebuilt from the company's insider trades (the dataset lists Form 4s there, one
 * row per transaction): one row per accession, described by owner, role and transaction kinds.
 */
export function insiderFilings(trades: InsiderLike[]): ListFiling[] {
  const by = new Map<string, InsiderLike[]>();
  for (const t of trades) by.set(t.accn, [...(by.get(t.accn) ?? []), t]);
  return [...by.values()].map((ts) => {
    const t = ts[0];
    const kinds = [...new Set(ts.map((x) => INSIDER_CODES[x.code] ?? x.code))];
    const who = [t.owner, t.role].filter(Boolean).join(", ");
    const plan = ts.some((x) => x.plan10b5) ? "10b5-1 plan" : null;
    return { accn: t.accn, form: "4", filed: t.filed, report: undefined, doc: t.doc, desc: [who, kinds.join(", "), plan].filter(Boolean).join(" · ") };
  });
}

/** A row of the live 60-day `sec_filings` table as the Filings tab reads it. */
export interface LiveFilingRow {
  accn: string;
  form: string;
  filed: string;
  report: string | null;
  doc: string | null;
  description: string | null;
  items: string | null;
}

export const liveToList = (r: LiveFilingRow): ListFiling => ({
  accn: r.accn,
  form: r.form,
  filed: r.filed,
  report: r.report ?? undefined,
  doc: r.doc ?? "",
  desc: r.description ?? undefined,
  items: r.items ?? undefined,
});

/**
 * Every filing the tab can list, one per accession. Live rows come first so their form wins
 * (a recorded trade does not say whether its filing was a 4 or a 4/A); then the company record;
 * then Form 4s rebuilt from recorded insider trades.
 */
export function mergeFilings(live: ListFiling[], record: ListFiling[], insider: ListFiling[]): ListFiling[] {
  return dedupeFilings([...live, ...record, ...insider]);
}

export interface ListCoverage {
  total: number;
  first: string | null;
  last: string | null;
  /** First day of the live table: every filing from then on is listed. */
  liveSince: string | null;
  /** Form 4s before `liveSince` come only from recorded insider trades: how many, and from when. */
  insiderBefore: number;
  insiderFirst: string | null;
}

/** What the list actually covers, for the copy above it (never claim more than this). */
export function listCoverage(rows: ListFiling[], insider: ListFiling[], liveSince: string | null): ListCoverage {
  let first: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    if (!first || r.filed < first) first = r.filed;
    if (!last || r.filed > last) last = r.filed;
  }
  const before = insider.filter((r) => !liveSince || r.filed < liveSince);
  const insiderFirst = before.reduce<string | null>((m, r) => (!m || r.filed < m ? r.filed : m), null);
  return { total: rows.length, first, last, liveSince, insiderBefore: before.length, insiderFirst };
}

/** EDGAR's own filing list for the company, optionally one form type and filings up to the end of a year. */
export function edgarListUrl(cik: string, opts: { type?: string; year?: number | null } = {}): string {
  const p = new URLSearchParams({ action: "getcompany", CIK: String(Number(cik)).padStart(10, "0"), owner: "include", count: "100" });
  if (opts.type) p.set("type", opts.type);
  if (opts.year) p.set("dateb", `${opts.year}1231`);
  return `https://www.sec.gov/cgi-bin/browse-edgar?${p.toString()}`;
}

/** Rows per filing year across a whole scoped list (not one page), keyed like `groupByYear`. */
export function yearTotals(rows: { filed: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const y = r.filed ? r.filed.slice(0, 4) : "Undated";
    m.set(y, (m.get(y) ?? 0) + 1);
  }
  return m;
}

/** Year header count: "34", or "15 of 34" when the page shows only part of the year. */
export const yearCount = (onPage: number, total: number | undefined) => (total == null || total === onPage ? onPage.toLocaleString() : `${onPage.toLocaleString()} of ${total.toLocaleString()}`);
