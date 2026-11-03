import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import * as d3 from "d3";
import { AlertTriangle, Info } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { ComboChart, type ComboSeries } from "@/components/charts/combo-chart";
import { Waterfall } from "@/components/charts/waterfall";
import { ScaleToggle } from "@/components/financials/scale-toggle";
import { useSource } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnitScale } from "@/hooks/use-preference";
import { useCompany } from "@/lib/data";
import { METRIC_LABEL, memberCoverage, segmentGroups, segmentMatrix, type SegCell, type SegGroup } from "@/lib/financials/segments";
import type { CompanyDataset, Period, Row } from "@/lib/financials/types";
import { cagr } from "@/lib/financials/metrics";
import { fmtCell, fmtCompactUsd, fmtPct, scaleCaption } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/segments")({
  component: Segments,
});

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)", "var(--ink-muted)", "var(--link)"];
const MAX_STACK = 8;

/** Consolidated statement line matching a segment metric, for coverage checks and the total row. */
const TOTAL_ROW: Partial<Record<SegGroup["metric"], ["income" | "balance" | "cashflow", string]>> = {
  revenue: ["income", "revenue"],
  operatingIncome: ["income", "operatingIncome"],
  grossProfit: ["income", "grossProfit"],
  netIncome: ["income", "netIncome"],
  assets: ["balance", "totalAssets"],
  capex: ["cashflow", "capex"],
  dna: ["cashflow", "dna"],
};

function Segments() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  if (company.isError) return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Could not load {ticker}'s segment data. Refresh to try again.</p>;
  if (!company.data) return <Skeleton className="h-[600px]" />;
  return <SegmentExplorer ticker={ticker} data={company.data} />;
}

type Mode = "stacked" | "mix" | "growth" | "treemap";

function SegmentExplorer({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const [scale] = useUnitScale();
  const groups = useMemo(() => segmentGroups(data.segments), [data.segments]);
  const [gid, setGid] = useState<string | null>(null);
  const [freq, setFreq] = useState<"annual" | "quarterly">("annual");
  const [span, setSpan] = useState<"short" | "long" | "all">("long");
  const [mode, setMode] = useState<Mode>("stacked");
  const g = groups.find((x) => x.id === gid) ?? groups[0];

  const annualPeriods = data.statements.annual.income.periods;
  const statementPeriods: Period[] = freq === "annual" ? annualPeriods : data.statements.quarterly.income.periods;

  const { periods, members, cells, totalRow } = useMemo(() => {
    if (!g) return { periods: [] as Period[], members: [], cells: new Map<string, (SegCell | null)[]>(), totalRow: undefined as Row | undefined };
    const m = segmentMatrix(data.segments, g, statementPeriods, annualPeriods, freq);
    // Trim to periods where at least one member reports.
    const has = statementPeriods.map((_, i) => [...m.cells.values()].some((r) => r[i]));
    const first = has.indexOf(true);
    const last = has.lastIndexOf(true);
    const keep = first < 0 ? [] : statementPeriods.map((_, i) => i).slice(first, last + 1);
    const n = span === "all" ? keep.length : freq === "annual" ? (span === "short" ? 5 : 10) : span === "short" ? 8 : 16;
    const idx = keep.slice(-n);
    const cellsOut = new Map([...m.cells.entries()].map(([k, row]) => [k, idx.map((i) => row[i])]));
    const tr = TOTAL_ROW[g.metric];
    const statementRow = tr ? data.statements[freq][tr[0]].rows.find((r) => r.key === tr[1]) : undefined;
    const totalRow = statementRow ? { ...statementRow, cells: idx.map((i) => statementRow.cells[i]) } : undefined;
    const members = m.members.filter((x) => cellsOut.get(x.member)!.some(Boolean));
    return { periods: idx.map((i) => statementPeriods[i]), members, cells: cellsOut, totalRow };
  }, [g, data, statementPeriods, annualPeriods, freq, span]);

  if (!groups.length || !g)
    return (
      <Panel title="Segment disclosures" subtitle="Dimensional XBRL facts from 10-K and 10-Q filings">
        <p className="text-sm text-muted-foreground">This company's filings don't tag segment facts on the standard axes we read.</p>
      </Panel>
    );

  const coverage = memberCoverage(cells, totalRow?.cells.map((c) => c?.v) ?? []);
  const overlapping = coverage.some((c) => c != null && c > 1.05);
  const stackMembers = members.slice(0, MAX_STACK);
  const color = (i: number) => PALETTE[i % PALETTE.length];
  const metricLabel = METRIC_LABEL[g.metric];

  const openCell = (label: string, p: Period, c: SegCell) =>
    open({
      ticker,
      label: `${label} — ${metricLabel.toLowerCase()}`,
      periodLabel: p.label,
      unit: "usd",
      value: c.v,
      src: c.fact ? { accn: c.fact.accn, concept: c.fact.concept, start: c.fact.start, end: c.fact.end, value: c.fact.value } : undefined,
      derived: c.derived,
      elementId: c.fact?.elementId,
    });

  const yoyIdx = (i: number) => {
    const p = periods[i];
    return periods.findIndex((q) => q.fy === p.fy - 1 && (q.fq ?? 0) === (p.fq ?? 0));
  };

  const categories = periods.map((p) => p.label);
  const sumAt = (i: number) => stackMembers.reduce((s, m) => s + (cells.get(m.member)![i]?.v ?? 0), 0);
  const series: ComboSeries[] =
    mode === "growth"
      ? stackMembers.slice(0, 6).map((m, k) => ({
          id: m.member,
          label: m.label,
          color: color(k),
          type: "line" as const,
          values: periods.map((_, i) => {
            const j = yoyIdx(i);
            const cur = cells.get(m.member)![i];
            const prev = j >= 0 ? cells.get(m.member)![j] : null;
            return cur && prev && prev.v > 0 ? cur.v / prev.v - 1 : null;
          }),
          format: (v) => fmtPct(v, 1, true),
        }))
      : stackMembers.map((m, k) => ({
          id: m.member,
          label: m.label,
          color: color(k),
          type: "bar" as const,
          values: periods.map((_, i) => {
            const c = cells.get(m.member)![i];
            if (!c) return null;
            if (mode === "mix") {
              const s = sumAt(i);
              return s > 0 ? c.v / s : null;
            }
            return c.v;
          }),
          format: (v) => (mode === "mix" ? fmtPct(v, 1) : fmtCompactUsd(v)),
          onSelect: (i) => {
            const c = cells.get(m.member)![i];
            if (c) openCell(m.label, periods[i], c);
          },
        }));
  if (mode === "stacked" && totalRow && !overlapping)
    series.push({
      id: "_total",
      label: `Reported ${metricLabel.toLowerCase()}`,
      color: "var(--foreground)",
      type: "line",
      dashed: true,
      values: totalRow.cells.map((c) => c?.v ?? null),
      format: (v) => fmtCompactUsd(v),
      onSelect: (i) => {
        const c = totalRow.cells[i];
        if (c) open({ ticker, label: totalRow.label, periodLabel: periods[i].label, unit: "usd", value: c.v, src: c.src, derived: c.derived, alts: c.alts });
      },
    });

  // Bridge: latest period vs the same period a year earlier.
  const li = periods.length - 1;
  const pj = li >= 0 ? yoyIdx(li) : -1;
  const bridge =
    (g.metric === "revenue" || g.metric === "operatingIncome") && li >= 0 && pj >= 0 && !overlapping
      ? (() => {
          const start = members.reduce((s, m) => s + (cells.get(m.member)![pj]?.v ?? 0), 0);
          const end = members.reduce((s, m) => s + (cells.get(m.member)![li]?.v ?? 0), 0);
          const deltas = members
            .map((m) => ({ m, d: (cells.get(m.member)![li]?.v ?? 0) - (cells.get(m.member)![pj]?.v ?? 0) }))
            .filter((x) => x.d !== 0)
            .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
          const top = deltas.slice(0, 7);
          const rest = deltas.slice(7).reduce((s, x) => s + x.d, 0);
          return {
            start,
            end,
            steps: [
              { id: "start", label: periods[pj].label, value: start, total: true },
              ...top.map((x) => ({
                id: x.m.member,
                label: x.m.label,
                value: x.d,
                onSelect: () => {
                  const c = cells.get(x.m.member)![li];
                  if (c) openCell(x.m.label, periods[li], c);
                },
              })),
              ...(rest ? [{ id: "other", label: "Other members", value: rest }] : []),
              { id: "end", label: periods[li].label, value: end, total: true },
            ],
          };
        })()
      : null;

  // Segment margins: operating income ÷ revenue on the same axis.
  const marginGroup = g.metric === "revenue" ? groups.find((x) => x.axis === g.axis && x.metric === "operatingIncome") : undefined;
  const margins = (() => {
    if (!marginGroup) return null;
    const oi = segmentMatrix(data.segments, marginGroup, statementPeriods, annualPeriods, freq).cells;
    const idx = periods.map((p) => statementPeriods.indexOf(p));
    const rows = members
      .filter((m) => oi.has(m.member))
      .map((m) => ({
        member: m,
        values: idx.map((pi, i) => {
          const r = cells.get(m.member)![i];
          const o = oi.get(m.member)![pi];
          return r && o && r.v > 0 ? o.v / r.v : null;
        }),
      }))
      .filter((r) => r.values.some((v) => v != null));
    return rows.length ? rows : null;
  })();

  return (
    <div className="grid grid-cols-1 gap-6">
      <Panel
        title="Segment disclosures"
        subtitle={`${data.segments.length.toLocaleString()} dimensional facts from every inline-XBRL 10-K, the latest twelve 10-Qs and older XBRL 10-Ks`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Frequency" size="xs" value={freq} onChange={setFreq} options={[{ v: "annual", l: "Annual" }, { v: "quarterly", l: "Quarterly" }]} />
            <Segmented
              label="Periods"
              size="xs"
              value={span}
              onChange={setSpan}
              options={[
                { v: "short", l: freq === "annual" ? "5Y" : "8Q" },
                { v: "long", l: freq === "annual" ? "10Y" : "16Q" },
                { v: "all", l: "All" },
              ]}
            />
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-1.5">
          {groups.map((x) => (
            <button
              key={x.id}
              onClick={() => setGid(x.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                x.id === g.id ? "border-foreground bg-ink text-ink-foreground" : "bg-card hover:bg-secondary",
              )}
            >
              {METRIC_LABEL[x.metric]} <span className="opacity-60">by {x.axisLabel.toLowerCase()}</span>
            </button>
          ))}
        </div>

        {periods.length ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Segmented
                label="Chart"
                size="xs"
                value={mode}
                onChange={setMode}
                options={[
                  { v: "stacked", l: "Dollars" },
                  { v: "mix", l: "Mix %", title: "Each member's share of the members' total" },
                  { v: "growth", l: "Growth", title: "Year-over-year growth by member" },
                  { v: "treemap", l: "Treemap", title: `Latest period (${periods.at(-1)!.label})` },
                ]}
              />
              {overlapping && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-full bg-highlight-soft px-2 py-0.5 text-[11px]">
                      <AlertTriangle className="size-3" /> Overlapping members in some years
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    In some filings the company tagged both product lines and regions on this axis, so members add up to more than the reported total. Use the
                    table for exact values.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {mode === "treemap" ? (
              <Treemap
                items={stackMembers
                  .map((m, k) => ({ id: m.member, label: m.label, value: cells.get(m.member)!.at(-1)?.v ?? 0, color: color(k), cell: cells.get(m.member)!.at(-1) }))
                  .filter((x) => x.value > 0)}
                onSelect={(x) => x.cell && openCell(x.label, periods.at(-1)!, x.cell)}
              />
            ) : (
              <ComboChart
                categories={categories}
                series={series}
                stacked={mode !== "growth"}
                height={290}
                leftFormat={mode === "stacked" ? (v) => fmtCompactUsd(v, 0) : (v) => `${(v * 100).toFixed(0)}%`}
              />
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {stackMembers.slice(0, mode === "growth" ? 6 : MAX_STACK).map((m, i) => (
                <span key={m.member} className="flex items-center gap-1.5 text-[11px]">
                  <span className="size-2 rounded-sm" style={{ background: color(i) }} />
                  {m.label}
                </span>
              ))}
              {members.length > MAX_STACK && <span className="text-[11px] text-muted-foreground">+{members.length - MAX_STACK} smaller members in the table</span>}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No {freq} periods disclosed on this axis in the filings we parsed.</p>
        )}
      </Panel>

      {periods.length > 0 && (
        <Panel
          title={`${metricLabel} by ${g.axisLabel.toLowerCase()}`}
          subtitle={`${freq === "annual" ? "Fiscal years" : "Fiscal quarters"} · ${scaleCaption(scale)} · italic values are derived from year-to-date facts`}
          actions={<ScaleToggle size="xs" />}
        >
          <SegmentTable
            periods={periods}
            members={members}
            cells={cells}
            totalRow={totalRow}
            coverage={coverage}
            scale={scale}
            freq={freq}
            onOpen={openCell}
            onOpenTotal={(i) => {
              const c = totalRow?.cells[i];
              if (c && totalRow) open({ ticker, label: totalRow.label, periodLabel: periods[i].label, unit: "usd", value: c.v, src: c.src, derived: c.derived, alts: c.alts });
            }}
          />
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {bridge && (
          <Panel title={`${metricLabel} bridge`} subtitle={`${periods[pj].label} → ${periods[li].label}: what each member added`}>
            <Waterfall steps={bridge.steps} format={(v) => fmtCompactUsd(v, 1)} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Members' total moved {fmtPct(bridge.start ? bridge.end / bridge.start - 1 : null, 1, true)}. Click a bar for the filing.
            </p>
          </Panel>
        )}
        {margins && (
          <Panel title="Segment operating margins" subtitle="Segment operating income ÷ segment revenue, as tagged">
            <ComboChart
              categories={categories}
              series={margins.slice(0, 6).map((r, k) => ({ id: r.member.member, label: r.member.label, color: color(members.indexOf(r.member)), type: "line", values: r.values, format: (v) => fmtPct(v, 1) }))}
              height={240}
              leftFormat={(v) => `${(v * 100).toFixed(0)}%`}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

function SegmentTable({
  periods,
  members,
  cells,
  totalRow,
  coverage,
  scale,
  freq,
  onOpen,
  onOpenTotal,
}: {
  periods: Period[];
  members: { member: string; label: string }[];
  cells: Map<string, (SegCell | null)[]>;
  totalRow?: Row;
  coverage: (number | null)[];
  scale: ReturnType<typeof useUnitScale>[0];
  freq: "annual" | "quarterly";
  onOpen: (label: string, p: Period, c: SegCell) => void;
  onOpenTotal: (i: number) => void;
}) {
  const sums = periods.map((_, i) => {
    let s = 0;
    let any = false;
    for (const m of members) {
      const c = cells.get(m.member)![i];
      if (c) {
        s += c.v;
        any = true;
      }
    }
    return any ? s : null;
  });
  const growth = (row: (number | null)[]) => {
    const idx = row.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return null;
    const a = idx[0];
    const b = idx.at(-1)!;
    if (freq === "quarterly") {
      const p = periods[b];
      const j = periods.findIndex((q) => q.fy === p.fy - 1 && q.fq === p.fq);
      return j >= 0 && row[j] && row[j]! > 0 && row[b]! > 0 ? row[b]! / row[j]! - 1 : null;
    }
    return cagr(row[a]!, row[b]!, periods[b].fy - periods[a].fy);
  };
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border scrollbar-thin">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-52 border-b border-r bg-card px-3 py-2 text-left">
              <span className="eyebrow">Member</span>
            </th>
            {periods.map((p) => (
              <th key={p.key} className="num sticky top-0 z-20 border-b bg-card px-3 py-2 text-right text-[11px] font-semibold">
                {p.label}
              </th>
            ))}
            <th className="sticky top-0 z-20 border-b border-l bg-card px-3 py-2 text-right">
              <span className="eyebrow">{freq === "annual" ? "CAGR" : "YoY"}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const row = cells.get(m.member)!;
            const g = growth(row.map((c) => c?.v ?? null));
            return (
              <tr key={m.member} className="group">
                <th scope="row" className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 text-left font-normal group-hover:bg-secondary">
                  {m.label}
                </th>
                {row.map((c, i) => (
                  <td key={i} className="border-b p-0 text-right group-hover:bg-secondary/60">
                    {c ? (
                      <button
                        onClick={() => onOpen(m.label, periods[i], c)}
                        className={cn("num block w-full px-3 py-1 text-right hover:bg-highlight-soft", c.derived && "italic text-foreground/80", c.v < 0 && "text-negative")}
                      >
                        {fmtCell(c.v, "usd", scale)}
                        <span className="block text-[10px] not-italic leading-tight text-muted-foreground">
                          {sums[i] && sums[i]! > 0 && c.v >= 0 ? `${((c.v / sums[i]!) * 100).toFixed(1)}%` : "·"}
                        </span>
                      </button>
                    ) : (
                      <span className="num block px-3 py-1 text-muted-foreground/40">—</span>
                    )}
                  </td>
                ))}
                <td className={cn("num border-b border-l px-3 text-right", g == null ? "text-muted-foreground/50" : g >= 0 ? "text-positive" : "text-negative")}>
                  {g == null ? "—" : fmtPct(g, 1, true)}
                </td>
              </tr>
            );
          })}
          <tr className="font-medium">
            <th scope="row" className="sticky left-0 z-10 border-b border-r bg-secondary/70 px-3 py-1.5 text-left">
              Sum of members
            </th>
            {sums.map((v, i) => (
              <td key={i} className="num border-b bg-secondary/70 px-3 py-1.5 text-right">
                {v == null ? "—" : fmtCell(v, "usd", scale)}
              </td>
            ))}
            <td className="border-b border-l bg-secondary/70" />
          </tr>
          {totalRow && (
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-r bg-card px-3 py-1.5 text-left font-normal">
                <span className="flex items-center gap-1.5">
                  Reported {totalRow.label.toLowerCase()}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      The consolidated statement line. The second line shows how much of it the members add up to — corporate items and eliminations explain gaps.
                    </TooltipContent>
                  </Tooltip>
                </span>
              </th>
              {totalRow.cells.map((c, i) => (
                <td key={i} className="p-0 text-right">
                  {c ? (
                    <button onClick={() => onOpenTotal(i)} className="num block w-full px-3 py-1 text-right hover:bg-highlight-soft">
                      {fmtCell(c.v, "usd", scale)}
                      <span className={cn("block text-[10px] leading-tight", coverage[i] != null && Math.abs(coverage[i]! - 1) > 0.05 ? "text-negative" : "text-muted-foreground")}>
                        {coverage[i] == null ? "·" : `${(coverage[i]! * 100).toFixed(0)}% covered`}
                      </span>
                    </button>
                  ) : (
                    <span className="num block px-3 py-1 text-muted-foreground/40">—</span>
                  )}
                </td>
              ))}
              <td className="border-l" />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Treemap({
  items,
  onSelect,
}: {
  items: { id: string; label: string; value: number; color: string; cell?: SegCell | null }[];
  onSelect: (x: { label: string; cell?: SegCell | null }) => void;
}) {
  const W = 1000;
  const H = 420;
  const root = d3
    .hierarchy({ children: items } as { children: typeof items })
    .sum((d) => (d as unknown as { value?: number }).value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  d3.treemap<{ children: typeof items }>().size([W, H]).paddingInner(3).round(true)(root);
  const total = items.reduce((s, x) => s + x.value, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Treemap of latest period">
      {(root.leaves() as unknown as d3.HierarchyRectangularNode<(typeof items)[number]>[]).map((l) => {
        const d = l.data;
        const w = l.x1 - l.x0;
        const h = l.y1 - l.y0;
        return (
          <g key={d.id} transform={`translate(${l.x0},${l.y0})`} className="cursor-pointer" onClick={() => onSelect(d)}>
            <rect width={w} height={h} rx={4} fill={d.color} opacity={0.88} />
            {w > 90 && h > 40 && (
              <foreignObject width={w} height={h}>
                <div className="flex h-full flex-col justify-between p-2.5 text-[15px] text-card">
                  <span className="line-clamp-2 font-medium leading-tight">{d.label}</span>
                  <span className="num text-[13px] opacity-90">
                    {fmtCompactUsd(d.value)} · {((d.value / total) * 100).toFixed(1)}%
                  </span>
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
    </svg>
  );
}
