import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, ChevronsDown, Download, FileSpreadsheet, FileText, Loader2, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import wordmark from "@/assets/brand/wordmark.png.asset.json";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { ComboChart, type ComboSeries } from "@/components/charts/combo-chart";
import { ScaleToggle } from "@/components/financials/scale-toggle";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnitScale } from "@/hooks/use-preference";
import { coverageOf } from "@/lib/coverage";
import { useCompany } from "@/lib/data";
import { downloadBlob, fetchLogo, slug } from "@/lib/export/xlsx-theme";
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
const DEFAULT_SPAN: Record<Freq, string> = { q: "8", y: "5" };
/** Breakdowns rendered on first view; "show more" then adds STEP at a time. */
const PAGE = 8;
const STEP = 50;

/** A line + period to open on arrival (links from exported workbooks). */
export interface IrFocus {
  line: string;
  period: string;
  freq: Freq;
}

type ExportKind = { kind: "view" } | { kind: "all" } | { kind: "group"; group: PayloadGroup };

/** Opens the source panel for one cell: the stored document at that cell, or the calculation's parts. */
function openIrCell(open: (t: SourceTarget) => void, ticker: string, payload: IrPayload, s: PayloadSeries, end: string, freq: Freq, c: PayloadCell) {
  const periodLabel = periodLong(end, freq, c.m);
  const derived = derivedOf(payload, c);
  if (derived) return open({ ticker, label: s.label, periodLabel, unit: s.unit, value: c.v, derived }), true;
  const src = refOf(payload, { ...c, e: c.e ?? end }, s.label);
  if (src) return open({ ticker, label: s.label, periodLabel, unit: s.unit, value: c.v, src }), true;
  return false;
}

export function IrBreakdowns({ ticker, payload, focus, onFocusDone }: { ticker: string; payload: IrPayload; focus?: IrFocus; onFocusDone?: () => void }) {
  const [freq, setFreq] = useState<Freq>("q");
  const [span, setSpan] = useState<string>("8");
  const [dim, setDim] = useState("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [growing, startGrowing] = useTransition();
  const [exporting, setExporting] = useState<string | null>(null);
  const [scale] = useUnitScale();
  const { open } = useSource();
  const company = useCompany(ticker);

  const byKey = useMemo(() => new Map(payload.series.map((s) => [s.k, s])), [payload]);
  const checks = useMemo(() => {
    const m = new Map<string, PayloadCheck>();
    for (const c of payload.checks) m.set(`${c.k}|${c.kind === "fy" ? "y" : "q"}|${c.e}`, c);
    return m;
  }, [payload]);

  const all = freq === "q" ? payload.quarters : payload.years;
  const cols = useMemo(() => (span === "all" ? all : all.slice(-Number(span))), [all, span]);
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
  const remaining = groups.length - shown;
  const inViewAll = payload.checks.filter((c) => (c.kind === "fy" ? "y" : "q") === freq && cols.includes(c.e));
  const inView = inViewAll.filter((c) => !c.partial);
  const partialInView = new Set(inViewAll.filter((c) => c.partial).map((c) => c.k)).size;
  const okInView = inView.filter((c) => c.ok).length;

  const changeFreq = (f: Freq) => {
    setFreq(f);
    setSpan(DEFAULT_SPAN[f]);
  };

  // Arriving from a workbook link: show that line's breakdown and open the source at that period.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    const id = `${focus.line}|${focus.freq}|${focus.period}`;
    if (focused.current === id) return;
    focused.current = id;
    const s = byKey.get(focus.line);
    const c = s && (focus.freq === "q" ? s.q : s.y)[focus.period];
    if (!s || !c) {
      toast.error("That number isn't in the current data", { description: "The line may have been renamed or re-read since the workbook was exported. Search for it below." });
      onFocusDone?.();
      return;
    }
    const periods = focus.freq === "q" ? payload.quarters : payload.years;
    setFreq(focus.freq);
    setSpan(periods.indexOf(focus.period) < periods.length - Number(DEFAULT_SPAN[focus.freq]) ? "all" : DEFAULT_SPAN[focus.freq]);
    setDim("all");
    setQuery("");
    const group = payload.groups.find((g) => g.rows.some((r) => r.k === s.k));
    const sorted = [...payload.groups].sort(groupOrder);
    const at = group ? sorted.indexOf(group) : -1;
    setShown((n) => Math.max(n, at + 1));
    openIrCell(open, ticker, payload, s, focus.period, focus.freq, c);
    if (group)
      setTimeout(() => {
        document.querySelector(`[data-group="${CSS.escape(group.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    onFocusDone?.();
  }, [focus, byKey, payload, open, ticker, onFocusDone]);

  const runExport = async (what: ExportKind) => {
    const key = what.kind === "group" ? what.group.id : what.kind;
    if (exporting) return;
    setExporting(key);
    const toastId = toast.loading(what.kind === "all" ? "Building the complete workbook…" : "Building the Excel workbook…", {
      description: what.kind === "all" ? "Every breakdown, quarterly and annual, with checks and sources. Large banks take a few seconds." : undefined,
    });
    try {
      const cov = coverageOf(ticker);
      const dimLabel = DIMENSIONS.find((d) => d.v === dim)?.l ?? "All";
      const periodWord = freq === "q" ? "quarter" : "year";
      const range = cols.length ? `${periodLabel(cols[0], freq)} – ${periodLabel(cols[cols.length - 1], freq)}` : "";
      const opts =
        what.kind === "all"
          ? { groups: payload.groups, freqs: ["q", "y"] as Freq[], cols: undefined, scope: `Complete history — all ${payload.groups.length} breakdowns, quarterly and annual` }
          : what.kind === "group"
            ? { groups: [what.group], freqs: [freq], cols: { [freq]: cols }, scope: `One breakdown — ${groupTitle(what.group, what.group.root ? byKey.get(what.group.root) : undefined)} · ${cols.length} ${periodWord}s (${range})` }
            : {
                groups,
                freqs: [freq],
                cols: { [freq]: cols },
                scope: `${groups.length} breakdowns in view · ${dimLabel === "All" ? "all types" : dimLabel} · ${cols.length} ${periodWord}s (${range})${q ? ` · lines matching “${query.trim()}”` : ""}`,
              };
      const [{ exportIrWorkbook }, logo] = await Promise.all([import("@/lib/export/ir-export.client"), fetchLogo(wordmark.url)]);
      const { blob, stats } = await exportIrWorkbook({
        ticker,
        company: cov?.shortName ?? company.data?.profile.name,
        cik: company.data?.profile.cik ?? cov?.cik ?? null,
        payload,
        scale,
        origin: window.location.origin,
        logo,
        ...opts,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const name =
        what.kind === "all"
          ? `${ticker}-ir-breakdowns-complete-${stamp}.xlsx`
          : what.kind === "group"
            ? `${ticker}-${slug(groupTitle(what.group, what.group.root ? byKey.get(what.group.root) : undefined))}-${freq === "q" ? "quarterly" : "annual"}.xlsx`
            : `${ticker}-ir-breakdowns-${dim === "all" ? "all" : slug(dimLabel)}-${freq === "q" ? "quarterly" : "annual"}-${stamp}.xlsx`;
      downloadBlob(blob, name);
      toast.success("Excel workbook downloaded", {
        id: toastId,
        description: `${stats.breakdowns.toLocaleString()} breakdown${stats.breakdowns === 1 ? "" : "s"} · ${stats.values.toLocaleString()} values · ${stats.formulas.toLocaleString()} live formulas · ${(blob.size / 1e6).toFixed(1)} MB`,
        action: { label: "Save again", onClick: () => downloadBlob(blob, name) },
        duration: 8000,
      });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't build the workbook", { id: toastId, description: (e as Error).message });
    } finally {
      setExporting(null);
    }
  };

  const range = (f: Freq) => {
    const p = f === "q" ? payload.quarters : payload.years;
    return p.length ? `${periodLabel(p[0], f)} – ${periodLabel(p[p.length - 1], f)}` : "";
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!!exporting && exporting !== "view" && exporting !== "all"} aria-busy={exporting === "view" || exporting === "all"}>
                {exporting === "view" || exporting === "all" ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
                {exporting === "view" || exporting === "all" ? "Building…" : "Excel"}
                <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Styled workbook with live formulas, tie-out checks and a source link for every number</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!!exporting || !groups.length} onSelect={() => runExport({ kind: "view" })} className="items-start gap-2.5 py-2">
                <FileSpreadsheet className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Breakdowns in view</span>
                  <span className="block text-xs text-muted-foreground">
                    {groups.length} breakdown{groups.length === 1 ? "" : "s"} · {cols.length} {freq === "q" ? "quarters" : "years"}
                    {dim !== "all" || q ? " · current filters" : ""}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!!exporting} onSelect={() => runExport({ kind: "all" })} className="items-start gap-2.5 py-2">
                <ChevronsDown className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Complete history</span>
                  <span className="block text-xs text-muted-foreground">
                    All {payload.groups.length} breakdowns · quarterly {range("q")} and annual {range("y")}
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Segmented label="Breakdown type" size="xs" value={dim} onChange={(v) => (setDim(v), setShown(PAGE))} options={DIMENSIONS.map((d) => ({ v: d.v, l: d.l }))} />
        <div className="relative ml-auto w-full sm:w-60">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => (setQuery(e.target.value), setShown(PAGE))} placeholder="Find a line, e.g. iPhone, cloud" className="h-8 pl-7 text-xs" aria-label="Find a line" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
        {inView.length > 0 && (
          <span className={cn("inline-flex items-center gap-1", okInView === inView.length ? "text-positive" : "text-foreground")}>
            {okInView === inView.length ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5 text-warning" />}
            {okInView.toLocaleString()} of {inView.length.toLocaleString()} totals in view equal the sum of their parts
          </span>
        )}
        {partialInView > 0 && <span>{partialInView} breakdown{partialInView === 1 ? " lists" : "s list"} selected lines only — the rest is shown as “Not itemized”</span>}
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
            <BreakdownCard
              key={g.id}
              ticker={ticker}
              payload={payload}
              group={g}
              byKey={byKey}
              checks={checks}
              cols={cols}
              freq={freq}
              scale={scale}
              highlight={q}
              exporting={exporting === g.id}
              onExcel={() => runExport({ kind: "group", group: g })}
            />
          ))}
        </div>
      )}
      {remaining > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t px-4 py-3">
          <span className="num mr-1 text-xs text-muted-foreground">
            Showing {shown.toLocaleString()} of {groups.length.toLocaleString()}
          </span>
          <Button variant="outline" size="sm" disabled={growing} onClick={() => startGrowing(() => setShown((n) => n + STEP))}>
            {growing ? <Loader2 className="animate-spin" /> : <ChevronDown />}
            {remaining <= STEP ? `Show the remaining ${remaining} breakdown${remaining > 1 ? "s" : ""}` : `Show ${STEP} more`}
          </Button>
          {remaining > STEP && (
            <Button variant="ghost" size="sm" disabled={growing} onClick={() => startGrowing(() => setShown(groups.length))}>
              <ChevronsDown />
              Show all {remaining.toLocaleString()} remaining
            </Button>
          )}
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
  exporting,
  onExcel,
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
  exporting: boolean;
  onExcel: () => void;
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

  const openCell = (s: PayloadSeries, end: string, c: PayloadCell) => openIrCell(open, ticker, payload, s, end, freq, c);

  const download = () => {
    const blob = new Blob([groupCsv(payload, group, cols, freq)], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${ticker}-${slug(title)}-${freq === "q" ? "quarterly" : "annual"}.csv`);
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
    // Off-screen breakdowns skip layout and paint, so long lists (hundreds for big banks) stay smooth.
    <section className="min-w-0 scroll-mt-20 [content-visibility:auto] [contain-intrinsic-size:auto_320px]" aria-label={title} data-group={group.id}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <p className="text-[11px] text-muted-foreground">
            {unitCaption(group.unit, scale)} · {rows.length} line{rows.length === 1 ? "" : "s"}
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
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Download this breakdown" aria-busy={exporting}>
                    {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Download this breakdown</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={onExcel} disabled={exporting} className="items-start gap-2.5 py-2">
                <FileSpreadsheet className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Excel workbook</span>
                  <span className="block text-xs text-muted-foreground">Styled, with formulas, checks and sources</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={download} className="items-start gap-2.5 py-2">
                <FileText className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">CSV</span>
                  <span className="block text-xs text-muted-foreground">Plain values in full units</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
