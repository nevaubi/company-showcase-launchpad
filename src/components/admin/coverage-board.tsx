// Coverage on Admin → Data status: for every kind of data, how many companies have it complete,
// partial, not stored, stopped or not applicable; the company-by-kind matrix; and the list of
// companies in any one state with the sentence saying why. Rules: src/lib/coverage/corpora.ts;
// model and search params: src/lib/coverage/view.ts. The ledger is written once a day.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Download, X } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { useFits } from "@/components/ir/panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { COVERAGE } from "@/lib/coverage";
import { CORPORA, COVERAGE_STATES, STATE_LABEL, corpusOf, day, type CorpusGroup, type CoverageState } from "@/lib/coverage/corpora";
import { getCorpusCoverage, getCoverageMatrix } from "@/lib/coverage/coverage.functions";
import { companyCoverageQuery } from "@/lib/coverage/read";
import { filterMatrix, matrix, pct, signed, summaries, type CorpusRow, type CorpusSummary, type CoverageSearch } from "@/lib/coverage/view";
import { fmtInt, fmtRelative } from "@/lib/format";
import { toCsv } from "@/lib/research/files";
import { ROW_H, useWindowRange } from "@/lib/screener/window";
import { cn } from "@/lib/utils";

const NAMES = new Map(COVERAGE.map((c) => [c.ticker, c.shortName]));
const GROUPS: CorpusGroup[] = ["Filings", "Markets", "Investor relations", "Calls", "Supply chain", "Research"];
const STICKY = "top-[var(--sticky-top,3.5rem)]";
const STATE_TEXT: Record<CoverageState, string> = { full: "text-positive", partial: "text-warning", none: "text-negative", not_applicable: "text-muted-foreground", held: "text-warning" };
const STATE_BAR: Record<CoverageState, string> = { full: "bg-positive", partial: "bg-warning", none: "bg-negative/70", held: "bg-warning/40", not_applicable: "bg-muted-foreground/25" };

/**
 * One state as a small shape: told apart by form as well as colour. `bare`: the state is written
 * out beside the mark, so the mark itself says nothing to a screen reader.
 */
export function StateMark({ state, label, bare }: { state: CoverageState | null; label?: string; bare?: boolean }) {
  if (!state) return bare ? null : <span className="sr-only">no record</span>;
  const shape: Record<CoverageState, string> = {
    full: "size-2.5 rounded-full bg-positive",
    partial: "size-2.5 rounded-full border border-warning bg-[linear-gradient(90deg,var(--warning)_50%,transparent_50%)]",
    none: "size-2.5 rounded-full border border-negative",
    held: "size-2.5 rounded-[2px] border border-warning",
    not_applicable: "h-px w-2.5 bg-muted-foreground/60",
  };
  const text = label ? `${label}: ${STATE_LABEL[state]}` : STATE_LABEL[state];
  return (
    <span className="inline-flex size-4 items-center justify-center align-middle" title={bare ? undefined : text} aria-hidden={bare || undefined}>
      <span aria-hidden className={shape[state]} />
      {bare ? null : <span className="sr-only">{text}</span>}
    </span>
  );
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  const href = a.href;
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function CoverageBoard({ search, onSearch }: { search: CoverageSearch; onSearch: (patch: Partial<CoverageSearch>) => void }) {
  const readMatrix = useServerFn(getCoverageMatrix);
  const readCorpus = useServerFn(getCorpusCoverage);
  const q = useQuery({ queryKey: ["admin", "coverage", "matrix"], queryFn: () => readMatrix(), staleTime: 5 * 60_000 });
  const corpus = corpusOf(search.corpus);
  const list = useQuery({
    queryKey: ["admin", "coverage", "corpus", search.corpus],
    queryFn: () => readCorpus({ data: { corpus: search.corpus } }),
    enabled: !!corpus,
    staleTime: 5 * 60_000,
  });

  const sums = useMemo(() => (q.data ? summaries(q.data) : []), [q.data]);
  const m = useMemo(() => (q.data ? matrix(q.data) : { ids: [], rows: [] }), [q.data]);
  const shown = useMemo(() => filterMatrix(m.rows, m.ids, search, NAMES), [m, search]);
  const byTicker = useMemo(() => new Map((list.data ?? []).map((r) => [r.t, r])), [list.data]);

  if (q.isError) {
    return (
      <Panel title="Coverage" collapse={false}>
        <p className="text-sm text-muted-foreground">The coverage ledger could not be read: {(q.error as Error).message}</p>
      </Panel>
    );
  }
  if (!q.data) {
    return (
      <Panel title="Coverage" collapse={false}>
        <Skeleton className="h-72" />
      </Panel>
    );
  }
  if (!m.rows.length) {
    return (
      <Panel title="Coverage" collapse={false}>
        <p className="text-sm text-muted-foreground">The coverage ledger is empty. It is filled once a day by the worker's coverage step, after 07:00 UTC.</p>
      </Panel>
    );
  }

  const csv = () => {
    const date = new Date().toISOString().slice(0, 10);
    if (corpus) {
      const rows = shown.map((r) => {
        const x = byTicker.get(r.ticker);
        return [r.ticker, NAMES.get(r.ticker) ?? "", x ? STATE_LABEL[x.s] : "", x?.n ?? "", x?.d ?? "", x?.w ?? ""];
      });
      download(`coverage-${corpus.id}-${date}.csv`, toCsv(["Ticker", "Company", "State", "Items", "Newest", "Why"], rows));
    } else {
      const defs = m.ids.map((id) => corpusOf(id)!);
      const rows = shown.map((r) => [r.ticker, NAMES.get(r.ticker) ?? "", r.gaps, ...r.cells.map((s) => (s ? STATE_LABEL[s] : ""))]);
      download(`coverage-${date}.csv`, toCsv(["Ticker", "Company", "Not stored", ...defs.map((d) => d.label)], rows));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4" data-section="Coverage">
      <Panel
        title="Coverage"
        subtitle={`What is stored for each of ${fmtInt(m.rows.length)} companies, by kind of data · checked ${q.data.checked ? fmtRelative(q.data.checked) : "never"}`}
        collapse={false}
        bodyClassName="p-0"
      >
        <SummaryTable sums={sums} search={search} onSearch={onSearch} />
      </Panel>

      <Panel
        title={corpus ? `Companies · ${corpus.label}` : "Companies by kind of data"}
        subtitle={
          corpus
            ? corpus.what
            : "One mark per kind of data. Choose a kind of data above, or a column here, for the list with the reason for each company."
        }
        collapse={false}
        bodyClassName="p-0"
        actions={
          <Button size="xs" variant="outline" onClick={csv} disabled={!shown.length || (!!corpus && !list.data)}>
            <Download className="size-3.5" /> CSV
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2">
          <Input
            value={search.q}
            onChange={(e) => onSearch({ q: e.target.value })}
            placeholder="Ticker or company"
            aria-label="Filter companies by ticker or name"
            className="h-7 w-44 text-[13px]"
          />
          <Segmented<CoverageState | "all">
            label={corpus ? `Show companies by the state of ${corpus.label}` : "Show companies with any kind of data in this state"}
            size="xs"
            value={search.state || "all"}
            onChange={(v) => onSearch({ state: v === "all" ? "" : v })}
            options={[{ v: "all", l: "All" }, ...COVERAGE_STATES.map((s) => ({ v: s, l: STATE_LABEL[s] }))]}
          />
          {!corpus && (
            <Segmented<"ticker" | "gaps">
              label="Order of the companies"
              size="xs"
              value={search.sort}
              onChange={(v) => onSearch({ sort: v })}
              options={[
                { v: "ticker", l: "A to Z" },
                { v: "gaps", l: "Most missing first" },
              ]}
            />
          )}
          {corpus && (
            <Button size="xs" variant="ghost" onClick={() => onSearch({ corpus: "", state: "" })}>
              <X className="size-3.5" /> All kinds of data
            </Button>
          )}
          <span className="num ml-auto text-xs text-muted-foreground">
            {fmtInt(shown.length)} of {fmtInt(m.rows.length)} companies
          </span>
        </div>
        {!shown.length ? (
          <p className="px-3.5 py-6 text-sm text-muted-foreground">No company matches these filters.</p>
        ) : corpus ? (
          <CorpusList rows={shown.map((r) => r.ticker)} byTicker={byTicker} loading={!list.data} error={list.isError ? (list.error as Error).message : null} onOpen={(t) => onSearch({ co: t })} />
        ) : (
          <MatrixTable ids={m.ids} rows={shown} onCorpus={(id) => onSearch({ corpus: id })} onOpen={(t) => onSearch({ co: t })} />
        )}
      </Panel>

      <CompanyDialog ticker={search.co} onClose={() => onSearch({ co: "" })} />
    </div>
  );
}

function SummaryTable({ sums, search, onSearch }: { sums: CorpusSummary[]; search: CoverageSearch; onSearch: (patch: Partial<CoverageSearch>) => void }) {
  const cols: CoverageState[] = ["full", "partial", "none", "held", "not_applicable"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead className="border-b text-left text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3.5 py-2 font-normal">Kind of data</th>
            <th className="w-[180px] px-3.5 py-2 font-normal">Share of companies</th>
            {cols.map((s) => (
              <th key={s} className="w-[86px] px-2 py-2 text-right font-normal">
                {STATE_LABEL[s]}
              </th>
            ))}
            <th className="w-[92px] px-3.5 py-2 text-right font-normal" title="Change in the number of companies that are complete, over the last seven days on record">
              Complete, 7 days
            </th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => {
            const rows = sums.filter((s) => s.def.group === g);
            if (!rows.length) return null;
            return (
              <Fragment key={g}>
                <tr className="border-b bg-muted/40">
                  <th colSpan={cols.length + 3} scope="colgroup" className="px-3.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                    {g}
                  </th>
                </tr>
                {rows.map((s) => {
                  const on = search.corpus === s.def.id;
                  const total = COVERAGE_STATES.reduce((n, k) => n + s.counts[k], 0);
                  return (
                    <tr key={s.def.id} className={cn("border-b align-top last:border-b-0", on && "bg-accent/40")} data-corpus={s.def.id}>
                      <td className="px-3.5 py-2">
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => onSearch({ corpus: on ? "" : s.def.id, state: "" })}
                          className="rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {s.def.label}
                        </button>
                        <div className="mt-0.5 text-xs text-muted-foreground">{s.def.what}</div>
                      </td>
                      <td className="px-3.5 py-2">
                        <div className="flex h-2 w-full overflow-hidden rounded-sm bg-muted" role="img" aria-label={`${s.def.label}: ${cols.filter((k) => s.counts[k]).map((k) => `${STATE_LABEL[k]} ${s.counts[k]}`).join(", ")}`}>
                          {cols.map((k) => (s.counts[k] ? <span key={k} className={STATE_BAR[k]} style={{ width: `${(100 * s.counts[k]) / Math.max(1, total)}%` }} /> : null))}
                        </div>
                        <div className="num mt-1 text-xs text-muted-foreground">{pct(s.share)} complete</div>
                      </td>
                      {cols.map((k) => (
                        <td key={k} className="num px-2 py-2 text-right">
                          {s.counts[k] ? (
                            <button
                              type="button"
                              onClick={() => onSearch({ corpus: s.def.id, state: k })}
                              aria-label={`${s.def.label}: show the ${s.counts[k]} companies marked ${STATE_LABEL[k]}`}
                              className={cn(
                                "rounded-sm px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                k === "full" || k === "not_applicable" ? "text-foreground" : STATE_TEXT[k],
                                on && search.state === k && "bg-accent font-medium",
                              )}
                            >
                              {fmtInt(s.counts[k])}
                            </button>
                          ) : (
                            <span className="px-1 text-muted-foreground">0</span>
                          )}
                        </td>
                      ))}
                      <td
                        className={cn("num px-3.5 py-2 text-right", s.weekChange == null || s.weekChange === 0 ? "text-muted-foreground" : s.weekChange > 0 ? "text-positive" : "text-negative")}
                        title={s.weekFrom ? `Since ${day(s.weekFrom)}` : "No earlier day on record yet"}
                      >
                        {s.weekChange == null ? "–" : signed(s.weekChange)}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompanyCell({ ticker, onOpen }: { ticker: string; onOpen: (t: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(ticker)}
      title={`${NAMES.get(ticker) ?? ticker}: what is stored`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CompanyLogo ticker={ticker} size="2xs" decorative />
      <span className="font-medium">{ticker}</span>
      <span className="truncate text-muted-foreground">{NAMES.get(ticker) ?? ""}</span>
    </button>
  );
}

function MatrixTable({ ids, rows, onCorpus, onOpen }: { ids: string[]; rows: ReturnType<typeof matrix>["rows"]; onCorpus: (id: string) => void; onOpen: (t: string) => void }) {
  const [wrap, fits] = useFits<HTMLDivElement>();
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const [start, end] = useWindowRange(body, rows.length);
  const defs = ids.map((id) => corpusOf(id)!);
  const head = cn("border-b bg-card", fits && `sticky ${STICKY} z-20`);
  const span = ids.length + 2;
  return (
    <div ref={wrap} className={cn("relative", !fits && "overflow-x-auto scrollbar-thin")} style={{ overflowAnchor: "none" }}>
      <table className={cn("border-separate border-spacing-0 text-[13px] leading-5", fits ? "w-full" : "w-max min-w-full")}>
        <thead>
          <tr>
            <th scope="col" className={cn(head, "min-w-56 px-3.5 py-1.5 text-left align-bottom text-[11px] font-normal text-muted-foreground")}>
              Company
            </th>
            <th scope="col" className={cn(head, "w-14 px-2 py-1.5 text-right align-bottom text-[11px] font-normal text-muted-foreground")} title="Kinds of data with nothing stored">
              Missing
            </th>
            {defs.map((d) => (
              <th key={d.id} scope="col" className={cn(head, "w-7 px-0 py-1.5 align-bottom")}>
                <button
                  type="button"
                  onClick={() => onCorpus(d.id)}
                  title={`${d.label}: ${d.what} Click for the list.`}
                  className="mx-auto block rotate-180 rounded-sm text-[11px] font-normal leading-4 text-muted-foreground [writing-mode:vertical-rl] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {d.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={setBody}>
          {start > 0 && (
            <tr aria-hidden style={{ height: start * ROW_H }}>
              <td colSpan={span} />
            </tr>
          )}
          {rows.slice(start, end).map((r) => (
            <tr key={r.ticker} className="hover:bg-muted/40" style={{ height: ROW_H }} data-ticker={r.ticker}>
              <td className="max-w-0 truncate border-b px-3.5 py-0">
                <CompanyCell ticker={r.ticker} onOpen={onOpen} />
              </td>
              <td className={cn("num border-b px-2 py-0 text-right", r.gaps ? "text-negative" : "text-muted-foreground")}>{r.gaps}</td>
              {r.cells.map((s, i) => (
                <td key={ids[i]} className="border-b px-0 py-0 text-center">
                  <StateMark state={s} label={defs[i].label} />
                </td>
              ))}
            </tr>
          ))}
          {end < rows.length && (
            <tr aria-hidden style={{ height: (rows.length - end) * ROW_H }}>
              <td colSpan={span} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CorpusList({ rows, byTicker, loading, error, onOpen }: { rows: string[]; byTicker: Map<string, CorpusRow>; loading: boolean; error: string | null; onOpen: (t: string) => void }) {
  const [wrap, fits] = useFits<HTMLDivElement>();
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const [start, end] = useWindowRange(body, rows.length);
  const head = cn("border-b bg-card px-3.5 py-1.5 text-[11px] font-normal text-muted-foreground", fits && `sticky ${STICKY} z-20`);
  if (error) return <p className="px-3.5 py-6 text-sm text-muted-foreground">The list could not be read: {error}</p>;
  return (
    <div ref={wrap} className={cn("relative", !fits && "overflow-x-auto scrollbar-thin")} style={{ overflowAnchor: "none" }}>
      <table className={cn("table-fixed border-separate border-spacing-0 text-[13px] leading-5", fits ? "w-full" : "w-[980px]")}>
        <colgroup>
          <col className="w-64" />
          <col className="w-32" />
          <col className="w-24" />
          <col className="w-28" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={cn(head, "text-left")}>Company</th>
            <th scope="col" className={cn(head, "text-left")}>State</th>
            <th scope="col" className={cn(head, "text-right")}>Items</th>
            <th scope="col" className={cn(head, "text-left")}>Newest</th>
            <th scope="col" className={cn(head, "text-left")}>Why</th>
          </tr>
        </thead>
        <tbody ref={setBody}>
          {start > 0 && (
            <tr aria-hidden style={{ height: start * ROW_H }}>
              <td colSpan={5} />
            </tr>
          )}
          {rows.slice(start, end).map((t) => {
            const x = byTicker.get(t);
            return (
              <tr key={t} className="hover:bg-muted/40" style={{ height: ROW_H }} data-ticker={t}>
                <td className="truncate border-b px-3.5 py-0">
                  <CompanyCell ticker={t} onOpen={onOpen} />
                </td>
                <td className="truncate border-b px-3.5 py-0">
                  {x ? (
                    <span className={cn("inline-flex items-center gap-1", STATE_TEXT[x.s])}>
                      <StateMark state={x.s} bare />
                      {STATE_LABEL[x.s]}
                    </span>
                  ) : loading ? (
                    <span className="text-muted-foreground">…</span>
                  ) : null}
                </td>
                <td className="num border-b px-3.5 py-0 text-right">{x ? fmtInt(x.n) : ""}</td>
                <td className="num truncate border-b px-3.5 py-0 text-muted-foreground">{x?.d ? day(x.d) : ""}</td>
                <td className="truncate border-b px-3.5 py-0 text-muted-foreground" title={x?.w}>
                  {x?.w ?? ""}
                </td>
              </tr>
            );
          })}
          {end < rows.length && (
            <tr aria-hidden style={{ height: (rows.length - end) * ROW_H }}>
              <td colSpan={5} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** One company's row for every kind of data, with the sentence saying why and a link to the tab that shows it. */
function CompanyDialog({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const q = useQuery({ ...companyCoverageQuery(ticker || "-"), enabled: !!ticker });
  const rows = q.data?.rows ?? [];
  return (
    <Dialog open={!!ticker} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ticker ? <CompanyLogo ticker={ticker} size="xs" decorative /> : null}
            {ticker} · {NAMES.get(ticker) ?? ""}
          </DialogTitle>
          <DialogDescription>
            What is stored for this company, by kind of data{q.data?.checked ? ` · checked ${fmtRelative(q.data.checked)}` : ""}.{" "}
            {ticker ? (
              <Link to="/app/companies/$ticker" params={{ ticker }} className="underline underline-offset-2 hover:text-foreground">
                Open the company
              </Link>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {q.isError ? (
          <p className="text-sm text-muted-foreground">This company's rows could not be read: {(q.error as Error).message}</p>
        ) : !q.data ? (
          <Skeleton className="h-80" />
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">The ledger holds no row for {ticker}. It covers the companies of the coverage list.</p>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {GROUPS.map((g) => {
                const mine = rows.filter((r) => CORPORA.find((c) => c.id === r.corpus)?.group === g);
                if (!mine.length) return null;
                return (
                  <Fragment key={g}>
                    <tr className="border-b bg-muted/40">
                      <th colSpan={2} scope="colgroup" className="px-2 py-1 text-left text-[11px] font-medium text-muted-foreground">
                        {g}
                      </th>
                    </tr>
                    {mine.map((r) => {
                      const def = corpusOf(r.corpus)!;
                      return (
                        <tr key={r.corpus} className="border-b align-top last:border-b-0">
                          <th scope="row" className="w-44 px-2 py-1.5 text-left font-normal">
                            <div className="font-medium">{def.label}</div>
                            <div className={cn("mt-0.5 inline-flex items-center gap-1 text-xs", STATE_TEXT[r.state])}>
                              <StateMark state={r.state} bare />
                              {STATE_LABEL[r.state]}
                            </div>
                          </th>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {r.why}
                            {def.tab ? (
                              <>
                                {" "}
                                <Link to={`/app/companies/$ticker/${def.tab}` as "/app/companies/$ticker"} params={{ ticker }} className="whitespace-nowrap underline underline-offset-2 hover:text-foreground">
                                  Open tab
                                </Link>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
