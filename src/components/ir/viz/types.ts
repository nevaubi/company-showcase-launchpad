// The contract of the IR data tab's chart components (src/components/ir/viz). Every chart draws only from these
// shapes; `from-payload.ts` builds them from an IR payload and `model.ts` holds the arithmetic, both pure and tested
// apart from rendering. Figures are as filed: a value is in the line's own unit (dollars, percent points, basis points,
// a count), never rescaled here; the reader's $K/$M/$B choice is applied only when a figure is written.
import type { SourceTarget } from "@/components/source/source-context";
import type { Scale } from "@/lib/format";

/** The payload's unit codes: "usd", "usdPerShare", "pct", "bps", "ratio", "count", "other" (as printed, see `printedUnit`). */
export type VizUnit = "usd" | "usdPerShare" | "pct" | "bps" | "ratio" | "count" | "other";

/** Quarterly, fiscal-year or monthly columns. Quarters and months draw as a line, years as columns. */
export type VizCadence = "q" | "y" | "m";

/** One figure of one line in one period. */
export interface VizPoint {
  /** ISO period end, "2025-09-30" */
  period: string;
  /** The period named in full: "Quarter ended September 30, 2025", "Fiscal year ended ...", "As of ..." */
  periodLabel: string;
  /** The period on an axis: "Sep ’25", "FY25" */
  short: string;
  /** The figure as filed, in the line's unit */
  value: number;
  /** The text of the source cell as printed ("$ 52,648", "13.2 %") */
  printed?: string;
  /** What a click on the mark opens: the stored document at the printed cell, or the formula of a derived figure */
  source?: SourceTarget;
  /** A caveat the store states at this figure (a failed check, a restatement), shown in the tooltip */
  note?: string;
}

/** One line over time, named as the company names it. */
export interface VizSeries {
  key: string;
  label: string;
  unit: VizUnit;
  /** For unit "other": the unit word the printed cells carry ("days", "×"); empty when they show none */
  printedUnit?: string;
  cadence: VizCadence;
  /** Ascending by period; a period the company did not print is absent, never zero */
  points: VizPoint[];
}

/** A section whose children add up to its total. */
export interface VizParts {
  key: string;
  /** The section's title as printed ("Net revenue by segment") */
  label: string;
  unit: VizUnit;
  cadence: VizCadence;
  total: VizSeries;
  /** In the company's order; at most eight are drawn (the rest fold into "Other lines" only when they tie) */
  parts: VizSeries[];
  /** Keys of parts the company prints as positives that are subtracted to reach the total */
  subtracted: string[];
  /** Periods in which the parts (signed) add up to the total within rounding; only these are stacked or bridged */
  ties: string[];
}

/** One step of a bridge: a part's change from one period to the next. */
export interface VizBridgeStep {
  key: string;
  label: string;
  from: VizPoint;
  to: VizPoint;
  /** Signed contribution to the total's change (a subtracted line contributes minus its change) */
  delta: number;
}

/** A waterfall from one period's total to another's across the section's parts. */
export interface VizBridge {
  key: string;
  label: string;
  unit: VizUnit;
  /** The total's figure in each period */
  from: VizPoint;
  to: VizPoint;
  steps: VizBridgeStep[];
  /** How the bridge reads: "Year over year" when the two periods are a year apart, else "Quarter over quarter" */
  span: "yoy" | "qoq" | "other";
}

/** A change between two figures: percent for amounts and counts, points for percentages and basis points. */
export interface VizChange {
  kind: "pct" | "pts" | "bps";
  value: number;
  /** The figure compared with */
  base: VizPoint;
}

/** A stat tile's figures, computed by `statOf`. */
export interface VizStat {
  series: VizSeries;
  latest: VizPoint;
  yoy: VizChange | null;
  qoq: VizChange | null;
  /** Up to 12 periods ending at `latest`, gaps kept as null */
  spark: (VizPoint | null)[];
  /** Costs and credit losses improve when they fall: the change is toned the other way */
  inverted: boolean;
}

/** The bank figures of a company's own releases, each a printed line (see `bankFiguresOf`). */
export interface VizBankFigures {
  /** Net interest income */
  nii: VizSeries | null;
  /** Net interest margin as printed (percent) */
  nim: VizSeries | null;
  /** Noninterest revenue (fees) by printed line, stacked only where it ties */
  noninterest: VizParts | null;
  /** Lines when the fees section does not tie to a printed total: drawn as lines, not stacked */
  noninterestLines: VizSeries[];
  /** The efficiency or overhead ratio as the company prints it; never computed */
  efficiency: VizSeries | null;
  /** Provision for credit losses, net charge-offs, allowance for loan losses */
  credit: VizSeries[];
  /** CET1 and the other printed capital ratios */
  capital: VizSeries[];
  /** Deposits and loans (balances) */
  balances: VizSeries[];
}

/** Margins and expense mix of a non-bank (see `marginFiguresOf`). */
export interface VizMarginFigures {
  /** Margin lines the company prints as percentages (gross margin, operating margin) */
  margins: VizSeries[];
  /** An expense section whose parts tie to its printed total */
  expenses: VizParts | null;
}

/** Props shared by every chart. */
export interface VizCommonProps {
  /** The reader's $K/$M/$B choice (useUnitScale); dollars are written in it, with the as-filed figure in the tooltip */
  scale: Scale;
  /** Opens a mark's source; defaults to the app's source viewer (useSource().open) */
  onOpen?: (t: SourceTarget) => void;
  className?: string;
}

/** 1. The chart above a statement table: selected lines over time, or the section's parts stacked. */
export interface SectionChartProps extends VizCommonProps {
  /** Lines to draw, the first six in the given order (more are left out and the caption says how many) */
  series: VizSeries[];
  /** The section's parts and total: enables the stacked and 100 percent views where they tie */
  parts?: VizParts | null;
  /** The section's title, used to name the chart for assistive technology */
  title: string;
  /** Initial view; "stacked" and "share" fall back to "lines" when the parts do not tie */
  view?: "lines" | "stacked" | "share";
  /** Height of the plot area, px (default 200) */
  height?: number;
}

/** 2. The strip at the top of the tab: stat tiles and a segment mix. */
export interface SummaryStripProps extends VizCommonProps {
  /** The standardized KPI lines, in the order to show (at most eight tiles) */
  tiles: VizSeries[];
  /** Revenue or net revenue by segment over time */
  mix?: VizParts | null;
}

/** 3. The bridge between two periods across a section's parts. */
export interface BridgeChartProps extends VizCommonProps {
  /** null when the parts do not tie in both periods: the chart then shows `reason` as a one-line note */
  bridge: VizBridge | null;
  reason?: string;
}

/** 4. The bank panel: shown only when `figures` holds at least one line. */
export interface BankPanelProps extends VizCommonProps {
  figures: VizBankFigures | null;
}

/** 5. Margins and expense mix of a non-bank. */
export interface MarginPanelProps extends VizCommonProps {
  figures: VizMarginFigures | null;
}
