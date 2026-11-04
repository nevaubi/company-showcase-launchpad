import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { Info } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { CapitalAllocation } from "@/components/company/capital-allocation";
import { useSource } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { coverageOf } from "@/lib/coverage";
import { useCompany, usePrices, useQuotes, useUniverse } from "@/lib/data";
import { isBankIndustry } from "@/lib/financials/dataset";
import type { CompanyDataset, DerivedPart, Statement } from "@/lib/financials/types";
import {
  MULTIPLES,
  fundamentalsTimeline,
  multipleStats,
  multiplesAt,
  valuationHistory,
  type FundamentalsAt,
  type MultipleKey,
  type MultipleStats,
} from "@/lib/financials/valuation";
import { fmtCompactUsd, fmtDate, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const pageSearch = z.object({
  m: z.enum(["pe", "evEbitda", "evSales", "ps", "pfcf", "pb", "fcfYield", "divYield", "shYield"]).optional(),
  span: z.enum(["3", "5", "10"]).default("10"),
});

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/valuation")({
  validateSearch: pageSearch,
  component: Valuation,
});

const fmtMultiple = (kind: "x" | "pct", v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : kind === "x" ? `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}×` : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;

function Valuation() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const company = useCompany(ticker);
  const prices = usePrices(ticker, "10y");
  const quote = useQuotes([ticker]).data?.quotes[0];
  const bank = isBankIndustry(company.data?.profile?.industry);
  const available = MULTIPLES.filter((m) => !bank || m.bank);
  const sel = available.find((m) => m.key === s.m) ?? available[0];

  const history = useMemo(() => {
    if (!company.data || !prices.data) return [];
    const h = valuationHistory(company.data, prices.data.bars, bank);
    // Extend to the live quote using the latest filed fundamentals.
    const tl = fundamentalsTimeline(company.data);
    const last = tl.filter((f) => f.available <= new Date().toISOString().slice(0, 10)).at(-1);
    const today = new Date().toISOString().slice(0, 10);
    if (quote && last && quote.price > 0 && (h.at(-1)?.date ?? "") < today) {
      h.push({ date: today, price: quote.price, basis: last.label, ...multiplesAt(last, quote.price, bank) });
    }
    return h;
  }, [company.data, prices.data, quote, bank]);

  const cutoff = useMemo(() => new Date(Date.now() - Number(s.span) * 365.25 * 86400000).toISOString().slice(0, 10), [s.span]);
  const windowed = useMemo(() => history.filter((p) => p.date >= cutoff), [history, cutoff]);
  const stats = useMemo(() => Object.fromEntries(available.map((m) => [m.key, multipleStats(windowed.map((p) => p.values[m.key]))])) as Record<MultipleKey, MultipleStats>, [windowed, available]);

  if (!company.data || prices.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[360px]" />
        <Skeleton className="h-[300px]" />
      </div>
    );
  }
  if (!history.length) {
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Not enough quarterly history to build valuation multiples for {ticker}.</p>;
  }

  const st = stats[sel.key];
  const latest = history.at(-1)!;
  const set = (patch: Partial<z.infer<typeof pageSearch>>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const pts = (key: MultipleKey) =>
    windowed.filter((p) => p.values[key] != null).map((p) => ({ date: new Date(`${p.date}T00:00:00Z`), value: p.values[key]! }));
  const flat = (v: number | null) => (v == null ? [] : windowed.length ? [windowed[0], windowed.at(-1)!].map((p) => ({ date: new Date(`${p.date}T00:00:00Z`), value: v })) : []);
  const mult = sel.kind === "pct" ? 100 : 1;
  const scaleP = (arr: { date: Date; value: number }[]) => arr.map((p) => ({ ...p, value: p.value * mult }));
  const yFmt = (v: number) => (sel.kind === "x" ? `${v.toFixed(v >= 100 ? 0 : 1)}×` : `${v.toFixed(1)}%`);

  // Price envelope: where the stock would trade at its median multiple (and ±1σ), week by week.
  const envelope = (k: number) =>
    st.median == null || st.sd == null || sel.kind !== "x"
      ? []
      : windowed
          .filter((p) => p.values[sel.key] != null)
          .map((p) => ({ date: new Date(`${p.date}T00:00:00Z`), value: (p.price * (st.median! + k * st.sd!)) / p.values[sel.key]! }))
          .filter((p) => p.value > 0);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Valuation multiple" value={sel.key} onChange={(v) => set({ m: v })} options={available.map((m) => ({ v: m.key, l: m.short }))} />
        <Segmented className="ml-auto" label="History span" value={s.span} onChange={(v) => set({ span: v })} options={[{ v: "3", l: "3Y" }, { v: "5", l: "5Y" }, { v: "10", l: "10Y" }]} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
        {available.map((m) => (
          <MultipleCard
            key={m.key}
            def={m}
            stats={stats[m.key]}
            active={m.key === sel.key}
            onClick={() => set({ m: m.key })}
            data={company.data!}
            ticker={ticker}
            price={latest.price}
            bank={bank}
          />
        ))}
      </div>

      <Panel
        title={`${sel.label} — point in time`}
        subtitle={`${sel.help}. Each week uses only fundamentals already filed with the SEC (latest basis: ${latest.basis}).`}
      >
        <TimeSeriesChart
          height={320}
          yFormat={yFmt}
          series={[
            { id: "v", label: sel.short, color: "var(--chart-1)", points: scaleP(pts(sel.key)), area: true },
            { id: "med", label: "Median", color: "var(--foreground)", dashed: true, points: scaleP(flat(st.median)) },
            ...(st.median != null && st.sd != null
              ? [
                  { id: "hi", label: "+1σ", color: "var(--muted-foreground)", dashed: true, points: scaleP(flat(st.median + st.sd)) },
                  { id: "lo", label: "−1σ", color: "var(--muted-foreground)", dashed: true, points: scaleP(flat(Math.max(0, st.median - st.sd))) },
                ]
              : []),
          ]}
        />
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info className="size-3.5" />
          {s.span}-year median {fmtMultiple(sel.kind, st.median)} · range {fmtMultiple(sel.kind, st.min)}–{fmtMultiple(sel.kind, st.max)} · now at the{" "}
          {st.percentile == null ? "—" : `${Math.round(st.percentile * 100)}th`} percentile. Share counts are restated for stock splits.
        </p>
      </Panel>

      {sel.kind === "x" && (
        <Panel title="Price vs. valuation bands" subtitle={`Share price against the price implied by ${sel.short} at its ${s.span}-year median and ±1σ, given each week's fundamentals`}>
          <TimeSeriesChart
            height={300}
            yFormat={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`}
            series={[
              { id: "price", label: "Price", color: "var(--foreground)", points: windowed.map((p) => ({ date: new Date(`${p.date}T00:00:00Z`), value: p.price })) },
              { id: "mid", label: `At median ${sel.short}`, color: "var(--chart-1)", points: envelope(0) },
              { id: "up", label: "+1σ", color: "var(--chart-2)", dashed: true, points: envelope(1) },
              { id: "down", label: "−1σ", color: "var(--chart-4)", dashed: true, points: envelope(-1) },
            ]}
          />
        </Panel>
      )}

      <PeerMultiples ticker={ticker} bank={bank} />

      <CapitalAllocation data={company.data} ticker={ticker} />
    </div>
  );
}

/** Source attribution for a TTM figure: the four quarterly cells that sum to it. */
function ttmParts(st: Statement, key: string, label: string): DerivedPart[] {
  const row = st.rows.find((r) => r.key === key);
  if (!row) return [];
  return row.cells.slice(-4).flatMap((c, i) => {
    if (!c) return [];
    const plabel = st.periods[st.periods.length - 4 + i]?.label ?? "";
    if (c.src) return [{ ...c.src, value: c.src.value ?? c.v, label: `${label} ${plabel}`, sign: 1 as const }];
    return (c.derived?.parts ?? []).map((p) => ({ ...p, label: `${p.label} (${plabel})` }));
  });
}

function MultipleCard({
  def,
  stats,
  active,
  onClick,
  data,
  ticker,
  price,
  bank,
}: {
  def: (typeof MULTIPLES)[number];
  stats: MultipleStats;
  active: boolean;
  onClick: () => void;
  data: CompanyDataset;
  ticker: string;
  price: number;
  bank: boolean;
}) {
  const { open } = useSource();
  const q = data.statements.quarterly;
  const denom: Record<MultipleKey, [Statement, string, string] | null> = {
    pe: [q.income, "netIncome", "Net income"],
    evEbitda: [q.income, "ebitda", "EBITDA"],
    evSales: [q.income, "revenue", "Revenue"],
    ps: [q.income, "revenue", "Revenue"],
    pfcf: [q.cashflow, "fcf", "Free cash flow"],
    pb: null,
    fcfYield: [q.cashflow, "fcf", "Free cash flow"],
    divYield: [q.cashflow, "dividends", "Dividends paid"],
    shYield: [q.cashflow, "buybacks", "Buybacks"],
  };
  const showSource = () => {
    const d = denom[def.key];
    const parts = d ? ttmParts(d[0], d[1], d[2]) : [];
    const eq = q.balance.rows.find((r) => r.key === "equity")?.cells.at(-1);
    if (def.key === "pb" && eq?.src) parts.push({ ...eq.src, value: eq.src.value ?? eq.v, label: "Shareholders' equity", sign: 1 });
    open({
      ticker,
      label: def.label,
      periodLabel: "Latest",
      unit: def.kind === "x" ? "ratio" : "pct",
      value: stats.current ?? 0,
      derived: { formula: `${def.help} · price ${fmtPrice(price)} × diluted shares`, parts },
    });
  };
  const pct = stats.percentile;
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card p-3 text-left shadow-paper transition-colors",
        active ? "border-foreground ring-1 ring-foreground" : "hover:bg-secondary/50",
        bank && !def.bank && "opacity-50",
      )}
    >
      <button onClick={onClick} className="block w-full text-left">
        <p className="truncate text-[11px] text-muted-foreground">{def.short}</p>
        {stats.current == null ? (
          <p className="num mt-0.5 text-xl font-medium text-muted-foreground" title="Not meaningful: the denominator (earnings, book value, cash flow or payout) is zero, negative or not reported for the latest period">
            n.m.
          </p>
        ) : (
          <p className="num mt-0.5 text-xl font-medium">{fmtMultiple(def.kind, stats.current)}</p>
        )}
        <p className="num truncate text-[10px] text-muted-foreground">median {fmtMultiple(def.kind, stats.median)}</p>
      </button>
      <div className="mt-2 flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="relative block h-1.5 flex-1 rounded-full bg-secondary">
              {pct != null && <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${pct * 100}%` }} />}
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs">{pct == null ? "No history" : `${Math.round(pct * 100)}th percentile of the window`}</TooltipContent>
        </Tooltip>
        <button onClick={showSource} className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          source
        </button>
      </div>
    </div>
  );
}

function PeerMultiples({ ticker, bank }: { ticker: string; bank: boolean }) {
  const universe = useUniverse();
  const peers = [ticker, ...(coverageOf(ticker)?.peers ?? [])].filter((t, i, a) => a.indexOf(t) === i && universe.data?.companies.some((c) => c.ticker === t));
  const quotes = useQuotes(peers);
  const cols = MULTIPLES.filter((m) => (bank ? m.bank : ["pe", "evEbitda", "ps", "pfcf", "fcfYield", "divYield"].includes(m.key)));
  const rows = peers.map((t) => {
    const u = universe.data!.companies.find((c) => c.ticker === t)!;
    const price = quotes.data?.quotes.find((q) => q.symbol.toUpperCase() === t)?.price ?? null;
    const f = u.f;
    const peerBank = isBankIndustry(u.industry);
    const fa: FundamentalsAt | null = f
      ? {
          end: f.asOf ?? "",
          available: f.asOf ?? "",
          label: "TTM",
          shares: f.dilutedShares,
          revenue: f.ttm.revenue ?? null,
          ebitda: f.ttm.ebitda ?? null,
          netIncome: f.ttm.netIncome ?? null,
          fcf: f.ttm.fcf ?? null,
          dividends: f.ttm.dividends != null ? Math.abs(f.ttm.dividends) : null,
          buybacks: f.ttm.buybacks != null ? Math.abs(f.ttm.buybacks) : null,
          debt: f.bs.totalDebt ?? null,
          cash: f.bs.cash != null ? f.bs.cash + (f.bs.shortTermInvestments ?? 0) : null,
          equity: f.bs.equity ?? null,
        }
      : null;
    const m = fa && price ? multiplesAt(fa, price, peerBank) : null;
    return { t, u, price, m };
  });
  const med = Object.fromEntries(
    cols.map((c) => [c.key, multipleStats(rows.filter((r) => r.t !== ticker).map((r) => r.m?.values[c.key] ?? null)).median]),
  ) as Record<MultipleKey, number | null>;

  return (
    <Panel title="Peer multiples" subtitle="Live price × latest diluted shares against trailing-twelve-month fundamentals from each company's filings" bodyClassName="p-0">
      {!universe.data ? (
        <Skeleton className="m-4 h-40" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Market cap</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right font-medium">
                    {c.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t} className={cn("border-b last:border-0", r.t === ticker && "bg-highlight-soft")}>
                  <td className="px-4 py-2">
                    <Link to="/app/companies/$ticker/valuation" params={{ ticker: r.t }} className="flex items-center gap-2 hover:underline">
                      <CompanyLogo ticker={r.t} size="xs" />
                      <span className="num font-medium">{r.t}</span>
                      <span className="truncate text-muted-foreground">{coverageOf(r.t)?.shortName ?? r.u.name}</span>
                    </Link>
                  </td>
                  <td className="num px-3 py-2 text-right">{r.price == null ? <Skeleton className="ml-auto h-4 w-12" /> : fmtPrice(r.price)}</td>
                  <td className="num px-3 py-2 text-right">{r.m?.mcap ? fmtCompactUsd(r.m.mcap) : "—"}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="num px-3 py-2 text-right">
                      {fmtMultiple(c.kind, r.m?.values[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t bg-secondary/40 text-muted-foreground">
                <td className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider">Peer median</td>
                <td />
                <td />
                {cols.map((c) => (
                  <td key={c.key} className="num px-3 py-2 text-right">
                    {fmtMultiple(c.kind, med[c.key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Fundamentals as of each company's latest filed quarter ({fmtDate(rows[0]?.u.f?.asOf)} for {ticker}). Banks show only price-based multiples.
          </p>
        </div>
      )}
    </Panel>
  );
}
