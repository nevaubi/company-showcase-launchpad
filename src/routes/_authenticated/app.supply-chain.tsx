import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { CompanyPicker } from "@/components/supply/company-picker";
import { FollowPanel } from "@/components/supply/follow-panel";
import { OffscreenCue, type Cue } from "@/components/supply/off-screen-cue";
import { holdInPlace } from "@/components/supply/scroll-to";
import { SectionNav } from "@/components/supply/section-nav";
import { ExposureList, isSupplyTab, litImpactKeys, NameList, NodeEvidence, ShockPanel, SupplyAnalysis } from "@/components/supply/supply-analysis";
import { RELATION_ONE, type Overlay } from "@/components/supply/supply-map-meta";
import { SupplyNetwork } from "@/components/supply/supply-network";
import { allSignalsQuery, ConcentrationHistory, EcosystemBasket, FragilityTable, RegionShockPanel } from "@/components/supply/supply-plus";
import { DependencyCard, SupplyNotePanel } from "@/components/supply/supply-pro";
import { RegionDossierPanel, RegionRiskRegister } from "@/components/supply/supply-region";
import { SupplySignals } from "@/components/supply/supply-signals";
import { SupplyStats } from "@/components/supply/supply-stats";
import { ChangesTab, ReactionsTab } from "@/components/supply/supply-tabs";
import { IsolationStatus, MapToolbar, RelationFilters, type ShowChoice } from "@/components/supply/supply-toolbar";
import { ChainEvidence, ChainTable, ValueChain, type ChainSize } from "@/components/supply/value-chain";
import { COVERAGE } from "@/lib/coverage";
import { useUniverse } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { canonCountry, countryExposure } from "@/lib/supply/analytics";
import { buildChain, type ChainFlow, type TaggedShare } from "@/lib/supply/chain";
import { focusGraph, maxShare, nodeRisk, RELATIONS, secondOrder, simulateShock, type GraphNode, type ProLink, type Relation, type RiskLink } from "@/lib/supply/core";
import { exposureSummary } from "@/lib/supply/describe";
import { isolationParam, nextIsolation, parseIsolation, resolveIsolation, type IsolateContext } from "@/lib/supply/isolate";
import type { IsolateRequest } from "@/lib/supply/isolate-contract";
import { COMPANY_NAV, SUPPLY_SECTIONS, VIEW_NAV } from "@/lib/supply/page-nav";
import { supplyLinksQuery, taggedSharesQuery } from "@/lib/supply/query";
import { resolveSelection, selectionParam, SUPPLY_OVERLAYS, SUPPLY_VIEWS, supplySearch, type SupplySearch, type SupplyTab, type SupplyView } from "@/lib/supply/url-state";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";

const SupplyGlobe = lazy(() => import("@/components/supply/supply-globe"));

const isView = (v: unknown): v is SupplyView => typeof v === "string" && (SUPPLY_VIEWS as readonly string[]).includes(v);
const isOverlay = (v: unknown): v is Overlay => typeof v === "string" && (SUPPLY_OVERLAYS as readonly string[]).includes(v);
const isDepth = (v: unknown): v is number => v === 1 || v === 2;
const isFlow = (v: unknown): v is ChainFlow => v === "all" || v === "making" || v === "selling" || v === "tech";
const isSize = (v: unknown): v is ChainSize => v === "share" || v === "dollars";
/** Width of the map section from which the evidence panel sits beside the map; below it the panel goes under. The same number is in the grid's container query. */
const BESIDE = 1060;
/** Clear of the app header, the section links under it and a little air. */
const ANCHOR = "scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)]";

export const Route = createFileRoute("/_authenticated/app/supply-chain")({
  // view, selected name, overlay, depth, tab and what is isolated live in the address so a copied link reopens the same picture
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

function SupplyChainPage() {
  const search = Route.useSearch();
  const ticker = (search.t ?? "NVDA").toUpperCase();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: universe } = useUniverse();
  const linksQuery = useQuery(supplyLinksQuery);
  const { data: links, isLoading } = linksQuery;
  const [visible, setVisible] = useState<Set<Relation>>(new Set(RELATIONS));
  /* The address wins; without it the page falls back to what this session last chose. Every change the page makes to its
     own address goes through `patch` (view state: replaces the entry) or `go` (another company: a new entry), and neither
     moves the page (page-nav.ts). */
  const [savedDepth, setSavedDepth] = useSessionState<number>("fu:supply:depth", 1, isDepth);
  const [savedOverlay, setSavedOverlay] = useSessionState<Overlay>("fu:supply:overlay", "none", isOverlay);
  const [savedTab, setSavedTab] = useSessionState<SupplyTab>("fu:supply:tab", "evidence", isSupplyTab);
  const [savedView, setSavedView] = useSessionState<SupplyView>("fu:supply:view", "network", isView);
  const view: SupplyView = search.view ?? savedView;
  const overlay: Overlay = search.overlay ?? savedOverlay;
  const depth: 1 | 2 = (search.depth ?? savedDepth) === 2 ? 2 : 1;
  const tab: SupplyTab = search.tab ?? savedTab;
  const patch = useCallback((p: Partial<SupplySearch>) => navigate({ search: (prev: SupplySearch) => ({ ...prev, ...p }), ...VIEW_NAV }), [navigate]);
  const setView = (v: SupplyView) => { setSavedView(v); patch({ view: v === "network" ? undefined : v }); };
  const setOverlay = (o: Overlay) => { setSavedOverlay(o); patch({ overlay: o === "none" ? undefined : o }); };
  const setDepth = (d: 1 | 2) => { setSavedDepth(d); patch({ depth: d === 2 ? 2 : undefined }); };
  const setTab = (t: SupplyTab) => { setSavedTab(t); patch({ tab: t !== "evidence" ? t : undefined }); };
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
  const [chainFlow, setChainFlow] = useSessionState<ChainFlow>("fu:supply:chain-flow", "all", isFlow);
  const [chainSize, setChainSize] = useSessionState<ChainSize>("fu:supply:chain-size", "share", isSize);
  const [chainProduct, setChainProduct] = useState("");
  const product = useDeferredValue(chainProduct);
  const { data: tagged } = useQuery({ ...taggedSharesQuery, enabled: view === "chain" });
  const { open } = useSource();
  const { data: signals } = useQuery(allSignalsQuery);
  const [country, setCountry] = useState<string | null>(null);
  const [cue, setCue] = useState<Cue | null>(null);
  const dismissCue = useCallback(() => setCue(null), []);
  const today = new Date().toISOString().slice(0, 10);

  const names = useMemo(() => Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName])), []);
  const covered = useMemo(() => new Set(Object.keys(names)), [names]);
  const coveredList = useMemo(() => [...covered], [covered]);
  const revenue = useMemo(() => Object.fromEntries((universe?.companies ?? []).map((c) => [c.ticker, c.revenueTTM ?? undefined])), [universe]);
  const all = useMemo(() => (links ?? []) as RiskLink[], [links]);
  const graph = useMemo(() => focusGraph(ticker, all, names), [ticker, all, names]);
  // the unfiltered chain decides whether there is anything to draw; filters narrow what is drawn
  const fullChain = useMemo(() => (view === "chain" ? buildChain(ticker, all, tagged ?? [], names, revenue, { depth: chainDepth }) : null), [view, ticker, all, tagged, names, revenue, chainDepth]);
  const chain = useMemo(
    () => (fullChain && (chainFlow !== "all" || product.trim()) ? buildChain(ticker, all, tagged ?? [], names, revenue, { depth: chainDepth, flow: chainFlow, product }) : fullChain),
    [fullChain, chainFlow, product, ticker, all, tagged, names, revenue, chainDepth],
  );
  const hop2 = useMemo(() => (depth === 2 ? secondOrder(ticker, graph, all, names) : []), [depth, ticker, graph, all, names]);
  const nodes = useMemo(() => [...graph, ...hop2], [graph, hop2]);
  const risks = useMemo(() => Object.fromEntries(nodes.map((n) => [n.key, nodeRisk(n.links as RiskLink[], revenue)])), [nodes, revenue]);
  const focusName = names[ticker] ?? ticker;
  const focus: GraphNode = useMemo(() => ({ key: "focus", name: focusName, ticker, domain: null, relation: "focus", links: [] }), [focusName, ticker]);
  const byId = useMemo(() => new Map((all as ProLink[]).map((l) => [l.id, l])), [all]);
  const selected = useMemo(() => resolveSelection(nodes, search.sel), [nodes, search.sel]);
  const sel = nodes.find((n) => n.key === selected) ?? null;
  const counts = Object.fromEntries(RELATIONS.map((r) => [r, graph.filter((n) => n.relation === r).length])) as Record<Relation, number>;

  /* ---------- isolation: kept in the address, resolved against what the page shows, followed by every view and list ---------- */
  const isolation = useMemo(() => parseIsolation(search.iso), [search.iso]);
  const isoCtx: IsolateContext = useMemo(() => ({ focus: ticker, focusName, graph, hop2, chain }), [ticker, focusName, graph, hop2, chain]);
  const isolated = useMemo(() => resolveIsolation(isolation, isoCtx), [isolation, isoCtx]);
  const onIsolate = useCallback((request: IsolateRequest) => {
    const next = nextIsolation(isolation, request, isoCtx);
    /* a pathway picked in the chain is read in the evidence tab: open it with the same address change */
    const toEvidence = view === "chain" && request.kind === "path" && next != null;
    if (toEvidence) setSavedTab("evidence");
    patch({ iso: isolationParam(next), ...(toEvidence ? { tab: undefined } : {}) });
    const label = toEvidence ? resolveIsolation(next, isoCtx)?.label : null;
    if (label) setCue({ target: "supply-analysis", label: `Pathway: ${label}`, action: "Evidence", n: Date.now() });
  }, [isolation, isoCtx, patch, view, setSavedTab]);
  const clearIsolation = useCallback(() => patch({ iso: undefined }), [patch]);
  const isolating = search.iso != null;
  useEffect(() => {
    if (!isolating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      /* Escape belongs to an open menu, dialog or text field first */
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='listbox'], [role='menu'], [data-radix-popper-content-wrapper]")) return;
      clearIsolation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolating, clearIsolation]);
  const show: ShowChoice = isolation?.kind === "relation" && (isolation.relation === "supplier" || isolation.relation === "customer") ? isolation.relation : isolation ? "other" : "all";
  const onShow = (s: ShowChoice) => {
    if (s === "all") clearIsolation();
    else if (s !== "other" && s !== show) onIsolate({ kind: "relation", relation: s });
  };

  const countryList = useMemo(() => [...new Set([...(all as ProLink[]).flatMap((l) => (l.regions ?? []).map((r) => canonCountry(r)!)), ...(signals ?? []).map((x) => canonCountry(x.country)!)])].filter(Boolean), [all, signals]);
  const src = shockSrc ?? ticker;
  const impacts = useMemo(() => (tab === "shock" ? simulateShock(src, shock / 100, all, names, revenue) : []), [tab, src, shock, all, names, revenue]);
  const impactMap = useMemo(() => (tab === "shock" ? new Map(impacts.map((i) => [i.key, i])) : null), [tab, impacts]);

  /* Exposure counts each name once (its largest stated flow, or stated customer share × SEC revenue). Other stated figures
     (guarantees, investments, financing, commitments, settlements, balances) are listed apart and never added. */
  const summary = useMemo(() => {
    const vals = graph.map((n) => risks[n.key]).filter(Boolean);
    const { exposure, others, total } = exposureSummary(graph, revenue);
    const top = Math.max(0, ...graph.map(maxShare));
    return {
      single: vals.filter((r) => r.singleSource).length,
      dependency: vals.filter((r) => r.dependency).length,
      conc: vals.filter((r) => r.concentrated).length,
      topShare: top >= 10 ? top : null,
      hotspots: [...new Set(vals.flatMap((r) => r.hotspots))],
      exposure,
      others,
      total,
    };
  }, [risks, graph, revenue]);
  // What the globe tints: every country the company's links and signals tie it to.
  const exposureRows = useMemo(
    () => countryExposure((all as ProLink[]).filter((l) => l.ticker === ticker || l.counterparty_ticker === ticker), (signals ?? []).filter((x) => x.ticker === ticker), revenue)
      .filter((r) => r.country !== "United States" || r.links + r.facilities > 0),
    [all, signals, ticker, revenue],
  );
  /* The countries the region register lists: the ones the company's own filings and verified signals name. The first is the
     default for the dossier and the region shock, and the hotspots among them back the header when no link names one. */
  const ownCountries = useMemo(
    () => countryExposure((all as ProLink[]).filter((l) => l.ticker === ticker), (signals ?? []).filter((x) => x.ticker === ticker), revenue).filter((r) => r.country !== "United States" && r.country.length < 40),
    [all, signals, ticker, revenue],
  );
  const hotspotRegions = useMemo(() => (summary.hotspots.length ? summary.hotspots : ownCountries.filter((r) => r.hotspot && r.links + r.facilities + r.policy + r.risks > 0).map((r) => r.country)), [summary.hotspots, ownCountries]);
  const regionCountry = country ?? ownCountries[0]?.country ?? null;

  /* one address change per click: the selection and the tab it opens move together. Nothing scrolls: when the evidence is
     out of view (a phone, where it sits under the map) a cue offers to go there. */
  const pick = useCallback((k: string | null) => {
    const n = k ? nodes.find((x) => x.key === k) : null;
    setSavedTab("evidence");
    patch({ sel: n ? selectionParam(n) : undefined, tab: undefined });
    setCue(n ? { target: "supply-analysis", label: `${n.name}, ${RELATION_ONE[n.relation as Relation].toLowerCase()}`, action: "Evidence", n: Date.now() } : null);
  }, [nodes, patch, setSavedTab]);
  /* Another company: the view, depth and flags stay; the selection and the isolation belong to the old company and go.
     The page is not scrolled. The map above may get taller or shorter, so what the reader pressed is held where it is on
     screen, and when the map is out of view a cue offers to go there. */
  const pressed = useRef<Element | null>(null);
  /* what the reader last pressed, by pointer or by keyboard (Enter in a search field presses no button: nothing is held) */
  const press = (e: { target: EventTarget }) => { pressed.current = e.target instanceof Element ? e.target.closest("button, a, [role='option']") : null; };
  const endHold = useRef<() => void>(() => {});
  useEffect(() => () => endHold.current(), []);
  const go = useCallback((tk: string, keepCountry: string | null = null) => {
    endHold.current();
    endHold.current = holdInPlace(pressed.current);
    setShockSrc(null);
    setCountry(keepCountry);
    navigate({ search: { t: tk, view: view === "network" ? undefined : view, overlay: overlay === "none" ? undefined : overlay, depth: depth === 2 ? 2 : undefined, tab: tab === "evidence" ? undefined : tab }, ...COMPANY_NAV });
    setCue({ target: "supply-map", label: `Now mapping ${names[tk] ?? tk}`, action: "Map", n: Date.now() });
  }, [navigate, view, overlay, depth, tab, names]);
  const toggle = (r: Relation) =>
    setVisible((v) => {
      const n = new Set(v);
      if (n.has(r)) n.delete(r); else n.add(r);
      return n;
    });
  const openLink = useCallback((l: RiskLink, label: string) =>
    open({ ticker: l.ticker, label, unit: "usd", value: 0, doc: { accn: l.accn, doc: l.doc, form: l.form, filed: l.filed, title: `${l.ticker} ${l.form}`, search: l.quote } }), [open]);
  const openTag = useCallback((f: TaggedShare) =>
    open({ ticker: f.ticker, label: `${names[f.ticker] ?? f.ticker}: ${f.label} as a ${f.kind}`, periodLabel: fmtDate(f.period_end), unit: "pct", value: f.pct, src: { accn: f.accn, concept: "us-gaap:ConcentrationRiskPercentage1", end: f.period_end, value: f.pct }, elementId: f.element_id ?? undefined }), [open, names]);

  const companies = useMemo(() => (universe?.companies ?? []).map((c) => ({ ticker: c.ticker, name: names[c.ticker] ?? c.name })), [universe, names]);
  const linkCounts = useMemo(() => {
    const n: Record<string, number> = {};
    for (const l of all) {
      n[l.ticker] = (n[l.ticker] ?? 0) + 1;
      if (l.counterparty_ticker && l.counterparty_ticker !== l.ticker) n[l.counterparty_ticker] = (n[l.counterparty_ticker] ?? 0) + 1;
    }
    return n;
  }, [all]);
  const statements = useMemo(() => graph.flatMap((n) => n.links), [graph]);
  const failed = linksQuery.isError && !links;
  const drawn = view === "chain" ? (fullChain?.nodes.length ?? 0) > 1 : graph.length > 0;
  /* while the shock tab is open the Network draws it: said in the canvas header, where it costs no height */
  const shockNote = tab === "shock" && view === "network" ? `Shock on ${names[src] ?? src}: dashed cards are not reached` : null;
  const status = (
    <IsolationStatus label={isolated?.label ?? null} onClear={clearIsolation}
      hint={shockNote ?? (view === "globe" ? "Click a marker to read its filing sentences" : "Click a card to read its filing sentences")} />
  );
  const lit = isolated ? graph.filter((n) => isolated.lit.has(n.key) || isolated.relation === n.relation) : graph;

  return (
    <div onClickCapture={press} onKeyDownCapture={(e) => { if (e.key === "Enter" || e.key === " ") press(e); }}>
      <PageHeader
        eyebrow="Filings and data"
        title="Supply chain map"
        description="Customers, suppliers, partners and competitors as each company's latest 10-K and 10-Q name them. A figure, flag or region appears only when its sentence states it, and every link opens that sentence."
        actions={<CompanyPicker ticker={ticker} name={focusName} companies={companies} links={linkCounts} onPick={(tk) => go(tk)} />}
      />
      <SectionNav sections={SUPPLY_SECTIONS} />
      <SupplyStats
        loading={isLoading}
        names={graph.length}
        statements={statements.length}
        exposureTotal={summary.total}
        exposureNames={summary.exposure.length}
        otherFigures={summary.others.length}
        concentrated={summary.conc}
        topShare={summary.topShare}
        single={summary.single}
        dependency={summary.dependency}
        hotspots={hotspotRegions}
        hotspotsFromLinks={summary.hotspots.length > 0}
        filed={statements.map((l) => l.filed)}
        today={today}
      />

      <section id="supply-map" data-section="Supply map" aria-label="Map" className={cn("@container", ANCHOR)}>
        <div className="mb-2">
          <MapToolbar view={view} onView={setView} show={show} onShow={onShow} depth={depth} onDepth={setDepth} overlay={overlay} onOverlay={setOverlay}
            chainDepth={chainDepth} onChainDepth={setChainDepth} chainSize={chainSize} onChainSize={setChainSize} />
        </div>
        {/* Beside each other once the section is wide enough for the map to keep its columns (the sidebar and a docked
            assistant change the room, so this follows the section's width, not the window's). Everything a click changes
            sits beside or below the control that was pressed, never above it. */}
        <div className="grid grid-cols-1 items-start gap-4 @[1060px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <div className={cn("min-w-0 border-y bg-card/40", (isLoading || failed || !drawn) && "h-[560px]")}>
              {failed ? (
                <div role="alert" className="grid h-full place-content-center gap-3 p-6 text-center text-sm text-muted-foreground">Supply-chain records are temporarily unavailable.<Button variant="outline" size="sm" className="mx-auto" onClick={() => linksQuery.refetch()}>Retry</Button></div>
              ) : isLoading ? (
                <Skeleton className="h-full w-full rounded-none" />
              ) : !drawn ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                  <Network className="size-6" aria-hidden="true" />
                  {view === "chain" ? `No filing names a supplier or customer of ${focusName} yet, so there is no chain to draw.` : `No named customers or suppliers found in ${focusName}'s latest 10-K yet.`}
                </div>
              ) : view === "chain" && chain ? (
                <ValueChain chain={chain} flow={chainFlow} onFlow={setChainFlow} product={chainProduct} onProduct={setChainProduct} size={chainSize}
                  isolated={isolated} onIsolate={onIsolate} onOpenText={openLink} onOpenTag={openTag} />
              ) : (
                <>
                  {/* one line that never wraps on a wide screen, so what is isolated can change without moving the map */}
                  <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 border-b px-3.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)]">
                    <RelationFilters counts={counts} visible={visible} onToggle={toggle} loading={isLoading} />
                    <div className="flex h-7 min-w-0 items-center sm:justify-end">{status}</div>
                  </div>
                  {view === "globe" ? (
                    <ClientOnly fallback={<Skeleton className="h-[560px] w-full rounded-none" />}>
                      <Suspense fallback={<Skeleton className="h-[560px] w-full rounded-none" />}>
                        <SupplyGlobe focus={focus} graph={graph} hop2={hop2} visible={visible} selected={selected} onSelect={pick} overlay={overlay} risks={risks} impacts={impactMap}
                          rows={exposureRows} country={country} onCountry={setCountry} isolate={isolated?.lit ?? null} isolateLabel={isolated?.label ?? null} onIsolate={onIsolate} />
                      </Suspense>
                    </ClientOnly>
                  ) : (
                    <SupplyNetwork focus={focus} graph={graph} hop2={hop2} visible={visible} selected={selected} onSelect={pick} overlay={overlay} risks={risks} impacts={impactMap}
                      isolate={isolated?.lit ?? null} isolateLabel={isolated?.label ?? null} onIsolate={onIsolate} isolatedKey={isolated?.node ?? null} isolatedRelation={isolated?.relation ?? null} />
                  )}
                </>
              )}
            </div>
            {view === "chain" && chain && chain.edges.length > 0 && !isLoading && !failed && (
              <ChainTable chain={chain} names={names} revenue={revenue} isolated={isolated} onIsolate={onIsolate} onOpenText={openLink} onOpenTag={openTag} />
            )}
          </div>

          <FollowPanel id="supply-analysis" minWidth={BESIDE} resetKey={`${ticker}|${view}|${tab}|${search.sel ?? ""}|${search.iso ?? ""}`}>
          <SupplyAnalysis
            tab={tab}
            onTab={setTab}
            evidence={
              view === "chain" && chain ? (
                <ChainEvidence chain={chain} isolated={isolated} names={names} onFocus={(tk) => go(tk)} onOpenText={openLink} onOpenTag={openTag} />
              ) : sel ? (
                <NodeEvidence sel={sel} focusName={focusName} risk={risks[sel.key]} names={names} covered={covered} all={all} today={today}
                  isolated={isolated?.node === sel.key} onIsolate={onIsolate} onOpen={openLink} onGo={(tk) => go(tk)} onShock={(tk) => { setShockSrc(tk); setTab("shock"); }} />
              ) : (
                <NameList nodes={nodes} risks={risks} isolated={isolated} onPick={pick} onClear={clearIsolation} />
              )
            }
            exposure={<ExposureList focusName={focusName} exposure={summary.exposure} others={summary.others} names={names} isolated={isolated} onOpen={openLink} />}
            shock={
              <ShockPanel src={src} sources={[...new Set([ticker, ...graph.flatMap((n) => (n.ticker ? [n.ticker] : []))])]} names={names} shock={shock} onShock={setShock} onSrc={setShockSrc}
                impacts={impacts} lit={litImpactKeys(isolated, nodes)} isolatedLabel={isolated?.label ?? null} onOpen={openLink} />
            }
            changes={<ChangesTab ticker={ticker} name={focusName} isolated={isolated} onOpen={(l, label) => openLink(l as RiskLink, label)} />}
            reactions={<ReactionsTab ticker={ticker} name={focusName} graph={lit} covered={covered} onSelect={pick} />}
          />
          </FollowPanel>
        </div>
      </section>

      <section id="supply-summary" data-section="Summary" aria-label="Summary" className={cn("mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]", ANCHOR)}>
        <SupplyNotePanel ticker={ticker} byId={byId} onOpen={(l) => openLink(l, `${l.counterparty} · ${l.relation}`)} />
        <DependencyCard ticker={ticker} all={all as ProLink[]} />
        <ConcentrationHistory ticker={ticker} name={focusName} />
      </section>

      <section id="supply-regions" data-section="Regions" aria-label="Regions" className={cn("mt-5 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]", ANCHOR)}>
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <RegionRiskRegister ticker={ticker} name={focusName} links={all as ProLink[]} signals={signals ?? []} revenue={revenue} selected={regionCountry} onCountry={setCountry} />
          <RegionShockPanel country={regionCountry ?? "Taiwan"} onCountry={setCountry} countries={countryList} links={all as ProLink[]} signals={signals ?? []} revenue={revenue} names={names} onPick={(tk) => go(tk, regionCountry ?? "Taiwan")} current={ticker} />
        </div>
        {regionCountry && <RegionDossierPanel ticker={ticker} name={focusName} country={regionCountry} theme={COVERAGE.find((c) => c.ticker === ticker)?.industry} />}
      </section>

      <section id="supply-signals" data-section="Contracts and calls" aria-label="Contracts and calls" className={cn("mt-5", ANCHOR)}>
        <SupplySignals ticker={ticker} name={focusName} />
      </section>

      <section id="supply-market" data-section="Market" aria-label="Market" className={cn("mt-5", ANCHOR)}>
        <EcosystemBasket ticker={ticker} name={focusName} graph={graph} />
      </section>

      <section id="supply-coverage" data-section="Coverage" aria-label="Coverage" className={cn("mt-5", ANCHOR)}>
        <FragilityTable tickers={coveredList} all={all as ProLink[]} names={names} onPick={(tk) => go(tk)} current={ticker} />
      </section>

      <OffscreenCue cue={cue} onDone={dismissCue} />
    </div>
  );
}
