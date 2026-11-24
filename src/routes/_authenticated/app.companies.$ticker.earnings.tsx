import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { OptionsPanel } from "@/components/options/options-panel";
import { PageNav, SECTION_SCROLL_MARGIN } from "@/components/earnings/layout";
import { History, LatestQuarter, NextReport } from "@/components/earnings/results";
import { PromiseTracker } from "@/components/earnings/promise-tracker";
import { Skeleton } from "@/components/ui/skeleton";
import { coverageOf } from "@/lib/coverage";
import { usePrices, useCompany } from "@/lib/data";
import { useNextEarnings } from "@/hooks/use-next-earnings";
import { latestGuidance } from "@/lib/earnings/promises";
import { nextConsensus, pendingRelease, profitLine, quarterRecords, reactionSummary, recentQuarters } from "@/lib/earnings/quarters";
import { previewQuery, scoreQuery } from "@/lib/earnings/workflow";
import { getPromises } from "@/lib/earnings.functions";
import { getEstimates } from "@/lib/estimates.functions";
import { earningsReactions } from "@/lib/markets/core";
import { earningsPricing } from "@/lib/options/core";
import { optionsHistoryQuery } from "@/lib/options/data";
import { quoteLink } from "@/lib/supply/counterparty";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/earnings")({
  head: ({ params }) => {
    const t = params.ticker.toUpperCase();
    const name = coverageOf(t)?.shortName ?? t;
    return {
      meta: [
        { title: `${name} (${t}) results, earnings history and promise tracker · FiledUnder` },
        {
          name: "description",
          content: `${name}'s latest quarter against the prior quarter and a year earlier, the last twelve quarters with the stock's reaction, what management promised and whether it delivered. Every figure sourced.`,
        },
        { property: "og:title", content: `${name} results and promise tracker · FiledUnder` },
        { property: "og:description", content: `Sourced quarterly results, stock reactions and management credibility for ${name}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: Earnings,
});

const SECTIONS = [
  { id: "latest", label: "Latest quarter" },
  { id: "history", label: "History" },
  { id: "promises", label: "Promises" },
  { id: "next", label: "Next report" },
  { id: "options", label: "Options market" },
];

function Earnings() {
  const ticker = Route.useParams().ticker.toUpperCase();
  const co = coverageOf(ticker);
  const company = useCompany(ticker);
  const d = company.data;

  const promFn = useServerFn(getPromises);
  const promises = useQuery({ queryKey: ["promises", ticker], queryFn: () => promFn({ data: { ticker } }), staleTime: 6 * 3600_000, retry: 1 });
  // Same query key as useNextEarnings, so the estimates load once.
  const estFn = useServerFn(getEstimates);
  const est = useQuery({ queryKey: ["estimates", ticker], queryFn: () => estFn({ data: { ticker } }), staleTime: 3600_000, retry: 1 });
  const prices = usePrices(ticker, "5y");
  const spy = usePrices("SPY", "5y");
  const score = useQuery(scoreQuery(ticker));
  const preview = useQuery(previewQuery(ticker));
  const options = useQuery(optionsHistoryQuery(ticker));

  const releases = useMemo(() => d?.earningsReleases.map((r) => r.filed), [d]);
  const next = useNextEarnings(ticker, releases);

  const reactions = useMemo(() => {
    const bars = prices.data?.bars;
    if (!bars?.length || !d?.earningsReleases.length) return [];
    const asc = [...d.earningsReleases].sort((a, b) => a.filed.localeCompare(b.filed));
    return earningsReactions(
      bars,
      asc.map((r) => ({ filed: r.filed, accn: r.accn, doc: r.doc })),
      spy.data?.bars,
    );
  }, [prices.data, spy.data, d]);

  const surprises = est.data?.estimates?.surprises;
  const model = useMemo(() => {
    if (!d) return null;
    const records = quarterRecords({ dataset: d, reactions, surprises });
    const recent = recentQuarters(records, 12);
    const pending = pendingRelease(records, d.earningsReleases, reactions, surprises);
    return { records, recent, pending, profit: profitLine(d) };
  }, [d, reactions, surprises]);

  const typical = useMemo(() => reactionSummary(reactions, 12), [reactions]);
  const lastReportedEnd = model?.pending?.surprise?.quarter ?? model?.recent[0]?.period.end ?? null;
  const consensus = nextConsensus(est.data?.estimates?.periods, lastReportedEnd);
  const snap = options.data?.[0];
  const pricing = useMemo(
    () => (snap && next ? earningsPricing(snap.term, next.date, snap.date, reactions.slice(0, 12).map((r) => r.move)) : null),
    [snap, next, reactions],
  );
  const guidance = useMemo(() => {
    const ps = promises.data?.promises ?? [];
    return latestGuidance(ps).map((p) => ({ quote: p.quote, summary: p.summary, callQuarter: p.callQuarter, callDate: p.callDate, url: quoteLink(p.callUrl, p.quote) }));
  }, [promises.data]);
  const guidanceQuotes = useMemo(() => new Set(guidance.map((g) => g.quote)), [guidance]);

  if (company.isLoading)
    return (
      <div className="grid grid-cols-1 gap-4">
        <Skeleton className="h-9" />
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  if (!d || !model)
    return <p className="py-10 text-center text-sm text-muted-foreground">Couldn't load this company's statements. Try again in a moment.</p>;

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageNav sections={SECTIONS} label="Results sections" />
      <LatestQuarter
        ticker={ticker}
        cik={d.profile.cik}
        records={model.records}
        profit={model.profit}
        pending={model.pending}
        score={score.data ?? null}
        companyName={co?.shortName ?? d.profile.name}
      />
      <History ticker={ticker} quarters={model.recent} profit={model.profit} />
      <PromiseTracker loading={promises.isLoading} data={promises.data} error={promises.error as Error | null} shownElsewhere={guidanceQuotes} />
      <NextReport
        next={next}
        consensus={consensus}
        pricing={pricing}
        pricedAsOf={snap?.date ?? null}
        typical={typical}
        guidance={guidance}
        listenFor={(preview.data?.listen_for ?? []).map((x) => x.text).slice(0, 6)}
      />
      <div id="options" className={SECTION_SCROLL_MARGIN}>
        <OptionsPanel ticker={ticker} next={next} releases={d.earningsReleases} />
      </div>
    </div>
  );
}
