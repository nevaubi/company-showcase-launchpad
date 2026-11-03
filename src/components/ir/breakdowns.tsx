import { useMemo, useState } from "react";
import { BarChart3, CheckCircle2, ChevronDown, Download, Search, Table2, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { ComboChart, type ComboSeries } from "@/components/charts/combo-chart";
import { ScaleToggle } from "@/components/financials/scale-toggle";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnitScale } from "@/hooks/use-preference";
import { DIMENSIONS, derivedOf, fmtIr, groupCsv, groupOrder, groupTitle, inDimension, periodLabel, periodLong, refOf, rowLabel, unitCaption } from "@/lib/ir/display";
import type { IrPayload, PayloadCell, PayloadCheck, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)", "var(--ink-muted)", "var(--link)"];
type Freq = "q" | "y";
const SPANS: Record<Freq, { v: string; l: string }[]> = {
  q: [
    { v: "8", l: "8Q" },
    { v: "12", l: "12Q" },
    { v: "20", l: "20Q" },
    { v: "all", l: "All" },
  ],
  y: [
    { v: "5", l: "5Y" },
    { v: "10", l: "10Y" },
    { v: "all", l: "All" },
  ],
};
const PAGE = 8;

export function IrBreakdowns({ ticker, payload }: { ticker: string; payload: IrPayload }) {
  const [freq, setFreq] = useState<Freq>("q");
  const [span, setSpan] = useState<string>("8");
  const [dim, setDim] = useState("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [scale] = useUnitScale();

  const byKey = useMemo(() => new Map(payload.series.map((s) => [s.k, s])), [payload]);
  const checks = useMemo(() => {
    const m = new Map<string, PayloadCheck>();
    for (const c of payload.checks) m.set(`${c.k}|${c.kind === "fy" ? "y" : "q"}|${c.e}`, c);
    return m;
  }, [payload]);

  const all = freq === "q" ? payload.quarters : payload.years;
  const cols = span === "all" ? all : all.slice(-Number(span));
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      payload.groups
        .filter((g) => inDimension(g, dim))
        .filter((g) => g.rows.some((r) => hasData(byKey.get(r.k), freq, cols)))
        .filter((g) => !q || groupTitle(g, g.root ? byKey.get(g.root) : undefined).toLowerCase().includes(q) || g.rows.some((r) => byKey.get(r.k)?.label.toLowerCase().includes(q)))
        .sort(groupOrder),
    [payload, dim, byKey, freq, cols, q],
  );
  const visible = groups.slice(0, shown);
  const inViewAll = payload.checks.filter((c) => (c.kind === "fy" ? "y" : "q") === freq && cols.includes(c.e));
  const inView = inViewAll.filter((c) => !c.partial);
  const partialInView = new Set(inViewAll.filter((c) => c.partial).map((c) => c.k)).size;
  const okInView = inView.filter((c) => c.ok).length;

  const changeFreq = (f: Freq) => {
    setFreq(f);
    setSpan(f === "q" ? "8" : "5");
  };

  return (
    <Panel
      title="Segment & KPI breakdowns"
      subtitle="Read from earnings releases, supplements, presentations and data files · click any value to open the stored document at that cell"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Period type" value={freq} onChange={changeFreq} options={[{ v: "q", l: "Quarterly" }, { v: "y", l: "Annual" }]} />
          <Segmented label="Periods shown" value={span} onChange={setSpan} options={SPANS[freq]} />
          <ScaleToggle />
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Segmented label="Breakdown type" size="xs" value={dim} onChange={(v) => (setDim(v), setShown(PAGE))} options={DIMENSIONS.map((d) => ({ v: d.v, l: d.l }))} />
        <div className="relative ml-auto w-full sm:w-60">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a line, e.g. iPhone, cloud" className="h-8 pl-7 text-xs" aria-label="Find a line" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
        {inView.length > 0 && (
          <span className={cn("inline-flex items-center gap-1", okInView === inView.length ? "text-positive" : "text-foreground")}>
            {okInView === inView.length ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5 text-warning" />}
            {okInView.toLocaleString()} of {inView.length.toLocaleString()} totals in view equal the sum of their parts
          </span>
        )}
        {partialInView > 0 && <span>{partialInView} breakdowns list selected lines only — the rest is shown as “Not itemized”</span>}
        <span>
          <em>Italic</em> = calculated ({freq === "q" ? "fourth quarter = full year − first three quarters" : "full year = sum of four quarters"})
        </span>
        <span>{groups.length} breakdowns</span>
      </div>

      {!visible.length ? (
        <p className="p-5 text-sm text-muted-foreground">{q ? `No lines match “${query}”.` : "Nothing in this view for the selected periods."}</p>
      ) : (
        <div className="grid grid-cols-1 divide-y">
          {visible.map((g) => (
            <BreakdownCard key={g.id} ticker={ticker} payload={payload} group={g} byKey={byKey} checks={checks} cols={cols} freq={freq} scale={scale} highlight={q} />
          ))}
        </div>
      )}
      {groups.length > shown && (
        <div className="border-t px-4 py-3 text-center">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE * 2)}>
            <ChevronDown />
            {groups.length - shown <= PAGE * 2
              ? `Show the remaining ${groups.length - shown} breakdown${groups.length - shown > 1 ? "s" : ""}`
              : `Show ${PAGE * 2} more of ${groups.length - shown} remaining breakdowns`}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function hasData(s: PayloadSeries | undefined, freq: Freq, cols: string[]) {
  if (!s) return false;
  const cells = freq === "q" ? s.q : s.y;
  return cols.some((c) => cells[c]);
}

function BreakdownCard({
  ticker,
  payload,
  group,
  byKey,
  checks,
  cols,
  freq,
  scale,
  highlight,
}: {
  ticker: string;
  payload: IrPayload;
  group: PayloadGroup;
  byKey: Map<string, PayloadSeries>;
  checks: Map<string, PayloadCheck>;
  cols: string[];
  freq: Freq;
  scale: ReturnType<typeof useUnitScale>[0];
  highlight: string;
}) {
  const { open } = useSource();
  const [view, setView] = useState<"table" | "chart">("table");
  const root = group.root ? byKey.get(group.root) : undefined;
  const rows = group.rows.map((r) => ({ ...r, s: byKey.get(r.k)! })).filter((r) => r.s && hasData(r.s, freq, cols));
  const cellsOf = (s: PayloadSeries) => (freq === "q" ? s.q : s.y);
  const directKids = root ? rows.filter((r) => r.s.parent === root.k) : [];
  const chartable = root && directKids.length >= 2 && (root.unit === "usd" || root.unit === "count");
  const groupChecks = rows.flatMap((r) => (r.s.total ? cols.map((c) => checks.get(`${r.k}|${freq}|${c}`)).filter(Boolean) : [])) as PayloadCheck[];
  const failing = groupChecks.filter((c) => !c.ok && !c.partial).length;
  const partials = groupChecks.filter((c) => c.partial);
  const coverage = partials.map((c) => c.sum / c.total);
  const partialCols = root ? new Map(cols.flatMap((e) => {
    const c = checks.get(`${root.k}|${freq}|${e}`);
    return c?.partial ? [[e, c] as const] : [];
  })) : new Map<string, PayloadCheck>();
  const title = groupTitle(group, root);

  const openCell = (s: PayloadSeries, end: string, c: PayloadCell) => {
    const periodLabel = periodLong(end, freq, c.m);
    const derived = derivedOf(payload, c);
    if (derived) open({ ticker, label: s.label, periodLabel, unit: s.unit, value: c.v, derived });
    else {
      const src = refOf(payload, { ...c, e: c.e ?? end }, s.label);
      if (src) open({ ticker, label: s.label, periodLabel, unit: s.unit, value: c.v, src });
    }
  };

  const download = () => {
    const blob = new Blob([groupCsv(payload, group, cols, freq)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ticker}-${title.replace(/[^\w]+/g, "-").toLowerCase()}-${freq === "q" ? "quarterly" : "annual"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const div = root?.unit === "usd" ? { full: 1, K: 1e3, M: 1e6, B: 1e9 }[scale] : 1;
  const series: ComboSeries[] = chartable
    ? [
        ...directKids.slice(0, 8).map((r, i) => ({
          id: r.k,
          label: r.s.label,
          color: PALETTE[i % PALETTE.length],
          type: "bar" as const,
          values: cols.map((c) => (cellsOf(r.s)[c] ? cellsOf(r.s)[c].v / div : null)),
          format: (v: number) => fmtIr(v * div, r.s.unit, scale),
          onSelect: (i2: number) => {
            const c = cellsOf(r.s)[cols[i2]];
            if (c) openCell(r.s, cols[i2], c);
          },
        })),
        {
          id: root!.k,
          label: root!.label,
          color: "var(--foreground)",
          type: "line" as const,
          values: cols.map((c) => (cellsOf(root!)[c] ? cellsOf(root!)[c].v / div : null)),
          format: (v: number) => fmtIr(v * div, root!.unit, scale),
          dashed: true,
        },
      ]
    : [];

  if (!rows.length) return null;
  return (
    <section className="min-w-0" aria-label={title}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <p className="text-[11px] text-muted-foreground">
            {unitCaption(group.unit, scale)} · {rows.length} lines
            {partials.length > 0 && (
              <span>
                {" "}
                · selected lines only ({Math.round(Math.min(...coverage) * 100)}
                {Math.round(Math.min(...coverage) * 100) !== Math.round(Math.max(...coverage) * 100) ? `–${Math.round(Math.max(...coverage) * 100)}` : ""}% of the total itemized)
              </span>
            )}
            {groupChecks.length > partials.length &&
              (failing ? (
                <span className="text-warning"> · {failing} of {groupChecks.length - partials.length} totals off</span>
              ) : (
                <span className="text-positive"> · every total ties out</span>
              ))}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {chartable && (
            <Segmented
              label="View"
              size="xs"
              value={view}
              onChange={setView}
              options={[
                { v: "table", l: "Table", title: "Table view" },
                { v: "chart", l: "Chart", title: "Stacked components with the total as a line" },
              ]}
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={download} aria-label="Download this breakdown as CSV">
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download CSV (full values)</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {view === "chart" && chartable ? (
        <div className="px-3 pb-3">
          <ComboChart categories={cols.map((c) => periodLabel(c, freq))} series={series} stacked height={240} leftFormat={(v) => (root!.unit === "usd" ? fmtCompact(v, 1) : fmtCompact(v, 1))} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
            {series.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1">
                <span className={cn("inline-block size-2 rounded-sm", s.type === "line" && "h-0.5 w-3 rounded-none")} style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin pb-2">
          <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-56 max-w-80 border-b bg-card px-4 py-1.5 text-left text-[11px] font-normal text-muted-foreground">Line</th>
                {cols.map((e) => (
                  <th key={e} className="num whitespace-nowrap border-b px-3 py-1.5 text-right text-[11px] font-semibold" title={periodLong(e, freq)}>
                    {periodLabel(e, freq)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ k, s, depth }) => {
                const cells = cellsOf(s);
                const isRoot = root?.k === k;
                const residual = isRoot && partialCols.size > 0 && (
                  <tr key="__residual" className="group">
                    <th scope="row" className="sticky left-0 z-10 max-w-80 border-b bg-card px-4 py-1 text-left font-normal italic text-muted-foreground group-hover:bg-secondary">
                      <span className="block truncate" style={{ paddingLeft: 14 }}>
                        Not itemized in the release
                      </span>
                    </th>
                    {cols.map((e) => {
                      const c = partialCols.get(e);
                      const tc = cellsOf(s)[e];
                      if (!c || !tc) return <td key={e} className="num border-b px-3 py-1 text-right text-muted-foreground/40">—</td>;
                      const kids = directKids.filter((r) => cellsOf(r.s)[e]);
                      const v = c.total - c.sum;
                      const openResidual = () => {
                        const parts = [
                          { ...(refOf(payload, { ...tc, e: tc.e ?? e }, s.label) ?? { accn: "", concept: s.label, end: e, value: tc.v }), label: s.label, sign: 1 as const },
                          ...kids.map((r) => {
                            const kc = cellsOf(r.s)[e];
                            return { ...(refOf(payload, { ...kc, e: kc.e ?? e }, r.s.label) ?? { accn: "", concept: r.s.label, end: e, value: kc.v }), label: r.s.label, sign: -1 as const };
                          }),
                        ];
                        open({ ticker, label: `${s.label} — not itemized`, periodLabel: periodLong(e, freq), unit: s.unit, value: v, derived: { formula: "Printed total − listed lines", parts } });
                      };
                      return (
                        <td key={e} className="border-b p-0 group-hover:bg-secondary/60">
                          <button onClick={openResidual} className="num block w-full whitespace-nowrap px-3 py-1 text-right italic text-muted-foreground tabular-nums hover:bg-highlight-soft">
                            {fmtIr(v, s.unit, scale)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
                const match = highlight && s.label.toLowerCase().includes(highlight);
                return [
                  residual,
                  <tr key={k} className="group">
                    <th
                      scope="row"
                      className={cn(
                        "sticky left-0 z-10 max-w-80 border-b bg-card px-4 py-1 text-left font-normal group-hover:bg-secondary",
                        s.total && "font-semibold",
                        isRoot && "border-t-2 border-t-foreground/70",
                        match && "bg-highlight-soft",
                      )}
                    >
                      <span className="block truncate" style={{ paddingLeft: root ? depth * 14 : 0 }} title={s.sc ? `${s.label} · ${s.sc}` : s.label}>
                        {isRoot ? s.label : rowLabel(s.label, root?.label)}
                        {s.sc && !isRoot && root?.sc !== s.sc && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· {s.sc}</span>}
                        {s.pit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(period end)</span>}
                      </span>
                    </th>
                    {cols.map((e) => {
                      const c = cells[e];
                      const chk = s.total ? checks.get(`${k}|${freq}|${e}`) : undefined;
                      if (!c) return <td key={e} className={cn("num border-b px-3 py-1 text-right text-muted-foreground/40", isRoot && "border-t-2 border-t-foreground/70")}>—</td>;
                      return (
                        <td key={e} className={cn("border-b p-0 group-hover:bg-secondary/60", isRoot && "border-t-2 border-t-foreground/70")}>
                          <Tooltip delayDuration={350}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => openCell(s, e, c)}
                                className={cn(
                                  "num block w-full whitespace-nowrap px-3 py-1 text-right tabular-nums hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  s.total && "font-medium",
                                  c.f && "italic text-foreground/85",
                                  c.v < 0 && "text-negative",
                                  chk && !chk.ok && "underline decoration-warning decoration-wavy underline-offset-4",
                                  c.w === "scale" && "bg-warning-soft text-warning",
                                )}
                              >
                                {fmtIr(c.v, s.unit, scale)}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              <p>{c.f ? c.f.formula : c.x ? `Printed as “${c.x}”` : periodLong(e, freq, c.m)}</p>
                              {c.d != null && payload.docs[c.d]?.filed && <p className="opacity-75">From the {payload.docs[c.d].kind?.replace("-", " ") ?? "document"} filed {payload.docs[c.d].filed}</p>}
                              {c.w === "scale" && <p className="font-medium text-warning">About 1,000× off the neighbouring periods — a different unit or measure may have been read here. Check the source.</p>}
                              {chk && <CheckLine chk={chk} unit={s.unit} scale={scale} />}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      );
                    })}
                  </tr>,
                ];
              })}
              {root && root.total && (
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-1 text-left text-[11px] font-normal text-muted-foreground">
                    Check: parts = total
                  </th>
                  {cols.map((e) => {
                    const chk = checks.get(`${root.k}|${freq}|${e}`);
                    return (
                      <td key={e} className="px-3 py-1 text-right text-[11px]">
                        {!chk ? (
                          <span className="text-muted-foreground/40">·</span>
                        ) : chk.partial ? (
                          <Tooltip delayDuration={250}>
                            <TooltipTrigger className="num text-muted-foreground">{Math.round((chk.sum / chk.total) * 100)}% listed</TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              <CheckLine chk={chk} unit={root.unit} scale={scale} />
                            </TooltipContent>
                          </Tooltip>
                        ) : chk.ok ? (
                          <Tooltip delayDuration={250}>
                            <TooltipTrigger className="inline-flex items-center text-positive" aria-label="Parts add up to the total">
                              <CheckCircle2 className="size-3.5" />
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              <CheckLine chk={chk} unit={root.unit} scale={scale} />
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip delayDuration={250}>
                            <TooltipTrigger className="num inline-flex items-center gap-0.5 text-warning">
                              <TriangleAlert className="size-3" />
                              {fmtIr(chk.sum - chk.total, root.unit, scale)}
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              <CheckLine chk={chk} unit={root.unit} scale={scale} />
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CheckLine({ chk, unit, scale }: { chk: PayloadCheck; unit: string; scale: ReturnType<typeof useUnitScale>[0] }) {
  if (chk.partial)
    return (
      <p>
        The release lists selected lines only: they add to {fmtIr(chk.sum, unit, scale)} of the printed {fmtIr(chk.total, unit, scale)} total ({Math.round((chk.sum / chk.total) * 100)}%). The remainder is shown as “Not itemized”.
      </p>
    );
  return chk.ok ? (
    <p className="text-positive">
      {chk.sub?.length
        ? `${chk.n} parts net to ${fmtIr(chk.sum, unit, scale)} = printed total, with ${chk.sub.join(", ")} subtracted`
        : `${chk.n} parts sum to ${fmtIr(chk.sum, unit, scale)} = printed total`}
    </p>
  ) : (
    <p>
      <span className="text-warning">Parts sum to {fmtIr(chk.sum, unit, scale)}</span> vs printed total {fmtIr(chk.total, unit, scale)} (difference {fmtIr(chk.sum - chk.total, unit, scale)})
    </p>
  );
}
