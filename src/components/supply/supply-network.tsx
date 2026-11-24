// Network view of the supply-chain page: suppliers flow in from the left, the company sits in the middle,
// customers flow out to the right; partners and competitors sit in a row underneath.
// Band width is the stated dollars (or the stated share when no dollars are given), so the picture doubles
// as the flow view. Every name is one fixed card (logo, name, ticker, what it supplies or buys, the stated figure
// and its flags), so a column reads like a table. A card opens the filing sentences behind it through `onSelect`;
// its isolate button keeps that name lit and dims the rest through `onIsolate`.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, Focus, Globe2, Link2, Lock } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, impactOf, overlayHit, RELATION_COLOR, RELATION_DASH, RELATION_LABEL, RELATION_ORDER, type Overlay } from "./supply-map-meta";
import { figure, LineSample, NodeHoverCard, RelationMark } from "./supply-marks";
import type { GraphNode, HopNode, NodeRisk, Relation, ShockImpact } from "@/lib/supply/core";
import type { IsolateProps } from "@/lib/supply/isolate-contract";
import { groupTotals, NATURE_WORD, nodeFacts, type GroupTotals, type NodeFacts } from "@/lib/supply/describe";
import { layoutNetwork, NET, type Basis, type NetCard } from "@/lib/supply/network-layout";
import { fmtCompactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const COMPACT_BELOW = 620;
const TIP_W = 288;
const BASIS_TEXT: Record<Basis, string> = { dollars: "stated revenue, purchases or contract value (or stated share × revenue)", share: "the stated share", none: "nothing: no flows stated, bands are equal" };
const SINGULAR: Record<Relation, string> = { supplier: "supplier", customer: "customer", partner: "partner", competitor: "competitor" };
const SEVERITY: Record<ShockImpact["severity"], string> = { high: "High impact", medium: "Medium impact", low: "Low impact" };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const parentOf = (c: NetCard): string | null => (c.hop === 2 ? (c.node as HopNode).parent : null);

export interface SupplyNetworkProps extends IsolateProps {
  focus: GraphNode;
  graph: GraphNode[];
  hop2: HopNode[];
  visible: Set<Relation>;
  selected: string | null;
  onSelect: (key: string) => void;
  overlay: Overlay;
  risks: Record<string, NodeRisk>;
  impacts: Map<string, ShockImpact> | null;
  /** key of the one name that is isolated, so its isolate button shows as pressed */
  isolatedKey?: string | null;
  /** the relation that is isolated ("suppliers only"), so its group's isolate button shows as pressed */
  isolatedRelation?: Relation | null;
}

interface CardProps {
  c: NetCard;
  facts: NodeFacts;
  risk: NodeRisk | undefined;
  impact: ShockImpact | undefined;
  /** shock view is on and this name is not reached */
  outside: boolean;
  picked: boolean;
  flagged: boolean;
  /** second-row card (partner, competitor): narrower, so the figure sits on the second line */
  stacked: boolean;
  /** an isolation is on and this name is outside it */
  dim: boolean;
  /** this name is what is isolated */
  isolated: boolean;
  index: number;
  /** placed by the layout (wide view) rather than in the phone list */
  placed: boolean;
  style?: CSSProperties;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
  onIsolate?: (key: string) => void;
}

/** One counterparty. Memoised: hovering a card re-renders only the cards whose state changed. */
const Card = memo(function Card({ c, facts, risk, impact, outside, picked, flagged, stacked, dim, isolated, index, placed, style, onSelect, onHover, onIsolate }: CardProps) {
  const n = c.node, fig = figure(facts), nature = NATURE_WORD[facts.nature], child = c.hop === 2;
  const spoken = [n.name, `${SINGULAR[c.relation]}${child ? " of a direct link, second order" : ""}`, nature && nature.toLowerCase(), fig && `${fig.value} ${fig.unit}${fig.flow ? "" : ", not a flow"}`, facts.product && `product: ${facts.product}`,
    risk?.singleSource && "single source", facts.dependency && "stated dependency", risk?.hotspots.length ? `exposed to ${risk.hotspots.join(", ")}` : "", flagged && "flagged by the overlay",
    impact ? `shock: ${SEVERITY[impact.severity].toLowerCase()}` : outside ? "not reached by the shock" : "", dim && "outside what is isolated"].filter(Boolean).join(", ");
  const flags = (
    <>
      {risk?.singleSource && <Lock aria-hidden="true" className="size-3 shrink-0 text-negative" />}
      {facts.dependency && <Link2 aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />}
      {(risk?.hotspots.length ?? 0) > 0 && <Globe2 aria-hidden="true" className="size-3 shrink-0 text-warning" />}
      {impact && <AlertTriangle aria-hidden="true" className="size-3 shrink-0 text-negative" />}
    </>
  );
  const what = impact ? SEVERITY[impact.severity] : nature ? `${nature}${facts.summary ? ` · ${facts.summary}` : ""}` : facts.summary ?? `${facts.statements} filing statement${facts.statements === 1 ? "" : "s"}`;
  return (
    <div style={style} data-card="" data-dim={dim || undefined}
      className={cn("group/card transition-opacity duration-150 motion-reduce:transition-none", placed ? "absolute" : "relative w-full", dim && "opacity-45 hover:opacity-100 focus-within:opacity-100")}>
      <button
        type="button"
        data-rel={child ? undefined : c.relation}
        data-idx={child ? undefined : index}
        data-key={c.key}
        aria-pressed={picked}
        aria-label={`${spoken}. Open the filing evidence.`}
        title={n.name}
        onClick={() => onSelect(c.key)}
        onMouseEnter={() => onHover(c.key)} onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(c.key)} onBlur={() => onHover(null)}
        className={cn(
          "flex h-full w-full min-w-0 items-center rounded-md border text-left transition-[box-shadow,border-color,background-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card motion-reduce:transition-none",
          child ? "gap-1.5 pl-1.5" : "gap-2 pl-2",
          onIsolate ? "pr-8" : "pr-2",
          outside ? "border-dashed bg-transparent text-muted-foreground" : "bg-card shadow-paper hover:border-foreground/35 hover:shadow-lift",
          child && !outside && "border-dashed",
          picked && "border-foreground bg-accent shadow-lift ring-1 ring-foreground",
          flagged && !picked && "border-negative ring-1 ring-negative",
          impact?.severity === "high" && !picked && "bg-negative-soft",
        )}
      >
        <span className={cn("shrink-0", outside && "opacity-60")}>
          <CompanyLogo ticker={n.ticker ?? n.name.slice(0, 4).toUpperCase()} src={externalLogo(n.domain, n.ticker)} size={child ? "xs" : "sm"} decorative />
        </span>
        {child ? (
          <>
            <span className={cn("min-w-0 flex-1 truncate text-xs", picked ? "font-semibold" : "font-medium")}>{n.name}</span>
            {flags}
            {/* the figure always carries its kind, so a bare dollar amount never reads as a flow */}
            {fig ? <span className="shrink-0 text-[11px]"><span className={cn("num", fig.flow ? "font-medium" : "text-muted-foreground")}>{fig.value}</span><span className="ml-1 text-muted-foreground">{fig.unit}</span></span>
              : n.ticker && <span className="num shrink-0 text-[11px] text-muted-foreground">{n.ticker}</span>}
          </>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-[18px]", picked ? "font-semibold" : "font-medium")}>{n.name}</span>
              {/* in the flow columns the figure sits at the right of the name, so a column of cards reads like a column of numbers */}
              {!stacked && fig && <span className={cn("num shrink-0 text-[13px] leading-[18px]", fig.flow ? "font-medium" : "text-muted-foreground")}>{fig.value}</span>}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
              {/* in the narrower second row the figure moves under the name, so the name keeps the whole width */}
              {stacked && fig && <span className="shrink-0"><span className={cn("num", fig.flow ? "font-medium text-foreground" : "text-foreground/80")}>{fig.value}</span> {fig.unit}</span>}
              <span className="min-w-0 flex-1 truncate">{n.ticker && <span className="num text-foreground/80">{n.ticker} · </span>}{what}</span>
              {!stacked && fig && <span className="shrink-0">{fig.unit}</span>}
              {flags}
            </span>
          </span>
        )}
      </button>
      {onIsolate && (
        <button type="button" aria-pressed={isolated} aria-label={isolated ? `Stop isolating ${n.name}` : `Isolate ${n.name}`} title={isolated ? "Show everything again" : "Isolate: keep this name lit and dim the rest"}
          onClick={() => onIsolate(c.key)}
          className={cn(
            "absolute right-0.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-[opacity,color,background-color] duration-150 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
            isolated ? "text-foreground opacity-100" : picked ? "opacity-100" : "pointer-events-none opacity-0 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100",
          )}>
          <Focus className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

const money = (v: number) => fmtCompactUsd(v);
/** What a group states in total, in one line under its name. */
function totalsLine(t: GroupTotals): string {
  const parts = [t.flows != null && `${money(t.flows)} stated`, t.maxShare != null && `up to ${t.maxShare}% share`, t.quantified > 0 && `${t.quantified} of ${t.names} quantified`].filter(Boolean) as string[];
  if (parts.length) return parts.join(" · ");
  return t.others > 0 ? `no flows stated · ${t.others} other figure${t.others === 1 ? "" : "s"}` : "no figures stated";
}

export function SupplyNetwork({ focus, graph, hop2, visible, selected, onSelect, overlay, risks, impacts, isolate, isolateLabel, onIsolate, isolatedKey, isolatedRelation }: SupplyNetworkProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const compact = width > 0 && width < COMPACT_BELOW;
  /* every name is drawn: nothing sits behind a "show more" */
  const layout = useMemo(() => layoutNetwork({ graph, hop2, visible, risks, width: Math.max(width, COMPACT_BELOW), limit: null }), [graph, hop2, visible, risks, width]);
  const cardByKey = useMemo(() => new Map(layout.cards.map((c) => [c.key, c])), [layout]);
  const facts = useMemo(() => new Map(layout.cards.map((c) => [c.key, nodeFacts(c.node, risks[c.key])])), [layout, risks]);
  const byRelation = useMemo(() => Object.fromEntries(RELATION_ORDER.map((r) => [r, graph.filter((n) => n.relation === r)])) as Record<Relation, GraphNode[]>, [graph]);
  const totals = useMemo(() => Object.fromEntries(RELATION_ORDER.map((r) => [r, groupTotals(byRelation[r])])) as Record<Relation, GroupTotals>, [byRelation]);

  /* a hover that points at a card no longer drawn is dropped */
  const focusKey = focus.ticker ?? focus.name;
  useEffect(() => { setHover(null); }, [focusKey]);
  useEffect(() => { setHover((h) => (h && !cardByKey.has(h) ? null : h)); }, [cardByKey]);

  const active = hover ?? selected;
  const outside = (n: GraphNode | HopNode) => impacts != null && !impactOf(impacts, n);
  const dimmed = (key: string) => isolate != null && !isolate.has(key);
  const isolateNode = useMemo(() => (onIsolate ? (key: string) => onIsolate({ kind: "node", key }) : undefined), [onIsolate]);

  const card = (c: NetCard, index: number, flow: boolean) => {
    const risk = risks[c.key];
    return (
      <Card key={c.key} c={c} facts={facts.get(c.key)!} risk={risk} impact={impactOf(impacts, c.node)} outside={outside(c.node)} picked={selected === c.key}
        flagged={overlayHit(overlay, risk)} stacked={flow && (c.relation === "partner" || c.relation === "competitor")} dim={dimmed(c.key)} isolated={isolatedKey === c.key} index={index} placed={flow} onSelect={onSelect} onHover={setHover} onIsolate={isolateNode}
        style={flow ? { left: c.x, top: c.y, width: c.w, height: c.h } : { height: c.h }} />
    );
  };

  const focusCard = (style?: CSSProperties) => (
    <div style={style} data-focus-card="" className={cn("flex flex-col items-center justify-center gap-0.5 rounded-md border-2 border-foreground bg-card px-3 text-center shadow-lift", style ? "absolute" : "py-3")}>
      <CompanyLogo ticker={focus.ticker ?? ""} size="md" decorative />
      <span className="mt-1 text-sm font-semibold leading-tight">{focus.name}</span>
      <span className="num text-[11px] text-muted-foreground">{focus.ticker}</span>
    </div>
  );

  const header = (r: Relation, total: number) => {
    const t = totals[r];
    const only = isolatedRelation === r;
    return (
      <>
        <span className="flex h-6 min-w-0 items-center gap-1.5">
          <RelationMark relation={r} size={9} />
          <span className="text-xs font-semibold text-foreground">{RELATION_LABEL[r]}</span>
          <span className="num text-xs text-muted-foreground">{total}</span>
          {onIsolate && (
            <button type="button" aria-pressed={only} aria-label={only ? `Stop isolating ${RELATION_LABEL[r].toLowerCase()}` : `Isolate ${RELATION_LABEL[r].toLowerCase()}`} title={only ? "Show everything again" : `${RELATION_LABEL[r]} only`}
              onClick={() => onIsolate({ kind: "relation", relation: r })}
              className={cn("ml-auto grid size-6 shrink-0 place-items-center rounded transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", only ? "bg-secondary text-foreground" : "text-muted-foreground")}>
              <Focus className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
        <span className="min-w-0 truncate text-[11px] font-normal leading-4 tabular-nums text-muted-foreground"
          title={t.flows != null ? "Sum of the largest revenue, purchase or contract figure each name's sentence states. Guarantees, investments, financing and other figures are not added." : undefined}>
          {totalsLine(t)}
        </span>
      </>
    );
  };

  /** One relation's cards, in reading order, with the names that hang under each first-order card right after it. */
  const group = (r: Relation, flow: boolean) => {
    const cards = layout.cards.filter((c) => c.relation === r);
    const head = layout.headers.find((h) => h.relation === r);
    if (!cards.length || !head) return null;
    let index = -1;
    return (
      <div key={r} role="group" aria-label={`${RELATION_LABEL[r]}: ${head.total}`} className={flow ? undefined : "flex flex-col gap-1"}>
        <h3 className={cn("flex flex-col justify-end border-b pb-1", flow && "absolute")} style={flow ? { left: head.x, top: head.y, width: head.w, height: NET.head - 2 } : undefined}>
          {header(r, head.total)}
        </h3>
        {cards.map((c) => {
          if (c.hop === 1) index++;
          return flow ? card(c, index, true) : <div key={c.key} className={cn(c.hop === 2 && "pl-4")}>{card(c, index, false)}</div>;
        })}
      </div>
    );
  };

  const legend = (
    <div data-section="Network legend" className="mt-3 flex flex-col gap-1.5 border-t px-1 pt-2.5 text-[11px] leading-4 text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <svg aria-hidden="true" width={30} height={12} className="shrink-0 text-muted-foreground"><path d="M1 3H29" stroke="currentColor" strokeWidth={1.5} opacity={0.6} /><path d="M1 8.5H29" stroke="currentColor" strokeWidth={5} opacity={0.6} /></svg>
        <span><span className="font-medium text-foreground">Band width</span> shows, for suppliers, {BASIS_TEXT[layout.basis.supplier]}; for customers, {BASIS_TEXT[layout.basis.customer]}.</span>
      </p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Line styles">
        {RELATION_ORDER.filter((r) => visible.has(r)).map((r) => (
          <li key={r} className="inline-flex items-center gap-1.5"><LineSample relation={r} />{r === "supplier" ? "supplies the company" : r === "customer" ? "buys from the company" : r === "partner" ? "partnership" : "competition"}</li>
        ))}
        {layout.bands.some((b) => b.muted) && <li className="inline-flex items-center gap-1.5"><svg aria-hidden="true" width={22} height={8}><path d="M1 4H21" stroke="currentColor" strokeWidth={1.5} strokeDasharray="2 4" /></svg>financing, acquisition or regulator: not a flow</li>}
        {hop2.length > 0 && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm border border-dashed border-foreground/50" />second-order link</li>}
        <li className="inline-flex items-center gap-1.5"><Link2 aria-hidden="true" className="size-3" />stated dependency</li>
        {impacts && <li className="text-foreground">Shock view: solid cards are reached by the simulated shock, dashed cards are not</li>}
        {isolate != null && <li className="text-foreground">Isolated: {isolateLabel ?? "a selection"}. Dimmed names are outside it</li>}
      </ul>
    </div>
  );

  if (compact) {
    /* phones: one column, no bands; the same cards in the same order */
    return (
      <div data-section="Supply network" className="flex flex-col gap-4 p-3">
        <div ref={ref} />
        {group("supplier", false)}
        {focusCard()}
        {group("customer", false)}
        {group("partner", false)}
        {group("competitor", false)}
        {legend}
      </div>
    );
  }

  /* the hover card sits beside the hovered card, on the side away from the company */
  const tipCard = hover ? cardByKey.get(hover) : undefined;
  let tip: CSSProperties | null = null;
  if (tipCard) {
    const side = tipCard.relation === "supplier" && tipCard.hop === 1 ? tipCard.x + tipCard.w + 10 : tipCard.relation === "customer" ? tipCard.x - TIP_W - 10 : tipCard.x;
    const left = Math.max(0, Math.min(side, layout.width - TIP_W));
    const row = tipCard.relation === "partner" || tipCard.relation === "competitor";
    const low = tipCard.y > layout.height - 280;
    tip = row || low
      ? (low ? { left, bottom: layout.height - tipCard.y + 6 } : { left, top: tipCard.y + tipCard.h + 6 })
      : { left, top: Math.max(0, tipCard.y - 4) };
  }
  const tipImpact = tipCard ? impactOf(impacts, tipCard.node) : undefined;

  /* dashes drift along a band only while it is hovered, focused or selected: motion as feedback, never as wallpaper */
  return (
    <div data-section="Supply network" className="p-4">
      <div ref={ref} />
      {width > 0 && (
        <div className="relative" style={{ height: layout.height }}>
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
            {layout.bands.map((b) => {
              const c = cardByKey.get(b.key), isGroup = b.key.startsWith("group:");
              const on = active != null && (active === b.key || (c != null && parentOf(c) === active));
              /* a band fades when another name is hovered or selected, when the shock does not reach it, or when it is outside what is isolated */
              const away = isGroup ? isolate != null && !graph.some((n) => n.relation === b.relation && isolate.has(n.key)) : dimmed(b.key);
              const faded = (active != null && !on && !isGroup) || (c ? outside(c.node) : false) || away;
              const stroke = c && overlayHit(overlay, risks[b.key]) ? "var(--negative)" : RELATION_COLOR[b.relation];
              const dash = b.muted ? "2 4" : b.hop === 2 ? "3 4" : RELATION_DASH[b.relation].length ? RELATION_DASH[b.relation].join(" ") : undefined;
              return (
                <g key={`${b.hop}-${b.key}`} className="transition-opacity duration-150 motion-reduce:transition-none" style={{ opacity: faded ? 0.18 : 1 }}>
                  <path d={b.d} fill="none" stroke={stroke} strokeWidth={b.t} strokeLinecap={b.relation === "competitor" ? "round" : "butt"} strokeDasharray={dash} opacity={isGroup || b.hop === 2 ? 0.75 : b.muted ? 0.5 : on ? 0.65 : 0.38} />
                  {on && !b.muted && b.hop === 1 && (b.relation === "supplier" || b.relation === "customer") && (
                    <path d={b.d} fill="none" stroke={stroke} strokeWidth={Math.max(1.4, b.t * 0.3)} strokeDasharray="2 12" strokeLinecap="round" className="supply-flow" />
                  )}
                </g>
              );
            })}
          </svg>
          {layout.empty.map((e) => (
            <div key={`empty-${e.relation}`} className="absolute flex flex-col justify-center rounded-md border border-dashed px-3 text-[11px] text-muted-foreground" style={{ left: e.x, top: e.y, width: e.w, height: e.h }}>
              <span className="flex items-center gap-1.5 font-medium text-foreground"><RelationMark relation={e.relation} size={9} hollow />{RELATION_LABEL[e.relation]}</span>
              <span>None named in the current filings</span>
            </div>
          ))}
          {group("supplier", true)}
          {focusCard({ left: layout.focus.x, top: layout.focus.y, width: layout.focus.w, height: layout.focus.h })}
          {group("customer", true)}
          {group("partner", true)}
          {group("competitor", true)}
          {tipCard && tip && (
            <NodeHoverCard name={tipCard.node.name} facts={facts.get(tipCard.key)!} className="absolute" style={tip}
              shock={tipImpact ? `${SEVERITY[tipImpact.severity]}${tipImpact.revenuePct != null ? `, ${(tipImpact.revenuePct * 100).toFixed(1)}% of revenue at risk` : ""}` : impacts ? "Not reached by the shock" : null}
              action={selected === tipCard.key ? "Evidence is open" : "Click for the sentence"} />
          )}
        </div>
      )}
      {legend}
    </div>
  );
}
