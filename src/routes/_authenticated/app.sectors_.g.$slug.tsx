import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Segmented } from "@/components/app/segmented";
import { MultiLine } from "@/components/charts/multi-line";
import { AggregateTrends, BreakdownSheet, SectorNotes } from "@/components/sectors/sector-views";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BREAKDOWN_METRICS,
  fmtMetric,
  groupQuery,
  qLabel,
  type GroupFile,
  type ValRange,
} from "@/lib/sectors/groups";

const search = z.object({ m: z.string().max(40).optional(), q: z.string().max(8).optional() });

export const Route = createFileRoute("/_authenticated/app/sectors_/g/$slug")({
  validateSearch: (s) => search.parse(s),
  head: ({ params }) => {
    const name = params.slug
      .replace(/-and-/g, " & ")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      meta: [
        { title: `${name} — sector analysis — Filed Under` },
        {
          name: "description",
          content: `${name}: revenue and earnings growth, margins, returns on capital and valuation aggregated from each company's filings, with the companies behind every figure.`,
        },
        { property: "og:title", content: `${name} — Filed Under` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: Group,
});

const TILES = ["rev_growth", "ni_growth", "pct_rev_up", "gm", "om", "fcfm", "roic", "nd_ebitda"];
const RET = ["1W", "1M", "3M", "6M", "YTD", "1Y"];

function Group() {
  const { slug } = Route.useParams();
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const g = useQuery(groupQuery(slug));
  const metric = s.m && g.data?.agg[s.m] ? s.m : "rev_growth";
  const [sheetQ, setSheetQ] = useState<string | null>(null);
  // A link from a weekly note opens straight onto the breakdown it references.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && g.data && s.q && BREAKDOWN_METRICS.has(metric) && g.data.quarters.includes(s.q)) {
    setSeeded(true);
    setSheetQ(s.q);
  }
  const pick = (m: string, q?: string) => {
    navigate({ search: { m, q }, replace: true });
    if (q && BREAKDOWN_METRICS.has(m)) setSheetQ(q);
  };

  if (g.isError)
    return (
      <div>
        <PageHeader eyebrow="Sectors" title="Group not found" />
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No sector or industry file for “{slug}”.{" "}
          <Link to="/app/sectors" className="text-link hover:underline">
            Back to sectors
          </Link>
        </p>
      </div>
    );
  if (!g.data)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    );
  const d = g.data;
  const last = (k: string) => {
    const a = d.agg[k];
    if (!a) return null;
    for (let i = a.agg.length - 1; i >= 0; i--)
      if (a.agg[i] != null) return { i, v: a.agg[i]!, py: i >= 4 ? a.agg[i - 4] : null, n: a.n[i] };
    return null;
  };
  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow={
          <span>
            <Link to="/app/sectors" className="hover:underline">
              Sectors
            </Link>
            {d.kind === "industry" && (
              <>
                {" "}
                ·{" "}
                <Link
                  to="/app/sectors/g/$slug"
                  params={{ slug: d.sector_slug }}
                  className="hover:underline"
                >
                  {d.sector}
                </Link>
              </>
            )}
            {d.etf && <> · {d.etf}</>}
          </span>
        }
        title={d.name}
        description={`${d.members.length} companies, classified by SIC code with documented overrides. Aggregates are Σ numerator ÷ Σ denominator over companies reporting both, by calendar quarter. Built ${fmtDate(d.generated.slice(0, 10))}.`}
      />

      {d.industries && d.industries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.industries.map((x) => (
            <Link
              key={x.slug}
              to="/app/sectors/g/$slug"
              params={{ slug: x.slug }}
              className="rounded-full border bg-card px-2.5 py-0.5 text-xs hover:bg-secondary"
            >
              {x.name} <span className="text-muted-foreground">{x.n}</span>
            </Link>
          ))}
        </div>
      )}

      <section
        aria-label="Latest aggregates"
        className="grid grid-cols-2 border-y bg-card/40 sm:grid-cols-4 xl:grid-cols-8"
      >
        {TILES.map((k) => {
          const l = last(k);
          const unit = d.metrics[k]?.unit;
          const delta = l && l.py != null ? l.v - l.py : null;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k, l ? d.quarters[l.i] : undefined)}
              className="min-w-0 border-b border-r px-3.5 py-2.5 text-left hover:bg-secondary xl:border-b-0"
            >
              <p className="truncate text-[11px] text-muted-foreground">{d.metrics[k]?.name}</p>
              <p className="num mt-0.5 text-lg font-medium tabular-nums">{fmtMetric(l?.v, unit)}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {l ? `${qLabel(d.quarters[l.i])} · ${l.n} cos` : "–"}
                {delta != null && unit === "pct" && !k.endsWith("growth") && k !== "pct_rev_up" && (
                  <span
                    className={cn(
                      "ml-1",
                      delta > 0 ? "text-positive" : delta < 0 ? "text-negative" : "",
                    )}
                  >
                    {delta >= 0 ? "+" : "−"}
                    {Math.abs(delta * 100).toFixed(1)} pt YoY
                  </span>
                )}
              </p>
            </button>
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <AggregateTrends g={d} metric={metric} q={s.q} onPick={pick} />
        <Valuation d={d} onPick={pick} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Performance d={d} />
        <SectorNotes only={d.slug} />
      </div>

      <Constituents d={d} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Macro d={d} />
        <Kpis d={d} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Insiders d={d} />
        <Filings d={d} />
      </div>
      <Segments d={d} />

      <BreakdownSheet g={d} metric={metric} q={sheetQ} onClose={() => setSheetQ(null)} />
    </div>
  );
}

function RangeRow({
  label,
  r,
  now,
  unit,
  onClick,
}: {
  label: string;
  r: ValRange | null | undefined;
  now: number | null | undefined;
  unit: string;
  onClick?: () => void;
}) {
  if (!r) return null;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - r.min) / (r.max - r.min || 1)) * 100));
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3.5 py-2.5 text-left hover:bg-secondary"
    >
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium">{label}</span>
        <span className="num tabular-nums">
          {fmtMetric(now, unit)}{" "}
          <span className="text-[11px] text-muted-foreground">
            · {r.pct != null ? `${Math.round(r.pct * 100)}th pct` : "–"}
          </span>
        </span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-secondary">
        <span
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-muted-foreground"
          style={{ left: `${pos(r.med)}%` }}
          title={`Median ${fmtMetric(r.med, unit)}`}
        />
        {now != null && (
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `${pos(now)}%` }}
          />
        )}
      </div>
      <div className="num mt-1 flex justify-between text-[10.5px] text-muted-foreground">
        <span>
          {fmtMetric(r.min, unit)} {r.min_q ? qLabel(r.min_q) : ""}
        </span>
        <span>median {fmtMetric(r.med, unit)}</span>
        <span>
          {fmtMetric(r.max, unit)} {r.max_q ? qLabel(r.max_q) : ""}
        </span>
      </div>
    </button>
  );
}

function Valuation({ d, onPick }: { d: GroupFile; onPick: (m: string, q?: string) => void }) {
  const vn = d.val_now as Record<string, number | null> | undefined;
  const lq = d.quarters[d.quarters.length - 1];
  return (
    <Panel
      title="Valuation vs its own history"
      subtitle={`Today's aggregate multiple (index market caps over latest TTM, ${vn?.n ?? "–"} companies) against the 10-year quarterly range`}
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="divide-y">
        <RangeRow
          label="P/E"
          r={d.val_range?.pe}
          now={vn?.pe}
          unit="x"
          onClick={() => onPick("pe", lq)}
        />
        <RangeRow
          label="P/Sales"
          r={d.val_range?.ps}
          now={vn?.ps}
          unit="x"
          onClick={() => onPick("ps", lq)}
        />
        <RangeRow
          label="P/FCF"
          r={d.val_range?.pfcf}
          now={vn?.pfcf}
          unit="x"
          onClick={() => onPick("pfcf", lq)}
        />
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        Company medians today: P/E {fmtMetric(vn?.pe_med, "x")}, P/S {fmtMetric(vn?.ps_med, "x")},
        P/FCF {fmtMetric(vn?.pfcf_med, "x")}. Aggregate multiples above 150× (earnings near zero)
        are left out. Click a row for the latest quarter's company breakdown.
      </p>
    </Panel>
  );
}

function Performance({ d }: { d: GroupFile }) {
  const [win, setWin] = useState<"126" | "252" | "all">("252");
  const p = d.perf;
  const series = useMemo(() => {
    if (!p) return [];
    const n = win === "all" ? p.dates.length : +win;
    const from = Math.max(0, p.dates.length - n);
    const reb = (arr: (number | null)[]) => {
      const base = arr.slice(from).find((v): v is number => v != null);
      return p.dates.slice(from).map((x, i) => ({
        x,
        y: base && arr[from + i] != null ? (arr[from + i]! / base - 1) * 100 : null,
      }));
    };
    return [
      { key: "cw", label: "Cap-weighted", color: "var(--chart-1)", points: reb(p.cw) },
      { key: "ew", label: "Equal-weighted", color: "var(--chart-3)", points: reb(p.ew) },
      { key: "spy", label: "SPY", color: "var(--muted-foreground)", points: reb(p.spy) },
    ];
  }, [p, win]);
  const R = d.returns;
  return (
    <Panel
      title="Performance"
      subtitle="The group's companies, cap- and equal-weighted, against SPY"
      actions={
        <Segmented
          size="xs"
          label="Window"
          value={win}
          onChange={setWin}
          options={[
            { v: "126", l: "6M" },
            { v: "252", l: "1Y" },
            { v: "all", l: "2Y" },
          ]}
        />
      }
      collapse={false}
    >
      <div className="px-3 py-2">
        <MultiLine
          series={series}
          label={`${d.name} performance`}
          format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
          baseline={0}
          xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
          height={220}
        />
      </div>
      {R && (
        <div className="overflow-x-auto border-t scrollbar-thin">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-medium" />
                {RET.map((k) => (
                  <th key={k} className="px-3 py-1.5 text-right font-medium">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["cw", "Cap-weighted"],
                  ["ew", "Equal-weighted"],
                  ["etf", d.etf ?? "ETF"],
                  ["spy", "SPY"],
                ] as const
              ).map(([k, l]) =>
                R[k] ? (
                  <tr key={k} className="border-t">
                    <td className="px-3 py-1.5">{l}</td>
                    {RET.map((w) => {
                      const v = R[k]![w];
                      return (
                        <td
                          key={w}
                          className={cn(
                            "num px-3 py-1.5 text-right tabular-nums",
                            v != null && v < 0 && "text-negative",
                          )}
                        >
                          {v == null ? "–" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`}
                        </td>
                      );
                    })}
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Constituents({ d }: { d: GroupFile }) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "mcap", dir: -1 });
  const [limit, setLimit] = useState(40);
  const cols: { k: string; l: string; u: string }[] = [
    { k: "mcap", l: "Market cap", u: "usd" },
    { k: "w", l: "Weight", u: "pct" },
    { k: "ret_1m", l: "1M", u: "pct" },
    { k: "ret_ytd", l: "YTD", u: "pct" },
    { k: "ret_1y", l: "1Y", u: "pct" },
    { k: "rev_growth", l: "Rev YoY", u: "pct" },
    { k: "gm", l: "Gross m.", u: "pct" },
    { k: "om", l: "Op m.", u: "pct" },
    { k: "roic", l: "ROIC", u: "pct" },
    { k: "pe", l: "P/E", u: "x" },
    { k: "fcf_yield", l: "FCF yld", u: "pct" },
  ];
  const rows = [...d.constituents].sort((a, b) => {
    const x = (a as unknown as Record<string, number | null>)[sort.k],
      y = (b as unknown as Record<string, number | null>)[sort.k];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return sort.dir * (x - y);
  });
  return (
    <Panel
      title="Constituents"
      subtitle={`${d.constituents.length} companies · fundamentals for each company's latest quarter, prices from the latest close`}
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="max-h-[70vh] overflow-auto scrollbar-thin">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="sticky left-0 top-0 z-20 border-b border-r bg-card px-3 py-2 text-left font-medium">
                Company
              </th>
              {d.kind === "sector" && (
                <th className="sticky top-0 z-10 border-b bg-card px-3 py-2 text-left font-medium">
                  Industry
                </th>
              )}
              {cols.map((c) => (
                <th
                  key={c.k}
                  className="sticky top-0 z-10 border-b bg-card px-3 py-2 text-right font-medium"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s0) => ({ k: c.k, dir: s0.k === c.k ? (-s0.dir as 1 | -1) : -1 }))
                    }
                    className="hover:text-foreground"
                  >
                    {c.l}
                    {sort.k === c.k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              <th className="sticky top-0 z-10 border-b bg-card px-3 py-2 text-right font-medium">
                3M
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((c) => (
              <tr key={c.tk} className="group">
                <td className="sticky left-0 z-10 max-w-64 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary">
                  <span className="flex items-center gap-2">
                    <CompanyLogo ticker={c.tk} size="xs" />
                    <Link
                      to="/app/companies/$ticker"
                      params={{ ticker: c.tk }}
                      className="num font-medium hover:underline"
                    >
                      {c.tk}
                    </Link>
                    <span className="truncate text-muted-foreground">{c.name}</span>
                  </span>
                </td>
                {d.kind === "sector" && (
                  <td className="max-w-48 truncate border-b px-3 py-1.5 text-muted-foreground group-hover:bg-secondary">
                    {c.industry}
                  </td>
                )}
                {cols.map((col) => {
                  const v = (c as unknown as Record<string, number | null>)[col.k];
                  return (
                    <td
                      key={col.k}
                      className={cn(
                        "num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary",
                        v != null && v < 0 && col.u === "pct" && "text-negative",
                      )}
                    >
                      {fmtMetric(v, col.u)}
                    </td>
                  );
                })}
                <td className="border-b px-3 py-1.5 text-right group-hover:bg-secondary">
                  {c.spark && c.spark.length > 1 && <Spark v={c.spark} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > limit && (
          <div className="border-t px-3 py-2">
            <button
              type="button"
              onClick={() => setLimit((l) => l + 100)}
              className="text-xs text-link hover:underline"
            >
              Show all {rows.length}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Spark({ v }: { v: number[] }) {
  const lo = Math.min(...v),
    hi = Math.max(...v);
  const W = 64,
    H = 18;
  const d = v
    .map(
      (y, i) =>
        `${i ? "L" : "M"}${((i / (v.length - 1)) * W).toFixed(1)},${(H - ((y - lo) / (hi - lo || 1)) * H).toFixed(1)}`,
    )
    .join("");
  return (
    <svg width={W} height={H} className="inline-block" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={v[v.length - 1] >= v[0] ? "var(--positive)" : "var(--negative)"}
        strokeWidth={1.2}
      />
    </svg>
  );
}

function Macro({ d }: { d: GroupFile }) {
  const rows = (d.macro ?? [])
    .filter((m) => m.d || m.m)
    .sort((a, b) => Math.abs(b.m?.corr ?? b.d?.corr ?? 0) - Math.abs(a.m?.corr ?? a.d?.corr ?? 0));
  if (!rows.length) return null;
  const fac = new Map((d.factors ?? []).map((f) => [f.id, f]));
  return (
    <Panel
      title="Macro sensitivity"
      subtitle="Correlation of the group's cap-weighted return with changes in each series"
      collapse={false}
      bodyClassName="p-0"
    >
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b text-[11px] text-muted-foreground">
            <th className="px-3 py-1.5 text-left font-medium">Series</th>
            <th className="px-3 py-1.5 text-right font-medium">Daily, 1Y</th>
            <th className="px-3 py-1.5 text-right font-medium">Monthly, 10Y</th>
            <th className="px-3 py-1.5 text-left font-medium">Latest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const f = fac.get(m.id);
            const c = (v: number | undefined | null) => (v == null ? "–" : v.toFixed(2));
            return (
              <tr key={m.id} className="border-b last:border-0">
                <td className="px-3 py-1.5">
                  {f?.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                      title={f.source}
                    >
                      {m.name}
                    </a>
                  ) : (
                    m.name
                  )}
                </td>
                <td
                  className="num px-3 py-1.5 text-right tabular-nums"
                  title={m.d ? `${m.d.n} days, ${m.d.from} to ${m.d.to}` : undefined}
                  style={bar(m.d?.corr)}
                >
                  {c(m.d?.corr)}
                </td>
                <td
                  className="num px-3 py-1.5 text-right tabular-nums"
                  title={m.m ? `${m.m.n} months` : undefined}
                  style={bar(m.m?.corr)}
                >
                  {c(m.m?.corr)}
                </td>
                <td className="num px-3 py-1.5 text-[11px] text-muted-foreground">
                  {f?.latest ? `${f.latest[1]} · ${fmtDate(f.latest[0])}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Rate and spread series use changes in basis points; others use percentage changes.
        Correlation is not causation; magnitudes below about 0.2 are weak.
      </p>
    </Panel>
  );
}
const bar = (v: number | null | undefined) =>
  v == null
    ? undefined
    : {
        background: `color-mix(in oklab, var(${v >= 0 ? "--positive" : "--negative"}) ${Math.round(Math.min(1, Math.abs(v) / 0.6) * 24)}%, transparent)`,
      };

function Kpis({ d }: { d: GroupFile }) {
  const k = d.kpis ?? [];
  if (!k.length) return null;
  return (
    <Panel
      title="Industry KPIs"
      subtitle="Computed from each company's filings, or read from their releases; median or sum as stated"
      collapse={false}
      bodyClassName="p-0"
    >
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b text-[11px] text-muted-foreground">
            <th className="px-3 py-1.5 text-left font-medium">KPI</th>
            <th className="px-3 py-1.5 text-right font-medium">Latest</th>
            <th className="px-3 py-1.5 text-right font-medium">Year ago</th>
            <th className="px-3 py-1.5 text-right font-medium">Companies</th>
          </tr>
        </thead>
        <tbody>
          {k.map((x) => {
            let i = x.agg.length - 1;
            while (i >= 0 && x.agg[i] == null) i--;
            const u =
              x.unit === "%" ? "%" : x.unit === "days" ? "days" : x.unit === "USD" ? "usd" : x.unit;
            return (
              <tr key={x.id} className="border-b last:border-0" title={x.definition}>
                <td className="px-3 py-1.5">
                  {x.name}{" "}
                  <span className="text-[11px] text-muted-foreground">
                    ({x.how}
                    {x.industry ? ` · ${x.industry}` : ""})
                  </span>
                </td>
                <td className="num px-3 py-1.5 text-right tabular-nums">
                  {i >= 0 ? fmtMetric(x.agg[i], u) : "–"}{" "}
                  <span className="text-[10.5px] text-muted-foreground">
                    {i >= 0 ? qLabel(x.quarters[i]) : ""}
                  </span>
                </td>
                <td className="num px-3 py-1.5 text-right tabular-nums">
                  {i >= 4 ? fmtMetric(x.agg[i - 4], u) : "–"}
                </td>
                <td className="num px-3 py-1.5 text-right tabular-nums">
                  {i >= 0 && x.n ? x.n[i] : "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function Insiders({ d }: { d: GroupFile }) {
  const I = d.insiders;
  if (!I) return null;
  return (
    <Panel
      title="Insider activity"
      subtitle={`Open-market Form 4 trades since ${fmtDate(I.since)}`}
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-2 border-b">
        <div className="border-r px-3.5 py-2">
          <p className="text-[11px] text-muted-foreground">Bought</p>
          <p className="num text-base font-medium text-positive">{fmtMetric(I.buy, "usd")}</p>
          <p className="text-[11px] text-muted-foreground">{I.n_buy} trades</p>
        </div>
        <div className="px-3.5 py-2">
          <p className="text-[11px] text-muted-foreground">Sold</p>
          <p className="num text-base font-medium text-negative">{fmtMetric(I.sell, "usd")}</p>
          <p className="text-[11px] text-muted-foreground">{I.n_sell} trades</p>
        </div>
      </div>
      <table className="w-full text-[12.5px]">
        <tbody>
          {I.companies.slice(0, 10).map((c) => (
            <tr key={c.tk} className="border-b last:border-0">
              <td className="px-3 py-1.5">
                <Link
                  to="/app/companies/$ticker/insiders"
                  params={{ ticker: c.tk }}
                  className="num font-medium hover:underline"
                >
                  {c.tk}
                </Link>{" "}
                <span className="text-[11px] text-muted-foreground">{c.owners} insiders</span>
              </td>
              <td className="num px-3 py-1.5 text-right tabular-nums text-positive">
                {c.buy ? fmtMetric(c.buy, "usd") : ""}
              </td>
              <td className="num px-3 py-1.5 text-right tabular-nums text-negative">
                {c.sell ? fmtMetric(c.sell, "usd") : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Filings({ d }: { d: GroupFile }) {
  const f = (d.filings ?? []).filter((x) => x.form !== "144" && x.form !== "4").slice(0, 14);
  if (!f.length) return null;
  return (
    <Panel
      title="Recent filings"
      subtitle="Annual, quarterly and current reports from the group's companies"
      collapse={false}
      bodyClassName="p-0"
    >
      <ul className="divide-y text-[12.5px]">
        {f.map((x) => (
          <li key={x.accession} className="flex items-center gap-2 px-3 py-1.5">
            <span className="num w-20 shrink-0 text-muted-foreground">
              {fmtDate(x.filed, { month: "short", day: "numeric" })}
            </span>
            <Link
              to="/app/companies/$ticker"
              params={{ ticker: x.ticker }}
              className="num w-14 shrink-0 font-medium hover:underline"
            >
              {x.ticker}
            </Link>
            <span className="w-12 shrink-0 rounded border px-1 text-center text-[11px]">
              {x.form}
            </span>
            <a
              href={x.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
            >
              {x.description || x.items}
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Segments({ d }: { d: GroupFile }) {
  const s = (d.segments?.inside ?? []).slice(0, 12);
  if (!s.length) return null;
  return (
    <Panel
      title="Exposure from other sectors"
      subtitle="Reported business segments of companies classified elsewhere whose revenue belongs in this group"
      collapse={false}
      bodyClassName="p-0"
    >
      <table className="w-full text-[12.5px]">
        <tbody>
          {s.map((x) => (
            <tr key={`${x.tk}-${x.member}`} className="border-b last:border-0">
              <td className="px-3 py-1.5">
                <Link
                  to="/app/companies/$ticker"
                  params={{ ticker: x.tk }}
                  className="num font-medium hover:underline"
                >
                  {x.tk}
                </Link>{" "}
                <span className="text-muted-foreground">{x.label}</span>
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">{x.industry}</td>
              <td className="num px-3 py-1.5 text-right tabular-nums">
                {fmtMetric(x.v, "usd")}{" "}
                <span className="text-[10.5px] text-muted-foreground">{x.fy}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
