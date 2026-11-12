import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { useSource } from "@/components/source/source-context";
import {
  cardsOf,
  chartFor,
  fmtChartValue,
  KIND_LABEL,
  kpiInsightsQuery,
  type KpiChart,
  type KpiInsightsFile,
  type KpiSource,
} from "@/lib/insights/kpi";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Two series on their own scales: the KPI (ink) and its comparator (muted, dashed), last points labelled. */
export function KpiSpark({ chart, className }: { chart: KpiChart; className?: string }) {
  const W = 220;
  const H = 54;
  const path = (pts: [string, number][]) => {
    const vs = pts.map((p) => p[1]).filter((v) => Number.isFinite(v));
    if (vs.length < 2) return "";
    const min = Math.min(...vs);
    const span = Math.max(...vs) - min || 1;
    return pts
      .map(([, v], i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * (W - 8) + 4).toFixed(1)},${(H - 6 - ((v - min) / span) * (H - 14)).toFixed(1)}`)
      .join("");
  };
  const main = chart.points;
  const comp = chart.comp?.points ?? [];
  const last = main[main.length - 1];
  const lastComp = comp[comp.length - 1];
  return (
    <figure className={cn("min-w-0", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[54px] w-full overflow-visible" role="img" aria-label={`${chart.name}${chart.comp ? ` and ${chart.comp.name}` : ""}, last ${main.length} periods`}>
        <line x1="4" x2={W - 4} y1={H - 4} y2={H - 4} className="stroke-border" strokeWidth="1" />
        {comp.length > 1 && (
          <path d={path(comp)} fill="none" className="stroke-muted-foreground/70" strokeWidth="1.25" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        )}
        <path d={path(main)} fill="none" className="stroke-foreground" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-0.5 flex flex-wrap gap-x-3 text-[10.5px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-0.5 w-3 bg-foreground align-middle" />
          {chart.name}
          {last && <span className="num ml-1 text-foreground">{fmtChartValue(last[1], chart.unit)}</span>}
        </span>
        {chart.comp && (
          <span>
            <span className="mr-1 inline-block w-3 border-t border-dashed border-muted-foreground align-middle" />
            {chart.comp.name}
            {lastComp && <span className="num ml-1">{fmtChartValue(lastComp[1], chart.comp.unit)}</span>}
          </span>
        )}
        {main.length > 1 && (
          <span className="num">
            {main[0][0].slice(0, 7)} to {last[0].slice(0, 7)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function SourceLinks({ ticker, label, sources }: { ticker: string; label: string; sources: KpiSource[] }) {
  const { open } = useSource();
  const uniq = useMemo(() => {
    const seen = new Set<string>();
    return sources.filter((s) => {
      const k = `${s.doc ?? ""}|${s.url ?? ""}|${s.doc_title ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [sources]);
  if (!uniq.length) return null;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {uniq.slice(0, 4).map((s, i) =>
        s.doc ? (
          <button
            key={i}
            type="button"
            className="inline-flex items-center gap-1 text-link hover:underline"
            title={s.quote}
            onClick={() =>
              open({
                ticker,
                label,
                periodLabel: s.label,
                unit: "",
                value: 0,
                external: s.url ? { url: s.url, quote: s.quote, date: s.doc_title } : undefined,
                doc: { accn: "", doc: "", title: s.doc_title ?? "Source document", irDoc: s.doc, search: s.quote?.split(/\s+/).slice(0, 12).join(" ") },
              })
            }
          >
            <FileText className="size-3" />
            {s.label ? `${s.label}${s.page ? `, p. ${s.page}` : ""}${s.sheet ? `, ${s.sheet}` : ""}` : (s.doc_title ?? "Document")}
          </button>
        ) : s.url ? (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">
            <ExternalLink className="size-3" />
            {s.doc_title ?? new URL(s.url).hostname}
          </a>
        ) : (
          <span key={i}>{s.doc_title}</span>
        ),
      )}
    </span>
  );
}

export function KpiInsightCards({ f, limit = 6, compact = false }: { f: KpiInsightsFile; limit?: number; compact?: boolean }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const cards = cardsOf(f, limit);
  return (
    <ol className={cn("grid grid-cols-1 gap-px bg-border", !compact && "md:grid-cols-2")}>
      {cards.map((c, i) => {
        const chart = chartFor(f, c.refs);
        const facts = c.refs.map((r) => ({ id: r, ...f.facts[r] })).filter((x) => x.text);
        const expanded = openIdx === i;
        return (
          <li key={i} className="min-w-0 bg-card px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-secondary px-1.5 py-px text-[10.5px] text-muted-foreground">{KIND_LABEL[c.kind] ?? c.kind}</span>
              {!c.model && <span className="text-[10.5px] text-muted-foreground">detected in code</span>}
            </div>
            <h3 className="mt-1 text-[13px] leading-snug font-medium">{c.title}</h3>
            {c.model && <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground/90">{c.text}</p>}
            {chart && <KpiSpark chart={chart} className="mt-2" />}
            <div className="mt-1.5">
              <button type="button" className="text-[11px] text-link hover:underline" onClick={() => setOpenIdx(expanded ? null : i)} aria-expanded={expanded}>
                {expanded ? "Hide evidence" : `Evidence (${facts.length})`}
              </button>
              {(expanded || !c.model) && (
                <ul className="mt-1 space-y-1.5 border-l-2 pl-2">
                  {facts.map((x) => (
                    <li key={x.id} className="text-[11.5px] leading-snug text-muted-foreground">
                      <span className="text-foreground/85">{x.text}</span>
                      <div className="mt-0.5 text-[10.5px]">
                        <SourceLinks ticker={f.ticker} label={c.title} sources={x.sources} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** "What the operating data says": verified insights from the company's reported KPIs joined with alternative data. */
export function KpiInsightsPanel({ ticker }: { ticker: string }) {
  const q = useQuery(kpiInsightsQuery(ticker));
  const f = q.data;
  if (!f || (!f.insights.length && !f.signals.length)) return null;
  const n = f.insights.length;
  return (
    <Panel
      title="What the operating data says"
      subtitle={`${n ? `${n} insights written from` : "Strongest signals in"} the company's reported KPIs, guidance, federal contracts, lobbying and trading records · ${fmtRelative(f.generated)}`}
      collapse={false}
      bodyClassName="p-0"
    >
      <KpiInsightCards f={f} />
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        {f.label}.{" "}
        {n ? (
          <>
            Drafted by one model and{" "}
            <span title={`Drafted by ${f.models.draft}; checked by ${f.models.check}`} className="underline decoration-dotted underline-offset-2">checked by a second</span>.{" "}
          </>
        ) : null}
        {f.signals.length} signals from {f.kpi_count} KPI series;
        signals are ordered by how far a value moved against its own history, its peers or a prior period, not by any view of the stock.
      </p>
    </Panel>
  );
}
