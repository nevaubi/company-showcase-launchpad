import { ExternalLink } from "lucide-react";
import { Spark } from "@/components/company/spark";
import { macroDef } from "@/lib/coverage";
import { useMacro, usePrices } from "@/lib/data";
import { fmtDate, fmtPct, fmtSigned } from "@/lib/format";
import { indexVolatility } from "@/lib/options/as-of";

export function MarketVolatility() {
  const vix = useMacro(macroDef("VIXCLS")!);
  const spy = usePrices("SPY", "1y");
  const reading = indexVolatility(vix.data?.observations ?? [], spy.data?.bars ?? []);
  if (!reading) return null;
  const { date, value, change, percentile, realized, trend } = reading;
  return (
    <section aria-label="S&P 500 volatility context" className="mt-4 rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3.5 py-2">
        <h2 className="text-sm font-semibold">S&amp;P 500 volatility</h2>
        <a className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline" href="https://fred.stlouisfed.org/series/VIXCLS" target="_blank" rel="noreferrer">Cboe via FRED · {fmtDate(date)} <ExternalLink className="size-3" /></a>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4">
        <div className="flex flex-wrap items-center justify-between gap-1 px-3.5 py-2">
          <div><p className="text-[11px] text-muted-foreground">VIX close</p><p className="num text-lg font-semibold tabular-nums">{value.toFixed(2)}</p></div>
          <Spark name="VIX closes" points={trend.map(([label, v]) => ({ label, value: v, text: v.toFixed(2) }))} />
        </div>
        <div className="px-3.5 py-2"><p className="text-[11px] text-muted-foreground">5-session change</p><p className="num text-lg font-medium tabular-nums">{change == null ? "–" : `${fmtSigned(change, 2)} pts`}</p></div>
        <div className="border-t px-3.5 py-2 sm:border-t-0"><p className="text-[11px] text-muted-foreground" title="Share of the prior 252 VIX closes below this reading.">1-year percentile</p><p className="num text-lg font-medium tabular-nums">{fmtPct(percentile, 0)}</p></div>
        <div className="border-t px-3.5 py-2 sm:border-t-0"><p className="text-[11px] text-muted-foreground" title={`Annualized volatility of 20 adjusted SPY daily returns ending ${date}.`}>SPY realized · 20 sessions</p><p className="num text-lg font-medium tabular-nums">{fmtPct(realized, 1)}</p></div>
      </div>
    </section>
  );
}
