import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { useSource } from "@/components/source/source-context";
import { companyQuery, useQuotes } from "@/lib/data";
import { coverageOf } from "@/lib/coverage";
import { latestYoY, ttm } from "@/lib/financials/metrics";
import { ttmTarget } from "@/lib/financials/targets";
import { fmtCompactUsd, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Side-by-side TTM fundamentals for a company and its covered peers. Revenue cells open their filings. */
export function PeerTable({ ticker }: { ticker: string }) {
  const co = coverageOf(ticker);
  const tickers = [ticker, ...(co?.peers ?? []).filter((t) => coverageOf(t))].slice(0, 5);
  const sets = useQueries({ queries: tickers.map((t) => companyQuery(t)) });
  const quotes = useQuotes(tickers).data?.quotes ?? [];
  const { open } = useSource();

  const rows = tickers.map((t, i) => {
    const d = sets[i].data;
    if (!d) return { t, d: null as null };
    const q = d.statements.quarterly;
    const rev = ttm(q.income, "revenue");
    const op = ttm(q.income, "operatingIncome");
    const ni = ttm(q.income, "netIncome");
    const eps = ttm(q.income, "epsDiluted");
    const fcf = ttm(q.cashflow, "fcf");
    const price = quotes.find((x) => x.symbol === t)?.price ?? null;
    const mcap = price && d.profile.sharesOutstanding ? price * d.profile.sharesOutstanding : null;
    return {
      t,
      d,
      revT: ttmTarget(t, q.income, "revenue", "Revenue"),
      rev,
      growth: latestYoY(q.income, "revenue"),
      opm: rev && op != null ? op / rev : null,
      npm: rev && ni != null ? ni / rev : null,
      pe: price && eps && eps > 0 ? price / eps : null,
      ps: mcap && rev ? mcap / rev : null,
      fcfy: mcap && fcf != null ? fcf / mcap : null,
      mcap,
    };
  });

  const cols: { key: "mcap" | "rev" | "growth" | "opm" | "npm" | "pe" | "ps" | "fcfy"; label: string; fmt: (v: number) => string; hide?: string }[] = [
    { key: "mcap", label: "Mkt cap", fmt: (v) => fmtCompactUsd(v), hide: "hidden sm:table-cell" },
    { key: "rev", label: "Revenue TTM", fmt: (v) => fmtCompactUsd(v) },
    { key: "growth", label: "Rev YoY", fmt: (v) => fmtPct(v, 1, true) },
    { key: "opm", label: "Op. margin", fmt: (v) => fmtPct(v), hide: "hidden md:table-cell" },
    { key: "npm", label: "Net margin", fmt: (v) => fmtPct(v) },
    { key: "pe", label: "P/E", fmt: (v) => `${v.toFixed(1)}×` },
    { key: "ps", label: "P/S", fmt: (v) => `${v.toFixed(1)}×`, hide: "hidden lg:table-cell" },
    { key: "fcfy", label: "FCF yield", fmt: (v) => fmtPct(v), hide: "hidden lg:table-cell" },
  ];
  const best = (k: (typeof cols)[number]["key"]) => {
    const vals = rows.map((r) => ("d" in r && r.d ? (r as Record<string, unknown>)[k] : null)).filter((v): v is number => typeof v === "number");
    if (!vals.length) return null;
    return k === "pe" || k === "ps" ? Math.min(...vals) : Math.max(...vals);
  };

  return (
    <Panel
      title={<span className="flex items-center gap-1.5"><Users className="size-3.5" /> Peer comparison</span>}
      subtitle="Trailing twelve months from SEC filings · best in group underlined"
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="research-table">
          <thead>
            <tr className="border-b text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Company</th>
              {cols.map((c) => (
                <th key={c.key} className={cn("px-2 py-2 text-right font-medium whitespace-nowrap", c.hide)}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.t} className={cn("hover:bg-muted/40", r.t === ticker && "bg-highlight/30")}>
                <td className="px-4 py-2">
                  <Link to="/app/companies/$ticker" params={{ ticker: r.t }} className="flex items-center gap-2 font-medium hover:underline">
                    <CompanyLogo ticker={r.t} size="xs" />
                    <span className="num">{r.t}</span>
                    <span className="hidden truncate text-muted-foreground xl:inline">{coverageOf(r.t)?.shortName}</span>
                  </Link>
                </td>
                {cols.map((c) => {
                  const v = r.d ? ((r as Record<string, unknown>)[c.key] as number | null | undefined) : undefined;
                  const isBest = v != null && v === best(c.key) && rows.length > 1;
                  const clickable = c.key === "rev" && "revT" in r && r.revT;
                  return (
                    <td key={c.key} className={cn("num px-2 py-2 text-right whitespace-nowrap", c.hide, isBest && "underline decoration-primary decoration-2 underline-offset-4")}>
                      {v === undefined ? (
                        <span className="inline-block h-3 w-10 animate-pulse rounded bg-muted" />
                      ) : v == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : clickable ? (
                        <button className="hover:text-primary hover:underline" onClick={() => open(r.revT!)}>{c.fmt(v)}</button>
                      ) : (
                        <span className={cn(c.key === "growth" && (v >= 0 ? "text-positive" : "text-negative"))}>{c.fmt(v)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
