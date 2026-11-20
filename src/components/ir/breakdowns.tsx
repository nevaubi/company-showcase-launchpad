import { useFeatureGate } from "@/hooks/use-plan";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronsDown, Download, FileSpreadsheet, FileText, Info, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import wordmark from "@/assets/brand/wordmark.png.asset.json";
import { IrPanel, useFits } from "@/components/ir/panel";
import { DASH, IR, indentStyle } from "@/components/ir/typography";
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
import { DIMENSIONS, countScale, derivedOf, fmtIr, groupColumns, groupCsv, groupOrder, groupTitle, inDimension, periodLabel, periodLong, refOf, rowDecimals, rowLabel, unitCaption } from "@/lib/ir/display";
import type { IrPayload, PayloadAlt, PayloadCell, PayloadCheck, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";
import { currency } from "@/lib/ir/highlights";
import { cellsFor, fiscalLabel, fiscalYearEndMonth, heldFor, periodGrids } from "@/lib/ir/periods";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)", "var(--muted-foreground)", "var(--link)"];
type Freq = "q" | "y" | "m";
const SPANS: Record<Freq, { v: string; l: string }[]> = {
  m: [
    { v: "12", l: "12M" },
    { v: "24", l: "24M" },
    { v: "all", l: "All" },
  ],
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
const DEFAULT_SPAN: Record<Freq, string> = { q: "8", y: "5", m: "12" };
const FREQ_FILE: Record<Freq, string> = { q: "quarterly", y: "annual", m: "monthly" };
/** Breakdowns rendered on first paint; the rest follow in the background, STEP at a time, so nothing waits behind a button. */
const PAGE = 8;
const STEP = 24;

/** A line + period to open on arrival (links from exported workbooks). */
export interface IrFocus {
  line: string;
  period: string;
  freq: Freq;
}

type ExportKind = { kind: "view" } | { kind: "all" } | { kind: "group"; group: PayloadGroup };

/** Opens the source panel for one cell: the stored document at that cell, or the calculation's parts. */
export function openIrCell(open: (t: SourceTarget) => void, ticker: string, payload: IrPayload, s: PayloadSeries, end: string, freq: Freq, c: PayloadCell) {
  // A balance keeps its own as-of date ("as of Sep 24", stated in the release) under the quarter's column.
  const periodLabel = periodLong(c.m === 0 && c.e ? c.e : end, freq, c.m);
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

  const grids = periodGrids(payload);
  const all = grids[freq];
  const cols = useMemo(() => (span === "all" ? all : all.slice(-Number(span))), [all, span]);
  const q = query.trim().toLowerCase();
  // Breakdowns reported in the latest periods come first; older or discontinued tables follow.
  const { groups, older } = useMemo(() => {
    const cellsOfKey = (k: string) => {
      const s = byKey.get(k);
      return s ? cellsFor(s, freq) : undefined;
    };
    const list = payload.groups
      .filter((g) => inDimension(g, dim))
      .filter((g) => g.rows.some((r) => hasData(byKey.get(r.k), cols, freq)))
      .filter((g) => !q || groupTitle(g, g.root ? byKey.get(g.root) : undefined).toLowerCase().includes(q) || g.rows.some((r) => byKey.get(r.k)?.label.toLowerCase().includes(q)))
      .map((g) => ({ g, tier: currency(g, cellsOfKey, cols).tier, dense: partsDense(g, cellsOfKey, cols) }))
      // Current tables first; among them, tables whose parts are printed in most periods before sparse ones.
      .sort((a, b) => a.tier - b.tier || (a.tier < 2 ? Number(b.dense) - Number(a.dense) : 0) || groupOrder(a.g, b.g));
    const firstOld = list.findIndex((x) => x.tier === 2);
    return { groups: list.map((x) => x.g), older: firstOld };
  }, [payload, dim, byKey, freq, cols, q]);
  const visible = groups.slice(0, shown);
  const fyEnd = useMemo(() => fiscalYearEndMonth(payload), [payload]);
  // Render the rest of the breakdowns in the background, a batch per frame, without a "show more" step.
  useEffect(() => {
    if (shown >= groups.length) return;
    const t = setTimeout(() => startGrowing(() => setShown((n) => n + STEP)), 16);
    return () => clearTimeout(t);
  }, [shown, groups.length]);
  const inViewAll = payload.checks.filter((c) => (c.kind === "fy" ? "y" : "q") === freq && cols.includes(c.e));
  const inView = inViewAll.filter((c) => !c.partial);
  const partialInView = new Set(inViewAll.filter((c) => c.partial).map((c) => c.k)).size;
  const okInView = inView.filter((c) => c.ok).length;

  // A new period grid lays the tables out again from the top, a batch at a time (banks hold over a thousand).
  const changeFreq = (f: Freq) => {
    setFreq(f);
    setSpan(DEFAULT_SPAN[f]);
    setShown(PAGE);
  };
  const changeSpan = (v: string) => {
    setSpan(v);
    setShown(PAGE);
  };

  // Arriving from a workbook link: show that line's breakdown and open the source at that period.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    const id = `${focus.line}|${focus.freq}|${focus.period}`;
    if (focused.current === id) return;
    focused.current = id;
    // Lines merged since the workbook was exported resolve to the line they were merged into.
    const s = byKey.get(focus.line) ?? byKey.get(payload.alias?.[focus.line] ?? "");
    const c = s && cellsFor(s, focus.freq)[focus.period];
    if (!s || !c) {
      toast.error("That number isn't in the current data", { description: "The line may have been renamed or re-read since the workbook was exported. Search for it below." });
      onFocusDone?.();
      return;
    }
    const periods = periodGrids(payload)[focus.freq];
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

  const exportGate = useFeatureGate();
  // Cards are memoized: they get a stable export callback and the source opener as props, so opening
  // a source (which changes the source context) or exporting doesn't re-render every table.
  const exportRef = useRef<(what: ExportKind) => Promise<void>>(async () => undefined);
  const exportGroup = useCallback((group: PayloadGroup) => void exportRef.current({ kind: "group", group }), []);
  const runExport = async (what: ExportKind) => {
    if (!exportGate("exports")) return;
    const key = what.kind === "group" ? what.group.id : what.kind;
    if (exporting) return;
    setExporting(key);
    const toastId = toast.loading(what.kind === "all" ? "Building the complete workbook…" : "Building the Excel workbook…", {
      description: what.kind === "all" ? "Every breakdown, quarterly and annual, with checks and sources. Large banks take a few seconds." : undefined,
    });
    try {
      const cov = coverageOf(ticker);
      const dimLabel = DIMENSIONS.find((d) => d.v === dim)?.l ?? "All";
      const periodWord = { q: "quarter", y: "year", m: "month" }[freq];
      const range = cols.length ? `${periodLabel(cols[0], freq)} – ${periodLabel(cols[cols.length - 1], freq)}` : "";
      const opts =
        what.kind === "all"
          ? {
              groups: payload.groups,
              freqs: (grids.m.length >= 3 ? ["q", "y", "m"] : ["q", "y"]) as Freq[],
              cols: undefined,
              scope: `Complete history — all ${payload.groups.length} breakdowns, quarterly${grids.m.length >= 3 ? ", annual and monthly" : " and annual"}`,
            }
          : what.kind === "group"
            ? (() => {
                // Only the periods this breakdown fills, like the table on screen.
                const gc = groupColumns(what.group.rows.flatMap((r) => (byKey.get(r.k) ? [{ s: byKey.get(r.k)! }] : [])), cols, freq);
                const gr = gc.length ? `${periodLabel(gc[0], freq)} – ${periodLabel(gc[gc.length - 1], freq)}` : range;
                return { groups: [what.group], freqs: [freq], cols: { [freq]: gc.length ? gc : cols }, scope: `One breakdown — ${groupTitle(what.group, what.group.root ? byKey.get(what.group.root) : undefined)} · ${gc.length || cols.length} ${periodWord}s (${gr})` };
              })()
            : {
                groups,
                freqs: [freq],
                cols: { [freq]: cols },
                scope: `${groups.length} breakdowns in view · ${dimLabel === "All" ? "all types" : dimLabel} · ${cols.length} ${periodWord}s (${range})${q ? ` · lines matching “${query.trim()}”` : ""}`,
              };
      const [{ exportIrWorkbook }, logo] = await Promise.all([import("@/lib/export/ir-export-browser"), fetchLogo(wordmark.url)]);
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
            ? `${ticker}-${slug(groupTitle(what.group, what.group.root ? byKey.get(what.group.root) : undefined))}-${FREQ_FILE[freq]}.xlsx`
            : `${ticker}-ir-breakdowns-${dim === "all" ? "all" : slug(dimLabel)}-${FREQ_FILE[freq]}-${stamp}.xlsx`;
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

  exportRef.current = runExport;

  const range = (f: Freq) => {
    const p = grids[f];
    return p.length ? `${periodLabel(p[0], f)} – ${periodLabel(p[p.length - 1], f)}` : "";
  };

  return (
    <IrPanel
      section="Segment and KPI breakdowns"
      tour="ir-breakdowns"
      title="Segment and KPI breakdowns"
      subtitle="Click any value to open the stored document at that cell"
      actions={
        <>
          <Segmented
            label="Period type"
            value={freq}
            onChange={changeFreq}
            options={[
              { v: "q", l: "Quarterly" },
              { v: "y", l: "Annual" },
              ...(grids.m.length >= 3 ? [{ v: "m" as const, l: "Monthly", title: "Month-end balances and counts from monthly operating reports" }] : []),
            ]}
          />
          <Segmented label="Periods shown" value={span} onChange={changeSpan} options={SPANS[freq]} />
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
                    {groups.length} breakdown{groups.length === 1 ? "" : "s"} · {cols.length} {{ q: "quarters", y: "years", m: "months" }[freq]}
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
        </>
      }
    >
      <div data-agent-controls className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Segmented label="Breakdown type" size="xs" value={dim} onChange={(v) => (setDim(v), setShown(PAGE))} options={DIMENSIONS.map((d) => ({ v: d.v, l: d.l }))} />
        <div className="relative ml-auto w-full sm:w-60">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => (setQuery(e.target.value), setShown(PAGE))} placeholder="Find a line, e.g. iPhone, cloud" className="h-8 pl-7 text-xs" aria-label="Find a line" />
        </div>
      </div>
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5", IR.caption)}>
        <span className="num">
          {groups.length.toLocaleString()} breakdown{groups.length === 1 ? "" : "s"}
        </span>
        {inView.length > 0 && (
          <span className={cn("inline-flex items-center gap-1.5", okInView < inView.length && "text-foreground")}>
            {okInView < inView.length && <CheckDot />}
            <span className="num">
              {okInView.toLocaleString()} of {inView.length.toLocaleString()}
            </span>
            totals equal the sum of their parts
          </span>
        )}
        <Tooltip>
          <TooltipTrigger className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
            <Info className="size-3.5" /> How to read
          </TooltipTrigger>
          <TooltipContent align="end" className="max-w-sm space-y-1.5 text-xs">
            <p>Columns run from the oldest to the newest period a table reports, headed by fiscal quarter or year with the calendar month under it; a dash marks a period no stored document prints.</p>
            {freq === "m" ? (
              <p>Month-end balances and counts from monthly operating reports, with the quarter-end values in between.</p>
            ) : (
              <p>
                Values with a dotted underline are calculated ({freq === "q" ? "fourth quarter = full year − first three quarters; second and third quarters from year-to-date columns" : "full year = sum of four quarters"}); hover one to see the formula.
              </p>
            )}
            {partialInView > 0 && <p>{partialInView} breakdown{partialInView === 1 ? " lists" : "s list"} selected lines only; the rest of the total shows as “Not itemized”.</p>}
            <p>Tables the company printed under different names over the years are combined into one, and a table or line printed twice is shown once; every value still opens its own source. A small amber dot marks a total whose parts don't add up; hover it for the numbers.</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {!visible.length ? (
        <p className="p-4 text-[13px] text-muted-foreground">{q ? `No lines match “${query}”.` : "Nothing in this view for the selected periods."}</p>
      ) : (
        <div className="grid grid-cols-1 pb-4">
          {visible.map((g, i) => [
            i === older && (
              <div key="__older" className="mt-6 border-y bg-secondary/40 px-4 py-1.5">
                <span className={IR.eyebrow}>Not in the latest {freq === "y" ? "years" : freq === "m" ? "months" : "quarters"} shown · older or discontinued tables</span>
              </div>
            ),
            <BreakdownCard
              key={g.id}
              ticker={ticker}
              payload={payload}
              group={g}
              byKey={byKey}
              checks={checks}
              cols={cols}
              freq={freq}
              fyEnd={fyEnd}
              scale={scale}
              highlight={q}
              exporting={exporting === g.id}
              onExcel={exportGroup}
              open={open}
            />,
          ])}
          {growing || shown < groups.length ? (
            <p role="status" className={cn("px-4 pt-4", IR.caption)}>
              <Loader2 className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" />
              Laying out {Math.max(0, groups.length - shown).toLocaleString()} more breakdowns
            </p>
          ) : null}
        </div>
      )}
    </IrPanel>
  );
}

/** The table's parts (not just its total) are printed in at least half of the periods it spans in view. */
function partsDense(g: PayloadGroup, cellsOf: (k: string) => Record<string, unknown> | undefined, cols: string[]) {
  const parts = g.rows.filter((r) => r.k !== g.root).map((r) => cellsOf(r.k));
  if (!parts.length) return false;
  const filled = cols.map((e) => parts.some((c) => c?.[e]));
  const first = filled.indexOf(true);
  if (first < 0) return false;
  const spanned = filled.slice(first);
  return spanned.filter(Boolean).length >= spanned.length / 2;
}

function hasData(s: PayloadSeries | undefined, cols: string[], freq: Freq) {
  if (!s) return false;
  const cells = cellsFor(s, freq);
  const held = heldFor(s, freq);
  return cols.some((c) => cells[c] || held[c]);
}

const BreakdownCard = memo(function BreakdownCard({
  open,
  ticker,
  payload,
  group,
  byKey,
  checks,
  cols: viewCols,
  freq,
  fyEnd,
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
  fyEnd: number | null;
  scale: ReturnType<typeof useUnitScale>[0];
  highlight: string;
  exporting: boolean;
  onExcel: (group: PayloadGroup) => void;
  open: (t: SourceTarget) => void;
}) {
  const [view, setView] = useState<"table" | "chart">("table");
  const [wrap, fits] = useFits<HTMLDivElement>();
  const root = group.root ? byKey.get(group.root) : undefined;
  const rows = group.rows.map((r) => ({ ...r, s: byKey.get(r.k)! })).filter((r) => r.s && hasData(r.s, viewCols, freq));
  // From this table's oldest to its newest value only: no empty columns before or after its data.
  const cols = groupColumns(rows, viewCols, freq);
  const cellsOf = (s: PayloadSeries) => cellsFor(s, freq);
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
  // Figures held back as suspect, and shown values another document prints differently, in view.
  const heldN = rows.reduce((n, r) => n + cols.filter((e) => heldFor(r.s, freq)[e]).length, 0);
  const others = rows.flatMap((r) => cols.flatMap((e) => {
    const c = cellsOf(r.s)[e];
    return c?.alt ? [{ s: r.s, e, c, alt: c.alt }] : [];
  }));
  // A loose list can hold the same label from several tables (each segment's "Net interest income"): name the table.
  const repeated = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows) n.set(r.s.label, (n.get(r.s.label) ?? 0) + 1);
    return n;
  }, [rows]);
  // Counts get one scale for the whole table, stated in the caption instead of every cell.
  const counts = group.unit === "count" ? countScale(rows.flatMap((r) => cols.map((e) => cellsOf(r.s)[e]?.v).filter((v): v is number => v != null))) : null;
  const fmtOpts = (s: PayloadSeries) => ({ decimals: rowDecimals(cols.map((e) => cellsOf(s)[e]?.v).filter((v): v is number => v != null), s.unit, scale), countDiv: counts?.div });

  const openCell = (s: PayloadSeries, end: string, c: PayloadCell) => openIrCell(open, ticker, payload, s, end, freq, c);

  const gate = useFeatureGate();
  const download = () => {
    if (!gate("exports")) return;
    const blob = new Blob([groupCsv(payload, group, cols, freq)], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${ticker}-${slug(title)}-${FREQ_FILE[freq]}.csv`);
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
  const head = (e: string) => fiscalLabel(e, freq, fyEnd);
  const stickyHead = fits ? "sticky top-14 z-10" : "";
  return (
    // Off-screen breakdowns skip layout and paint, so long lists (hundreds for big banks) stay smooth.
    <section className="min-w-0 scroll-mt-24 pt-6 first:pt-4 [content-visibility:auto] [contain-intrinsic-size:auto_320px]" aria-label={title} data-group={group.id}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 pb-3">
        <div className="min-w-0 flex-1">
          <h3 className={IR.group}>{title}</h3>
          <p className={IR.caption}>
            {unitCaption(group.unit, scale, counts?.caption)} · {rows.length} line{rows.length === 1 ? "" : "s"}
            {cols.length > 0 && (
              <>
                {" · "}
                {cols.length === 1 ? head(cols[0]).main : `${head(cols[0]).main} to ${head(cols[cols.length - 1]).main}`}
              </>
            )}
            {partials.length > 0 && (
              <>
                {" · "}selected lines only, {Math.round(Math.min(...coverage) * 100)}
                {Math.round(Math.min(...coverage) * 100) !== Math.round(Math.max(...coverage) * 100) ? `–${Math.round(Math.max(...coverage) * 100)}` : ""}% of the total itemized
              </>
            )}
            {groupChecks.length > partials.length &&
              (failing ? (
                <span className="text-foreground">
                  {" · "}
                  <CheckDot /> {failing} of {groupChecks.length - partials.length} totals don't add up
                </span>
              ) : (
                <> · parts add up in every period</>
              ))}
            {heldN > 0 && (
              <span className="text-foreground">
                {" · "}
                <HeldMark /> {heldN} figure{heldN === 1 ? "" : "s"} held back: unit or period contradicted by the documents
              </span>
            )}
          </p>
        </div>
        <div data-agent-controls className="flex items-center gap-1">
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
              <DropdownMenuItem onSelect={() => onExcel(group)} disabled={exporting} className="items-start gap-2.5 py-2">
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
          <ComboChart categories={cols.map((c) => head(c).main)} series={series} stacked height={240} leftFormat={(v) => fmtCompact(v, 1)} />
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
        <div ref={wrap} className={cn("relative border-t", !fits && "overflow-x-auto scrollbar-thin")}>
          <table className={cn("min-w-full border-separate border-spacing-0", IR.row, fits ? "w-full" : "w-max")}>
            <thead>
              <tr>
                <th scope="col" className={cn("left-0 z-20 min-w-56 border-b bg-card py-1.5 pl-4 pr-3 text-left align-bottom font-normal", !fits && "sticky", stickyHead)}>
                  <span className="sr-only">Line</span>
                </th>
                {cols.map((e) => {
                  const h = head(e);
                  return (
                    <th key={e} scope="col" className={cn("whitespace-nowrap border-b bg-card px-3 py-1.5 text-right align-bottom font-normal", stickyHead)} title={periodLong(e, freq)}>
                      <span className="num block text-[11px] font-medium text-foreground">{h.main}</span>
                      {h.sub && <span className="num block text-[11px] text-muted-foreground">{h.sub}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ k, s, depth }) => {
                const cells = cellsOf(s);
                const isRoot = root?.k === k;
                const d = root ? depth : 0;
                const opts = fmtOpts(s);
                const rule = isRoot ? "border-t border-t-foreground/40" : s.total ? "border-t border-t-border" : "";
                const residual = isRoot && partialCols.size > 0 && (
                  <tr key="__residual" className="group">
                    <th scope="row" className="sticky left-0 z-[1] max-w-[22rem] border-b bg-card py-1 pr-3 text-left font-normal text-muted-foreground transition-colors duration-150 group-hover:bg-secondary" style={indentStyle(1)}>
                      Not itemized in the release
                    </th>
                    {cols.map((e) => {
                      const c = partialCols.get(e);
                      const tc = cellsOf(s)[e];
                      if (!c || !tc) return <td key={e} className={cn("border-b px-3 py-1", IR.num, IR.missing)}>{DASH}</td>;
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
                        open({ ticker, label: `${s.label}, not itemized`, periodLabel: periodLong(e, freq), unit: s.unit, value: v, derived: { formula: "Printed total − listed lines", parts } });
                      };
                      return (
                        <td key={e} className="border-b p-0 transition-colors duration-150 group-hover:bg-secondary/60">
                          <button type="button" onClick={openResidual} title="Printed total − listed lines" className={cn(IR.cellButton, IR.num, "text-muted-foreground")}>
                            <span className={IR.derived}>{fmtIr(v, s.unit, scale, opts)}</span>
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
                        "sticky left-0 z-[1] max-w-[22rem] border-b bg-card py-1 pr-3 text-left font-normal transition-colors duration-150 group-hover:bg-secondary",
                        s.total && IR.total,
                        rule,
                        match && "bg-highlight-soft [&_span]:text-foreground",
                      )}
                      style={indentStyle(d)}
                      title={s.sc ? `${s.label} · ${s.sc}` : undefined}
                    >
                      {d >= 2 && <span aria-hidden className="absolute inset-y-0 border-l border-border" style={{ left: indentStyle(d - 1).paddingLeft + 4 }} />}
                      {isRoot ? s.label : rowLabel(s.label, root?.label, group.px)}
                      {s.sc && !isRoot && root?.sc !== s.sc ? (
                        <span className={cn("ml-1 font-normal", IR.caption)}>· {s.sc}</span>
                      ) : !root && s.bd && (repeated.get(s.label) ?? 0) > 1 ? (
                        <span className={cn("ml-1 font-normal", IR.caption)}>· {s.bd}</span>
                      ) : null}
                      {s.pit && <span className={cn("ml-1 font-normal", IR.caption)}>at period end</span>}
                    </th>
                    {cols.map((e) => {
                      const c = cells[e];
                      const chk = s.total ? checks.get(`${k}|${freq}|${e}`) : undefined;
                      const h = !c ? heldFor(s, freq)[e] : undefined;
                      if (h)
                        return (
                          <td key={e} className={cn("border-b p-0 transition-colors duration-150 group-hover:bg-secondary/60", rule)}>
                            <button type="button" onClick={() => openCell(s, e, h)} title={heldTitle(payload, h, e, freq)} className={cn(IR.cellButton, IR.num, "text-muted-foreground")}>
                              <HeldMark className="mr-1" />
                              <span className="text-[11px]">held</span>
                              <span className="sr-only"> (figure held back: {h.why})</span>
                            </button>
                          </td>
                        );
                      if (!c)
                        return (
                          <td key={e} title="Not printed in any stored document for this period" className={cn("border-b px-3 py-1 transition-colors duration-150 group-hover:bg-secondary/60", IR.num, IR.missing, rule)}>
                            {DASH}
                          </td>
                        );
                      const off = chk && !chk.ok && !chk.partial;
                      return (
                        <td key={e} className={cn("border-b p-0 transition-colors duration-150 group-hover:bg-secondary/60", rule)}>
                          {/* A native title instead of a tooltip component per cell: bank-sized pages hold tens of thousands of cells. */}
                          <button
                            type="button"
                            onClick={() => openCell(s, e, c)}
                            title={cellTitle(payload, c, e, freq, s.unit, scale, chk)}
                            className={cn(IR.cellButton, IR.num, s.total && IR.total)}
                          >
                            <span className={cn(c.f && IR.derived)}>{fmtIr(c.v, s.unit, scale, opts)}</span>
                            {c.alt && <AltMark className="ml-1" />}
                            {c.alt && <span className="sr-only"> (printed differently in another document)</span>}
                            {off && <CheckDot className="ml-1" />}
                            {off && <span className="sr-only"> (parts do not add up)</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {others.length > 0 && (
        <div className={cn("border-t px-4 pt-2", IR.caption)} data-section="Printed differently">
          <p className="text-foreground">Printed differently in another document</p>
          <ul className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {others.map(({ s, e, c, alt }) => {
              const doc = alt.d != null ? payload.docs[alt.d] : undefined;
              const openAlt = () => {
                const src = refOf(payload, { ...alt, e: alt.e ?? e }, s.label);
                if (src) open({ ticker, label: s.label, periodLabel: periodLong(alt.m === 0 && alt.e ? alt.e : e, freq, alt.m), unit: s.unit, value: alt.v, src });
              };
              return (
                <li key={`${s.k}|${e}`} className="flex min-w-0 items-baseline gap-1.5">
                  <AltMark className="shrink-0" />
                  <span className="min-w-0">
                    {rowLabel(s.label, root?.label, group.px)}, {head(e).main}: shown {fmtIr(c.v, s.unit, scale, fmtOpts(s))}; {alt.kind === "restated" ? "an earlier" : "another"} {kindName(doc?.kind)} {doc?.filed ? `filed ${doc.filed}` : "with no filing date"} prints {fmtIr(alt.v, s.unit, scale, fmtOpts(s))}
                  </span>
                  <button type="button" onClick={openAlt} className="shrink-0 rounded-sm text-foreground underline decoration-border underline-offset-2 transition-colors duration-150 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
});

const KIND_NAME: Record<string, string> = { "press-release": "earnings release", supplement: "supplement", presentation: "presentation", data: "data file", other: "document" };
const kindName = (k: string | null | undefined) => KIND_NAME[k ?? ""] ?? "document";
const lowerFirst = (x: string) => (/^[A-Z][a-z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x);

/** Hover text of a held figure: why it is held, what the cell prints, its document. */
function heldTitle(payload: IrPayload, c: PayloadCell, e: string, freq: Freq) {
  const doc = c.d != null ? payload.docs[c.d] : undefined;
  return [
    periodLong(c.m === 0 && c.e ? c.e : e, freq, c.m),
    `Held back: ${lowerFirst(c.why ?? "its unit is contradicted by the documents")}.`,
    c.x ? `Printed as “${c.x}”` : null,
    doc ? `In the ${kindName(doc.kind)}${doc.filed ? ` filed ${doc.filed}` : " (no filing date)"}` : null,
    c.alt ? altLine(payload, c.alt) : null,
    "Not used in charts, changes, totals or exports. Click to open the source.",
  ].filter(Boolean).join("\n");
}

function altLine(payload: IrPayload, a: PayloadAlt) {
  const doc = a.d != null ? payload.docs[a.d] : undefined;
  return `${a.kind === "restated" ? "An earlier" : "Another"} ${kindName(doc?.kind)}${doc?.filed ? ` filed ${doc.filed}` : ""} prints ${a.v.toLocaleString("en-US")} (full units)`;
}

/** Quiet marker for a figure held back as suspect: a hollow amber ring. */
function HeldMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full border border-warning align-middle", className)} />;
}

/** Quiet marker for a value another document prints differently: a hollow ring in the caption colour. */
function AltMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full border border-muted-foreground align-middle", className)} />;
}

/** Hover text of a value: its period, how it was printed or calculated, its document and its check. */
function cellTitle(payload: IrPayload, c: PayloadCell, e: string, freq: Freq, unit: string, scale: ReturnType<typeof useUnitScale>[0], chk?: PayloadCheck) {
  const doc = c.d != null ? payload.docs[c.d] : undefined;
  return [
    periodLong(c.m === 0 && c.e ? c.e : e, freq, c.m),
    c.f ? `Calculated: ${c.f.formula}` : c.x ? `Printed as “${c.x}”` : null,
    doc?.filed ? `From the ${doc.kind?.replace("-", " ") ?? "document"} filed ${doc.filed}` : null,
    c.alt ? altLine(payload, c.alt) : null,
    chk ? checkText(chk, unit, scale) : null,
    "Click to open the source",
  ].filter(Boolean).join("\n");
}

function checkText(chk: PayloadCheck, unit: string, scale: ReturnType<typeof useUnitScale>[0]) {
  if (chk.partial) return `Selected lines only: they add to ${fmtIr(chk.sum, unit, scale)} of the printed ${fmtIr(chk.total, unit, scale)} total (${Math.round((chk.sum / chk.total) * 100)}%).`;
  if (chk.ok) return chk.sub?.length ? `${chk.n} parts net to ${fmtIr(chk.sum, unit, scale)} = printed total, with ${chk.sub.join(", ")} subtracted` : `${chk.n} parts sum to ${fmtIr(chk.sum, unit, scale)} = printed total`;
  return `Parts sum to ${fmtIr(chk.sum, unit, scale)} vs printed total ${fmtIr(chk.total, unit, scale)} (difference ${fmtIr(chk.sum - chk.total, unit, scale)})`;
}

/** Quiet marker for a total whose parts don't add up (the numbers are in its tooltip). */
function CheckDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full bg-warning align-middle", className)} />;
}
