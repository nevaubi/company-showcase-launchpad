// Statement currency: one precise line saying which period the statements run through and which
// newer report or release exists, plus (on the Financials tab) the read-time extension that adds a
// newer 10-Q/10-K straight from the filing's inline XBRL.
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleDot, ExternalLink } from "lucide-react";
import { getFilingDocument } from "@/lib/sec.functions";
import { companyCiks, coverageOf } from "@/lib/coverage";
import { assessCurrency, dayLabel, filingCik, filingUrl, missingReports, type Currency } from "@/lib/financials/currency";
import type { Extension, FiledReport } from "@/lib/financials/extend";
import { extendInBrowser } from "@/lib/financials/extend-browser";
import type { CompanyDataset, Filing } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

const ciksOf = (ticker: string, d: CompanyDataset) => {
  const c = coverageOf(ticker);
  return c ? companyCiks(c) : [String(Number(d.profile.cik))];
};

/** At most this many filings are read at view time (Citigroup lacks three 10-Qs in SEC companyfacts). */
const MAX_READS = 4;

/** Filings the extension reads: every report the statements miss, plus the Q3 10-Q a new 10-K's fourth quarter needs. */
export function readPlan(d: CompanyDataset, currency: Currency): Filing[] {
  const missing = missingReports(d).filter((f) => f.ixbrl !== false && f.doc).slice(-MAX_READS);
  if (!missing.length) return [];
  const support = missing.some((f) => f.form.startsWith("10-K")) && currency.included?.form === "10-Q" ? d.filings.find((f) => f.accn === currency.included!.accn) : undefined;
  return support && !missing.some((f) => f.accn === support.accn) ? [support, ...missing] : missing;
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
}

/** The company's statements with any newer 10-Q/10-K read from SEC at view time. */
export function useFiledStatements(d: CompanyDataset | undefined, ticker: string, opts: { enabled?: boolean } = {}): FiledStatements {
  const enabled = opts.enabled ?? true;
  const ciks = useMemo(() => (d ? ciksOf(ticker, d) : []), [d, ticker]);
  const served = useMemo(() => (d ? assessCurrency(d, { ciks }) : undefined), [d, ciks]);
  const plan = useMemo(() => (enabled && d && served && served.status === "behind" ? readPlan(d, served) : []), [enabled, d, served]);
  const docs = useQueries({
    queries: plan.map((f) => {
      const cik = filingCik(f.accn, d!.profile.cik, ciks);
      return {
        queryKey: ["filing-doc", cik, f.accn, f.doc],
        queryFn: () => getFilingDocument({ data: { cik, accn: f.accn, doc: f.doc } }),
        staleTime: Infinity,
        gcTime: 10 * 60_000,
        retry: 1,
      };
    }),
  });
  const ready = plan.length > 0 && docs.every((q) => q.isSuccess);
  const ext = useQuery({
    queryKey: ["filed-statements", ticker, d?.generatedAt, plan.map((f) => f.accn).join(",")],
    enabled: ready,
    queryFn: () =>
      extendInBrowser(
        d!,
        plan.map((f, i): { filing: FiledReport; html: string } => ({
          filing: { accn: f.accn, form: f.form, filed: f.filed, report: f.report, doc: f.doc },
          html: (docs[i].data as { html: string }).html,
        })),
      ),
    staleTime: Infinity,
    retry: false,
  });
  const extended = ext.data && ext.data.added.length ? ext.data : undefined;
  const dataset = extended?.dataset ?? d;
  const current = useMemo(() => (extended ? assessCurrency(extended.dataset, { ciks }) : served), [extended, served, ciks]);
  return {
    dataset,
    served,
    current,
    extension: extended,
    reading: plan.length > 0 && !ext.isFetched && !docs.some((q) => q.isError),
    failed: docs.some((q) => q.isError) || ext.isError,
  };
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Sentence for the periods read at view time. */
export function readSentence(d: CompanyDataset, ext: Extension): string {
  const labels = ext.added.flatMap((a) => {
    const q = a.quarterly.map((k) => d.statements.quarterly.income.periods.find((p) => p.key === k)?.label ?? k);
    const y = a.annual.map((k) => d.statements.annual.income.periods.find((p) => p.key === k)?.label ?? k);
    return [...y, ...q];
  });
  const forms = [...new Set(ext.added.map((a) => a.form))];
  const dates = ext.added.map((a) => dayLabel(a.filed));
  const one = labels.length === 1;
  return `${one ? "The" : ""}${one ? ` ${labels[0]} column is` : `${labels.length} columns (${list(labels)}) are`} read at view time from the ${list(forms)}${ext.added.length > 1 ? "s" : ""} filed on ${list(dates)}; the scheduled rebuild has not added ${one ? "it" : "them"} yet.`;
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
  const through = c.text.split(". ")[0] + ".";
  const rest = c.text.slice(through.length).trim();
  return (
    <p data-section="Statement currency" className={cn("flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground", className)}>
      <Icon className={cn("size-3.5 shrink-0 translate-y-0.5", behind ? "text-warning" : "text-muted-foreground/70")} aria-hidden />
      <span className="text-foreground">{through}</span>
      {read && <span>{read}</span>}
      {(behind || !read) && rest && <span>{rest}</span>}
      {filed?.reading && <span className="text-muted-foreground/80">Reading the newer filing from SEC.</span>}
      {filed?.failed && !ext && <span className="text-muted-foreground/80">The newer filing could not be read here, so the tables show the scheduled build only.</span>}
      {link && (
        <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {link.label}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </p>
  );
}
