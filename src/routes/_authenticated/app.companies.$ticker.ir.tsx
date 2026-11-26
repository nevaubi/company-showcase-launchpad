import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { IrDocuments } from "@/components/ir/documents";
import { storeIndexQuery, type StoreDoc } from "@/lib/ir/store";
import { friendlyError } from "@/lib/errors";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Check, Clock3, FileStack, Loader2, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import type { IrFocus } from "@/components/ir/breakdowns";
import { IrChecksDrawer } from "@/components/ir/checks-drawer";
import { IrFinancialMap } from "@/components/ir/financial-map";
import { CheckDot } from "@/components/ir/marks";
import { IrPanel } from "@/components/ir/panel";
import { IrStandardKpis } from "@/components/ir/standard-kpis";
import { IrStatements, type StatementsSummary } from "@/components/ir/statements";
import { IrTopViz } from "@/components/ir/viz-slots";
import { FilingDetailView } from "@/components/financials/filing-detail";
import { useUnitScale } from "@/hooks/use-preference";
import { assembleStatements } from "@/lib/ir/statements";
import { DASH, IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIrData, type IrDocRow } from "@/lib/ir.functions";
import {
  checkLateIrPage,
  checkStatementsOf,
  irPageKey,
  loadIrPage,
  type IrPageData,
} from "@/lib/ir/client";
import type { IrPayload } from "@/lib/ir/payload";
import { companyQuery } from "@/lib/data";
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
        content: `${params.ticker.toUpperCase()}'s statements, segments and KPIs as its earnings releases, supplements and presentations print them, each figure linked to the exact cell in the stored document.`,
      },
      {
        property: "og:title",
        content: `${params.ticker.toUpperCase()} investor-relations data · FiledUnder`,
      },
      {
        property: "og:description",
        content:
          "Statements, segments and KPIs as the company prints them, with click-to-source into stored IR documents.",
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
    queryFn: () =>
      loadIrPage(ticker, fetchIr, () =>
        qc.fetchQuery(companyQuery(ticker)).then(checkStatementsOf),
      ),
    staleTime: 5 * 60_000,
    retry: 3,
    retryDelay: (n) => Math.min(2000 * 2 ** n, 15_000),
    // While new files are being read in the background, pick up their numbers without a reload.
    refetchInterval: (query) => (query.state.data?.pending ? 120_000 : false),
  });
  const slow = useSlow(q.isLoading, 6000);
  // Statements that arrive after the page is shown still get the SEC check: it runs on the shown
  // payload and the result replaces the cached page data in place (nothing blanks or moves).
  const lateData = q.data?.secCheckLate ? q.data : undefined;
  useEffect(() => {
    if (!lateData) return;
    let off = false;
    qc.fetchQuery(companyQuery(ticker))
      .then(checkStatementsOf)
      .catch(() => null)
      .then((st) => checkLateIrPage(lateData, st))
      .then((next) => {
        if (!off && qc.getQueryData(irPageKey(ticker)) === lateData)
          qc.setQueryData(irPageKey(ticker), next);
      });
    return () => {
      off = true;
    };
  }, [lateData, qc, ticker]);

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
  return (
    <IrPageView
      ticker={ticker}
      data={q.data!}
      store={store.data?.documents}
      focus={focus}
      onFocusDone={clearFocus}
    />
  );
}

/**
 * The loaded IR page; the route only fetches. Standardized KPIs, the chart strip, the statements (every
 * printed table over its history), then the financial map, the filings' XBRL breakdowns and the documents.
 * The audit detail lives in the checks panel opened from the tie-out badge.
 */
export function IrPageView({
  ticker,
  data,
  store,
  focus,
  onFocusDone,
}: {
  ticker: string;
  data: IrPageData;
  store?: StoreDoc[];
  focus?: IrFocus;
  onFocusDone?: () => void;
}) {
  const hasSeries = !!data.payload && data.payload.series.length > 0;
  const [checks, setChecks] = useState<{ open: boolean; section?: string }>({ open: false });
  const [tie, setTie] = useState<StatementsSummary | null>(null);
  const openChecks = useCallback((section?: string) => setChecks({ open: true, section }), []);
  const [scale] = useUnitScale();
  const sections = useMemo(
    () => (data.payload ? assembleStatements(data.payload) : []),
    [data.payload],
  );
  return (
    <div className="grid grid-cols-1 gap-6">
      <IrSummary
        ticker={ticker}
        payload={data.payload}
        pending={data.pending}
        documents={data.documents}
        images={data.images ?? 0}
        builtAt={data.builtAt}
        tie={tie}
        onChecks={openChecks}
      />
      <IrStandardKpis ticker={ticker} />
      {hasSeries && (
        <IrTopViz ticker={ticker} payload={data.payload!} sections={sections} scale={scale} />
      )}
      {hasSeries ? (
        <IrStatements
          key={ticker}
          ticker={ticker}
          payload={data.payload!}
          focus={focus}
          onFocusDone={onFocusDone}
          onChecks={openChecks}
          onSummary={setTie}
        />
      ) : (
        <IrPanel section="IR statements" tour="ir-breakdowns" title="Statements">
          <div className="px-4 py-4 text-[13px]">
            <p>No figures have been read from this company's documents yet.</p>
            <p className={cn("mt-1", IR.caption)}>
              {data.pending
                ? `Statements appear here once the ${data.pending.toLocaleString()} stored ${data.pending === 1 ? "file that is" : "files that are"} waiting have been read. Reading runs in the background; the stored files below can be opened now.`
                : "The stored files below can be opened now; this company's releases have no tables the readers use."}
            </p>
          </div>
        </IrPanel>
      )}
      {hasSeries && <IrFinancialMap ticker={ticker} payload={data.payload!} />}
      <IrXbrlBreakdowns ticker={ticker} />
      <IrDocuments ticker={ticker} documents={data.documents} images={data.images} store={store} />
      {data.payload && (
        <IrChecksDrawer
          open={checks.open}
          onOpenChange={(open) => setChecks((c) => ({ ...c, open }))}
          ticker={ticker}
          payload={data.payload}
          section={checks.section}
          check={data.secCheck}
          consistency={data.consistency}
          late={data.secCheckLate}
          timings={data.timings}
          stats={summaryStats(data.payload)}
        />
      )}
    </div>
  );
}

/** The filings' own segment and geography breakdowns (10-K/10-Q dimensional XBRL), mounted when scrolled near. */
function IrXbrlBreakdowns({ ticker }: { ticker: string }) {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on || !ref.current) return;
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && setOn(true), {
      rootMargin: "800px 0px",
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [on]);
  return (
    <div ref={ref} data-section="IR XBRL breakdowns" className="min-w-0">
      <IrPanel
        section="XBRL breakdowns"
        title="Breakdowns tagged in the filings"
        subtitle="Segment, product and geography figures as the 10-K and 10-Q tag them in XBRL, each opening the tagged value in the filing"
      >
        {on ? <FilingDetailView ticker={ticker} /> : <Skeleton className="m-4 h-40" />}
      </IrPanel>
    </div>
  );
}

/** The figures the old summary tiles showed, now at the top of the checks panel. */
function summaryStats(payload: IrPayload): { label: string; value: string; hint?: string }[] {
  const s = payload.stats;
  const calculated = payload.series.reduce(
    (n, x) =>
      n +
      Object.values(x.q).filter((c) => c.f).length +
      Object.values(x.y).filter((c) => c.f).length,
    0,
  );
  const tie = (c: { ok: number; total: number }) =>
    c.total
      ? {
          value: `${Math.round((c.ok / c.total) * 100)}%`,
          hint: `${c.ok.toLocaleString()} of ${c.total.toLocaleString()} checks`,
        }
      : null;
  return [
    {
      label: "Coverage",
      value:
        s.firstPeriod && s.lastPeriod
          ? `${s.firstPeriod.slice(0, 4)}–${s.lastPeriod.slice(0, 4)}`
          : DASH,
      hint:
        s.firstPeriod && s.lastPeriod
          ? `${monthYear(s.firstPeriod)} to ${monthYear(s.lastPeriod)}`
          : undefined,
    },
    {
      label: "Lines tracked",
      value: s.series.toLocaleString(),
      hint: `in ${s.groups.toLocaleString()} breakdowns`,
    },
    {
      label: "Data points",
      value: s.facts.toLocaleString(),
      hint: `from ${s.documents.toLocaleString()} documents${calculated ? `, ${calculated.toLocaleString()} calculated` : ""}`,
    },
    ...(tie(s.checksQ) ? [{ label: "Quarterly totals tie out", ...tie(s.checksQ)! }] : []),
    ...(tie(s.checksFY) ? [{ label: "Annual totals tie out", ...tie(s.checksFY)! }] : []),
  ];
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
  payload,
  pending,
  documents,
  images,
  builtAt,
  tie,
  onChecks,
}: {
  ticker: string;
  payload: IrPayload | null;
  pending: number;
  documents: IrDocRow[];
  images: number;
  builtAt: string | null;
  tie: StatementsSummary | null;
  onChecks: () => void;
}) {
  const files = documents.length + images;
  const read = documents.filter((d) => d.extract_status?.startsWith("ok")).length;
  const s = payload?.stats;
  const filesLine = `${files.toLocaleString()} stored file${files === 1 ? "" : "s"}, ${read.toLocaleString()} read for figures${pending ? `, ${pending.toLocaleString()} waiting to be read` : ""}`;
  const facts = s
    ? [
        s.firstPeriod && s.lastPeriod
          ? `${monthYear(s.firstPeriod)} to ${monthYear(s.lastPeriod)}`
          : null,
        `${s.series.toLocaleString()} lines`,
        `${s.facts.toLocaleString()} figures from ${s.documents.toLocaleString()} documents`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  return (
    <IrPanel
      section="Investor-relations summary"
      title="Investor-relations data"
      subtitle={
        builtAt
          ? `Built ${fmtDate(builtAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${filesLine}`
          : filesLine
      }
      actions={
        <>
          {pending > 0 && (
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1",
                  IR.caption,
                )}
              >
                <Clock3 className="size-3.5" />
                {pending.toLocaleString()} waiting to be read
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Stored files are read in the background by scheduled readers. Their figures join the
                tables below when a read finishes; this page checks again every two minutes.
              </TooltipContent>
            </Tooltip>
          )}
          {payload && (
            <button
              type="button"
              onClick={onChecks}
              data-section="IR tie-out badge"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tie && tie.tieN && tie.tieOk < tie.tieN
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
              title="Open the checks: parts against totals, quarters against the year, the SEC comparison and every figure to review"
            >
              {tie && tie.tieN ? (
                <>
                  {tie.tieOk === tie.tieN ? (
                    <Check aria-hidden className="size-3.5 text-positive" />
                  ) : (
                    <CheckDot />
                  )}
                  <span className="num">
                    {tie.tieOk.toLocaleString()} of {tie.tieN.toLocaleString()}
                  </span>
                  period totals tie out
                </>
              ) : (
                "Checks"
              )}
            </button>
          )}
        </>
      }
    >
      {facts ? (
        <p className={cn("px-4 py-2.5", IR.caption)} data-ticker={ticker}>
          {facts}
        </p>
      ) : (
        <div className="flex items-start gap-2 px-4 py-3 text-[13px]">
          <FileStack className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>
            {files.toLocaleString()} stored file{files === 1 ? " is" : "s are"} listed under Source
            documents.
            <span className={cn("block", IR.caption)}>
              {pending
                ? "Statements are laid out once those files are read."
                : "None of them has been read for figures yet."}
            </span>
          </p>
        </div>
      )}
    </IrPanel>
  );
}
