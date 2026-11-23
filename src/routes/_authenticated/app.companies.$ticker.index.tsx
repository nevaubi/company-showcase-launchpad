import { createFileRoute } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, TrendingDown, TrendingUp } from "lucide-react";
import { IrPanel } from "@/components/ir/panel";
import { IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { getNarratives } from "@/lib/ai.functions";
import { companyChangesQuery } from "@/lib/changes/data";
import { whyCards } from "@/lib/company/why";
import { coverageOf } from "@/lib/coverage";
import { friendlyError } from "@/lib/errors";
import { fmtDate, fmtRelative } from "@/lib/format";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";
import { WhatChangedPanel } from "@/components/changes/company-changes";
import { AboutPanel } from "@/components/company/about";
import { BriefPanel } from "@/components/company/brief-panel";
import { EarningsCallPanel } from "@/components/company/earnings-call-panel";
import { EarningsSection } from "@/components/company/earnings-section";
import { EventsTimeline } from "@/components/company/events-timeline";
import { FilingChangesPanel } from "@/components/company/filing-insights";
import { FinancialAnalysisSection } from "@/components/company/financial-analysis";
import { KpiInsightsPanel } from "@/components/company/kpi-insights";
import { LeadershipPanel } from "@/components/company/leadership";
import { LevelsAndSignals } from "@/components/company/levels-signals";
import { PositioningPanel } from "@/components/company/positioning";
import { QuarterDrivers } from "@/components/company/quarter-drivers";
import { KeyRelationshipsPanel } from "@/components/company/relationships";
import { ReportedKpis } from "@/components/company/reported-kpis";
import { ResearchChart } from "@/components/company/research-chart";
import { SectionNav } from "@/components/company/section-nav";
import { SectorTable } from "@/components/company/sector-table";
import { FirmNotes } from "@/components/firm/firm-notes";
import { CompanyIndicators } from "@/components/technicals/deep-views";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker} overview · FiledUnder` },
      {
        name: "description",
        content: `${coverageOf(params.ticker)?.shortName ?? params.ticker} price research, SEC fundamentals, management and catalysts.`,
      },
      { property: "og:title", content: `${params.ticker} research overview · FiledUnder` },
      {
        property: "og:description",
        content: "Price analysis, sourced fundamentals and company intelligence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  if (!company.data) return <OverviewSkeleton />;
  return <OverviewBody ticker={ticker} data={company.data} />;
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3">
      <Skeleton className="h-9" />
      <Skeleton className="h-28" />
      <Skeleton className="h-40" />
      <Skeleton className="h-96" />
    </div>
  );
}

/**
 * The page in a researcher's order: how the business is doing (the numbers, then what moved them), what changed
 * lately, the stock and its next report, what the company is and who it depends on, what it reports beyond the
 * statements, who owns and trades it, and how it compares. One nav; every section is on the page in full.
 */
const SECTIONS = {
  analysis: { id: "ov-analysis", label: "Financials" },
  drivers: { id: "ov-drivers", label: "Latest quarter" },
  changed: { id: "ov-what-changed", label: "What changed" },
  price: { id: "ov-price", label: "Price" },
  earnings: { id: "ov-earnings", label: "Earnings" },
  about: { id: "ov-about", label: "Business" },
  relationships: { id: "ov-relationships", label: "Relationships" },
  operating: { id: "ov-operating", label: "Operating data" },
  ownership: { id: "ov-ownership", label: "Ownership" },
  peers: { id: "ov-peers", label: "Peers" },
  news: { id: "ov-news", label: "News" },
} as const;

/**
 * Panels owned by other units (the ranked changes, the indicator board, firm notes) are drawn with the older flat
 * panel; this gives them the same finish as the rest of the page without touching their files.
 */
const FRAMED = "min-w-0 [&>section]:rounded-md [&>section]:border [&>section]:bg-card [&>section]:shadow-paper";

/** A section of the page: the nav jumps to its id, and it stacks its panels with the page's one gap. */
function Section({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("grid min-w-0 scroll-mt-28 grid-cols-1 gap-3", className)}>
      {children}
    </section>
  );
}

function OverviewBody({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const changes = useQuery(companyChangesQuery(ticker));
  const q = data.statements.quarterly;
  const a = data.statements.annual;
  const p = data.profile;
  const drivers = useMemo(() => whyCards(data), [data]);

  const sections = useMemo(() => Object.values(SECTIONS).filter((s) => s.id !== SECTIONS.drivers.id || drivers.length > 0), [drivers.length]);
  // the pipeline's ranked list when it exists; the dated events otherwise, never both
  const ranked = changes.isLoading || !!changes.data;
  const lastQ = q.income.periods.at(-1);

  return (
    <div className="grid grid-cols-1 gap-3">
      <SectionNav sections={sections} />

      <Section id={SECTIONS.analysis.id}>
        <FinancialAnalysisSection ticker={ticker} data={data} />
      </Section>

      {drivers.length > 0 && (
        <Section id={SECTIONS.drivers.id}>
          <QuarterDrivers ticker={ticker} cards={drivers} data={data} />
        </Section>
      )}

      <Section id={SECTIONS.changed.id}>
        <BriefPanel ticker={ticker} />
        {ranked ? (
          <div data-section="What changed" className={FRAMED}>
            <WhatChangedPanel ticker={ticker} />
          </div>
        ) : (
          <EventsTimeline ticker={ticker} data={data} />
        )}
        <FilingChangesPanel ticker={ticker} filings={data.filings} />
      </Section>

      <Section id={SECTIONS.price.id}>
        <div data-section="Price and technical read" className="min-w-0">
          <ResearchChart ticker={ticker} data={data} />
        </div>
        <LevelsAndSignals ticker={ticker} />
        <div id="ov-indicators" data-section="Indicator board" className={cn(FRAMED, "scroll-mt-28")}>
          <CompanyIndicators ticker={ticker} />
        </div>
      </Section>

      <Section id={SECTIONS.earnings.id} className="xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <EarningsSection ticker={ticker} data={data} />
        <div data-section="Latest earnings call" className="min-w-0">
          <EarningsCallPanel ticker={ticker} />
        </div>
      </Section>

      <Section id={SECTIONS.about.id}>
        <AboutPanel ticker={ticker} data={data} />
        <LeadershipPanel ticker={ticker} />
      </Section>

      <Section id={SECTIONS.relationships.id}>
        <KeyRelationshipsPanel ticker={ticker} />
      </Section>

      <Section id={SECTIONS.operating.id}>
        <ReportedKpis ticker={ticker} />
        <div data-section="operating-insights" className="min-w-0">
          <KpiInsightsPanel ticker={ticker} />
        </div>
      </Section>

      {/* Named spot for the alt-data snapshot (built by the alt unit, mounted by the lead):
          put <AltSnapshot ticker={ticker} /> inside this element and add { id: "ov-alt", label: "Alt data" }
          to SECTIONS after `operating`. While it is empty it takes no space. */}
      <section id="ov-alt" data-section="Alt data snapshot" data-slot="alt-snapshot" className="min-w-0 scroll-mt-28 empty:hidden" />

      <Section id={SECTIONS.ownership.id}>
        <PositioningPanel ticker={ticker} data={data} />
      </Section>

      <Section id={SECTIONS.peers.id}>
        <SectorTable ticker={ticker} />
      </Section>

      <Section id={SECTIONS.news.id}>
        <NarrativesPanel ticker={ticker} name={p.name} />
        <div data-section="Firm notes" className={cn(FRAMED, "empty:hidden")}>
          <FirmNotes ticker={ticker} />
        </div>
      </Section>

      <p className={IR.caption} data-section="As of">
        Statements through {lastQ ? `${lastQ.label} (quarter ended ${fmtDate(lastQ.end)})` : "no quarter yet"} and {a.income.periods.at(-1)?.label ?? "no fiscal year yet"}. Dataset built {fmtDate(data.generatedAt)}. Click any figure to open the filing behind it.
      </p>
    </div>
  );
}

function NarrativesPanel({ ticker, name }: { ticker: string; name: string }) {
  const q = useQuery({
    queryKey: ["narratives", ticker],
    queryFn: () => getNarratives({ data: { ticker, name } }),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const news = q.data?.news ?? [];
  const byId = new Map(news.map((n) => [n.id, n]));
  return (
    <IrPanel
      section="News narratives"
      title="News narratives"
      subtitle={
        q.data
          ? `Grouped by a model from ${news.length} recent ${q.data.via === "web" ? "articles found by web search" : "headlines"} · ${fmtRelative(q.data.cachedAt)} · each narrative links its headlines`
          : q.isError
            ? "Not available just now"
            : "Grouping recent headlines"
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="px-4 py-3 text-[13px] text-muted-foreground">
          The narratives could not be built just now. {friendlyError(q.error)}
          <Button size="xs" variant="outline" className="ml-2" onClick={() => q.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 divide-y lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
          <ul className="divide-y divide-border/60">
            {(q.data?.narratives ?? []).map((n) => (
              <li key={n.title} className="px-4 py-2">
                <p className="flex items-start gap-2 text-[13px] font-semibold leading-5">
                  {n.sentiment === "bullish" ? (
                    <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-positive" aria-label="Positive for the stock" />
                  ) : n.sentiment === "bearish" ? (
                    <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-negative" aria-label="Negative for the stock" />
                  ) : (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" aria-label="Neutral" />
                  )}
                  {n.title}
                </p>
                <p className="mt-0.5 pl-5.5 text-[13px] leading-5 text-muted-foreground">{n.summary}</p>
                <div className="mt-1 flex flex-wrap gap-1.5 pl-5.5">
                  {n.headlineIds.slice(0, 3).map((id) => {
                    const h = byId.get(id);
                    return h ? (
                      <a key={id} href={h.link} target="_blank" rel="noreferrer" className="max-w-full truncate rounded border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                        {h.publisher}: {h.title}
                      </a>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
            {(q.data?.narratives ?? []).length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No narrative could be grouped from the recent headlines.</li>}
          </ul>
          {news.length > 0 && (
            <div className="min-w-0 px-4 py-2">
              <p className="eyebrow flex items-center gap-1.5">
                <Newspaper className="size-3" /> Latest headlines
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {news.slice(0, 6).map((n) => (
                  <li key={n.id} className="text-[13px] leading-5">
                    <a href={n.link} target="_blank" rel="noreferrer" className="hover:underline">
                      {n.title}
                    </a>
                    <span className={cn("ml-1.5", IR.caption)}>
                      {n.publisher} · {fmtRelative(n.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </IrPanel>
  );
}
