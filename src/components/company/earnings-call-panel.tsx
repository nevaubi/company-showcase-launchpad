import { useQuery, useQueryClient } from "@tanstack/react-query";
import { friendlyError } from "@/lib/errors";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Mic, RefreshCw, ScrollText } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getEarningsCallBrief } from "@/lib/web.functions";
import { fmtRelative } from "@/lib/format";

/** Latest earnings call brief, researched from the web (transcripts, IR releases, coverage) and summarized with sources. */
export function EarningsCallPanel({ ticker }: { ticker: string }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({
    queryKey: ["earnings-call", ticker],
    queryFn: () => getEarningsCallBrief({ data: { ticker, refresh: false } }),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await getEarningsCallBrief({ data: { ticker, refresh: true } });
      qc.setQueryData(["earnings-call", ticker], r);
    } finally {
      setRefreshing(false);
    }
  };
  const b = q.data?.brief;
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Mic className="size-3.5" /> Latest earnings call
        </span>
      }
      subtitle={
        b
          ? `${b.title} · researched from ${b.sources.length} web sources · ${fmtRelative(b.generatedAt)}`
          : "Searching transcripts, press releases and coverage…"
      }
      actions={
        <>
          <Button size="xs" variant="outline" asChild>
            <Link to="/app/companies/$ticker/calls" params={{ ticker }}>
              <ScrollText className="size-3" /> Full transcript
            </Link>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={refresh}
            disabled={refreshing || q.isLoading}
            aria-label="Refresh earnings call brief"
          >
            <RefreshCw className={refreshing ? "size-3 animate-spin" : "size-3"} />
          </Button>
        </>
      }
      bodyClassName="p-0"
    >
      {q.isLoading || refreshing ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-24" />
          <Skeleton className="h-16" />
          <p className="text-[11px] text-muted-foreground">
            Reading the call coverage — this takes 20–40 seconds the first time.
          </p>
        </div>
      ) : !b ? (
        <div className="p-4 text-sm text-muted-foreground">
          {q.data?.error || q.error
            ? friendlyError(q.data?.error ?? q.error)
            : "No brief available."}
          <Button size="xs" variant="outline" className="ml-2" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : (
        <div>
          <p className="px-4 pt-3 text-[13px] leading-relaxed">{b.summary}</p>
          {b.highlights.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 pt-3 sm:grid-cols-2">
              {b.highlights.map((h) => (
                <div key={h.label} className="min-w-0 border-l-2 border-highlight pl-2">
                  <dt className="eyebrow">{h.label}</dt>
                  <dd className="text-[12.5px] leading-snug">{h.detail}</dd>
                </div>
              ))}
            </dl>
          )}
          {b.guidance.length > 0 && (
            <div className="px-4 pt-3">
              <p className="eyebrow">Guidance & outlook</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[12.5px]">
                {b.guidance.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {b.analystQuestions.length > 0 && (
            <div className="px-4 pt-3">
              <p className="eyebrow">What analysts pressed on</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[12.5px] text-muted-foreground">
                {b.analystQuestions.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 border-t px-4 py-3">
            <p className="eyebrow">Sources</p>
            <ul className="mt-1.5 space-y-1">
              {b.sources.map((s) => (
                <li key={s.url} className="min-w-0">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 truncate text-[12px] hover:underline"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="truncate">{s.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      · {new URL(s.url).hostname.replace(/^www\./, "")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              AI summary of third-party web sources — verify against the company's filings.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
