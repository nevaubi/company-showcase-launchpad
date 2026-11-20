// Network view of the supply-chain page: suppliers flow in from the left, the company sits in the middle,
// customers flow out to the right; partners and competitors sit in a row underneath.
// Band width is the stated dollars (or the stated share when no dollars are given), so the picture doubles
// as the flow view. Every card opens the filing sentences behind it through `onSelect`.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, Flag, Globe2, Lock } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, impactKey, overlayHit, RELATION_COLOR, RELATION_LABEL, type Overlay } from "./supply-map-meta";
import type { GraphNode, HopNode, NodeRisk, Relation, ShockImpact } from "@/lib/supply/core";
import { layoutNetwork, NET, type Basis, type NetCard } from "@/lib/supply/network-layout";
import { fmtCompactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIMIT = 12;
const COMPACT_BELOW = 620;
/** Reading order: what comes in, what goes out, then the ties that are not flows. */
const ORDER = ["supplier", "customer", "partner", "competitor"] as const;
const BASIS_TEXT: Record<Basis, string> = { dollars: "stated dollars", share: "stated share", none: "no amounts stated, bands are equal" };
const SINGULAR: Record<Relation, string> = { supplier: "supplier", customer: "customer", partner: "partner", competitor: "competitor" };

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

const metric = (c: Pick<NetCard, "dollars" | "share">) => (c.dollars != null && c.dollars > 0 ? fmtCompactUsd(c.dollars) : c.share > 0 ? `${c.share}%` : "");
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
  const totals = useMemo(() => Object.fromEntries(ORDER.map((r) => [r, graph.filter((n) => n.relation === r).length])) as Record<Relation, number>, [graph]);

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
  const dimmed = (n: GraphNode | HopNode) => impacts != null && !impacts.has(impactKey(n));
  const expand = (r: Relation) => { refocus.current = { relation: r, index: LIMIT }; setExpanded((s) => new Set(s).add(r)); };
  const collapse = (r: Relation) => { refocus.current = { relation: r, index: "more" }; setExpanded((s) => { const n = new Set(s); n.delete(r); return n; }); };

  const card = (c: NetCard, index: number, flow: boolean) => {
    const n = c.node, risk = risks[c.key], impact = impacts?.get(impactKey(n));
    const flagged = overlayHit(overlay, risk), picked = selected === c.key, value = metric(c);
    const small = c.h < NET.card;
    const spoken = [n.name, `${SINGULAR[c.relation]}${c.hop === 2 ? " of a direct link, second order" : ""}`, value && `${value} stated`, risk?.singleSource && "single source",
      risk?.hotspots.length ? `exposed to ${risk.hotspots.join(", ")}` : "", flagged && "flagged by the overlay", impact && `shock impact ${impact.severity}`].filter(Boolean).join(", ");
    return (
      <button
        key={c.key}
        type="button"
        data-rel={c.hop === 1 ? c.relation : undefined}
        data-idx={c.hop === 1 ? index : undefined}
        aria-pressed={picked}
        aria-label={`${spoken}. Open the filing evidence.`}
        title={`${n.name}: open the filing evidence`}
        onClick={() => onSelect(c.key)}
        onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(c.key)} onBlur={() => setHover(null)}
        style={flow ? { left: c.x, top: c.y, width: c.w, height: c.h } : { height: c.h }}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md border bg-card px-2 text-left shadow-paper transition-[box-shadow,opacity,border-color] duration-150 hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          flow ? "absolute" : "w-full",
          c.hop === 2 && "border-dashed",
          picked && "border-foreground ring-2 ring-highlight",
          flagged && !picked && "border-negative ring-2 ring-negative",
          impact?.severity === "high" && "bg-negative-soft",
          dimmed(n) && "opacity-30",
        )}
      >
        <CompanyLogo ticker={n.ticker ?? n.name.slice(0, 4).toUpperCase()} src={externalLogo(n.domain, n.ticker)} size="xs" decorative />
        <span className={cn("min-w-0 flex-1 truncate", picked ? "font-semibold" : "font-medium", small ? "text-[11px]" : "text-xs")}>{n.name}</span>
        {flagged && <Flag aria-hidden="true" className="size-3 shrink-0 text-negative" />}
        {risk?.singleSource && <Lock aria-hidden="true" className="size-3 shrink-0 text-negative" />}
        {(risk?.hotspots.length ?? 0) > 0 && <Globe2 aria-hidden="true" className="size-3 shrink-0 text-warning" />}
        {impact && <AlertTriangle aria-hidden="true" className="size-3 shrink-0 text-negative" />}
        {value && <span className="num shrink-0 text-[11px] text-muted-foreground">{value}</span>}
      </button>
    );
  };

  const toggleButton = (relation: Relation, label: string, onClick: () => void, style?: CSSProperties) => (
    <button key={`more-${relation}`} type="button" data-more={relation} onClick={onClick} style={style}
      className={cn("rounded-md border border-dashed px-2 text-left text-[11px] text-muted-foreground hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", style ? "absolute" : "h-7 w-full")}>
      {label}
    </button>
  );
  const fewer = (r: Relation) => expanded.has(r) && totals[r] > LIMIT;

  const focusCard = (style?: CSSProperties) => (
    <div style={style} className={cn("flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-foreground bg-card px-3 text-center shadow-lift", style ? "absolute" : "py-4")}>
      <CompanyLogo ticker={focus.ticker ?? ""} size="md" decorative />
      <span className="text-sm font-semibold leading-tight">{focus.name}</span>
      <span className="num text-[11px] text-muted-foreground">{focus.ticker}</span>
    </div>
  );

  const caption = (
    <p className="mt-2 px-1 text-[11px] text-muted-foreground">
      Band width: suppliers by {BASIS_TEXT[layout.basis.supplier]}, customers by {BASIS_TEXT[layout.basis.customer]}. Dashed cards are second-order links.
      {ORDER.filter(fewer).map((r) => (
        <span key={r}> <button type="button" data-more={r} className="underline underline-offset-2 hover:text-foreground" onClick={() => collapse(r)}>Show fewer {RELATION_LABEL[r].toLowerCase()}</button></span>
      ))}
    </p>
  );

  /** One relation's cards, in reading order, with the names that hang under each first-order card right after it. */
  const group = (r: Relation, flow: boolean) => {
    const cards = layout.cards.filter((c) => c.relation === r);
    if (!cards.length) return null;
    const header = layout.headers.find((h) => h.relation === r), more = layout.more.find((m) => m.relation === r);
    let index = -1;
    return (
      <div key={r} role="group" aria-label={`${RELATION_LABEL[r]}: ${header && header.shown < header.total ? `${header.shown} of ${header.total} shown` : totals[r]}`} className={flow ? undefined : "flex flex-col gap-1.5"}>
        {flow ? header && (
          <h3 className="eyebrow absolute flex items-center gap-1.5 truncate" style={{ left: header.x, top: header.y, width: header.w, height: NET.head }}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: RELATION_COLOR[r] }} />
            {RELATION_LABEL[r]} · {header.shown < header.total ? `${header.shown} of ${header.total}` : header.total}
          </h3>
        ) : (
          <h3 className="eyebrow flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: RELATION_COLOR[r] }} />{RELATION_LABEL[r]} · {totals[r]}</h3>
        )}
        {cards.map((c) => {
          if (c.hop === 1) index++;
          return flow ? card(c, index, true) : <div key={c.key} className={cn(c.hop === 2 && "pl-4")}>{card(c, index, false)}</div>;
        })}
        {more && toggleButton(r, `Show ${more.hidden} more ${RELATION_LABEL[r].toLowerCase()}`, () => expand(r), flow ? { left: more.x, top: more.y, width: more.w, height: more.h } : undefined)}
      </div>
    );
  };

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

  /* dashes drift along a band only while it is hovered, focused or selected: motion as feedback, never as wallpaper */
  return (
    <div ref={rootRef} data-section="Supply network" className="p-3">
      <div ref={ref} />
      {width > 0 && (
        <div className="relative" style={{ height: layout.height }}>
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
            {layout.bands.map((b) => {
              const c = cardByKey.get(b.key), isGroup = b.key.startsWith("group:");
              const on = active === b.key || (c != null && parentOf(c) === active);
              const faded = (active != null && !on && !isGroup) || (c ? dimmed(c.node) : false);
              const stroke = c && overlayHit(overlay, risks[b.key]) ? "var(--negative)" : RELATION_COLOR[b.relation];
              return (
                <g key={`${b.hop}-${b.key}`} style={{ opacity: faded ? 0.14 : 1, transition: "opacity 150ms" }}>
                  <path d={b.d} fill="none" stroke={stroke} strokeWidth={b.t} strokeLinecap="butt"
                    strokeDasharray={b.hop === 2 || b.relation === "competitor" ? "3 4" : undefined} opacity={b.hop === 2 || isGroup ? 0.6 : on ? 0.55 : 0.3} />
                  {b.hop === 1 && (b.relation === "supplier" || b.relation === "customer") && (
                    <path d={b.d} fill="none" stroke={stroke} strokeWidth={Math.max(1.4, b.t * 0.3)} strokeDasharray="2 12" strokeLinecap="round" opacity={on ? 1 : 0.75} className={on ? "supply-flow" : undefined} />
                  )}
                </g>
              );
            })}
          </svg>
          {group("supplier", true)}
          {focusCard({ left: layout.focus.x, top: layout.focus.y, width: layout.focus.w, height: layout.focus.h })}
          {group("customer", true)}
          {group("partner", true)}
          {group("competitor", true)}
        </div>
      )}
      {caption}
    </div>
  );
}
