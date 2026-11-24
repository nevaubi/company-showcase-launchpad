import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader, Panel, Stat } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Scoreboard } from "@/components/signals/scoreboard";
import { SetupsList } from "@/components/signals/setups-list";
import { FilterSelect, SECTION_OFFSET, SectionJump } from "@/components/signals/parts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { EVIDENCE } from "@/lib/signals/evidence";
import { luckLines, verdictLine } from "@/lib/signals/explain";
import { count, dayLong, num, pct } from "@/lib/signals/format";
import { setupsQuery, sparksQuery, type SetupsData } from "@/lib/signals/queries";
import { DEFAULT_FILTERS, LIQUIDITY_FLOORS, RANK_LIMITS, rankSetups, type HoldFilter, type RankedSetup, type RankFilters, type SideFilter } from "@/lib/signals/rank";
import { FAMILY_LABEL, type Family } from "@/lib/signals/strategies";
import { defaultView, filtersActive, filtersOf, searchOf, SETUP_FAMILIES, setupsSearch, type SetupsSearch, type SetupView } from "@/lib/signals/url-state";

export const Route = createFileRoute("/_authenticated/app/setups")({
  validateSearch: (s: Record<string, unknown>): SetupsSearch => setupsSearch.parse(s),
  head: () => ({
    meta: [
      { title: "Short-term setups · FiledUnder" },
      { name: "description", content: "Published short-term trading rules re-tested every night across 1,800 US stocks after costs, with a short list that only holds signals from rules that stand out from luck." },
      { property: "og:title", content: "Short-term setups · FiledUnder" },
      { property: "og:description", content: "Short-term rules re-tested every night, judged against luck, with a live record beside every backtest." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupsPage,
});

/** Rows of the "all fired" view shown at once; the filters narrow the rest. */
const ALL_LIMIT = 100;

/** The page's sections, for the in-page nav. */
const SECTIONS = [
  { id: "today", label: "Today's setups" },
  { id: "scoreboard", label: "Scoreboard" },
  { id: "method", label: "How this is tested" },
] as const;

function SetupsPage() {
  const { data, isLoading, error, refetch } = useQuery(setupsQuery);
  if (error) return <DataUnavailable title="Setups could not load" error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Signals"
        title="Short-term setups"
        description={`${data.variants.length} published trading rules, re-tested every night on ${count(data.companies)} stocks and judged only on trades since ${data.oosStart.slice(0, 4)}, after costs. A signal makes the short list only when its rule stands out from luck. Holds run from a day to eight weeks. Not investment advice.`}
        actions={
          <>
            <span className="text-[11px] text-muted-foreground">
              Closing prices {dayLong(data.asOf)} · {data.source === "daily" ? "refreshed nightly" : "full history run"}
            </span>
            <Button asChild size="xs" variant="outline">
              <Link to="/app/autopilots">
                <Bot aria-hidden /> Autopilots
              </Link>
            </Button>
          </>
        }
      />
      <SectionJump sections={SECTIONS} />
      <MarketStrip data={data} />
      <TodayPanel data={data} />
      <Panel id="scoreboard" className={SECTION_OFFSET} title="Scoreboard: every rule, backtest against live" subtitle="Sorted by how far each rule stands from luck. Open a row for its record, checks and regimes." collapse={false}>
        <div data-section="Strategy scoreboard">
          <Scoreboard data={data} book={data.book} />
        </div>
      </Panel>
      <MethodPanel data={data} />
    </div>
  );
}

/** Tiles of the strip: the hairlines between them are the grid's gaps. */
const TILE = "border-0 bg-card";

function MarketStrip({ data }: { data: SetupsData }) {
  const m = data.market;
  const d = data.book.discovery;
  const listed = d.proven + d.candidates + d.watch;
  const term = m?.vixRatio == null ? null : m.vixRatio >= 1 ? "inverted" : m.vixRatio >= 0.95 ? "flat" : "normal";
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3 lg:grid-cols-6" data-section="Market context">
      <Stat className={TILE} label="Market regime" value={data.regime} sub="200-day trend, VIX at 20" />
      <Stat className={TILE} label="VIX" value={num(m?.vix, 1)} sub={m?.vix3m ? `3-month ${num(m.vix3m, 1)}, ${term}` : "Cboe"} tone={m?.vixRatio != null && m.vixRatio >= 1 ? "negative" : "neutral"} />
      <Stat className={TILE} label="Above 200-day average" value={pct(m?.breadth200, 0, false)} sub="share of covered stocks" />
      <Stat className={TILE} label="Near 52-week high" value={pct(m?.nearHighs, 0, false)} sub="within 2%" />
      <Stat className={TILE} label="Volume sold short" value={pct(m?.shortRatio, 0, false)} sub="5-day median, FINRA" />
      <Stat className={TILE} label="Rules that clear the bar" value={`${listed} of ${d.tested}`} sub={`${count(data.live.length)} live signals fired`} tone={listed ? "positive" : "neutral"} />
    </div>
  );
}

const SIDE_OPTIONS: { v: SideFilter; l: string }[] = [
  { v: "all", l: "All" },
  { v: "long", l: "Long" },
  { v: "short", l: "Short" },
];
const HOLD_OPTIONS: { v: HoldFilter; l: string; title?: string }[] = [
  { v: "all", l: "Any hold" },
  { v: "week", l: "Up to a week", title: "1 to 5 trading days" },
  { v: "fortnight", l: "Two weeks", title: "6 to 10 trading days" },
  { v: "month", l: "A month or more", title: "20 trading days and longer" },
];

function TodayPanel({ data }: { data: SetupsData }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const sectors = useMemo(() => [...new Set(data.live.map((s) => s.sector).filter(Boolean))].sort(), [data.live]);
  const filters = useMemo(() => filtersOf(search, sectors), [search, sectors]);
  const ranking = useMemo(() => rankSetups(data.book, data.live, filters), [data.book, data.live, filters]);
  const view: SetupView = search.view ?? defaultView(ranking.list.length);
  const rows: RankedSetup[] = view === "short" ? ranking.list : view === "closest" ? ranking.closest : ranking.all.slice(0, ALL_LIMIT);
  const sparks = useQuery(sparksQuery(data.asOf, rows));
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ranking.all) m.set(r.key, (m.get(r.key) ?? 0) + 1);
    return m;
  }, [ranking.all]);

  // View state only: the address changes, the page does not move.
  const patch = useCallback((p: Partial<SetupsSearch>) => void navigate({ search: (prev: SetupsSearch) => ({ ...prev, ...p }), replace: true, resetScroll: false }), [navigate]);
  const setFilters = (f: Partial<RankFilters>) => patch(searchOf({ ...filters, ...f }));

  const track = useMutation({
    mutationFn: async (s: RankedSetup) => {
      const { error } = await supabase.from("paper_trades").insert({ ticker: s.ticker, direction: s.side > 0 ? "long" : "short", entry_price: s.price, stop: s.stop, target: s.target, signals: [s.key] });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Added to your paper trades");
      void qc.invalidateQueries({ queryKey: ["paper_trades"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const note =
    view === "short"
      ? ranking.list.length
        ? `Best first. At most ${RANK_LIMITS.perRule} signals per rule and per sector and one per stock, so one rule or one sector cannot fill the list.`
        : "The short list is empty. Nothing is added to fill it: the closest rules are one click away."
      : view === "closest"
        ? `Not on the short list. These ${rows.length} signals come from the rules closest to the bar, best-evidenced rule first, with the same limits (${RANK_LIMITS.perRule} per rule and sector, one per stock). Treat them as a watch list, not as evidence.`
        : `Every live signal that passes the filters, one per stock and rule, best-evidenced rule first${ranking.all.length > ALL_LIMIT ? `. Showing the first ${ALL_LIMIT} of ${count(ranking.all.length)}: narrow with the filters` : ""}.`;

  return (
    <Panel
      id="today"
      className={SECTION_OFFSET}
      title="Today's setups"
      subtitle={`Signals fired on the last three sessions to ${dayLong(data.asOf)}`}
      actions={
        <Segmented<SetupView>
          label="Which signals to show"
          size="xs"
          value={view}
          onChange={(v) => patch({ view: v })}
          options={[
            { v: "short", l: `Short list ${ranking.list.length}`, title: "Signals from rules that stand out from luck" },
            { v: "closest", l: `Closest ${ranking.closest.length}`, title: "The next in line: rules with a positive record that do not clear the bar" },
            { v: "all", l: `All fired ${count(ranking.all.length)}`, title: "Every live signal that passes the filters" },
          ]}
        />
      }
      collapse={false}
    >
      <div data-section="Today's setups" className="space-y-3">
        <div>
          <p className="max-w-[60rem] text-[13px] font-medium leading-5">{verdictLine(data.book)}</p>
          <p className="mt-0.5 max-w-[60rem] text-[11px] leading-4 text-muted-foreground">{note}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Filters">
          <Segmented<SideFilter> label="Side" size="xs" value={filters.side} onChange={(v) => setFilters({ side: v })} options={SIDE_OPTIONS} />
          <Segmented<HoldFilter> label="Holding period" size="xs" value={filters.hold} onChange={(v) => setFilters({ hold: v })} options={HOLD_OPTIONS} />
          <FilterSelect<"all" | Family>
            label="Family"
            value={filters.family}
            onChange={(v) => setFilters({ family: v })}
            options={[{ v: "all", l: "All families" }, ...SETUP_FAMILIES.map((f) => ({ v: f, l: FAMILY_LABEL[f] }))]}
          />
          <FilterSelect label="Sector" value={filters.sector} onChange={(v) => setFilters({ sector: v })} options={[{ v: "all", l: "All sectors" }, ...sectors.map((s) => ({ v: s, l: s }))]} />
          <FilterSelect
            label="Traded a day"
            value={String(filters.minDollarVolume)}
            onChange={(v) => setFilters({ minDollarVolume: Number(v) })}
            options={LIQUIDITY_FLOORS.map((f) => ({ v: String(f), l: f >= 1e9 ? `$${f / 1e9}B or more` : `$${f / 1e6}M or more` }))}
          />
          {filtersActive(filters) && (
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Reset filters
            </Button>
          )}
        </div>
        {data.liveError ? (
          <DataUnavailable compact title="Live signals could not load" hint={data.liveError} onRetry={() => void qc.invalidateQueries({ queryKey: setupsQuery.queryKey })} />
        ) : rows.length ? (
          <SetupsList rows={rows} book={data.book} sparks={sparks.data} totals={view === "all" ? undefined : totals} onTrack={(r) => track.mutate(r)} tracking={track.isPending} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-[13px] leading-5 text-muted-foreground">
            {view === "short" && !filtersActive(filters) ? (
              <>
                <span>No signal is listed today.</span>
                {ranking.closest.length > 0 && (
                  <Button size="xs" variant="outline" onClick={() => patch({ view: "closest" })}>
                    See the {ranking.closest.length} closest
                  </Button>
                )}
              </>
            ) : (
              <span>No live signal matches these filters{view === "short" ? " on the short list" : ""}.</span>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

const SOURCES = [
  ["Daily prices", "Yahoo Finance, with Nasdaq and Cboe as fallbacks; split and dividend adjusted", "https://finance.yahoo.com"],
  ["Earnings dates", "SEC 8-K filings with item 2.02", "https://www.sec.gov/edgar/search/"],
  ["Insider purchases", "SEC Form 4 and the SEC insider transactions data sets", "https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets"],
  ["Short-sale volume", "FINRA daily short-sale volume files, from August 2018", "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data"],
  ["Volatility term structure", "Cboe VIX and VIX3M daily history", "https://www.cboe.com/tradable_products/vix/"],
  ["Supplier and customer links", "Sentences quoted from 10\u2011K and 10\u2011Q filings, from late 2023", null],
] as const;

function MethodPanel({ data }: { data: SetupsData }) {
  const year = data.oosStart.slice(0, 4);
  return (
    <Panel id="method" className={SECTION_OFFSET} title="How this is tested" subtitle="Fixed rules, real costs, and a bar set by how many rules were tried" collapse={false}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-3" data-section="Methodology">
        <div className="min-w-0">
          <h3 className="mb-1 text-[13px] font-semibold leading-5">The test</h3>
          <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 text-muted-foreground">
            <li>Each rule uses the settings of its published paper. Nothing is fitted to this data. A signal uses only what was known at that day's close; the trade enters at the next open and exits at the close after the holding period.</li>
            <li>Returns are measured against the stock's sector fund, after a round trip of 4 to 30 basis points by liquidity and 3% a year to borrow shorts. Stocks trading under $5M a day are skipped.</li>
            <li>A rule is judged on trades since {year}, month by month, with the error widened where holds run across months. Signal days are not counted as independent: holds overlap, and neighbouring days move together.</li>
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="mb-1 text-[13px] font-semibold leading-5">Keeping luck out</h3>
          <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 text-muted-foreground">
            {luckLines(data.book).map((l) => (
              <li key={l}>{l}</li>
            ))}
            <li>
              A listed rule's average is shrunk toward zero before it is called an expected edge, and a rule goes on probation once {EVIDENCE.liveMinBlocks} or more live holding periods sit well below what its backtest allows. Backtest figures are estimates, not promises.
            </li>
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="mb-1 text-[13px] font-semibold leading-5">Data sources</h3>
          <ul className="space-y-1 text-[13px] leading-5">
            {SOURCES.map(([k, v, url]) => (
              <li key={k}>
                <span className="font-medium">{k}.</span> <span className="text-muted-foreground">{v}.</span>
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" aria-label={`${k} source`} className="ml-1 inline-flex items-center align-middle text-muted-foreground transition-colors hover:text-foreground">
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
