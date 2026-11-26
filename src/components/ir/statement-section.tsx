// One statement section of the IR tab: a printed table of the company's documents over its whole
// history, laid out as printed (headings, spacer bands, indented parts, totals under a rule), figures in
// the printed scale, a quiet tick beside totals whose parts add up, and every figure opening its source.
// The head row and the first column stay in view: the head is a second table in a sticky strip whose
// horizontal scroll follows the body's, both with the same fixed column widths.
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AltMark, CheckDot, HeldMark } from "@/components/ir/marks";
import { DASH, IR } from "@/components/ir/typography";
import { BLANK, labelStyle, levelClass, splitMark, type TotalKind } from "@/components/ir/table-style";
import "@/components/ir/table.css";
import { IrSectionViz, hasSectionViz, type VizLine } from "@/components/ir/viz-slots";
import type { IrPayload, PayloadCell, PayloadCheck, PayloadSeries } from "@/lib/ir/payload";
import type { IrPeriodKind, PeriodHead } from "@/lib/ir/periods";
import { periodLong } from "@/lib/ir/display";
import type { Statement } from "@/lib/ir/statements";
import type { Scale } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A prepared row: what the table draws, computed once per view by the statements container. */
export type ShownRow =
  | { kind: "gap"; id: string }
  | { kind: "head"; id: string; text: string; depth: number }
  | {
      kind: "line";
      id: string;
      s: PayloadSeries;
      depth: number;
      total: boolean;
      /** subtotal or grand total as set (`totalKinds`) */
      tk: TotalKind;
      /** a faint band on every other line of a block */
      stripe: boolean;
      /** the unit mark printed after the figures (%, ×, bps), set muted */
      mark: string;
      /** a ratio, percentage, basis-point or per-share line */
      ratio: boolean;
      /** a small label for a restated or older-basis line */
      tag: string | null;
      /** per column: the section's own table prints the period but nothing in this row */
      blank: boolean[];
      label: string;
      /** quiet note after the label ("in billions", "at period end") */
      note: string;
      match: boolean;
      cells: (ShownCell | null)[];
    };

export interface ShownCell {
  c: PayloadCell;
  /** the line the figure belongs to (a row can join two stored identities of one printed line) */
  s: PayloadSeries;
  text: string;
  held: boolean;
  check?: PayloadCheck;
  title: string;
}

export interface SectionView {
  sec: Statement;
  cols: string[];
  heads: PeriodHead[];
  rows: ShownRow[];
  /** checks of the totals in view: tie out / checked */
  tieOk: number;
  tieN: number;
  failing: number;
  flagged: number;
  held: number;
  /** printed lines hidden by "Current series" */
  hidden: number;
  lines: VizLine[];
}

const FIRST = "[--fc:10.5rem] sm:[--fc:17rem] lg:[--fc:20rem]";
const COL = "5.75rem";
/** The cell's figure, then a fixed gutter for its mark: the figure stays right-aligned beside the gutter. */
const CELL_LAYOUT = "flex items-center justify-end pl-2 pr-1";
const GUTTER = "ml-1 inline-flex w-3 shrink-0 items-center justify-center";
/** Column width for a section whose longest figure has `chars` characters (figure, gutter and padding). */
export const colWidth = (chars: number) => `max(${COL}, calc(${Math.max(chars, 1)}ch + 1.75rem))`;

/** A total whose parts add up: a small drawn tick (no icon element, so long tables stay light). */
function TieMark() {
  return (
    <span className="block h-2 w-1 -translate-y-px rotate-45 border-b-[1.5px] border-r-[1.5px] border-positive/80" />
  );
}

export const StatementSection = memo(function StatementSection({
  view,
  ticker,
  payload,
  freq,
  scale,
  exporting,
  onExcel,
  onCsv,
  onChecks,
  openCell,
}: {
  view: SectionView;
  ticker: string;
  payload: IrPayload;
  freq: IrPeriodKind;
  scale: Scale;
  exporting: boolean;
  onExcel: (sec: Statement) => void;
  onCsv: (sec: Statement, cols: string[]) => void;
  onChecks: (secId: string) => void;
  openCell: (s: PayloadSeries, end: string, c: PayloadCell) => void;
}) {
  const { sec, cols, heads, rows } = view;
  const [mode, setMode] = useState<"table" | "chart">("table");
  const titleId = useId();
  const head = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const chartable = hasSectionViz(view.lines);
  // The head strip follows the body's sideways scroll; long histories open at the newest columns.
  const root = useRef<HTMLElement>(null);
  const sync = useCallback(() => {
    const b = body.current;
    if (!b) return;
    if (head.current) head.current.scrollLeft = b.scrollLeft;
    // The first column casts a soft edge while columns are hidden under it.
    root.current?.toggleAttribute("data-scrolled", b.scrollLeft > 1);
  }, []);
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    b.scrollLeft = b.scrollWidth;
    sync();
  }, [cols.length, mode, sync]);
  // Columns fit the section's longest figure, with the mark gutter beside it, so nothing overlaps at any width.
  const widest = useMemo(
    () =>
      rows.reduce(
        (m, r) =>
          r.kind === "line" ? r.cells.reduce((n, x) => Math.max(n, x?.text.length ?? 0), m) : m,
        0,
      ),
    [rows],
  );
  const col = colWidth(widest);
  const minWidth = `calc(var(--fc) + ${cols.length} * var(--col))`;
  // A short history keeps its figures near their labels, as a printed page does: the label column grows by
  // at most 12rem past its set width, and the table leaves the rest of the row empty.
  const width = `min(100%, calc(var(--fc) + 12rem + ${cols.length} * var(--col)))`;
  const colgroup = (
    <colgroup>
      <col style={{ width: "var(--fc)" }} />
      {cols.map((e) => (
        <col key={e} style={{ width: "var(--col)" }} />
      ))}
    </colgroup>
  );
  const span = cols.length
    ? cols.length === 1
      ? heads[0].short
      : `${heads[0].short} to ${heads[heads.length - 1].short}`
    : "";
  const issues = view.failing + view.flagged + view.held;

  return (
    <section
      ref={root}
      aria-labelledby={titleId}
      data-statement={sec.id}
      className={cn("irt-root min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+var(--ir-bar,0px)+0.5rem)] pt-4", FIRST)}
      style={{ "--col": col } as CSSProperties}
    >
      <header className="irt-sec-head flex flex-col gap-x-3 gap-y-1.5 px-4 py-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className={IR.group}>
            {sec.title}
          </h3>
          <p className={IR.caption}>
            {[
              sec.source ? `From the ${sec.source}` : "",
              sec.unitLine,
              span,
              sec.docs > 1 ? `${sec.docs} documents` : "1 document",
            ]
              .filter(Boolean)
              .join(" · ")}
            {view.hidden > 0 &&
              ` · ${view.hidden} older line${view.hidden === 1 ? "" : "s"} hidden`}
          </p>
        </div>
        <div data-agent-controls className="flex flex-wrap items-center gap-1.5">
          {view.tieN > 0 && (
            <button
              type="button"
              onClick={() => onChecks(sec.id)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view.tieOk === view.tieN ? "text-muted-foreground" : "text-foreground",
              )}
              title="Periods in view whose parts add up to the printed total. Open the checks for this section."
            >
              {view.tieOk === view.tieN ? (
                <Check aria-hidden className="size-3 text-positive" />
              ) : (
                <CheckDot />
              )}
              <span className="num">
                {view.tieOk} of {view.tieN}
              </span>
              tie out
            </button>
          )}
          {issues > 0 && view.tieN === 0 && (
            <button
              type="button"
              onClick={() => onChecks(sec.id)}
              className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CheckDot /> {issues} to review
            </button>
          )}
          {chartable && (
            <Segmented
              label="View"
              size="xs"
              value={mode}
              onChange={setMode}
              options={[
                { v: "table", l: "Table" },
                { v: "chart", l: "Chart" },
              ]}
            />
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Download ${sec.title}`}
                    aria-busy={exporting}
                  >
                    {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Download this section</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem
                onSelect={() => onExcel(sec)}
                disabled={exporting}
                className="items-start gap-2.5 py-2"
              >
                <FileSpreadsheet className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Excel workbook</span>
                  <span className="block text-xs text-muted-foreground">
                    Styled, with formulas, checks and sources
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onCsv(sec, cols)}
                className="items-start gap-2.5 py-2"
              >
                <FileText className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">CSV</span>
                  <span className="block text-xs text-muted-foreground">
                    Plain values in full units
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {mode === "chart" && chartable ? (
        <IrSectionViz
          ticker={ticker}
          payload={payload}
          section={sec}
          lines={view.lines}
          cols={cols}
          heads={heads.map((h) => h.short)}
          freq={freq}
          scale={scale}
          openCell={openCell}
        />
      ) : (
        <div className="relative">
          <div
            ref={head}
            aria-hidden
            data-head-strip
            className="irt-colhead sticky top-[calc(var(--sticky-top,3.5rem)+var(--ir-bar,0px))] z-20 overflow-hidden"
          >
            <table
              className={cn("table-fixed border-separate border-spacing-0", IR.row)}
              style={{ minWidth, width }}
            >
              {colgroup}
              <thead>
                <tr>
                  <th className="irt-fc sticky left-0 z-10 py-1 pl-4 pr-3 text-left align-bottom font-normal" />
                  {heads.map((h, i) => (
                    <th
                      key={cols[i]}
                      className={cn(
                        "whitespace-nowrap py-1 pl-2 pr-5 text-right align-bottom font-normal",
                        i === heads.length - 1 && "irt-latest",
                      )}
                      title={periodLong(cols[i], freq)}
                    >
                      <span className="irt-period num block text-[11px]">{h.main}</span>
                      {h.sub && <span className="irt-date num block text-[11px]">{h.sub}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          <div
            ref={body}
            onScroll={sync}
            className="relative overflow-x-auto overscroll-x-contain scrollbar-thin"
          >
            <table
              aria-labelledby={titleId}
              className={cn("table-fixed border-separate border-spacing-0", IR.row)}
              style={{ minWidth, width }}
            >
              {colgroup}
              <thead className="sr-only">
                <tr>
                  <th scope="col">Line</th>
                  {heads.map((h, i) => (
                    <th key={cols[i]} scope="col">
                      {h.main} {h.sub}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="irt-body">
                {rows.map((r) => {
                  if (r.kind === "gap")
                    return (
                      <tr key={r.id} aria-hidden className="irt-gap">
                        <td colSpan={cols.length + 1} className="h-1.5 p-0" />
                      </tr>
                    );
                  if (r.kind === "head")
                    return (
                      <tr key={r.id} className="irt-group">
                        <th
                          scope="rowgroup"
                          colSpan={cols.length + 1}
                          className="whitespace-nowrap py-0.5 pr-3 text-left leading-5"
                          style={labelStyle(r.depth)}
                        >
                          <span className="sticky left-4">{r.text}</span>
                        </th>
                      </tr>
                    );
                  const last = cols.length - 1;
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        "irt-line",
                        levelClass(r.depth),
                        r.stripe && "irt-stripe",
                        r.tk !== "none" && `irt-${r.tk}`,
                        r.ratio && "irt-ratio",
                        r.match && "irt-match",
                      )}
                    >
                      <th
                        scope="row"
                        className="irt-fc sticky left-0 z-[1] truncate py-0.5 pr-3 text-left font-normal"
                        style={labelStyle(r.depth)}
                        title={r.note ? `${r.label} (${r.note})` : r.label}
                      >
                        {r.label}
                        {r.note && (
                          <span className={cn("ml-1 font-normal", IR.caption)}>{r.note}</span>
                        )}
                        {r.tag && <span className="irt-tag">{r.tag}</span>}
                      </th>
                      {r.cells.map((x, i) => {
                        const e = cols[i];
                        if (!x)
                          return (
                            <td
                              key={e}
                              className={cn(
                                "py-0.5 pl-2 pr-5",
                                IR.num,
                                "irt-missing",
                                i === last && "irt-latest",
                              )}
                              title={r.blank[i] ? "The table prints nothing here" : "No stored document prints this period"}
                            >
                              {r.blank[i] ? BLANK : DASH}
                            </td>
                          );
                        const off = x.check && !x.check.ok && !x.check.partial;
                        const tied = x.check?.ok && !x.check.partial;
                        const [fig, mark] = splitMark(x.text, r.mark);
                        return (
                          <td key={e} className={cn("p-0", i === last && "irt-latest")}>
                            <button
                              type="button"
                              onClick={() => openCell(x.s, e, x.c)}
                              title={x.title}
                              className={cn(
                                IR.cellButton,
                                "py-0.5",
                                IR.num,
                                CELL_LAYOUT,
                                x.held && "text-muted-foreground",
                              )}
                            >
                              <span className={cn(x.c.f && IR.derived)}>
                                {fig}
                                {mark && <span className="irt-mark">{mark}</span>}
                              </span>
                              <span aria-hidden data-gutter className={GUTTER}>
                                {x.held ? (
                                  <HeldMark />
                                ) : off || x.c.flags?.length ? (
                                  <CheckDot />
                                ) : x.c.alt ? (
                                  <AltMark />
                                ) : tied ? (
                                  <TieMark />
                                ) : null}
                              </span>
                              {(off || x.held || x.c.flags?.length) && (
                                <span className="sr-only"> (see the checks)</span>
                              )}
                              {tied && <span className="sr-only"> (parts add up)</span>}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
});
