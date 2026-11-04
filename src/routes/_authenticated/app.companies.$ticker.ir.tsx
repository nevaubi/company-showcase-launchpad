import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { CheckCircle2, FileStack, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { IrBreakdowns } from "@/components/ir/breakdowns";
import { IrLibrary } from "@/components/ir/library";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIrData, type IrDocRow } from "@/lib/ir.functions";
import { secRevenueCheck } from "@/lib/ir/display";
import type { IrPayload } from "@/lib/ir/payload";
import { useCompany } from "@/lib/data";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// Workbook "Open source" links land here with the line and period to open.
const search = z.object({
  line: z.string().optional(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  freq: z.enum(["q", "y"]).optional(),
});

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/ir")({
  validateSearch: search,
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
  const { line, period, freq } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const focus = useMemo(() => (line && period ? { line, period, freq: freq ?? ("q" as const) } : undefined), [line, period, freq]);
  const clearFocus = useCallback(() => navigate({ search: {}, replace: true }), [navigate]);
  const fetchIr = useServerFn(getIrData);
  const q = useQuery({
    queryKey: ["ir", ticker],
    queryFn: async () => {
      const { gz } = await fetchIr({ data: { ticker } });
      const json = await new Response((gz as ReadableStream<BufferSource>).pipeThrough(new DecompressionStream("gzip"))).text();
      return JSON.parse(json) as {
        payload: IrPayload | null;
        builtAt: string | null;
        documents: IrDocRow[];
        images: number;
        pending: number;
      };
    },
    staleTime: 5 * 60_000,
    retry: 3,
    retryDelay: (n) => Math.min(2000 * 2 ** n, 15_000),
    // While new files are being read in the background, pick up their numbers without a reload.
    refetchInterval: (query) => (query.state.data?.pending ? 120_000 : false),
  });
  const slow = useSlow(q.isLoading, 6000);

  if (q.isLoading)
    return (
      <div className="grid grid-cols-1 gap-5">
        {slow && (
          <div role="status" className="flex items-start gap-2 rounded-md border bg-card px-4 py-3 text-sm">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
            <span>
              Still loading. The database is busy filing newly collected documents, so this can take up to a minute. Nothing has been removed.
              {q.failureCount > 0 && <span className="text-muted-foreground"> Retrying ({q.failureCount} of 3)…</span>}
            </span>
          </div>
        )}
        <Skeleton className="h-28" />
        <Skeleton className="h-[520px]" />
      </div>
    );
  if (q.isError)
    return (
      <Panel title="Investor-relations data">
        <div className="flex flex-wrap items-center gap-3 p-5 text-sm">
          <TriangleAlert className="size-4 text-negative" />
          <span className="min-w-0 flex-1">
            {/timeout|canceling statement|fetch failed|503|502/i.test((q.error as Error).message)
              ? "The database took too long to answer. The stored documents and breakdowns are safe; try again in a moment."
              : `Couldn't load this company's IR data: ${(q.error as Error).message}`}
          </span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      </Panel>
    );
  const data = q.data!;
  return (
    <div className="grid grid-cols-1 gap-5">
      <IrSummary ticker={ticker} payload={data.payload} pending={data.pending} documents={data.documents.length + (data.images ?? 0)} builtAt={data.builtAt} />
      {data.payload && data.payload.series.length > 0 ? (
        <IrBreakdowns ticker={ticker} payload={data.payload} focus={focus} onFocusDone={clearFocus} />
      ) : (
        <Panel title="Segment & KPI breakdowns">
          <p className="p-5 text-sm text-muted-foreground">
            {data.pending ? `${data.pending} stored documents are waiting to be read — breakdowns appear here once they are processed.` : "No breakdown tables have been read for this company yet."}
          </p>
        </Panel>
      )}
      <IrLibrary ticker={ticker} documents={data.documents} images={data.images} />
    </div>
  );
}

/** True once `active` has stayed true for `ms`. */
function useSlow(active: boolean, ms: number) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return setSlow(false);
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}

function IrSummary({ ticker, payload, pending, documents, builtAt }: { ticker: string; payload: IrPayload | null; pending: number; documents: number; builtAt: string | null }) {
  const company = useCompany(ticker);

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
        { label: "Coverage", value: s.firstPeriod && s.lastPeriod ? `${s.firstPeriod.slice(0, 4)}–${s.lastPeriod.slice(0, 4)}` : "—", hint: s.firstPeriod && s.lastPeriod ? `${monthYear(s.firstPeriod)} – ${monthYear(s.lastPeriod)}` : undefined },
        { label: "Lines tracked", value: s.series.toLocaleString(), hint: `${s.groups} breakdowns` },
        { label: "Data points", value: s.facts.toLocaleString(), hint: `from ${s.documents.toLocaleString()} documents` },
        { label: "Quarterly totals tie out", value: s.checksQ.total ? `${Math.round((s.checksQ.ok / s.checksQ.total) * 100)}%` : "—", hint: `${s.checksQ.ok.toLocaleString()} of ${s.checksQ.total.toLocaleString()}` },
        { label: "Annual totals tie out", value: s.checksFY.total ? `${Math.round((s.checksFY.ok / s.checksFY.total) * 100)}%` : "—", hint: `${s.checksFY.ok.toLocaleString()} of ${s.checksFY.total.toLocaleString()}` },
      ]
    : [];

  return (
    <Panel
      title="Investor-relations data"
      subtitle={builtAt ? `Updated ${fmtDate(builtAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} from ${documents.toLocaleString()} stored files` : `${documents.toLocaleString()} stored files`}
      actions={
        pending > 0 ? (
          <Tooltip>
            <TooltipTrigger className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin [animation-duration:3s]" />
              {pending.toLocaleString()} new file{pending > 1 ? "s" : ""} being read automatically
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Newly collected documents are read in the background. Their numbers are added to the tables below automatically; this page refreshes on its own every two minutes.
            </TooltipContent>
          </Tooltip>
        ) : undefined
      }
    >
      {s ? (
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((x, i) => (
            // An odd last tile spans the row on phones (2 columns) and tablets (3 columns) so no empty cell shows.
            <div
              key={x.label}
              className={cn(
                "min-w-0 bg-card px-4 py-3",
                i === stats.length - 1 && stats.length % 2 === 1 && "col-span-2 sm:col-span-1",
                i === stats.length - 1 && stats.length % 3 === 2 && "sm:col-span-2 lg:col-span-1",
              )}
            >
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
