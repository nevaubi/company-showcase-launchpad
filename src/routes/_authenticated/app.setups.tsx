import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Check, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtInt, fmtPct, fmtPrice, toneClass, toneOf } from "@/lib/format";
import { REGIMES } from "@/lib/signals/backtest";
import { STRATEGY } from "@/lib/signals/strategies";
import type { PairSetup, Setup, SetupsFile, VariantMeta } from "@/lib/signals/setups";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/setups")({
  head: () => ({
    meta: [
      { title: "Short-term setups — Filed Under" },
      { name: "description", content: "Published short-term trading strategies tested walk-forward across 1,800+ US stocks after costs, with today's setups only where the evidence holds." },
      { property: "og:title", content: "Short-term setups — Filed Under" },
      { property: "og:description", content: "Overreaction, momentum and pairs strategies with strict out-of-sample proof." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupsPage,
});

const setupsQuery = {
  queryKey: ["setups"],
  queryFn: async () => {
    const r = await fetch("/data/setups.json");
    if (!r.ok) throw new Error(`setups ${r.status}`);
    return (await r.json()) as SetupsFile;
  },
  staleTime: 30 * 60_000,
};

const sideLabel = (s: 1 | -1) => (s > 0 ? "Long" : "Short");
const holdLabel = (h: number) => (h === 1 ? "1 day" : h >= 20 ? `${Math.round(h / 5)} weeks` : `${h} days`);

function Spark({ values, className, bands }: { values: number[]; className?: string; bands?: number }) {
  const w = 120, h = 32;
  const lo = Math.min(...values, ...(bands ? [-bands - 0.5] : []));
  const hi = Math.max(...values, ...(bands ? [bands + 0.5] : []));
  const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-28", className)} preserveAspectRatio="none" aria-hidden>
      {bands != null && [bands, 0, -bands].map((b) => <line key={b} x1={0} x2={w} y1={y(b)} y2={y(b)} className="stroke-border" strokeDasharray={b ? "3 3" : undefined} strokeWidth={1} />)}
      <path d={d} fill="none" className="stroke-foreground" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Curve({ v }: { v: VariantMeta & { oosStart: string } }) {
  const pts = v.curve;
  if (pts.length < 2) return null;
  const w = 600, h = 120;
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (z: number) => h - ((z - lo) / (hi - lo || 1)) * h;
  const split = pts.findIndex((p) => p[0] >= v.oosStart.slice(0, 7));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full" preserveAspectRatio="none" role="img" aria-label="Cumulative average return per trade by month">
      {split > 0 && <rect x={x(split)} y={0} width={w - x(split)} height={h} className="fill-muted/60" />}
      <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[1])}`).join("")} fill="none" className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SetupsPage() {
  const { data, isLoading } = useQuery(setupsQuery);
  const [watch, setWatch] = useState(false);
  const [family, setFamily] = useState<"all" | "reversal" | "momentum">("all");
  const qc = useQueryClient();

  const passed = data?.variants.filter((v) => v.passed) ?? [];
  const rows = useMemo(
    () => (data?.setups ?? []).filter((s) => (watch || s.proven) && (family === "all" || STRATEGY[s.strategy].family === family)),
    [data, watch, family],
  );

  const track = useMutation({
    mutationFn: async (s: Setup) => {
      const { error } = await supabase.from("paper_trades").insert({
        ticker: s.ticker,
        direction: s.side > 0 ? "long" : "short",
        entry_price: s.price,
        stop: s.stop,
        target: s.target,
        signals: [s.key],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Added to your paper trades");
      qc.invalidateQueries({ queryKey: ["paper_trades"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading || !data) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ideas"
        title="Short-term setups"
        description={`${data.variants.length} versions of published strategies, run over ${fmtInt(data.companies)} stocks since 2017. Each is judged on trades after ${fmtDate(data.oosStart)} it was never tuned on, after trading costs. Only strategies that pass every check produce setups. Not investment advice.`}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded border px-2 py-1">Market today: <b>{data.regime}</b></span>
            <span className="text-muted-foreground">Prices through {fmtDate(data.asOf)}</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
        {[
          ["Strategies tested", fmtInt(data.variants.length)],
          ["Passed every check", fmtInt(passed.length)],
          ["Setups today", fmtInt(data.setups.filter((s) => s.proven).length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <div className="text-[11px] text-muted-foreground">{k}</div>
            <div className="font-display text-xl tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <Panel
        title="Today's setups"
        subtitle={watch ? "Including watch-only near misses: positive out of sample but not proven" : "Only strategies that passed every check, in today's market regime"}
        actions={
          <div className="flex items-center gap-3">
            <div className="hidden gap-1 sm:flex">
              {(["all", "reversal", "momentum"] as const).map((f) => (
                <Button key={f} size="sm" variant={family === f ? "secondary" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setFamily(f)}>
                  {f === "all" ? "All" : f === "reversal" ? "Snap backs" : "Momentum"}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={watch} onCheckedChange={setWatch} aria-label="Show watch-only near misses" />
              Watch-only
            </label>
          </div>
        }
        collapse={false}
      >
        {!rows.length ? (
          <div className="px-1 py-6 text-sm text-muted-foreground">
            {passed.length === 0 ? (
              <>
                <p className="font-medium text-foreground">No strategy passes the strict checks right now.</p>
                <p className="mt-1 max-w-2xl">
                  After trading costs, none of these well-known strategies has beaten its sector reliably since {data.oosStart.slice(0, 4)}. Most of these effects have faded since they were published. That's why there are no setups today. Turn on watch-only to see the closest candidates, and see the full results below.
                </p>
              </>
            ) : (
              <p>No setups fired in the last three trading days.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-normal">Stock</th>
                  <th className="pr-3 font-normal">Setup</th>
                  <th className="pr-3 font-normal">Hold</th>
                  <th className="pr-3 font-normal">Last 60 days</th>
                  <th className="pr-3 text-right font-normal">Price</th>
                  <th className="pr-3 text-right font-normal">Stop / target</th>
                  <th className="pr-3 text-right font-normal">Edge*</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={`${s.ticker}:${s.key}`} className="border-t align-middle">
                    <td className="py-2 pr-3">
                      <Link to="/app/companies/$ticker" params={{ ticker: s.ticker }} className="flex items-center gap-2">
                        <CompanyLogo ticker={s.ticker} size="sm" />
                        <span className="font-medium">{s.ticker}</span>
                      </Link>
                    </td>
                    <td className="pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", s.side > 0 ? "text-positive" : "text-negative")}>
                          {s.side > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                          {sideLabel(s.side)}
                        </span>
                        <span>{STRATEGY[s.strategy].label}</span>
                        {!s.proven && <span className="rounded border px-1 text-[10px] text-muted-foreground">watch-only</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.detail} · {fmtDate(s.firedAt)}</div>
                    </td>
                    <td className="pr-3 text-xs">{holdLabel(s.horizon)}</td>
                    <td className="pr-3"><Spark values={s.spark} /></td>
                    <td className="pr-3 text-right tabular-nums">{fmtPrice(s.price)}</td>
                    <td className="pr-3 text-right text-xs tabular-nums text-muted-foreground">{fmtPrice(s.stop)} / {fmtPrice(s.target)}</td>
                    <td className={cn("pr-3 text-right tabular-nums", toneClass[toneOf(s.edge)])}>{fmtPct(s.edge, 2, true)}</td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => track.mutate(s)} disabled={track.isPending}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Paper trade
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">*Average return per trade against the sector after costs, out of sample and in today's market regime, scaled down for small samples. Stop is 2× (momentum 2.5×) the 14-day average daily range; target is 1.5× (momentum 2×) that risk.</p>
          </div>
        )}
      </Panel>

      <PairsPanel pairs={data.pairs} proven={data.pairsProven} />

      <ProofPanel data={data} />
    </div>
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
        <p className="py-4 text-sm text-muted-foreground">No cointegrated pair is stretched beyond 2 standard deviations today.</p>
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
                <span className={cn("tabular-nums text-xs font-semibold", Math.abs(p.z) >= 2 ? "text-foreground" : "text-muted-foreground")}>z {p.z > 0 ? "+" : ""}{p.z.toFixed(2)}</span>
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

function ProofPanel({ data }: { data: SetupsFile }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...data.variants].sort((a, b) => Number(b.passed) - Number(a.passed) || (b.outSample.t ?? -9) - (a.outSample.t ?? -9));
  return (
    <Panel
      title="Proof: how every strategy has done"
      subtitle={`Trades after ${fmtDate(data.oosStart)}, against the sector ETF, after costs. A strategy must pass all eight checks: ${data.gate.minN}+ trades, positive after costs, t-stat ≥ ${data.gate.minT}, false-discovery control, deflated Sharpe ≥ ${data.gate.minDsr}, worked in earlier years, beat the S&P 500, and worked in ${data.gate.minRegimes}+ market regimes.`}
      collapse={false}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-normal">Strategy</th>
              <th className="pr-3 font-normal">Side · hold</th>
              <th className="pr-3 text-right font-normal">Trades</th>
              <th className="pr-3 text-right font-normal">Avg / trade</th>
              <th className="pr-3 text-right font-normal">Win rate</th>
              <th className="pr-3 text-right font-normal">t-stat</th>
              <th className="pr-3 text-right font-normal">Deflated Sharpe</th>
              <th className="pr-3 font-normal">Result</th>
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
                        <span>{s.label}</span>
                      </div>
                    </td>
                    <td className="pr-3 text-xs">{sideLabel(v.side)} · {holdLabel(v.horizon)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtInt(v.outSample.n)}</td>
                    <td className={cn("pr-3 text-right tabular-nums", toneClass[toneOf(v.outSample.avgNet)])}>{fmtPct(v.outSample.avgNet, 2, true)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtPct(v.outSample.hit, 0)}</td>
                    <td className="pr-3 text-right tabular-nums">{v.outSample.t?.toFixed(2) ?? "—"}</td>
                    <td className="pr-3 text-right tabular-nums">{v.dsr?.toFixed(2) ?? "—"}</td>
                    <td className="pr-3 text-xs">
                      {v.passed ? (
                        <span className="inline-flex items-center gap-1 text-positive"><Check className="h-3.5 w-3.5" /> Passed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><X className="h-3.5 w-3.5" /> {v.failed.length} of 8 failed</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/20">
                      <td colSpan={8} className="px-3 pb-4 pt-2">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
                          <div className="min-w-0">
                            <p className="text-xs"><b>Rule:</b> {s.rule}. <span className="text-muted-foreground">Research: {s.source}.</span></p>
                            <div className="mt-2 text-[11px] text-muted-foreground">Cumulative average return per trade, by month (shaded = out of sample) · worst drawdown {fmtPct(v.maxDrawdown, 1)}</div>
                            <Curve v={{ ...v, oosStart: data.oosStart }} />
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
                              {v.years.map((y) => (
                                <span key={y.year}>{y.year}: <span className={toneClass[toneOf(y.avgNet)]}>{fmtPct(y.avgNet, 2, true)}</span></span>
                              ))}
                            </div>
                          </div>
                          <div className="min-w-0 space-y-3 text-xs">
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
                              <div className="tabular-nums">{fmtInt(v.inSample.n)} trades, <span className={toneClass[toneOf(v.inSample.avgNet)]}>{fmtPct(v.inSample.avgNet, 2, true)}</span> per trade, t {v.inSample.t?.toFixed(2) ?? "—"}</div>
                            </div>
                            {!v.passed && (
                              <div>
                                <div className="mb-1 font-medium">Why it's not shown</div>
                                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{v.failed.map((f) => <li key={f}>{f}</li>)}</ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
