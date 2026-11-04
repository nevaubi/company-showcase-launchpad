import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Segmented } from "@/components/app/segmented";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { PATTERN_META, type PatternKind } from "@/lib/markets/core";
import { marketsQuery } from "@/lib/markets/query";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/patterns")({
  head: () => ({
    meta: [
      { title: "Chart patterns — Filed Under" },
      { name: "description", content: "Breakouts, crosses, double tops and bottoms, squeezes and volume gaps detected across 78 US stocks, with how each pattern has played out on that stock." },
      { property: "og:title", content: "Chart patterns — Filed Under" },
      { property: "og:description", content: "Live chart-pattern scanner with each pattern's historical 20-day hit rate." },
    ],
  }),
  component: Patterns,
});

type Bias = "all" | "bullish" | "bearish" | "neutral";

function Patterns() {
  const q = useQuery(marketsQuery);
  const [bias, setBias] = useState<Bias>("all");

  const pooled = useMemo(() => {
    const acc = new Map<PatternKind, { n: number; f: number; hits: number }>();
    for (const c of q.data?.companies ?? [])
      for (const e of c.edges) {
        const a = acc.get(e.kind) ?? { n: 0, f: 0, hits: 0 };
        a.n += e.n;
        a.f += (e.avgFwd20 ?? 0) * e.n;
        a.hits += (e.hitRate ?? 0) * e.n;
        acc.set(e.kind, a);
      }
    return acc;
  }, [q.data]);

  const active = useMemo(
    () =>
      (q.data?.companies ?? [])
        .flatMap((c) => c.active.map((h) => ({ ...h, ticker: c.ticker, sector: c.sector, edge: c.edges.find((e) => e.kind === h.kind) })))
        .filter((h) => bias === "all" || PATTERN_META[h.kind].bias === bias)
        .sort((a, b) => (a.ago ?? 0) - (b.ago ?? 0)),
    [q.data, bias],
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="Markets"
        title="Chart patterns"
        description="Fixed, rule-based patterns detected on daily closes using only data available that day. For each one you see how it has done on that same stock over the last ten years — so you can tell a reliable setup from noise."
        actions={<Segmented label="Bias" value={bias} onChange={setBias} options={[{ v: "all", l: "All" }, { v: "bullish", l: "Bullish" }, { v: "bearish", l: "Bearish" }, { v: "neutral", l: "Neutral" }]} />}
      />
      {!q.data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Panel title="Triggered in the last 10 sessions" subtitle={`${active.length} signals · as of ${fmtDate(q.data.companies[0]?.asOf)}`} bodyClassName="p-0" className="min-w-0">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Company</th>
                    <th className="px-2 py-2 text-left font-medium">Pattern</th>
                    <th className="px-2 py-2 text-left font-medium">When</th>
                    <th className="px-2 py-2 text-right font-medium">Price</th>
                    <th className="px-2 py-2 text-right font-medium" title="Times this pattern fired on this stock with 20 sessions of follow-up">Past cases</th>
                    <th className="px-2 py-2 text-right font-medium" title="Share that moved in the pattern's direction over 20 sessions">Hit rate</th>
                    <th className="px-2 py-2 text-right font-medium">Avg 20d after</th>
                    <th className="px-4 py-2 text-right font-medium">All stocks</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((h) => {
                    const meta = PATTERN_META[h.kind];
                    const p = pooled.get(h.kind);
                    return (
                      <tr key={h.ticker + h.kind + h.date} className="border-b last:border-0">
                        <td className="px-4 py-1.5">
                          <Link to="/app/markets" search={{ symbol: h.ticker, range: "1y" }} className="flex items-center gap-2 font-medium hover:underline">
                            <CompanyLogo ticker={h.ticker} className="size-5" />{h.ticker}
                          </Link>
                        </td>
                        <td className="px-2" title={meta.rule}>
                          <Badge variant="outline" className={cn(meta.bias === "bullish" && "border-positive text-positive", meta.bias === "bearish" && "border-negative text-negative")}>{meta.label}</Badge>
                        </td>
                        <td className="px-2 text-muted-foreground">{h.ago === 0 ? "Today" : `${h.ago}d ago`}</td>
                        <td className="num px-2 text-right">{fmtPrice(h.price)}</td>
                        <td className="num px-2 text-right">{h.edge?.n ?? 0}</td>
                        <td className="num px-2 text-right">{fmtPct(h.edge?.hitRate, 0)}</td>
                        <td className={cn("num px-2 text-right", (h.edge?.avgFwd20 ?? 0) > 0 ? "text-positive" : "text-negative")}>{fmtPct(h.edge?.avgFwd20, 1, true)}</td>
                        <td className="num px-4 text-right text-muted-foreground">{p && p.n ? `${meta.bias === "neutral" ? "" : `${fmtPct(p.hits / p.n, 0)} · `}${fmtPct(p.f / p.n, 1, true)}` : "—"}</td>
                      </tr>
                    );
                  })}
                  {!active.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nothing triggered recently for this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Pattern scorecard" subtitle="Every trigger across all covered stocks over ten years · 20-session forward return" className="min-w-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(PATTERN_META) as PatternKind[]).map((k) => {
                const m = PATTERN_META[k];
                const p = pooled.get(k);
                return (
                  <div key={k} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{m.label}</span>
                      <span className={cn("text-[11px] uppercase", m.bias === "bullish" ? "text-positive" : m.bias === "bearish" ? "text-negative" : "text-muted-foreground")}>{m.bias}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">{m.rule}</p>
                    <div className="num mt-2 text-[13px]">
                      {p?.n ? `${p.n.toLocaleString()} cases · avg ${fmtPct(p.f / p.n, 1, true)}${m.bias !== "neutral" ? ` · ${fmtPct(p.hits / p.n, 0)} hit` : ""}` : "No cases"}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">Average forward returns include the market's general upward drift; a bullish pattern needs to beat a typical stock's ~1–2% per month to show an edge.</p>
          </Panel>
        </>
      )}
    </div>
  );
}
