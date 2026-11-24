import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { z } from "zod";
import { ExternalLink, Mic, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CallReader } from "@/components/earnings/call-reader";
import { coverageOf } from "@/lib/coverage";
import { fmtDate } from "@/lib/format";
import { getEarningsTranscript, listEarningsCalls } from "@/lib/transcripts.functions";
import { SHARE_CLASS_TICKERS, transcriptMatches } from "@/lib/transcripts/parse";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const pageSearch = z.object({
  call: z.string().url().max(300).optional(),
  section: z.enum(["all", "prepared", "qa"]).default("all"),
  speaker: z.string().max(80).optional(),
});
export type CallsSearch = z.infer<typeof pageSearch>;

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/calls")({
  validateSearch: pageSearch,
  head: ({ params }) => {
    const t = params.ticker.toUpperCase();
    const name = coverageOf(t)?.shortName ?? t;
    return {
      meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { title: `${name} (${t}) earnings call transcripts · FiledUnder` },
        {
          name: "description",
          content: `${name}'s recent earnings calls: the figures management stated, topics rising or fading against the previous call, every analyst question and the full transcript by speaker.`,
        },
        { property: "og:title", content: `${name} earnings call transcripts · FiledUnder` },
        { property: "og:description", content: `Searchable ${name} earnings call transcripts with call analytics and an analyst question index.` },
      ],
    };
  },
  component: Calls,
});

function Calls() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  // View state only: never reset the scroll position. Switching calls is a history entry, so Back returns
  // to the previous call (earnings-L4); filters within a call replace the entry.
  const set = (patch: Partial<CallsSearch>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: !("call" in patch), resetScroll: false });
  const co = coverageOf(ticker);

  const listFn = useServerFn(listEarningsCalls);
  const getFn = useServerFn(getEarningsTranscript);
  const calls = useQuery({ queryKey: ["earnings-calls", ticker], queryFn: () => listFn({ data: { ticker } }), staleTime: 6 * 3600_000 });
  // The search can return another company whose name starts with the same word; keep this company's calls only.
  const list = useMemo(
    () => (calls.data?.calls ?? []).filter((c) => transcriptMatches(c.url, ticker, co?.shortName ?? ticker, SHARE_CLASS_TICKERS[ticker] ?? [])),
    [calls.data, ticker, co],
  );
  const idx = Math.max(0, s.call ? list.findIndex((c) => c.url === s.call) : 0);
  const url = list[idx]?.url;
  const prevUrl = list[idx + 1]?.url;
  const tr = useQuery({ queryKey: ["transcript", url], queryFn: () => getFn({ data: { ticker, url: url! } }), enabled: !!url, staleTime: Infinity, retry: 1 });
  // The previous call, for topics rising or fading; loaded after the current one.
  const prevTr = useQuery({
    queryKey: ["transcript", prevUrl],
    queryFn: () => getFn({ data: { ticker, url: prevUrl! } }),
    enabled: !!prevUrl && !!tr.data?.transcript,
    staleTime: Infinity,
    retry: 1,
  });
  const t = tr.data?.transcript ?? null;

  if (calls.isLoading)
    return (
      <div className="grid grid-cols-1 gap-4">
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-[480px]" />
      </div>
    );

  if (!list.length)
    return (
      <section data-section="Earnings calls" className="flex flex-col items-center gap-3 border-y bg-card/40 py-12 text-center">
        <Mic className="size-6 text-muted-foreground" />
        <p className="text-[13px] font-medium">No earnings call transcripts found for {co?.shortName ?? ticker}</p>
        <p className="max-w-md text-[11px] text-muted-foreground">{calls.data?.error ?? calls.error?.message ?? "Try again in a moment."}</p>
        <Button size="sm" variant="outline" onClick={() => calls.refetch()}>
          <RefreshCw /> Try again
        </Button>
      </section>
    );

  return (
    <div className="grid grid-cols-1 gap-4">
      <div data-section="Call picker" className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex min-w-0 max-w-full gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap sm:overflow-visible sm:pb-0" role="tablist" aria-label="Earnings calls">
          {list.map((c) => (
            <button
              key={c.url}
              role="tab"
              type="button"
              aria-selected={c.url === url}
              onClick={() => set({ call: c.url, speaker: undefined })}
              className={cn(
                "min-h-9 shrink-0 rounded-md px-3 py-1 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                c.url === url ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <span className="num block text-[11px] font-semibold leading-tight">{c.quarter ?? "Call"}</span>
              <span className="block text-[11px] leading-tight opacity-75">{c.date ? fmtDate(c.date, { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
            </button>
          ))}
        </div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
            Transcript via The Motley Fool <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {tr.isLoading ? (
        <div className="grid grid-cols-1 gap-3">
          <p className="text-[11px] text-muted-foreground">Reading the transcript…</p>
          <Skeleton className="h-56" />
          <Skeleton className="h-96" />
        </div>
      ) : !t ? (
        <section data-section="Transcript" className="flex flex-col items-center gap-3 border-y bg-card/40 py-12 text-center">
          <p className="text-[13px] font-medium">Couldn't load this transcript</p>
          <p className="max-w-md text-[11px] text-muted-foreground">{tr.data?.error || tr.error ? friendlyError(tr.data?.error ?? tr.error) : null}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => tr.refetch()}>
              <RefreshCw /> Try again
            </Button>
            {url && (
              <Button size="sm" variant="ghost" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  Open the page <ExternalLink />
                </a>
              </Button>
            )}
          </div>
        </section>
      ) : (
        <CallReader
          key={t.url}
          t={t}
          prev={prevTr.data?.transcript ?? null}
          prevLoading={prevTr.isLoading && !!prevUrl}
          ticker={ticker}
          section={s.section}
          speaker={s.speaker}
          set={set}
        />
      )}
    </div>
  );
}
