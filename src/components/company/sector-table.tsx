import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuotes, useUniverse } from "@/lib/data";
import { COVERAGE_TICKERS, coverageOf } from "@/lib/coverage";
import { METRICS, medians, metricsOf, rankIn, type Metrics } from "@/lib/company/benchmarks";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const fmt = (v: number | null, kind: "usd" | "x" | "pct") => (v == null ? "—" : kind === "usd" ? fmtCompactUsd(v) : kind === "x" ? `${v.toFixed(1)}×` : fmtPct(v, 1));

/** Company vs peers and industry / sector / coverage medians, with its rank in the sector. */
export function SectorTable({ ticker }: { ticker: string }) {
  const u = useUniverse();
  const quotes = useQuotes(COVERAGE_TICKERS);
  const co = coverageOf(ticker);

  const model = useMemo(() => {
    if (!u.data || !co) return null;
    const px = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q.price]));
    const all = u.data.companies.map((c) => ({ c, m: metricsOf(c, px.get(c.ticker) ?? null) }));
    const self = all.find((x) => x.c.ticker === ticker);
    if (!self) return null;
    const sector = all.filter((x) => x.c.sector === self.c.sector);
    const industry = all.filter((x) => x.c.industry === self.c.industry);
    const peers = (co.peers ?? []).map((t) => all.find((x) => x.c.ticker === t)).filter((x): x is (typeof all)[number] => !!x).slice(0, 5);
    return {
      self,
      sector,
      peers,
      rows: [
        { id: "ind", label: `Industry median`, sub: `${self.c.industry} · ${industry.length}`, m: medians(industry.map((x) => x.m)) },
        { id: "sec", label: `Sector median`, sub: `${self.c.sector} · ${sector.length}`, m: medians(sector.map((x) => x.m)) },
        { id: "all", label: "Coverage median", sub: `${all.length} companies`, m: medians(all.map((x) => x.m)) },
      ],
      asOf: self.c.f?.asOf,
    };
  }, [u.data, quotes.data, ticker, co]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Layers className="size-3.5" /> Sector & industry comparison
        </span>
      }
      subtitle={model ? `Trailing twelve months from SEC filings${model.asOf ? ` through ${fmtDate(model.asOf)}` : ""} · live prices` : "Loading…"}
      bodyClassName="p-0"
    >
      {!model ? (
        <Skeleton className="m-4 h-60" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1100px] text-[12.5px]">
            <thead>
              <tr className="border-b bg-secondary/40 text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 bg-secondary/95 px-4 py-2 font-medium">Company</th>
                {METRICS.map((m) => (
                  <th key={m.key} className="px-3 py-2 text-right font-medium">{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row ticker={ticker} label={coverageOf(ticker)?.shortName ?? ticker} m={model.self.m} highlight sector={model.sector.map((x) => x.m)} />
              {model.peers.map((p) => (
                <Row key={p.c.ticker} ticker={p.c.ticker} label={coverageOf(p.c.ticker)?.shortName ?? p.c.name} m={p.m} base={model.self.m} />
              ))}
              {model.rows.map((r) => (
                <tr key={r.id} className="border-t bg-secondary/20">
                  <td className="sticky left-0 z-10 bg-card px-4 py-2">
                    <p className="font-medium">{r.label}</p>
                    <p className="truncate text-[10.5px] text-muted-foreground">{r.sub}</p>
                  </td>
                  {METRICS.map((m) => (
                    <td key={m.key} className="num px-3 py-2 text-right text-muted-foreground">{fmt(r.m[m.key], m.kind)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Row({ ticker, label, m, highlight, sector, base }: { ticker: string; label: string; m: Metrics; highlight?: boolean; sector?: Metrics[]; base?: Metrics }) {
  return (
    <tr className={cn("border-t", highlight ? "bg-primary/5" : "hover:bg-secondary/40")}>
      <td className={cn("sticky left-0 z-10 px-4 py-2", highlight ? "bg-card" : "bg-card")}>
        <Link to="/app/companies/$ticker" params={{ ticker }} className="flex items-center gap-2">
          <CompanyLogo ticker={ticker} size="xs" />
          <span className={cn("truncate", highlight && "font-semibold")}>{label}</span>
          <span className="num text-[10.5px] text-muted-foreground">{ticker}</span>
        </Link>
      </td>
      {METRICS.map((x) => {
        const r = sector ? rankIn(m[x.key], sector.map((s) => s[x.key]), x.better) : null;
        const b = base?.[x.key];
        const v = m[x.key];
        const better = b != null && v != null && x.key !== "mcap" ? (x.better === "high" ? v > b : v < b) : null;
        return (
          <td key={x.key} className="num px-3 py-2 text-right">
            <span className={cn(highlight && "font-semibold", better === true && "text-positive", better === false && "text-muted-foreground")}>{fmt(v, x.kind)}</span>
            {r && r.of > 1 && (
              <span className={cn("ml-1.5 rounded px-1 py-px text-[9.5px]", r.rank <= Math.ceil(r.of / 3) ? "bg-positive/15 text-positive" : r.rank > Math.floor((2 * r.of) / 3) ? "bg-negative/10 text-negative" : "bg-secondary text-muted-foreground")}>
                #{r.rank}/{r.of}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
