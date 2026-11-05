import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowRight, FileText, Globe2, Lock, Network, Zap } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, RELATION_COLOR, RELATION_LABEL } from "@/components/supply/supply-map-meta";
import type { Overlay } from "@/components/supply/supply-map";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSource } from "@/components/source/source-context";
import { supplyLinksQuery } from "@/lib/supply/query";
import { ChangesTab, ReactionsTab } from "@/components/supply/supply-tabs";
import { ConfidenceBadge, DependencyCard, FragilityRanking, RegionPanel, SupplyFlow, SupplyNotePanel } from "@/components/supply/supply-pro";
import { confidence, mirrors, type ProLink } from "@/lib/supply/core";
import { useUniverse } from "@/lib/data";
import { COVERAGE } from "@/lib/coverage";
import { focusGraph, linkDollars, nodeRisk, RELATIONS, secondOrder, simulateShock, type GraphNode, type Relation, type RiskLink, type ShockImpact } from "@/lib/supply/core";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const SupplyMap = lazy(() => import("@/components/supply/supply-map"));

export const Route = createFileRoute("/_authenticated/app/supply-chain")({
  validateSearch: z.object({ t: z.string().max(10).optional() }),
  head: () => ({
    meta: [
      { title: "Supply chain map — Filed Under" },
      { name: "description", content: "Interactive map of named customers, suppliers, partners and competitors with dollar exposure, risk flags and a shock simulator, every link quoted from a 10-K." },
      { property: "og:title", content: "Supply chain map — Filed Under" },
      { property: "og:description", content: "Customers, suppliers, partners and competitors with dollar exposure and shock simulation, every link quoted from the 10-K." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplyChainPage,
});

const OVERLAYS: { v: Overlay; label: string }[] = [
  { v: "none", label: "No overlay" },
  { v: "single", label: "Single-source dependencies" },
  { v: "concentration", label: "Concentration ≥10%" },
  { v: "geo", label: "Geopolitical hotspots" },
  { v: "dollars", label: "Disclosed $ exposure" },
];

function SupplyChainPage() {
  const { t } = Route.useSearch();
  const ticker = (t ?? "NVDA").toUpperCase();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: universe } = useUniverse();
  const { data: links, isLoading } = useQuery(supplyLinksQuery);
  const [visible, setVisible] = useState<Set<Relation>>(new Set(RELATIONS));
  const [selected, setSelected] = useState<string | null>(null);
  const [depth, setDepth] = useState<1 | 2>(1);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [tab, setTab] = useState("evidence");
  const [shockSrc, setShockSrc] = useState<string | null>(null);
  const [shock, setShock] = useState(20);
  const [view, setView] = useState<"network" | "flow">("network");
  const { open } = useSource();

  const names = useMemo(() => Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName])), []);
  const covered = useMemo(() => new Set(Object.keys(names)), [names]);
  const revenue = useMemo(() => Object.fromEntries((universe?.companies ?? []).map((c) => [c.ticker, c.revenueTTM ?? undefined])), [universe]);
  const all = links ?? [];
  const graph = useMemo(() => focusGraph(ticker, all, names), [ticker, all, names]);
  const hop2 = useMemo(() => (depth === 2 ? secondOrder(ticker, graph, all, names) : []), [depth, ticker, graph, all, names]);
  const risks = useMemo(() => Object.fromEntries([...graph, ...hop2].map((n) => [n.key, nodeRisk(n.links as RiskLink[], revenue)])), [graph, hop2, revenue]);
  const focus: GraphNode = { key: "focus", name: names[ticker] ?? ticker, ticker, domain: null, relation: "focus", links: [] };
  const byId = useMemo(() => new Map((all as ProLink[]).map((l) => [l.id, l])), [all]);
  const sel = [...graph, ...hop2].find((n) => n.key === selected) ?? null;
  const counts = Object.fromEntries(RELATIONS.map((r) => [r, graph.filter((n) => n.relation === r).length])) as Record<Relation, number>;

  const src = shockSrc ?? ticker;
  const impacts = useMemo(() => (tab === "shock" ? simulateShock(src, shock / 100, all, names, revenue) : []), [tab, src, shock, all, names, revenue]);
  const impactMap = useMemo(() => (tab === "shock" ? new Map(impacts.map((i) => [i.key, i])) : null), [tab, impacts]);

  const summary = useMemo(() => {
    const vals = Object.values(risks);
    const exposure = graph
      .flatMap((n) => n.links.map((l) => ({ n, l: l as RiskLink, d: linkDollars(l as RiskLink, revenue) })))
      .filter((x) => x.d != null)
      .sort((a, b) => b.d! - a.d!);
    return {
      single: vals.filter((r) => r.singleSource).length,
      conc: vals.filter((r) => r.concentrated).length,
      hotspots: [...new Set(vals.flatMap((r) => r.hotspots))],
      exposure,
    };
  }, [risks, graph, revenue]);

  const go = (tk: string) => {
    setSelected(null);
    setShockSrc(null);
    navigate({ search: { t: tk } });
  };
  const toggle = (r: Relation) =>
    setVisible((v) => {
      const n = new Set(v);
      n.has(r) ? n.delete(r) : n.add(r);
      return n;
    });
  const openLink = (l: RiskLink, label: string) =>
    open({ ticker: l.ticker, label, unit: "usd", value: 0, doc: { accn: l.accn, doc: l.doc, form: l.form, filed: l.filed, title: `${l.ticker} ${l.form}`, search: l.quote } });

  return (
    <div>
      <PageHeader
        eyebrow="Markets"
        title="Supply chain map"
        description="Who each company sells to, buys from, works with and competes against, as named in its latest 10-K and 10-Q — with disclosed dollar exposure, risk flags, year-over-year changes, earnings sympathy moves and a shock simulator. Every link opens the sentence it comes from."
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

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Disclosed $ exposure" value={summary.exposure.length ? fmtCompactUsd(summary.exposure.reduce((s, x) => s + x.d!, 0)) : "—"} hint={`${summary.exposure.length} quantified links`} />
        <Stat label="Concentrated (≥10%)" value={String(summary.conc)} hint="counterparties" />
        <Stat label="Single-source" value={String(summary.single)} hint="stated dependencies" icon={<Lock className="size-3.5" />} />
        <Stat label="Hotspot regions" value={summary.hotspots.length ? summary.hotspots.slice(0, 3).join(", ") : "None stated"} hint="tied to links in the filing" icon={<Globe2 className="size-3.5" />} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {RELATIONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => toggle(r)}
            className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-opacity", !visible.has(r) && "opacity-40")}
          >
            <span className="size-2.5 rounded-full" style={{ background: RELATION_COLOR[r] }} />
            {RELATION_LABEL[r]} <span className="num text-muted-foreground">{counts[r]}</span>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {(["network", "flow"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded px-2.5 py-1", view === v ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
                {v === "network" ? "Network" : "Flow"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {([1, 2] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDepth(d)} className={cn("rounded px-2.5 py-1", depth === d ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
                {d === 1 ? "Direct" : "+ 2nd order"}
              </button>
            ))}
          </div>
          <Select value={overlay} onValueChange={(v) => setOverlay(v as Overlay)}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
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
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative h-[640px] min-w-0 overflow-hidden rounded-xl border bg-card">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : graph.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Network className="size-6" />
              No named customers or suppliers found in {focus.name}'s latest 10-K yet.
            </div>
          ) : view === "flow" ? (
            <SupplyFlow focusName={focus.name} graph={graph} revenue={revenue} selected={selected} onSelect={(k) => { setSelected(k); setTab("evidence"); }} />
          ) : (
            <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <SupplyMap focus={focus} graph={graph} hop2={hop2} visible={visible} selected={selected} onSelect={(k) => { setSelected(k); setTab("evidence"); }} overlay={overlay} risks={risks} impacts={impactMap} />
              </Suspense>
            </ClientOnly>
          )}
          <p className="pointer-events-none absolute bottom-2 left-14 text-[10.5px] text-muted-foreground">Line thickness = stated share of revenue or purchases · dashed = second-order link</p>
        </div>

        <Panel title="Analysis" className="min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-3 grid w-full grid-cols-5">
              <TabsTrigger value="evidence" className="px-1 text-xs">Evidence</TabsTrigger>
              <TabsTrigger value="reactions" className="px-1 text-xs">Moves</TabsTrigger>
              <TabsTrigger value="changes" className="px-1 text-xs">Changes</TabsTrigger>
              <TabsTrigger value="shock" className="px-1 text-xs">Shock</TabsTrigger>
              <TabsTrigger value="exposure" className="px-1 text-xs">Exposure</TabsTrigger>
            </TabsList>
            <TabsContent value="reactions">
              {tab === "reactions" && <ReactionsTab ticker={ticker} name={focus.name} graph={graph} covered={covered} onSelect={(k) => { setSelected(k); setTab("evidence"); }} />}
            </TabsContent>
            <TabsContent value="changes">
              {tab === "changes" && <ChangesTab ticker={ticker} name={focus.name} onOpen={(l, label) => openLink(l as RiskLink, label)} />}
            </TabsContent>

            <TabsContent value="evidence">
              {sel ? (
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
                  <RiskBadges r={risks[sel.key]} />
                  {(sel.links as RiskLink[]).map((l) => (
                    <div key={l.id} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs font-medium text-muted-foreground">
                        From {names[l.ticker] ?? l.ticker}'s {l.form}, filed {fmtDate(l.filed)}
                        {l.share_pct != null && <span className="ml-1 text-foreground">· {l.share_pct}%</span>}
                        {linkDollars(l, revenue) != null && <span className="ml-1 text-foreground">· {fmtCompactUsd(linkDollars(l, revenue))}</span>}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <ConfidenceBadge c={confidence(l as ProLink, all)} />
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
                      <button type="button" onClick={() => openLink(l, `${sel.name} · ${l.relation}`)} className="mt-2 inline-flex items-center gap-1 rounded bg-highlight-soft px-2 py-1 text-xs font-medium text-highlight-foreground hover:bg-highlight">
                        <FileText className="size-3" /> Open in {l.form}
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-3">
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
                      <button type="button" onClick={() => setSelected(n.key)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: RELATION_COLOR[n.relation] }} />
                        <span className="truncate">{n.name}</span>
                        {risks[n.key]?.singleSource && <Lock className="size-3 text-negative" />}
                        <span className="ml-auto text-xs text-muted-foreground">{n.relation}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="shock" className="space-y-3">
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
                <ul className="max-h-[400px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {impacts.slice(0, 30).map((i) => (
                    <ImpactRow key={i.key} i={i} onOpen={() => openLink(i.link, `${i.name} · ${i.channel}`)} />
                  ))}
                </ul>
              )}
              <p className="text-[10.5px] text-muted-foreground">Mechanical estimate from disclosed shares only; not a forecast.</p>
            </TabsContent>

            <TabsContent value="exposure">
              {summary.exposure.length === 0 ? (
                <p className="text-sm text-muted-foreground">{focus.name}'s filings don't put a percentage or dollar figure on any named counterparty.</p>
              ) : (
                <ul className="space-y-2">
                  {summary.exposure.slice(0, 20).map(({ n, l, d }) => (
                    <li key={l.id} className="rounded-lg border p-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: RELATION_COLOR[n.relation] }} />
                        <span className="truncate font-medium">{n.name}</span>
                        <span className="num ml-auto font-semibold">{fmtCompactUsd(d)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {n.relation}
                        {l.share_pct != null && ` · ${l.share_pct}% of ${names[l.ticker] ?? l.ticker}'s ${l.relation === "customer" ? "revenue" : "purchases"}`}
                      </p>
                      <button type="button" onClick={() => openLink(l, `${n.name} · exposure`)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <FileText className="size-3" /> Source
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SupplyNotePanel ticker={ticker} byId={byId} onOpen={(l) => openLink(l, `${l.counterparty} · ${l.relation}`)} />
        <DependencyCard ticker={ticker} all={all as ProLink[]} />
        <RegionPanel graph={graph} />
      </div>
      <div className="mt-4 grid grid-cols-1">
        <FragilityRanking tickers={[...covered]} all={all as ProLink[]} names={names} onPick={go} current={ticker} />
      </div>
    </div>
  );
}

function Stat({ label, value, hint, icon }: { label: string; value: string; hint: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="num mt-0.5 truncate text-lg font-semibold">{value}</p>
      <p className="text-[10.5px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function RiskBadges({ r }: { r?: ReturnType<typeof nodeRisk> }) {
  if (!r) return null;
  const b = [
    r.singleSource && "Single source",
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
