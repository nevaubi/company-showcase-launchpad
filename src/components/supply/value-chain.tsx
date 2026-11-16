// End-to-end value chain view: tiers of suppliers → company → tiers of customers, every edge sized by
// the share or dollars a filing states. Wide screens draw columns; phones get the same tiers as a list.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Lock, ShieldCheck, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyLogo } from "@/components/app/company-logo";
import { RELATION_COLOR } from "@/components/supply/supply-map-meta";
import { TIER_LABEL, type Chain, type ChainEdge, type ChainNode, type TaggedShare } from "@/lib/supply/chain";
import type { RiskLink } from "@/lib/supply/core";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const BOX_H = 30;
const GAP = 10;

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
  selected,
  onSelect,
}: {
  chain: Chain;
  depth: number;
  onDepth: (d: number) => void;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
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
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">Value chain, end to end</p>
          <p className="text-[11px] text-muted-foreground">
            {up} upstream · {down} downstream · goods flow left to right · line width = stated share · dashed = named without a share
          </p>
        </div>
        <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Chain depth">
          {[1, 2, 3].map((d) => (
            <button key={d} type="button" onClick={() => onDepth(d)} className={cn("rounded px-2.5 py-1", depth === d ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
              {d === 1 ? "1 tier" : `${d} tiers`}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="relative min-h-0 flex-1">
        {width === 0 ? null : width < 640 ? (
          <ChainList chain={chain} byKey={byKey} selected={selected} onSelect={onSelect} />
        ) : (
          <ChainColumns chain={chain} byKey={byKey} width={width} lit={lit} selected={selected} onHover={setHover} onSelect={onSelect} />
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
  onHover,
  onSelect,
}: {
  chain: Chain;
  byKey: Map<string, ChainNode>;
  width: number;
  lit: Set<string> | null;
  selected: string | null;
  onHover: (k: string | null) => void;
  onSelect: (k: string) => void;
}) {
  const maxRows = Math.max(1, ...chain.tiers.map((t) => chain.nodes.filter((n) => n.tier === t).length));
  const height = Math.max(420, Math.min(560, maxRows * (BOX_H + GAP + 8) + 60));
  const { pos, boxW, colW, cols } = useMemo(() => layout(chain, width, height), [chain, width, height]);
  const boxH = BOX_H;
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
        const w = e.share != null ? Math.max(1.5, Math.min(9, 1 + e.share / 6)) : 1.25;
        const on = !lit || (lit.has(e.from) && lit.has(e.to));
        return (
          <g key={e.key} opacity={on ? 1 : 0.12} style={{ transition: "opacity 150ms" }}>
            <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={upstream ? RELATION_COLOR.supplier : RELATION_COLOR.customer} strokeOpacity={0.55} strokeWidth={w} strokeDasharray={e.share == null ? "4 4" : undefined} />
            {e.share != null && on && (
              <text x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle" className="num fill-foreground" style={{ fontSize: 10, paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>
                {e.share}%
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

function ChainList({ chain, byKey, selected, onSelect }: { chain: Chain; byKey: Map<string, ChainNode>; selected: string | null; onSelect: (k: string) => void }) {
  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
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
                      {e?.share != null && <span className="num shrink-0">{e.share}%</span>}
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
                    <button type="button" onClick={() => onOpenText(ev.link, `${a?.name ?? e.from} → ${b?.name ?? e.to}`)} className="mt-1 inline-flex items-center gap-1 rounded bg-highlight-soft px-2 py-0.5 text-[11px] font-medium text-highlight-foreground hover:bg-highlight">
                      <FileText className="size-3" /> {names[ev.link.ticker] ?? ev.link.ticker} {ev.link.form}, {fmtDate(ev.link.filed)}
                    </button>
                  </li>
                ) : (
                  <li key={`x${i}`} className="text-xs">
                    <button type="button" onClick={() => onOpenTag(ev.fact)} className="inline-flex items-center gap-1 rounded bg-highlight-soft px-2 py-0.5 text-[11px] font-medium text-highlight-foreground hover:bg-highlight">
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
