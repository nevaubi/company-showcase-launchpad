import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { FileText, Plus, Search } from "lucide-react";
import { PageHeader, Panel, Empty } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { CompanyPicker } from "@/components/firm/company-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { optionsSummary, useReportList, type ReportMeta } from "@/components/reports/use-reports";
import { useCoverage, useFirm } from "@/components/firm/firm-context";
import { useWatchlist } from "@/lib/workspace";
import { coverageOf } from "@/lib/coverage";
import { KIND_ORDER, KINDS } from "@/lib/reports/kinds";
import type { ReportKind } from "@/lib/reports/types";
import { fmtDate, fmtRelative } from "@/lib/format";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/reports")({
  validateSearch: z.object({ kind: z.enum(["all", "primer", "preview", "recap", "memo"]).optional() }),
  head: () => ({
    meta: [
      { title: "Report library — primers, earnings previews & recaps, IC memos — Filed Under" },
      { name: "description", content: "Always-ready, fully sourced company reports for your coverage and watchlist: primers, earnings previews, recaps and IC memos you can customize, brand and download." },
      { property: "og:title", content: "Report library — Filed Under" },
      { property: "og:description", content: "Sourced company primers, earnings previews, recaps and IC memos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportLibrary,
});

type ScopeFilter = "all" | "shared" | "firm" | "user";

function StatusCell({ r, ticker, kind }: { r: ReportMeta | undefined; ticker: string; kind: ReportKind }) {
  return (
    <Link to="/app/companies/$ticker/reports" params={{ ticker }} search={{ kind, v: undefined }}
      className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-secondary">
      <span className={cn("size-1.5 shrink-0 rounded-full",
        !r ? "bg-muted-foreground/30" : r.status === "ready" ? "bg-positive" : r.status === "generating" ? "animate-pulse bg-highlight" : "bg-negative")} />
      <span className={cn("truncate", !r && "text-muted-foreground group-hover:text-foreground")}>
        {!r ? "Write" : r.status === "generating" ? "Writing…" : r.status === "failed" ? "Failed" : fmtRelative(r.updated_at)}
      </span>
    </Link>
  );
}

function ReportLibrary() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const kind = search.kind ?? "all";
  const list = useReportList();
  const { firm } = useFirm();
  const coverage = useCoverage(firm?.id);
  const watch = useWatchlist();
  const [scope, setScope] = useSessionState<ScopeFilter>("reports:scope", "all", (v): v is ScopeFilter => v === "all" || v === "shared" || v === "firm" || v === "user");
  const [q, setQ] = useState("");

  const tracked = useMemo(() => {
    const out: { ticker: string; why: string }[] = [];
    const seen = new Set<string>();
    for (const c of coverage.data ?? []) if (!seen.has(c.ticker)) { seen.add(c.ticker); out.push({ ticker: c.ticker, why: firm?.name ?? "Firm coverage" }); }
    for (const w of watch.data ?? []) if (!seen.has(w.ticker)) { seen.add(w.ticker); out.push({ ticker: w.ticker, why: "Watchlist" }); }
    return out.filter((t) => coverageOf(t.ticker));
  }, [coverage.data, watch.data, firm?.name]);

  const baseBy = useMemo(() => {
    const m = new Map<string, ReportMeta>();
    for (const r of list.data ?? []) if (r.scope === "shared" && r.variant === "base") m.set(`${r.ticker}:${r.kind}`, r);
    return m;
  }, [list.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return (list.data ?? []).filter((r) =>
      (kind === "all" || r.kind === kind) &&
      (scope === "all" || r.scope === scope) &&
      (!needle || r.ticker.includes(needle) || (coverageOf(r.ticker)?.shortName ?? "").toUpperCase().includes(needle) || (r.title ?? "").toUpperCase().includes(needle)));
  }, [list.data, kind, scope, q]);

  const ready = (list.data ?? []).filter((r) => r.status === "ready").length;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Reports"
        title="Report library"
        description="Primers, earnings previews, recaps and IC memos written from SEC filings and market data, with every figure cited. Standard versions are shared and refresh when new filings land; customize your own and download them in your firm's branding."
        actions={
          <CompanyPicker onPick={(t) => navigate({ to: "/app/companies/$ticker/reports", params: { ticker: t }, search: { kind: kind === "all" ? "primer" : kind, v: undefined } })} exclude={new Set()} align="end">
            <Button variant="ink" size="sm"><Plus /> New report</Button>
          </CompanyPicker>
        }
      />

      <Panel title="Ready for your companies" subtitle={tracked.length ? `${tracked.length} ${tracked.length === 1 ? "company" : "companies"} from ${firm ? `${firm.name}'s coverage and ` : ""}your watchlist` : undefined} collapse={false}>
        {coverage.isLoading || watch.isLoading ? <Skeleton className="m-3 h-24" /> : !tracked.length ? (
          <Empty title="No companies yet" icon={<FileText />}>Follow companies or add them to your firm's coverage and their reports appear here. You can also open any company's Reports tab.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table className="research-table min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[34%]">Company</TableHead>
                  {KIND_ORDER.map((k) => <TableHead key={k}>{KINDS[k].short}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tracked.map(({ ticker, why }) => (
                  <TableRow key={ticker}>
                    <TableCell>
                      <Link to="/app/companies/$ticker/reports" params={{ ticker }} search={{ kind: "primer", v: undefined }} className="flex min-w-0 items-center gap-2">
                        <CompanyLogo ticker={ticker} size="xs" />
                        <span className="num font-medium">{ticker}</span>
                        <span className="truncate text-muted-foreground">{coverageOf(ticker)?.shortName}</span>
                        <span className="ml-auto hidden shrink-0 text-[10.5px] text-muted-foreground sm:inline">{why}</span>
                      </Link>
                    </TableCell>
                    {KIND_ORDER.map((k) => <TableCell key={k}><StatusCell r={baseBy.get(`${ticker}:${k}`)} ticker={ticker} kind={k} /></TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel
        title="All reports"
        subtitle={list.data ? `${ready} ready · ${list.data.length} total` : undefined}
        collapse={false}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company or title" className="h-7 w-44 pl-7 text-xs" aria-label="Search reports" />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2">
          <Segmented label="Report type" value={kind} onChange={(v) => navigate({ to: "/app/reports", search: { kind: v === "all" ? undefined : v }, replace: true })}
            options={[{ v: "all", l: "All" }, ...KIND_ORDER.map((k) => ({ v: k, l: KINDS[k].short }))]} />
          <Segmented label="Version" value={scope} onChange={setScope}
            options={[{ v: "all", l: "All versions" }, { v: "shared", l: "Standard" }, ...(firm ? [{ v: "firm" as const, l: firm.name }] : []), { v: "user", l: "Mine" }]} />
        </div>
        {list.isLoading ? <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
          : list.isError ? <p className="p-4 text-sm text-negative">Couldn't load reports. {(list.error as Error).message}</p>
          : !rows.length ? (
            <Empty title={list.data?.length ? "No reports match" : "No reports yet"} icon={<FileText />}>
              {list.data?.length ? "Try another type, version or search." : "Open a company's Reports tab and its standard primer is written automatically."}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table className="research-table min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[18%]">Company</TableHead>
                    <TableHead className="w-[12%]">Type</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-[18%]">Version</TableHead>
                    <TableHead className="w-[11%] text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate({ to: "/app/companies/$ticker/reports", params: { ticker: r.ticker }, search: { kind: r.kind, v: r.scope === "shared" ? undefined : r.id } })}>
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2">
                          <CompanyLogo ticker={r.ticker} size="xs" />
                          <span className="num font-medium">{r.ticker}</span>
                          <span className="truncate text-muted-foreground">{coverageOf(r.ticker)?.shortName}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{KINDS[r.kind].short}</TableCell>
                      <TableCell className="max-w-0">
                        <span className={cn("block truncate", r.status !== "ready" && "text-muted-foreground")}>
                          {r.status === "generating" && !r.title ? <span className="text-shimmer">Writing…</span> : r.status === "failed" && !r.title ? <span className="text-negative">Couldn't write — {r.error}</span> : r.title}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground"><span className="block truncate">{r.scope === "shared" ? "Standard" : `${r.scope === "firm" ? firm?.name ?? "Firm" : "Mine"} · ${optionsSummary(r.options)}`}</span></TableCell>
                      <TableCell className="num text-right text-xs text-muted-foreground" title={fmtDate(r.updated_at)}>{fmtRelative(r.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 200 && <p className="px-3.5 py-2 text-xs text-muted-foreground">Showing the latest 200 of {rows.length}. Narrow by type or search.</p>}
            </div>
          )}
      </Panel>
    </div>
  );
}
