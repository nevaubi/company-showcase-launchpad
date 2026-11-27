// One statement section of the IR tab, as one block of the tab's spreadsheet grid: a title band, then the
// printed table's rows at one fixed height each, under the tab's one column head row (in the sticky layer
// of `IrStatements`). Every section has the same label and period column widths, so figures line up from
// the first table to the last, and its height is known from its data (`sectionHeight`, table-style.ts):
// nothing moves while the page scrolls. Rows are laid out as printed (headings, spacers, indented parts,
// totals under a rule), figures in the printed scale, a quiet tick beside totals whose parts add up, and
// every figure opens its source.
import { memo, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AltMark, CheckDot, HeldMark } from "@/components/ir/marks";
import { useScrollGroup } from "@/components/ir/scroll-group";
import { DASH, IR } from "@/components/ir/typography";
import {
  BLANK,
  gridLabelPad,
  levelClass,
  splitMark,
  type SectionBox,
  type TotalKind,
} from "@/components/ir/table-style";
import "@/components/ir/table.css";
import type { VizLine } from "@/components/ir/viz-slots";
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
      /** the unit mark printed after the figures (%, ×, bps), set muted */
      mark: string;
      /** a ratio, percentage, basis-point or per-share line */
      ratio: boolean;
      /** a small label for a restated or older-basis line */
      tag: string | null;
      /** a line only older printings of the table carry, set quieter */
      old?: boolean;
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
  /** the period end the figure is for, where the column key is not one (a year-to-date column "9:2026-09-30") */
  e?: string;
}

/** One reconciliation included in a visible badge, with exactly the printed cell the user saw. */
export interface VisibleStatementCheck {
  section: string;
  label: string;
  series: PayloadSeries;
  cell: PayloadCell;
  check: PayloadCheck;
}

export interface SectionView {
  sec: Statement;
  cols: string[];
  heads: PeriodHead[];
  /** the columns in full for hover titles, where the period kind does not say it (year-to-date columns) */
  titles?: string[];
  /** a year-to-date section under the quarterly switch: its printed columns, or quarters */
  ytd?: "printed" | "quarters";
  /** both ways of showing a year-to-date section have figures, so the section offers the choice */
  ytdChoice?: boolean;
  rows: ShownRow[];
  /** checks of the totals in view: tie out / checked */
  tieOk: number;
  tieN: number;
  visibleChecks: VisibleStatementCheck[];
  failing: number;
  flagged: number;
  held: number;
  /** printed lines hidden by "Current series" */
  hidden: number;
  lines: VizLine[];
  /** what the section is made of, for its height before it paints (`sectionHeight`) */
  box: SectionBox;
}

/** A total whose parts add up: a small drawn tick (no icon element, so long tables stay light). */
function TieMark() {
  return (
    <span className="block h-2 w-1 -translate-y-px rotate-45 border-b-[1.5px] border-r-[1.5px] border-positive/80" />
  );
}

/** Column group of the grid: the label column and the period columns, all from the grid's variables. */
export function GridCols({ n }: { n: number }) {
  return (
    <colgroup>
      <col style={{ width: "var(--irt-fc)" }} />
      {Array.from({ length: n }, (_, i) => (
        <col key={i} style={{ width: "var(--col)" }} />
      ))}
    </colgroup>
  );
}

/** Width of a grid table of `n` period columns: exactly its columns, the same in every section. */
export const gridWidth = (n: number) => `calc(var(--irt-fc) + ${n} * var(--col))`;

/** The column head cells: period over date; the newest column is marked by weight only. */
export function HeadCells({ heads, titles }: { heads: PeriodHead[]; titles: string[] }) {
  return (
    <>
      {heads.map((h, i) => (
        <th
          key={i}
          scope="col"
          title={titles[i]}
          className={cn("irg-hcell", i === heads.length - 1 && "irg-latest")}
        >
          <span className="irg-period num">{h.main}</span>
          <span className="irg-date num">{h.sub || BLANK}</span>
        </th>
      ))}
    </>
  );
}

export const StatementSection = memo(function StatementSection({
  view,
  ticker: _ticker,
  payload: _payload,
  freq,
  scale: _scale,
  exporting,
  onExcel,
  onCsv,
  onChecks,
  openCell,
  onYtd,
}: {
  view: SectionView;
  ticker: string;
  payload: IrPayload;
  freq: IrPeriodKind;
  scale: Scale;
  exporting: boolean;
  onExcel: (sec: Statement) => void;
  onCsv: (sec: Statement, cols: string[]) => void;
  onChecks: (secId: string, checks?: VisibleStatementCheck[]) => void;
  openCell: (s: PayloadSeries, end: string, c: PayloadCell) => void;
  /** switch a year-to-date section between its printed columns and quarters */
  onYtd?: (secId: string, v: "printed" | "quarters") => void;
}) {
  const { sec, cols, heads, rows } = view;
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  const group = useScrollGroup();
  // The figure columns scroll sideways with the tab's head row and every other section.
  useLayoutEffect(() => {
    const b = body.current;
    return b ? group.add(b) : undefined;
  }, [group, cols.length]);
  // A long name is cut to one line; a tap shows it in full.
  const [tip, setTip] = useState<{ el: HTMLElement; text: string } | null>(null);
  const tipRef = useRef<HTMLElement | null>(null);
  tipRef.current = tip?.el ?? null;
  const printedHeads = view.ytd === "printed";
  const titles = cols.map((e, i) => view.titles?.[i] ?? periodLong(e, freq));
  // A year-to-date head's short form already says "to": the range reads between the end dates.
  const ends = printedHeads ? heads.map((h) => h.sub) : heads.map((h) => h.short);
  const span = cols.length
    ? cols.length === 1
      ? heads[0].short
      : `${ends[0]} to ${ends[ends.length - 1]}`
    : "";
  const issues = view.failing + view.flagged + view.held;
  const caption = [
    sec.source ? `From the ${sec.source}` : "",
    sec.unitLine,
    view.ytd === "printed"
      ? "Year-to-date columns as printed"
      : view.ytd === "quarters"
        ? "Quarters, calculated from the year-to-date figures where not printed"
        : "",
    span,
    sec.docs > 1 ? `${sec.docs} documents` : "1 document",
    view.hidden > 0 ? `${view.hidden} older line${view.hidden === 1 ? "" : "s"} hidden` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const n = cols.length;
  const last = n - 1;

  return (
    <section
      ref={undefined}
      aria-labelledby={titleId}
      data-statement={sec.id}
      className="irg-sec min-w-0"
    >
      <header className="irg-title">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="irg-title-text" title={sec.title}>
            {sec.title}
          </h3>
          <p className="irg-caption" title={caption}>
            {caption}
          </p>
        </div>
        <div data-agent-controls className="flex shrink-0 items-center gap-1.5">
          {view.tieN > 0 && (
            <button
              type="button"
              onClick={() => onChecks(sec.id, view.visibleChecks)}
              className={cn(
                "irt-hit inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-[11px] hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden",
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
              className="irt-hit inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-[11px] hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden"
            >
              <CheckDot /> {issues} to review
            </button>
          )}
          {view.ytdChoice && onYtd && view.ytd && (
            <Segmented
              label="Columns"
              size="xs"
              className="irt-hits"
              value={view.ytd}
              onChange={(v) => onYtd(sec.id, v)}
              options={[
                {
                  v: "printed",
                  l: "Year to date",
                  title:
                    "The columns as the documents print them: three, six, nine and twelve months",
                },
                {
                  v: "quarters",
                  l: "Quarters",
                  title:
                    "Each quarter on its own: a quarter no document prints is the year-to-date figure less the one before it, marked as calculated",
                },
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
                    className="irt-hit"
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
      <div
        ref={body}
        onScroll={(e) => group.follow(e.currentTarget)}
        className="irg-scroll no-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        <table aria-labelledby={titleId} className="irg-table" style={{ width: gridWidth(n) }}>
          <GridCols n={n} />
          {/* A year-to-date section prints its own column heads; any other uses the tab's head row. */}
          <thead className={printedHeads ? "irg-head irg-ownhead" : "sr-only"}>
            <tr>
              <th scope="col" className="irg-fc irg-hlabel">
                {printedHeads ? "As printed" : "Line"}
              </th>
              <HeadCells heads={heads} titles={titles} />
            </tr>
          </thead>
          <tbody className="irg-body">
            {rows.map((r) => {
              if (r.kind === "gap")
                return (
                  <tr key={r.id} aria-hidden className="irt-gap">
                    <td colSpan={n + 1} />
                  </tr>
                );
              if (r.kind === "head")
                return (
                  <tr key={r.id} className="irt-group">
                    <th
                      scope="rowgroup"
                      colSpan={n + 1}
                      className="whitespace-nowrap text-left"
                      title={r.text}
                    >
                      <span
                        className="irg-sticky-label"
                        style={{ paddingLeft: gridLabelPad(r.depth) }}
                      >
                        {r.text}
                      </span>
                    </th>
                  </tr>
                );
              const full = r.note ? `${r.label} (${r.note})` : r.label;
              return (
                <tr
                  key={r.id}
                  className={cn(
                    "irt-line",
                    levelClass(r.depth),
                    r.tk !== "none" && `irt-${r.tk}`,
                    r.ratio && "irt-ratio",
                    r.match && "irt-match",
                    r.old && "irt-old",
                  )}
                >
                  <th
                    scope="row"
                    className="irg-fc text-left font-normal"
                    style={{ paddingLeft: gridLabelPad(r.depth) }}
                    title={full}
                    onClick={(e) => setTip({ el: e.currentTarget, text: full })}
                  >
                    <span className="irg-label">
                      {r.label}
                      {r.note && <span className="irg-note">{r.note}</span>}
                      {r.tag && <span className="irt-tag">{r.tag}</span>}
                    </span>
                  </th>
                  {r.cells.map((x, i) => {
                    const e = cols[i];
                    if (!x)
                      return (
                        <td
                          key={e}
                          className={cn("irg-num irt-missing", i === last && "irg-latest")}
                          title={
                            r.blank[i]
                              ? "The table prints nothing here"
                              : "No stored document prints this period"
                          }
                        >
                          <span className="irg-fig">
                            <span>{r.blank[i] ? BLANK : DASH}</span>
                            <span aria-hidden className="irg-paren" />
                            <span aria-hidden className="irg-mark" />
                            <span aria-hidden className="irg-flag" />
                          </span>
                        </td>
                      );
                    const off = x.check && !x.check.ok && !x.check.partial;
                    const tied = x.check?.ok && !x.check.partial;
                    const [fig, mark] = splitMark(x.text, r.mark);
                    const neg = fig.endsWith(")");
                    return (
                      <td key={e} className={cn("irg-num", i === last && "irg-latest")}>
                        <button
                          type="button"
                          onClick={() => openCell(x.s, x.e ?? e, x.c)}
                          title={x.title}
                          className={cn("irg-fig irg-cell", x.held && "text-muted-foreground")}
                        >
                          <span className={cn(x.c.f && IR.derived)}>{fig}</span>
                          {/* A positive figure keeps the room of a closing parenthesis: digits line up on the decimal. */}
                          <span aria-hidden className={cn("irg-paren", neg && "irg-paren-off")} />
                          <span className="irg-mark">{mark}</span>
                          <span aria-hidden data-gutter className="irg-flag">
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
      <Popover open={!!tip} onOpenChange={(o) => !o && setTip(null)}>
        <PopoverAnchor virtualRef={tipRef as React.RefObject<HTMLElement>} />
        <PopoverContent
          align="start"
          side="bottom"
          className="w-auto max-w-80 px-3 py-2 text-[13px] leading-5"
        >
          {tip?.text}
        </PopoverContent>
      </Popover>
    </section>
  );
});
