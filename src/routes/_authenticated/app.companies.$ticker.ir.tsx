import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { CheckCircle2, FileStack, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page-header";
import { IrBreakdowns } from "@/components/ir/breakdowns";
import { IrLibrary } from "@/components/ir/library";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIrData, readPendingIr } from "@/lib/ir.functions";
import { secRevenueCheck } from "@/lib/ir/display";
import type { IrPayload } from "@/lib/ir/payload";
import { useCompany } from "@/lib/data";
import { fmtCompactUsd, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/ir")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker.toUpperCase()} investor-relations data · Filed Under` },
      { name: "description", content: `Segment and KPI breakdowns from ${params.ticker.toUpperCase()}'s earnings releases, supplements and presentations, each linked to the exact cell in the stored document.` },
      { property: "og:title", content: `${params.ticker.toUpperCase()} investor-relations data · Filed Under` },
      { property: "og:description", content: "Segment and KPI breakdowns with click-to-source into stored IR documents." },
    ],
  }),
  component: IrPage,
});

function IrPage() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const fetchIr = useServerFn(getIrData);
  const q = useQuery({ queryKey: ["ir", ticker], queryFn: () => fetchIr({ data: { ticker } }), staleTime: 5 * 60_000 });

  if (q.isLoading)
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-[520px]" />
      </div>
    );
  if (q.isError)
    return (
      <Panel title="Investor-relations data">
        <div className="flex items-center gap-3 p-5 text-sm">
          <TriangleAlert className="size-4 text-negative" />
          <span>Couldn't load this company's IR data: {(q.error as Error).message}</span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()} className="ml-auto">
            Try again
          </Button>
        </div>
      </Panel>
    );
  const data = q.data!;
  return (
    <div className="grid grid-cols-1 gap-5">
      <IrSummary ticker={ticker} payload={data.payload} pending={data.pending} documents={data.documents.length} builtAt={data.builtAt} />
      {data.payload && data.payload.series.length > 0 ? (
        <IrBreakdowns ticker={ticker} payload={data.payload} />
      ) : (
        <Panel title="Segment & KPI breakdowns">
          <p className="p-5 text-sm text-muted-foreground">
            {data.pending ? `${data.pending} stored documents are waiting to be read — breakdowns appear here once they are processed.` : "No breakdown tables have been read for this company yet."}
          </p>
        </Panel>
      )}
      <IrLibrary ticker={ticker} documents={data.documents} />
    </div>
  );
}

function IrSummary({ ticker, payload, pending, documents, builtAt }: { ticker: string; payload: IrPayload | null; pending: number; documents: number; builtAt: string | null }) {
  const company = useCompany(ticker);
  const qc = useQueryClient();
  const read = useServerFn(readPendingIr);
  const m = useMutation({
    mutationFn: () => read({ data: { ticker } }),
    onSuccess: (r) => {
      toast.success(r.read ? `Read ${r.read} document${r.read > 1 ? "s" : ""} · ${r.facts.toLocaleString()} data points` : "Nothing new to read");
      qc.invalidateQueries({ queryKey: ["ir", ticker] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const sec = useMemo(() => {
    const st = company.data?.statements.quarterly.income;
    const row = st?.rows.find((r) => r.key === "revenue");
    if (!payload || !st || !row) return [];
    const reported = st.periods.flatMap((p, i) => (row.cells[i] ? [{ end: p.end, v: row.cells[i]!.v }] : []));
    return secRevenueCheck(payload, reported);
  }, [company.data, payload]);
  const secBad = sec.filter((c) => !c.ok);
  const s = payload?.stats;

  const stats: { label: string; value: string; hint?: string }[] = s
    ? [
        { label: "Coverage", value: s.firstPeriod && s.lastPeriod ? `${s.firstPeriod.slice(0, 4)}–${s.lastPeriod.slice(0, 4)}` : "—", hint: s.firstPeriod ? `${fmtDate(s.firstPeriod)} to ${fmtDate(s.lastPeriod)}` : undefined },
        { label: "Lines tracked", value: s.series.toLocaleString(), hint: `${s.groups} breakdowns` },
        { label: "Data points", value: s.facts.toLocaleString(), hint: `from ${s.documents.toLocaleString()} documents` },
        { label: "Quarterly totals tie out", value: s.checksQ.total ? `${Math.round((s.checksQ.ok / s.checksQ.total) * 100)}%` : "—", hint: `${s.checksQ.ok.toLocaleString()} of ${s.checksQ.total.toLocaleString()}` },
        { label: "Annual totals tie out", value: s.checksFY.total ? `${Math.round((s.checksFY.ok / s.checksFY.total) * 100)}%` : "—", hint: `${s.checksFY.ok.toLocaleString()} of ${s.checksFY.total.toLocaleString()}` },
      ]
    : [];

  return (
    <Panel
      title="Investor-relations data"
      subtitle={builtAt ? `Rebuilt ${fmtDate(builtAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} from ${documents.toLocaleString()} stored files` : `${documents.toLocaleString()} stored files`}
      actions={
        pending > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {m.isPending ? "Reading…" : `Read ${Math.min(2, pending)} of ${pending} waiting`}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">Reads up to two newly stored documents now (about a minute). The rest are read by the background pipeline.</TooltipContent>
          </Tooltip>
        ) : undefined
      }
    >
      {s ? (
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((x) => (
            <div key={x.label} className="min-w-0 bg-card px-4 py-3">
              <p className="eyebrow">{x.label}</p>
              <p className="num mt-0.5 text-lg font-semibold">{x.value}</p>
              {x.hint && <p className="num truncate text-[11px] text-muted-foreground">{x.hint}</p>}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <FileStack className="size-4" /> No data has been read from this company's documents yet.
        </div>
      )}
      {sec.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs">
          {secBad.length ? (
            <Tooltip>
              <TooltipTrigger className="inline-flex items-center gap-1 text-foreground">
                <TriangleAlert className="size-3.5 text-warning" />
                Release top line matches SEC-reported revenue in {sec.length - secBad.length} of {sec.length} quarters
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">
                {secBad.slice(-6).map((b) => (
                  <p key={b.period}>
                    {fmtDate(b.period)}: release {fmtCompactUsd(b.ir, 2)} vs 10-Q/10-K {fmtCompactUsd(b.sec, 2)}
                  </p>
                ))}
                <p className="mt-1 opacity-75">Differences usually come from later recasts (divestitures, reclassifications) in the SEC statements.</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="inline-flex items-center gap-1 text-positive">
              <CheckCircle2 className="size-3.5" /> Release top line matches SEC-reported revenue in all {sec.length} overlapping quarters
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
