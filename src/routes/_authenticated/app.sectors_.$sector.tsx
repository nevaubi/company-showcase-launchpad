import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel, Stat } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BENCHMARKS, COVERAGE } from "@/lib/coverage";
import { fmtPct } from "@/lib/format";
import { betaR2, correlationMatrix, paired, pearson } from "@/lib/markets/core";
import { PATTERN_META } from "@/lib/markets/core";
import { marketsQuery, returnMap, returnsQuery, trailing } from "@/lib/markets/query";
import { cn } from "@/lib/utils";

const SECTOR_NAMES = [...new Set(COVERAGE.map((c) => c.sector))];

export const Route = createFileRoute("/_authenticated/app/sectors_/$sector")({
  beforeLoad: ({ params }) => {
    if (!SECTOR_NAMES.includes(params.sector)) throw notFound();
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.sector} sector deep dive — Filed Under` },
      { name: "description", content: `${params.sector}: every covered company's returns, beta, correlations, earnings reactions and live chart patterns.` },
      { property: "og:title", content: `${params.sector} — Filed Under` },
      { property: "og:description", content: `Inside the ${params.sector} sector: leaders, laggards, correlations and earnings behaviour.` },
    ],
  }),
  component: SectorDeep,
});

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
const tone = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "");

function SectorDeep() {
  const { sector } = Route.useParams();
  const rq = useQuery(returnsQuery);
  const mq = useQuery(marketsQuery);
  const etf = COVERAGE.find((c) => c.sector === sector)?.sectorEtf ?? BENCHMARKS.find((b) => b.sector === sector)?.symbol ?? "SPY";
  const members = COVERAGE.filter((c) => c.sector === sector).map((c) => c.ticker);

  const data = useMemo(() => {
    if (!rq.data) return null;
    const f = rq.data;
    const em = returnMap(f, etf), sm = returnMap(f, "SPY");
    const rows = members
      .filter((t) => f.returns[t])
      .map((t) => {
        const m = returnMap(f, t);
        const p = paired(m, em, 252);
        const ps = paired(m, sm, 252);
        const r3 = trailing(f, t, 63), e3 = trailing(f, etf, 63);
        return {
          t,
          m,
          r1: trailing(f, t, 21),
          r3,
          r12: trailing(f, t, 252),
          rel3: r3 != null && e3 != null ? r3 - e3 : null,
          corrEtf: pearson(p.a, p.b),
          betaSpy: betaR2(ps.a, ps.b)?.beta ?? null,
          vol: Math.sqrt(252) * sdev(p.a),
        };
      })
      .sort((a, b) => (b.r3 ?? -9) - (a.r3 ?? -9));
    const matrix = correlationMatrix(rows.map((r) => r.m), 252);
    const pairs: number[] = [];
    matrix.forEach((r, i) => r.forEach((x, j) => j > i && x != null && pairs.push(x)));
    const avgPair = pairs.length ? pairs.reduce((a, b) => a + b, 0) / pairs.length : null;
    const indep = [...rows].sort((a, b) => (a.corrEtf ?? 1) - (b.corrEtf ?? 1))[0];
    // Rebased one-year performance from compounded returns.
    const dates = f.dates.slice(-252);
    const rebased = [etf, ...rows.slice(0, 5).map((r) => r.t), ...rows.slice(-1).map((r) => r.t)].filter((x, i, a) => a.indexOf(x) === i).map((sym, i) => {
      const rr = f.returns[sym]?.slice(-252) ?? [];
      let acc = 1;
      return {
        id: sym,
        label: sym,
        color: sym === etf ? "var(--foreground)" : COLORS[i % COLORS.length],
        dashed: sym === etf,
        points: dates.map((d, k) => ((acc *= 1 + (rr[k] ?? 0)), { date: new Date(`${d}T00:00:00Z`), value: (acc - 1) * 100 })),
      };
    });
    const up3 = rows.filter((r) => (r.rel3 ?? 0) > 0).length;
    return { rows, matrix, avgPair, indep, rebased, up3, etf3: trailing(f, etf, 63), etf12: trailing(f, etf, 252), spy12: trailing(f, "SPY", 252) };
  }, [rq.data, sector]); // eslint-disable-line react-hooks/exhaustive-deps

  const mkt = new Map((mq.data?.companies ?? []).map((c) => [c.ticker, c]));
  const reactAvg = members.map((t) => mkt.get(t)?.stats.avgAbsMove).filter((x): x is number => x != null && Number.isFinite(x));
  const signals = members.flatMap((t) => (mkt.get(t)?.active ?? []).map((h) => ({ ...h, t })));

  return (
    <div className="grid grid-cols-1 gap-5">
      <Link to="/app/sectors" search={{ sector }} className="inline-flex w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All sectors</Link>
      <PageHeader eyebrow={`Sector deep dive · ${etf}`} title={sector} description={`The ${members.length} covered ${sector} companies: who is leading, how tightly they trade together, how they react to earnings and what their charts are signalling.`} />
      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={`${etf} 1 year`} value={fmtPct(data.etf12, 1, true)} sub={`S&P 500 ${fmtPct(data.spy12, 1, true)}`} tone={data.etf12 != null && data.spy12 != null ? (data.etf12 > data.spy12 ? "positive" : "negative") : undefined} />
            <Stat label="Beating the ETF (3M)" value={`${data.up3} of ${data.rows.length}`} sub={data.up3 / Math.max(1, data.rows.length) < 0.4 ? "Narrow — a few names carry it" : "Broad participation"} />
            <Stat label="Avg pair correlation" value={data.avgPair?.toFixed(2) ?? "—"} sub={data.avgPair != null && data.avgPair > 0.55 ? "Stock-picking matters less" : "Stock-specific stories dominate"} />
            <Stat label="Most independent" value={data.indep?.t ?? "—"} sub={data.indep ? `${data.indep.corrEtf?.toFixed(2)} correlation to ${etf}` : undefined} />
            <Stat label="Typical earnings move" value={reactAvg.length ? fmtPct(reactAvg.reduce((a, b) => a + b, 0) / reactAvg.length) : "—"} sub="Two-day, average of members" />
          </div>

          <div className="grid grid-cols-1 gap-5">
            <Panel title="Constituents" subtitle={`Sorted by 3-month return · relative to ${etf}`} bodyClassName="p-0" className="min-w-0">
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Company</th>
                      <th className="px-2 py-2 text-right font-medium">1M</th>
                      <th className="px-2 py-2 text-right font-medium">3M</th>
                      <th className="px-2 py-2 text-right font-medium">1Y</th>
                      <th className="px-2 py-2 text-right font-medium">vs {etf} 3M</th>
                      <th className="px-2 py-2 text-right font-medium" title="1-year beta to the S&P 500">Beta</th>
                      <th className="px-2 py-2 text-right font-medium">Vol</th>
                      <th className="px-2 py-2 text-right font-medium" title="Average two-day earnings move">Earnings</th>
                      <th className="px-4 py-2 text-left font-medium">Signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const mc = mkt.get(r.t);
                      return (
                        <tr key={r.t} className="border-b last:border-0">
                          <td className="px-4 py-1.5">
                            <Link to="/app/companies/$ticker" params={{ ticker: r.t }} className="flex items-center gap-2 font-medium hover:underline"><CompanyLogo ticker={r.t} className="size-5" />{r.t}</Link>
                          </td>
                          <td className={cn("num px-2 text-right", tone(r.r1))}>{fmtPct(r.r1, 1, true)}</td>
                          <td className={cn("num px-2 text-right", tone(r.r3))}>{fmtPct(r.r3, 1, true)}</td>
                          <td className={cn("num px-2 text-right", tone(r.r12))}>{fmtPct(r.r12, 1, true)}</td>
                          <td className={cn("num px-2 text-right font-medium", tone(r.rel3))}>{fmtPct(r.rel3, 1, true)}</td>
                          <td className="num px-2 text-right">{r.betaSpy?.toFixed(2) ?? "—"}</td>
                          <td className="num px-2 text-right">{fmtPct(r.vol, 0)}</td>
                          <td className="num px-2 text-right">
                            {fmtPct(mc?.stats.avgAbsMove)}
                          </td>
                          <td className="min-w-[200px] px-4">
                            <div className="flex flex-wrap gap-1 py-1">
                              {(mc?.active ?? []).map((h) => (
                                <Badge key={h.kind + h.date} variant="outline" className={cn("text-[10px]", PATTERN_META[h.kind].bias === "bullish" && "text-positive", PATTERN_META[h.kind].bias === "bearish" && "text-negative")}>{PATTERN_META[h.kind].label}</Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <Panel title="One year, rebased" subtitle={`Top five by 3-month return and the laggard, vs ${etf} (dashed)`} className="min-w-0">
            <TimeSeriesChart series={data.rebased} height={300} zeroLine yFormat={(v) => `${v.toFixed(0)}%`} />
          </Panel>

          {signals.length > 0 && (
            <Panel title="Live chart signals in this sector" subtitle="Triggered in the last 10 sessions" className="min-w-0">
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {signals.map((h) => (
                  <li key={h.t + h.kind} className="rounded-md border p-2 text-[13px]">
                    <Link to="/app/markets" search={{ symbol: h.t, range: "1y" }} className="font-medium hover:underline">{h.t}</Link> · {PATTERN_META[h.kind].label}
                    <span className="text-muted-foreground"> · {h.ago === 0 ? "today" : `${h.ago}d ago`}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function sdev(xs: number[]) {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
