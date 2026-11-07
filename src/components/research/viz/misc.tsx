// Non-cartesian canvas views: KPI tiles, comparison cards, heatmap, treemap, sparkline table, event
// timeline, node-link graph and Mermaid diagrams.
import { useEffect, useMemo, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, hierarchy, treemap, treemapSquarify, type SimulationLinkDatum, type SimulationNodeDatum } from "d3";
import LoadingState from "@/components/ui/loading-state";
import type { LeafSpec } from "@/lib/research/view-spec";
import { cn } from "@/lib/utils";
import { PALETTE, fmtValue, pctIsFraction } from "./format";

type Spec<T extends LeafSpec["type"]> = Extract<LeafSpec, { type: T }>;
type Kpi = Spec<"kpis">["items"][number];

function Delta({ v }: { v: number | null | undefined }) {
  if (v == null) return null;
  return (
    <span className={cn("num font-medium tabular-nums", v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground")}>
      {v > 0 ? "+" : ""}
      {(v * 100).toFixed(1)}%
    </span>
  );
}

export function KpiTile({ k, dense }: { k: Kpi; dense?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-2.5">
      <p className="truncate text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground" title={k.label}>{k.label}</p>
      <p className={cn("num mt-1 truncate font-semibold tabular-nums", dense ? "text-base" : "text-lg")}>{typeof k.value === "number" ? fmtValue(k.value, k.unit) : k.value}</p>
      {(k.delta != null || k.note) && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <Delta v={k.delta} />
          {k.note && <span className="truncate">{k.note}</span>}
        </p>
      )}
    </div>
  );
}

export function KpisView({ spec }: { spec: Spec<"kpis"> }) {
  return (
    <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @4xl:grid-cols-6">
      {spec.items.map((k, i) => (
        <KpiTile key={i} k={k} />
      ))}
    </div>
  );
}

export function CardsView({ spec }: { spec: Spec<"cards"> }) {
  return (
    <div className={cn("grid grid-cols-1 gap-2 @md:grid-cols-2", spec.items.length === 3 && "@3xl:grid-cols-3", spec.items.length === 4 && "@3xl:grid-cols-4")}>
      {spec.items.map((c) => (
        <div key={c.title} className="min-w-0 rounded-md border bg-background p-3">
          <p className="truncate text-[13px] font-semibold">{c.title}</p>
          {c.subtitle && <p className="truncate text-[11.5px] text-muted-foreground">{c.subtitle}</p>}
          <dl className="mt-2 grid gap-1.5">
            {c.metrics.map((m) => (
              <div key={m.label} className="flex items-baseline gap-2 border-b border-dashed pb-1 text-[12px] last:border-0">
                <dt className="min-w-0 flex-1 truncate text-muted-foreground">{m.label}</dt>
                <dd className="num tabular-nums">{typeof m.value === "number" ? fmtValue(m.value, m.unit) : m.value}</dd>
                {m.delta != null && <dd className="w-14 text-right text-[11px]"><Delta v={m.delta} /></dd>}
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/** Colour for a value: diverging around 0 (positive/negative tokens) or sequential (chart-1). */
export function heatColor(v: number | null, lo: number, hi: number, diverging: boolean) {
  if (v == null || !Number.isFinite(v)) return "transparent";
  if (diverging) {
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const t = Math.min(1, Math.abs(v) / m);
    return `color-mix(in oklch, ${v >= 0 ? "var(--positive)" : "var(--negative)"} ${Math.round(8 + t * 62)}%, var(--background))`;
  }
  const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
  return `color-mix(in oklch, var(--chart-1) ${Math.round(8 + t * 72)}%, var(--background))`;
}

export function HeatmapView({ spec }: { spec: Spec<"heatmap"> }) {
  const flat = spec.values.flat().filter((v): v is number => v != null);
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const diverging = spec.diverging ?? (lo < 0 && hi > 0);
  const frac = pctIsFraction(flat);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-separate border-spacing-[2px] text-[10.5px]">
        <thead>
          <tr>
            <th />
            {spec.cols.map((c) => (
              <th key={c} scope="col" className="px-1 pb-0.5 text-center font-medium text-muted-foreground">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, i) => (
            <tr key={r}>
              <th scope="row" className="whitespace-nowrap pr-1.5 text-right font-medium text-muted-foreground">{r}</th>
              {spec.cols.map((c, j) => {
                const v = spec.values[i]?.[j] ?? null;
                return (
                  <td key={c} title={`${r} ${c}: ${fmtValue(v, spec.unit, { fraction: frac })}`} className="num h-7 min-w-9 rounded-[3px] px-1 text-center tabular-nums" style={{ background: heatColor(v, lo, hi, diverging) }}>
                    {v == null ? "" : fmtValue(v, spec.unit, { fraction: frac, digits: spec.unit === "%" ? 1 : 1 })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TreemapView({ spec, height = 280 }: { spec: Spec<"treemap">; height?: number }) {
  const W = 720, H = height;
  const leaves = useMemo(() => {
    const groups = new Map<string, Spec<"treemap">["items"]>();
    for (const it of spec.items) groups.set(it.group ?? "", [...(groups.get(it.group ?? "") ?? []), it]);
    const root = hierarchy<{ children?: unknown[]; value?: number; item?: Spec<"treemap">["items"][number]; name?: string }>({
      children: [...groups.entries()].map(([g, xs]) => ({ name: g, children: xs.map((x) => ({ item: x, value: x.value })) })),
    })
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<typeof root.data>().tile(treemapSquarify).size([W, H]).paddingInner(2).paddingTop((d) => (d.depth === 1 && groups.size > 1 ? 14 : 0)).round(true)(root);
    return root as unknown as { leaves: () => { x0: number; x1: number; y0: number; y1: number; data: { item: Spec<"treemap">["items"][number] } }[]; children?: { x0: number; y0: number; x1: number; data: { name: string } }[] };
  }, [spec.items, H]);
  const changes = spec.items.map((i) => i.change).filter((v): v is number => v != null);
  const cMax = Math.max(...changes.map(Math.abs), 1e-9);
  const total = spec.items.reduce((s, i) => s + i.value, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={spec.title ?? "Treemap"}>
      {(leaves.children ?? []).filter((g) => g.data.name).map((g) => (
        <text key={g.data.name} x={g.x0 + 2} y={g.y0 + 10} fontSize={10} fontWeight={600} fill="var(--muted-foreground)">{g.data.name}</text>
      ))}
      {leaves.leaves().map((l, i) => {
        const it = l.data.item;
        const w = l.x1 - l.x0, h = l.y1 - l.y0;
        const fill = it.change != null ? heatColor(it.change, -cMax, cMax, true) : `color-mix(in oklch, ${PALETTE[i % 5]} 30%, var(--background))`;
        return (
          <g key={i}>
            <title>{`${it.label}: ${fmtValue(it.value, spec.unit)} (${((it.value / total) * 100).toFixed(1)}%)${it.change != null ? `, ${(it.change * 100).toFixed(1)}%` : ""}`}</title>
            <rect x={l.x0} y={l.y0} width={w} height={h} rx={2} fill={fill} stroke="var(--background)" />
            {w > 42 && h > 20 && (
              <text x={l.x0 + 5} y={l.y0 + 14} fontSize={Math.min(13, Math.max(10, w / 9))} fontWeight={600} fill="var(--foreground)">{it.label.slice(0, Math.floor(w / 7))}</text>
            )}
            {w > 52 && h > 36 && (
              <text x={l.x0 + 5} y={l.y0 + 28} fontSize={10} fill="var(--muted-foreground)" className="tabular-nums">
                {it.change != null ? `${it.change > 0 ? "+" : ""}${(it.change * 100).toFixed(1)}%` : fmtValue(it.value, spec.unit)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ values, width = 96, height = 22 }: { values: (number | null)[]; width?: number; height?: number }) {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return <span className="text-muted-foreground">—</span>;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const pts = values
    .map((v, i) => (v == null ? null : `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4)).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const up = xs[xs.length - 1] >= xs[0];
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke={up ? "var(--positive)" : "var(--negative)"} strokeWidth={1.4} />
      <circle cx={last[0]} cy={last[1]} r={1.8} fill={up ? "var(--positive)" : "var(--negative)"} />
    </svg>
  );
}

export function SparkTableView({ spec }: { spec: Spec<"sparktable"> }) {
  const range = useMemo(() => {
    const m: Record<string, [number, number]> = {};
    for (const c of spec.columns) {
      const xs = spec.rows.map((r) => r[c.key]).filter((v): v is number => typeof v === "number");
      if (xs.length) m[c.key] = [Math.min(...xs), Math.max(...xs)];
    }
    return m;
  }, [spec.columns, spec.rows]);
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border scrollbar-thin">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-[1] bg-muted/90 backdrop-blur">
          <tr>
            {spec.columns.map((c) => (
              <th key={c.key} scope="col" className={cn("whitespace-nowrap border-b px-2 py-1.5 text-left text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground", c.kind !== "text" && "text-right")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
              {spec.columns.map((c) => {
                const v = r[c.key];
                if (c.kind === "spark") return <td key={c.key} className="px-2 py-1 text-right"><Sparkline values={Array.isArray(v) ? v : []} /></td>;
                if (c.kind === "text" || typeof v !== "number") return <td key={c.key} className={cn("px-2 py-1.5", c.kind !== "text" && "text-right")}>{Array.isArray(v) ? "" : (v ?? "—")}</td>;
                const unit = c.kind === "num" || c.kind === "delta" ? (c.kind === "delta" ? "%" : "") : c.kind;
                const [lo, hi] = range[c.key] ?? [0, 0];
                const tone = c.kind === "delta" || (c.kind === "%" && lo < 0) ? (v > 0 ? "text-positive" : v < 0 ? "text-negative" : "") : "";
                const bg = c.kind === "num" || c.kind === "$" || c.kind === "x" ? heatColor(v, lo, hi, false) : undefined;
                return (
                  <td key={c.key} className={cn("num px-2 py-1.5 text-right tabular-nums", tone)} style={bg ? { background: `color-mix(in oklch, ${bg} 55%, transparent)` } : undefined}>
                    {fmtValue(v, unit as never, { sign: c.kind === "delta" })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TimelineView({ spec }: { spec: Spec<"timeline"> }) {
  const events = [...spec.events].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ol className="relative ml-2 grid gap-2.5 border-l pl-4">
      {events.map((e, i) => (
        <li key={i} className="relative min-w-0">
          <span className={cn("absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-background", e.tone === "positive" ? "bg-positive" : e.tone === "negative" ? "bg-negative" : "bg-chart-1")} />
          <p className="flex items-baseline gap-2 text-[12px]">
            <time className="num shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">{e.date}</time>
            <span className="min-w-0 font-medium">{e.label}</span>
          </p>
          {e.detail && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{e.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

interface GNode extends SimulationNodeDatum {
  id: string;
  label: string;
  group: string;
}

/** Static force layout (computed once, no animation). */
export function layoutGraph(nodes: { id: string; label?: string; group?: string }[], edges: { from: string; to: string; weight?: number }[], W: number, H: number) {
  const ns: GNode[] = nodes.map((n) => ({ id: n.id, label: n.label ?? n.id, group: n.group ?? "" }));
  const ls: SimulationLinkDatum<GNode>[] = edges.map((e) => ({ source: e.from, target: e.to }));
  const sim = forceSimulation(ns)
    .force("link", forceLink<GNode, SimulationLinkDatum<GNode>>(ls).id((d) => d.id).distance(70).strength(0.6))
    .force("charge", forceManyBody().strength(-220))
    .force("center", forceCenter(W / 2, H / 2))
    .force("collide", forceCollide(26))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  for (const n of ns) {
    n.x = Math.max(30, Math.min(W - 30, n.x ?? W / 2));
    n.y = Math.max(16, Math.min(H - 16, n.y ?? H / 2));
  }
  return new Map(ns.map((n) => [n.id, n]));
}

export function GraphView({ spec, height = 320 }: { spec: Spec<"graph">; height?: number }) {
  const W = 720, H = height;
  const pos = useMemo(() => layoutGraph(spec.nodes, spec.edges, W, H), [spec.nodes, spec.edges, H]);
  const groups = [...new Set(spec.nodes.map((n) => n.group ?? ""))];
  const wMax = Math.max(...spec.edges.map((e) => e.weight ?? 1), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={spec.title ?? "Network"}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {spec.edges.map((e, i) => {
        const a = pos.get(e.from)!, b = pos.get(e.to)!;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={1 + ((e.weight ?? 1) / wMax) * 2.5} markerEnd={spec.directed ? "url(#arrow)" : undefined} />
            {e.label && <text x={((a.x ?? 0) + (b.x ?? 0)) / 2} y={((a.y ?? 0) + (b.y ?? 0)) / 2 - 3} fontSize={9.5} textAnchor="middle" fill="var(--muted-foreground)">{e.label}</text>}
          </g>
        );
      })}
      {[...pos.values()].map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={9} fill={PALETTE[groups.indexOf(n.group) % PALETTE.length]} stroke="var(--background)" strokeWidth={2} />
          <text x={n.x} y={(n.y ?? 0) + 21} fontSize={10.5} textAnchor="middle" fill="var(--foreground)">{n.label.slice(0, 24)}</text>
        </g>
      ))}
    </svg>
  );
}

let mermaidSeq = 0;

/** Mermaid flowchart/sequence/org diagram rendered to SVG, lazy-loaded, strict security level. */
export function MermaidView({ spec, onError }: { spec: Spec<"mermaid">; onError?: (msg: string) => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "inherit", flowchart: { htmlLabels: false } });
        const { svg } = await mermaid.render(`fu-mermaid-${++mermaidSeq}`, spec.code);
        if (live) setSvg(svg);
      } catch (e) {
        const m = (e as Error).message?.split("\n")[0] ?? "Diagram could not be drawn";
        if (live) {
          setErr(m);
          onError?.(m);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [spec.code, onError]);
  if (err) return <p className="py-6 text-center text-[12px] text-muted-foreground">This diagram could not be drawn.</p>;
  if (!svg) return <div className="grid place-items-center py-10"><LoadingState label="Drawing diagram" variant="Dots" /></div>;
  // Mermaid output at securityLevel "strict" is sanitized with DOMPurify.
  return <div className="mermaid-view flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
