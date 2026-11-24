import { useMemo, useState } from "react";
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
import { daysBetween } from "@/lib/alt/derive";
import { rankUnusual, unusualFromBuckets, type UnusualItem } from "@/lib/alt/hub";
import { asOfLabel } from "@/lib/alt/periods";
import { altBucketsQuery, altFeedQuery, altLeadersQuery, altRedFlagsQuery, altSeriesUnusualQuery, altSourceStatsQuery, leaderStats } from "@/lib/alt/query";
import { RED_FLAG_ITEMS } from "@/lib/alt/signals";
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

/** Everything unusual for its own company right now, ranked by how far from normal it is. */
export function UnusualNow({ theme, find }: { theme: ThemeFilter; find: string }) {
  const b = useQuery(altBucketsQuery());
  const s = useQuery(altSeriesUnusualQuery());
  const [page, setPage] = useState(0);
  const [cell, setCell] = useState<{ ticker: string; dataset: string } | null>(null);
  const { items, newCoverage } = useMemo(() => {
    const ev = unusualFromBuckets(b.data ?? []);
    return { items: rankUnusual([...ev.items, ...(s.data ?? [])]), newCoverage: ev.newCoverage };
  }, [b.data, s.data]);
  const f = find.trim().toUpperCase();
  const list = items.filter((i) => inTheme(i.dataset, theme) && (!f || i.ticker.startsWith(f)));
  const size = 12;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(page, pages - 1);
  return (
    <Panel
      collapse={false}
      bodyClassName="p-0"
      className="rounded-md border bg-card shadow-paper"
      title="Unusual now"
      subtitle={`Readings far outside each company's own history: event counts in the last 90 days (Poisson tail below 0.005 and z ≥ 3, at least a year of history) and series readings (modified z ≥ 3.5)${newCoverage ? ` · ${newCoverage} company datasets only began to be collected and are not counted` : ""}`}
    >
      {b.isLoading ? <Skeleton className="m-3.5 h-64" /> : b.isError && !b.data ? (
        <div role="alert" className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-muted-foreground">Activity counts are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => b.refetch()}>Retry</Button></div>
      ) : !list.length ? <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{f ? "No unusual reading for that ticker." : "Nothing unusual right now."}</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                  <th className="w-[150px] pl-3.5 font-normal">Company</th><th className="w-[170px] font-normal">Dataset</th><th className="font-normal">What is unusual</th><th className="w-[64px] text-right font-normal" title="How far the reading is from the company's own normal, in z units">z</th><th className="w-[88px] pl-4 font-normal">History</th><th className="w-[96px] text-right font-normal">Latest</th><th className="w-[88px] pr-3.5" />
                </tr>
              </thead>
              <tbody>
                {list.slice(p * size, p * size + size).map((i) => (
                  <tr key={`${i.ticker}|${i.dataset}|${i.text}`} className="h-7 border-b last:border-0 hover:bg-secondary/40">
                    <td className="pl-3.5"><TickerMark ticker={i.ticker} /></td>
                    <td className="truncate text-[12px]">{DATASETS[i.dataset]?.label ?? i.dataset}</td>
                    <td className="max-w-0 truncate pr-2" title={`${i.text} · ${i.rule}`}><span className={cn("mr-1.5 text-[11px]", i.direction === "up" ? "text-warning" : "text-muted-foreground")}>{i.direction === "up" ? "▲" : "▼"}</span>{i.text}</td>
                    <td className="num text-right">{i.z.toFixed(1)}</td>
                    <td className="pl-4">{i.history ? <Spark h={i.history} /> : <span className="text-[11px] text-muted-foreground">series</span>}</td>
                    <td className="num text-right text-[11px] text-muted-foreground">{fmtDay(i.date)}</td>
                    <td className="pr-3.5 text-right">
                      {i.history ? (
                        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setCell({ ticker: i.ticker, dataset: i.dataset })}>Records</Button>
                      ) : (
                        <Link to="/app/companies/$ticker/alt-data" params={{ ticker: i.ticker }} className="inline-flex min-h-7 items-center px-2 text-[12px] text-muted-foreground hover:text-foreground">Series</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={p} pages={pages} total={list.length} size={size} onPage={setPage} />
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
  { key: "attention", dataset: "attention", title: "Wikipedia pageviews", label: "Wikipedia pageviews, latest month" },
  { key: "complaints", dataset: "complaints", title: "CFPB consumer complaints", label: "CFPB complaints, latest full year" },
  { key: "regulatory", dataset: "regulatory", title: "Federal Register documents naming the company", label: "Federal Register documents, latest full year" },
  { key: "deposits", dataset: "bank", title: "Total deposits", label: "Bank deposits, latest quarter" },
  { key: "nco", dataset: "bank", title: "Net charge-off rate", label: "Bank net charge-off rate, latest quarter" },
  { key: "noncurrent", dataset: "bank", title: "Noncurrent loans / loans", label: "Bank noncurrent loans, latest quarter" },
  { key: "cet1", dataset: "bank", title: "CET1 ratio", label: "Bank CET1 ratio, latest quarter" },
  { key: "tri", dataset: "tri", title: "Toxic releases (TRI)", label: "Toxic releases, latest year" },
];

type LeadSort = "latest" | "typical" | "chg";

/** Companies ranked by one series: size, against their own normal, or against a year earlier. */
export function Leaders({ theme }: { theme: ThemeFilter }) {
  const boards = BOARDS.filter((b) => inTheme(b.dataset, theme));
  const [key, setKey] = useState(BOARDS[0].key);
  const board = boards.find((b) => b.key === key) ?? boards[0] ?? BOARDS[0];
  const q = useQuery(altLeadersQuery(board.dataset, board.title));
  const [sort, setSort] = useState<LeadSort>("latest");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const all = (q.data ?? []).map((r) => ({ r, ...leaderStats(r) }));
    // ratio rankings only among companies at least the median size, so a tiny base can't top the list
    const sizes = all.map((x) => Math.abs(x.r.value)).sort((a, b) => a - b);
    const floor = sort === "latest" ? -Infinity : sizes[Math.floor(sizes.length / 2)] ?? -Infinity;
    const keyOf = (x: (typeof all)[number]) => (sort === "latest" ? x.r.value : sort === "typical" ? x.vsTypical : x.chg) ?? -Infinity;
    return all.filter((x) => Math.abs(x.r.value) >= floor).sort((a, b) => keyOf(b) - keyOf(a));
  }, [q.data, sort]);
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
      subtitle={`${board.label} · ${q.data?.length ?? "…"} companies${sort !== "latest" ? " · ranked among the larger half" : ""}`}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={board.key} onChange={(e) => { setKey(e.target.value); setPage(0); }} aria-label="Leaderboard series" className="h-7 max-w-[220px] rounded-[4px] border bg-background px-2 text-[12px]">
            {boards.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <Segmented size="xs" label="Rank by" value={sort} onChange={(v) => { setSort(v); setPage(0); }} options={[{ v: "latest", l: "Size" }, { v: "typical", l: "vs normal", title: "Latest reading ÷ the company's median over the prior year" }, { v: "chg", l: "vs 1y", title: "Change against the reading a year earlier" }]} />
        </div>
      }
    >
      {q.isLoading ? <Skeleton className="m-3.5 h-64" /> : q.isError && !q.data ? <div role="alert" className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-muted-foreground">Readings are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => q.refetch()}>Retry</Button></div> : !rows.length ? <p className="px-3.5 py-3 text-[13px] text-muted-foreground">No readings for this series.</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead>
                <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                  <th className="w-8 pl-3.5 text-right font-normal">#</th><th className="pl-3 font-normal">Company</th><th className="font-normal">Period</th><th className="text-right font-normal">Latest</th><th className="text-right font-normal">vs normal</th><th className="text-right font-normal">vs 1y</th><th className="w-[72px] pr-2" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(p * size, p * size + size).map(({ r, chg, vsTypical }, i) => (
                  <tr key={r.ticker} className="h-7 border-b last:border-0 hover:bg-secondary/40">
                    <td className="num pl-3.5 text-right text-[11px] text-muted-foreground">{p * size + i + 1}</td>
                    <td className="pl-3"><TickerMark ticker={r.ticker} /></td>
                    <td className="num truncate text-[11px] text-muted-foreground">{asOfLabel(r, today)}</td>
                    <td className="num text-right font-medium">{fmtAlt(r.value, r.unit)}</td>
                    <td className="num text-right">{vsTypical == null ? "–" : vsTypical >= 100 ? "≥100×" : `${vsTypical.toFixed(1)}×`}</td>
                    <td className={cn("num text-right", chg == null ? "text-muted-foreground" : chg >= 0 ? "text-positive" : "text-negative")}>{fmtChange(chg)}</td>
                    <td className="pr-2 text-right">{r.source_url && <EvidenceButton ticker={r.ticker} title={board.label} url={r.source_url} date={r.date} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={p} pages={pages} total={rows.length} size={size} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

/** Activist stakes and red-flag 8-K items in the last 90 days. */
export function MaterialFilings({ find }: { find: string }) {
  const q = useQuery(altRedFlagsQuery(Object.keys(RED_FLAG_ITEMS)));
  const f = find.trim().toUpperCase();
  const rows = useMemo(() => [...(q.data ?? [])].filter((r) => !f || r.ticker.startsWith(f)).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), [q.data, f]);
  return (
    <Panel collapse={false} bodyClassName="p-0" className="min-w-0 rounded-md border bg-card shadow-paper" title="Material filings" subtitle="Activist 13D stakes and market-moving 8-K items, last 90 days">
      {q.isLoading ? <Skeleton className="m-3.5 h-64" /> : <AltRecords rows={rows} showTicker pageSize={12} empty="No activist stakes or market-moving 8-K items in the last 90 days." />}
    </Panel>
  );
}

const CADENCE_DAYS: Record<string, number> = { Daily: 10, Weekly: 21, "Twice a month": 45, Monthly: 60, Quarterly: 200, Yearly: 550 };

/** Every dataset: what it measures, coverage and freshness; a row opens its newest records. */
export function Catalogue({ theme, selected, onSelect }: { theme: ThemeFilter; selected: string | null; onSelect: (d: string) => void }) {
  const q = useQuery(altSourceStatsQuery());
  const stats = new Map((q.data ?? []).map((r) => [r.dataset, r]));
  const today = new Date().toISOString().slice(0, 10);
  const list = Object.entries(DATASETS).filter(([d]) => inTheme(d, theme));
  return (
    <Panel collapse={false} bodyClassName="p-0" className="min-w-0 rounded-md border bg-card shadow-paper" title="Datasets" subtitle="17 public datasets collected for every covered company. Choose one to see its newest records across coverage.">
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
              const stale = s?.latest ? daysBetween(s.latest, today) > (CADENCE_DAYS[info.cadence] ?? 60) : true;
              return (
                <tr key={d} className={cn("h-7 border-b last:border-0", selected === d ? "bg-secondary/60" : "hover:bg-secondary/40")}>
                  <td className="pl-3.5">
                    <button type="button" onClick={() => onSelect(d)} aria-pressed={selected === d} className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={info.blurb}>{info.label}</button>
                  </td>
                  <td className="text-[12px] text-muted-foreground">{THEMES.find((t) => t.id === info.theme)?.label}</td>
                  <td className="max-w-[260px] truncate text-[12px] text-muted-foreground" title={info.blurb}>{info.measures}</td>
                  <td className="text-[12px] text-muted-foreground">{info.source} · {info.cadence.toLowerCase()}</td>
                  <td className="num text-right">{s ? Number(s.tickers).toLocaleString("en-US") : "–"}</td>
                  <td className="num text-right">{s ? Number(s.rows).toLocaleString("en-US") : "–"}</td>
                  <td className="num pr-3.5 text-right text-[12px]"><span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", !s ? "bg-muted-foreground/40" : stale ? "bg-warning" : "bg-positive")} aria-label={stale ? "older than its usual cadence" : "current"} />{fmtDay(s?.latest)}</td>
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
