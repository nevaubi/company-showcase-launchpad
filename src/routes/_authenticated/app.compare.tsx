import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { z } from "zod";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { MultiLine, type LineSeries } from "@/components/charts/multi-line";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { companyQuery, pricesQuery, type Range } from "@/lib/data";
import { useScreenRows } from "@/lib/screener/use-rows";
import { fmtField, type Row as SRow } from "@/lib/screener/engine";
import type { Cell, CompanyDataset, DerivedPart, Statement } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const search = z.object({ t: z.string().optional() });

export const Route = createFileRoute("/_authenticated/app/compare")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Compare companies — Filed Under" },
      {
        name: "description",
        content:
          "Side-by-side valuation, growth, margins and returns for up to eight companies, with reported figures traced to SEC filings.",
      },
      { property: "og:title", content: "Compare companies — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Compare,
});

const MAXN = 8;
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "oklch(0.55 0.12 300)",
  "oklch(0.6 0.1 60)",
];

type Metric = { id: string; n: string; hib: boolean | null; group: string };
const METRICS: Metric[] = [
  { id: "mcap", n: "Market cap", hib: null, group: "Market" },
  { id: "ret_1y", n: "1Y return", hib: true, group: "Market" },
  { id: "beta", n: "Beta", hib: null, group: "Market" },
  { id: "vol_1y", n: "Volatility 1Y", hib: false, group: "Market" },
  { id: "pe", n: "P/E", hib: false, group: "Valuation" },
  { id: "ev_sales", n: "EV/Sales", hib: false, group: "Valuation" },
  { id: "ev_ebit", n: "EV/EBIT", hib: false, group: "Valuation" },
  { id: "fcf_yield", n: "FCF yield", hib: true, group: "Valuation" },
  { id: "pb", n: "P/B", hib: false, group: "Valuation" },
  { id: "div_yield", n: "Dividend yield", hib: null, group: "Valuation" },
  { id: "rev_g_ttm", n: "Revenue growth TTM", hib: true, group: "Growth" },
  { id: "rev_cagr3", n: "Revenue CAGR 3Y", hib: true, group: "Growth" },
  { id: "eps_g_ttm", n: "EPS growth TTM", hib: true, group: "Growth" },
  { id: "gm", n: "Gross margin", hib: true, group: "Profitability" },
  { id: "om", n: "Operating margin", hib: true, group: "Profitability" },
  { id: "nm", n: "Net margin", hib: true, group: "Profitability" },
  { id: "fcfm", n: "FCF margin", hib: true, group: "Profitability" },
  { id: "roic", n: "ROIC", hib: true, group: "Profitability" },
  { id: "roe", n: "ROE", hib: true, group: "Profitability" },
  { id: "nd_ebitda", n: "Net debt / EBITDA", hib: false, group: "Balance sheet" },
  { id: "sbc_pct", n: "SBC % of revenue", hib: false, group: "Balance sheet" },
];

/** Reported lines summed over the last four quarters (or the latest balance), each traced to its filings. */
const REPORTED: { key: string; st: "income" | "cashflow" | "balance"; n: string; ttm: boolean }[] =
  [
    { key: "revenue", st: "income", n: "Revenue (TTM)", ttm: true },
    { key: "operatingIncome", st: "income", n: "Operating income (TTM)", ttm: true },
    { key: "netIncome", st: "income", n: "Net income (TTM)", ttm: true },
    { key: "fcf", st: "cashflow", n: "Free cash flow (TTM)", ttm: true },
    { key: "cash", st: "balance", n: "Cash", ttm: false },
    { key: "totalDebt", st: "balance", n: "Total debt", ttm: false },
  ];

function lastN(st: Statement | undefined, key: string, n: number) {
  const row = st?.rows.find((r) => r.key === key);
  if (!row || !st) return null;
  const out: { cell: Cell; label: string; end: string }[] = [];
  for (let i = row.cells.length - 1; i >= 0 && out.length < n; i--) {
    const c = row.cells[i];
    if (!c) return out.length ? null : null;
    out.unshift({ cell: c, label: st.periods[i].label, end: st.periods[i].end });
  }
  return out.length === n ? out : null;
}
function partsOf(x: { cell: Cell; label: string }): DerivedPart[] {
  if (x.cell.src) return [{ ...x.cell.src, value: x.cell.v, label: x.label, sign: 1 }];
  return (x.cell.derived?.parts ?? []).map((p) => ({ ...p, label: `${x.label}: ${p.label}` }));
}
const fmtUsd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v),
    s = v < 0 ? "−" : "";
  return a >= 1e12
    ? `${s}$${(a / 1e12).toFixed(2)}T`
    : a >= 1e9
      ? `${s}$${(a / 1e9).toFixed(1)}B`
      : `${s}$${(a / 1e6).toFixed(0)}M`;
};

function Compare() {
  const { t } = Route.useSearch();
  const navigate = useNavigate({ from: "/app/compare" });
  const tickers = useMemo(
    () =>
      [
        ...new Set(
          (t ?? "")
            .split(",")
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean),
        ),
      ].slice(0, MAXN),
    [t],
  );
  const setTickers = (next: string[]) =>
    navigate({ search: { t: next.length ? next.join(",") : undefined }, replace: true });
  const { F, rows, uni } = useScreenRows(true);
  const byTk = useMemo(() => new Map(rows.map((r) => [r.ticker, r])), [rows]);
  const [q, setQ] = useState("");
  const [range, setRange] = useState<Range>("1y");
  const [fin, setFin] = useState<"growth" | "om" | "nm" | "fcfm">("growth");
  const { open } = useSource();
  const color = (tk: string) => COLORS[tickers.indexOf(tk) % COLORS.length];

  const datasets = useQueries({
    queries: tickers.map((tk) => ({ ...companyQuery(tk), staleTime: 3600_000 })),
  });
  const prices = useQueries({ queries: tickers.map((tk) => pricesQuery(tk, range)) });
  const ds = useMemo(
    () => new Map(tickers.map((tk, i) => [tk, datasets[i]?.data as CompanyDataset | undefined])),
    [tickers, datasets],
  );

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return (uni.data?.companies ?? [])
      .filter(
        (c) =>
          !tickers.includes(c.ticker) &&
          (c.ticker.toLowerCase().startsWith(s) || c.name.toLowerCase().includes(s)),
      )
      .sort((a, b) =>
        a.ticker.toLowerCase() === s
          ? -1
          : b.ticker.toLowerCase() === s
            ? 1
            : (b.revenueTTM ?? 0) - (a.revenueTTM ?? 0),
      )
      .slice(0, 8);
  }, [q, uni.data, tickers]);
  const suggestions = useMemo(() => {
    const first = tickers[0] ? uni.data?.companies.find((c) => c.ticker === tickers[0]) : undefined;
    if (!first) return [];
    return (uni.data?.companies ?? [])
      .filter((c) => c.industry === first.industry && !tickers.includes(c.ticker))
      .sort((a, b) => (b.revenueTTM ?? 0) - (a.revenueTTM ?? 0))
      .slice(0, 6);
  }, [tickers, uni.data]);

  const add = (tk: string) => {
    if (tickers.length < MAXN && !tickers.includes(tk)) setTickers([...tickers, tk]);
    setQ("");
  };

  // Rebased price performance.
  const priceSeries: LineSeries[] = tickers.map((tk, i) => {
    const bars = prices[i]?.data?.bars ?? [];
    const base = bars.find((b) => b[4] > 0)?.[4];
    return {
      key: tk,
      label: tk,
      color: color(tk),
      points: base ? bars.map((b) => ({ x: b[0].slice(0, 10), y: (b[4] / base - 1) * 100 })) : [],
    };
  });

  // Quarterly fundamentals by calendar quarter end (month precision so fiscal calendars line up).
  const finSeries: LineSeries[] = tickers.map((tk) => {
    const d = ds.get(tk);
    const inc = d?.statements.quarterly.income,
      cf = d?.statements.quarterly.cashflow;
    const get = (st: Statement | undefined, key: string) =>
      st?.rows.find((r) => r.key === key)?.cells ?? [];
    const rev = get(inc, "revenue"),
      oi = get(inc, "operatingIncome"),
      ni = get(inc, "netIncome"),
      fcf = get(cf, "fcf");
    const ends = inc?.periods.map((p) => p.end) ?? [];
    const cfIdx = new Map((cf?.periods ?? []).map((p, i) => [p.end, i]));
    const pts = ends.map((end, i) => {
      const r = rev[i]?.v;
      let y: number | null = null;
      if (fin === "growth") {
        const prior = ends.findIndex(
          (e) => Math.abs(Date.parse(end) - Date.parse(e) - 365 * 864e5) < 20 * 864e5,
        );
        const r0 = prior >= 0 ? rev[prior]?.v : undefined;
        y = r != null && r0 ? (r / r0 - 1) * 100 : null;
      } else if (r) {
        const num =
          fin === "om" ? oi[i]?.v : fin === "nm" ? ni[i]?.v : fcf[cfIdx.get(end) ?? -1]?.v;
        y = num != null ? (num / r) * 100 : null;
      }
      return { x: end.slice(0, 7), y };
    });
    return { key: tk, label: tk, color: color(tk), points: pts.slice(-16) };
  });

  const openReported = (tk: string, R: (typeof REPORTED)[number]) => {
    const d = ds.get(tk);
    const st = d?.statements.quarterly[R.st];
    const xs = lastN(st, R.key, R.ttm ? 4 : 1);
    if (!xs) return;
    const v = xs.reduce((a, x) => a + x.cell.v, 0);
    if (!R.ttm && xs[0].cell.src)
      return open({
        ticker: tk,
        label: R.n,
        periodLabel: xs[0].label,
        unit: "usd",
        value: v,
        src: { ...xs[0].cell.src, value: v },
      });
    open({
      ticker: tk,
      label: R.n,
      periodLabel: `four quarters to ${fmtDate(xs[xs.length - 1].end)}`,
      unit: "usd",
      value: v,
      derived: { formula: xs.map((x) => x.label).join(" + "), parts: xs.flatMap(partsOf) },
    });
  };
  const reportedValue = (tk: string, R: (typeof REPORTED)[number]) => {
    const xs = lastN(ds.get(tk)?.statements.quarterly[R.st], R.key, R.ttm ? 4 : 1);
    return xs ? xs.reduce((a, x) => a + x.cell.v, 0) : null;
  };

  const rank = (m: Metric) => {
    if (m.hib == null) return new Map<string, "best" | "worst">();
    const vals = tickers
      .map((tk) => [tk, byTk.get(tk)?.[m.id]] as const)
      .filter((x): x is readonly [string, number] => typeof x[1] === "number");
    if (vals.length < 2) return new Map<string, "best" | "worst">();
    const s = [...vals].sort((a, b) => (m.hib ? b[1] - a[1] : a[1] - b[1]));
    return new Map<string, "best" | "worst">([
      [s[0][0], "best"],
      [s[s.length - 1][0], "worst"],
    ]);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Research"
        title="Compare companies"
        description="Up to eight companies side by side. Market and ratio fields from the screener dataset; reported lines trace to the SEC filings."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tickers.map((tk) => (
          <span
            key={tk}
            className="inline-flex h-8 items-center gap-2 rounded-full border bg-card pl-2 pr-1 text-sm font-medium"
          >
            <span className="size-2.5 rounded-full" style={{ background: color(tk) }} />
            <Link
              to="/app/companies/$ticker"
              params={{ ticker: tk }}
              className="num hover:underline"
            >
              {tk}
            </Link>
            <button
              type="button"
              aria-label={`Remove ${tk}`}
              onClick={() => setTickers(tickers.filter((x) => x !== tk))}
              className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {tickers.length < MAXN && (
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && matches[0] && add(matches[0].ticker)}
              placeholder={tickers.length ? "Add a company" : "Search a company to start"}
              aria-label="Add a company"
              className="h-8 w-60 rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {matches.length > 0 && (
              <div className="absolute left-0 top-9 z-30 w-80 rounded-md border bg-popover p-1 shadow-panel">
                {matches.map((c) => (
                  <button
                    key={c.ticker}
                    type="button"
                    onClick={() => add(c.ticker)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary"
                  >
                    <span className="num w-14 font-medium">{c.ticker}</span>
                    <span className="truncate text-muted-foreground">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {suggestions.length > 0 && tickers.length < MAXN && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Same industry:
            {suggestions.map((c) => (
              <button
                key={c.ticker}
                type="button"
                onClick={() => add(c.ticker)}
                className="num rounded border px-1.5 py-0.5 hover:bg-secondary hover:text-foreground"
              >
                +{c.ticker}
              </button>
            ))}
          </span>
        )}
      </div>

      {tickers.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">
          Add companies above, or start from a pair:{" "}
          {[
            ["NVDA", "AMD", "AVGO"],
            ["JPM", "BAC", "WFC", "C"],
            ["COST", "WMT", "TGT"],
            ["MSFT", "GOOGL", "AMZN", "META"],
          ].map((set) => (
            <button
              key={set.join()}
              type="button"
              onClick={() => setTickers(set)}
              className="num mr-2 rounded border px-2 py-0.5 text-foreground hover:bg-secondary"
            >
              {set.join(" · ")}
            </button>
          ))}
        </div>
      ) : !rows.length ? (
        <Skeleton className="h-[420px]" />
      ) : (
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 min-w-48 border-b border-r bg-card px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Metric
                    </th>
                    {tickers.map((tk) => (
                      <th key={tk} className="min-w-32 border-b bg-card px-3 py-2 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <CompanyLogo ticker={tk} size="xs" />
                          <span className="num font-medium">{tk}</span>
                          <span className="h-0.5 w-3" style={{ background: color(tk) }} />
                        </span>
                        <span className="block truncate text-[11px] font-normal text-muted-foreground">
                          {byTk.get(tk)?.name ?? "Not in the universe"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td
                      colSpan={tickers.length + 1}
                      className="border-b bg-secondary px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      Reported, from filings
                    </td>
                  </tr>
                  {REPORTED.map((R) => (
                    <tr key={R.key} className="group">
                      <td className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary">
                        {R.n}
                      </td>
                      {tickers.map((tk) => {
                        const v = reportedValue(tk, R);
                        return (
                          <td
                            key={tk}
                            className="border-b px-3 py-1.5 text-right group-hover:bg-secondary"
                          >
                            {v == null ? (
                              <span className="text-muted-foreground/50">
                                {ds.get(tk) ? "–" : "…"}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openReported(tk, R)}
                                title="Open the filings behind this value"
                                className={cn(
                                  "num tabular-nums decoration-dotted underline-offset-2 hover:underline",
                                  v < 0 && "text-negative",
                                )}
                              >
                                {fmtUsd(v)}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {[...new Set(METRICS.map((m) => m.group))].map((g) => (
                    <MetricGroup
                      key={g}
                      title={g}
                      metrics={METRICS.filter((m) => m.group === g)}
                      tickers={tickers}
                      byTk={byTk}
                      F={F}
                      rank={rank}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Best and worst in the set are marked where a direction is meaningful. Ratios use
              trailing four quarters and the live price where quoted. Reported lines open every
              filing value that makes them up.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel
              title="Price performance"
              subtitle="Total price change from the first close in the window, %"
              actions={
                <Segmented
                  size="xs"
                  label="Range"
                  value={range}
                  onChange={setRange}
                  options={[
                    { v: "6mo", l: "6M" },
                    { v: "1y", l: "1Y" },
                    { v: "2y", l: "2Y" },
                    { v: "5y", l: "5Y" },
                  ]}
                />
              }
              collapse={false}
            >
              <div className="px-3 py-2">
                <MultiLine
                  series={priceSeries}
                  label="Rebased price performance"
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
                  baseline={0}
                  xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
                />
              </div>
            </Panel>
            <Panel
              title="Quarterly fundamentals"
              subtitle="By quarter end, from the filed statements"
              actions={
                <Segmented
                  size="xs"
                  label="Metric"
                  value={fin}
                  onChange={setFin}
                  options={[
                    { v: "growth", l: "Revenue YoY" },
                    { v: "om", l: "Op margin" },
                    { v: "nm", l: "Net margin" },
                    { v: "fcfm", l: "FCF margin" },
                  ]}
                />
              }
              collapse={false}
            >
              <div className="px-3 py-2">
                <MultiLine
                  series={finSeries}
                  label="Quarterly fundamentals"
                  format={(v) => `${v.toFixed(0)}%`}
                  baseline={fin === "growth" ? 0 : undefined}
                  xFormat={(x) => fmtDate(`${x}-15`, { month: "short", year: "2-digit" })}
                />
              </div>
            </Panel>
          </div>

          <RevenueHistory tickers={tickers} color={color} uni={uni.data?.companies ?? []} />
        </div>
      )}
    </div>
  );
}

function MetricGroup({
  title,
  metrics,
  tickers,
  byTk,
  F,
  rank,
}: {
  title: string;
  metrics: Metric[];
  tickers: string[];
  byTk: Map<string, SRow>;
  F: ReturnType<typeof useScreenRows>["F"];
  rank: (m: Metric) => Map<string, "best" | "worst">;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={tickers.length + 1}
          className="border-b bg-secondary px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {title}
        </td>
      </tr>
      {metrics.map((m) => {
        const r = rank(m);
        const f = F.get(m.id);
        return (
          <tr key={m.id} className="group">
            <td
              className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary"
              title={f ? `${f.d}${f.src ? `\nSource: ${f.src}` : ""}` : undefined}
            >
              {f?.n ?? m.n}
            </td>
            {tickers.map((tk) => {
              const v = byTk.get(tk)?.[m.id];
              const tag = r.get(tk);
              return (
                <td
                  key={tk}
                  className={cn(
                    "num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary",
                    v == null && "text-muted-foreground/50",
                    tag === "best" && "bg-positive-soft font-medium",
                    tag === "worst" && "text-negative",
                  )}
                >
                  {fmtField(
                    f ?? {
                      id: m.id,
                      g: "",
                      n: m.n,
                      u:
                        m.id === "mcap" || m.id === "net_debt"
                          ? "usd"
                          : /pe|ev_|pb|nd_/.test(m.id)
                            ? "x"
                            : m.id === "beta"
                              ? "num"
                              : "pct",
                      d: "",
                    },
                    v,
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

function RevenueHistory({
  tickers,
  color,
  uni,
}: {
  tickers: string[];
  color: (t: string) => string;
  uni: { ticker: string; f?: { revenueHistory: [string, number][] } }[];
}) {
  const hist = tickers.map((tk) => ({
    tk,
    h: uni.find((c) => c.ticker === tk)?.f?.revenueHistory ?? [],
  }));
  const n = Math.max(0, ...hist.map((x) => x.h.length));
  if (!n) return null;
  return (
    <Panel
      title="Annual revenue"
      subtitle="Last ten fiscal years from 10-K filings; fiscal years end in different months"
      collapse={false}
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b text-left">
              <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Company
              </th>
              {Array.from({ length: n }, (_, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground"
                >
                  {i === n - 1 ? "Latest FY" : `FY −${n - 1 - i}`}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">
                CAGR
              </th>
            </tr>
          </thead>
          <tbody>
            {hist.map(({ tk, h }) => {
              const pad = Array.from({ length: n - h.length }, () => null);
              const first = h.find(([, v]) => v > 0),
                last = h.at(-1);
              const yrs = first && last ? h.length - 1 - h.indexOf(first) : 0;
              const cagr =
                first && last && yrs > 0 && last[1] > 0
                  ? (last[1] / first[1]) ** (1 / yrs) - 1
                  : null;
              return (
                <tr key={tk} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: color(tk) }} />
                      <span className="num font-medium">{tk}</span>
                    </span>
                  </td>
                  {[...pad, ...h].map((x, i) => (
                    <td
                      key={i}
                      className="num px-3 py-1.5 text-right tabular-nums"
                      title={x ? x[0] : undefined}
                    >
                      {x ? fmtUsd(x[1]) : ""}
                    </td>
                  ))}
                  <td className="num px-3 py-1.5 text-right tabular-nums">
                    {cagr == null ? "–" : `${(cagr * 100).toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
