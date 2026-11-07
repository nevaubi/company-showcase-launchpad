import { createFileRoute, Link } from "@tanstack/react-router";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
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
import { COVERAGE_TICKERS } from "@/lib/coverage";
import { kpiFileQuery, kpiItems, type KpiValue } from "@/lib/statements/filed";
import { useSessionState } from "@/lib/use-session-state";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/kpis")({
  head: () => ({
    meta: [
      { title: "KPI matrix — Filed Under" },
      {
        name: "description",
        content:
          "Operating KPIs standardized across companies (comparable sales, backlog, NIM, occupancy, subscribers and more), each value linked to the release it was read from.",
      },
      { property: "og:title", content: "KPI matrix — Filed Under" },
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
const MAX_COLS = 10;

function fmtK(v: number | null | undefined, k: TaxKpi) {
  if (v == null || !Number.isFinite(v)) return "–";
  if (k.uclass === "pct") return `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
  if (k.uclass === "x") return `${v.toFixed(2)}×`;
  if (k.uclass === "usd_ps" || k.uclass === "usd_pu") return `$${v.toFixed(2)}`;
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
  return (
    (a >= 1e9
      ? `${(v / 1e9).toFixed(1)}B`
      : a >= 1e6
        ? `${(v / 1e6).toFixed(1)}M`
        : a >= 1e4
          ? `${(v / 1e3).toFixed(0)}K`
          : v.toLocaleString("en-US", { maximumFractionDigits: 2 })) + tail
  );
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
      : ranked.slice(0, 6)
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
        name: u?.name ?? t,
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
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "kpi-matrix.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const Th = ({
    c,
    children,
    title,
    className,
  }: {
    c: string;
    children: React.ReactNode;
    title?: string;
    className?: string;
  }) => (
    <th
      aria-sort={sort.c === c ? (sort.d === 1 ? "ascending" : "descending") : "none"}
      className={cn(
        "sticky top-0 z-20 border-b bg-card px-3 py-2 text-right align-bottom",
        className,
      )}
    >
      <button
        type="button"
        title={title}
        onClick={() =>
          setSort((s) => ({ c, d: s.c === c ? (-s.d as 1 | -1) : c === "t" ? 1 : -1 }))
        }
        className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {children}
        {sort.c === c &&
          (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  if (tax.isError || latest.isError)
    return (
      <div>
        <PageHeader eyebrow="Markets" title="KPI matrix" />
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
  return (
    <div>
      <PageHeader
        eyebrow="Markets"
        title="KPI matrix"
        description={
          latest.data
            ? `Operating KPIs read from company releases and mapped to common definitions · built ${fmtDate(latest.data.generated.slice(0, 10))}`
            : undefined
        }
      />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select
          value={scope}
          onValueChange={(v) => {
            setScope(v);
            setPicked([]);
          }}
        >
          <SelectTrigger aria-label="Companies" className="h-8 w-64 text-xs">
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
        <Segmented
          size="xs"
          label="Period"
          value={K}
          onChange={setK}
          options={[
            { v: "q", l: "Latest quarter" },
            { v: "a", l: "Latest year" },
          ]}
        />
        <Segmented
          size="xs"
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { v: "value", l: "Value" },
            { v: "change", l: "Change YoY" },
          ]}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={hideStale}
            onCheckedChange={setHideStale}
            aria-label="Hide stale values"
          />{" "}
          Hide values older than 18 months
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={heat} onCheckedChange={setHeat} aria-label="Shade by rank" /> Shade by
          rank
        </label>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          onClick={csv}
          disabled={!sorted.length}
        >
          <Download /> CSV
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ranked.slice(0, 24).map(({ k, n }) => {
          const on = cols.some((c) => c.k.id === k.id);
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => togglePick(k.id)}
              title={k.definition}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {k.name} <span className="opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      {!tax.data || !latest.data ? (
        <Skeleton className="h-[480px]" />
      ) : !cols.length ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No standardized KPIs for this selection{hideStale ? " in the last 18 months" : ""}.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
          <div className="max-h-[72vh] overflow-auto scrollbar-thin">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 min-w-60 border-b border-r bg-card px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) => ({ c: "t", d: s.c === "t" ? (-s.d as 1 | -1) : 1 }))
                      }
                      className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      Company
                    </button>
                  </th>
                  <Th c="mcap">Market cap</Th>
                  <Th
                    c="revg"
                    className="border-r"
                    title="Revenue growth, trailing four quarters vs the four before (SEC filings)"
                  >
                    Revenue growth
                  </Th>
                  {cols.map(({ k, n }) => (
                    <Th
                      key={k.id}
                      c={k.id}
                      title={`${k.name}\n${k.definition}\n${n} companies in this selection${k.higher_is_better === false ? "\nLower is better" : ""}`}
                    >
                      <span className="max-w-36 whitespace-normal text-right leading-tight">
                        {k.name}
                      </span>
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.t} className="group">
                    <td className="sticky left-0 z-10 max-w-72 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary">
                      <span className="flex items-center gap-2">
                        <CompanyLogo ticker={r.t} className="size-5" />
                        <Link
                          to="/app/companies/$ticker"
                          params={{ ticker: r.t }}
                          className="num font-medium hover:underline"
                        >
                          {r.t}
                        </Link>
                        <span
                          className="truncate text-xs text-muted-foreground"
                          title={`${r.name} · ${r.ind}`}
                        >
                          {r.name}
                        </span>
                      </span>
                    </td>
                    <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary">
                      {r.mcap
                        ? r.mcap >= 1e12
                          ? `$${(r.mcap / 1e12).toFixed(2)}T`
                          : `$${(r.mcap / 1e9).toFixed(1)}B`
                        : "–"}
                    </td>
                    <td
                      className={cn(
                        "num border-b border-r px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary",
                        (r.revg ?? 0) < 0 && "text-negative",
                      )}
                    >
                      {r.revg == null ? "–" : `${(r.revg * 100).toFixed(1)}%`}
                    </td>
                    {cols.map(({ k }) => {
                      const c = r.cells[k.id];
                      if (!c)
                        return (
                          <td
                            key={k.id}
                            className="border-b px-3 py-1.5 text-right text-muted-foreground/50 group-hover:bg-secondary"
                          >
                            –
                          </td>
                        );
                      const h = heat ? heatOf.get(k.id)?.get(r.t) : undefined;
                      const stale = age(c.p[0]) > 200;
                      return (
                        <td key={k.id} className="border-b p-0 text-right group-hover:bg-secondary">
                          <button
                            type="button"
                            onClick={() => void openCell(r.t, k, c.kpiId, c.p)}
                            title={`${c.p[2]} (period ending ${fmtDate(c.p[0])}) · ${fmtChg(c.p[3], k) || "no prior-year value"}\nClick for the release it was read from`}
                            className="num block w-full px-3 py-1.5 text-right tabular-nums hover:underline"
                            style={
                              h != null
                                ? {
                                    background: `color-mix(in oklab, ${h > 0 ? "var(--positive)" : "var(--negative)"} ${Math.round(Math.abs(h) * 16)}%, transparent)`,
                                  }
                                : undefined
                            }
                          >
                            {view === "change" ? fmtChg(c.p[3], k) || "–" : fmtK(c.p[1], k)}
                            <span
                              className={cn(
                                "block text-[10px] text-muted-foreground",
                                stale && "text-negative",
                              )}
                            >
                              {c.p[2]}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Each column is one standardized KPI; each company's value is its own reported series
            mapped to that definition (series on a different reporting basis are never joined).
            Periods are the company's fiscal periods; red period labels are older than about six
            months. Change is percentage points for rates and percent for amounts. Shading ranks
            within the column. Click a value for the release it was read from.
          </p>
        </div>
      )}
    </div>
  );
}
