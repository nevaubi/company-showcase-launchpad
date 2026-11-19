import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Bot, Check, ChevronRight, ExternalLink, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, Stat } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtInt, fmtPct, fmtPrice, toneClass, toneOf } from "@/lib/format";
import { REGIMES } from "@/lib/signals/backtest";
import { FAMILY_LABEL, STRATEGY, type Family } from "@/lib/signals/strategies";
import { gateChecks, type PairSetup, type Setup, type SetupsFile, type VariantMeta } from "@/lib/signals/setups";
import { setupsQuery } from "@/lib/signals/queries";
import { optionsLatestQuery } from "@/lib/options/data";
import { impliedMoveBy } from "@/lib/options/core";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/setups")({
  head: () => ({
    meta: [
      { title: "Short-term setups — Filed Under" },
      { name: "description", content: "Published short-term strategies — overreaction, momentum, earnings drift, insider buying, short-selling flow, supply-chain links and pairs — re-tested nightly across 1,800+ US stocks after costs." },
      { property: "og:title", content: "Short-term setups — Filed Under" },
      { property: "og:description", content: "Short-term strategies re-tested every night with strict out-of-sample proof, plus paper autopilots that trade them." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupsPage,
});

const sideLabel = (s: 1 | -1) => (s > 0 ? "Long" : "Short");
const holdLabel = (h: number) => (h === 1 ? "1 day" : h >= 20 ? `${Math.round(h / 5)} weeks` : `${h} days`);
const FAMILIES: Family[] = ["reversal", "momentum", "events", "links", "multi"];

function Spark({ values, className, bands }: { values: number[]; className?: string; bands?: number }) {
  const w = 120, h = 32;
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const lo = Math.min(...vs, ...(bands ? [-bands - 0.5] : []));
  const hi = Math.max(...vs, ...(bands ? [bands + 0.5] : []));
  const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h;
  const d = vs.map((v, i) => `${i ? "L" : "M"}${((i / (vs.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-28", className)} preserveAspectRatio="none" aria-hidden>
      {bands != null && [bands, 0, -bands].map((b) => <line key={b} x1={0} x2={w} y1={y(b)} y2={y(b)} className="stroke-border" strokeDasharray={b ? "3 3" : undefined} strokeWidth={1} />)}
      <path d={d} fill="none" className="stroke-foreground" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Curve({ v, oosStart }: { v: VariantMeta; oosStart: string }) {
  const pts = v.curve;
  if (pts.length < 2) return <p className="py-6 text-xs text-muted-foreground">Not enough trades for a curve yet.</p>;
  const w = 600, h = 120;
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (z: number) => h - ((z - lo) / (hi - lo || 1)) * h;
  const split = pts.findIndex((p) => p[0] >= oosStart.slice(0, 7));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full" preserveAspectRatio="none" role="img" aria-label="Cumulative average return per trade by month">
      {split > 0 && <rect x={x(split)} y={0} width={w - x(split)} height={h} className="fill-muted/60" />}
      <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[1])}`).join("")} fill="none" className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SetupsPage() {
  const { data, isLoading, error } = useQuery(setupsQuery);
  if (error) return <p className="text-sm text-muted-foreground">Setups could not load: {(error as Error).message}</p>;
  if (isLoading || !data) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  const passed = data.variants.filter((v) => v.passed);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Signals"
        title="Short-term setups"
        description={`${data.variants.length} versions of published strategies, re-tested every night over ${fmtInt(data.companies)} stocks. Each is judged only on trades after ${fmtDate(data.oosStart)} it was never tuned on, after trading and borrowing costs. Only strategies that pass all eight checks produce setups. Not investment advice.`}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              Closing prices {fmtDate(data.asOf)} · {data.source === "daily" ? "refreshed nightly" : "full history run"}
            </span>
            <Button asChild size="sm" variant="outline" className="h-7">
              <Link to="/app/autopilots"><Bot className="mr-1 h-3.5 w-3.5" /> Autopilots</Link>
            </Button>
          </div>
        }
      />
      <MarketStrip data={data} passed={passed.length} />
      <SetupsPanel data={data} passed={passed.length} />
      <PairsPanel pairs={data.pairs} proven={data.pairsProven} />
      <ProofPanel data={data} />
      <MethodPanel data={data} />
    </div>
  );
}

function MarketStrip({ data, passed }: { data: SetupsFile; passed: number }) {
  const m = data.market;
  const term = m?.vixRatio == null ? null : m.vixRatio >= 1 ? "inverted (stress)" : m.vixRatio >= 0.95 ? "flat" : "normal";
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3 lg:grid-cols-6" data-section="Market context">
      <Stat label="Market regime" value={data.regime} sub="S&P 500 vs 200-day · VIX vs 20" className="border-0" />
      <Stat label="VIX" value={m?.vix?.toFixed(1) ?? "—"} sub={m?.vix3m ? `3-month ${m.vix3m.toFixed(1)} · ${term}` : "Cboe"} tone={m?.vixRatio != null && m.vixRatio >= 1 ? "negative" : "neutral"} className="border-0" />
      <Stat label="Above 200-day average" value={fmtPct(m?.breadth200, 0)} sub="share of covered stocks" className="border-0" />
      <Stat label="Near 52-week high" value={fmtPct(m?.nearHighs, 0)} sub="within 2%" className="border-0" />
      <Stat label="Volume sold short" value={fmtPct(m?.shortRatio, 0)} sub="median, last 5 days (FINRA)" className="border-0" />
      <Stat label="Strategies passing" value={`${passed} of ${data.variants.length}`} sub={`${data.setups.filter((s) => s.proven).length} proven setups today`} tone={passed ? "positive" : "neutral"} className="border-0" />
    </div>
  );
}

function SetupsPanel({ data, passed }: { data: SetupsFile; passed: number }) {
  const [watch, setWatch] = useState(passed === 0);
  const [family, setFamily] = useState<"all" | Family>("all");
  const qc = useQueryClient();
  const rows = useMemo(() => data.setups.filter((s) => (watch || s.proven) && (family === "all" || (s.family ?? STRATEGY[s.strategy]?.family) === family)), [data, watch, family]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of data.setups) if (watch || s.proven) c.set(s.family ?? STRATEGY[s.strategy]?.family, (c.get(s.family ?? STRATEGY[s.strategy]?.family) ?? 0) + 1);
    return c;
  }, [data, watch]);

  const opts = useQuery(optionsLatestQuery(rows.map((s) => s.ticker)));
  const track = useMutation({
    mutationFn: async (s: Setup) => {
      const { error } = await supabase.from("paper_trades").insert({ ticker: s.ticker, direction: s.side > 0 ? "long" : "short", entry_price: s.price, stop: s.stop, target: s.target, signals: [s.key] });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Added to your paper trades");
      qc.invalidateQueries({ queryKey: ["paper_trades"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Panel
      title="Today's setups"
      subtitle={watch ? "Including watch-only near misses: positive out of sample (t ≥ 1.5) but not proven" : "Only strategies that passed every check and have worked in today's market regime"}
      actions={
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={watch} onCheckedChange={setWatch} aria-label="Show watch-only near misses" />
          Watch-only
        </label>
      }
      collapse={false}
    >
      <div data-section="Today's setups">
        <ToggleGroup type="single" value={family} onValueChange={(v) => v && setFamily(v as typeof family)} className="mb-3 flex flex-wrap justify-start gap-1" aria-label="Strategy family">
          <ToggleGroupItem value="all" size="sm" className="h-7 px-2.5 text-xs">All {counts.size ? <span className="ml-1 text-muted-foreground">{[...counts.values()].reduce((a, b) => a + b, 0)}</span> : null}</ToggleGroupItem>
          {FAMILIES.map((f) => (
            <ToggleGroupItem key={f} value={f} size="sm" className="h-7 px-2.5 text-xs">
              {FAMILY_LABEL[f]} {counts.get(f) ? <span className="ml-1 text-muted-foreground">{counts.get(f)}</span> : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {!rows.length ? (
          <div className="py-4 text-sm text-muted-foreground">
            {passed === 0 && !watch ? (
              <>
                <p className="font-medium text-foreground">No strategy passes the strict checks right now.</p>
                <p className="mt-1 max-w-2xl">After costs, none of these published strategies has beaten its sector reliably since {data.oosStart.slice(0, 4)} on every check. Turn on watch-only to see the closest candidates, and see the scoreboard below for why each one falls short.</p>
              </>
            ) : (
              <p>No {family === "all" ? "" : FAMILY_LABEL[family].toLowerCase() + " "}setups fired in the last three trading days.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-normal">Stock</th>
                  <th className="pr-3 font-normal">Setup</th>
                  <th className="pr-3 font-normal">Hold</th>
                  <th className="pr-3 font-normal">Last 60 days</th>
                  <th className="pr-3 text-right font-normal">Price · stop / target</th>
                  <th className="pr-3 text-right font-normal">Edge*</th>
                  <th className="pr-3 text-right font-normal" title="The move the options market prices over the holding period: at-the-money straddle to the first expiry after it ÷ price (Cboe, last close)">Options price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={`${s.ticker}:${s.key}`} className="border-t align-middle">
                    <td className="py-2 pr-3">
                      <Link to="/app/companies/$ticker" params={{ ticker: s.ticker }} className="flex items-center gap-2">
                        <CompanyLogo ticker={s.ticker} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-medium">{s.ticker}</span>
                          <span className="block max-w-[10rem] truncate text-[11px] text-muted-foreground">{s.name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="pr-3">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", s.side > 0 ? "text-positive" : "text-negative")}>
                          {s.side > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                          {sideLabel(s.side)}
                        </span>
                        <span>{STRATEGY[s.strategy]?.label ?? s.strategy}</span>
                        {!s.proven && <span className="rounded border px-1 text-[10px] leading-4 text-muted-foreground">watch</span>}
                      </div>
                      <div className="max-w-[17rem] truncate text-xs text-muted-foreground" title={`${s.detail} · signal ${fmtDate(s.firedAt)}`}>
                        {s.detail} · signal {fmtDate(s.firedAt)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap pr-3 text-xs">{holdLabel(s.horizon)}</td>
                    <td className="pr-3"><Spark values={s.spark} /></td>
                    <td className="whitespace-nowrap pr-3 text-right tabular-nums">
                      <div>{fmtPrice(s.price)}</div>
                      <div className="text-[11px] text-muted-foreground">{fmtPrice(s.stop)} / {fmtPrice(s.target)}</div>
                    </td>
                    <td className={cn("pr-3 text-right tabular-nums", toneClass[toneOf(s.edge)])}>{fmtPct(s.edge, 2, true)}</td>
                    <td className="whitespace-nowrap pr-3 text-right tabular-nums">
                      {(() => {
                        const o = opts.data?.get(s.ticker);
                        const p = o ? impliedMoveBy(o.term, Math.ceil((s.horizon * 7) / 5)) : null;
                        if (!o || !p) return <span className="text-muted-foreground">—</span>;
                        const toTarget = Math.abs(s.target - s.price) / s.price;
                        return (
                          <span title={`±${fmtPct(p.m, 1)} priced through the ${fmtDate(p.e)} expiry; the target is ${fmtPct(toTarget, 1)} away (${(toTarget / p.m).toFixed(1)}× the priced move). IV30 ${fmtPct(o.iv30, 1)}.`}>
                            <span className="block">±{fmtPct(p.m, 1)}</span>
                            <span className="block text-[11px] text-muted-foreground">target {(toTarget / p.m).toFixed(1)}×</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => track.mutate(s)} disabled={track.isPending}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Paper trade
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">*Average return per trade against the sector after costs, out of sample and in today's market regime, scaled down for small samples. Options price: the move the options market expects over the hold (context only — options history is too short to test yet). Stop is 2× the 14-day average daily range (2.5× for momentum, event and supply-chain trades); target is 1.5× (2×) that risk.</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function PairsPanel({ pairs, proven }: { pairs: PairSetup[]; proven: boolean }) {
  return (
    <Panel
      title="Pairs stretched apart"
      subtitle={proven ? "Cointegrated same-sector pairs now beyond 2 standard deviations" : "Watch-only: the pairs strategy has not passed the strict checks, so these are not setups"}
      collapse={false}
    >
      {!pairs.length ? (
        <p className="py-2 text-sm text-muted-foreground">No cointegrated pair is stretched beyond 2 standard deviations today.</p>
      ) : (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-2 xl:grid-cols-3">
          {pairs.map((p) => (
            <div key={`${p.a}:${p.b}`} className="min-w-0 bg-card p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-1.5 font-medium">
                  <Link to="/app/companies/$ticker" params={{ ticker: p.a }}>{p.a}</Link>
                  <span className="text-muted-foreground">vs</span>
                  <Link to="/app/companies/$ticker" params={{ ticker: p.b }}>{p.b}</Link>
                </div>
                <span className="text-xs font-semibold tabular-nums">z {p.z > 0 ? "+" : ""}{p.z.toFixed(2)}</span>
              </div>
              <Spark values={p.zs} bands={2} className="mt-2 h-10 w-full" />
              <div className="mt-1 text-xs text-muted-foreground">
                {p.side > 0 ? `${p.a} cheap vs ${p.b}` : `${p.a} rich vs ${p.b}`} · half-life {p.halfLife.toFixed(0)} days · correlation {p.rho.toFixed(2)} · {p.sector}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Checks({ v, gate }: { v: VariantMeta; gate: Record<string, number> }) {
  const checks = gateChecks(v, gate);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${checks.filter((c) => c.ok).length} of 8 checks passed`}>
      {checks.map((c) => (
        <span key={c.id} title={`${c.ok ? "Passed" : "Failed"}: ${c.label}`} className={cn("h-2 w-2 rounded-[2px]", c.ok ? "bg-positive" : "bg-border")} />
      ))}
    </span>
  );
}

function ProofPanel({ data }: { data: SetupsFile }) {
  const [open, setOpen] = useState<string | null>(null);
  const [family, setFamily] = useState<"all" | Family>("all");
  const sorted = [...data.variants]
    .filter((v) => family === "all" || v.family === family)
    .sort((a, b) => Number(b.passed) - Number(a.passed) || (b.outSample.t ?? -9) - (a.outSample.t ?? -9));
  return (
    <Panel
      title="Scoreboard: how every strategy has done"
      subtitle={`Trades after ${fmtDate(data.oosStart)}, against the sector ETF, after costs. Squares are the eight checks; a strategy needs all eight. "Live" counts only signals the engine caught as they happened.`}
      collapse={false}
    >
      <div data-section="Strategy scoreboard">
        <ToggleGroup type="single" value={family} onValueChange={(v) => v && setFamily(v as typeof family)} className="mb-3 flex flex-wrap justify-start gap-1" aria-label="Scoreboard family">
          <ToggleGroupItem value="all" size="sm" className="h-7 px-2.5 text-xs">All</ToggleGroupItem>
          {[...FAMILIES, "pairs" as const].map((f) => (
            <ToggleGroupItem key={f} value={f} size="sm" className="h-7 px-2.5 text-xs">{FAMILY_LABEL[f]}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-normal">Strategy</th>
                <th className="pr-3 font-normal">Side · hold</th>
                <th className="pr-3 text-right font-normal">Trades</th>
                <th className="pr-3 text-right font-normal">Avg / trade</th>
                <th className="pr-3 text-right font-normal">Win rate</th>
                <th className="pr-3 text-right font-normal">t-stat</th>
                <th className="pr-3 text-right font-normal">Live</th>
                <th className="pr-3 font-normal">Checks</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => {
                const s = STRATEGY[v.strategy];
                const isOpen = open === v.key;
                return (
                  <Fragment key={v.key}>
                    <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpen(isOpen ? null : v.key)} data-agent-click>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                          <span>{s?.label ?? v.strategy}</span>
                          <span className="text-[10px] text-muted-foreground">{FAMILY_LABEL[v.family]}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap pr-3 text-xs">{sideLabel(v.side)} · {holdLabel(v.horizon)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtInt(v.outSample.n)}</td>
                      <td className={cn("pr-3 text-right tabular-nums", toneClass[toneOf(v.outSample.avgNet)])}>{fmtPct(v.outSample.avgNet, 2, true)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtPct(v.outSample.hit, 0)}</td>
                      <td className="pr-3 text-right tabular-nums">{v.outSample.t?.toFixed(2) ?? "—"}</td>
                      <td className="pr-3 text-right text-xs tabular-nums" title={v.live?.since ? `Since ${fmtDate(v.live.since)}` : "No finished live signals yet"}>
                        {v.live?.n ? <><span className={toneClass[toneOf(v.live.avgNet)]}>{fmtPct(v.live.avgNet, 2, true)}</span> <span className="text-muted-foreground">({v.live.n})</span></> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="pr-3 text-xs">
                        <span className="inline-flex items-center gap-2">
                          <Checks v={v} gate={data.gate} />
                          {v.passed ? <span className="inline-flex items-center gap-1 text-positive"><Check className="h-3.5 w-3.5" /> Passed</span> : <span className="text-muted-foreground">{8 - v.failed.length}/8</span>}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/20">
                        <td colSpan={8} className="px-3 pb-4 pt-2">
                          <VariantDetail v={v} data={data} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function VariantDetail({ v, data }: { v: VariantMeta; data: SetupsFile }) {
  const s = STRATEGY[v.strategy];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="min-w-0">
        <p className="text-xs"><b>Rule:</b> {s?.rule}. <span className="text-muted-foreground">Research: {s?.source}.{s?.data ? ` Data: ${s.data}${s.dataFrom ? ` (from ${s.dataFrom})` : ""}.` : ""}</span></p>
        <div className="mt-2 text-[11px] text-muted-foreground">Cumulative average return per trade, by month (shaded = out of sample) · worst drawdown {fmtPct(v.maxDrawdown, 1)}</div>
        <Curve v={v} oosStart={data.oosStart} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
          {v.years.map((y) => (
            <span key={y.year}>{y.year}: <span className={toneClass[toneOf(y.avgNet)]}>{fmtPct(y.avgNet, 2, true)}</span> <span className="text-muted-foreground">({fmtInt(y.n)})</span></span>
          ))}
        </div>
        {v.family !== "pairs" && (
          <Button asChild size="sm" variant="outline" className="mt-3 h-7">
            <Link to="/app/autopilots" search={{ variant: v.key }}><Bot className="mr-1 h-3.5 w-3.5" /> Paper-trade this rule automatically</Link>
          </Button>
        )}
      </div>
      <div className="min-w-0 space-y-3 text-xs">
        <div>
          <div className="mb-1 font-medium">The eight checks</div>
          <ul className="space-y-0.5">
            {gateChecks(v, data.gate).map((c) => (
              <li key={c.id} className="flex items-center gap-1.5">
                {c.ok ? <Check className="h-3.5 w-3.5 text-positive" /> : <X className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={cn(!c.ok && "text-muted-foreground")}>{c.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-muted-foreground tabular-nums">Deflated Sharpe {v.dsr?.toFixed(2) ?? "—"} · Sharpe per signal day {v.outSample.sharpe?.toFixed(3) ?? "—"}</div>
        </div>
        <div>
          <div className="mb-1 font-medium">By market regime (all years)</div>
          {REGIMES.map((r) => (
            <div key={r} className="flex justify-between tabular-nums">
              <span className={cn(r === data.regime && "font-semibold")}>{r}{r === data.regime ? " (today)" : ""}</span>
              <span><span className={toneClass[toneOf(v.regimes[r].avgNet)]}>{fmtPct(v.regimes[r].avgNet, 2, true)}</span> <span className="text-muted-foreground">({fmtInt(v.regimes[r].n)})</span></span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 font-medium">Earlier years (before {data.oosStart.slice(0, 4)})</div>
          <div className="tabular-nums">{v.inSample.n ? <>{fmtInt(v.inSample.n)} trades, <span className={toneClass[toneOf(v.inSample.avgNet)]}>{fmtPct(v.inSample.avgNet, 2, true)}</span> per trade, t {v.inSample.t?.toFixed(2) ?? "—"}</> : <span className="text-muted-foreground">No data before {data.oosStart.slice(0, 4)}{s?.dataFrom ? ` (data starts ${s.dataFrom})` : ""}</span>}</div>
        </div>
        <div>
          <div className="mb-1 font-medium">Live record</div>
          <div className="tabular-nums text-muted-foreground">
            {v.live?.n ? <>{fmtInt(v.live.n)} finished signals since {fmtDate(v.live.since!)}: <span className={toneClass[toneOf(v.live.avgNet)]}>{fmtPct(v.live.avgNet, 2, true)}</span> per trade, win rate {fmtPct(v.live.hit, 0)}</> : "No finished live signals yet — the record starts when the nightly engine catches its first signal."}
          </div>
        </div>
      </div>
    </div>
  );
}

function MethodPanel({ data }: { data: SetupsFile }) {
  const sources = [
    ["Daily prices", "Yahoo Finance (Nasdaq and Cboe as fallbacks), split and dividend adjusted", "https://finance.yahoo.com"],
    ["Earnings dates", "SEC 8-K filings with item 2.02 (results of operations)", "https://www.sec.gov/edgar/search/"],
    ["Insider purchases", "SEC Form 4 and the SEC's quarterly insider transactions data sets", "https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets"],
    ["Short-sale volume", "FINRA Reg SHO daily short-sale volume files (from Aug 2018)", "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data"],
    ["Volatility term structure", "Cboe VIX and VIX3M daily history", "https://www.cboe.com/tradable_products/vix/"],
    ["Supplier–customer links", "Sentences quoted from 10-K/10-Q filings (from late 2023)", null],
  ] as const;
  return (
    <Panel title="How this is tested" subtitle="Fixed rules, honest costs, no look-ahead" collapse={false}>
      <div className="grid grid-cols-1 gap-5 text-xs lg:grid-cols-2" data-section="Methodology">
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          <li>Every rule uses the parameters from its published paper — nothing is fitted to this data. Each signal uses only information available at that day's close; trades enter at the next open and exit at the close after the holding period.</li>
          <li>Returns are measured against the stock's sector ETF (and separately against the S&P 500), after a round-trip cost of 4–30 basis points depending on liquidity, plus a 3% a year borrow fee on shorts. Stocks trading under $5M a day are skipped.</li>
          <li>Trades are grouped by signal day, so a day when 200 stocks fire counts once. The out-of-sample test is everything since {data.oosStart.slice(0, 4)}; earlier years must also be positive.</li>
          <li>Because {data.variants.length} variants are tried, each must survive Benjamini–Hochberg false-discovery control and a deflated Sharpe ratio test, and must work in at least {data.gate.minRegimes} of the four market regimes.</li>
          <li>Each night the engine refreshes closing prices, rescans every stock, re-runs every check and records every live signal with its later outcome, so the live record can confirm or contradict the backtest.</li>
        </ul>
        <div className="min-w-0">
          <div className="mb-1 font-medium">Data sources</div>
          <ul className="space-y-1">
            {sources.map(([k, v, url]) => (
              <li key={k} className="flex gap-2">
                <span className="w-40 shrink-0 font-medium">{k}</span>
                <span className="min-w-0 text-muted-foreground">
                  {v}
                  {url && <a href={url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-foreground underline-offset-2 hover:underline"><ExternalLink className="h-3 w-3" /></a>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
