import { useMemo } from "react";
import { TickerMark } from "@/components/app/ticker";
import { IrPanel } from "@/components/ir/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuotes, useUniverse } from "@/lib/data";
import { isPrice } from "./header/model";
import { coverageOf } from "@/lib/coverage";
import { METRICS, groupMedians, metricsOf, rankIn, type Metrics } from "@/lib/company/benchmarks";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { fmtMultiple } from "@/lib/company/analysis-format";
import { cn } from "@/lib/utils";

const fmt = (v: number | null, kind: "usd" | "x" | "pct") => (v == null ? "–" : kind === "usd" ? fmtCompactUsd(v) : kind === "x" ? fmtMultiple(v) : fmtPct(v, 1));

/** The most industry members whose prices are requested: enough for a median, never the whole coverage list. */
const INDUSTRY_CAP = 60;
/** The universe snapshot divides net income by equity at the period end; the analysis above uses average equity. */
// Short heads that wrap to at most two lines, so twelve figures fit beside the company at 1280 px; what each one
// means in full (latest quarter, period-end equity) is in the panel's subtitle.
const LABEL: Partial<Record<(typeof METRICS)[number]["key"], string>> = { roe: "Return on equity", growth: "Revenue growth", cagr5: "Revenue 5Y CAGR", leverage: "Net debt / EBITDA", evEbitda: "EV / EBITDA", shYield: "Holder yield" };
/** Shareholder yield is the least used figure here: it gives way below 1400 px so the rest fit without scrolling. */
const NARROW_HIDDEN: Partial<Record<(typeof METRICS)[number]["key"], string>> = { shYield: "hidden min-[1400px]:table-cell", leverage: "max-[1399px]:pr-4" };

/**
 * The company against its named peers and its industry median, with its rank in the industry. Prices are requested
 * for the company, its peers and its industry (tens of tickers), not for every covered company.
 */
export function SectorTable({ ticker }: { ticker: string }) {
  const u = useUniverse();
  const co = coverageOf(ticker);
  const members = useMemo(() => {
    const all = u.data?.companies ?? [];
    const self = all.find((c) => c.ticker === ticker);
    if (!self || !co) return null;
    const industry = all.filter((c) => c.industry === self.industry);
    const peers = (co.peers ?? []).map((t) => all.find((c) => c.ticker === t)).filter((c): c is (typeof all)[number] => !!c).slice(0, 5);
    // the largest by trailing revenue stand for the industry when it is bigger than the cap
    const ranked = [...industry].sort((a, b) => (b.f?.ttm?.revenue ?? 0) - (a.f?.ttm?.revenue ?? 0)).slice(0, INDUSTRY_CAP);
    return { self, peers, industry: ranked, industrySize: industry.length };
  }, [u.data, ticker, co]);
  const symbols = useMemo(() => (members ? [...new Set([ticker, ...members.peers.map((c) => c.ticker), ...members.industry.map((c) => c.ticker)])] : [ticker]), [members, ticker]);
  const quotes = useQuotes(symbols);

  const model = useMemo(() => {
    if (!members) return null;
    const px = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, isPrice(q.price) ? q.price : null]));
    const of = (c: (typeof members.industry)[number]) => ({ c, m: metricsOf(c, px.get(c.ticker) ?? null) });
    const industry = members.industry.map(of);
    // the median row only where at least three members have the figure; with none, no row
    const med = groupMedians(industry.map((x) => x.m));
    const hasMedian = METRICS.some((k) => med[k.key] != null);
    return {
      self: of(members.self),
      industry,
      peers: members.peers.map(of),
      rows: [{ id: "ind", label: "Industry median", sub: `${members.self.industry} · ${industry.length}${members.industrySize > industry.length ? ` largest of ${members.industrySize}` : industry.length === 1 ? " company" : " companies"}`, m: med }].filter(() => hasMedian),
      asOf: members.self.f?.asOf,
    };
  }, [members, quotes.data]);

  return (
    <IrPanel
      section="Peers"
      title="Peers and industry"
      subtitle={
        model
          ? `Universe snapshot: trailing twelve months from SEC filings${model.asOf ? ` through ${fmtDate(model.asOf)}` : ""}, at the last price · revenue growth is the latest quarter on a year earlier · return on equity uses period-end equity, so it differs from the average-equity figure in the analysis · rank is within the industry`
          : u.isLoading
            ? "Loading"
            : "Universe snapshot"
      }
      bodyClassName="p-0"
    >
      {!model ? (
        u.isLoading ? (
          <Skeleton className="m-4 h-40" />
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">{ticker} is not in the universe snapshot yet, so there is no peer comparison to show.</p>
        )
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="research-table min-w-[760px]">
            <thead>
              <tr className="border-b bg-secondary/40 text-left text-[11px] text-muted-foreground">
                <th className="sticky left-0 z-10 bg-secondary px-4 py-1.5 align-bottom font-medium">Company</th>
                {METRICS.map((m) => (
                  <th key={m.key} className={cn("px-1.5 py-1.5 text-right align-bottom font-medium leading-tight whitespace-normal last:pr-4", NARROW_HIDDEN[m.key])}>
                    {LABEL[m.key] ?? m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row ticker={ticker} m={model.self.m} highlight sector={model.industry.map((x) => x.m)} />
              {model.peers.map((p) => (
                <Row key={p.c.ticker} ticker={p.c.ticker} m={p.m} base={model.self.m} />
              ))}
              {model.rows.map((r) => (
                <tr key={r.id} className="border-t bg-secondary/20">
                  <td className="sticky left-0 z-10 bg-card px-4 py-1.5">
                    <p className="font-medium">{r.label}</p>
                    <p className="max-w-48 truncate text-[11px] text-muted-foreground" title={r.sub}>{r.sub}</p>
                  </td>
                  {METRICS.map((m) => (
                    <td key={m.key} className={cn("num px-1.5 py-1.5 text-right text-muted-foreground last:pr-4", NARROW_HIDDEN[m.key])}>{fmt(r.m[m.key], m.kind)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </IrPanel>
  );
}

function Row({ ticker, m, highlight, sector, base }: { ticker: string; m: Metrics; highlight?: boolean; sector?: Metrics[]; base?: Metrics }) {
  return (
    <tr className={cn("border-t", highlight ? "bg-primary/5" : "hover:bg-secondary/40")}>
      <td className="sticky left-0 z-10 bg-card px-4 py-1.5">
        <TickerMark ticker={ticker} name nameFirst link={!highlight} className={highlight ? "font-semibold" : undefined} />
      </td>
      {METRICS.map((x) => {
        const r = sector ? rankIn(m[x.key], sector.map((s) => s[x.key]), x.better) : null;
        const b = base?.[x.key];
        const v = m[x.key];
        const better = b != null && v != null && x.key !== "mcap" ? (x.better === "high" ? v > b : v < b) : null;
        return (
          <td key={x.key} className={cn("num px-1.5 py-1.5 text-right align-top last:pr-4", NARROW_HIDDEN[x.key])}>
            <span className={cn("block", highlight && "font-semibold", better === true && "text-positive", better === false && "text-muted-foreground")}>{fmt(v, x.kind)}</span>
            {r && r.of > 1 && (
              <span title={`Rank ${r.rank} of ${r.of} in the industry`} className={cn("mt-0.5 inline-block rounded px-1 py-px text-[10px]", r.rank <= Math.ceil(r.of / 3) ? "bg-positive/15 text-positive" : r.rank > Math.floor((2 * r.of) / 3) ? "bg-negative/10 text-negative" : "bg-secondary text-muted-foreground")}>
                #{r.rank}/{r.of}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
