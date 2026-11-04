import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowUpRight, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { YieldCurveChart } from "@/components/charts/yield-curve";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMacroBrief } from "@/lib/ai.functions";
import { CURVE_TENORS, MACRO_TILES, macroDef, type MacroDef, type MacroGroup } from "@/lib/coverage";
import { macroQuery, macroSummariesQuery } from "@/lib/data";
import { changeText, displayUnits, fmtMacro, recessionBands, transformed, valueAt, type MacroSummary } from "@/lib/macro";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GROUPS, GROUP_IDS, macroSearch } from "@/lib/macro-search";


/** The dashboard's opening view: the dozen prints that move multiples most. */
const KEY = ["FEDFUNDS", "DGS10", "T10Y2Y", "DFII10", "CPILFESL", "PCEPILFE", "UNRATE", "PAYEMS", "A191RL1Q225SBEA", "ICSA", "BAMLH0A0HYM2", "TSY_DEBT", "MTSDS133FMS", "DCOILWTICO", "RSAFS", "NEWORDER"];


export const Route = createFileRoute("/_authenticated/app/macro")({
  validateSearch: macroSearch,
  head: () => ({
    meta: [
      { title: "Macro — Filed Under" },
      { name: "description", content: "120 U.S. government economic series — rates, inflation, labor, growth, fiscal, energy — with percentiles, comparisons and an AI macro brief." },
      { property: "og:title", content: "Macro — Filed Under" },
      { property: "og:description", content: "120 U.S. government economic series with percentiles, comparisons and an AI macro brief." },
    ],
  }),
  component: Macro,
});

const SPANS = [
  { v: "2" as const, l: "2Y" },
  { v: "5" as const, l: "5Y" },
  { v: "10" as const, l: "10Y" },
  { v: "20" as const, l: "20Y" },
  { v: "max" as const, l: "Max" },
];

const cutoffFor = (span: string) => (span === "max" ? "1900-01-01" : new Date(Date.now() - Number(span) * 365.25 * 86400000).toISOString().slice(0, 10));

function Macro() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (patch: Partial<z.infer<typeof macroSearch>>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const summaries = useQuery(macroSummariesQuery);
  const sm = summaries.data;

  const usrec = useQuery(macroQuery({ ...macroDef("USREC")!, since: "1990-01-01" }));
  const recessions = useMemo(() => recessionBands(usrec.data?.observations ?? []), [usrec.data]);

  const defs = s.group === "key" ? KEY.map((id) => macroDef(id)!).filter(Boolean) : MACRO_TILES.filter((d) => d.group === s.group);
  const agencies = useMemo(() => [...new Set(MACRO_TILES.map((d) => d.agency))].length, []);

  const brief = useMutation({
    mutationFn: () => {
      const readings = MACRO_TILES.flatMap((d) => {
        const r = sm?.get(d.id);
        if (!r || r.latest == null) return [];
        const pct = r.pct10y != null ? `; ${Math.round(r.pct10y * 100)}th percentile of 10 years` : "";
        return [{ id: d.id, title: `${d.title} (${displayUnits(d)}) — ${d.agency}`.slice(0, 140), latest: fmtMacro(d, r.latest), date: r.date ?? "", change: `${changeText(d, r)}; 1Y ago ${fmtMacro(d, r.yearAgo)}${pct}`.slice(0, 160) }];
      });
      const asOf = readings.map((r) => r.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      return getMacroBrief({ data: { asOf, readings } });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  // The brief is cached server-side per data date, so opening the page normally reads the shared copy.
  const asked = useRef(false);
  useEffect(() => {
    if (sm && !asked.current) {
      asked.current = true;
      brief.mutate();
    }
  }, [sm, brief]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow={`${MACRO_TILES.length} series · ${agencies} agencies · BLS, BEA, Census, Federal Reserve, Treasury, EIA`}
        title="Macro"
        description="The government data that moves earnings and multiples. Percentiles place each print in its ten-year range; grey bands mark NBER recessions."
        actions={<Segmented label="Chart span" value={s.span} onChange={(v) => set({ span: v })} options={SPANS} />}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title={
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5" /> Macro brief
            </span>
          }
          subtitle={brief.data ? `Written from ${MACRO_TILES.length} government series · ${fmtRelative(brief.data.cachedAt)}` : "An AI strategist's read of the latest prints"}
          actions={
            <Button size="xs" variant={brief.data ? "outline" : "ink"} onClick={() => brief.mutate()} disabled={brief.isPending || !sm}>
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
                {brief.data.sections.map((x) => (
                  <div key={x.title}>
                    <p className="text-[13px] font-semibold">{x.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{x.body}</p>
                    <p className="num mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground/80">
                      {x.seriesIds.map((id) => (
                        <button key={id} className="hover:text-foreground hover:underline" onClick={() => set({ series: id })}>
                          {id}
                        </button>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{sm ? "Summarize rates, inflation, labor, growth, credit, fiscal and energy in one read." : "Loading readings…"}</p>
          )}
        </Panel>
        <YieldCurvePanel />
      </div>

      {s.series && macroDef(s.series) && (
        <SeriesDetail
          def={macroDef(s.series)!}
          vs={s.vs ? macroDef(s.vs) : undefined}
          span={s.span}
          bands={recessions}
          onClose={() => set({ series: undefined, vs: undefined })}
          onCompare={(id) => set({ vs: id || undefined })}
        />
      )}

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
        {[{ id: "key", title: "Key indicators" }, ...GROUPS].map((g) => (
          <button
            key={g.id}
            onClick={() => set({ group: g.id as z.infer<typeof macroSearch>["group"] })}
            className={cn("shrink-0 rounded-full border px-3 py-1 text-xs", s.group === g.id ? "border-foreground bg-ink text-ink-foreground" : "bg-card hover:bg-secondary")}
          >
            {g.title}
            {g.id !== "key" && <span className="ml-1 opacity-60">{MACRO_TILES.filter((d) => d.group === g.id).length}</span>}
          </button>
        ))}
      </div>

      <MacroMonitor defs={defs} summaries={sm} loading={summaries.isLoading} selected={s.series} onSelect={(id) => set({ series: id })} />

      <Tiles defs={defs} span={s.span} bands={recessions} summaries={sm} onOpen={(id) => set({ series: id })} />
    </div>
  );
}

function YieldCurvePanel() {
  const qs = useQueries({ queries: CURVE_TENORS.map((t) => macroQuery({ ...macroDef(t.id)!, since: "2022-01-01" })) });
  const ready = qs.every((q) => q.data);
  const curve = useMemo(() => {
    if (!ready) return null;
    const series = CURVE_TENORS.map((t, i) => ({ ...t, obs: qs[i].data!.observations }));
    const latest = series.map((x) => x.obs.at(-1)![0]).sort()[0];
    const at = (date: string) =>
      series.map((x) => ({ label: x.label, years: x.years, value: valueAt(x.obs, date) })).filter((p): p is { label: string; years: number; value: number } => p.value != null);
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
  return (
    <Panel title="Treasury yield curve" subtitle={curve ? `Constant-maturity yields, Federal Reserve H.15 · latest ${fmtDate(curve.asOf)}` : "Loading…"}>
      {curve ? <YieldCurveChart lines={curve.lines} height={280} /> : <Skeleton className="h-[280px]" />}
    </Panel>
  );
}

/** Where a reading sits in its ten-year range, coloured by whether "high" is good or bad for risk assets. */
function PercentileBar({ def, s }: { def: MacroDef; s: MacroSummary }) {
  if (s.pct10y == null) return <span className="text-muted-foreground/50">—</span>;
  const p = s.pct10y;
  const tone = def.rising == null ? "bg-foreground" : (def.rising === "good") === p >= 0.5 ? "bg-positive" : "bg-negative";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative block h-2 w-24 rounded-full bg-secondary">
          <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
          <span className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card", tone)} style={{ left: `${p * 100}%` }} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {Math.round(p * 100)}th percentile of the last 10 years · range {fmtMacro(def, s.min10y)} – {fmtMacro(def, s.max10y)}
      </TooltipContent>
    </Tooltip>
  );
}

function MacroMonitor({
  defs,
  summaries,
  loading,
  selected,
  onSelect,
}: {
  defs: MacroDef[];
  summaries?: Map<string, MacroSummary>;
  loading: boolean;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel title="Macro monitor" subtitle="Latest print, change, and position in the 10-year range · click a row to chart it" bodyClassName="p-0">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[860px] text-[12.5px]">
          <thead>
            <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Series</th>
              <th className="px-3 py-2 text-right font-medium">Latest</th>
              <th className="px-3 py-2 font-medium">As of</th>
              <th className="px-3 py-2 text-right font-medium">Change</th>
              <th className="px-3 py-2 text-right font-medium">1Y ago</th>
              <th className="px-3 py-2 font-medium">10Y range</th>
              <th className="px-3 py-2 text-right font-medium">5Y z</th>
              <th className="px-3 py-2 font-medium">5 years</th>
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => {
              const s = summaries?.get(d.id);
              return (
                <tr
                  key={d.id}
                  onClick={() => onSelect(d.id)}
                  className={cn("cursor-pointer border-b last:border-0 hover:bg-secondary/60", selected === d.id && "bg-highlight-soft")}
                >
                  <td className="px-4 py-2">
                    <p className="font-medium">{d.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {displayUnits(d)} · {d.frequency} · {d.agency}
                    </p>
                  </td>
                  {s ? (
                    <>
                      <td className="num px-3 py-2 text-right text-[13px] font-medium">{fmtMacro(d, s.latest)}</td>
                      <td className="num px-3 py-2 text-[11px] text-muted-foreground">{fmtDate(s.date, { month: "short", day: d.frequency === "Daily" || d.frequency === "Weekly" ? "numeric" : undefined, year: "numeric" })}</td>
                      <td className="num px-3 py-2 text-right text-[11px] text-muted-foreground">{changeText(d, s).replace(/ vs .*/, "")}</td>
                      <td className="num px-3 py-2 text-right text-[11px]">{fmtMacro(d, s.yearAgo)}</td>
                      <td className="px-3 py-2">
                        <PercentileBar def={d} s={s} />
                      </td>
                      <td className={cn("num px-3 py-2 text-right text-[11px]", s.z5y == null ? "text-muted-foreground" : Math.abs(s.z5y) >= 1.5 ? "font-semibold" : "")}>
                        {s.z5y == null ? "—" : `${s.z5y >= 0 ? "+" : "−"}${Math.abs(s.z5y).toFixed(1)}`}
                      </td>
                      <td className="px-3 py-1">
                        <Sparkline values={s.spark.map((o) => o[1])} tone="ink" className="h-6 w-28" />
                      </td>
                    </>
                  ) : (
                    <td colSpan={7} className="px-3 py-2">
                      {loading ? <Skeleton className="h-5 w-full" /> : <span className="text-xs text-muted-foreground">No reading available</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SeriesDetail({
  def,
  vs,
  span,
  bands,
  onClose,
  onCompare,
}: {
  def: MacroDef;
  vs?: MacroDef;
  span: string;
  bands: { start: Date; end: Date }[];
  onClose: () => void;
  onCompare: (id: string) => void;
}) {
  const a = useQuery(macroQuery({ ...def, since: def.since }));
  const b = useQuery({ ...macroQuery({ ...(vs ?? def), since: (vs ?? def).since }), enabled: !!vs });
  const [pick, setPick] = useState("");
  const cutoff = cutoffFor(span);
  const pts = (d: MacroDef, obs?: [string, number][]) =>
    thin(
      transformed(d, obs ?? [])
        .filter((o) => o[0] >= cutoff)
        .map(([dt, v]) => ({ date: new Date(`${dt}T00:00:00Z`), value: v })),
    );
  const series = [
    { id: def.id, label: def.title, color: "var(--chart-1)", points: pts(def, a.data?.observations), area: !vs },
    ...(vs && b.data ? [{ id: vs.id, label: vs.title, color: "var(--chart-2)", points: pts(vs, b.data.observations), axis: "right" as const }] : []),
  ];
  const visibleBands = bands.filter((x) => x.end.toISOString().slice(0, 10) >= cutoff);
  return (
    <Panel
      title={def.title}
      subtitle={`${displayUnits(def)} · ${def.frequency} · ${def.agency}${vs ? ` — vs ${vs.title} (right axis)` : ""}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={vs?.id ?? pick}
            onChange={(e) => {
              setPick(e.target.value);
              onCompare(e.target.value);
            }}
            aria-label="Compare with another series"
            className="h-7 max-w-52 rounded-md border bg-card px-2 text-xs"
          >
            <option value="">Compare with…</option>
            {GROUPS.map((g) => (
              <optgroup key={g.id} label={g.title}>
                {MACRO_TILES.filter((d) => d.group === g.id && d.id !== def.id).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <a href={def.source} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground">
            {def.id} <ArrowUpRight className="size-3" />
          </a>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close chart">
            <X />
          </Button>
        </div>
      }
    >
      {a.data ? (
        <TimeSeriesChart
          height={320}
          series={series}
          bands={visibleBands}
          endLabels={!vs}
          zeroLine={def.transform === "diff" || def.units === "pp"}
          yFormat={(v) => fmtMacro(def, v)}
          rightFormat={vs ? (v) => fmtMacro(vs, v) : undefined}
        />
      ) : (
        <Skeleton className="h-[320px]" />
      )}
      {a.data && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {a.data.observations.length.toLocaleString()} observations since {fmtDate(a.data.observations[0]?.[0])} · source{" "}
          {a.data.source === "cloud" ? "snapshot + scheduled refresh" : a.data.source === "snapshot" ? "bundled snapshot" : "live"}
        </p>
      )}
    </Panel>
  );
}

function thin<T>(pts: T[], max = 900) {
  const step = Math.max(1, Math.floor(pts.length / max));
  return step > 1 ? pts.filter((_, i) => i % step === 0 || i === pts.length - 1) : pts;
}

function Tiles({
  defs,
  span,
  bands,
  summaries,
  onOpen,
}: {
  defs: MacroDef[];
  span: string;
  bands: { start: Date; end: Date }[];
  summaries?: Map<string, MacroSummary>;
  onOpen: (id: string) => void;
}) {
  const qs = useQueries({ queries: defs.map((d) => macroQuery({ ...d, since: d.since })) });
  const cutoff = cutoffFor(span);
  const visibleBands = bands.filter((b) => b.end.toISOString().slice(0, 10) >= cutoff);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {defs.map((d, i) => {
        const s = qs[i].data;
        const r = summaries?.get(d.id);
        const pts = s
          ? thin(
              transformed(d, s.observations)
                .filter((o) => o[0] >= cutoff)
                .map(([dt, v]) => ({ date: new Date(`${dt}T00:00:00Z`), value: v })),
            )
          : [];
        return (
          <section key={d.id} className="min-w-0 rounded-lg border bg-card shadow-paper">
            <header className="flex items-start gap-2 px-4 pt-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(d.id)}>
                <p className="truncate text-[13px] font-semibold hover:underline">{d.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {displayUnits(d)} · {d.agency}
                </p>
              </button>
              <a href={d.source} target="_blank" rel="noreferrer" className="num inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
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
              {s ? (
                <TimeSeriesChart
                  height={150}
                  endLabels={false}
                  series={[{ id: d.id, label: d.title, color: "var(--chart-1)", points: pts, area: true }]}
                  bands={visibleBands}
                  zeroLine={d.units === "pp" || d.transform === "diff" || d.id === "BOPGSTB"}
                  yFormat={(v) => fmtMacro(d, v)}
                />
              ) : qs[i].isError ? (
                <p className="m-3 grid h-[130px] place-items-center rounded-md bg-secondary/50 text-xs text-muted-foreground">Series unavailable right now</p>
              ) : (
                <Skeleton className="m-3 h-[130px]" />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

