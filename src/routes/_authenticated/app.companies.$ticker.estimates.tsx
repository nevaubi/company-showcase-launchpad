import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "@/components/app/page-header";
import { FirmLogo } from "@/components/estimates/firm-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { coverageOf } from "@/lib/coverage";
import { getEstimates } from "@/lib/estimates.functions";
import {
  PERIOD_LABEL, actionKind, actionSummary, beatStats, latestTargets, positionIn, ratingLabel, revisionPct,
  type AnalystAction, type Estimates, type PeriodEstimate, type Range,
} from "@/lib/estimates/core";
import { fmtCompactUsd, fmtDate, fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/estimates")({
  head: ({ params }) => {
    const t = params.ticker.toUpperCase();
    const name = coverageOf(t)?.shortName ?? t;
    return {
      meta: [
        { title: `${name} (${t}) analyst estimates, revisions & price targets — Filed Under` },
        { name: "description", content: `Consensus EPS and revenue for ${name}, estimate revisions, earnings surprises, analyst ratings, price targets and every upgrade and downgrade.` },
        { property: "og:title", content: `${name} analyst estimates & revisions — Filed Under` },
        { property: "og:description", content: `Consensus, revisions, surprises, ratings and price targets for ${name}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: EstimatesPage,
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const eps = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);

function SourceNote({ asOf }: { asOf: string }) {
  return (
    <Popover>
      <PopoverTrigger aria-label="About this data" className="inline-flex size-6 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground">
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs leading-relaxed">
        <p className="font-medium text-foreground">Third-party consensus data</p>
        <p className="mt-1 text-muted-foreground">
          Estimates, ratings and price targets are compiled from sell-side analysts by a market-data provider. They are not from company filings, so they have no filing link. Updated {fmtRelative(asOf)}; refreshed every few hours.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function EstimatesPage() {
  const ticker = Route.useParams().ticker.toUpperCase();
  const fn = useServerFn(getEstimates);
  const q = useQuery({ queryKey: ["estimates", ticker], queryFn: () => fn({ data: { ticker } }), staleTime: 3600_000, retry: 1 });
  if (q.isLoading) return <div className="grid grid-cols-1 gap-4"><Skeleton className="h-40" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>;
  const e = q.data?.estimates;
  if (!e) return <Panel title="Estimates & analysts"><p className="p-4 text-sm text-muted-foreground">{q.data?.error ?? "Estimates are temporarily unavailable."} Try again in a few minutes.</p></Panel>;
  return (
    <div className="grid grid-cols-1 gap-4">
      <Summary e={e} />
      <EstimateTable e={e} />
      <Revisions e={e} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <SurprisePanel e={e} />
        <RatingsPanel e={e} />
        <TargetsPanel e={e} />
      </div>
      <ActionsPanel e={e} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-mono text-lg tabular-nums", tone === "up" && "text-primary", tone === "down" && "text-destructive")}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Summary({ e }: { e: Estimates }) {
  const s = actionSummary(e.actions, daysAgo(90));
  const upside = e.price && e.target.mean ? e.target.mean / e.price - 1 : null;
  const q0 = e.periods.find((p) => p.code === "0q");
  const y0 = e.periods.find((p) => p.code === "0y");
  const rev90 = revisionPct(y0?.trend.current ?? null, y0?.trend.d90 ?? null);
  const beats = beatStats(e.surprises);
  return (
    <Panel title="Street view" subtitle={`Consensus of ${e.target.analysts ?? "—"} analysts · updated ${fmtRelative(e.asOf)}`} actions={<SourceNote asOf={e.asOf} />}>
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Rating" value={ratingLabel(e.rating.mean)} sub={e.rating.mean != null ? `${e.rating.mean.toFixed(2)} on 1 (strong buy)–5 scale` : undefined} />
        <Stat label="Avg target" value={fmtPrice(e.target.mean)} sub={upside != null ? `${fmtPct(upside, 1, true)} vs ${fmtPrice(e.price)}` : undefined} tone={upside == null ? undefined : upside >= 0 ? "up" : "down"} />
        <Stat label={`${q0 ? "Qtr" : "Next"} EPS est.`} value={eps(q0?.eps.avg ?? null)} sub={q0?.endDate ? `Quarter ending ${fmtDate(q0.endDate)}` : undefined} />
        <Stat label="FY EPS 90-day revision" value={rev90 == null ? "—" : fmtPct(rev90, 1, true)} sub={y0?.endDate ? `FY ending ${fmtDate(y0.endDate)}` : undefined} tone={rev90 == null || Math.abs(rev90) < 0.001 ? undefined : rev90 > 0 ? "up" : "down"} />
        <Stat label="Last 90 days" value={`${s.upgrades}↑ ${s.downgrades}↓`} sub={`${s.targetRaises} target raises · ${s.targetCuts} cuts`} />
        <Stat label="Beat rate" value={beats ? `${beats.beats}/${beats.n}` : "—"} sub={beats?.avgSurprise != null ? `Avg EPS surprise ${fmtPct(beats.avgSurprise, 1, true)}` : undefined} />
      </div>
      {e.actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">Latest calls</span>
          {e.actions.slice(0, 8).map((a, i) => {
            const k = actionKind(a);
            return (
              <span key={i} title={`${fmtDate(a.date)} · ${a.firm}: ${a.toGrade}${a.target ? `, target ${fmtPrice(a.target)}` : ""}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2 text-xs">
                <FirmLogo firm={a.firm} className="rounded-full" />
                <span className="max-w-[9rem] truncate">{a.firm}</span>
                <span className={cn("font-mono", k === "upgrade" ? "text-primary" : k === "downgrade" ? "text-destructive" : "text-muted-foreground")}>{a.toGrade}{a.target ? ` ${fmtPrice(a.target)}` : ""}</span>
              </span>
            );
          })}
        </div>
      )}
      {e.nextEarnings?.start && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Next report expected {fmtDate(e.nextEarnings.start)}{e.nextEarnings.end && e.nextEarnings.end !== e.nextEarnings.start ? `–${fmtDate(e.nextEarnings.end)}` : ""}
          {e.nextEarnings.epsAvg != null && ` · EPS est. ${eps(e.nextEarnings.epsAvg)}`}
          {e.nextEarnings.revenueAvg != null && ` · revenue est. ${fmtCompactUsd(e.nextEarnings.revenueAvg)}`}
        </p>
      )}
    </Panel>
  );
}

function RangeBar({ r, fmt }: { r: Range; fmt: (v: number | null) => string }) {
  const p = positionIn(r.avg, r.low, r.high);
  return (
    <div className="min-w-[9rem]">
      <div className="flex items-baseline justify-between gap-2"><span className="font-mono tabular-nums">{fmt(r.avg)}</span><span className="text-[11px] text-muted-foreground">{r.analysts ?? "—"} ests</span></div>
      <div className="relative mt-1 h-1.5 rounded-full bg-muted">
        {p != null && <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: `${p * 100}%` }} />}
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted-foreground"><span>{fmt(r.low)}</span><span>{fmt(r.high)}</span></div>
    </div>
  );
}

function Growth({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("font-mono tabular-nums", v > 0 ? "text-primary" : v < 0 ? "text-destructive" : "")}>{fmtPct(v, 1, true)}</span>;
}

function EstimateTable({ e }: { e: Estimates }) {
  return (
    <Panel title="Consensus estimates" subtitle="Average, low and high analyst forecasts; growth is versus the same period a year earlier." actions={<SourceNote asOf={e.asOf} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Period</th>
              <th className="px-3 py-2 font-medium">EPS (low–high)</th>
              <th className="px-3 py-2 font-medium">Yr-ago EPS</th>
              <th className="px-3 py-2 font-medium">EPS growth</th>
              <th className="px-3 py-2 font-medium">Revenue (low–high)</th>
              <th className="px-3 py-2 font-medium">Yr-ago revenue</th>
              <th className="px-4 py-2 font-medium">Rev. growth</th>
            </tr>
          </thead>
          <tbody>
            {e.periods.map((p) => (
              <tr key={p.code} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-3"><div className="font-medium">{PERIOD_LABEL[p.code]}</div><div className="text-[11px] text-muted-foreground">{p.endDate ? `ending ${fmtDate(p.endDate)}` : ""}</div></td>
                <td className="px-3 py-3"><RangeBar r={p.eps} fmt={eps} /></td>
                <td className="px-3 py-3 font-mono tabular-nums">{eps(p.eps.yearAgo)}</td>
                <td className="px-3 py-3"><Growth v={p.eps.growth} /></td>
                <td className="px-3 py-3"><RangeBar r={p.revenue} fmt={(v) => fmtCompactUsd(v)} /></td>
                <td className="px-3 py-3 font-mono tabular-nums">{fmtCompactUsd(p.revenue.yearAgo)}</td>
                <td className="px-4 py-3"><Growth v={p.revenue.growth} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Arrow({ v }: { v: number | null }) {
  if (v == null || Math.abs(v) < 0.0005) return <Minus className="size-3 text-muted-foreground" />;
  return v > 0 ? <ArrowUpRight className="size-3 text-primary" /> : <ArrowDownRight className="size-3 text-destructive" />;
}

function Revisions({ e }: { e: Estimates }) {
  const cols: [keyof PeriodEstimate["trend"], string][] = [["d90", "90d ago"], ["d60", "60d"], ["d30", "30d"], ["d7", "7d"], ["current", "Now"]];
  return (
    <Panel title="Estimate revisions" subtitle="How consensus EPS moved, and how many analysts raised or cut." actions={<SourceNote asOf={e.asOf} />} className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Period</th>
              {cols.map(([, l]) => <th key={l} className="px-2 py-2 text-right font-medium">{l}</th>)}
              <th className="px-2 py-2 text-right font-medium">90d Δ</th>
              <th className="px-4 py-2 text-right font-medium">Up / down 30d</th>
            </tr>
          </thead>
          <tbody>
            {e.periods.map((p) => {
              const d = revisionPct(p.trend.current, p.trend.d90);
              return (
                <tr key={p.code} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 text-xs font-medium">{PERIOD_LABEL[p.code]}</td>
                  {cols.map(([k]) => <td key={k} className={cn("px-2 py-2.5 text-right font-mono tabular-nums", k === "current" && "font-semibold")}>{eps(p.trend[k])}</td>)}
                  <td className="px-2 py-2.5 text-right"><span className="inline-flex items-center gap-0.5 font-mono tabular-nums"><Arrow v={d} />{d == null ? "—" : fmtPct(d, 1, true)}</span></td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums"><span className="text-primary">{p.revisions.up30 ?? 0}</span> / <span className="text-destructive">{p.revisions.down30 ?? 0}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SurprisePanel({ e }: { e: Estimates }) {
  const data = e.surprises.map((s) => ({ q: fmtDate(s.quarter, { month: "short", year: "2-digit" }), actual: s.actual, estimate: s.estimate, pct: s.surprisePct }));
  return (
    <Panel title="Earnings surprises" subtitle="Reported EPS against the consensus going into each report." actions={<SourceNote asOf={e.asOf} />} className="min-w-0">
      {data.length ? (
        <div className="p-4">
          <div className="h-48">
            <ResponsiveContainer>
              <ComposedChart data={data}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="q" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: number, n) => [eps(v), n === "actual" ? "Reported" : "Consensus"]} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Line dataKey="estimate" stroke="var(--muted-foreground)" strokeDasharray="4 3" dot={{ r: 3 }} />
                <Scatter dataKey="actual" fill="var(--primary)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {e.surprises.map((s) => (
              <div key={s.quarter} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                <div className="text-muted-foreground">Qtr ending {fmtDate(s.quarter, { month: "short", year: "numeric" })}</div>
                <div className="font-mono tabular-nums">{eps(s.actual)} vs {eps(s.estimate)}</div>
                <div className={cn("font-mono tabular-nums", (s.surprisePct ?? 0) >= 0 ? "text-primary" : "text-destructive")}>{s.surprisePct == null ? "—" : fmtPct(s.surprisePct, 1, true)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="p-4 text-sm text-muted-foreground">No surprise history.</p>}
    </Panel>
  );
}

const RATING_KEYS = [
  ["strongBuy", "Strong buy", "var(--primary)"], ["buy", "Buy", "color-mix(in oklab, var(--primary) 55%, transparent)"],
  ["hold", "Hold", "var(--muted-foreground)"], ["sell", "Sell", "color-mix(in oklab, var(--destructive) 55%, transparent)"], ["strongSell", "Strong sell", "var(--destructive)"],
] as const;

function RatingsPanel({ e }: { e: Estimates }) {
  const label = (p: string) => (p === "0m" ? "This month" : `${p.replace("-", "").replace("m", "")} mo ago`);
  const data = [...e.ratings].reverse().map((r) => ({ ...r, label: label(r.period) }));
  const now = e.ratings.find((r) => r.period === "0m");
  const total = now ? now.strongBuy + now.buy + now.hold + now.sell + now.strongSell : 0;
  return (
    <Panel title="Analyst ratings" subtitle="Number of analysts at each rating, last four months." actions={<SourceNote asOf={e.asOf} />} className="min-w-0">
      <div className="p-4">
        {now && total > 0 && (
          <div className="mb-3">
            <div className="flex h-3 overflow-hidden rounded-full">
              {RATING_KEYS.map(([k, , c]) => <span key={k} style={{ width: `${(now[k] / total) * 100}%`, background: c }} />)}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              {RATING_KEYS.map(([k, l, c]) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: c }} />{l} {now[k]}</span>)}
            </div>
          </div>
        )}
        <div className="h-44">
          <ResponsiveContainer>
            <BarChart data={data}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
              {RATING_KEYS.map(([k, l, c]) => <Bar key={k} dataKey={k} name={l} stackId="r" fill={c} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  );
}

function TargetsPanel({ e }: { e: Estimates }) {
  const firms = latestTargets(e.actions, daysAgo(365));
  const lo = Math.min(e.target.low ?? Infinity, e.price ?? Infinity, ...firms.map((f) => f.target!));
  const hi = Math.max(e.target.high ?? -Infinity, e.price ?? -Infinity, ...firms.map((f) => f.target!));
  const pos = (v: number | null) => (v == null || !Number.isFinite(lo) || hi <= lo ? null : ((v - lo) / (hi - lo)) * 100);
  return (
    <Panel title="Price targets" subtitle="Consensus range, plus each firm's latest target from the past year." actions={<SourceNote asOf={e.asOf} />} className="min-w-0">
      <div className="p-4">
        <div className="relative mx-2 mb-8 mt-6 h-2 rounded-full bg-muted">
          {pos(e.target.low) != null && pos(e.target.high) != null && <span className="absolute h-2 rounded-full bg-primary/25" style={{ left: `${pos(e.target.low)}%`, width: `${pos(e.target.high)! - pos(e.target.low)!}%` }} />}
          {[["Price", e.price, "bg-foreground"], ["Avg", e.target.mean, "bg-primary"]].map(([l, v, c]) => pos(v as number) != null && (
            <span key={l as string} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(v as number)}%` }}>
              <span className={cn("block size-3.5 rounded-full border-2 border-background", c as string)} />
              <span className={cn("absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px]", l === "Price" ? "-top-5" : "top-4")}>{l} {fmtPrice(v as number)}</span>
            </span>
          ))}
        </div>
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>Low {fmtPrice(e.target.low)}</span><span>Median {fmtPrice(e.target.median)}</span><span>High {fmtPrice(e.target.high)}</span></div>
        <div className="mt-3 divide-y divide-border/60">
          {firms.map((f) => {
            const up = e.price ? f.target! / e.price - 1 : null;
            return (
              <div key={f.firm} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span className="flex min-w-0 items-center gap-2"><FirmLogo firm={f.firm} /><span className="truncate">{f.firm}</span><span className="ml-1.5 text-muted-foreground">{fmtDate(f.date, { month: "short", day: "numeric" })}</span></span>
                <span className="flex shrink-0 items-center gap-3 font-mono tabular-nums">
                  <span>{fmtPrice(f.target)}</span>
                  <span className={cn("w-14 text-right", (up ?? 0) >= 0 ? "text-primary" : "text-destructive")}>{up == null ? "" : fmtPct(up, 0, true)}</span>
                </span>
              </div>
            );
          })}
          {!firms.length && <p className="py-2 text-xs text-muted-foreground">No firm-level targets in the past year.</p>}
        </div>
      </div>
    </Panel>
  );
}

const KIND_STYLE: Record<string, string> = {
  upgrade: "border-primary/40 bg-primary/10 text-primary",
  downgrade: "border-destructive/40 bg-destructive/10 text-destructive",
  initiate: "border-border bg-muted text-foreground",
  reiterate: "border-border text-muted-foreground",
  other: "border-border text-muted-foreground",
};
const KIND_LABEL: Record<string, string> = { upgrade: "Upgrade", downgrade: "Downgrade", initiate: "Initiated", reiterate: "Reiterated", other: "Update" };

function ActionsPanel({ e }: { e: Estimates }) {
  const [kind, setKind] = useState<string>("all");
  const [win, setWin] = useState(365);
  const rows = useMemo(() => e.actions.filter((a) => a.date >= daysAgo(win) && (kind === "all" || actionKind(a) === kind || (kind === "target" && a.target != null && a.priorTarget != null && a.target !== a.priorTarget))), [e.actions, kind, win]);
  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground");
  return (
    <Panel title="Upgrades, downgrades & target changes" subtitle={`${rows.length} analyst actions`} actions={<SourceNote asOf={e.asOf} />}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
        {[["all", "All"], ["upgrade", "Upgrades"], ["downgrade", "Downgrades"], ["initiate", "Initiations"], ["target", "Target moves"]].map(([k, l]) => (
          <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>{l}</button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {[[90, "90d"], [365, "1y"], [1095, "3y"], [99999, "All time"]].map(([d, l]) => (
          <button key={d} type="button" className={chip(win === d)} onClick={() => setWin(d as number)}>{l}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-card text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Firm</th><th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Rating</th><th className="px-4 py-2 text-right font-medium">Price target</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((a, i) => <ActionRow key={`${a.date}${a.firm}${i}`} a={a} />)}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-muted-foreground">No actions in this window.</p>}
      </div>
    </Panel>
  );
}

function ActionRow({ a }: { a: AnalystAction }) {
  const k = actionKind(a);
  const move = a.target != null && a.priorTarget != null ? a.target / a.priorTarget - 1 : null;
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{fmtDate(a.date)}</td>
      <td className="px-3 py-2"><span className="flex items-center gap-2"><FirmLogo firm={a.firm} />{a.firm}</span></td>
      <td className="px-3 py-2"><span className={cn("rounded border px-1.5 py-0.5 text-[11px]", KIND_STYLE[k])}>{KIND_LABEL[k]}</span></td>
      <td className="px-3 py-2 text-xs">{a.fromGrade && a.fromGrade !== a.toGrade ? <><span className="text-muted-foreground">{a.fromGrade} → </span>{a.toGrade}</> : a.toGrade || "—"}</td>
      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
        {a.target == null ? "—" : (
          <>
            {a.priorTarget != null && a.priorTarget !== a.target && <span className="text-muted-foreground">{fmtPrice(a.priorTarget)} → </span>}
            {fmtPrice(a.target)}
            {move != null && Math.abs(move) > 0.0005 && <span className={cn("ml-1.5", move > 0 ? "text-primary" : "text-destructive")}>{fmtPct(move, 0, true)}</span>}
          </>
        )}
      </td>
    </tr>
  );
}
