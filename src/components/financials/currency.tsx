// Statement currency: one precise line saying which period the statements run through and which
// newer report or release exists, plus (on the Financials tab) the read-time extension that adds a
// newer 10-Q/10-K straight from the filing's inline XBRL.
import { useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleDot, ExternalLink } from "lucide-react";
import { getFilingDocument } from "@/lib/sec.functions";
import { companyCiks, coverageOf } from "@/lib/coverage";
import { assessCurrency, dayLabel, filingCik, filingUrl, missingReports, type Currency } from "@/lib/financials/currency";
import type { Extension, FiledReport } from "@/lib/financials/extend";
import { extendInBrowser } from "@/lib/financials/extend-browser";
import type { CompanyDataset, Filing, Period } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

export const ciksOf = (ticker: string, d: CompanyDataset) => {
  const c = coverageOf(ticker);
  return c ? companyCiks(c) : [String(Number(d.profile.cik))];
};

/** At most this many filings are read at view time (Citigroup lacks three 10-Qs in SEC companyfacts). */
const MAX_READS = 4;
/**
 * Download budget for one view, in characters of primary document (about 25 MB). Filings are read
 * newest first; the next one is read only while the documents so far plus the largest one read
 * stays within it (Citigroup: one 14.6 MB 10-Q of three; JPMorgan: its 12.9 MB 10-K and the 11.5 MB
 * Q3 10-Q its fourth quarter needs).
 */
export const READ_BUDGET = 25 * 1024 * 1024;

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** The third-quarter 10-Q of a 10-K's year: its period of report ends 60 to 120 days before the year's. */
function thirdQuarterOf(d: CompanyDataset, k: Filing): Filing | undefined {
  if (!k.report) return undefined;
  return d.filings
    .filter((f) => f.form === "10-Q" && f.report && f.doc && f.ixbrl !== false)
    .filter((f) => { const n = daysBetween(f.report!, k.report!); return n >= 60 && n <= 120; })
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
}

/**
 * Filings the extension reads, oldest first: every report the statements miss (the newest four),
 * plus, for each missing 10-K, the Q3 10-Q its fourth quarter is derived from (the year less the
 * first nine months, as the builder does). `currency` is kept for callers.
 */
export function readPlan(d: CompanyDataset, currency: Currency): Filing[] {
  void currency;
  const missing = missingReports(d).filter((f) => f.ixbrl !== false && f.doc).slice(-MAX_READS);
  if (!missing.length) return [];
  const out = [...missing];
  for (const k of missing.filter((f) => f.form.startsWith("10-K"))) {
    const q3 = thirdQuarterOf(d, k);
    if (q3 && !out.some((f) => f.accn === q3.accn)) out.push(q3);
  }
  return out.sort((a, b) => a.filed.localeCompare(b.filed));
}

/** Reading order: newest missing filing first, each 10-K followed by the Q3 10-Q it needs. */
function readOrder(plan: Filing[], d: CompanyDataset): { filing: Filing; supportOf?: string }[] {
  const missing = new Set(missingReports(d).map((f) => f.accn));
  const main = plan.filter((f) => missing.has(f.accn)).sort((a, b) => b.filed.localeCompare(a.filed));
  const out: { filing: Filing; supportOf?: string }[] = [];
  for (const f of main) {
    out.push({ filing: f });
    if (!f.form.startsWith("10-K")) continue;
    const q3 = thirdQuarterOf(d, f);
    const p = q3 && plan.find((x) => x.accn === q3.accn && !missing.has(x.accn));
    if (p) out.push({ filing: p, supportOf: f.accn });
  }
  return out;
}

export interface UnreadFiling {
  accn: string;
  form: string;
  filed: string;
  report?: string;
  /** budget: left for the scheduled rebuild to keep the view light; failed: SEC or the size limit refused it */
  reason: "budget" | "failed";
}

export interface FiledStatements {
  /** The dataset with read-time periods added (the served dataset until they are read) */
  dataset: CompanyDataset | undefined;
  /** Currency of the served statements */
  served: Currency | undefined;
  /** Currency after the read-time periods */
  current: Currency | undefined;
  extension: Extension | undefined;
  reading: boolean;
  failed: boolean;
  /** Missing filings this view did not read (download budget, or the document could not be fetched) */
  unread?: UnreadFiling[];
  /** Characters of primary document downloaded for this view */
  bytes?: number;
}

/** What the view-time read produced: the extension (when a filing added a period), what was not read, and the download size. */
export interface FiledRead {
  extension: Extension | undefined;
  unread: UnreadFiling[];
  bytes: number;
}

/** Query key of the view-time read; the Financials tab, the Overview and the assistant share it, so a filing is read once. */
export const filedStatementsKey = (ticker: string, d: CompanyDataset | undefined, plan: Filing[]) => ["filed-statements", ticker, d?.generatedAt, plan.map((f) => f.accn).join(",")];

/**
 * Reads the planned filings one after another, newest first, within READ_BUDGET; a document that fails
 * (over the server's size limit, SEC refused) is listed and the others still count. Each document goes
 * through the query cache (key "filing-doc"), so one already read elsewhere is not downloaded again.
 */
export async function readFiledReports(qc: QueryClient, d: CompanyDataset, ciks: string[], plan: Filing[]): Promise<FiledRead> {
  const reads: { filing: FiledReport; html: string }[] = [];
  const unread: UnreadFiling[] = [];
  const skipped = new Set<string>();
  let spent = 0;
  let largest = 0;
  for (const { filing: f, supportOf } of readOrder(plan, d)) {
    const note = (reason: UnreadFiling["reason"]) => unread.push({ accn: f.accn, form: f.form, filed: f.filed, ...(f.report ? { report: f.report } : {}), reason });
    if (supportOf && skipped.has(supportOf)) continue;
    if (spent > 0 && spent + largest > READ_BUDGET) {
      skipped.add(f.accn);
      if (!supportOf) note("budget");
      continue;
    }
    const cik = filingCik(f.accn, d.profile.cik, ciks);
    try {
      const doc = await qc.fetchQuery({
        queryKey: ["filing-doc", cik, f.accn, f.doc],
        queryFn: () => getFilingDocument({ data: { cik, accn: f.accn, doc: f.doc } }),
        staleTime: Infinity,
        gcTime: 10 * 60_000,
        retry: 1,
      });
      const html = (doc as { html: string }).html;
      spent += html.length;
      largest = Math.max(largest, html.length);
      reads.push({ filing: { accn: f.accn, form: f.form, filed: f.filed, report: f.report, doc: f.doc }, html });
    } catch {
      skipped.add(f.accn);
      if (!supportOf) note("failed");
    }
  }
  const extension = reads.length ? await extendInBrowser(d, reads) : undefined;
  return { extension, unread: unread.sort((a, b) => a.filed.localeCompare(b.filed)), bytes: spent };
}

/** The hook's result from the read's state: the extended dataset once a filing added a period, the served one otherwise. */
function settle(d: CompanyDataset | undefined, served: Currency | undefined, ciks: string[], plan: Filing[], q: { data: FiledRead | undefined; error: boolean; fetched: boolean }): FiledStatements {
  const extended = q.data?.extension && q.data.extension.added.length ? q.data.extension : undefined;
  const unread = q.data?.unread ?? [];
  return {
    dataset: extended?.dataset ?? d,
    served,
    current: extended ? assessCurrency(extended.dataset, { ciks }) : served,
    extension: extended,
    reading: plan.length > 0 && !q.fetched,
    failed: q.error || (!extended && unread.some((u) => u.reason === "failed")),
    unread,
    bytes: q.data?.bytes ?? 0,
  };
}

/**
 * The same read outside React (the assistant's get_financials): the same plan, budget and query keys as
 * useFiledStatements, so a filing the page has read is not read again and the answer matches the page.
 */
export async function fetchFiledStatements(qc: QueryClient, d: CompanyDataset, ticker: string): Promise<FiledStatements & { plan: Filing[] }> {
  const ciks = ciksOf(ticker, d);
  const served = assessCurrency(d, { ciks });
  const plan = served.status === "behind" ? readPlan(d, served) : [];
  if (!plan.length) return { ...settle(d, served, ciks, plan, { data: undefined, error: false, fetched: true }), plan };
  try {
    const data = await qc.fetchQuery({ queryKey: filedStatementsKey(ticker, d, plan), queryFn: () => readFiledReports(qc, d, ciks, plan), staleTime: Infinity, retry: false });
    return { ...settle(d, served, ciks, plan, { data, error: false, fetched: true }), plan };
  } catch {
    return { ...settle(d, served, ciks, plan, { data: undefined, error: true, fetched: true }), plan };
  }
}

/** The company's statements with any newer 10-Q/10-K read from SEC at view time. */
export function useFiledStatements(d: CompanyDataset | undefined, ticker: string, opts: { enabled?: boolean } = {}): FiledStatements {
  const enabled = opts.enabled ?? true;
  const ciks = useMemo(() => (d ? ciksOf(ticker, d) : []), [d, ticker]);
  const served = useMemo(() => (d ? assessCurrency(d, { ciks }) : undefined), [d, ciks]);
  const plan = useMemo(() => (enabled && d && served && served.status === "behind" ? readPlan(d, served) : []), [enabled, d, served]);
  const qc = useQueryClient();
  const ext = useQuery({
    queryKey: filedStatementsKey(ticker, d, plan),
    enabled: plan.length > 0,
    queryFn: () => readFiledReports(qc, d!, ciks, plan),
    staleTime: Infinity,
    retry: false,
  });
  return useMemo(
    () => settle(d, served, ciks, plan, { data: ext.data, error: ext.isError, fetched: ext.isFetched }),
    [d, served, ciks, plan, ext.data, ext.isError, ext.isFetched],
  );
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** A column in prose, one style for years and quarters: "FY2026", "Q4 FY2026" (the column heads say "FY2026" and "Q4 FY26"). */
function columnName(periods: Period[], key: string): string {
  const p = periods.find((x) => x.key === key);
  if (!p || !Number.isFinite(p.fy)) return p?.label ?? key;
  return p.fq ? `Q${p.fq} FY${p.fy}` : `FY${p.fy}`;
}

/** Sentence for the periods read at view time. */
export function readSentence(d: CompanyDataset, ext: Extension): string {
  const quarter = (k: string) => columnName(d.statements.quarterly.income.periods, k);
  const year = (k: string) => columnName(d.statements.annual.income.periods, k);
  const labels = ext.added.flatMap((a) => [...a.annual.map(year), ...a.quarterly.map(quarter)]);
  // Each form with its own filing dates: "the 10-Q filed on 31 Jul 2026 and the 10-K filed on 3 Nov 2026".
  const forms = [...new Set(ext.added.map((a) => a.form))].map((form) => {
    const of = ext.added.filter((a) => a.form === form);
    return `the ${form}${of.length > 1 ? "s" : ""} filed on ${list(of.map((a) => dayLabel(a.filed)))}`;
  });
  const one = labels.length === 1;
  // A 10-K's fourth quarter is calculated: the year less the nine months its Q3 10-Q reported.
  const q4 = ext.added.filter((a) => a.form.startsWith("10-K")).flatMap((a) => a.quarterly.map(quarter));
  const derived = q4.length ? ` ${list(q4)} ${q4.length === 1 ? "is" : "are"} derived: the year less the first nine months.` : "";
  return `${one ? "The" : ""}${one ? ` ${labels[0]} column is` : `${labels.length} columns (${list(labels)}) are`} read at view time from ${list(forms)}; the scheduled rebuild has not added ${one ? "it" : "them"} yet.${derived}`;
}

/** Sentence for missing filings this view did not read. */
export function unreadSentence(unread: UnreadFiling[]): string {
  if (!unread.length) return "";
  const name = (u: UnreadFiling) => `the ${u.form} filed on ${dayLabel(u.filed)}`;
  const budget = unread.filter((u) => u.reason === "budget");
  const failed = unread.filter((u) => u.reason === "failed");
  const parts: string[] = [];
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  if (budget.length) parts.push(`${cap(list(budget.map(name)))} ${budget.length === 1 ? "was" : "were"} not read here, to keep the page light; the scheduled rebuild will add ${budget.length === 1 ? "it" : "them"}.`);
  if (failed.length) parts.push(`${cap(list(failed.map(name)))} could not be read here; the scheduled rebuild will add ${failed.length === 1 ? "it" : "them"}.`);
  return parts.join(" ");
}

/**
 * One quiet line: the period the statements run through and any newer report or release, with a
 * link to the filing. `filed` (from useFiledStatements) adds the read-time columns; without it the
 * line reports the served statements only (for the company header or Overview).
 */
export function StatementCurrency({ data, ticker, filed, className }: { data: CompanyDataset; ticker: string; filed?: FiledStatements; className?: string }) {
  const own = useMemo(() => assessCurrency(data, { ciks: ciksOf(ticker, data) }), [data, ticker]);
  const c = filed?.current ?? own;
  const ext = filed?.extension;
  const read = ext && filed?.dataset ? readSentence(filed.dataset, ext) : "";
  const unread = filed?.unread?.length ? unreadSentence(filed.unread) : "";
  const link = ext
    ? (() => {
        const a = ext.added.at(-1)!;
        const f = data.filings.find((x) => x.accn === a.accn);
        return { href: filingUrl(filingCik(a.accn, data.profile.cik, ciksOf(ticker, data)), a.accn, f?.doc), label: `${a.form} on SEC` };
      })()
    : c.newer[0]
      ? { href: c.newer[0].url, label: `${c.newer[0].kind === "release" ? "Release" : c.newer[0].form} on SEC` }
      : c.included
        ? { href: c.included.url, label: `${c.included.form} on SEC` }
        : null;
  const behind = c.status === "behind";
  const Icon = behind ? CircleDot : CircleCheck;
  // The first sentence, with its own full stop once (a one-sentence text already ends with it).
  const through = c.text.split(". ")[0].replace(/\.$/, "") + ".";
  const rest = c.text.slice(through.length).trim();
  return (
    <p data-section="Statement currency" className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-1.5 text-[13px] text-muted-foreground", className)}>
      <Icon className={cn("size-3.5 shrink-0 translate-y-0.5", behind ? "text-warning" : "text-muted-foreground/70")} aria-hidden />
      <span className="min-w-0">
        <span className="text-foreground">{through}</span>
        {read && <> {read}</>}
        {(behind || !read) && rest && <> {rest}</>}
        {filed?.reading && <span className="text-muted-foreground/80"> Reading the newer filing from SEC.</span>}
        {unread && <span className="text-muted-foreground/80"> {unread}</span>}
        {filed?.failed && !ext && !unread && <span className="text-muted-foreground/80"> The newer filing could not be read here, so the tables show the scheduled build only.</span>}
        {link && (
          <>
            {" "}
            <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {link.label}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </>
        )}
      </span>
    </p>
  );
}
