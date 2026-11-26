// The two places the IR tab mounts charts: above the statements (`IrTopViz`) and in each statement
// section's chart view (`IrSectionViz`). Unit irviz builds the chart components in ./viz; until they are
// merged the section view draws the section's parts with the app's combo chart, and the top slot draws
// nothing. Everything a chart needs comes in through these props, so swapping the body touches no caller.
import { ComboChart, type ComboSeries } from "@/components/charts/combo-chart";
import type { SourceTarget } from "@/components/source/source-context";
import { fmtIr, shownLabel } from "@/lib/ir/display";
import type { IrPayload, PayloadCell, PayloadSeries } from "@/lib/ir/payload";
import type { IrPeriodKind } from "@/lib/ir/periods";
import type { Statement } from "@/lib/ir/statements";
import type { Scale } from "@/lib/format";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)", "var(--muted-foreground)", "var(--link)"];

/** One line of a section as the chart sees it: its figures in the shown columns, oldest first. */
export interface VizLine {
  s: PayloadSeries;
  depth: number;
  total: boolean;
  /** figure per shown column (null: not printed) */
  cells: (PayloadCell | null)[];
}

export interface IrSectionVizProps {
  ticker: string;
  payload: IrPayload;
  section: Statement;
  lines: VizLine[];
  cols: string[];
  /** column heads as shown in the table ("3Q26") */
  heads: string[];
  freq: IrPeriodKind;
  scale: Scale;
  /** opens a figure's source, as a click on the table cell does */
  openCell: (s: PayloadSeries, end: string, c: PayloadCell) => void;
  onOpen?: (t: SourceTarget) => void;
}

/** The parts of the first total of a section that has at least two parts in it, money or counts only. */
export function sectionParts(lines: VizLine[]): { total: VizLine; parts: VizLine[] } | null {
  for (const t of lines) {
    if (!t.total || (t.s.unit !== "usd" && t.s.unit !== "count")) continue;
    const parts = lines.filter((l) => l.s.parent === t.s.k);
    if (parts.length >= 2) return { total: t, parts };
  }
  return null;
}

/** Whether a section has something to chart (its chart toggle is shown only then). */
export const hasSectionViz = (lines: VizLine[]) => !!sectionParts(lines);

export function IrSectionViz({ lines, cols, heads, scale, openCell }: IrSectionVizProps) {
  const pp = sectionParts(lines);
  if (!pp) return null;
  const div = pp.total.s.unit === "usd" ? { full: 1, K: 1e3, M: 1e6, B: 1e9 }[scale] : 1;
  const negative = pp.parts.some((p) => p.cells.some((c) => c && c.v < 0));
  const series: ComboSeries[] = [
    ...pp.parts.slice(0, 8).map((p, i) => ({
      id: p.s.k,
      label: shownLabel(p.s.label),
      color: PALETTE[i % PALETTE.length],
      type: (negative ? "line" : "bar") as "line" | "bar",
      values: p.cells.map((c) => (c ? c.v / div : null)),
      format: (v: number) => fmtIr(v * div, p.s.unit, scale),
      onSelect: (i2: number) => {
        const c = p.cells[i2];
        if (c) openCell(p.s, cols[i2], c);
      },
    })),
    {
      id: pp.total.s.k,
      label: shownLabel(pp.total.s.label),
      color: "var(--foreground)",
      type: "line" as const,
      values: pp.total.cells.map((c) => (c ? c.v / div : null)),
      format: (v: number) => fmtIr(v * div, pp.total.s.unit, scale),
      dashed: true,
      onSelect: (i2: number) => {
        const c = pp.total.cells[i2];
        if (c) openCell(pp.total.s, cols[i2], c);
      },
    },
  ];
  return (
    <div className="px-3 pb-3 pt-1">
      <ComboChart categories={heads} series={series} stacked={!negative} height={240} leftFormat={(v) => fmtCompact(v, 1)} />
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span className={cn("inline-block size-2 rounded-sm", s.type === "line" && "h-0.5 w-3 rounded-none")} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface IrTopVizProps {
  ticker: string;
  payload: IrPayload;
  sections: Statement[];
  scale: Scale;
}

/** The chart strip above the statements: filled by the irviz components when they are merged. */
export function IrTopViz(_props: IrTopVizProps) {
  return null;
}
