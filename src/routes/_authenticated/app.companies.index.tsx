import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Sparkline } from "@/components/charts/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuotes, useUniverse } from "@/lib/data";
import { COVERAGE_TICKERS } from "@/lib/coverage";
import { fmtCompactUsd, fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { useToggleFollow } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/")({
  head: () => ({
    meta: [
      { title: "Companies — Filed Under" },
      { name: "description", content: "Covered companies with SEC-sourced fundamentals and live prices." },
      { property: "og:title", content: "Companies — Filed Under" },
      { property: "og:description", content: "Covered companies with SEC-sourced fundamentals and live prices." },
    ],
  }),
  component: Companies,
});

type SortKey = "ticker" | "mcap" | "revenueTTM" | "growth" | "gm" | "pe" | "fcf" | "chg";

function Companies() {
  const u = useUniverse();
  const quotes = useQuotes(COVERAGE_TICKERS);
  const follow = useToggleFollow();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "mcap", dir: -1 });

  const rows = useMemo(() => {
    const qs = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q]));
    return (u.data?.companies ?? []).map((c) => {
      const q = qs.get(c.ticker);
      const mcap = q && c.sharesOutstanding ? q.price * c.sharesOutstanding : null;
      return {
        ...c,
        quote: q,
        mcap,
        pe: q && c.epsTTM ? q.price / c.epsTTM : null,
        fcfYield: mcap && c.fcfTTM ? c.fcfTTM / mcap : null,
      };
    });
  }, [u.data, quotes.data]);

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]): number | string =>
      ({
        ticker: r.ticker,
        mcap: r.mcap ?? -Infinity,
        revenueTTM: r.revenueTTM ?? -Infinity,
        growth: r.revenueGrowthYoY ?? -Infinity,
        gm: r.grossMarginTTM ?? -Infinity,
        pe: r.pe ?? Infinity,
        fcf: r.fcfYield ?? -Infinity,
        chg: r.quote?.changePct ?? -Infinity,
      })[sort.key];
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-3 py-2 font-medium", className)}>
      <button
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : k === "ticker" || k === "pe" ? 1 : -1 }))}
        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
      >
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Coverage"
        title="Companies"
        description="Every fundamental below is computed from XBRL facts in each company's 10-K and 10-Q filings. Prices are live from Yahoo Finance when available."
      />
      <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-[10px] tracking-wider text-muted-foreground">
                <th className="w-8 px-3 py-2" />
                <Th k="ticker">Company</Th>
                <th className="px-3 py-2 text-right font-medium uppercase">Price</th>
                <Th k="chg" className="text-right">
                  Day
                </Th>
                <th className="px-3 py-2 font-medium uppercase">5D</th>
                <Th k="mcap" className="text-right">
                  Mkt cap
                </Th>
                <Th k="revenueTTM" className="text-right">
                  Revenue TTM
                </Th>
                <Th k="growth" className="text-right">
                  Rev YoY
                </Th>
                <Th k="gm" className="text-right">
                  Gross mgn
                </Th>
                <Th k="pe" className="text-right">
                  P/E
                </Th>
                <Th k="fcf" className="text-right">
                  FCF yield
                </Th>
                <th className="px-3 py-2 font-medium uppercase">Last filing</th>
              </tr>
            </thead>
            <tbody>
              {u.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={12} className="px-3 py-2">
                      <Skeleton className="h-9" />
                    </td>
                  </tr>
                ))}
              {sorted.map((r) => (
                <tr key={r.ticker} className="border-b last:border-0 hover:bg-secondary/60">
                  <td className="px-3 py-2">
                    <button onClick={() => follow.toggle(r.ticker)} aria-label={follow.isFollowed(r.ticker) ? `Unfollow ${r.ticker}` : `Follow ${r.ticker}`}>
                      <Star className={cn("size-4 text-muted-foreground", follow.isFollowed(r.ticker) && "fill-chart-2 text-chart-2")} />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} className="flex items-center gap-3">
                      <CompanyLogo ticker={r.ticker} src={r.logo} size="sm" />
                      <span>
                        <span className="num block font-semibold">{r.ticker}</span>
                        <span className="block text-xs text-muted-foreground">{r.name}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="num px-3 py-2 text-right">{fmtPrice(r.quote?.price)}</td>
                  <td className={cn("num px-3 py-2 text-right", (r.quote?.changePct ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(r.quote?.changePct, 2, true)}</td>
                  <td className="px-3 py-2">
                    <Sparkline values={r.quote?.spark ?? []} tone={(r.quote?.changePct ?? 0) >= 0 ? "positive" : "negative"} className="h-6 w-16" />
                  </td>
                  <td className="num px-3 py-2 text-right">{fmtCompactUsd(r.mcap)}</td>
                  <td className="num px-3 py-2 text-right">{fmtCompactUsd(r.revenueTTM)}</td>
                  <td className={cn("num px-3 py-2 text-right", (r.revenueGrowthYoY ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(r.revenueGrowthYoY, 1, true)}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(r.grossMarginTTM)}</td>
                  <td className="num px-3 py-2 text-right">{r.pe ? `${r.pe.toFixed(1)}×` : "—"}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(r.fcfYield)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.lastFiling ? (
                      <>
                        <span className="font-medium text-foreground">{r.lastFiling.form}</span> · {fmtDate(r.lastFiling.filed)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        TTM = sum of the last four reported quarters. Revenue YoY compares the latest quarter with the same quarter a year earlier. Fundamentals snapshot generated{" "}
        {fmtDate(u.data?.generatedAt)}.
      </p>
    </div>
  );
}
