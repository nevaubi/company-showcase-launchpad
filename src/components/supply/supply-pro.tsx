import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCheck, FileText, Sparkles } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { RELATION_COLOR } from "@/components/supply/supply-map-meta";
import { getSupplyNote } from "@/lib/supply.functions";
import { dependencyScore, linkDollars, regionExposure, type Confidence, type GraphNode, type ProLink } from "@/lib/supply/core";
import { fmtCompactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const CONF_LABEL: Record<Confidence, string> = {
  corroborated: "Corroborated by both filings",
  stated: "Stated with a figure or dependency",
  mentioned: "Named in filing",
};

export function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
      c === "corroborated" ? "bg-positive/15 text-positive" : c === "stated" ? "bg-highlight-soft text-highlight-foreground" : "bg-muted text-muted-foreground")}>
      {c === "corroborated" && <CheckCheck className="size-3" />}
      {CONF_LABEL[c]}
    </span>
  );
}

/** Analyst note: every point cites the links it rests on; clicking a citation opens that link. */
export function SupplyNotePanel({ ticker, byId, onOpen }: { ticker: string; byId: Map<string, ProLink>; onOpen: (l: ProLink) => void }) {
  const fetchNote = useServerFn(getSupplyNote);
  const { data, isLoading } = useQuery({ queryKey: ["supply-note", ticker], queryFn: () => fetchNote({ data: { ticker } }), staleTime: 3600_000 });
  return (
    <Panel title="Analyst note" className="min-w-0" actions={<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Sparkles className="size-3" /> AI, from filing links only</span>}>
      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : !data || data.error ? (
        <p className="text-sm text-muted-foreground">{data?.error ?? "Note unavailable."}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-medium leading-snug">{data.headline}</p>
          <ul className="space-y-2">
            {data.points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 w-24 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{p.kind}</span>
                <span className="min-w-0">
                  {p.text}{" "}
                  {p.linkIds.map((id, j) => {
                    const l = byId.get(id);
                    return l ? (
                      <button key={id} type="button" onClick={() => onOpen(l)} title={l.quote} className="ml-0.5 inline-flex items-center gap-0.5 rounded bg-highlight-soft px-1 text-[10.5px] font-medium text-highlight-foreground hover:bg-highlight">
                        <FileText className="size-2.5" />{j + 1}
                      </button>
                    ) : null;
                  })}
                </span>
              </li>
            ))}
          </ul>
          {data.watch.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-2.5">
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Watch next</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">{data.watch.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Fragility score with its three filing-based components. */
export function DependencyCard({ ticker, all }: { ticker: string; all: ProLink[] }) {
  const d = useMemo(() => dependencyScore(ticker, all), [ticker, all]);
  const tone = d.score >= 50 ? "text-negative" : d.score >= 25 ? "text-highlight-foreground" : "text-positive";
  return (
    <Panel title="Dependency score" className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className={cn("num text-3xl font-semibold", tone)}>{d.score}</span>
        <span className="text-xs text-muted-foreground">/ 100 · higher = more fragile</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {d.parts.map((p) => (
          <div key={p.label}>
            <div className="flex justify-between text-xs"><span className="font-medium">{p.label}</span><span className="num">{p.points}/{p.max}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/70" style={{ width: `${(p.points / p.max) * 100}%` }} /></div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{p.why}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Customer HHI {d.customerHhi.toLocaleString()} · {d.statedCustomerPct}% of revenue tied to named customers</p>
    </Panel>
  );
}

/** Where the named links sit, by stated region. */
export function RegionPanel({ graph }: { graph: GraphNode[] }) {
  const rows = useMemo(() => regionExposure(graph.filter((n) => n.relation !== "competitor") as never), [graph]);
  const max = Math.max(1, ...rows.map((r) => r.suppliers + r.customers + r.other));
  return (
    <Panel title="Geographic footprint" className="min-w-0">
      {!rows.length ? <p className="text-sm text-muted-foreground">No regions tied to links in the filings.</p> : (
        <ul className="space-y-1.5">
          {rows.slice(0, 10).map((r) => (
            <li key={r.region} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 font-medium">{r.hotspot && <AlertTriangle className="size-3 text-negative" />}{r.region}</span>
                <span className="num text-muted-foreground">{r.suppliers} sup · {r.customers} cust · {r.other} other</span>
              </div>
              <div className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                <div style={{ width: `${(r.suppliers / max) * 100}%`, background: RELATION_COLOR.supplier }} />
                <div style={{ width: `${(r.customers / max) * 100}%`, background: RELATION_COLOR.customer }} />
                <div style={{ width: `${(r.other / max) * 100}%`, background: RELATION_COLOR.partner }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Coverage-wide fragility ranking. */
export function FragilityRanking({ tickers, all, names, onPick, current }: { tickers: string[]; all: ProLink[]; names: Record<string, string>; onPick: (t: string) => void; current: string }) {
  const rows = useMemo(() => tickers.map((t) => ({ t, d: dependencyScore(t, all) })).filter((r) => r.d.score > 0).sort((a, b) => b.d.score - a.d.score), [tickers, all]);
  return (
    <Panel title="Most fragile supply chains in coverage" className="min-w-0">
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground">
            <tr><th className="py-1">Company</th><th className="text-right">Score</th><th className="text-right">Top cust.</th><th className="text-right">Single-src</th><th className="text-right">Hotspot links</th></tr>
          </thead>
          <tbody>
            {rows.map(({ t, d }) => (
              <tr key={t} onClick={() => onPick(t)} className={cn("cursor-pointer border-t hover:bg-muted", t === current && "bg-highlight-soft")}>
                <td className="py-1"><span className="font-medium">{t}</span> <span className="text-muted-foreground">{names[t]}</span></td>
                <td className="num text-right font-semibold">{d.score}</td>
                <td className="num text-right">{d.topCustomerPct ? `${d.topCustomerPct}%` : "—"}</td>
                <td className="num text-right">{d.singleSource || "—"}</td>
                <td className="num text-right">{d.hotspotLinks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Suppliers → company → customers, band width = disclosed dollars, else stated share, else equal. */
export function SupplyFlow({ focusName, graph, revenue, onSelect, selected }: { focusName: string; graph: GraphNode[]; revenue: Record<string, number | undefined>; onSelect: (k: string) => void; selected: string | null }) {
  const W = 1000, H = 600, NODE_W = 10, GAP = 6;
  const side = (rel: "supplier" | "customer") => {
    const nodes = graph.filter((n) => n.relation === rel).map((n) => {
      const links = n.links as ProLink[];
      const d = Math.max(0, ...links.map((l) => linkDollars(l, revenue) ?? 0));
      const s = Math.max(0, ...links.map((l) => l.share_pct ?? 0));
      return { n, d, s, product: links.find((l) => l.product)?.product ?? links[0]?.detail ?? "" };
    }).sort((a, b) => b.d - a.d || b.s - a.s).slice(0, 14);
    const anyD = nodes.some((x) => x.d > 0);
    const w = nodes.map((x) => (anyD ? (x.d > 0 ? Math.max(0.15, Math.sqrt(x.d / Math.max(...nodes.map((y) => y.d)))) : 0.12) : x.s > 0 ? 0.3 + x.s / 25 : 0.3));
    const total = w.reduce((a, b) => a + b, 0) || 1;
    const avail = H - 40 - GAP * Math.max(0, nodes.length - 1);
    let y = 20;
    return nodes.map((x, i) => { const h = Math.max(8, (w[i] / total) * avail); const o = { ...x, y, h }; y += h + GAP; return o; });
  };
  const sup = side("supplier"), cus = side("customer");
  const fx = W / 2 - NODE_W / 2;
  const stack = (arr: { h: number }[]) => { const tot = arr.reduce((a, b) => a + b.h, 0); let y = H / 2 - tot / 2; return arr.map((a) => { const o = y; y += a.h; return o; }); };
  const supIn = stack(sup), cusOut = stack(cus);
  const tot = Math.max(sup.reduce((a, b) => a + b.h, 0), cus.reduce((a, b) => a + b.h, 0), 60);
  const band = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    const m = (x0 + x1) / 2;
    return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1} L${x1},${y1 + h} C${m},${y1 + h} ${m},${y0 + h} ${x0},${y0 + h} Z`;
  };
  const label = (x: { n: GraphNode; d: number; s: number; product: string }) => `${x.n.name}${x.d ? ` · ${fmtCompactUsd(x.d)}` : x.s ? ` · ${x.s}%` : ""}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      {sup.map((x, i) => (
        <g key={x.n.key} className="cursor-pointer" onClick={() => onSelect(x.n.key)} opacity={selected && selected !== x.n.key ? 0.35 : 1}>
          <path d={band(270 + NODE_W, x.y, fx, supIn[i], x.h)} fill={RELATION_COLOR.supplier} opacity={0.28} />
          <rect x={270} y={x.y} width={NODE_W} height={x.h} fill={RELATION_COLOR.supplier} rx={2} />
          <text x={262} y={x.y + x.h / 2} textAnchor="end" dominantBaseline="middle" className="fill-foreground text-[11px]">{label(x)}</text>
          <text x={262} y={x.y + x.h / 2 + 12} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[9px]">{x.product.slice(0, 34)}</text>
        </g>
      ))}
      {cus.map((x, i) => (
        <g key={x.n.key} className="cursor-pointer" onClick={() => onSelect(x.n.key)} opacity={selected && selected !== x.n.key ? 0.35 : 1}>
          <path d={band(fx + NODE_W, cusOut[i], W - 280, x.y, x.h)} fill={RELATION_COLOR.customer} opacity={0.28} />
          <rect x={W - 280} y={x.y} width={NODE_W} height={x.h} fill={RELATION_COLOR.customer} rx={2} />
          <text x={W - 272} y={x.y + x.h / 2} dominantBaseline="middle" className="fill-foreground text-[11px]">{label(x)}</text>
          <text x={W - 272} y={x.y + x.h / 2 + 12} dominantBaseline="middle" className="fill-muted-foreground text-[9px]">{x.product.slice(0, 34)}</text>
        </g>
      ))}
      <rect x={fx} y={H / 2 - tot / 2} width={NODE_W} height={tot} fill="var(--foreground)" rx={2} />
      <text x={W / 2} y={H / 2 - tot / 2 - 8} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{focusName}</text>
      <text x={270} y={12} className="fill-muted-foreground text-[10px]">SUPPLIERS</text>
      <text x={W - 280} y={12} className="fill-muted-foreground text-[10px]">CUSTOMERS</text>
    </svg>
  );
}
