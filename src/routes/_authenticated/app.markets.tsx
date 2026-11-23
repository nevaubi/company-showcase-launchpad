import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { CompanyLogo } from "@/components/app/company-logo";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CHART_RANGES, ChartPanel, type ChartRange } from "@/components/technicals/chart-panel";
import { EvidencePanel } from "@/components/technicals/evidence-panel";
import { MARKET_NAV, MarketView } from "@/components/technicals/market-view";
import { ReadPanel } from "@/components/technicals/read-panel";
import { EventsPanel, LevelsPanel, RelativePanel, VolatilityPanel } from "@/components/technicals/sections";
import { ShortAndFlows } from "@/components/technicals/short-flows";
import { nameWithoutSymbol, SymbolPicker } from "@/components/technicals/symbol-picker";
import { SectionNav, type NavItem } from "@/components/technicals/ui";
import { useTechnicals } from "@/components/technicals/use-technicals";
import { Button } from "@/components/ui/button";
import { useQuotes } from "@/lib/data";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { MIN_BARS } from "@/lib/technicals/analysis";

const VIEWS = ["symbol", "market"] as const;
type View = (typeof VIEWS)[number];

const pageSearch = z.object({
  symbol: z.string().max(12).default("NVDA"),
  range: z.enum(CHART_RANGES).default("1y").catch("1y"),
  // Links from before the page was rebuilt carry view=chart, indicators, signals, risk, quant or cross.
  // Those views are sections of the one symbol page now, so anything unknown opens it.
  view: z.enum(VIEWS).default("symbol").catch("symbol"),
});

export const Route = createFileRoute("/_authenticated/app/markets")({
  validateSearch: pageSearch,
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Technicals · FiledUnder" },
      {
        name: "description",
        content: "Price chart, a technical read with the evidence behind each sentence, levels, volatility and relative strength.",
      },
      { property: "og:title", content: "Technicals · FiledUnder" },
      {
        property: "og:description",
        content: "Price chart, a technical read with the evidence behind each sentence, levels, volatility and relative strength.",
      },
    ],
  }),
  component: Markets,
});

const SYMBOL_NAV: NavItem[] = [
  { id: "chart", label: "Chart" },
  { id: "read", label: "Read" },
  { id: "evidence", label: "Evidence" },
  { id: "levels", label: "Levels and risk" },
  { id: "volatility", label: "Volatility" },
  { id: "relative", label: "Relative strength" },
  { id: "flows", label: "Short interest" },
  { id: "events", label: "Events" },
];

/** When the quote is from: a stored close carries a date, a live quote a time (shown in New York time). */
function asOf(t: string | undefined) {
  if (!t) return "";
  if (t.length <= 10) return `close of ${fmtDate(t)}`;
  return `as of ${fmtDate(t, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
}

function Markets() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const symbol = s.symbol.toUpperCase();
  const view: View = s.view;
  // View state lives in the address; changing it never moves the page.
  const setSearch = (patch: Partial<{ symbol: string; range: ChartRange; view: View }>) =>
    navigate({ search: (p) => ({ ...p, ...patch }), resetScroll: false, replace: Object.keys(patch).every((k) => k === "range") });

  const tech = useTechnicals(symbol);
  const { covered, benchmark, history, T } = tech;
  const quote = useQuotes([symbol]).data?.quotes[0];
  const name = nameWithoutSymbol(covered?.shortName ?? benchmark?.name ?? quote?.name ?? symbol, symbol);
  const loading = tech.historyLoading || tech.computing;
  const tooShort = !tech.historyLoading && !!history && history.bars.c.length < MIN_BARS;
  const nav = view === "market" ? MARKET_NAV : SYMBOL_NAV.filter((n) => n.id !== "flows" || !!covered);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        className="mb-0"
        eyebrow="Markets"
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {covered && <CompanyLogo ticker={symbol} size="lg" decorative />}
            <span className="min-w-0 truncate">{name}</span>
            <span className="num text-xl text-muted-foreground">{symbol}</span>
          </span>
        }
        description={
          quote ? (
            <span className="num" data-section="Quote">
              <span className="text-foreground">{fmtPrice(quote.price)}</span>{" "}
              <span className={quote.change > 0 ? "text-positive" : quote.change < 0 ? "text-negative" : undefined}>{fmtPct(quote.changePct, 2, true)}</span>
              <span className="text-muted-foreground">
                {" "}
                {asOf(quote.marketTime)}
              </span>
            </span>
          ) : history ? (
            <span className="num">
              <span className="text-foreground">{fmtPrice(history.bars.c[history.bars.c.length - 1])}</span>
              <span className="text-muted-foreground"> close of {fmtDate(history.last)}</span>
            </span>
          ) : undefined
        }
        actions={
          <>
            <SymbolPicker symbol={symbol} onPick={(v) => setSearch({ symbol: v, view: "symbol" })} />
            {covered && (
              <Button variant="outline" asChild>
                <Link to="/app/companies/$ticker" params={{ ticker: symbol }}>
                  Fundamentals
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div
        data-section="Technicals navigation"
        className="sticky top-[var(--sticky-top,3.5rem)] z-10 -mx-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-background/95 px-4 py-1.5 backdrop-blur lg:-mx-6 lg:px-6"
      >
        <Segmented
          label="View"
          value={view}
          onChange={(v) => setSearch({ view: v })}
          options={[
            { v: "symbol", l: symbol, title: `Chart, read and evidence for ${symbol}` },
            { v: "market", l: "Market", title: "Breadth, events across tracked companies and a scan" },
          ]}
        />
        <SectionNav key={view} items={nav} className="flex-1" />
      </div>

      {view === "market" ? (
        <MarketView symbol={symbol} onPick={(v) => setSearch({ symbol: v, view: "symbol" })} />
      ) : (
        <>
          <ChartPanel
            symbol={symbol}
            history={history}
            loading={tech.historyLoading}
            T={T}
            company={tech.company}
            releases={tech.releases}
            sectorEtf={covered?.sectorEtf}
            range={s.range}
            onRange={(r) => setSearch({ range: r })}
          />
          {tooShort || tech.error ? (
            <p data-section="Technical read" id="read" className="rounded-md border bg-card px-3 py-4 text-[13px] leading-5 text-muted-foreground shadow-paper">
              {tech.error
                ? `The analysis for ${symbol} could not be computed (${tech.error.message}). The chart above still works.`
                : `${symbol} has ${history!.bars.c.length} daily bars. The read, the evidence and the measures need at least ${MIN_BARS}.`}
            </p>
          ) : !tech.historyLoading && !history ? null : (
            <>
              <ReadPanel symbol={symbol} T={T} loading={loading} />
              <EvidencePanel symbol={symbol} T={T} bars={history?.bars ?? null} loading={loading} />
              <LevelsPanel T={T} loading={loading} />
              <VolatilityPanel symbol={symbol} T={T} loading={loading} covered={!!covered} />
              <RelativePanel symbol={symbol} T={T} loading={loading} cross={tech.cross} covered={!!covered} onPick={(v) => setSearch({ symbol: v })} />
              {covered && <ShortAndFlows symbol={symbol} placeholder />}
              <EventsPanel symbol={symbol} T={T} loading={loading} />
            </>
          )}
        </>
      )}
    </div>
  );
}
