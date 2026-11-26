// The two places the IR tab mounts charts: above the statements (`IrTopViz`) and in each statement
// section's chart view (`IrSectionViz`), both drawn by the components in ./viz (unit irviz's contract:
// SummaryStrip, BankPanel or MarginPanel at the top; SectionChart and BridgeChart per section).
// Everything a chart needs comes in through these props.
import { useMemo } from "react";
import { IrPanel } from "@/components/ir/panel";
import type { SourceTarget } from "@/components/source/source-context";
import {
  BankPanel,
  BridgeChart,
  MarginPanel,
  SectionChart,
  SummaryStrip,
  bankFiguresOf,
  defaultBridge,
  marginFiguresOf,
  partsOf,
  segmentMixOf,
  seriesOf,
  summaryTilesOf,
  type VizSeries,
} from "@/components/ir/viz";
import type { IrPayload, PayloadCell, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";
import type { IrPeriodKind } from "@/lib/ir/periods";
import { rowCells, type Statement } from "@/lib/ir/statements";
import type { Scale } from "@/lib/format";

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
export const hasSectionViz = (lines: VizLine[]) =>
  lines.some((l) => l.cells.filter(Boolean).length >= 2);

/** A section's line with the figures of every stored identity it joins (rowCells), as the charts read it. */
function mergedLine(l: VizLine, payload: IrPayload, row?: { ks: string[] }): PayloadSeries {
  if (!row || row.ks.length < 2) return l.s;
  const byKey = new Map(payload.series.map((s) => [s.k, s]));
  const q = rowCells(row.ks, byKey, "q").cells;
  const y = rowCells(row.ks, byKey, "y").cells;
  return { ...l.s, q, y };
}

export function IrSectionViz({
  ticker,
  payload,
  section,
  lines,
  cols,
  freq,
  scale,
  onOpen,
}: IrSectionVizProps) {
  const vizData = useMemo(() => {
    const rowOf = new Map(
      section.rows.flatMap((r) => (r.kind === "line" ? [[r.k, r] as const] : [])),
    );
    const cadence = freq === "y" ? "y" : "q";
    const inView = new Set(cols);
    const series: VizSeries[] = lines
      .map((l) => seriesOf(payload, ticker, mergedLine(l, payload, rowOf.get(l.s.k)), cadence))
      .map((v) => ({ ...v, points: v.points.filter((p) => inView.has(p.period)) }))
      .filter((v) => v.points.length > 0);
    const pp = sectionParts(lines);
    const group: PayloadGroup | null = pp
      ? {
          id: section.id,
          cat: section.cat,
          met: pp.total.s.met,
          unit: pp.total.s.unit,
          label: section.title,
          t: section.title,
          bd: null,
          root: pp.total.s.k,
          rows: [...pp.parts, pp.total].map((l) => ({ k: l.s.k, depth: l.depth })),
        }
      : null;
    const parts = group ? partsOf(payload, ticker, group, cadence) : null;
    const cut = parts
      ? {
          ...parts,
          total: { ...parts.total, points: parts.total.points.filter((p) => inView.has(p.period)) },
          parts: parts.parts.map((x) => ({
            ...x,
            points: x.points.filter((p) => inView.has(p.period)),
          })),
          ties: parts.ties.filter((e) => inView.has(e)),
        }
      : null;
    const lead = pp ? [pp.total.s.k, ...pp.parts.map((x) => x.s.k)] : [];
    // The section's total and its parts first, then its other lines; the chart keeps one unit and six lines.
    const ordered = [
      ...series.filter((v) => lead.includes(v.key)),
      ...series.filter((v) => !lead.includes(v.key)),
    ];
    return { series: ordered, parts: cut, bridge: cut ? defaultBridge(cut) : null };
  }, [payload, ticker, section, lines, cols, freq]);
  if (!vizData.series.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4 px-4 pb-4 pt-1">
      <SectionChart
        series={vizData.series}
        parts={vizData.parts}
        title={section.title}
        scale={scale}
        onOpen={onOpen}
      />
      {vizData.parts && vizData.bridge?.bridge && (
        <BridgeChart
          bridge={vizData.bridge.bridge}
          reason={vizData.bridge.reason}
          scale={scale}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

export interface IrTopVizProps {
  ticker: string;
  payload: IrPayload;
  sections: Statement[];
  scale: Scale;
}

/** The chart strip above the statements: standardized stat tiles and the segment mix, then the bank or margin panel. */
export function IrTopViz({ ticker, payload, scale }: IrTopVizProps) {
  const v = useMemo(() => {
    const tiles = summaryTilesOf(payload, ticker);
    const mix = segmentMixOf(payload, ticker);
    const bank = bankFiguresOf(payload, ticker);
    const margin = bank ? null : marginFiguresOf(payload, ticker);
    return { tiles, mix, bank, margin };
  }, [payload, ticker]);
  if (!v.tiles.length && !v.mix && !v.bank && !v.margin) return null;
  return (
    <IrPanel
      section="IR charts"
      title="At a glance"
      subtitle="The latest printed figures and how they moved. Click a mark to open its source."
    >
      <div className="grid grid-cols-1 gap-6 p-4">
        {(v.tiles.length > 0 || v.mix) && (
          <SummaryStrip tiles={v.tiles} mix={v.mix} scale={scale} />
        )}
        {v.bank ? (
          <BankPanel figures={v.bank} scale={scale} />
        ) : v.margin ? (
          <MarginPanel figures={v.margin} scale={scale} />
        ) : null}
      </div>
    </IrPanel>
  );
}
