import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { geoNaturalEarth1, geoPath, geoCentroid, geoInterpolate } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCheck, CircleHelp, ExternalLink, Loader2, Microscope, ShieldAlert, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { returnsQuery } from "@/lib/markets/query";
import { supplyHistoryQuery } from "@/lib/supply/query";
import { canonCountry, concentrationHistory, countryExposure, ecosystemBasket, freshness, isHotspot, regionShock, type CountryRow, type SignalLite } from "@/lib/supply/analytics";
import { dependencyScore, type GraphNode, type ProLink } from "@/lib/supply/core";
import { verifySupplyLink, type VerifyResult } from "@/lib/supply-verify.functions";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- data

/** Light coverage-wide view of verified signals (country, kind, impact) for maps and region shocks. */
export const allSignalsQuery = {
  queryKey: ["supply_signals_all"],
  queryFn: async () => {
    const out: SignalLite[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("supply_signals").select("ticker,kind,country,impact,title,amount_usd").not("country", "is", null).range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as SignalLite[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  },
  staleTime: 10 * 60_000,
};

// ---------------------------------------------------------------- world map

type Geo = { type: "Feature"; properties: { name: string }; geometry: unknown };
const COUNTRIES = (feature(world as never, (world as never as { objects: { countries: never } }).objects.countries) as unknown as { features: Geo[] }).features;
/** Places too small to see at 110m resolution. */
const POINTS: Record<string, [number, number]> = { Singapore: [103.82, 1.35], "Hong Kong": [114.17, 22.32], Luxembourg: [6.13, 49.61], Malta: [14.4, 35.9], Bermuda: [-64.75, 32.3] };
const HOME: [number, number] = [-98, 39];

export function WorldExposureMap({ ticker, name, links, signals, revenue, selected, onSelect }: {
  ticker: string; name: string; links: ProLink[]; signals: SignalLite[]; revenue: Record<string, number | undefined>; selected: string | null; onSelect: (c: string | null) => void;
}) {
  const [scope, setScope] = useState<"focus" | "all">("focus");
  const [hover, setHover] = useState<CountryRow | null>(null);
  const rows = useMemo(() => {
    const l = scope === "all" ? links : links.filter((x) => x.ticker === ticker || x.counterparty_ticker === ticker);
    const s = scope === "all" ? signals : signals.filter((x) => x.ticker === ticker);
    return countryExposure(l, s, revenue).filter((r) => r.country !== "United States" || scope === "all" || r.links + r.facilities > 0);
  }, [scope, links, signals, ticker, revenue]);
  const byName = useMemo(() => new Map(rows.map((r) => [r.country, r])), [rows]);
  const W = 960, H = 470;
  const proj = useMemo(() => geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" } as never), []);
  const path = useMemo(() => geoPath(proj), [proj]);
  const weight = (r?: CountryRow) => (r ? r.links + r.hq + r.facilities * 1.5 + r.policy : 0);
  const max = Math.max(1, ...rows.map((r) => weight(r)));
  const centroidOf = (c: string): [number, number] | null => {
    if (POINTS[c]) return proj(POINTS[c]) as [number, number];
    const f = COUNTRIES.find((g) => canonCountry(g.properties.name) === c);
    return f ? (proj(geoCentroid(f as never)) as [number, number]) : null;
  };
  const arcs = scope === "focus" ? rows.filter((r) => r.country !== "United States").slice(0, 25) : [];
  const unmapped = rows.filter((r) => !centroidOf(r.country));
  const sel = selected ? byName.get(selected) : null;
  const info = hover ?? sel ?? null;

  return (
    <Panel
      title="World exposure"
      className="min-w-0"
      actions={
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          {(["focus", "all"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setScope(v)} className={cn("rounded px-2.5 py-1", scope === v ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
              {v === "focus" ? name : "All coverage"}
            </button>
          ))}
        </div>
      }
    >
      <div className="relative overflow-hidden rounded-lg border bg-paper">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" onMouseLeave={() => setHover(null)}>
          <path d={path({ type: "Sphere" } as never) ?? ""} fill="var(--background)" stroke="var(--border)" />
          {COUNTRIES.map((g, i) => {
            const c = canonCountry(g.properties.name)!;
            const r = byName.get(c);
            const w = weight(r) / max;
            const hot = isHotspot(c);
            return (
              <path
                key={i}
                d={path(g as never) ?? ""}
                fill={r ? (hot ? "var(--negative)" : "var(--chart-1)") : "var(--muted)"}
                fillOpacity={r ? 0.18 + 0.72 * Math.sqrt(w) : 1}
                stroke={selected === c ? "var(--foreground)" : "var(--background)"}
                strokeWidth={selected === c ? 1.6 : 0.5}
                className={cn(r && "cursor-pointer")}
                onMouseEnter={() => setHover(r ?? null)}
                onClick={() => r && onSelect(selected === c ? null : c)}
              />
            );
          })}
          {arcs.map((r) => {
            const end = POINTS[r.country] ?? (() => { const f = COUNTRIES.find((g) => canonCountry(g.properties.name) === r.country); return f ? (geoCentroid(f as never) as [number, number]) : null; })();
            if (!end) return null;
            const ip = geoInterpolate(HOME, end);
            const line = { type: "LineString", coordinates: Array.from({ length: 24 }, (_, i) => ip(i / 23)) };
            return <path key={`a-${r.country}`} d={path(line as never) ?? ""} fill="none" stroke={r.hotspot ? "var(--negative)" : "var(--foreground)"} strokeOpacity={selected && selected !== r.country ? 0.15 : 0.7} strokeLinecap="round" strokeWidth={1.2 + 3 * Math.sqrt(weight(r) / max)} strokeDasharray={r.singleSource ? undefined : "3 3"} />;
          })}
          {rows.map((r) => {
            const p = centroidOf(r.country);
            if (!p) return null;
            const rad = 2.5 + 9 * Math.sqrt(weight(r) / max);
            return (
              <g key={`b-${r.country}`} className="cursor-pointer" onMouseEnter={() => setHover(r)} onClick={() => onSelect(selected === r.country ? null : r.country)}>
                <circle cx={p[0]} cy={p[1]} r={rad} fill={r.hotspot ? "var(--negative)" : "var(--ink)"} fillOpacity={0.85} stroke="var(--background)" strokeWidth={1.2} />
                {r.singleSource > 0 && <circle cx={p[0]} cy={p[1]} r={rad + 3} fill="none" stroke="var(--negative)" strokeWidth={1} strokeDasharray="2 2" />}
                {weight(r) / max > 0.25 && <text x={p[0]} y={p[1] - rad - 4} textAnchor="middle" className="fill-foreground text-[11px] font-medium" style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}>{r.country}</text>}
              </g>
            );
          })}
        </svg>
        {info && (
          <div className="pointer-events-none absolute left-3 top-3 w-60 rounded-lg border bg-card/95 p-3 text-xs shadow-lift backdrop-blur">
            <p className="flex items-center gap-1.5 text-sm font-semibold">{info.hotspot && <AlertTriangle className="size-3.5 text-negative" />}{info.country}</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              <dt className="text-muted-foreground">Filing links</dt><dd className="num text-right">{info.links}</dd>
              <dt className="text-muted-foreground">Single-source</dt><dd className={cn("num text-right", info.singleSource && "font-semibold text-negative")}>{info.singleSource}</dd>
              <dt className="text-muted-foreground">HQ counterparties</dt><dd className="num text-right">{info.hq}</dd>
              <dt className="text-muted-foreground">Facilities</dt><dd className="num text-right">{info.facilities}</dd>
              <dt className="text-muted-foreground">Policy flags</dt><dd className="num text-right">{info.policy}</dd>
              {info.dollars > 0 && <><dt className="text-muted-foreground">Stated $</dt><dd className="num text-right">{fmtCompactUsd(info.dollars)}</dd></>}
            </dl>
            <p className="mt-1.5 truncate text-muted-foreground">{info.companies.slice(0, 8).join(" · ")}</p>
            <p className="mt-1 text-[10.5px] text-muted-foreground">Click to run a region shock</p>
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.slice(0, 10).map((r) => (
          <button key={r.country} type="button" onClick={() => onSelect(r.country)} className={cn("grid grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted", selected === r.country && "bg-highlight-soft")}>
            <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">{r.hotspot && <AlertTriangle className="size-3 shrink-0 text-negative" />}{r.country}<span className="truncate font-normal text-muted-foreground">{r.companies.slice(0, 3).join(" · ")}</span></span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", r.hotspot ? "bg-negative" : "bg-chart-1")} style={{ width: `${(weight(r) / max) * 100}%` }} /></span>
            <span className="num text-right text-muted-foreground">{Math.round(weight(r))}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-chart-1" /> stated tie</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-negative" /> geopolitical hotspot</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full border border-dashed border-negative" /> single-source</span>
        {scope === "focus" && <span>Arcs from the U.S.; solid = single-source</span>}
        {unmapped.length > 0 && <span className="ml-auto">Also named: {unmapped.slice(0, 6).map((u) => `${u.country} (${u.links + u.facilities + u.policy + u.hq})`).join(", ")}</span>}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- region shock

export function RegionShockPanel({ country, links, signals, revenue, names, onPick, onCountry, countries }: {
  country: string | null; links: ProLink[]; signals: SignalLite[]; revenue: Record<string, number | undefined>; names: Record<string, string>;
  onPick: (t: string) => void; onCountry: (c: string) => void; countries: string[];
}) {
  const c = country ?? "Taiwan";
  const hits = useMemo(() => regionShock(c, links, signals, revenue), [c, links, signals, revenue]);
  const max = Math.max(1, ...hits.map((h) => h.score));
  const presets = ["Taiwan", "China", "Mexico", "Israel", "South Korea", "Japan", "India", "Germany"].filter((p) => countries.includes(p));
  return (
    <Panel title={`Region shock · ${c}`} className="min-w-0" actions={<ShieldAlert className="size-4 text-negative" />}>
      <div className="mb-3 flex flex-wrap gap-1">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => onCountry(p)} className={cn("rounded-full border px-2.5 py-0.5 text-[11px]", p === c ? "border-foreground bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground")}>{p}</button>
        ))}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">If {c} is cut off — export controls, conflict, tariffs — these covered companies are exposed through their own filings. Score weights single-source ties, stated dollars vs revenue, facilities and policy flags.</p>
      {!hits.length ? <p className="text-sm text-muted-foreground">No covered company ties a link or facility to {c}.</p> : (
        <ul className="space-y-1">
          {hits.slice(0, 30).map((h) => (
            <li key={h.ticker}>
              <button type="button" onClick={() => onPick(h.ticker)} className="group grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted">
                <CompanyLogo ticker={h.ticker} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold">{h.ticker}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{names[h.ticker]}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", h.severity === "high" ? "bg-negative" : h.severity === "medium" ? "bg-warning" : "bg-foreground/40")} style={{ width: `${(h.score / max) * 100}%` }} />
                  </div>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                    {[h.singleSource && `${h.singleSource} single-source`, h.hq && `${h.hq} HQ-based counterparties`, h.links && `${h.links} stated links`, h.facilities && `${h.facilities} facilities`, h.policy && `${h.policy} policy`, h.dollars && fmtCompactUsd(h.dollars)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className={cn("num rounded px-1.5 py-0.5 text-xs font-semibold", h.severity === "high" ? "bg-negative-soft text-negative" : h.severity === "medium" ? "bg-warning-soft" : "bg-muted")}>{h.score}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- concentration history

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--negative)"];

export function ConcentrationHistory({ ticker, name }: { ticker: string; name: string }) {
  const { data, isLoading } = useQuery(supplyHistoryQuery(ticker));
  const h = useMemo(() => concentrationHistory(ticker, (data ?? []) as ProLink[]), [ticker, data]);
  return (
    <Panel title="Customer concentration history" className="min-w-0">
      {isLoading ? <Skeleton className="h-[220px] w-full" /> : h.points.length < 2 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{name}'s 10-Ks don't state a named customer's revenue share across two or more years.</p>
      ) : (
        <>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <LineChart data={h.points} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="filed" tickFormatter={(d) => String(d).slice(0, 4)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v}% of revenue`} labelFormatter={(d) => `10-K filed ${fmtDate(String(d))}`} />
                {h.series.map((s, i) => <Line key={s} dataKey={s} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={{ r: 3 }} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
            {h.series.map((s, i) => <span key={s} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: SERIES_COLORS[i] }} />{s}</span>)}
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- ecosystem basket

const WINDOWS = [{ v: 63, l: "3M" }, { v: 126, l: "6M" }, { v: 252, l: "1Y" }, { v: 750, l: "3Y" }];

export function EcosystemBasket({ ticker, name, graph, names }: { ticker: string; name: string; graph: GraphNode[]; names: Record<string, string> }) {
  const { data: rf } = useQuery(returnsQuery);
  const [win, setWin] = useState(252);
  const [side, setSide] = useState<"all" | "supplier" | "customer">("all");
  const members = useMemo(() => [...new Set(graph.filter((n) => n.ticker && n.relation !== "competitor" && (side === "all" || n.relation === side)).map((n) => n.ticker!))], [graph, side]);
  const b = useMemo(() => (rf ? ecosystemBasket(ticker, members, rf.dates, rf.returns as never, win) : null), [rf, ticker, members, win]);
  const rel = new Map(graph.map((n) => [n.ticker, n.relation]));
  return (
    <Panel
      title={`${name} ecosystem basket`}
      className="min-w-0"
      actions={
        <div className="flex gap-1.5">
          <div className="inline-flex rounded-md border p-0.5 text-[11px]">
            {(["all", "supplier", "customer"] as const).map((v) => <button key={v} type="button" onClick={() => setSide(v)} className={cn("rounded px-2 py-0.5 capitalize", side === v ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>{v === "all" ? "All" : `${v}s`}</button>)}
          </div>
          <div className="inline-flex rounded-md border p-0.5 text-[11px]">
            {WINDOWS.map((w) => <button key={w.v} type="button" onClick={() => setWin(w.v)} className={cn("rounded px-2 py-0.5", win === w.v ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>{w.l}</button>)}
          </div>
        </div>
      }
    >
      {!rf ? <Skeleton className="h-[260px] w-full" /> : !b ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No covered, listed {side === "all" ? "suppliers or customers" : `${side}s`} to build a basket from.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-2 grid grid-cols-4 gap-2">
              <Kpi label={`Basket (${b.members.length})`} v={b.basketRet} />
              <Kpi label={name} v={b.focusRet} />
              <Kpi label="S&P 500" v={b.spyRet} />
              <div className="rounded-md bg-muted/60 px-2 py-1.5"><p className="text-[10.5px] text-muted-foreground">Dispersion</p><p className="num text-sm font-semibold">{fmtPct(b.dispersion, 0)}</p></div>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer>
                <AreaChart data={b.index} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bk" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d, { month: "short", year: "2-digit" })} minTickGap={50} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => v.toFixed(1)} labelFormatter={(d) => fmtDate(String(d))} />
                  <Area dataKey="basket" name="Basket" stroke="var(--chart-1)" strokeWidth={2} fill="url(#bk)" />
                  <Area dataKey="focus" name={name} stroke="var(--foreground)" strokeWidth={1.5} fill="none" />
                  <Area dataKey="spy" name="S&P 500" stroke="var(--muted-foreground)" strokeDasharray="4 3" strokeWidth={1.2} fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="min-w-0">
            <div className="grid grid-cols-[minmax(0,1fr)_64px_48px_44px] gap-x-2 border-b pb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <span>Member</span><span className="text-right">Return</span><span className="text-right">Vol</span><span className="text-right">ρ</span>
            </div>
            <ul>
              {b.members.map((m) => {
                const maxAbs = Math.max(...b.members.map((x) => Math.abs(x.ret)), 0.01);
                return (
                  <li key={m.ticker} className="grid grid-cols-[minmax(0,1fr)_64px_48px_44px] items-center gap-x-2 border-b border-border/50 py-1 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <CompanyLogo ticker={m.ticker} size="xs" />
                      <span className="font-medium">{m.ticker}</span>
                      <span className="truncate text-[10.5px] text-muted-foreground">{rel.get(m.ticker)}</span>
                    </span>
                    <span className="relative text-right">
                      <span className={cn("absolute inset-y-0.5 right-0 rounded-sm", m.ret >= 0 ? "bg-positive/15" : "bg-negative/15")} style={{ width: `${(Math.abs(m.ret) / maxAbs) * 100}%` }} />
                      <span className={cn("num relative font-semibold", m.ret >= 0 ? "text-positive" : "text-negative")}>{fmtPct(m.ret, 0, true)}</span>
                    </span>
                    <span className="num text-right text-muted-foreground">{fmtPct(m.vol, 0)}</span>
                    <span className="num text-right">{m.corr != null ? m.corr.toFixed(2) : "—"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">Equal-weight, rebalanced daily. ρ = daily correlation with {ticker}. {names[ticker] ? "" : ""}</p>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Kpi({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-2 py-1.5">
      <p className="truncate text-[10.5px] text-muted-foreground">{label}</p>
      <p className={cn("num text-sm font-semibold", v == null ? "" : v >= 0 ? "text-positive" : "text-negative")}>{v == null ? "—" : fmtPct(v, 1, true)}</p>
    </div>
  );
}

// ---------------------------------------------------------------- freshness

export function FreshnessBadge({ filed, today }: { filed: string; today: string }) {
  const f = freshness(filed, today);
  return (
    <span title={`Last stated in a filing ${f.days} days ago`} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
      f.status === "fresh" ? "bg-positive/15 text-positive" : f.status === "aging" ? "bg-warning-soft" : "bg-negative-soft text-negative")}>
      <span className={cn("size-1.5 rounded-full", f.status === "fresh" ? "bg-positive" : f.status === "aging" ? "bg-warning" : "bg-negative")} />
      {f.status === "fresh" ? "Fresh" : f.status === "aging" ? "Aging" : "Stale"} · {f.days}d
    </span>
  );
}

export function FreshnessStrip({ links, today }: { links: ProLink[]; today: string }) {
  const counts = { fresh: 0, aging: 0, stale: 0 };
  for (const l of links) counts[freshness(l.filed, today).status]++;
  const total = Math.max(1, links.length);
  const newest = links.reduce((m, l) => (l.filed > m ? l.filed : m), "");
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">Data freshness</p>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="bg-positive" style={{ width: `${(counts.fresh / total) * 100}%` }} />
        <div className="bg-warning" style={{ width: `${(counts.aging / total) * 100}%` }} />
        <div className="bg-negative" style={{ width: `${(counts.stale / total) * 100}%` }} />
      </div>
      <p className="num mt-1 text-[10.5px] text-muted-foreground">{counts.fresh} fresh · {counts.aging} aging · {counts.stale} stale{newest && ` · newest ${fmtDate(newest)}`}</p>
    </div>
  );
}

// ---------------------------------------------------------------- deep verify

const VERDICT = {
  confirmed: { label: "Confirmed by independent sources", icon: CheckCheck, cls: "bg-positive/15 text-positive" },
  partly: { label: "Partly confirmed", icon: CircleHelp, cls: "bg-warning-soft" },
  unconfirmed: { label: "Not independently confirmed", icon: CircleHelp, cls: "bg-muted text-muted-foreground" },
  contradicted: { label: "Contradicted by newer sources", icon: XCircle, cls: "bg-negative-soft text-negative" },
} as const;

/** Runs a multi-search web cross-check of one link; results are cached and shared. */
export function DeepVerify({ linkId }: { linkId: string }) {
  const run = useServerFn(verifySupplyLink);
  const [go, setGo] = useState(false);
  const q = useQuery({ queryKey: ["supply-verify", linkId], queryFn: () => run({ data: { id: linkId } }), enabled: go, staleTime: Infinity, retry: false });
  if (!go) {
    return (
      <button type="button" onClick={() => setGo(true)} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium hover:bg-muted">
        <Microscope className="size-3" /> Cross-check on the web
      </button>
    );
  }
  if (q.isLoading) return <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Searching, reading pages and checking every quote…</p>;
  const r = q.data as (VerifyResult & { cachedAt?: string }) | undefined;
  if (!r || r.error) return <p className="text-xs text-negative">{r?.error ?? (q.error as Error)?.message ?? "Check failed"}</p>;
  const v = VERDICT[r.verdict];
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
      <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold", v.cls)}><v.icon className="size-3" />{v.label}</span>
      {r.summary && <p className="text-xs">{r.summary}</p>}
      {r.facts.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs">
          {r.facts.map((f, i) => <li key={i}>{f.text} <span className="text-[10px] text-muted-foreground">[{f.evidenceIds.map((x) => x.slice(1)).join(",")}]</span></li>)}
        </ul>
      )}
      <ul className="space-y-1.5">
        {r.evidence.slice(0, 8).map((e) => (
          <li key={e.id} className="text-[11px]">
            <span className={cn("mr-1 rounded px-1 text-[9.5px] font-semibold uppercase", e.stance === "supports" ? "bg-positive/15 text-positive" : e.stance === "contradicts" ? "bg-negative-soft text-negative" : "bg-muted text-muted-foreground")}>{e.id.slice(1)} · {e.stance}</span>
            <span className="italic text-muted-foreground">“{e.quote}”</span>{" "}
            <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">{new URL(e.url).hostname.replace(/^www\./, "")}{e.publishedAt && `, ${e.publishedAt.slice(0, 10)}`}<ExternalLink className="size-2.5" /></a>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">{r.searched} results searched · {r.read} pages read · only sentences naming both companies kept{r.cachedAt && ` · checked ${fmtDate(r.cachedAt)}`}</p>
    </div>
  );
}

// ---------------------------------------------------------------- fragility table (restyled)

export function FragilityTable({ tickers, all, names, onPick, current }: { tickers: string[]; all: ProLink[]; names: Record<string, string>; onPick: (t: string) => void; current: string }) {
  const rows = useMemo(() => tickers.map((t) => ({ t, d: dependencyScore(t, all) })).filter((r) => r.d.score > 0).sort((a, b) => b.d.score - a.d.score), [tickers, all]);
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => !q || r.t.includes(q.toUpperCase()) || (names[r.t] ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title="Supply-chain fragility across coverage" className="min-w-0" actions={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-7 w-32 rounded-md border bg-background px-2 text-xs" />}>
      <div className="max-h-[420px] overflow-auto scrollbar-thin">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10 bg-card text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="border-b py-2 pl-1 font-medium">#</th>
              <th className="border-b font-medium">Company</th>
              <th className="w-[34%] border-b font-medium">Fragility (concentration · single-source · geography)</th>
              <th className="border-b text-right font-medium">Top cust.</th>
              <th className="border-b text-right font-medium">Single-src</th>
              <th className="border-b pr-1 text-right font-medium">Hotspots</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ t, d }, i) => (
              <tr key={t} onClick={() => onPick(t)} className={cn("group cursor-pointer", t === current ? "bg-highlight-soft" : i % 2 ? "bg-muted/25" : "", "hover:bg-muted")}>
                <td className="num py-1.5 pl-1 text-muted-foreground">{rows.indexOf(rows.find((r) => r.t === t)!) + 1}</td>
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <CompanyLogo ticker={t} size="xs" />
                    <span className="font-semibold">{t}</span>
                    <span className="truncate text-muted-foreground">{names[t]}</span>
                  </span>
                </td>
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="bg-chart-1" style={{ width: `${d.parts[0].points}%` }} />
                      <div className="bg-negative" style={{ width: `${d.parts[1].points}%` }} />
                      <div className="bg-warning" style={{ width: `${d.parts[2].points}%` }} />
                    </div>
                    <span className={cn("num w-7 text-right font-semibold", d.score >= 50 ? "text-negative" : "")}>{d.score}</span>
                  </div>
                </td>
                <td className="num text-right">{d.topCustomerPct ? `${d.topCustomerPct}%` : <span className="text-muted-foreground">—</span>}</td>
                <td className="num text-right">{d.singleSource || <span className="text-muted-foreground">—</span>}</td>
                <td className="pr-1 text-right">
                  {d.hotspots.length ? <span className="inline-flex flex-wrap justify-end gap-0.5">{d.hotspots.slice(0, 2).map((h) => <span key={h} className="rounded bg-negative-soft px-1 text-[10px] text-negative">{h}</span>)}</span> : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex gap-4 text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-chart-1" />Customer concentration (max 40)</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-negative" />Single-source (30)</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-warning" />Geopolitical (30)</span>
      </div>
    </Panel>
  );
}
