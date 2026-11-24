import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowDown, ArrowUp, Check, Download, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { columnScale, fmtChange, fmtInScale, modalEnd, modalPeriod, periodMark, type ColumnScale } from "@/lib/kpis/matrix";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSource } from "@/components/source/source-context";
import { partnerFile, useQuotes, useUniverse } from "@/lib/data";
import { COVERAGE_TICKERS, coverageOf } from "@/lib/coverage";
import { kpiFileQuery, kpiItems, type KpiValue } from "@/lib/statements/filed";
import { useSessionState } from "@/lib/use-session-state";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFits } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";

export const Route = createFileRoute("/_authenticated/app/kpis")({
  head: () => ({
    meta: [
      { title: "KPI matrix · FiledUnder" },
      {
        name: "description",
        content:
          "Operating KPIs standardized across companies (comparable sales, backlog, NIM, occupancy, subscribers and more), each value linked to the release it was read from.",
      },
      { property: "og:title", content: "KPI matrix · FiledUnder" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KpiMatrix,
});

interface TaxKpi {
  id: string;
  name: string;
  family: string;
  uclass: string;
  unit: string;
  definition: string;
  industries: string[];
  higher_is_better: boolean | null;
  coverage: { companies: number };
}
type Point = [string, number, string, number | null] | null;
interface Latest {
  generated: string;
  kpis: Record<
    string,
    Record<string, { q: Point; a: Point; ind: string; sec: string; kpi_id: string }>
  >;
}

const STALE_DAYS = 548;
const MAX_COLS = 12;
const DEFAULT_COLS = 8;
const STICKY = "top-[var(--sticky-top,3.5rem)]";

function fmtK(v: number | null | undefined, k: TaxKpi) {
  if (v == null || !Number.isFinite(v)) return DASH;
  if (k.uclass === "pct") return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
  if (k.uclass === "x") return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}×`;
  if (k.uclass === "usd_ps" || k.uclass === "usd_pu") return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  if (k.uclass === "usd") {
    const a = Math.abs(v),
      s = v < 0 ? "−" : "";
    return a >= 1e9
      ? `${s}$${(a / 1e9).toFixed(1)}B`
      : a >= 1e6
        ? `${s}$${(a / 1e6).toFixed(0)}M`
        : `${s}$${a.toLocaleString("en-US")}`;
  }
  const a = Math.abs(v);
  const tail = k.unit && !["count", "%", "USD", "x"].includes(k.unit) ? ` ${k.unit}` : "";
  const body =
    a >= 1e9
      ? `${(a / 1e9).toFixed(1)}B`
      : a >= 1e6
        ? `${(a / 1e6).toFixed(1)}M`
        : a >= 1e4
          ? `${(a / 1e3).toFixed(0)}K`
          : a.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}${body}${tail}`;
}
function fmtChg(c: number | null | undefined, k: TaxKpi) {
  if (c == null || !Number.isFinite(c)) return "";
  if (k.uclass === "pct") return `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(c).toFixed(1)} pt`;
  return `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(c * 100).toFixed(1)}%`;
}
const age = (d: string) => (Date.now() - Date.parse(d)) / 864e5;

function KpiMatrix() {
  const tax = useQuery({
    queryKey: ["kpistd", "taxonomy"],
    queryFn: () => partnerFile<{ kpis: TaxKpi[] }>("kpistd/taxonomy.json"),
    staleTime: 3600_000,
  });
  const latest = useQuery({
    queryKey: ["kpistd", "latest"],
    queryFn: () => partnerFile<Latest>("kpistd/latest.json"),
    staleTime: 3600_000,
  });
  const uni = useUniverse();
  const [K, setK] = useSessionState<"q" | "a">("fu:kpis:K", "q");
  const [scope, setScope] = useSessionState("fu:kpis:scope", "sec:Financials");
  const [picked, setPicked] = useSessionState<string[]>("fu:kpis:picked", []);
  const [view, setView] = useSessionState<"value" | "change">("fu:kpis:view", "value");
  const [hideStale, setHideStale] = useSessionState("fu:kpis:stale", true);
  const [heat, setHeat] = useSessionState("fu:kpis:heat", true);
  const [sort, setSort] = useState<{ c: string; d: 1 | -1 }>({ c: "mcap", d: -1 });
  const { open } = useSource();
  const qc = useQueryClient();
  const [wrap, fits] = useFits<HTMLDivElement>();
  const navigate = useNavigate();

  const byTk = useMemo(
    () => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c])),
    [uni.data],
  );
  const quotes = useQuotes(COVERAGE_TICKERS);
  const live = useMemo(
    () => new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q.price])),
    [quotes.data],
  );

  const KP = useMemo(
    () =>
      (tax.data?.kpis ?? []).filter(
        (k) =>
          !/^(total_revenue|adjusted_)/.test(k.id) ||
          k.id === "adjusted_ebitda_margin" ||
          k.id === "adjusted_operating_margin",
      ),
    [tax.data],
  );
  const scopes = useMemo(() => {
    const sec = new Map<string, number>(),
      ind = new Map<string, number>();
    for (const per of Object.values(latest.data?.kpis ?? {}))
      for (const r of Object.values(per)) {
        sec.set(r.sec, (sec.get(r.sec) ?? 0) + 1);
        ind.set(r.ind, (ind.get(r.ind) ?? 0) + 1);
      }
    return { sec: [...sec.keys()].sort(), ind: [...ind.keys()].sort() };
  }, [latest.data]);
  const inScope = (r: { sec: string; ind: string }) =>
    scope === "all" ||
    (scope.startsWith("sec:") ? r.sec === scope.slice(4) : r.ind === scope.slice(4));
  const fresh = (p: Point) => !!p && (!hideStale || age(p[0]) <= STALE_DAYS);

  // KPIs ranked by how many companies in scope report them freshly.
  const ranked = useMemo(() => {
    const L = latest.data?.kpis ?? {};
    return KP.map((k) => ({
      k,
      n: Object.values(L[k.id] ?? {}).filter((r) => inScope(r) && fresh(r[K])).length,
    }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [KP, latest.data, scope, K, hideStale]);
  const cols = (
    picked.length
      ? picked.map((id) => ranked.find((x) => x.k.id === id)).filter(Boolean)
      : ranked.slice(0, DEFAULT_COLS)
  ) as { k: TaxKpi; n: number }[];

  const rows = useMemo(() => {
    const L = latest.data?.kpis ?? {};
    const tks = new Set<string>();
    for (const { k } of cols)
      for (const [t, r] of Object.entries(L[k.id] ?? {})) if (inScope(r) && fresh(r[K])) tks.add(t);
    return [...tks].map((t) => {
      const u = byTk.get(t);
      const px = live.get(t);
      const mcap = px && u?.sharesOutstanding ? px * u.sharesOutstanding : null;
      const cells = Object.fromEntries(
        cols.map(({ k }) => {
          const r = L[k.id]?.[t];
          return [k.id, r && fresh(r[K]) ? { p: r[K]!, kpiId: r.kpi_id } : null];
        }),
      );
      return {
        t,
        name: coverageOf(t)?.shortName ?? u?.name ?? t,
        ind: Object.values(L).find((x) => x[t])?.[t]?.ind ?? "",
        mcap,
        revg: u?.revenueGrowthYoY ?? null,
        cells,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest.data, cols.map((c) => c.k.id).join(), scope, K, hideStale, byTk, live]);

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]) => {
      if (sort.c === "mcap") return r.mcap;
      if (sort.c === "revg") return r.revg;
      if (sort.c === "t") return null;
      const c = r.cells[sort.c];
      return c ? (view === "change" ? c.p[3] : c.p[1]) : null;
    };
    return [...rows].sort((a, b) => {
      if (sort.c === "t") return sort.d * a.t.localeCompare(b.t);
      const x = val(a),
        y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.d * (x - y);
    });
  }, [rows, sort, view]);

  // Heat: rank within each column, direction from the taxonomy.
  const heatOf = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const { k } of cols) {
      const vals = rows
        .map(
          (r) =>
            [
              r.t,
              r.cells[k.id]
                ? view === "change"
                  ? r.cells[k.id]!.p[3]
                  : r.cells[k.id]!.p[1]
                : null,
            ] as const,
        )
        .filter((x): x is readonly [string, number] => x[1] != null);
      if (
        vals.length < 3 ||
        (view === "value" && (k.higher_is_better == null || !["pct", "x"].includes(k.uclass)))
      )
        continue;
      const s = [...vals].sort((a, b) => a[1] - b[1]);
      const dir = k.higher_is_better === false ? -1 : 1;
      m.set(k.id, new Map(s.map(([t], i) => [t, dir * (i / (s.length - 1) - 0.5) * 2])));
    }
    return m;
  }, [rows, cols, view]);

  async function openCell(t: string, k: TaxKpi, kpiId: string, p: NonNullable<Point>) {
    const label = `${k.name} · ${p[2]}`;
    try {
      const file = await qc.fetchQuery(kpiFileQuery(t));
      const it = kpiItems(file).find((x) => x.id === kpiId);
      // Values are keyed by period kind (Q, A, I for point-in-time, Y and T for year-to-date and trailing).
      const buckets = Object.values((it?.values ?? {}) as Record<string, Record<string, KpiValue>>);
      const v =
        buckets
          .map((b) => b[p[0]])
          .find((x) => x && Math.abs(x.v - p[1]) <= Math.abs(p[1]) * 1e-6) ??
        buckets.map((b) => b[p[0]]).find(Boolean) ??
        buckets.flatMap((b) => Object.values(b)).find((x) => x.v === p[1]);
      if (v?.url)
        return open({
          ticker: t,
          label,
          periodLabel: fmtDate(p[0]),
          unit: k.uclass === "pct" ? "pct" : "usd",
          value: p[1],
          external: {
            url: v.url,
            quote: v.quote ?? v.printed,
            date: p[0],
            confidence: `${v.doc_title ?? "Company document"} · company KPI "${it?.name ?? kpiId}" mapped to ${k.name}`,
          },
        });
    } catch {
      /* fall through */
    }
    open({
      ticker: t,
      label,
      periodLabel: fmtDate(p[0]),
      unit: "usd",
      value: p[1],
      external: {
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${byTk.get(t)?.cik ?? ""}&type=8-K`,
        quote: `${k.name}: ${fmtK(p[1], k)} for ${p[2]} (company KPI ${kpiId}).`,
        date: p[0],
        confidence:
          "Stored source record not found for this value; showing the company's 8-K list.",
      },
    });
  }

  const togglePick = (id: string) =>
    setPicked((cur) => {
      const base = cur.length ? cur : cols.map((c) => c.k.id);
      return base.includes(id)
        ? base.filter((x) => x !== id)
        : base.length >= MAX_COLS
          ? base
          : [...base, id];
    });
  const csv = () => {
    const head = [
      "ticker",
      "name",
      "industry",
      ...cols.flatMap(({ k }) => [
        `${k.name} (${K === "q" ? "quarter" : "year"})`,
        `${k.name} period`,
        `${k.name} change`,
      ]),
    ];
    const lines = [
      head.join(","),
      ...sorted.map((r) =>
        [
          r.t,
          JSON.stringify(r.name),
          JSON.stringify(r.ind),
          ...cols.flatMap(({ k }) => {
            const c = r.cells[k.id];
            return c ? [c.p[1], c.p[2], c.p[3] ?? ""] : ["", "", ""];
          }),
        ].join(","),
      ),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF", lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "kpi-matrix.csv";
    a.click();
    const href = a.href;
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  // One unit and scale per column, and the period most companies in it report.
  const colMeta = useMemo(() => {
    const m = new Map<string, { scale: ColumnScale; period: string | null; end: string | null }>();
    for (const { k } of cols) {
      const pts = rows.map((r) => r.cells[k.id]?.p ?? null);
      m.set(k.id, { scale: columnScale(k, pts.filter(Boolean).map((p) => p![1])), period: modalPeriod(pts), end: modalEnd(pts) });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const fmtMcap = (v: number | null) => (v == null ? DASH : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);

  const thCtx: ThCtx = { sort, setSort, fits };

  if (tax.isError || latest.isError)
    return (
      <div>
        <PageHeader eyebrow="Companies" title="KPI matrix" />
        <DataUnavailable
          title="The standardized KPI dataset is not available"
          error={tax.error ?? latest.error}
          onRetry={() => {
            void tax.refetch();
            void latest.refetch();
          }}
        />
      </div>
    );
  const families = [...new Set(ranked.map((x) => x.k.family))];
  const scopeName = scope === "all" ? "all companies" : scope.slice(4);
  return (
    <div>
      <PageHeader
        eyebrow="Companies"
        title="KPI matrix"
        description={latest.data ? `Operating KPIs read from company releases and mapped to common definitions · built ${fmtDate(latest.data.generated.slice(0, 10))}` : undefined}
      />
      <div data-section="KPI matrix controls" data-agent-controls className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={scope}
          onValueChange={(v) => {
            setScope(v);
            setPicked([]);
          }}
        >
          <SelectTrigger aria-label="Companies" className="h-8 w-56 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {scopes.sec.map((s) => (
              <SelectItem key={s} value={`sec:${s}`}>
                Sector · {s}
              </SelectItem>
            ))}
            {scopes.ind.map((s) => (
              <SelectItem key={s} value={`ind:${s}`}>
                Industry · {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 text-xs" aria-label="Choose KPIs" disabled={!ranked.length}>
              <ListChecks /> KPIs · {cols.length}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 p-0">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                Up to {MAX_COLS} columns · count = companies in {scopeName} reporting it
              </p>
              <Button size="xs" variant="ghost" onClick={() => setPicked([])}>
                Most reported
              </Button>
            </div>
            <div role="group" aria-label="KPIs shown as columns" className="max-h-96 overflow-y-auto overscroll-contain p-1 scrollbar-thin">
              {families.map((fam) => (
                <div key={fam} className="py-1">
                  <p className="eyebrow px-2 py-1">{fam}</p>
                  {ranked
                    .filter((x) => x.k.family === fam)
                    .map(({ k, n }) => {
                      const on = cols.some((c) => c.k.id === k.id);
                      return (
                        <button
                          key={k.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => togglePick(k.id)}
                          title={k.definition}
                          className="flex min-h-7 w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className={cn("grid size-3.5 shrink-0 place-items-center rounded-sm border", on && "border-foreground bg-foreground text-background")}>{on && <Check className="size-3" />}</span>
                          <span className="min-w-0 flex-1 truncate">{k.name}</span>
                          <span className="num text-[11px] text-muted-foreground">{n}</span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Segmented size="xs" label="Period" value={K} onChange={setK} options={[{ v: "q", l: "Latest quarter" }, { v: "a", l: "Latest year" }]} />
        <Segmented size="xs" label="Show" value={view} onChange={setView} options={[{ v: "value", l: "Value" }, { v: "change", l: "Change YoY" }]} />
        <label className={cn("flex items-center gap-1.5", IR.caption)}>
          <Switch checked={hideStale} onCheckedChange={setHideStale} aria-label="Hide stale values" /> Last 18 months only
        </label>
        <label className={cn("flex items-center gap-1.5", IR.caption)}>
          <Switch checked={heat} onCheckedChange={setHeat} aria-label="Shade by rank" /> Shade by rank
        </label>
        <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" onClick={csv} disabled={!sorted.length}>
          <Download /> CSV
        </Button>
      </div>

      {!tax.data || !latest.data ? (
        <Skeleton className="h-[480px]" />
      ) : !cols.length ? (
        <p className="rounded-md border bg-card p-4 text-[13px] text-muted-foreground shadow-paper">
          No standardized KPIs for {scopeName}
          {hideStale ? " in the last 18 months. Turn off “Last 18 months only” or pick a wider set of companies." : ". Pick a wider set of companies."}
        </p>
      ) : (
        // overflow-anchor: none: rows are keyed by ticker, so when the period or the columns change the browser's
        // scroll anchoring would follow a row to its new place and move the page (measured 152 px on Latest year).
        <div data-section="KPI matrix" className="rounded-md border bg-card shadow-paper" style={{ overflowAnchor: "none" }}>
          <div className="flex flex-wrap items-baseline gap-x-3 border-b px-3 py-2">
            <p className="text-[13px]">
              <span className="num font-semibold">{sorted.length}</span>
              <span className="text-muted-foreground">
                {" "}
                {sorted.length === 1 ? "company" : "companies"} · {cols.length} KPIs · {K === "q" ? "latest quarter" : "latest fiscal year"} {view === "change" ? "change vs a year earlier" : "values"}
              </span>
            </p>
            <p className={cn(IR.caption, "ml-auto")}>Units in each column head; a period label appears only where it differs from the column's.</p>
          </div>
          <div ref={wrap} className={cn("relative", !fits && "overflow-x-auto scrollbar-thin")}>
            <style>{["mcap", "revg", ...cols.map((c) => c.k.id)].map((id) => `[data-kpi-matrix][data-hover="${id}"] td[data-col="${id}"]{background-color:color-mix(in oklab,var(--secondary) 70%,transparent)}`).join("")}</style>
            <table data-kpi-matrix className={cn("border-separate border-spacing-0", IR.row, fits ? "w-full" : "w-max min-w-full")}>
              <thead>
                <tr>
                  <th scope="col" className={cn("left-0 z-30 min-w-56 border-b border-r bg-card px-3 py-1.5 text-left align-bottom", "sticky", fits && STICKY)}>
                    <button type="button" onClick={() => setSort((s) => ({ c: "t", d: s.c === "t" ? (-s.d as 1 | -1) : 1 }))} className={cn(IR.eyebrow, "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
                      Company
                    </button>
                  </th>
                  <KpiTh ctx={thCtx} c="mcap" sub="live">
                    Market cap
                  </KpiTh>
                  <KpiTh ctx={thCtx} c="revg" className="border-r" sub="TTM, %" title="Revenue growth, trailing four quarters vs the four before (SEC filings)">
                    Revenue growth
                  </KpiTh>
                  {cols.map(({ k, n }) => {
                    const meta = colMeta.get(k.id);
                    const unit = view === "change" ? (k.uclass === "pct" ? "pt" : "%") : meta?.scale.head;
                    return (
                      <KpiTh ctx={thCtx}
                        key={k.id}
                        c={k.id}
                        sub={[unit, meta?.period].filter(Boolean).join(" · ")}
                        title={`${k.name}\n${k.definition}\n${n} companies in this selection${k.higher_is_better === false ? "\nLower is better" : ""}`}
                      >
                        {k.name}
                      </KpiTh>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.t}
                    onClick={() => navigate({ to: "/app/companies/$ticker", params: { ticker: r.t } })}
                    className="group cursor-pointer [&>*]:transition-colors [&>*]:duration-150"
                  >
                    <td className="sticky left-0 z-10 w-64 max-w-64 border-b border-r bg-card px-3 py-1 group-hover:bg-secondary" title={`${r.name} · ${r.ind}`}>
                      <TickerMark ticker={r.t} name={r.name} className="min-w-0" />
                    </td>
                    <td data-col="mcap" className={cn("num whitespace-nowrap border-b px-3 py-1 text-right group-hover:bg-secondary", sort.c === "mcap" && IR.strong)}>{fmtMcap(r.mcap)}</td>
                    <td data-col="revg" className={cn("num whitespace-nowrap border-b border-r px-3 py-1 text-right group-hover:bg-secondary", sort.c === "revg" && IR.strong)}>
                      {r.revg == null ? DASH : `${r.revg < 0 ? "\u2212" : ""}${Math.abs(r.revg * 100).toFixed(1)}`}
                    </td>
                    {cols.map(({ k }) => {
                      const c = r.cells[k.id];
                      const meta = colMeta.get(k.id)!;
                      if (!c)
                        return (
                          <td key={k.id} data-col={k.id} className="num border-b px-3 py-1 text-right text-muted-foreground group-hover:bg-secondary">
                            {DASH}
                          </td>
                        );
                      const h = heat ? heatOf.get(k.id)?.get(r.t) : undefined;
                      const mark = periodMark(c.p, meta);
                      return (
                        <td key={k.id} data-col={k.id} className="border-b p-0 text-right group-hover:bg-secondary">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void openCell(r.t, k, c.kpiId, c.p);
                            }}
                            title={`${k.name} · ${c.p[2]} (period ending ${fmtDate(c.p[0])})\n${fmtK(c.p[1], k)} · change ${fmtChg(c.p[3], k) || "not reported a year earlier"}\nClick for the release it was read from`}
                            className={cn("num flex w-full items-baseline justify-end gap-1.5 whitespace-nowrap px-3 py-1 tabular-nums hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", sort.c === k.id && IR.strong)}
                            style={h != null ? { background: `color-mix(in oklab, ${h > 0 ? "var(--positive)" : "var(--negative)"} ${Math.round(Math.abs(h) * 14)}%, transparent)` } : undefined}
                          >
                            {mark && <span className={cn("text-[10px] font-normal", mark.stale ? "text-negative" : "text-muted-foreground")}>{mark.text}</span>}
                            {view === "change" ? fmtChange(c.p[3], k) : fmtInScale(c.p[1], meta.scale)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cn("border-t px-3 py-2", IR.caption)}>
            Each column is one standardized KPI; each company's value is its own reported series mapped to that definition (series on a different reporting basis are never joined). Periods are the company's fiscal periods; a cell carries its own period when it differs from the column's (by label or by more than 45 days of period end), and a label in red is older than about six months. Change is percentage points for rates and percent for amounts. Shading ranks within the column. Click a value for the release it was read from, or a row for the company.
          </p>
        </div>
      )}
    </div>
  );
}

type ThCtx = { sort: { c: string; d: 1 | -1 }; setSort: Dispatch<SetStateAction<{ c: string; d: 1 | -1 }>>; fits: boolean };

// Column hover goes through the table's data-hover attribute and a CSS rule, not React state, so hovering
// a head neither re-renders the matrix (771 ms at All companies) nor remounts the focused head button.
const hoverOn = (c: string) => (e: React.MouseEvent<HTMLElement>) => {
  const t = e.currentTarget.closest("table");
  if (t) t.dataset.hover = c;
};
const hoverOff = (e: React.MouseEvent<HTMLElement>) => {
  const t = e.currentTarget.closest("table");
  if (t) delete t.dataset.hover;
};

function KpiTh({ ctx, c, children, title, className, sub }: { ctx: ThCtx; c: string; children: React.ReactNode; title?: string; className?: string; sub?: React.ReactNode }) {
  const { sort, setSort, fits } = ctx;
  return (
    <th
      scope="col"
      data-col={c}
      aria-sort={sort.c === c ? (sort.d === 1 ? "ascending" : "descending") : "none"}
      onMouseEnter={hoverOn(c)}
      onMouseLeave={hoverOff}
      className={cn("border-b bg-card px-3 py-1.5 text-right align-bottom", fits && `sticky ${STICKY} z-20`, className)}
    >
      <button
        type="button"
        title={title}
        onClick={() => setSort((s) => ({ c, d: s.c === c ? (-s.d as 1 | -1) : c === "t" ? 1 : -1 }))}
        className={cn("ml-auto flex max-w-36 items-end justify-end gap-1 rounded-sm text-right text-[11px] font-medium leading-4 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", sort.c === c ? "text-foreground" : "text-muted-foreground")}
      >
        <span className="whitespace-normal">{children}</span>
        {sort.c === c && (sort.d === 1 ? <ArrowUp className="mb-0.5 size-3 shrink-0" /> : <ArrowDown className="mb-0.5 size-3 shrink-0" />)}
      </button>
      {sub && <span className="mt-0.5 block whitespace-nowrap text-[10px] font-normal leading-3 text-muted-foreground">{sub}</span>}
    </th>
  );
}
