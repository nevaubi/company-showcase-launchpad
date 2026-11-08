import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LoadingState from "@/components/ui/loading-state";
import { KpiInsightCards } from "@/components/company/kpi-insights";
import {
  filterIndex,
  KIND_LABEL,
  KIND_ORDER,
  kpiInsightsIndexQuery,
  kpiInsightsQuery,
  orderedRows,
  type IndexFilter,
  type KpiIndexRow,
} from "@/lib/insights/kpi";
import { useWatchlist } from "@/lib/workspace";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/insights")({
  head: () => ({
    meta: [
      { title: "Insights — Filed Under" },
      {
        name: "description",
        content:
          "What companies' reported KPIs, guidance, federal contracts, lobbying and trading records say together: verified insights and detected signals across coverage, each with its sources.",
      },
      { property: "og:title", content: "Insights — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Insights,
});

function Row({ r, open, onToggle }: { r: KpiIndexRow; open: boolean; onToggle: () => void }) {
  const detail = useQuery({ ...kpiInsightsQuery(r.ticker), enabled: open });
  return (
    <li className="border-b">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[2.25rem_5.5rem_minmax(0,1fr)] items-start gap-2 px-3 py-2.5 text-left hover:bg-secondary/40 md:grid-cols-[2.25rem_5.5rem_minmax(0,1fr)_14rem_6rem]">
        <CompanyLogo ticker={r.ticker} size="sm" />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{r.ticker}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{r.name}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-snug">{r.top?.title ?? r.reason}</span>
          {r.top && <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted-foreground">{r.top.text}</span>}
          {!r.top && r.signals.length > 1 && (
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
              Also: {r.signals.slice(1, 3).map((s) => s.reason).join("; ")}
            </span>
          )}
        </span>
        <span className="hidden flex-wrap gap-1 md:flex">
          {r.kinds.slice(0, 5).map((k) => (
            <span key={k} className="rounded bg-secondary px-1.5 py-px text-[10.5px] text-muted-foreground">
              {KIND_LABEL[k] ?? k}
            </span>
          ))}
        </span>
        <span className="hidden text-right text-[11px] text-muted-foreground md:block">
          <span className="num block">{r.n_insights ? `${r.n_insights} insights` : `${r.n_signals} signals`}</span>
          {fmtRelative(r.generated)}
        </span>
      </button>
      {open && (
        <div className="border-t bg-card/60 pb-2">
          {detail.isLoading && <LoadingState label="Loading evidence" variant="Dots" className="px-3.5 py-3" />}
          {detail.data && <KpiInsightCards f={detail.data} limit={6} />}
          <div className="px-3.5 pt-2 text-[11.5px]">
            <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} className="text-link hover:underline">
              Open {r.ticker}
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

function Insights() {
  const idx = useQuery(kpiInsightsIndexQuery);
  const watch = useWatchlist();
  const [f, setF] = useState<IndexFilter>({ sector: "all", kind: "all", scope: "all", q: "", withInsights: false });
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const rows = useMemo(() => orderedRows(idx.data), [idx.data]);
  const sectors = useMemo(() => [...new Set(rows.map((r) => r.sector).filter((s): s is string => !!s))].sort(), [rows]);
  const watchSet = useMemo(() => new Set((watch.data ?? []).map((w: { ticker: string }) => w.ticker)), [watch.data]);
  const shown = useMemo(() => filterIndex(rows, f, watchSet), [rows, f, watchSet]);
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const k of r.kinds) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [rows]);
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Insights"
        description="What each company's reported KPIs say when read against their own history, their peers, guidance, federal contracts, lobbying, trading and congressional records. Every figure links to the release, workbook cell or record it came from."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Companies"
          value={f.scope}
          onChange={(v) => setF({ ...f, scope: v })}
          options={[
            { v: "all", l: "All companies" },
            { v: "watchlist", l: "Watchlist" },
          ]}
        />
        <Select value={f.sector} onValueChange={(v) => setF({ ...f, sector: v })}>
          <SelectTrigger className="h-8 w-[190px] text-[12.5px]">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as IndexFilter["kind"] })}>
          <SelectTrigger className="h-8 w-[190px] text-[12.5px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {KIND_ORDER.filter((k) => kindCounts.get(k)).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]} ({kindCounts.get(k)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={f.withInsights} onChange={(e) => setF({ ...f, withInsights: e.target.checked })} />
          Written insights only
        </label>
        <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Ticker, company or topic" className="h-8 w-[220px] text-[12.5px]" />
        {idx.data && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {shown.length} of {rows.length} companies · updated {fmtRelative(idx.data.generated)}
          </span>
        )}
      </div>
      {idx.isLoading && (
        <div className="space-y-2">
          <LoadingState label="Loading insights" variant="Drive" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}
      {idx.isError && <p className="text-sm text-muted-foreground">Insights are not available yet; the first pass is still running.</p>}
      {idx.data && (
        <>
          <ul className={cn("border-t", !shown.length && "hidden")}>
            {shown.slice(0, limit).map((r) => (
              <Row key={r.ticker} r={r} open={open === r.ticker} onToggle={() => setOpen(open === r.ticker ? null : r.ticker)} />
            ))}
          </ul>
          {!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">No companies match these filters.</p>}
          {shown.length > limit && (
            <button type="button" className="mt-3 text-[12.5px] text-link hover:underline" onClick={() => setLimit((l) => l + 60)}>
              Show 60 more
            </button>
          )}
          <p className="mt-4 max-w-3xl text-[11px] text-muted-foreground">{idx.data.method}</p>
        </>
      )}
    </div>
  );
}
