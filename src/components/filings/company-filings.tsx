// The company Filings tab's building blocks: the strip of latest key documents and the dense filing rows.
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, GitCompareArrows, Megaphone } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { FormChip } from "@/components/filings/parts";
import { describeFiling, familyOf } from "@/lib/filings/kinds";
import { canCompare, groupByYear, type KeyDocs, type ListFiling } from "@/lib/filings/list";
import { indexUrl } from "@/lib/filings/daily";
import type { EarningsRelease } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const action =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Open = ReturnType<typeof useSource>["open"];

const openFiling = (open: Open, ticker: string, f: ListFiling) => {
  const d = describeFiling(f);
  open({ ticker, label: d.title, periodLabel: f.report ? `period ${fmtDate(f.report)}` : `filed ${fmtDate(f.filed)}`, unit: "usd", value: 0, doc: { accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, title: `${f.form} filed ${fmtDate(f.filed)}` } });
};
const openRelease = (open: Open, ticker: string, r: EarningsRelease) =>
  open({ ticker, label: "Earnings release", periodLabel: `filed ${fmtDate(r.filed)}`, unit: "usd", value: 0, doc: { accn: r.accn, doc: r.doc, form: "8-K", filed: r.filed, title: `Exhibit 99.1 · earnings release filed ${fmtDate(r.filed)}` } });

/** Period column: the fiscal period for periodic and holdings reports; 8-K "report dates" are event dates, so not shown. */
const periodOf = (f: ListFiling) => (f.report && (familyOf(f.form) === "periodic" || /^13F/i.test(f.form)) ? f.report : null);

function ChangesLink({ ticker, f, label = "Changes" }: { ticker: string; f: ListFiling; label?: string }) {
  return (
    <Link to="/app/companies/$ticker/redline" params={{ ticker }} search={{ form: f.form.toUpperCase() as "10-K" | "10-Q", to: f.accn }} className={action} title="What changed against the prior comparable filing">
      <GitCompareArrows className="size-3.5" /> <span className={label === "Changes" ? "hidden lg:inline" : undefined}>{label}</span>
    </Link>
  );
}

function KeyCard({ label, children, empty }: { label: string; children?: React.ReactNode; empty?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-3.5 py-2.5">
      <p className="eyebrow">{label}</p>
      {children ?? <p className="text-[13px] text-muted-foreground">{empty ?? "None on file"}</p>}
    </div>
  );
}

/** Latest annual report, quarterly report, earnings release and proxy statement, each with open and compare actions. */
export function KeyDocStrip({ ticker, cik, keys, rows }: { ticker: string; cik: string; keys: KeyDocs<ListFiling, EarningsRelease>; rows: ListFiling[] }) {
  const { open } = useSource();
  const periodic = (f: ListFiling | null, label: string, period: string) => (
    <KeyCard label={label}>
      {f && (
        <>
          <button type="button" onClick={() => openFiling(open, ticker, f)} className="truncate text-left text-[13px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {f.form} · {period} {f.report ? fmtDate(f.report) : ""}
          </button>
          <p className="num text-[11px] text-muted-foreground">Filed {fmtDate(f.filed)}</p>
          <div className="-ml-1.5 flex flex-wrap items-center">
            <button type="button" className={action} onClick={() => openFiling(open, ticker, f)}>
              Open
            </button>
            {canCompare(f, rows) && <ChangesLink ticker={ticker} f={f} label="Changes vs prior" />}
            <a href={indexUrl(cik, f.accn)} target="_blank" rel="noreferrer" className={action} aria-label="Filing index on SEC.gov">
              SEC <ArrowUpRight className="size-3" />
            </a>
          </div>
        </>
      )}
    </KeyCard>
  );
  const rel = keys.release;
  return (
    <section data-section="Latest documents" aria-label="Latest documents" className="grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border bg-border sm:grid-cols-2 xl:grid-cols-4">
      {periodic(keys.annual, "Annual report", "year ended")}
      {periodic(keys.quarterly, "Quarterly report", "quarter ended")}
      <KeyCard label="Earnings release">
        {rel && (
          <>
            <button type="button" onClick={() => openRelease(open, ticker, rel.release)} className="flex min-w-0 items-center gap-1.5 text-left text-[13px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Megaphone className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">Exhibit 99.1 · {fmtDate(rel.release.filed, { month: "short", year: "numeric" })}</span>
            </button>
            <p className="num text-[11px] text-muted-foreground">Filed {fmtDate(rel.release.filed)} · 8-K Item 2.02</p>
            <div className="-ml-1.5 flex flex-wrap items-center">
              <button type="button" className={action} onClick={() => openRelease(open, ticker, rel.release)}>
                Open
              </button>
              {rel.filing && (
                <button type="button" className={action} onClick={() => openFiling(open, ticker, rel.filing!)}>
                  8-K
                </button>
              )}
              <a href={indexUrl(cik, rel.release.accn)} target="_blank" rel="noreferrer" className={action} aria-label="Filing index on SEC.gov">
                SEC <ArrowUpRight className="size-3" />
              </a>
            </div>
          </>
        )}
      </KeyCard>
      <KeyCard label="Proxy statement">
        {keys.proxy && (
          <>
            <button type="button" onClick={() => openFiling(open, ticker, keys.proxy!)} className="truncate text-left text-[13px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              DEF 14A · {fmtDate(keys.proxy.filed, { month: "short", year: "numeric" })}
            </button>
            <p className="num text-[11px] text-muted-foreground">Filed {fmtDate(keys.proxy.filed)}</p>
            <div className="-ml-1.5 flex flex-wrap items-center">
              <button type="button" className={action} onClick={() => openFiling(open, ticker, keys.proxy!)}>
                Open
              </button>
              <a href={indexUrl(cik, keys.proxy.accn)} target="_blank" rel="noreferrer" className={action} aria-label="Filing index on SEC.gov">
                SEC <ArrowUpRight className="size-3" />
              </a>
            </div>
          </>
        )}
      </KeyCard>
    </section>
  );
}

const GRID = "grid grid-cols-[3.25rem_minmax(0,1fr)_4.5rem] items-center gap-x-2 sm:gap-x-3 sm:grid-cols-[4rem_5.5rem_minmax(0,1fr)_6.5rem_6.5rem] lg:grid-cols-[4rem_5.5rem_minmax(0,1fr)_6.5rem_9rem]";

/** Dense filing rows for one page, under year headers: date, form, plain description, period, actions. */
export function FilingRows({ ticker, cik, rows, all, releases }: { ticker: string; cik: string; rows: ListFiling[]; all: ListFiling[]; releases: Map<string, EarningsRelease> }) {
  const { open } = useSource();
  return (
    <div role="table" aria-label="Filings" className="text-[13px]">
      <div role="row" className={cn(GRID, "border-b px-3.5 py-1.5 text-[11px] text-muted-foreground")}>
        <span role="columnheader">Filed</span>
        <span role="columnheader" className="hidden sm:block">
          Form
        </span>
        <span role="columnheader">Description</span>
        <span role="columnheader" className="hidden text-right sm:block">
          Period
        </span>
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>
      {groupByYear(rows).map((g) => (
        <div role="rowgroup" key={g.year}>
          <div role="row" className="border-b bg-secondary/40 px-3.5 py-1">
            <span role="cell" className="eyebrow">
              {g.year} · {g.rows.length}
            </span>
          </div>
          {g.rows.map((f) => {
            const d = describeFiling(f);
            const rel = releases.get(f.accn);
            const period = periodOf(f);
            return (
              <div role="row" key={f.accn} className={cn(GRID, "group min-h-8 border-b px-3.5 py-1 transition-colors duration-150 last:border-0 hover:bg-secondary/50")}>
                <span role="cell" className="num text-[12px] text-muted-foreground">
                  {fmtDate(f.filed, { month: "short", day: "numeric" })}
                </span>
                <span role="cell" className="hidden sm:block">
                  <FormChip form={f.form} />
                </span>
                <span role="cell" className="min-w-0">
                  <button type="button" onClick={() => openFiling(open, ticker, f)} className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <FormChip form={f.form} className="sm:hidden" />
                    <span className="truncate underline-offset-2 group-hover:underline">{d.title}</span>
                    {d.detail && <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground md:inline">{d.detail}</span>}
                  </button>
                </span>
                <span role="cell" className="num hidden text-right text-[12px] text-muted-foreground sm:block">
                  {period ? fmtDate(period) : "–"}
                </span>
                <span role="cell" className="flex items-center justify-end">
                  {rel && (
                    <button type="button" className={action} onClick={() => openRelease(open, ticker, rel)} title="Open the earnings release (Exhibit 99.1)">
                      <Megaphone className="size-3.5" /> <span className="hidden lg:inline">Release</span>
                    </button>
                  )}
                  {canCompare(f, all) && <ChangesLink ticker={ticker} f={f} />}
                  <a href={indexUrl(cik, f.accn)} target="_blank" rel="noreferrer" className={action} aria-label={`${f.form} filed ${f.filed}: filing index on SEC.gov`}>
                    <ArrowUpRight className="size-3.5" />
                  </a>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
