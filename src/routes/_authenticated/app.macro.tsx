import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueries } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/app/page-header";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { YieldCurveChart } from "@/components/charts/yield-curve";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getMacroBrief } from "@/lib/ai.functions";
import { CURVE_TENORS, MACRO_SERIES, type MacroDef } from "@/lib/coverage";
import { macroQuery } from "@/lib/data";
import { changeText, displayUnits, fmtMacro, reading, transformed, valueAt } from "@/lib/macro";
import { fmtDate, fmtRelative } from "@/lib/format";
import type { MacroSeries } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/macro")({
  head: () => ({
    meta: [
      { title: "Macro — Filed Under" },
      { name: "description", content: "Rates, inflation, labor, growth and credit from FRED, with an AI macro brief." },
      { property: "og:title", content: "Macro — Filed Under" },
      { property: "og:description", content: "Rates, inflation, labor, growth and credit from FRED, with an AI macro brief." },
    ],
  }),
  component: Macro,
});

const GROUPS: { id: MacroDef["group"]; title: string }[] = [
  { id: "rates", title: "Rates" },
  { id: "inflation", title: "Inflation" },
  { id: "labor", title: "Labor" },
  { id: "growth", title: "Growth" },
  { id: "liquidity", title: "Liquidity" },
  { id: "risk", title: "Risk & credit" },
  { id: "housing", title: "Housing" },
];
const SPANS = [
  { id: "5", l: "5Y" },
  { id: "10", l: "10Y" },
  { id: "20", l: "20Y" },
  { id: "max", l: "Max" },
] as const;

function Macro() {
  const qs = useQueries({ queries: MACRO_SERIES.map((d) => macroQuery({ ...d, since: d.since })) });
  const byId = new Map<string, MacroSeries>(qs.flatMap((q, i) => (q.data ? [[MACRO_SERIES[i].id, q.data] as const] : [])));
  const [span, setSpan] = useState<(typeof SPANS)[number]["id"]>("10");
  const [group, setGroup] = useState<MacroDef["group"] | "all">("all");
  const ready = qs.filter((q) => q.data).length;

  const recessions = useMemo(() => {
    const obs = byId.get("USREC")?.observations ?? [];
    const bands: { start: Date; end: Date }[] = [];
    let start: string | null = null;
    for (const [d, v] of obs) {
      if (v === 1 && !start) start = d;
      if (v === 0 && start) {
        bands.push({ start: new Date(start), end: new Date(d) });
        start = null;
      }
    }
    if (start) bands.push({ start: new Date(start), end: new Date() });
    return bands;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId.get("USREC")?.observations.length]);

  const curve = useMemo(() => {
    const series = CURVE_TENORS.map((t) => ({ ...t, obs: byId.get(t.id)?.observations ?? [] }));
    if (series.some((s) => !s.obs.length)) return null;
    const latest = series.map((s) => s.obs.at(-1)![0]).sort()[0];
    const at = (date: string) => series.map((s) => ({ label: s.label, years: s.years, value: valueAt(s.obs, date) })).filter((p): p is { label: string; years: number; value: number } => p.value != null);
    const shift = (d: string, months: number) => {
      const t = new Date(`${d}T00:00:00Z`);
      t.setUTCMonth(t.getUTCMonth() - months);
      return t.toISOString().slice(0, 10);
    };
    return {
      asOf: latest,
      lines: [
        { id: "now", label: "Latest", color: "var(--foreground)", points: at(latest) },
        { id: "6m", label: "6M ago", color: "var(--chart-2)", dashed: true, points: at(shift(latest, 6)) },
        { id: "1y", label: "1Y ago", color: "var(--chart-1)", dashed: true, points: at(shift(latest, 12)) },
        { id: "2y", label: "2Y ago", color: "var(--chart-5)", dashed: true, points: at(shift(latest, 24)) },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const brief = useMutation({
    mutationFn: () => {
      const readings = MACRO_SERIES.filter((d) => d.group !== "curve" && d.id !== "USREC" && byId.get(d.id)).map((d) => {
        const r = reading(d, byId.get(d.id)!.observations);
        return { id: d.id, title: `${d.title} (${displayUnits(d)})`, latest: fmtMacro(d, r.latest), date: r.date ?? "", change: `${changeText(d, r)}; 1Y ago ${fmtMacro(d, r.yearAgo)}` };
      });
      const asOf = readings.map((r) => r.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      return getMacroBrief({ data: { asOf, readings } });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const cutoff = span === "max" ? "1900-01-01" : new Date(Date.now() - Number(span) * 365.25 * 86400000).toISOString().slice(0, 10);
  const defs = MACRO_SERIES.filter((d) => d.group !== "curve" && d.id !== "USREC" && (group === "all" || d.group === group));

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="FRED · Federal Reserve Bank of St. Louis"
        title="Macro"
        description="The series that move equity multiples. Grey bands mark NBER recessions."
        actions={
          <div className="flex rounded-md border bg-secondary/50 p-0.5">
            {SPANS.map((s) => (
              <button key={s.id} onClick={() => setSpan(s.id)} className={cn("num rounded px-2.5 py-1 text-xs", span === s.id ? "bg-card font-medium shadow-paper" : "text-muted-foreground")}>
                {s.l}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title={
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5" /> Macro brief
            </span>
          }
          subtitle={brief.data ? `Written from ${MACRO_SERIES.length - 12} FRED series · ${fmtRelative(brief.data.cachedAt)}` : "An AI strategist's read of the latest prints"}
          actions={
            <Button size="xs" variant={brief.data ? "outline" : "ink"} onClick={() => brief.mutate()} disabled={brief.isPending || ready < MACRO_SERIES.length - 2}>
              {brief.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {brief.data ? "Refresh" : "Write brief"}
            </Button>
          }
        >
          {brief.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : brief.data ? (
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Badge variant="highlight">{brief.data.regime}</Badge>
                <p className="mt-2 font-display text-2xl leading-snug">{brief.data.headline}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {brief.data.sections.map((s) => (
                  <div key={s.title}>
                    <p className="text-[13px] font-semibold">{s.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
                    <p className="num mt-1 text-[10px] text-muted-foreground/80">{s.seriesIds.join(" · ")}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {ready < MACRO_SERIES.length - 2 ? `Loading series (${ready}/${MACRO_SERIES.length})…` : "Summarize rates, inflation, labor, growth and credit in one read."}
            </p>
          )}
        </Panel>

        <Panel title="Treasury yield curve" subtitle={curve ? `Constant-maturity yields · latest ${fmtDate(curve.asOf)}` : "Loading…"}>
          {curve ? <YieldCurveChart lines={curve.lines} height={280} /> : <Skeleton className="h-[280px]" />}
        </Panel>
      </div>

      <div className="flex flex-wrap gap-1">
        {[{ id: "all" as const, title: "All" }, ...GROUPS].map((g) => (
          <button key={g.id} onClick={() => setGroup(g.id)} className={cn("rounded-full border px-3 py-1 text-xs", group === g.id ? "border-foreground bg-ink text-ink-foreground" : "bg-card hover:bg-secondary")}>
            {g.title}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {defs.map((d) => {
          const s = byId.get(d.id);
          const r = s ? reading(d, s.observations) : null;
          const pts = s
            ? transformed(d, s.observations)
                .filter((o) => o[0] >= cutoff)
                .map(([dt, v]) => ({ date: new Date(`${dt}T00:00:00Z`), value: v }))
            : [];
          // Thin daily series for rendering speed
          const step = Math.max(1, Math.floor(pts.length / 900));
          const thin = step > 1 ? pts.filter((_, i) => i % step === 0 || i === pts.length - 1) : pts;
          const bands = recessions.filter((b) => b.end.toISOString().slice(0, 10) >= cutoff);
          return (
            <section key={d.id} className="rounded-lg border bg-card shadow-paper">
              <header className="flex items-start gap-2 px-4 pt-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{d.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {displayUnits(d)} · {d.frequency}
                  </p>
                </div>
                <a href={d.source} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                  {d.id} <ArrowUpRight className="size-3" />
                </a>
              </header>
              <div className="flex items-baseline gap-2 px-4 pt-1">
                {r ? (
                  <>
                    <span className="num text-xl font-medium">{fmtMacro(d, r.latest)}</span>
                    <span className="num text-[11px] text-muted-foreground">
                      {changeText(d, r)} · {fmtDate(r.date)}
                    </span>
                  </>
                ) : (
                  <Skeleton className="h-7 w-32" />
                )}
              </div>
              <div className="px-1 pb-2">
                {s ? <TimeSeriesChart height={150} endLabels={false} series={[{ id: d.id, label: d.title, color: "var(--chart-1)", points: thin, area: true }]} bands={bands} zeroLine={d.id === "T10Y2Y" || d.id === "T10Y3M" || d.transform === "diff"} yFormat={(v) => fmtMacro(d, v)} /> : <Skeleton className="m-3 h-[130px]" />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
