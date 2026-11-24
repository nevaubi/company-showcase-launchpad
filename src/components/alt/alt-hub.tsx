import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceButton } from "@/components/source/evidence-button";
import { AltRecords } from "@/components/alt/alt-records";
import { CellSheet, Spark } from "@/components/alt/alt-signals";
import { DATASETS, THEMES, fmtAlt, fmtChange, fmtDay, type AltTheme } from "@/lib/alt/catalog";
import { bpChange, RED_FLAG_8K } from "@/lib/alt/company";
import { isCurrent, newestFinished } from "@/lib/alt/history";
import type { UnusualItem } from "@/lib/alt/hub";
import { asOfLabel } from "@/lib/alt/periods";
import { altFeedQuery, altRedFlagsQuery, altSettledLeadersQuery, altSourceStatsQuery, altUnusualQuery, leaderStats, RED_FLAG_DAYS } from "@/lib/alt/query";
import { FTD_TITLE } from "@/lib/alt/ftd";
import { cn } from "@/lib/utils";

export type ThemeFilter = AltTheme | "all";
const inTheme = (dataset: string, theme: ThemeFilter) => theme === "all" || DATASETS[dataset]?.theme === theme;

function Pager({ page, pages, total, size, onPage }: { page: number; pages: number; total: number; size: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex h-8 items-center justify-end gap-1 border-t px-2 text-[11px] text-muted-foreground">
      <span className="num mr-1">{page * size + 1}–{Math.min(total, (page + 1) * size)} of {total}</span>
      <Button variant="ghost" size="xs" className="size-7 p-0" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft className="size-3.5" /></Button>
      <Button variant="ghost" size="xs" className="size-7 p-0" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}><ChevronRight className="size-3.5" /></Button>
    </div>
  );
}

/** Empty rows that keep a paged table at its full page height, so paging never moves the pager or the page. */
export function PadRows({ n, cols }: { n: number; cols: number }) {
  return <>{Array.from({ length: Math.max(0, n) }, (_, i) => <tr key={`pad${i}`} aria-hidden className="h-7"><td colSpan={cols} /></tr>)}</>;
}

const KIND_LABEL: Record<UnusualItem["kind"], string> = { rise: "Count above every earlier window", range: "Reading outside its own range" };

/** Everything unusual for its own company right now: counts that rose, then readings outside their range, each ranked by its own test. */
export function UnusualNow({ theme, find }: { theme: ThemeFilter; find: string }) {
  const q = useQuery(altUnusualQuery());
  const [page, setPage] = useState(0);
  const [cell, setCell] = useState<UnusualItem | null>(null);
  const f = find.trim().toUpperCase();
  const list = (q.data?.items ?? []).filter((i) => inTheme(i.dataset, theme) && (!f || i.ticker.startsWith(f)));
  const size = 12;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(page, pages - 1);
  const shown = list.slice(p * size, p * size + size);
  const d = q.data;
  return (
    <Panel
      collapse={false}
      bodyClassName="p-0"
      className="rounded-md border bg-card shadow-paper"
      title="Unusual now"
      subtitle={`Counts of filings and recalls in the last 90 days above every earlier 90-day window collected the same way (exact test, at least a year of stored history), and readings outside the company's own range${d ? ` · ${d.tested.toLocaleString("en-US")} company datasets tested${d.short ? `, ${d.short.toLocaleString("en-US")} set aside with under a year of stored history` : ""}` : ""}`}
    >
      {q.isLoading ? <Skeleton className="m-3.5 h-[364px]" /> : q.isError && !q.data ? (
        <div role="alert" className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-muted-foreground">Activity checks are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>
      ) : (
        <>
          {!!d?.failed.length && <p role="alert" className="border-b px-3.5 py-1.5 text-[11px] text-muted-foreground">Not checked this time: {d.failed.join(", ")}.</p>}
          {!list.length ? <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{f ? "Nothing unusual for that ticker." : "Nothing unusual right now: no count or reading passes its test."}</p> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed text-[13px]">
                  <colgroup><col className="w-[120px]" /><col className="w-[150px]" /><col /><col className="w-[96px]" /><col className="w-[96px]" /><col className="w-[84px]" /></colgroup>
                  <thead>
                    <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                      <th className="pl-3.5 font-normal">Company</th><th className="font-normal">Dataset</th><th className="font-normal">What is unusual</th><th className="pl-2 font-normal">Windows</th><th className="text-right font-normal">Latest</th><th className="pr-3.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((i, n) => (
                      <Fragment key={`${i.ticker}|${i.dataset}|${i.text}`}>
                        {(n === 0 || shown[n - 1].kind !== i.kind) && <tr className="h-7 bg-secondary/30 [&>td]:shadow-[inset_0_-1px_0_var(--border)]"><td colSpan={6} className="pl-3.5 text-[11px] text-muted-foreground">{KIND_LABEL[i.kind]}</td></tr>}
                        <tr className="h-7 [&>td]:shadow-[inset_0_-1px_0_var(--border)] last:[&>td]:shadow-none hover:bg-secondary/40">
                          <td className="truncate pl-3.5"><TickerMark ticker={i.ticker} /></td>
                          <td className="truncate text-[12px]">{DATASETS[i.dataset]?.label ?? i.dataset}</td>
                          <td className="truncate pr-2" title={`${i.text}. ${i.rule}`}><span className={cn("mr-1.5 text-[11px]", i.direction === "up" ? "text-warning" : "text-muted-foreground")}>{i.direction === "up" ? "▲" : "▼"}</span>{i.text}</td>
                          <td className="pl-2">{i.history ? <Spark h={i.history} /> : <span className="text-[11px] text-muted-foreground">series</span>}</td>
                          <td className="num text-right text-[11px] text-muted-foreground">{fmtDay(i.date)}</td>
                          <td className="pr-3.5 text-right">
                            {i.history ? (
                              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setCell(i)}>Records</Button>
                            ) : (
                              <Link to="/app/companies/$ticker/alt-data" params={{ ticker: i.ticker }} className="inline-flex min-h-7 items-center px-2 text-[12px] text-muted-foreground hover:text-foreground">Series</Link>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                    {/* every page keeps the height of a full page with both group headers */}
                    {pages > 1 && <PadRows n={size + 2 - shown.length - new Set(shown.map((x) => x.kind)).size} cols={6} />}
                  </tbody>
                </table>
              </div>
              <Pager page={p} pages={pages} total={list.length} size={size} onPage={setPage} />
            </>
          )}
        </>
      )}
      <CellSheet cell={cell} onClose={() => setCell(null)} />
    </Panel>
  );
}

/** Series a leaderboard can rank companies by, each with what the ranking means. */
export const BOARDS: { key: string; dataset: string; title: string; label: string }[] = [
  { key: "contracts", dataset: "contracts", title: "Federal contract obligations", label: "Federal obligations, latest settled fiscal year" },
  { key: "medicareD", dataset: "medicare", title: "Medicare Part D spending", label: "Medicare Part D spending, latest full year" },
  { key: "medicareB", dataset: "medicare", title: "Medicare Part B spending", label: "Medicare Part B spending, latest full year" },
  { key: "ftd", dataset: "settlement", title: FTD_TITLE, label: "Fails to deliver, latest half-month" },
  { key: "attention", dataset: "attention", title: "Wikipedia pageviews", label: "Wikipedia pageviews, latest finished month" },
  { key: "complaints", dataset: "complaints", title: "CFPB consumer complaints", label: "CFPB complaints, latest full year" },
  { key: "regulatory", dataset: "regulatory", title: "Federal Register documents naming the company", label: "Federal Register documents, latest full year" },
  { key: "deposits", dataset: "bank", title: "Total deposits", label: "Bank deposits, latest quarter" },
  { key: "nco", dataset: "bank", title: "Net charge-off rate", label: "Bank net charge-off rate, latest quarter" },
  { key: "noncurrent", dataset: "bank", title: "Noncurrent loans / loans", label: "Bank noncurrent loans, latest quarter" },
  { key: "cet1", dataset: "bank", title: "CET1 ratio", label: "Bank CET1 ratio, latest quarter" },
  { key: "assets", dataset: "bank", title: "Total assets", label: "Bank assets, latest quarter" },
  { key: "loans", dataset: "bank", title: "Net loans & leases", label: "Bank net loans, latest quarter" },
  { key: "nim", dataset: "bank", title: "Net interest margin", label: "Bank net interest margin, latest quarter" },
  { key: "roa", dataset: "bank", title: "Return on assets", label: "Bank return on assets, latest quarter" },
  { key: "branch", dataset: "deposits", title: "Branch deposits", label: "Branch deposits, latest June 30 survey" },
  { key: "tri", dataset: "tri", title: "Toxic releases (TRI)", label: "Toxic releases, latest year" },
  { key: "triPlants", dataset: "tri", title: "TRI facilities", label: "Plants reporting to TRI, latest year" },
  { key: "triIndex", dataset: "tri", title: "TRI production index", label: "TRI production index, latest year" },
];

type LeadSort = "latest" | "typical" | "chg";

const YEARLY = new Set(["medicare", "complaints", "regulatory", "tri"]);
/** The period a leaderboard reading covers, worded by the series' cadence ("FY2025", "2025", "2026-10", "2026-06-30"). */
export function leaderPeriod(dataset: string, r: { date: string; meta?: Record<string, unknown> | null }, today: string): string {
  if (r.meta?.fiscal_year) return `FY${r.meta.fiscal_year}`;
  if (dataset === "attention") return r.date.slice(0, 7);
  if (YEARLY.has(dataset) && r.date.slice(5) === "12-31") return r.date.slice(0, 4);
  return asOfLabel(r, today);
}

/** Companies ranked by one series: size, against their own normal, or against a year earlier. */
export function Leaders({ theme, find = "" }: { theme: ThemeFilter; find?: string }) {
  const boards = BOARDS.filter((b) => inTheme(b.dataset, theme));
  const [key, setKey] = useState(BOARDS[0].key);
  const board = boards.find((b) => b.key === key) ?? boards[0] ?? BOARDS[0];
  const q = useQuery({ ...altSettledLeadersQuery(board.dataset, board.title), enabled: boards.length > 0 });
  const f = find.trim().toUpperCase();
  const [sort, setSort] = useState<LeadSort>("latest");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const all = (q.data ?? []).map((r) => ({ r, ...leaderStats(r) }));
    // ratio rankings only among companies at least the median size, so a tiny base can't top the list
    const sizes = all.map((x) => Math.abs(x.r.value)).sort((a, b) => a - b);
    const floor = sort === "latest" ? -Infinity : sizes[Math.floor(sizes.length / 2)] ?? -Infinity;
    const keyOf = (x: (typeof all)[number]) => (sort === "latest" ? x.r.value : sort === "typical" ? x.vsTypical : x.chg) ?? -Infinity;
    const ranked = all.filter((x) => Math.abs(x.r.value) >= floor).sort((a, b) => keyOf(b) - keyOf(a)).map((x, i) => ({ ...x, rank: i + 1 }));
    // the ticker filter keeps each company's rank among all companies
    return f ? ranked.filter((x) => x.r.ticker.startsWith(f)) : ranked;
  }, [q.data, sort, f]);
  const settled = (q.data ?? []).filter((r) => r.settledFrom).length;
  const size = 12;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages - 1);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Panel
      collapse={false}
      bodyClassName="p-0"
      className="min-w-0 rounded-md border bg-card shadow-paper"
      title="Leaderboard"
      subtitle={boards.length ? `${board.label} · ${q.data?.length ?? "…"} companies${sort !== "latest" ? " · ranked among the larger half" : ""}${settled ? ` · ${settled} still-running periods shown as the period before, without comparisons` : ""}` : "No series to rank companies by in this theme"}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={board.key} onChange={(e) => { setKey(e.target.value); setPage(0); }} aria-label="Leaderboard series" className="h-7 max-w-[220px] rounded-[4px] border bg-background px-2 text-[12px]">
            {boards.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <Segmented size="xs" label="Rank by" value={sort} onChange={(v) => { setSort(v); setPage(0); }} options={[{ v: "latest", l: "Size" }, { v: "typical", l: "vs normal", title: "Latest reading ÷ the company's median over the prior year" }, { v: "chg", l: "vs 1y", title: "Change against the reading a year earlier" }]} />
        </div>
      }
    >
      {!boards.length ? null : q.isLoading ? <Skeleton className="m-3.5 h-[392px]" /> : q.isError && !q.data ? <div role="alert" className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-muted-foreground">Readings are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => q.refetch()}>Retry</Button></div> : !rows.length ? <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{f ? "No reading for that ticker in this series." : "No readings for this series."}</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead>
                <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                  <th className="w-8 pl-3.5 text-right font-normal">#</th><th className="pl-3 font-normal">Company</th><th className="font-normal">Period</th><th className="text-right font-normal">Latest</th><th className="text-right font-normal">vs normal</th><th className="text-right font-normal">vs 1y</th><th className="w-[72px] pr-2" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(p * size, p * size + size).map(({ r, chg, vsTypical, rank }) => (
                  <tr key={r.ticker} className="h-7 [&>td]:shadow-[inset_0_-1px_0_var(--border)] last:[&>td]:shadow-none hover:bg-secondary/40">
                    <td className="num pl-3.5 text-right text-[11px] text-muted-foreground">{rank}</td>
                    <td className="pl-3"><TickerMark ticker={r.ticker} /></td>
                    <td className="num truncate text-[11px] text-muted-foreground" title={r.settledFrom ? `Newest reading (${r.settledFrom}) covers a period still running` : undefined}>{leaderPeriod(board.dataset, r, today)}</td>
                    <td className="num text-right font-medium">{fmtAlt(r.value, r.unit)}</td>
                    <td className="num text-right">{vsTypical == null ? "–" : vsTypical >= 100 ? "≥100×" : vsTypical < 0.05 ? "<0.1×" : `${vsTypical.toFixed(1)}×`}</td>
                    <td className={cn("num text-right", chg == null ? "text-muted-foreground" : chg >= 0 ? "text-positive" : "text-negative")}>{r.unit === "%" && r.prior_value != null ? bpChange(r.value - r.prior_value) : fmtChange(chg)}</td>
                    <td className="pr-2 text-right">{r.source_url && <EvidenceButton ticker={r.ticker} title={board.label} url={r.source_url} date={r.date} />}</td>
                  </tr>
                ))}
                {pages > 1 && <PadRows n={size - rows.slice(p * size, p * size + size).length} cols={7} />}
              </tbody>
            </table>
          </div>
          <Pager page={p} pages={pages} total={rows.length} size={size} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

/** Activist stakes and red-flag 8-K items (the company tab's list) in the last 90 days, with counts by kind. */
export function MaterialFilings({ theme = "all", find }: { theme?: ThemeFilter; find: string }) {
  const q = useQuery(altRedFlagsQuery(Object.keys(RED_FLAG_8K)));
  const f = find.trim().toUpperCase();
  const rows = useMemo(() => [...(q.data ?? [])].filter((r) => inTheme(r.dataset, theme) && (!f || r.ticker.startsWith(f))).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.uid.localeCompare(b.uid)), [q.data, f, theme]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.dataset === "ownership" ? "Activist 13D" : RED_FLAG_8K[r.meta?.item] ?? "Other";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  return (
    <Panel collapse={false} bodyClassName="p-0" className="min-w-0 rounded-md border bg-card shadow-paper" title="Material filings" subtitle={`Activist 13D stakes and red-flag 8-K items (bankruptcy, cyber incident, debt acceleration, restructuring, impairment, listing notice, auditor change, restatement), last ${RED_FLAG_DAYS} days`}>
      {q.isLoading ? <Skeleton className="m-3.5 h-[364px]" /> : q.isError && !q.data ? (
        <div role="alert" className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-muted-foreground">Filings are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>
      ) : (
        <>
          {counts.length > 0 && <p className="num border-b px-3.5 py-1.5 text-[11px] text-muted-foreground">{counts.map(([k, n]) => `${k} ${n}`).join(" · ")}</p>}
          <AltRecords rows={rows} showTicker pageSize={12} empty={f ? "No activist stake or red-flag 8-K item for that ticker in the last 90 days." : "No activist stakes or red-flag 8-K items in the last 90 days."} />
        </>
      )}
    </Panel>
  );
}

/** Every dataset: what it measures, coverage and freshness; a row opens its newest records. */
export function Catalogue({ theme, selected, onSelect }: { theme: ThemeFilter; selected: string | null; onSelect: (d: string) => void }) {
  const q = useQuery(altSourceStatsQuery());
  const stats = new Map((q.data ?? []).map((r) => [r.dataset, r]));
  const today = new Date().toISOString().slice(0, 10);
  const list = Object.entries(DATASETS).filter(([d]) => inTheme(d, theme));
  return (
    <Panel collapse={false} bodyClassName="p-0" className="min-w-0 rounded-md border bg-card shadow-paper" title="Datasets" subtitle="17 public datasets; each covers the companies the source names. Choose one to see its newest records across coverage.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
              <th className="pl-3.5 font-normal">Dataset</th><th className="font-normal">Theme</th><th className="font-normal">One row is</th><th className="font-normal">Source</th><th className="text-right font-normal">Companies</th><th className="text-right font-normal">Records</th><th className="pr-3.5 text-right font-normal">Newest record</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([d, info]) => {
              const s = stats.get(d);
              // the newest record as recent as the source publishes, not a fixed age (a yearly file is a year old by design)
              const newest = newestFinished(d, s?.latest, today);
              const stale = !isCurrent(d, newest, today);
              return (
                <tr key={d} className={cn("h-7 [&>td]:shadow-[inset_0_-1px_0_var(--border)] last:[&>td]:shadow-none", selected === d ? "bg-secondary/60" : "hover:bg-secondary/40")}>
                  <td className="pl-3.5">
                    <button type="button" onClick={() => onSelect(d)} aria-pressed={selected === d} className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={info.blurb}>{info.label}</button>
                  </td>
                  <td className="text-[12px] text-muted-foreground">{THEMES.find((t) => t.id === info.theme)?.label}</td>
                  <td className="max-w-[260px] truncate text-[12px] text-muted-foreground" title={info.blurb}>{info.measures}</td>
                  <td className="text-[12px] text-muted-foreground">{info.source} · {info.cadence.toLowerCase()}</td>
                  <td className="num text-right">{s ? Number(s.tickers).toLocaleString("en-US") : "–"}</td>
                  <td className="num text-right">{s ? Number(s.rows).toLocaleString("en-US") : "–"}</td>
                  <td className="num pr-3.5 text-right text-[12px]"><span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", !s ? "bg-muted-foreground/40" : stale ? "bg-warning" : "bg-positive")} aria-label={stale ? "older than the source's schedule allows" : "as recent as the source publishes"} title={s?.refreshed ? `Rows last written ${fmtDay(s.refreshed.slice(0, 10))}` : undefined} />{fmtDay(newest)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** The newest records of one dataset across coverage. */
export function DatasetFeed({ dataset }: { dataset: string }) {
  const q = useQuery(altFeedQuery(dataset));
  const info = DATASETS[dataset];
  return (
    <Panel collapse={false} bodyClassName="p-0" className="min-w-0 rounded-md border bg-card shadow-paper" title={`Newest ${info?.label.toLowerCase() ?? dataset}`} subtitle={`${info?.blurb ?? ""} · ${info?.source ?? ""}`}>
      {q.isLoading ? <Skeleton className="m-3.5 h-48" /> : q.isError && !q.data ? <div role="alert" className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-muted-foreground">Records are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => q.refetch()}>Retry</Button></div> : <AltRecords rows={q.data ?? []} showTicker pageSize={12} empty="This dataset is a series per company; see the leaderboard." />}
    </Panel>
  );
}

export type { UnusualItem };
