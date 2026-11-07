import type { ReactNode } from "react";

export type AskYourDataChart = "bar" | "line" | "table";
export type AskYourDataStatus = "idle" | "writing" | "running" | "done" | "error";

export interface AskYourDataSeries {
  id: string;
  label: string;
  /** One value per category, in category order. */
  values: number[];
  /** Any CSS color. Defaults to --series-1 through --series-4 in order. */
  color?: string;
}

/** What a query returns, shaped for the chart: categories along the x axis and one series per line or bar segment. */
export interface AskYourDataResult {
  title: string;
  /** Quiet line under the title, such as the date range and a total. */
  subtitle?: string;
  /** Header of the first table column, such as "Week". Defaults to "Category". */
  categoryLabel?: string;
  categories: string[];
  series: AskYourDataSeries[];
  /** Series add up: bars stack and the table and tooltip show a total. Set false for rates or averages. Defaults to true. */
  stacked?: boolean;
  /** What the legend shows after each label: the series total (flows such as signups), the latest value (levels such as MRR), or nothing. Defaults to "sum" when stacked, otherwise "none". */
  legendValue?: "sum" | "last" | "none";
  /** The view to open on. Defaults to the chart prop, then "bar". */
  chart?: AskYourDataChart;
  /** Formats values in the axis, tooltip, legend and table. Defaults to en-US grouping. */
  formatValue?: (value: number) => string;
  /** One or two sentences that read the chart, streamed in under it. */
  insight?: string;
  /** Rows the query returned, shown after the dialect. */
  rowCount?: number;
  durationMs?: number;
}

export interface AskYourDataSource {
  /** Database or warehouse name, such as "analytics". */
  name: string;
  /** Shown next to the mark, such as "PostgreSQL". */
  dialect?: string;
  /** A 16px mark. Defaults to the PostgreSQL elephant. */
  mark?: ReactNode;
}

export interface AskYourDataGenerateContext {
  signal: AbortSignal;
  source: AskYourDataSource;
}

export interface AskYourDataRunContext {
  signal: AbortSignal;
  /** Report rows scanned so far, and the expected total when the planner knows it so the count holds its width. */
  onProgress: (rowsScanned: number, totalRows?: number) => void;
  question: string;
}

/** A model's SQL, either whole or streamed as text chunks. */
export type AskYourDataSqlResponse = string | AsyncIterable<string>;
