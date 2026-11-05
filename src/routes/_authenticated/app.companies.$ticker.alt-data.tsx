import { useMemo } from "react";
import { useSessionState } from "@/lib/use-session-state";
import { Button } from "@/components/ui/button";
import { EvidenceButton } from "@/components/source/evidence-button";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/page-header";
import { AltEventList, AltSeriesChart } from "@/components/alt/alt-views";
import { altCompanyQuery, DATASETS, fmtAlt, seriesByTitle } from "@/lib/alt/query";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/alt-data")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker.toUpperCase()} alternative data — Filed Under` },
      { name: "description", content: `Ownership, 8-K events, government contracts, regulation, recalls, complaints and attention data for ${params.ticker.toUpperCase()}, each linked to its public record.` },
      { property: "og:title", content: `${params.ticker.toUpperCase()} alternative data — Filed Under` },
      { property: "og:description", content: "Public alt data with a source link on every row." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltCompany,
});

const BAR = new Set(["contracts", "regulatory", "complaints"]);

function AltCompany() {
  const ticker = Route.useParams().ticker.toUpperCase();
  const q = useQuery(altCompanyQuery(ticker));
  const [ds, setDs] = useSessionState<string>(`fu:alt:${ticker}:dataset`, "all");
  const rows = q.data ?? [];
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.dataset] = (m[r.dataset] ?? 0) + 1;
    return m;
  }, [rows]);
  const series = useMemo(() => {
    const out: { dataset: string; title: string; rows: typeof rows }[] = [];
    for (const d of Object.keys(DATASETS)) for (const [title, rs] of seriesByTitle(rows.filter((r) => r.dataset === d))) out.push({ dataset: d, title, rows: rs });
    return out;
  }, [rows]);
  const events = rows.filter((r) => r.kind === "event" && (ds === "all" || r.dataset === ds));
  if (q.isLoading) return <Skeleton className="h-[600px]" />;
  if (q.isError && !q.data) return <Panel title="Alternative data"><p role="alert" className="text-sm text-muted-foreground">Public records are temporarily unavailable.</p><Button variant="outline" size="xs" className="mt-2" onClick={() => q.refetch()}>Retry</Button></Panel>;
  const present = Object.keys(DATASETS).filter((d) => counts[d]);
  if (!present.length) return <Panel title="Alternative data"><p className="text-sm text-muted-foreground">No public alt data loaded for {ticker} yet — the pipeline is still filling companies in.</p></Panel>;

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {present.map((d) => (
          <button key={d} onClick={() => setDs(ds === d ? "all" : d)} className={cn("rounded-lg border bg-card p-3 text-left shadow-paper transition-colors hover:bg-secondary/60", ds === d && "border-foreground")}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{DATASETS[d].source}</div>
            <div className="mt-0.5 text-[13px] font-medium">{DATASETS[d].label}</div>
            <div className="num mt-1 text-lg">{counts[d].toLocaleString()}</div>
          </button>
        ))}
      </div>

      {series.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {series.filter((s) => ds === "all" || s.dataset === ds).map((s) => {
            const last = s.rows[s.rows.length - 1];
            return (
              <Panel collapse={false} key={s.dataset + s.title} title={s.title} subtitle={`${DATASETS[s.dataset].source} · latest ${fmtAlt(last.value, last.unit)} (${last.date})`} actions={last.source_url ? <EvidenceButton ticker={ticker} title={last.title} url={last.source_url} date={last.date ?? undefined} /> : undefined}>
                <AltSeriesChart rows={s.rows} bar={BAR.has(s.dataset)} />
              </Panel>
            );
          })}
        </div>
      )}

      <Panel collapse={false} title={ds === "all" ? "Every event" : DATASETS[ds]?.label} subtitle={ds === "all" ? "Newest first" : DATASETS[ds]?.blurb} bodyClassName="p-0"
        actions={
          <select value={ds} onChange={(e) => setDs(e.target.value)} className="rounded border bg-background px-2 py-1 text-[12px]">
            <option value="all">All datasets</option>
            {present.map((d) => <option key={d} value={d}>{DATASETS[d].label}</option>)}
          </select>
        }>
        <AltEventList key={ds} rows={events} max={5000} />
      </Panel>
    </div>
  );
}
