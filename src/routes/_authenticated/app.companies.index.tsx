import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuotes, useUniverse } from "@/lib/data";
import { COVERAGE, COVERAGE_TICKERS, coverageOf } from "@/lib/coverage";
import { Input } from "@/components/ui/input";
import { fmtCompactUsd, fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { useToggleFollow } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSessionState } from "@/lib/use-session-state";

export const Route = createFileRoute("/_authenticated/app/companies/")({
  head: () => ({
    meta: [
      { title: "Companies — Filed Under" },
      { name: "description", content: "Covered companies with SEC-sourced fundamentals and live prices." },
      { property: "og:title", content: "Companies — Filed Under" },
      { property: "og:description", content: "Covered companies with SEC-sourced fundamentals and live prices." },
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Companies,
});

type SortKey = "ticker" | "mcap" | "revenueTTM" | "growth" | "gm" | "pe" | "fcf" | "chg";
const SORT_KEYS: SortKey[] = ["ticker", "mcap", "revenueTTM", "growth", "gm", "pe", "fcf", "chg"];
function validSort(value: unknown): value is { key: SortKey; dir: 1 | -1 } {
  if (!value || typeof value !== "object" || !("key" in value) || !("dir" in value)) return false;
  return SORT_KEYS.some((key) => key === value.key) && (value.dir === 1 || value.dir === -1);
}
function validSector(value: unknown): value is string {
  return typeof value === "string" && (value === "All" || COVERAGE.some((c) => c.sector === value));
}

function Companies() {
  const u = useUniverse();
  const quotes = useQuotes(COVERAGE_TICKERS);
  const follow = useToggleFollow();
  const [sort, setSort] = useSessionState<{ key: SortKey; dir: 1 | -1 }>("fu:companies:sort", { key: "mcap", dir: -1 }, validSort);
  const [sector, setSector] = useSessionState<string>("fu:companies:sector", "All", validSector);
  const [q, setQ] = useSessionState("fu:companies:query", "");
  const [limit, setLimit] = useState(50);
  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of COVERAGE) m.set(c.sector, (m.get(c.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

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
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      const c = coverageOf(r.ticker);
      if (sector !== "All" && c?.sector !== sector) return false;
      if (!needle) return true;
      return [r.ticker, r.name, c?.industry ?? "", c?.shortName ?? ""].some((x) => x.toLowerCase().includes(needle));
    });
    return filtered.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, sector, q]);

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th aria-sort={sort.key === k ? sort.dir === 1 ? "ascending" : "descending" : "none"} className={cn("px-3 py-2 font-medium", className)}>
      <Button variant="ghost" size="xs"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : k === "ticker" || k === "pe" ? 1 : -1 }))}
        className="h-6 gap-1 px-0 text-[11px] font-medium hover:bg-transparent"
      >
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Button>
    </th>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Coverage"
        title="Companies"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} placeholder="Name, ticker or industry" className="h-8 w-full sm:w-64" aria-label="Filter companies" />
        <Select value={sector} onValueChange={(v) => { setSector(v); setLimit(50); }}><SelectTrigger aria-label="Filter sector" className="h-8 w-60"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All">All sectors · {COVERAGE.length}</SelectItem>{sectors.map(([name, n]) => <SelectItem value={name} key={name}>{name} · {n}</SelectItem>)}</SelectContent></Select>
        <span className="ml-auto text-xs text-muted-foreground">{sorted.length} companies</span>
        {(q || sector !== "All") && <Button size="xs" variant="ghost" onClick={() => { setQ(""); setSector("All"); setLimit(50); }}>Clear filters</Button>}
      </div>
      {u.isError && <div role="alert" className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">{u.data ? "Refresh failed; showing the last available dataset." : "Company data is temporarily unavailable."}<Button size="xs" variant="outline" onClick={() => u.refetch()}>Retry</Button></div>}
      <div className="border-y bg-card/40">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="research-table">
            <thead>
              <tr className="border-b text-left text-[10px] tracking-wider text-muted-foreground">
                <th className="w-8 px-3 py-2" />
                <Th k="ticker">Company</Th>
                <th className="px-3 py-2 text-right font-medium uppercase">Price</th>
                <Th k="chg" className="text-right">
                  Day
                </Th>
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
                    <td colSpan={11} className="px-3 py-2">
                      <Skeleton className="h-9" />
                    </td>
                  </tr>
                ))}
              {sorted.slice(0, limit).map((r) => (
                <tr key={r.ticker} className="border-b last:border-0 hover:bg-secondary/60">
                  <td className="px-3 py-1.5">
                    <Button variant="ghost" size="icon-sm" disabled={follow.pending} onClick={() => follow.toggle(r.ticker)} aria-label={follow.isFollowed(r.ticker) ? `Unfollow ${r.ticker}` : `Follow ${r.ticker}`}>
                      <Star className={cn("size-4 text-muted-foreground", follow.isFollowed(r.ticker) && "fill-chart-2 text-chart-2")} />
                    </Button>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} className="flex items-center gap-3">
                      <CompanyLogo ticker={r.ticker} src={r.logo} size="sm" />
                      <span>
                        <span className="num block font-semibold">{r.ticker}</span>
                        <span className="block text-xs text-muted-foreground">{coverageOf(r.ticker)?.shortName ?? r.name}<span className="hidden lg:inline"> · {coverageOf(r.ticker)?.industry}</span></span>
                      </span>
                    </Link>
                  </td>
                  <td className="num px-3 py-1.5 text-right">{fmtPrice(r.quote?.price)}</td>
                  <td className={cn("num px-3 py-1.5 text-right", (r.quote?.changePct ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(r.quote?.changePct, 2, true)}</td>
                  <td className="num px-3 py-1.5 text-right">{fmtCompactUsd(r.mcap)}</td>
                  <td className="num px-3 py-1.5 text-right">{fmtCompactUsd(r.revenueTTM)}</td>
                  <td className={cn("num px-3 py-1.5 text-right", (r.revenueGrowthYoY ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(r.revenueGrowthYoY, 1, true)}</td>
                  <td className="num px-3 py-1.5 text-right">{fmtPct(r.grossMarginTTM)}</td>
                  <td className="num px-3 py-1.5 text-right">{r.pe ? `${r.pe.toFixed(1)}×` : "—"}</td>
                  <td className="num px-3 py-1.5 text-right">{fmtPct(r.fcfYield)}</td>
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
              {!u.isLoading && sorted.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted-foreground">No companies match that filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {sorted.length > limit && <Button variant="ghost" className="mt-2 w-full" onClick={() => setLimit((n) => n + 50)}>Show 50 more · {sorted.length - limit} remaining</Button>}
      <p className="mt-3 text-[11px] text-muted-foreground">
        TTM = sum of the last four reported quarters. Revenue YoY compares the latest quarter with the same quarter a year earlier. Fundamentals snapshot generated{" "}
        {fmtDate(u.data?.generatedAt)}.
      </p>
    </div>
  );
}
