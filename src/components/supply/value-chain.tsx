// End-to-end value chain view: tiers of suppliers → company → tiers of customers, every edge sized by
// the share or dollars a filing states. Wide screens draw columns; phones get the same tiers as a list.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, FileText, Lock, Search, ShieldCheck, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompanyLogo } from "@/components/app/company-logo";
import { RELATION_COLOR } from "@/components/supply/supply-map-meta";
import { CHAIN_FLOWS, LINK_TYPE_LABEL, TIER_LABEL, type Chain, type ChainEdge, type ChainFlow, type ChainNode, type TaggedShare } from "@/lib/supply/chain";
import type { RiskLink } from "@/lib/supply/core";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const BOX_H = 30;
const GAP = 10;

export type ChainSize = "share" | "dollars";

const shareText = (e: ChainEdge) => (e.share != null ? `${e.share}% of ${e.basis === "purchases" ? "purchases" : e.basis === "receivables" ? "receivables" : "revenue"}` : null);

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function ValueChain({
  chain,
  depth,
  onDepth,
  flow,
  onFlow,
  product,
  onProduct,
  size,
  onSize,
  selected,
  onSelect,
  evidence,
  onWide,
}: {
  chain: Chain;
  depth: number;
  onDepth: (d: number) => void;
  flow: ChainFlow;
  onFlow: (f: ChainFlow) => void;
  product: string;
  onProduct: (p: string) => void;
  size: ChainSize;
  onSize: (s: ChainSize) => void;
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Evidence card for the selected company, shown over the chart's right edge on wide screens. */
  evidence?: ReactNode;
  /** Told whether the evidence card is drawn over the chart (wide) or left to the page (narrow list). */
  onWide?: (wide: boolean) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const wide = width >= 640;
  useEffect(() => {
    if (width) onWide?.(wide);
  }, [wide, width, onWide]);
  const [hover, setHover] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(chain.nodes.map((n) => [n.key, n])), [chain]);
  const up = chain.nodes.filter((n) => n.tier < 0).length, down = chain.nodes.filter((n) => n.tier > 0).length;
  const active = hover ?? selected;
  const lit = useMemo(() => {
    if (!active) return null;
    const s = new Set<string>([active]);
    // light the whole path through the hovered node: its upstream and downstream reach
    const walk = (k: string, dir: 1 | -1) => {
      for (const e of chain.edges) {
        const [a, b] = dir > 0 ? [e.from, e.to] : [e.to, e.from];
        if (a === k && !s.has(b)) {
          s.add(b);
          walk(b, dir);
        }
      }
    };
    walk(active, 1);
    walk(active, -1);
    return s;
  }, [active, chain.edges]);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">Value chain, end to end</p>
          <p className="text-[11px] text-muted-foreground">
            {up} upstream · {down} downstream · goods flow left to right · line width = {size === "dollars" ? "dollars" : "stated share"} · dashed = named without {size === "dollars" ? "a dollar figure" : "a share"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Size lines by">
            {(["share", "dollars"] as const).map((v) => (
              <button key={v} type="button" onClick={() => onSize(v)} className={cn("rounded px-2.5 py-1", size === v ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
                {v === "share" ? "Share" : "Dollars"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Chain depth">
            {[1, 2, 3].map((d) => (
              <button key={d} type="button" onClick={() => onDepth(d)} className={cn("rounded px-2.5 py-1", depth === d ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
                {d === 1 ? "1 tier" : `${d} tiers`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="inline-flex flex-wrap rounded-md border p-0.5 text-xs" role="group" aria-label="What flows">
          {CHAIN_FLOWS.map((f) => (
            <button key={f.v} type="button" title={f.hint} onClick={() => onFlow(f.v)} className={cn("rounded px-2.5 py-1", flow === f.v ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={product} onChange={(ev) => onProduct(ev.target.value)} placeholder="Product, e.g. wafers, GPUs, lithium" aria-label="Filter by product" className="h-8 pl-7 pr-7 text-xs" />
          {product && (
            <button type="button" onClick={() => onProduct("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear product filter">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        {(flow !== "all" || product) && <span className="text-[11px] text-muted-foreground">{CHAIN_FLOWS.find((f) => f.v === flow)?.hint}{product ? ` · products matching “${product.trim()}”` : ""}</span>}
      </div>
      <div ref={ref} className="relative min-h-[420px]">
        {chain.nodes.length <= 1 ? (
          <div className="grid min-h-[420px] place-content-center gap-2 p-6 text-center text-sm text-muted-foreground">
            No filing states a link of this kind{product.trim() ? ` for “${product.trim()}”` : ""} around {chain.nodes[0]?.name ?? chain.focus}.
            <Button size="sm" variant="outline" className="mx-auto" onClick={() => { onFlow("all"); onProduct(""); }}>
              Show every link
            </Button>
          </div>
        ) : width === 0 ? null : width < 640 ? (
          <ChainList chain={chain} byKey={byKey} selected={selected} onSelect={onSelect} size={size} />
        ) : (
          <>
            <ChainColumns chain={chain} byKey={byKey} width={width} lit={lit} selected={selected} size={size} onHover={setHover} onSelect={onSelect} />
            {selected && evidence && (
              <div className="absolute inset-y-2 right-2 flex w-[340px] max-w-[45%] flex-col rounded-lg border bg-card shadow-lg" data-section="Chain evidence">
                <div className="flex items-center justify-between border-b px-3 py-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Evidence</span>
                  <button type="button" onClick={() => onSelect(null)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close evidence">
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">{evidence}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function layout(chain: Chain, width: number, height: number) {
  const cols = chain.tiers;
  const colW = width / cols.length;
  const boxW = Math.min(176, colW - 28);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [ci, t] of cols.entries()) {
    const tierNodes = chain.nodes.filter((n) => n.tier === t);
    // keep children next to the node that brought them in
    const parentY = (n: ChainNode) => (n.via ? (pos.get(n.via)?.y ?? 0) : 0);
    const order = Math.abs(t) <= 1 ? tierNodes : [...tierNodes].sort((a, b) => parentY(a) - parentY(b));
    const step = Math.min(BOX_H + GAP + 8, (height - 40) / Math.max(1, order.length));
    const total = step * order.length;
    const y0 = Math.max(32, (height - total) / 2 + 16);
    order.forEach((n, i) => pos.set(n.key, { x: ci * colW + (colW - boxW) / 2, y: y0 + i * step }));
  }
  return { pos, boxW, colW, cols };
}

function ChainColumns({
  chain,
  byKey,
  width,
  lit,
  selected,
  size,
  onHover,
  onSelect,
}: {
  chain: Chain;
  byKey: Map<string, ChainNode>;
  width: number;
  lit: Set<string> | null;
  selected: string | null;
  size: ChainSize;
  onHover: (k: string | null) => void;
  onSelect: (k: string) => void;
}) {
  const maxRows = Math.max(1, ...chain.tiers.map((t) => chain.nodes.filter((n) => n.tier === t).length));
  const height = Math.max(420, maxRows * (BOX_H + GAP + 8) + 60);
  const { pos, boxW, colW, cols } = useMemo(() => layout(chain, width, height), [chain, width, height]);
  const boxH = BOX_H;
  const maxD = Math.max(0, ...chain.edges.map((e) => e.dollars ?? 0));
  const outDeg = new Map<string, number>(), inDeg = new Map<string, number>();
  for (const e of chain.edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Value chain for ${chain.focus}`} className="block">
      {cols.map((t, i) => (
        <text key={t} x={i * colW + colW / 2} y={18} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {TIER_LABEL(t)}
        </text>
      ))}
      {chain.edges.map((e) => {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) return null;
        const x1 = a.x + boxW, y1 = a.y + boxH / 2, x2 = b.x, y2 = b.y + boxH / 2;
        const mx = (x1 + x2) / 2;
        const upstream = (byKey.get(e.to)?.tier ?? 0) <= 0;
        const sized = size === "dollars" ? e.dollars != null && maxD > 0 : e.share != null;
        // dollars: square-root scale so a $20B flow does not dwarf a $500M one into a hairline
        const w = !sized ? 1.25 : size === "dollars" ? 1.5 + 7.5 * Math.sqrt((e.dollars as number) / maxD) : Math.max(1.5, Math.min(9, 1 + (e.share as number) / 6));
        const tag = size === "dollars" ? (e.dollars != null ? fmtCompactUsd(e.dollars) : null) : e.share != null ? `${e.share}%` : null;
        const on = !lit || (lit.has(e.from) && lit.has(e.to));
        return (
          <g key={e.key} opacity={on ? 1 : 0.12} style={{ transition: "opacity 150ms" }}>
            <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={upstream ? RELATION_COLOR.supplier : RELATION_COLOR.customer} strokeOpacity={0.55} strokeWidth={w} strokeDasharray={!sized ? "4 4" : undefined}>
              <title>{[shareText(e), e.dollars != null ? `≈ ${fmtCompactUsd(e.dollars)}` : null, ...e.types.map(LINK_TYPE_LABEL), ...e.products].filter(Boolean).join(" · ")}</title>
            </path>
            {tag && on && (
              // label at the end where the lines fan out, so labels of edges sharing a node never stack
              <text x={(outDeg.get(e.from) ?? 0) > (inDeg.get(e.to) ?? 0) ? x2 - 6 : x1 + 6} y={((outDeg.get(e.from) ?? 0) > (inDeg.get(e.to) ?? 0) ? y2 : y1) - 5} textAnchor={(outDeg.get(e.from) ?? 0) > (inDeg.get(e.to) ?? 0) ? "end" : "start"} className="num fill-foreground" style={{ fontSize: 10, paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>
                {tag}
              </text>
            )}
          </g>
        );
      })}
      {chain.nodes.map((n) => {
        const p = pos.get(n.key);
        if (!p) return null;
        const focus = n.tier === 0;
        const on = !lit || lit.has(n.key);
        const sole = chain.edges.some((e) => e.sole && (e.from === n.key || e.to === n.key));
        const maxChars = Math.floor((boxW - (n.ticker ? 44 : 14)) / 6.2);
        const name = n.name.length > maxChars ? `${n.name.slice(0, maxChars - 1).trimEnd()}…` : n.name;
        return (
          <g
            key={n.key}
            transform={`translate(${p.x},${p.y})`}
            opacity={on ? 1 : 0.25}
            className="cursor-pointer"
            onMouseEnter={() => onHover(n.key)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(n.key)}
            role="button"
            tabIndex={0}
            aria-label={`${n.name}, ${TIER_LABEL(n.tier)}`}
            onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onSelect(n.key)}
            data-agent-click
          >
            <rect width={boxW} height={boxH} rx={6} fill={focus ? "var(--ink)" : "var(--card)"} stroke={selected === n.key ? "var(--highlight)" : focus ? "var(--ink)" : "var(--border)"} strokeWidth={selected === n.key ? 2 : 1} />
            <text x={8} y={boxH / 2 + 4} style={{ fontSize: 11.5 }} className={focus ? "fill-ink-foreground font-medium" : "fill-foreground"}>
              {name}
            </text>
            {n.ticker && (
              <text x={boxW - 8} y={boxH / 2 + 4} textAnchor="end" className={cn("num", focus ? "fill-ink-foreground" : "fill-muted-foreground")} style={{ fontSize: 10 }}>
                {n.ticker}
              </text>
            )}
            {sole && <circle cx={boxW - 2} cy={2} r={3.5} fill="var(--negative)"><title>Single-source dependency stated</title></circle>}
          </g>
        );
      })}
    </svg>
  );
}

function ChainList({ chain, byKey, selected, onSelect, size }: { chain: Chain; byKey: Map<string, ChainNode>; selected: string | null; onSelect: (k: string | null) => void; size: ChainSize }) {
  return (
    <div className="space-y-3 p-3">
      {chain.tiers.map((t) => (
        <section key={t}>
          <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{TIER_LABEL(t)}</p>
          <ul className="space-y-1">
            {chain.nodes
              .filter((n) => n.tier === t)
              .map((n) => {
                const e = t === 0 ? null : chain.edges.find((x) => (t < 0 ? x.from === n.key && x.to === n.via : x.to === n.key && x.from === n.via));
                const via = n.via ? byKey.get(n.via) : null;
                return (
                  <li key={n.key}>
                    <button type="button" onClick={() => onSelect(n.key)} className={cn("flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs", t === 0 && "bg-ink text-ink-foreground", selected === n.key && "ring-2 ring-highlight")}>
                      <span className="min-w-0 flex-1 truncate font-medium">{n.name}</span>
                      {via && t !== 0 && <span className="shrink-0 text-[10.5px] opacity-70">{t < 0 ? "→" : "←"} {via.ticker ?? via.name.slice(0, 12)}</span>}
                      {size === "dollars" ? e?.dollars != null && <span className="num shrink-0">{fmtCompactUsd(e.dollars)}</span> : e?.share != null && <span className="num shrink-0">{e.share}%</span>}
                      {n.ticker && <span className="num shrink-0 opacity-70">{n.ticker}</span>}
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Evidence for the selected chain node: every stated edge touching it, each with its source. */
export function ChainEvidence({
  chain,
  nodeKey,
  names,
  onFocus,
  onOpenText,
  onOpenTag,
}: {
  chain: Chain;
  nodeKey: string;
  names: Record<string, string>;
  onFocus: (ticker: string) => void;
  onOpenText: (l: RiskLink, label: string) => void;
  onOpenTag: (f: TaggedShare) => void;
}) {
  const n = chain.nodes.find((x) => x.key === nodeKey);
  if (!n) return <p className="text-sm text-muted-foreground">Pick a company in the chain to see the filings that link it.</p>;
  const byKey = new Map(chain.nodes.map((x) => [x.key, x]));
  const edges = chain.edges.filter((e) => e.from === n.key || e.to === n.key);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <CompanyLogo ticker={n.ticker ?? n.name.slice(0, 4).toUpperCase()} size="lg" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">{n.name}</p>
          <p className="text-xs text-muted-foreground">
            {n.ticker ?? "Not in coverage"} · {TIER_LABEL(n.tier)}
          </p>
        </div>
      </div>
      {n.ticker && n.tier !== 0 && names[n.ticker] && (
        <Button size="xs" variant="outline" onClick={() => onFocus(n.ticker!)}>
          Center the chain on {n.ticker}
        </Button>
      )}
      {edges.map((e) => {
        const a = byKey.get(e.from), b = byKey.get(e.to);
        return (
          <div key={e.key} className="rounded-lg border p-3 text-sm">
            <p className="text-xs font-medium">
              {a?.name ?? e.from} <span className="text-muted-foreground">sells to</span> {b?.name ?? e.to}
            </p>
            <div className="mt-1 flex flex-wrap gap-1 text-[10.5px]">
              {shareText(e) && <span className="num rounded bg-muted px-1.5 py-0.5">{shareText(e)}</span>}
              {e.dollars != null && <span className="num rounded bg-muted px-1.5 py-0.5">≈ {fmtCompactUsd(e.dollars)}</span>}
              {e.confirmed && (
                <span className="inline-flex items-center gap-1 rounded bg-positive/10 px-1.5 py-0.5 text-positive">
                  <ShieldCheck className="size-3" /> Both filings state it
                </span>
              )}
              {e.sole && (
                <span className="inline-flex items-center gap-1 rounded bg-negative/10 px-1.5 py-0.5 text-negative">
                  <Lock className="size-3" /> Single source
                </span>
              )}
            </div>
            <ul className="mt-2 space-y-2">
              {e.evidence.slice(0, 4).map((ev, i) =>
                ev.kind === "text" ? (
                  <li key={`t${ev.link.id}`}>
                    <blockquote className="border-l-2 border-highlight pl-2 text-xs italic text-muted-foreground">“{ev.link.quote.length > 220 ? `${ev.link.quote.slice(0, 219)}…` : ev.link.quote}”</blockquote>
                    <button type="button" onClick={() => onOpenText(ev.link, `${a?.name ?? e.from} → ${b?.name ?? e.to}`)} className="mt-1 inline-flex items-center gap-1 rounded bg-highlight-soft px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-highlight hover:text-highlight-foreground">
                      <FileText className="size-3" /> {names[ev.link.ticker] ?? ev.link.ticker} {ev.link.form}, {fmtDate(ev.link.filed)}
                    </button>
                  </li>
                ) : (
                  <li key={`x${i}`} className="text-xs">
                    <button type="button" onClick={() => onOpenTag(ev.fact)} className="inline-flex items-center gap-1 rounded bg-highlight-soft px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-highlight hover:text-highlight-foreground">
                      <Tag className="size-3" /> Tagged in {names[ev.fact.ticker] ?? ev.fact.ticker}'s {ev.fact.form}: “{ev.fact.label}” {(ev.fact.pct * 100).toFixed(1)}% of {ev.fact.benchmark}, {fmtDate(ev.fact.period_end)}
                    </button>
                  </li>
                ),
              )}
              {e.evidence.length > 4 && <li className="text-[11px] text-muted-foreground">+{e.evidence.length - 4} more filings say the same</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

type EdgeSort = "dollars" | "share" | "evidence";

/**
 * Every link drawn in the chain as a table: who sells what to whom, the stated share and the dollars it
 * implies (with how they were worked out), and the filings that state it. A row opens its first source.
 */
export function ChainTable({
  chain,
  names,
  revenue,
  onOpenText,
  onOpenTag,
  onSelect,
}: {
  chain: Chain;
  names: Record<string, string>;
  revenue: Record<string, number | undefined>;
  onOpenText: (l: RiskLink, label: string) => void;
  onOpenTag: (f: TaggedShare) => void;
  onSelect: (key: string) => void;
}) {
  const [sort, setSort] = useState<EdgeSort>("dollars");
  const [all, setAll] = useState(false);
  const byKey = useMemo(() => new Map(chain.nodes.map((n) => [n.key, n])), [chain]);
  const rows = useMemo(() => {
    const v = (e: ChainEdge) => (sort === "dollars" ? (e.dollars ?? -1) : sort === "share" ? (e.share ?? -1) : e.evidence.length);
    return [...chain.edges].sort((a, b) => v(b) - v(a) || (b.share ?? 0) - (a.share ?? 0) || b.evidence.length - a.evidence.length);
  }, [chain.edges, sort]);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 25);
  const quantified = rows.filter((e) => e.dollars != null).length;
  const nm = (k: string) => byKey.get(k)?.name ?? k;
  const tk = (k: string) => byKey.get(k)?.ticker ?? null;
  const formula = (e: ChainEdge) => {
    if (e.dollars == null) return undefined;
    if (e.dollarsFrom === "stated") return "Revenue, purchase or contract figure stated in the filing sentence";
    const seller = tk(e.from);
    const rev = seller ? revenue[seller] : undefined;
    return rev && e.share != null ? `${e.share}% of revenue × ${fmtCompactUsd(rev)} ${names[seller!] ?? seller} revenue (last 12 months)` : "Stated share × the seller's revenue (last 12 months)";
  };
  const openFirst = (e: ChainEdge) => {
    const ev = e.evidence.find((x) => x.kind === "text") ?? e.evidence[0];
    if (!ev) return;
    if (ev.kind === "text") onOpenText(ev.link, `${nm(e.from)} → ${nm(e.to)}`);
    else onOpenTag(ev.fact);
  };
  const head = (k: EdgeSort, label: string) => (
    <th className="sticky top-0 z-10 border-b bg-card px-3 py-2 text-right font-medium">
      <button type="button" onClick={() => setSort(k)} className={cn("inline-flex items-center gap-1", sort === k ? "text-foreground" : "hover:text-foreground")}>
        {label}
        {sort === k && <ArrowDown className="size-3" />}
      </button>
    </th>
  );
  return (
    <div className="min-w-0 rounded-xl border bg-card" data-section="Chain links">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <div>
          <p className="text-sm font-medium">Every link in the chain</p>
          <p className="text-[11px] text-muted-foreground">
            {rows.length} links · {quantified} with a dollar figure (stated, or a stated share of the seller's revenue) · click a row for its source
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-[11px] text-muted-foreground">
            <tr>
              <th className="sticky top-0 z-10 border-b bg-card px-3 py-2 text-left font-medium">Seller → buyer</th>
              <th className="sticky top-0 z-10 border-b bg-card px-3 py-2 text-left font-medium">What changes hands</th>
              {head("share", "Stated share")}
              {head("dollars", "≈ Dollars")}
              {head("evidence", "Filings")}
              <th className="sticky top-0 z-10 border-b bg-card px-3 py-2 text-left font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const t = byKey.get(e.from)?.tier ?? 0;
              return (
                <tr key={e.key} className="group cursor-pointer" onClick={() => openFirst(e)}>
                  <td className="max-w-72 border-b px-3 py-1.5 group-hover:bg-secondary">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <button type="button" title={nm(e.from)} onClick={(ev) => { ev.stopPropagation(); onSelect(e.from); }} className="min-w-0 truncate font-medium hover:underline">
                        {tk(e.from) ?? nm(e.from)}
                      </button>
                      <span className="shrink-0 text-muted-foreground">→</span>
                      <button type="button" title={nm(e.to)} onClick={(ev) => { ev.stopPropagation(); onSelect(e.to); }} className="min-w-0 truncate font-medium hover:underline">
                        {tk(e.to) ?? nm(e.to)}
                      </button>
                    </span>
                    <span className="block text-[10.5px] text-muted-foreground">{TIER_LABEL(t)} → {TIER_LABEL(t + 1).toLowerCase()}</span>
                  </td>
                  <td className="max-w-64 border-b px-3 py-1.5 group-hover:bg-secondary">
                    <span className="flex flex-wrap gap-1">
                      {e.types.map((x) => (
                        <span key={x} className="rounded bg-muted px-1.5 py-0.5 text-[10.5px]">{LINK_TYPE_LABEL(x)}</span>
                      ))}
                      {e.products.map((x) => (
                        <span key={x} className="max-w-40 truncate text-[11px] text-muted-foreground" title={x}>{x}</span>
                      ))}
                      {!e.types.length && !e.products.length && <span className="text-muted-foreground">{e.evidence.some((x) => x.kind === "tag") ? "tagged share" : "—"}</span>}
                    </span>
                  </td>
                  <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary">{e.share != null ? `${e.share}%` : "—"}<span className="block text-[10px] text-muted-foreground">{e.share != null ? `of ${e.basis}` : ""}</span></td>
                  <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary" title={formula(e)}>
                    {e.dollars != null ? fmtCompactUsd(e.dollars) : "—"}
                    {e.dollars != null && <span className="block text-[10px] text-muted-foreground">{e.dollarsFrom === "stated" ? "stated flow" : "share × revenue"}</span>}
                  </td>
                  <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary">{e.evidence.length}</td>
                  <td className="border-b px-3 py-1.5 group-hover:bg-secondary">
                    <span className="flex flex-wrap gap-1 text-[10.5px]">
                      {e.confirmed && <span className="inline-flex items-center gap-1 rounded bg-positive/10 px-1.5 py-0.5 text-positive"><ShieldCheck className="size-3" /> both filings</span>}
                      {e.sole && <span className="inline-flex items-center gap-1 rounded bg-negative/10 px-1.5 py-0.5 text-negative"><Lock className="size-3" /> single source</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 25 && (
        <div className="border-t px-4 py-2">
          <Button size="xs" variant="ghost" onClick={() => setAll((x) => !x)}>
            {all ? "Show the top 25" : `Show all ${rows.length} links`}
          </Button>
        </div>
      )}
    </div>
  );
}
