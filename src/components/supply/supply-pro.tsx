import { signalsQuery } from "@/components/supply/supply-intel";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, FileText, Sparkles } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupplyNote } from "@/lib/supply.functions";
import { dependencyScore, type Confidence, type ProLink } from "@/lib/supply/core";
import { scoreReading, scoreScope, unnamedCustomerShare } from "@/lib/supply/strip";
import { cn } from "@/lib/utils";

export const CONF_LABEL: Record<Confidence, string> = {
  corroborated: "Corroborated by both filings",
  stated: "Stated with a figure or dependency",
  mentioned: "Named in filing",
};

export function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
      c === "corroborated" ? "bg-positive-soft text-positive" : c === "stated" ? "bg-highlight-soft text-foreground" : "bg-muted text-muted-foreground")}>
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
    <Panel title="Analyst note" collapse={false} className="min-w-0" actions={<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Sparkles className="size-3" /> AI, from filing links only</span>}>
      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : !data || data.error ? (
        <p className="text-xs text-muted-foreground">{data?.error ?? "Note unavailable."}</p>
      ) : (
        <div className="space-y-3 text-[13px] leading-5">
          <p className="text-sm font-semibold leading-snug">{data.headline}</p>
          <ul className="space-y-2">
            {data.points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="eyebrow mt-1 w-24 shrink-0">{p.kind}</span>
                <span className="min-w-0">
                  {p.text}{" "}
                  {p.linkIds.map((id, j) => {
                    const l = byId.get(id);
                    return l ? (
                      <button key={id} type="button" onClick={() => onOpen(l)} title={l.quote} aria-label={`Open source ${j + 1}: ${l.counterparty}`} className="num ml-0.5 inline-flex min-h-5 items-center gap-0.5 rounded bg-highlight-soft px-1 text-[11px] font-medium text-foreground transition-colors duration-150 hover:bg-highlight hover:text-highlight-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                        <FileText className="size-2.5" />{j + 1}
                      </button>
                    ) : null;
                  })}
                </span>
              </li>
            ))}
          </ul>
          {data.watch.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-2.5">
              <p className="eyebrow mb-1">Watch next</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">{data.watch.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Fragility score with its three filing-based components; a part without inputs reads "not scored", never 0. */
export function DependencyCard({ ticker, name, all, hotspots = [], hotspotsFromLinks = false }: { ticker: string; name?: string; all: ProLink[]; hotspots?: string[]; hotspotsFromLinks?: boolean }) {
  const d = useMemo(() => dependencyScore(ticker, all), [ticker, all]);
  const { data: sig } = useQuery(signalsQuery(ticker));
  const r = useMemo(() => scoreReading(d, name ?? ticker, unnamedCustomerShare(sig ?? []), { hotspots, fromLinks: hotspotsFromLinks }), [d, name, ticker, sig, hotspots, hotspotsFromLinks]);
  const tone = r.value == null ? "text-muted-foreground" : r.value >= 50 ? "text-negative" : r.value >= 25 ? "text-foreground" : "text-positive";
  return (
    <Panel title="Dependency score" collapse={false} className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className={cn("num text-lg font-semibold leading-6", tone)}>{r.value ?? "–"}</span>
        <span className="text-[11px] text-muted-foreground">{r.sub}</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {r.parts.map((p) => (
          <div key={p.label}>
            <div className="flex justify-between text-xs"><span className="font-medium">{p.label}</span><span className={cn("num", p.points == null && "text-muted-foreground")}>{p.points == null ? "not scored" : `${p.points}/${p.max}`}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">{p.points != null && <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(p.points / p.max) * 100}%` }} />}</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{p.why}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{scoreScope(name ?? ticker)}</p>
      {r.customerPct > 0 && <p className="mt-1.5 text-[11px] text-muted-foreground">Customer HHI {r.customerHhi.toLocaleString()} · {r.customerPct}% of revenue tied to customers with a stated share{r.unnamed ? ", one of them unnamed" : ""}</p>}
    </Panel>
  );
}
