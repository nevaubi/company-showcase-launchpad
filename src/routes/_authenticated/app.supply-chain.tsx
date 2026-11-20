import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSessionState } from "@/lib/use-session-state";
import { requestResearch } from "@/lib/research/request";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Globe2, Link2, Lock, Network, Zap } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, RELATION_LABEL, type Overlay } from "@/components/supply/supply-map-meta";
import { SupplyNetwork } from "@/components/supply/supply-network";
import { RelationFilters } from "@/components/supply/supply-toolbar";
import { RelationMark } from "@/components/supply/supply-marks";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSource } from "@/components/source/source-context";
import { supplyLinksQuery, taggedSharesQuery } from "@/lib/supply/query";
import { buildChain, type ChainFlow, type TaggedShare } from "@/lib/supply/chain";
import { ChainEvidence, ChainTable, ValueChain, type ChainSize } from "@/components/supply/value-chain";
import { ChangesTab, ReactionsTab } from "@/components/supply/supply-tabs";
import { SupplyIntel, CounterpartyEvidence } from "@/components/supply/supply-intel";
import { ConfidenceBadge, DependencyCard, RegionPanel, SupplyNotePanel } from "@/components/supply/supply-pro";
import { allSignalsQuery, ConcentrationHistory, DeepVerify, EcosystemBasket, FragilityTable, FreshnessBadge, FreshnessStrip, RegionShockPanel, WorldExposureMap } from "@/components/supply/supply-plus";
import { canonCountry, countryExposure } from "@/lib/supply/analytics";
import { AgreementTermsPanel, RegionDossierPanel, RegionRiskRegister } from "@/components/supply/supply-region";
import { confidence, mirrors, type ProLink } from "@/lib/supply/core";
import { exposureSummary, KIND_WORD, NATURE_WORD } from "@/lib/supply/describe";
import { resolveSelection, selectionParam, SUPPLY_TABS, SUPPLY_VIEWS, supplySearch, type SupplySearch, type SupplyTab, type SupplyView } from "@/lib/supply/url-state";
import { useUniverse } from "@/lib/data";
import { COVERAGE } from "@/lib/coverage";
import { focusGraph, nodeRisk, RELATIONS, secondOrder, simulateShock, type GraphNode, type Relation, type RiskLink, type ShockImpact } from "@/lib/supply/core";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const SupplyGlobe = lazy(() => import("@/components/supply/supply-globe"));

/** The three ways to look at the links. "flow" and the old node map were folded into Network; a stored old value falls back to it. */
const VIEWS = SUPPLY_VIEWS;
type View = SupplyView;
const VIEW_LABEL: Record<View, string> = { network: "Network", globe: "Globe", chain: "Chain" };
const isView = (v: unknown): v is View => typeof v === "string" && (VIEWS as readonly string[]).includes(v);
const isOverlay = (v: unknown): v is Overlay => typeof v === "string" && OVERLAYS.some((o) => o.v === v);
const isTab = (v: unknown): v is SupplyTab => typeof v === "string" && (SUPPLY_TABS as readonly string[]).includes(v);

export const Route = createFileRoute("/_authenticated/app/supply-chain")({
  // view, selected name, overlay, depth and tab live in the address so a copied link reopens the same picture
  validateSearch: (s: Record<string, unknown>): SupplySearch => supplySearch.parse(s),
  head: () => ({
    meta: [
      { title: "Supply chain map · FiledUnder" },
      { name: "description", content: "Interactive map of named customers, suppliers, partners and competitors with dollar exposure, risk flags and a shock simulator, every link quoted from a 10-K." },
      { property: "og:title", content: "Supply chain map · FiledUnder" },
      { property: "og:description", content: "Customers, suppliers, partners and competitors with dollar exposure and shock simulation, every link quoted from the 10-K." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplyChainPage,
});

/** Segmented control button: 28px tall, quiet until chosen. */
const segment = (on: boolean) =>
  cn("inline-flex h-7 items-center rounded-[4px] px-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", on ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground");

const OVERLAYS: { v: Overlay; label: string }[] = [
  { v: "none", label: "No overlay" },
  { v: "single", label: "Single source (stated)" },
  { v: "concentration", label: "Concentration ≥10%" },
  { v: "geo", label: "Geopolitical hotspots" },
  { v: "dollars", label: "Dollar figures (flow or share × revenue)" },
];

function SupplyChainPage() {
  const search = Route.useSearch();
  const ticker = (search.t ?? "NVDA").toUpperCase();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: universe } = useUniverse();
  const linksQuery = useQuery(supplyLinksQuery);
  const { data: links, isLoading } = linksQuery;
  const [visible, setVisible] = useState<Set<Relation>>(new Set(RELATIONS));
  /* The address wins; without it the page falls back to what this session last chose. Changes replace the history entry,
     so Back still leaves the page (or returns to the previous company) instead of stepping through every click. */
  const [savedDepth, setSavedDepth] = useSessionState<number>("fu:supply:depth", 1, (v): v is number => v === 1 || v === 2);
  const [savedOverlay, setSavedOverlay] = useSessionState<Overlay>("fu:supply:overlay", "none", isOverlay);
  const [savedTab, setSavedTab] = useSessionState<string>("fu:supply:tab", "evidence", isTab);
  const [savedView, setSavedView] = useSessionState<View>("fu:supply:view", "network", isView);
  const view: View = search.view ?? savedView;
  const overlay: Overlay = search.overlay ?? savedOverlay;
  const depth: 1 | 2 = (search.depth ?? savedDepth) === 2 ? 2 : 1;
  const tab: string = search.tab ?? savedTab;
  const patch = useCallback((p: Partial<SupplySearch>) => navigate({ search: (prev: SupplySearch) => ({ ...prev, ...p }), replace: true }), [navigate]);
  const setOverlay = (o: Overlay) => { setSavedOverlay(o); patch({ overlay: o === "none" ? undefined : o }); };
  const setDepth = (d: 1 | 2) => { setSavedDepth(d); patch({ depth: d === 2 ? 2 : undefined }); };
  const setTab = (t: string) => { setSavedTab(t); patch({ tab: isTab(t) && t !== "evidence" ? t : undefined }); };
  /* a picture restored from the session is written into the address once, so copying the link shares what is on screen */
  useEffect(() => {
    const fill: Partial<SupplySearch> = {};
    if (!search.view && savedView !== "network") fill.view = savedView;
    if (!search.overlay && savedOverlay !== "none") fill.overlay = savedOverlay;
    if (!search.depth && savedDepth === 2) fill.depth = 2;
    if (Object.keys(fill).length) patch(fill);
  }, [savedView, savedOverlay, savedDepth, search.view, search.overlay, search.depth, patch]);
  const [shockSrc, setShockSrc] = useState<string | null>(null);
  const [shock, setShock] = useState(20);
  const [chainDepth, setChainDepth] = useSessionState<number>("fu:supply:chain-depth", 2);
  const [chainSel, setChainSel] = useState<string | null>(null);
  const [chainWide, setChainWide] = useState(true);
  const [chainFlow, setChainFlow] = useSessionState<ChainFlow>("fu:supply:chain-flow", "all");
  const [chainSize, setChainSize] = useSessionState<ChainSize>("fu:supply:chain-size", "share");
  const [chainProduct, setChainProduct] = useState("");
  const product = useDeferredValue(chainProduct);
  const { data: tagged } = useQuery({ ...taggedSharesQuery, enabled: view === "chain" });
  const { open } = useSource();
  const { data: signals } = useQuery(allSignalsQuery);
  const [country, setCountry] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const names = useMemo(() => Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName])), []);
  const covered = useMemo(() => new Set(Object.keys(names)), [names]);
  const revenue = useMemo(() => Object.fromEntries((universe?.companies ?? []).map((c) => [c.ticker, c.revenueTTM ?? undefined])), [universe]);
  const all = links ?? [];
  const graph = useMemo(() => focusGraph(ticker, all, names), [ticker, all, names]);
  // the unfiltered chain decides whether there is anything to draw; filters narrow what is drawn
  const fullChain = useMemo(() => (view === "chain" ? buildChain(ticker, all as RiskLink[], tagged ?? [], names, revenue, { depth: chainDepth }) : null), [view, ticker, all, tagged, names, revenue, chainDepth]);
  const chain = useMemo(
    () => (fullChain && (chainFlow !== "all" || product.trim()) ? buildChain(ticker, all as RiskLink[], tagged ?? [], names, revenue, { depth: chainDepth, flow: chainFlow, product }) : fullChain),
    [fullChain, chainFlow, product, ticker, all, tagged, names, revenue, chainDepth],
  );
  const hop2 = useMemo(() => (depth === 2 ? secondOrder(ticker, graph, all, names) : []), [depth, ticker, graph, all, names]);
  const risks = useMemo(() => Object.fromEntries([...graph, ...hop2].map((n) => [n.key, nodeRisk(n.links as RiskLink[], revenue)])), [graph, hop2, revenue]);
  const focus: GraphNode = { key: "focus", name: names[ticker] ?? ticker, ticker, domain: null, relation: "focus", links: [] };
  const byId = useMemo(() => new Map((all as ProLink[]).map((l) => [l.id, l])), [all]);
  const selected = useMemo(() => resolveSelection([...graph, ...hop2], search.sel), [graph, hop2, search.sel]);
  const sel = [...graph, ...hop2].find((n) => n.key === selected) ?? null;
  const counts = Object.fromEntries(RELATIONS.map((r) => [r, graph.filter((n) => n.relation === r).length])) as Record<Relation, number>;

  const countryList = useMemo(() => [...new Set([...(all as ProLink[]).flatMap((l) => (l.regions ?? []).map((r) => canonCountry(r)!)), ...(signals ?? []).map((x) => canonCountry(x.country)!)])].filter(Boolean), [all, signals]);
  const src = shockSrc ?? ticker;
  const impacts = useMemo(() => (tab === "shock" ? simulateShock(src, shock / 100, all, names, revenue) : []), [tab, src, shock, all, names, revenue]);
  const impactMap = useMemo(() => (tab === "shock" ? new Map(impacts.map((i) => [i.key, i])) : null), [tab, impacts]);

  /* Exposure counts each name once (its largest stated flow, or stated customer share × SEC revenue). Other stated figures
     (guarantees, investments, financing, commitments, settlements, balances) are listed apart and never added. */
  const summary = useMemo(() => {
    const vals = Object.values(risks);
    const { exposure, others, total } = exposureSummary(graph, revenue);
    return {
      single: vals.filter((r) => r.singleSource).length,
      dependency: vals.filter((r) => r.dependency).length,
      conc: vals.filter((r) => r.concentrated).length,
      hotspots: [...new Set(vals.flatMap((r) => r.hotspots))],
      exposure,
      others,
      total,
    };
  }, [risks, graph, revenue]);
  // What the globe tints: the same per-country rows as the World exposure panel in its company scope.
  const exposureRows = useMemo(
    () => countryExposure((all as ProLink[]).filter((l) => l.ticker === ticker || l.counterparty_ticker === ticker), (signals ?? []).filter((x) => x.ticker === ticker), revenue)
      .filter((r) => r.country !== "United States" || r.links + r.facilities > 0),
    [all, signals, ticker, revenue],
  );
  /* one address change per click: the selection and the tab it opens move together */
  const pick = (k: string | null) => {
    const n = k ? [...graph, ...hop2].find((x) => x.key === k) : null;
    setSavedTab("evidence");
    patch({ sel: n ? selectionParam(n) : undefined, tab: undefined });
  };
  // Loading, error and empty states keep a fixed frame; every view grows with its content (the globe sets its own map height).
  const fixedCanvas = isLoading || (linksQuery.isError && !links) || (view === "chain" ? !(chain && chain.nodes.length > 1) : graph.length === 0);
  // The same hotspot list the region register below shows, so the header and the register never disagree.
  const hotspotRegions = useMemo(() => {
    if (summary.hotspots.length) return summary.hotspots;
    return countryExposure((all as ProLink[]).filter((l) => l.ticker === ticker), (signals ?? []).filter((x) => x.ticker === ticker), revenue)
      // a country counts only when a filing sentence or a verified signal names it, not because a counterparty is based there
      .filter((r) => r.hotspot && r.country !== "United States" && r.country.length < 40 && r.links + r.facilities + r.policy + r.risks > 0)
      .map((r) => r.country);
  }, [summary.hotspots, all, signals, ticker, revenue]);

  function go(tk: string) {
    setChainSel(null);
    setShockSrc(null);
    navigate({ search: { t: tk } });
  }
  const toggle = (r: Relation) =>
    setVisible((v) => {
      const n = new Set(v);
      n.has(r) ? n.delete(r) : n.add(r);
      return n;
    });
  const openLink = (l: RiskLink, label: string) =>
    open({ ticker: l.ticker, label, unit: "usd", value: 0, doc: { accn: l.accn, doc: l.doc, form: l.form, filed: l.filed, title: `${l.ticker} ${l.form}`, search: l.quote } });
  const openTag = (f: TaggedShare) =>
    open({ ticker: f.ticker, label: `${names[f.ticker] ?? f.ticker}: ${f.label} as a ${f.kind}`, periodLabel: fmtDate(f.period_end), unit: "pct", value: f.pct, src: { accn: f.accn, concept: "us-gaap:ConcentrationRiskPercentage1", end: f.period_end, value: f.pct }, elementId: f.element_id ?? undefined });
  const chainEvidence =
    chain && chainSel ? (
      <ChainEvidence
        chain={chain}
        nodeKey={chainSel}
        names={names}
        onFocus={go}
        onOpenText={openLink}
        onOpenTag={openTag}
      />
    ) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Filings and data"
        title="Supply chain map"
        description="Who each company sells to, buys from, works with and competes against, as named in its latest 10-K and 10-Q, with stated revenue, purchase and contract figures, risk flags, year-over-year changes, earnings sympathy moves and a shock simulator. A figure, flag or region is shown only when its sentence states it, and every link opens that sentence."
        actions={
          <Select value={ticker} onValueChange={go}>
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(universe?.companies ?? []).map((c) => (
                <SelectItem key={c.ticker} value={c.ticker}>
                  {c.ticker} · {names[c.ticker] ?? c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div data-tour="supply-stats" data-section="Supply stats" className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat loading={isLoading} label="Disclosed $ exposure" value={summary.exposure.length ? fmtCompactUsd(summary.total) : "—"}
          hint={`${summary.exposure.length} ${summary.exposure.length === 1 ? "name" : "names"} with stated flows or shares${summary.others.length ? ` · ${summary.others.length} other ${summary.others.length === 1 ? "figure" : "figures"} not added` : ""}`} />
        <Stat loading={isLoading} label="Concentrated (≥10%)" value={String(summary.conc)} hint="counterparties" />
        <Stat loading={isLoading} label="Single-source" value={String(summary.single)} hint={summary.dependency ? `sole-source wording · ${summary.dependency} more stated ${summary.dependency === 1 ? "dependency" : "dependencies"}` : "sole-source wording in the filing"} icon={<Lock className="size-3.5" />} />
        <Stat
          loading={isLoading}
          label="Hotspot regions"
          value={hotspotRegions.length ? `${hotspotRegions.slice(0, 3).join(", ")}${hotspotRegions.length > 3 ? ` +${hotspotRegions.length - 3}` : ""}` : "None stated"}
          hint={summary.hotspots.length ? "tied to links in the filing" : hotspotRegions.length ? "named in filings and calls · see the region register" : "in filings and calls"}
          icon={<Globe2 className="size-3.5" />}
        />
        <FreshnessStrip links={graph.flatMap((n) => n.links) as ProLink[]} today={today} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <RelationFilters counts={counts} visible={visible} onToggle={toggle} loading={isLoading} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" data-agent-controls data-tour="supply-views" className="inline-flex rounded-md border bg-card p-0.5 text-xs shadow-paper">
            {VIEWS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => { setSavedView(v); if (v === "chain") setSavedTab("evidence"); patch({ view: v === "network" ? undefined : v, ...(v === "chain" ? { tab: undefined } : {}) }); }} className={segment(view === v)}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          {view !== "chain" && (
            <>
          <div role="group" aria-label="Depth" data-agent-controls className="inline-flex rounded-md border bg-card p-0.5 text-xs shadow-paper">
            {([1, 2] as const).map((d) => (
              <button key={d} type="button" aria-pressed={depth === d} onClick={() => setDepth(d)} className={segment(depth === d)}>
                {d === 1 ? "Direct" : "+ 2nd order"}
              </button>
            ))}
          </div>
          <Select value={overlay} onValueChange={(v) => setOverlay(v as Overlay)}>
            <SelectTrigger aria-label="Risk overlay" className="h-8 w-[220px] text-xs shadow-paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OVERLAYS.map((o) => (
                <SelectItem key={o.v} value={o.v}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
            </>
          )}
        </div>
      </div>

      <div className={cn("grid grid-cols-1 gap-4", view !== "chain" && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className={cn("relative min-w-0 overflow-hidden rounded-md border bg-card shadow-paper", fixedCanvas && "h-[640px]")}>
          {linksQuery.isError && !links ? <div role="alert" className="grid h-full place-content-center gap-3 p-6 text-sm text-muted-foreground">Supply-chain records are temporarily unavailable.<Button variant="outline" size="sm" onClick={() => linksQuery.refetch()}>Retry</Button></div> : isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : view === "chain" && chain ? (
            (fullChain?.nodes.length ?? 0) > 1 ? (
              <ValueChain chain={chain} depth={chainDepth} onDepth={setChainDepth} flow={chainFlow} onFlow={(f) => { setChainFlow(f); setChainSel(null); }} product={chainProduct} onProduct={(p) => { setChainProduct(p); setChainSel(null); }} size={chainSize} onSize={setChainSize} selected={chainSel} onSelect={(k) => {
                  setChainSel(k);
                  setTab("evidence");
                  // On phones the evidence sits under the list: bring it into view.
                  if (k && !chainWide) requestAnimationFrame(() => document.getElementById("supply-analysis")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }} evidence={chainSel ? chainEvidence : null} onWide={setChainWide} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <Network className="size-6" />
                No filing names a supplier or customer of {focus.name} yet, so there is no chain to draw.
              </div>
            )
          ) : graph.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Network className="size-6" />
              No named customers or suppliers found in {focus.name}'s latest 10-K yet.
            </div>
          ) : view === "globe" ? (
            <ClientOnly fallback={<Skeleton className="h-[640px] w-full" />}>
              <Suspense fallback={<Skeleton className="h-[640px] w-full" />}>
                <SupplyGlobe focus={focus} graph={graph} hop2={hop2} visible={visible} selected={selected} onSelect={pick} overlay={overlay} risks={risks} impacts={impactMap} rows={exposureRows} country={country} onCountry={setCountry} />
              </Suspense>
            </ClientOnly>
          ) : (
            <SupplyNetwork focus={focus} graph={graph} hop2={hop2} visible={visible} selected={selected} onSelect={pick} overlay={overlay} risks={risks} impacts={impactMap} />
          )}
        </div>

        {view === "chain" && chain && chain.nodes.length > 1 && (
          <ChainTable
            chain={chain}
            names={names}
            revenue={revenue}
            onOpenText={openLink}
            onOpenTag={openTag}
            onSelect={(k) => {
              setChainSel(k);
              setTab("evidence");
              if (!chainWide) requestAnimationFrame(() => document.getElementById("supply-analysis")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              else window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}

        <Panel title="Analysis" className="min-w-0 scroll-mt-16" id="supply-analysis">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-3 grid w-full grid-cols-5">
              <TabsTrigger value="evidence" className="px-1 text-xs">Evidence</TabsTrigger>
              <TabsTrigger value="reactions" className="px-1 text-xs">Moves</TabsTrigger>
              <TabsTrigger value="changes" className="px-1 text-xs">Changes</TabsTrigger>
              <TabsTrigger data-tour="supply-shock" value="shock" className="px-1 text-xs">Shock</TabsTrigger>
              <TabsTrigger value="exposure" className="px-1 text-xs">Exposure</TabsTrigger>
            </TabsList>
            <TabsContent value="reactions">
              {tab === "reactions" && <ReactionsTab ticker={ticker} name={focus.name} graph={graph} covered={covered} onSelect={pick} />}
            </TabsContent>
            <TabsContent value="changes">
              {tab === "changes" && <ChangesTab ticker={ticker} name={focus.name} onOpen={(l, label) => openLink(l as RiskLink, label)} />}
            </TabsContent>

            <TabsContent value="evidence" data-section="Link evidence">
              {view === "chain" && chain ? (
                chainSel && !chainWide ? (
                  chainEvidence
                ) : (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>{chainSel ? "The filings that link the company you picked are open beside the chain." : "Pick a company in the chain to see the filings that link it."}</p>
                    <p className="text-xs">The chain joins every quoted 10-K/10-Q link with customer and supplier shares companies tag in their XBRL, so it can reach past the companies we cover: a supplier's own customers and a customer's own customers.</p>
                  </div>
                )
              ) : sel ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <CompanyLogo ticker={sel.ticker ?? sel.name.slice(0, 4).toUpperCase()} src={externalLogo(sel.domain, sel.ticker)} size="lg" />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{sel.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {sel.ticker ?? "Not in coverage"} · {sel.relation}
                        {"hop" in sel ? " (2nd order)" : ` of ${focus.name}`}
                      </p>
                    </div>
                  </div>
                  <RiskBadges r={risks[sel.key] && sel.relation === "competitor" ? { ...risks[sel.key], nature: "trade" } : risks[sel.key]} />
                  {(sel.links as RiskLink[]).map((l) => (
                    <div key={l.id} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs font-medium text-muted-foreground">
                        From {names[l.ticker] ?? l.ticker}'s {l.form}, filed {fmtDate(l.filed)}
                        {/* figures this filing's own sentence states; a figure only an older copy states is listed with that copy below */}
                        {(l.own ?? l).share_pct != null && <span className="ml-1 text-foreground">· {(l.own ?? l).share_pct}%</span>}
                        {(l.own ?? l).amount_usd != null && (l.own ?? l).amount_usd! > 0 && (
                          <span className="ml-1 text-foreground">· {fmtCompactUsd((l.own ?? l).amount_usd!)} {KIND_WORD[(l.own ?? l).amount_kind ?? "other"]}{(l.own ?? l).flow_usd != null ? "" : <span className="text-muted-foreground"> (not a flow)</span>}</span>
                        )}
                      </p>
                      {l.figure_from && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {[l.figure_from.share && "share", l.figure_from.amount && "amount", l.figure_from.single && "single-source wording", l.figure_from.regions && "regions"].filter(Boolean).join(", ")} stated only in the older filing below, and counted from it
                        </p>
                      )}
                      {((l.relation !== "competitor" && NATURE_WORD[l.nature ?? "trade"]) || l.dependency || l.single_source) && (
                        <p className="mt-1 flex flex-wrap gap-1 text-[10.5px]">
                          {l.relation !== "competitor" && NATURE_WORD[l.nature ?? "trade"] && <span className="rounded border px-1.5 py-0.5 text-foreground">{NATURE_WORD[l.nature ?? "trade"]}: not a flow</span>}
                          {l.single_source && <span className="inline-flex items-center gap-1 rounded border border-negative/40 px-1.5 py-0.5 text-negative"><Lock className="size-3" />Single source</span>}
                          {l.dependency && <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-muted-foreground"><Link2 className="size-3" />Stated dependency (no sole-source wording)</span>}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        <ConfidenceBadge c={confidence(l as ProLink, all)} />
                        <FreshnessBadge filed={l.filed} today={today} />
                        {(l as ProLink).link_type && <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px]">{(l as ProLink).link_type!.replace(/_/g, " ")}</span>}
                        {(l as ProLink).product && <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px]">{(l as ProLink).product}</span>}
                      </div>
                      <p className="mt-1">{l.detail}</p>
                      {mirrors(l, all).slice(0, 1).map((m) => (
                        <button key={m.id} type="button" onClick={() => openLink(m as RiskLink, `${names[m.ticker] ?? m.ticker} confirms`)} className="mt-1 block text-left text-[11px] text-positive hover:underline">
                          {names[m.ticker] ?? m.ticker}'s {m.form} confirms: “{m.quote.slice(0, 110)}{m.quote.length > 110 ? "…" : ""}”
                        </button>
                      ))}
                      {l.risk && <p className="mt-1 text-xs text-negative">Risk: {l.risk}</p>}
                      <blockquote className="mt-2 border-l-2 border-highlight pl-2 text-xs italic text-muted-foreground">“{l.quote}”</blockquote>
                      <button type="button" onClick={() => openLink(l, `${sel.name} · ${l.relation}`)} className="mt-2 inline-flex items-center gap-1 rounded bg-highlight-soft px-2 py-1 text-xs font-medium text-foreground hover:bg-highlight hover:text-highlight-foreground">
                        <FileText className="size-3" /> Open in {l.form}
                      </button>
                      {(l.corroboration ?? []).length > 0 && (
                        <div className="mt-2 border-t pt-2">
                          <p className="text-[11px] text-muted-foreground">Also stated in {names[l.ticker] ?? l.ticker}'s other current {(l.corroboration ?? []).length === 1 ? "filing" : "filings"} (counted once):</p>
                          {(l.corroboration ?? []).map((c) => (
                            <button key={c.id} type="button" onClick={() => openLink(c, `${sel.name} · ${c.relation} · ${c.form}`)} className="mt-1 block w-full rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                              <span className="inline-flex items-center gap-1 font-medium text-foreground"><FileText className="size-3" />{c.form}, filed {fmtDate(c.filed)}</span>
                              {c.share_pct != null && <span className="num"> · {c.share_pct}%</span>}
                              {c.amount_usd != null && c.amount_usd > 0 && <span className="num"> · {fmtCompactUsd(c.amount_usd)} {KIND_WORD[c.amount_kind ?? "other"]}</span>}
                              <span className="block italic">“{c.quote.slice(0, 140)}{c.quote.length > 140 ? "…" : ""}”</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-2"><DeepVerify key={l.id} linkId={l.id} /></div>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-3">
                    {sel.ticker && <Button size="xs" variant="outline" asChild><Link to="/app/companies/$ticker" params={{ ticker: sel.ticker }}>Company research <ArrowRight /></Link></Button>}
                    <Button size="xs" variant="outline" onClick={() => requestResearch(`Investigate ${focus.name}'s ${sel.relation} relationship with ${sel.name}. Read the supply-chain evidence, dated agreements, regional risks and latest public developments. Cross-check sources, quantify only disclosed exposure and distinguish uncertainty.`)}>Investigate relationship</Button>
                    {sel.ticker && covered.has(sel.ticker) && (
                      <button type="button" onClick={() => go(sel.ticker!)} className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
                        Map {sel.name} <ArrowRight className="size-3.5" />
                      </button>
                    )}
                    {sel.ticker && (
                      <button type="button" onClick={() => { setShockSrc(sel.ticker); setTab("shock"); }} className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
                        <Zap className="size-3.5" /> Shock {sel.name}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  <p className="mb-2 text-xs text-muted-foreground">Select a company on the map, or pick one below.</p>
                  {graph.slice(0, 16).map((n) => (
                    <li key={n.key}>
                      <button type="button" onClick={() => pick(n.key)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted">
                        <RelationMark relation={n.relation as Relation} size={8} />
                        <span className="truncate">{n.name}</span>
                        {risks[n.key]?.singleSource && <Lock className="size-3 text-negative" />}
                        <span className="ml-auto text-xs text-muted-foreground">{n.relation}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="shock" data-section="Shock simulation" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                If <span className="font-medium text-foreground">{names[src] ?? src}</span>'s demand or output drops, its suppliers lose sales (sized by the revenue share they disclose) and its customers face supply disruption. Effects ripple two steps out.
              </p>
              <Select value={src} onValueChange={setShockSrc}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([ticker, ...graph.flatMap((n) => (n.ticker ? [n.ticker] : []))])].map((tk) => (
                    <SelectItem key={tk} value={tk}>
                      Shock {names[tk] ?? tk}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div>
                <div className="mb-2 flex justify-between text-xs">
                  <span>Size of shock</span>
                  <span className="num font-semibold">−{shock}%</span>
                </div>
                <Slider value={[shock]} min={5} max={80} step={5} onValueChange={([v]) => setShock(v)} />
              </div>
              {impacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked companies in the filings yet.</p>
              ) : (
                <ul className="space-y-2">
                  {impacts.slice(0, 30).map((i) => (
                    <ImpactRow key={i.key} i={i} onOpen={() => openLink(i.link, `${i.name} · ${i.channel}`)} />
                  ))}
                </ul>
              )}
              <p className="text-[10.5px] text-muted-foreground">Mechanical estimate from disclosed shares only; not a forecast.</p>
            </TabsContent>

            <TabsContent value="exposure" data-section="Stated exposure" className="space-y-3">
              {summary.exposure.length === 0 ? (
                <p className="text-sm text-muted-foreground">{focus.name}'s filings put no revenue, purchase or contract figure, and no customer share, on a named counterparty.</p>
              ) : (
                <ul className="space-y-2">
                  {summary.exposure.slice(0, 20).map(({ n, l, d, from }) => (
                    <li key={n.key} className="rounded-lg border p-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        <RelationMark relation={n.relation as Relation} size={8} />
                        <span className="truncate font-medium">{n.name}</span>
                        <span className="num ml-auto font-semibold">{fmtCompactUsd(d)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {n.relation}
                        {from === "flow" ? ` · stated ${KIND_WORD[l.amount_kind ?? "other"]}` : l.share_pct != null && ` · ${l.share_pct}% of ${names[l.ticker] ?? l.ticker}'s revenue × SEC revenue`}
                      </p>
                      <button type="button" onClick={() => openLink(l, `${n.name} · exposure`)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <FileText className="size-3" /> Source
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {summary.others.length > 0 && (
                <div data-section="Other stated figures">
                  <p className="mb-1.5 text-xs font-medium">Other stated figures, not added to exposure</p>
                  <p className="mb-2 text-[11px] text-muted-foreground">Amounts the sentences state that are not money for goods or services between the two companies.</p>
                  <ul className="space-y-1.5">
                    {summary.others.slice(0, 12).map(({ n, a }) => (
                      <li key={a.link.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                        <RelationMark relation={n.relation as Relation} size={8} />
                        <span className="min-w-0 flex-1 truncate">{n.name}</span>
                        <span className="num shrink-0 text-muted-foreground">{fmtCompactUsd(a.value)} {KIND_WORD[a.kind]}</span>
                        <button type="button" aria-label={`Source for ${n.name}, ${KIND_WORD[a.kind]}`} onClick={() => openLink(a.link, `${n.name} · ${KIND_WORD[a.kind]}`)} className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"><FileText className="size-3" />Source</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <WorldExposureMap ticker={ticker} name={focus.name} links={all as ProLink[]} signals={signals ?? []} revenue={revenue} selected={country} onSelect={setCountry} />
        <RegionShockPanel country={country} onCountry={setCountry} countries={countryList} links={all as ProLink[]} signals={signals ?? []} revenue={revenue} names={names} onPick={go} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <RegionRiskRegister ticker={ticker} name={focus.name} links={all as ProLink[]} signals={signals ?? []} revenue={revenue} selected={country} onCountry={setCountry} />
        <RegionDossierPanel ticker={ticker} name={focus.name} country={country} theme={COVERAGE.find((c) => c.ticker === ticker)?.industry} />
      </div>
      <div className="mt-4 grid grid-cols-1">
        <AgreementTermsPanel ticker={ticker} name={focus.name} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <EcosystemBasket ticker={ticker} name={focus.name} graph={graph} names={names} />
        <ConcentrationHistory ticker={ticker} name={focus.name} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SupplyNotePanel ticker={ticker} byId={byId} onOpen={(l) => openLink(l, `${l.counterparty} · ${l.relation}`)} />
        <DependencyCard ticker={ticker} all={all as ProLink[]} />
        <RegionPanel graph={graph} />
      </div>
      <div className="mt-4 grid grid-cols-1">
        <SupplyIntel ticker={ticker} />
      </div>
      <div className="mt-4 grid grid-cols-1">
        <CounterpartyEvidence ticker={ticker} />
      </div>
      <div className="mt-4 grid grid-cols-1">
        <FragilityTable tickers={[...covered]} all={all as ProLink[]} names={names} onPick={go} current={ticker} />
      </div>
    </div>
  );
}

function Stat({ label, value, hint, icon, loading }: { label: string; value: string; hint: string; icon?: React.ReactNode; loading?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </p>
      {/* A zero while the records are still loading reads as "no exposure", so show a placeholder until they arrive. */}
      {loading ? <Skeleton className="mt-1.5 h-5 w-16" /> : <p className="num mt-0.5 truncate text-lg font-semibold">{value}</p>}
      <p className="text-[10.5px] text-muted-foreground">{loading ? "Loading records…" : hint}</p>
    </div>
  );
}

function RiskBadges({ r }: { r?: ReturnType<typeof nodeRisk> }) {
  if (!r) return null;
  const b = [
    NATURE_WORD[r.nature] && `${NATURE_WORD[r.nature]}: not a flow`,
    r.singleSource && "Single source",
    r.dependency && "Stated dependency",
    r.concentrated && "Concentrated ≥10%",
    ...r.regions.map((x) => (r.hotspots.includes(x) ? `⚠ ${x}` : x)),
  ].filter(Boolean) as string[];
  if (!b.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {b.map((x) => (
        <span key={x} className={cn("rounded border px-1.5 py-0.5 text-[10.5px]", /Single|Concentrated|⚠/.test(x) ? "border-negative/40 text-negative" : "text-muted-foreground")}>
          {x}
        </span>
      ))}
    </div>
  );
}

function ImpactRow({ i, onOpen }: { i: ShockImpact; onOpen: () => void }) {
  return (
    <li className={cn("rounded-lg border p-2.5 text-sm", i.severity === "high" && "border-negative/40 bg-negative-soft")}>
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{i.name}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{i.hop === 1 ? "direct" : `${i.hop} steps`}</span>
      </div>
      <p className="mt-0.5 text-xs">
        <span className={cn(i.channel === "lost sales" ? "text-negative" : "text-foreground")}>{i.channel}</span>
        {i.revenuePct != null && <span className="num"> · {fmtPct(i.revenuePct, 2)} of revenue</span>}
        {i.dollars != null && <span className="num"> · ≈{fmtCompactUsd(i.dollars)}</span>}
        <span className="text-muted-foreground"> · {i.severity}</span>
      </p>
      <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{i.path.join(" → ")}</p>
      <button type="button" onClick={onOpen} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <FileText className="size-3" /> Source
      </button>
    </li>
  );
}
