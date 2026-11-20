// Network view of the supply-chain page: suppliers flow in from the left, the company sits in the middle,
// customers flow out to the right; partners and competitors sit in a row underneath.
// Band width is the stated dollars (or the stated share when no dollars are given), so the picture doubles
// as the flow view. Every card opens the filing sentences behind it through `onSelect`.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, Flag, Globe2, Link2, Lock } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, impactOf, overlayHit, RELATION_COLOR, RELATION_DASH, RELATION_LABEL, RELATION_ORDER, type Overlay } from "./supply-map-meta";
import { figure, LineSample, NodeHoverCard, RelationMark } from "./supply-marks";
import type { GraphNode, HopNode, NodeRisk, Relation, ShockImpact } from "@/lib/supply/core";
import { groupTotals, NATURE_WORD, nodeFacts, type NodeFacts } from "@/lib/supply/describe";
import { layoutNetwork, NET, type Basis, type NetCard } from "@/lib/supply/network-layout";
import { fmtCompactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIMIT = 12;
const COMPACT_BELOW = 620;
const TIP_W = 288;
const BASIS_TEXT: Record<Basis, string> = { dollars: "width shows stated revenue, purchases or contract value (or stated share × revenue)", share: "width shows the stated share", none: "equal width, no flows stated" };
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

export interface SupplyNetworkProps {
  focus: GraphNode;
  graph: GraphNode[];
  hop2: HopNode[];
  visible: Set<Relation>;
  selected: string | null;
  onSelect: (key: string) => void;
  overlay: Overlay;
  risks: Record<string, NodeRisk>;
  impacts: Map<string, ShockImpact> | null;
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
  /** two lines (name, then product) or one */
  tall: boolean;
  /** second-row cell: the figure moves to the second line so the name keeps the whole width */
  stacked: boolean;
  index: number;
  /** placed by the layout (wide view) rather than in the phone list */
  placed: boolean;
  style?: CSSProperties;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}

/** One counterparty. Memoised: hovering a card re-renders only the cards whose state changed. */
const Card = memo(function Card({ c, facts, risk, impact, outside, picked, flagged, tall, stacked, index, placed, style, onSelect, onHover }: CardProps) {
  const n = c.node, fig = figure(facts), nature = NATURE_WORD[facts.nature];
  const spoken = [n.name, `${SINGULAR[c.relation]}${c.hop === 2 ? " of a direct link, second order" : ""}`, nature && nature.toLowerCase(), fig && `${fig.value} ${fig.unit}${fig.flow ? "" : ", not a flow"}`, facts.product && `product: ${facts.product}`,
    risk?.singleSource && "single source", facts.dependency && "stated dependency", risk?.hotspots.length ? `exposed to ${risk.hotspots.join(", ")}` : "", flagged && "flagged by the overlay",
    impact ? `shock: ${SEVERITY[impact.severity].toLowerCase()}` : outside ? "not reached by the shock" : ""].filter(Boolean).join(", ");
  const flags = (
    <>
      {flagged && <Flag aria-hidden="true" className="size-3 shrink-0 text-negative" />}
      {risk?.singleSource && <Lock aria-hidden="true" className="size-3 shrink-0 text-negative" />}
      {facts.dependency && <Link2 aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />}
      {(risk?.hotspots.length ?? 0) > 0 && <Globe2 aria-hidden="true" className="size-3 shrink-0 text-warning" />}
      {impact && <AlertTriangle aria-hidden="true" className="size-3 shrink-0 text-negative" />}
    </>
  );
  const figText = fig && (
    <span className="shrink-0 text-xs leading-4"><span className={cn("num", fig.flow ? "font-medium" : "text-muted-foreground")}>{fig.value}</span><span className="ml-1 text-[11px] text-muted-foreground">{fig.unit}</span></span>
  );
  const second = impact ? SEVERITY[impact.severity] : nature ? `${nature}${facts.summary ? ` · ${facts.summary}` : ""}` : facts.summary ?? `${facts.statements} filing statement${facts.statements === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      data-rel={c.hop === 1 ? c.relation : undefined}
      data-idx={c.hop === 1 ? index : undefined}
      data-key={c.key}
      aria-pressed={picked}
      aria-label={`${spoken}. Open the filing evidence.`}
      onClick={() => onSelect(c.key)}
      onMouseEnter={() => onHover(c.key)} onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(c.key)} onBlur={() => onHover(null)}
      style={style}
      className={cn(
        "group/card flex min-w-0 items-center gap-2 rounded-md border px-2 text-left transition-[box-shadow,border-color,background-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card motion-reduce:transition-none",
        placed ? "absolute" : "w-full",
        outside ? "border-dashed bg-transparent text-muted-foreground" : "bg-card shadow-paper hover:border-foreground/35 hover:shadow-lift",
        c.hop === 2 && !outside && "border-dashed",
        picked && "border-foreground bg-accent shadow-lift ring-1 ring-foreground",
        flagged && !picked && "border-negative ring-1 ring-negative",
        impact?.severity === "high" && !picked && "bg-negative-soft",
      )}
    >
      <span className={cn("shrink-0", outside && "opacity-60")}>
        <CompanyLogo ticker={n.ticker ?? n.name.slice(0, 4).toUpperCase()} src={externalLogo(n.domain, n.ticker)} size="xs" decorative />
      </span>
      {stacked ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("min-w-0 truncate text-xs leading-4", picked ? "font-semibold" : "font-medium")}>{n.name}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            {figText}
            <span className="min-w-0 flex-1 truncate">{second}</span>
            {flags}
          </span>
        </span>
      ) : tall ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-xs leading-4", picked ? "font-semibold" : "font-medium")}>{n.name}</span>
            {figText}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{second}</span>
            {flags}
          </span>
        </span>
      ) : (
        <>
          <span className={cn("min-w-0 flex-1 truncate text-xs", picked ? "font-semibold" : "font-medium")}>{n.name}</span>
          {flags}
          {fig && <span className={cn("num shrink-0 text-[11px]", fig.flow ? "font-medium" : "text-muted-foreground")}>{fig.value}</span>}
        </>
      )}
    </button>
  );
});

export function SupplyNetwork({ focus, graph, hop2, visible, selected, onSelect, overlay, risks, impacts }: SupplyNetworkProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<Relation>>(() => new Set());
  const [hover, setHover] = useState<string | null>(null);
  /** where keyboard focus should land after a list grows or shrinks, so it is never dropped */
  const refocus = useRef<{ relation: Relation; index: number | "more" } | null>(null);
  const compact = width > 0 && width < COMPACT_BELOW;
  const layout = useMemo(() => layoutNetwork({ graph, hop2, visible, risks, width: Math.max(width, COMPACT_BELOW), limit: LIMIT, expanded }), [graph, hop2, visible, risks, width, expanded]);
  const cardByKey = useMemo(() => new Map(layout.cards.map((c) => [c.key, c])), [layout]);
  const facts = useMemo(() => new Map(layout.cards.map((c) => [c.key, nodeFacts(c.node, risks[c.key])])), [layout, risks]);
  const byRelation = useMemo(() => Object.fromEntries(RELATION_ORDER.map((r) => [r, graph.filter((n) => n.relation === r)])) as Record<Relation, GraphNode[]>, [graph]);
  const totals = useMemo(() => Object.fromEntries(RELATION_ORDER.map((r) => [r, groupTotals(byRelation[r])])) as Record<Relation, ReturnType<typeof groupTotals>>, [byRelation]);

  /* a new company starts collapsed again; a hover that points at a card no longer drawn is dropped */
  const focusKey = focus.ticker ?? focus.name;
  useEffect(() => { setExpanded(new Set()); setHover(null); }, [focusKey]);
  useEffect(() => { setHover((h) => (h && !cardByKey.has(h) ? null : h)); }, [cardByKey]);
  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const sel = want.index === "more" ? `[data-more="${want.relation}"]` : `[data-rel="${want.relation}"][data-idx="${want.index}"]`;
    rootRef.current?.querySelector<HTMLButtonElement>(sel)?.focus();
  }, [layout]);

  const active = hover ?? selected;
  const outside = (n: GraphNode | HopNode) => impacts != null && !impactOf(impacts, n);
  const expand = (r: Relation) => { refocus.current = { relation: r, index: LIMIT }; setExpanded((s) => new Set(s).add(r)); };
  const collapse = (r: Relation) => { refocus.current = { relation: r, index: "more" }; setExpanded((s) => { const n = new Set(s); n.delete(r); return n; }); };

  const card = (c: NetCard, index: number, flow: boolean) => {
    const risk = risks[c.key];
    return (
      <Card key={c.key} c={c} facts={facts.get(c.key)!} risk={risk} impact={impactOf(impacts, c.node)} outside={outside(c.node)} picked={selected === c.key}
        flagged={overlayHit(overlay, risk)} tall={c.h >= NET.card || !flow} stacked={flow && c.h >= NET.card && (c.relation === "partner" || c.relation === "competitor")} index={index} placed={flow} onSelect={onSelect} onHover={setHover}
        style={flow ? { left: c.x, top: c.y, width: c.w, height: c.h } : { minHeight: c.hop === 2 ? NET.child : NET.card }} />
    );
  };

  const toggleButton = (relation: Relation, label: string, onClick: () => void, style?: CSSProperties) => (
    <button key={`more-${relation}`} type="button" data-more={relation} onClick={onClick} style={style}
      className={cn("rounded-md border border-dashed px-2.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:border-foreground/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", style ? "absolute" : "h-8 w-full")}>
      {label}
    </button>
  );
  const fewer = (r: Relation) => expanded.has(r) && byRelation[r].length > LIMIT;

  const shownRelations = RELATION_ORDER.filter((r) => visible.has(r) && byRelation[r].length);
  const focusCard = (style?: CSSProperties) => (
    <div style={style} data-focus-card="" className={cn("flex flex-col items-center justify-center gap-1 rounded-md border-2 border-foreground bg-card px-3 text-center shadow-lift", style ? "absolute" : "py-4")}>
      <CompanyLogo ticker={focus.ticker ?? ""} size="md" decorative />
      <span className="mt-1 text-sm font-semibold leading-tight">{focus.name}</span>
      <span className="num text-[11px] text-muted-foreground">{focus.ticker}</span>
      {shownRelations.length > 0 && (
        <span className="mt-1.5 flex flex-col gap-0.5 text-left text-[11px] text-muted-foreground">
          {shownRelations.map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5 whitespace-nowrap"><RelationMark relation={r} size={7} /><span className="tabular-nums text-foreground">{byRelation[r].length}</span>{byRelation[r].length === 1 ? SINGULAR[r] : RELATION_LABEL[r].toLowerCase()}</span>
          ))}
        </span>
      )}
    </div>
  );

  const header = (r: Relation, shown: number, total: number) => {
    const t = totals[r];
    const stated = t.maxShare != null ? `up to ${t.maxShare}% share` : t.flows != null ? `${fmtCompactUsd(t.flows)} stated flows` : t.others > 0 ? "no flows stated" : "no figures stated";
    return (
      <>
        <span className="flex shrink-0 items-center gap-1.5">
          <RelationMark relation={r} size={9} />
          <span className="text-xs font-semibold text-foreground">{RELATION_LABEL[r]}</span>
          <span className="num text-xs text-muted-foreground">{shown < total ? `${shown} of ${total}` : total}</span>
        </span>
        <span className="min-w-0 truncate text-right text-[11px] tabular-nums text-muted-foreground" title={t.flows != null ? "Sum of the largest revenue, purchase or contract figure each name's sentence states. Guarantees, investments, financing and other figures are not added." : undefined}>
          {t.quantified > 0 ? `${stated} · ${t.quantified} quantified` : stated}
        </span>
      </>
    );
  };

  /** One relation's cards, in reading order, with the names that hang under each first-order card right after it. */
  const group = (r: Relation, flow: boolean) => {
    const cards = layout.cards.filter((c) => c.relation === r);
    const head = layout.headers.find((h) => h.relation === r), more = layout.more.find((m) => m.relation === r);
    if (!cards.length || !head) return null;
    let index = -1;
    return (
      <div key={r} role="group" aria-label={`${RELATION_LABEL[r]}: ${head.shown < head.total ? `${head.shown} of ${head.total} shown` : head.total}`} className={flow ? undefined : "flex flex-col gap-1.5"}>
        <h3 className={cn("flex items-center justify-between gap-2 border-b pb-1.5", flow && "absolute")} style={flow ? { left: head.x, top: head.y, width: head.w, height: NET.head - 6 } : undefined}>
          {header(r, head.shown, head.total)}
        </h3>
        {cards.map((c) => {
          if (c.hop === 1) index++;
          return flow ? card(c, index, true) : <div key={c.key} className={cn(c.hop === 2 && "pl-4")}>{card(c, index, false)}</div>;
        })}
        {more && toggleButton(r, `Show ${more.hidden} more ${RELATION_LABEL[r].toLowerCase()}`, () => expand(r), flow ? { left: more.x, top: more.y, width: more.w, height: more.h } : undefined)}
      </div>
    );
  };

  const caption = (
    <div className="mt-3 flex flex-col gap-1.5 border-t px-1 pt-2.5 text-[11px] text-muted-foreground">
      <p>
        Supplier bands: {BASIS_TEXT[layout.basis.supplier]}. Customer bands: {BASIS_TEXT[layout.basis.customer]}. Indented, dashed cards are second-order links.
        {impacts && <> Shock view: solid cards are reached by the simulated shock, dashed cards are not.</>}
      </p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Line styles">
        {RELATION_ORDER.filter((r) => visible.has(r)).map((r) => (
          <li key={r} className="inline-flex items-center gap-1.5"><LineSample relation={r} />{r === "supplier" ? "supplies the company" : r === "customer" ? "buys from the company" : r === "partner" ? "partnership" : "competition"}</li>
        ))}
        <li className="inline-flex items-center gap-1.5"><Lock aria-hidden="true" className="size-3 text-negative" />single source</li>
        <li className="inline-flex items-center gap-1.5"><Link2 aria-hidden="true" className="size-3 text-muted-foreground" />stated dependency</li>
        {layout.bands.some((b) => b.muted) && <li className="inline-flex items-center gap-1.5"><svg aria-hidden="true" width={22} height={8}><path d="M1 4H21" stroke="currentColor" strokeWidth={1.5} strokeDasharray="2 4" /></svg>financing, acquisition or regulator: not a flow</li>}
        <li className="inline-flex items-center gap-1.5"><Globe2 aria-hidden="true" className="size-3 text-warning" />hotspot region</li>
      </ul>
      {RELATION_ORDER.some(fewer) && (
        <p className="flex flex-wrap gap-3">
          {RELATION_ORDER.filter(fewer).map((r) => (
            <button key={r} type="button" data-more={r} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => collapse(r)}>Show fewer {RELATION_LABEL[r].toLowerCase()}</button>
          ))}
        </p>
      )}
    </div>
  );

  if (compact) {
    /* phones: one column, no bands; the same cards in the same order */
    return (
      <div ref={rootRef} data-section="Supply network" className="flex flex-col gap-4 p-3">
        <div ref={ref} />
        {group("supplier", false)}
        {focusCard()}
        {group("customer", false)}
        {group("partner", false)}
        {group("competitor", false)}
        {caption}
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
    <div ref={rootRef} data-section="Supply network" className="p-4">
      <div ref={ref} />
      {width > 0 && (
        <div className="relative" style={{ height: layout.height }}>
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
            {layout.bands.map((b) => {
              const c = cardByKey.get(b.key), isGroup = b.key.startsWith("group:");
              const on = active != null && (active === b.key || (c != null && parentOf(c) === active));
              const faded = (active != null && !on && !isGroup) || (c ? outside(c.node) : false);
              const stroke = c && overlayHit(overlay, risks[b.key]) ? "var(--negative)" : RELATION_COLOR[b.relation];
              const dash = b.muted ? "2 4" : b.hop === 2 ? "3 4" : RELATION_DASH[b.relation].length ? RELATION_DASH[b.relation].join(" ") : undefined;
              return (
                <g key={`${b.hop}-${b.key}`} className="transition-opacity duration-150 motion-reduce:transition-none" style={{ opacity: faded ? 0.12 : 1 }}>
                  <path d={b.d} fill="none" stroke={stroke} strokeWidth={b.t} strokeLinecap={b.relation === "competitor" ? "round" : "butt"} strokeDasharray={dash} opacity={isGroup || b.hop === 2 ? 0.75 : b.muted ? 0.5 : on ? 0.6 : 0.3} />
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
      {caption}
    </div>
  );
}
