import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { IrDocuments } from "@/components/ir/documents";
import { storeIndexQuery, type StoreDoc } from "@/lib/ir/store";
import { friendlyError } from "@/lib/errors";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Clock3, FileStack, Loader2, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { IrBreakdowns, type IrFocus } from "@/components/ir/breakdowns";
import { IrFinancialMap } from "@/components/ir/financial-map";
import { IrKeyMetrics } from "@/components/ir/key-metrics";
import { IrPanel } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIrData, type IrDocRow } from "@/lib/ir.functions";
import { checkStatementsOf, irPageKey, loadIrPage, type IrPageData } from "@/lib/ir/client";
import type { IrPayload } from "@/lib/ir/payload";
import { companyQuery } from "@/lib/data";
import { IrChecksLine } from "@/components/ir/checks";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const monthYear = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// Workbook "Open source" links land here with the line and period to open.
const pageSearch = z.object({
  line: z.string().optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  freq: z.enum(["q", "y", "m"]).optional(),
});

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/ir")({
  validateSearch: pageSearch,
  head: ({ params }) => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: `${params.ticker.toUpperCase()} investor-relations data · FiledUnder` },
      {
        name: "description",
        content: `Segment and KPI breakdowns from ${params.ticker.toUpperCase()}'s earnings releases, supplements and presentations, each linked to the exact cell in the stored document.`,
      },
      {
        property: "og:title",
        content: `${params.ticker.toUpperCase()} investor-relations data · FiledUnder`,
      },
      {
        property: "og:description",
        content: "Segment and KPI breakdowns with click-to-source into stored IR documents.",
      },
    ],
  }),
  component: IrPage,
});

function IrPage() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const { line, period, freq } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const focus = useMemo(
    () => (line && period ? { line, period, freq: freq ?? ("q" as const) } : undefined),
    [line, period, freq],
  );
  const clearFocus = useCallback(() => navigate({ search: {}, replace: true }), [navigate]);
  const fetchIr = useServerFn(getIrData);
  const store = useQuery(storeIndexQuery(ticker));
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: irPageKey(ticker),
    // The company's SEC statements (usually already cached by the company header) feed the cross-check.
    queryFn: () => loadIrPage(ticker, fetchIr, () => qc.fetchQuery(companyQuery(ticker)).then(checkStatementsOf)),
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
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border bg-card px-4 py-3 text-sm"
          >
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
            <span>
              Still loading. The database is busy filing newly collected documents, so this can take
              up to a minute. Nothing has been removed.
              {q.failureCount > 0 && (
                <span className="text-muted-foreground"> Retrying ({q.failureCount} of 3)…</span>
              )}
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
              : `Couldn't load this company's IR data. ${friendlyError(q.error)}`}
          </span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      </Panel>
    );
  return <IrPageView ticker={ticker} data={q.data!} store={store.data?.documents} focus={focus} onFocusDone={clearFocus} />;
}

/** The loaded IR page (summary, key metrics, map, breakdowns, documents); the route only fetches. */
export function IrPageView({ ticker, data, store, focus, onFocusDone }: { ticker: string; data: IrPageData; store?: StoreDoc[]; focus?: IrFocus; onFocusDone?: () => void }) {
  const hasSeries = !!data.payload && data.payload.series.length > 0;
  return (
    <div className="grid grid-cols-1 gap-6">
      <IrSummary ticker={ticker} data={data} payload={data.payload} pending={data.pending} documents={data.documents} images={data.images ?? 0} builtAt={data.builtAt} />
      {hasSeries && <IrKeyMetrics ticker={ticker} payload={data.payload!} />}
      {hasSeries && <IrFinancialMap ticker={ticker} payload={data.payload!} />}
      {hasSeries ? (
        <IrBreakdowns key={ticker} ticker={ticker} payload={data.payload!} focus={focus} onFocusDone={onFocusDone} />
      ) : (
        <IrPanel section="Segment and KPI breakdowns" tour="ir-breakdowns" title="Segment and KPI breakdowns">
          <div className="px-4 py-4 text-[13px]">
            <p>No figures have been read from this company's documents yet.</p>
            <p className={cn("mt-1", IR.caption)}>
              {data.pending
                ? `Breakdowns appear here once the ${data.pending.toLocaleString()} stored ${data.pending === 1 ? "file that is" : "files that are"} waiting have been read. Reading runs in the background; the stored files below can be opened now.`
                : "The stored files below can be opened now; this company's releases have no tables the readers use."}
            </p>
          </div>
        </IrPanel>
      )}
      <IrDocuments ticker={ticker} documents={data.documents} images={data.images} store={store} />
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

function IrSummary({
  ticker,
  data,
  payload,
  pending,
  documents,
  images,
  builtAt,
}: {
  ticker: string;
  data: IrPageData;
  payload: IrPayload | null;
  pending: number;
  documents: IrDocRow[];
  images: number;
  builtAt: string | null;
}) {
  const files = documents.length + images;
  const read = documents.filter((d) => d.extract_status?.startsWith("ok")).length;
  const s = payload?.stats;
  // Values filled by calculation (fourth quarters, year-to-date differences, summed years).
  const calculated = useMemo(() => (payload ? payload.series.reduce((n, x) => n + Object.values(x.q).filter((c) => c.f).length + Object.values(x.y).filter((c) => c.f).length, 0) : 0), [payload]);

  const tie = (c: { ok: number; total: number }) => (c.total ? { value: `${Math.round((c.ok / c.total) * 100)}%`, hint: `${c.ok.toLocaleString()} of ${c.total.toLocaleString()} checks` } : null);
  const stats: { label: string; value: string; hint?: string }[] = s
    ? [
        {
          label: "Coverage",
          value: s.firstPeriod && s.lastPeriod ? `${s.firstPeriod.slice(0, 4)}–${s.lastPeriod.slice(0, 4)}` : DASH,
          hint: s.firstPeriod && s.lastPeriod ? `${monthYear(s.firstPeriod)} to ${monthYear(s.lastPeriod)}` : undefined,
        },
        { label: "Lines tracked", value: s.series.toLocaleString(), hint: `in ${s.groups.toLocaleString()} breakdowns` },
        { label: "Data points", value: s.facts.toLocaleString(), hint: `from ${s.documents.toLocaleString()} documents${calculated ? `, ${calculated.toLocaleString()} calculated` : ""}` },
        ...(tie(s.checksQ) ? [{ label: "Quarterly totals tie out", ...tie(s.checksQ)! }] : []),
        ...(tie(s.checksFY) ? [{ label: "Annual totals tie out", ...tie(s.checksFY)! }] : []),
      ]
    : [];

  const filesLine = `${files.toLocaleString()} stored file${files === 1 ? "" : "s"}, ${read.toLocaleString()} read for figures${pending ? `, ${pending.toLocaleString()} waiting to be read` : ""}`;
  return (
    <IrPanel
      section="Investor-relations summary"
      title="Investor-relations data"
      subtitle={builtAt ? `Built ${fmtDate(builtAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${filesLine}` : filesLine}
      actions={
        pending > 0 ? (
          <Tooltip>
            <TooltipTrigger className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1", IR.caption)}>
              <Clock3 className="size-3.5" />
              {pending.toLocaleString()} waiting to be read
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Stored files are read in the background by scheduled readers. Their figures join the tables below when a read finishes; this page checks again every two minutes.
            </TooltipContent>
          </Tooltip>
        ) : undefined
      }
    >
      {s ? (
        <dl className={cn("grid grid-cols-2 gap-px bg-border", stats.length >= 5 ? "sm:grid-cols-3 lg:grid-cols-5" : stats.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {stats.map((x, i) => (
            // An odd last tile spans the row on phones (2 columns) so no empty cell shows.
            <div key={x.label} className={cn("min-w-0 bg-card px-4 py-3", i === stats.length - 1 && stats.length % 2 === 1 && "col-span-2 sm:col-span-1", i === stats.length - 1 && stats.length === 5 && "sm:col-span-2 lg:col-span-1")}>
              <dt className={IR.eyebrow}>{x.label}</dt>
              <dd className={cn("mt-1", IR.stat)}>{x.value}</dd>
              {x.hint && <dd className={cn("num truncate", IR.caption)}>{x.hint}</dd>}
            </div>
          ))}
        </dl>
      ) : (
        <div className="flex items-start gap-2 px-4 py-3 text-[13px]">
          <FileStack className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>
            {files.toLocaleString()} stored file{files === 1 ? " is" : "s are"} listed under Source documents.
            <span className={cn("block", IR.caption)}>{pending ? "Key metrics, the financial map and breakdowns are built once those files are read." : "None of them has been read for figures yet."}</span>
          </p>
        </div>
      )}
      {payload && <IrChecksLine ticker={ticker} payload={payload} check={data.secCheck} consistency={data.consistency} timings={data.timings} late={data.secCheckLate} />}
    </IrPanel>
  );
}
