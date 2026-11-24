import { signalsQuery } from "@/components/supply/supply-intel";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCheck, FileText, Sparkles } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { RELATION_COLOR } from "@/components/supply/supply-map-meta";
import { getSupplyNote } from "@/lib/supply.functions";
import { concentrationBasis, dependencyScore, regionExposure, type Confidence, type GraphNode, type ProLink } from "@/lib/supply/core";
import { cn } from "@/lib/utils";

export const CONF_LABEL: Record<Confidence, string> = {
  corroborated: "Corroborated by both filings",
  stated: "Stated with a figure or dependency",
  mentioned: "Named in filing",
};

export function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
      c === "corroborated" ? "bg-positive/15 text-positive" : c === "stated" ? "bg-highlight-soft text-foreground" : "bg-muted text-muted-foreground")}>
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
                      <button key={id} type="button" onClick={() => onOpen(l)} title={l.quote} className="ml-0.5 inline-flex items-center gap-0.5 rounded bg-highlight-soft px-1 text-[10.5px] font-medium text-foreground hover:bg-highlight hover:text-highlight-foreground">
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
  const { data: sig } = useQuery(signalsQuery(ticker));
  const unnamed = (sig ?? []).filter((s) => s.kind === "concentration" && s.pct != null && concentrationBasis(s.quote) === "revenue").sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
  const tone = d.score >= 50 ? "text-negative" : d.score >= 25 ? "text-foreground" : "text-positive";
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
      {unnamed && d.statedCustomerPct < (unnamed.pct ?? 0) && (
        <p className="mt-1.5 rounded bg-highlight/40 px-2 py-1 text-[11px]">Filing also states an unnamed customer at {unnamed.pct}% of revenue{unnamed.period ? ` (${unnamed.period})` : ""} — not counted above because no name is given. See Alt-data intelligence below.</p>
      )}
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
