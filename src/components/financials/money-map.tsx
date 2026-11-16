import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { cn } from "@/lib/utils";
import { detailPeriodLabel, type FilingDetail } from "@/lib/xbrl/detail";
import { layoutMoneyMap, moneyMap, type FlowPart, type LaidLink, type LaidNode, type MoneyLink } from "@/lib/xbrl/money-map";

const fmtB = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(0)}M` : `$${Math.round(a / 1e3)}K`;
};
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const LABEL_W = 190;
/** Labels sit over bands in the middle columns; a paper-coloured halo keeps them legible. */
const HALO = { paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3, strokeLinejoin: "round" } as const;

/** Sankey of where revenue comes from (products or regions), which segments earn it, and where it goes. */
export function MoneyMap({ d, ticker }: { d: FilingDetail; ticker: string }) {
  const [prefer, setPrefer] = useState<"product" | "geography" | undefined>(undefined);
  const full = useMemo(() => moneyMap(d, prefer), [d, prefer]);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(960);
  const [hover, setHover] = useState<string | null>(null);
  const source = useSource();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!full) return null;
  // Phones: sources move to a list above the chart, so the flow fits without sideways scrolling.
  const compact = box < 640;
  const map = compact ? { ...full, nodes: full.nodes.filter((n) => n.col !== 0), links: full.links.filter((l) => !l.from.startsWith("src:")) } : full;
  const width = Math.max(300, box);
  const labelW = compact ? 112 : LABEL_W;
  const rows = Math.max(...[0, 1, 2, 3].map((c) => map.nodes.filter((n) => n.col === c).length));
  const height = Math.min(560, Math.max(compact ? 260 : 300, rows * 46));
  const hasLeft = map.nodes.some((n) => n.col === 0);
  const inner = width - (hasLeft ? labelW : 0) - labelW;
  const L = layoutMoneyMap(map, inner, height);
  const sourcesList = compact ? full.nodes.filter((n) => n.col === 0) : [];
  const offset = hasLeft ? labelW : 0;
  const p = d.periods[map.periodKey];

  const openParts = (label: string, value: number, l: Pick<MoneyLink, "ref" | "derived">) => {
    const src = (x: FlowPart) => ({ accn: d.accn, doc: d.doc, concept: x.concept, start: d.periods[x.periodKey]?.start, end: d.periods[x.periodKey]?.end ?? d.reportDate, value: x.v });
    if (l.ref)
      source.open({ ticker, label, periodLabel: detailPeriodLabel(p), unit: "usd", value, src: src(l.ref), elementId: l.ref.id });
    else if (l.derived)
      source.open({ ticker, label, periodLabel: detailPeriodLabel(p), unit: "usd", value, derived: { formula: l.derived.formula, parts: l.derived.parts.map((x) => ({ ...src(x), label: x.label, sign: x.sign })) } });
  };
  const openNode = (n: LaidNode) => {
    const ins = L.links.filter((l) => l.to === n.id);
    const outs = L.links.filter((l) => l.from === n.id);
    const own = n.col === 0 ? outs : ins;
    if (own.length === 1) return openParts(n.label, n.value, own[0]);
    // A node fed by several tagged flows is their sum.
    const parts = own.flatMap((l) => (l.ref ? [l.ref] : (l.derived?.parts ?? [])));
    if (parts.length) openParts(n.label, n.value, { derived: { formula: `Sum of ${own.length} flows into ${n.label.toLowerCase()}`, parts } });
  };
  const active = (l: LaidLink) => !hover || l.from === hover || l.to === hover || `${l.from}>${l.to}` === hover;
  const tone = (l: LaidLink) => {
    const to = map.nodes.find((n) => n.id === l.to);
    return to?.kind === "profit" ? "fill-positive/30" : l.derived ? "fill-muted-foreground/15" : "fill-foreground/[0.11]";
  };

  return (
    <Panel
      className="min-w-0 rounded-lg border"
      title="Where the money comes from and where it goes"
      subtitle={`${detailPeriodLabel(p)} · ${map.sources.length ? (map.source === "product" ? "products" : "regions") : "consolidated revenue"} → segments → each segment's costs and profit. Grey bands are remainders calculated from tagged values. Click a band or bar for its source.`}
      bodyClassName="p-0"
      collapse={false}
      actions={
        map.sources.length > 1 ? (
          <Segmented size="xs" label="Revenue sources" value={map.source} onChange={(v) => setPrefer(v)} options={[{ v: "product", l: "Products" }, { v: "geography", l: "Regions" }]} />
        ) : undefined
      }
    >
      {sourcesList.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 border-b px-3.5 py-2 text-[11px]">
          {sourcesList.map((n) => {
            const l = full.links.find((x) => x.from === n.id);
            return (
              <li key={n.id}>
                <button type="button" className="flex w-full justify-between gap-2 rounded px-1 hover:bg-secondary" onClick={() => l && openParts(n.label, n.value, l)}>
                  <span className={cn("truncate", n.kind === "other" && "text-muted-foreground")}>{n.label}</span>
                  <span className="num shrink-0 text-muted-foreground">{fmtB(n.value)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div ref={ref} className="min-w-0">
        <svg width={width} height={height + 24} role="img" aria-label="Revenue flow from sources through segments to costs and profit" className="block">
          <g transform={`translate(${offset},12)`}>
            {L.links.map((l) => {
              const mid = (l.x0 + l.x1) / 2;
              const d0 = `M${l.x0},${l.sy - l.w / 2} C${mid},${l.sy - l.w / 2} ${mid},${l.ty - l.w / 2} ${l.x1},${l.ty - l.w / 2} L${l.x1},${l.ty + l.w / 2} C${mid},${l.ty + l.w / 2} ${mid},${l.sy + l.w / 2} ${l.x0},${l.sy + l.w / 2} Z`;
              const from = map.nodes.find((n) => n.id === l.from)!;
              const to = map.nodes.find((n) => n.id === l.to)!;
              return (
                <path
                  key={`${l.from}>${l.to}`}
                  d={d0}
                  className={cn("cursor-pointer transition-opacity", tone(l), active(l) ? "opacity-100" : "opacity-25", hover === `${l.from}>${l.to}` && "fill-highlight/60")}
                  onMouseEnter={() => setHover(`${l.from}>${l.to}`)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => openParts(`${from.label} → ${to.label}`, l.value, l)}
                >
                  <title>{`${from.label} → ${to.label}: ${fmtB(l.value)} (${pct(l.value / map.total)} of revenue)${l.derived ? ` — ${l.derived.formula}` : ""}`}</title>
                </path>
              );
            })}
            {L.nodes.map((n) => {
              const last = n.col === 3 || (n.col === 2 && !map.nodes.some((x) => x.col === 3));
              const first = n.col === 0;
              const tx = first ? -8 : last ? L.nodeW + 8 : L.nodeW + 6;
              const anchor = first ? "end" : "start";
              const small = n.h < 22;
              const max = compact ? 13 : small ? 20 : 28;
              return (
                <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => openNode(n)} className="cursor-pointer">
                  <rect x={n.x} y={n.y} width={L.nodeW} height={n.h} rx={2} className={cn(n.kind === "profit" ? "fill-positive" : n.kind === "other" ? "fill-muted-foreground/50" : "fill-foreground", hover === n.id && "fill-highlight-foreground")} />
                  <text x={n.x + tx} y={n.y + n.h / 2} dy={small ? "0.32em" : "-0.15em"} textAnchor={anchor} style={HALO} className="pointer-events-none fill-foreground text-[11px] font-medium">
                    {n.label.length > max ? `${n.label.slice(0, max - 1)}…` : n.label}
                    {small && !compact && <tspan className="fill-muted-foreground font-normal">{`  ${fmtB(n.value)}`}</tspan>}
                  </text>
                  {!small && (
                    <text x={n.x + tx} y={n.y + n.h / 2} dy="1.05em" textAnchor={anchor} style={HALO} className="pointer-events-none fill-muted-foreground font-mono text-[10.5px]">
                      {fmtB(n.value)} · {pct(n.value / map.total)}
                    </text>
                  )}
                  <title>{`${n.label}: ${fmtB(n.value)} (${pct(n.value / map.total)} of revenue)`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {map.notes.length > 0 && (
        <ul className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          {map.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export const hasMoneyMap = (d: FilingDetail) => !!moneyMap(d);
