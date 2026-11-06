// Report library contracts. Pure types shared by the app, the server generator and scripts.
import type { DerivedPart, SourceRef } from "@/lib/financials/types";

export type ReportKind = "primer" | "preview" | "recap" | "memo";
export type ReportScope = "shared" | "firm" | "user";

/** Where a fact comes from. Every number in a report resolves to one of these. */
export type FactRef =
  /** `tk`: the company whose filing this is, when it isn't the report's company (peer facts). */
  | { kind: "sec"; src: SourceRef; label: string; tk?: string }
  | { kind: "derived"; formula: string; parts: DerivedPart[]; label: string; /** Non-SEC inputs (share price), shown with their date */ market?: { label: string; value: number; asOf: string }[]; tk?: string }
  | { kind: "filing"; accn: string; doc: string; form: string; filed: string; label: string; tk?: string }
  /** A figure built from other facts (peer median, regression, consensus vs history): each member fact carries its own source. */
  | { kind: "composite"; label: string; formula: string; members: string[] }
  | { kind: "web"; url: string; label: string; date?: string; quote?: string }
  /** Third-party market data (prices, consensus); the provider is not named in the UI. */
  | { kind: "market"; label: string; asOf: string }
  /** The firm's own coverage record (rating / target set by an analyst). */
  | { kind: "firm"; label: string; asOf: string };

export type FactArea =
  | "profile" | "annual" | "quarterly" | "ttm" | "balance" | "segments" | "valuation"
  | "estimates" | "street" | "reactions" | "promises" | "insiders" | "filings" | "coverage"
  | "peers" | "analysis" | "history" | "performance";

export interface Fact {
  id: string;
  area: FactArea;
  text: string;
  ref: FactRef;
  /** Plotted only (e.g. each segment-year in a chart); not offered to the writer. */
  chart?: boolean;
}

export interface TableCell { text: string; ref?: FactRef; tone?: "positive" | "negative" }
export interface ReportTable {
  id: string;
  title: string;
  columns: string[];
  rows: { label: string; cells: (TableCell | null)[]; bold?: boolean }[];
  note?: string;
}

export interface Claim { text: string; factIds: string[] }
export interface ReportSection { id: string; title: string; paragraphs: Claim[]; bullets: Claim[]; tables: string[]; charts?: string[] }

// ---------- charts (every plotted value points at a fact, so clicking it opens the source) ----------
/** pct = fraction (0.12 = 12%); pp = percentage-point change as a fraction (0.012 = +1.2 pp). */
export type ChartUnit = "usd" | "pct" | "pp" | "mult" | "usdPerShare" | "index" | "count";
/** v = value; f = fact id behind it */
export interface ChartPoint { v: number | null; f?: string }
export interface ChartSeries {
  name: string;
  kind: "bar" | "line" | "dash";
  axis?: "left" | "right";
  unit: ChartUnit;
  points: ChartPoint[];
  /** self = the report company (brand colour), bench = index, peer = muted, signed = green/red by sign; pos/neg/neutral = fixed semantic colours */
  tone?: "self" | "bench" | "peer" | "signed" | "pos" | "neg" | "neutral";
  opacity?: number;
}
interface ChartBase { id: string; title: string; subtitle?: string; note?: string; size?: "full" | "half" }
export type ReportChart =
  | (ChartBase & { type: "combo"; x: string[]; series: ChartSeries[] })
  | (ChartBase & { type: "stacked"; x: string[]; series: ChartSeries[]; percent?: boolean })
  | (ChartBase & {
      type: "peers";
      metrics: { key: string; label: string; unit: ChartUnit; better: "high" | "low"; median: number | null; medianF?: string }[];
      rows: { ticker: string; name: string; self: boolean; cells: ChartPoint[] }[];
    })
  | (ChartBase & {
      type: "scatter"; xLabel: string; yLabel: string; xUnit: ChartUnit; yUnit: ChartUnit;
      points: { ticker: string; self: boolean; x: number; y: number; fx?: string; fy?: string }[];
      fit?: { a: number; b: number; r2: number; f?: string };
    })
  /** lo/hi: the shaded band (interquartile range). */
  | (ChartBase & { type: "band"; unit: ChartUnit; dates: string[]; values: (number | null)[]; median: number; lo: number; hi: number; f?: string })
  | (ChartBase & {
      type: "range"; unit: ChartUnit;
      rows: { label: string; low: number; high: number; f?: string; marks: { label: string; v: number; f?: string }[] }[];
      current?: { label: string; v: number; f?: string };
    })
  | (ChartBase & { type: "hbar"; unit: ChartUnit; rows: { label: string; v: number; f?: string; self?: boolean }[]; signed?: boolean });

/** Headline tiles under the cover. */
export interface GlanceItem { label: string; value: string; sub?: string; f?: string; tone?: "positive" | "negative" }

export interface ReportOptions {
  length: "brief" | "standard" | "deep";
  audience: "internal" | "pm" | "ic" | "client";
  stance: "balanced" | "constructive" | "skeptical";
  /** Section ids in display order; empty = the kind's defaults. */
  sections: string[];
  /** Free-text emphasis, e.g. "focus on data-center capex durability". */
  focus: string;
}

export interface ReportQa {
  claims: number;
  citedClaims: number;
  numbers: number;
  verifiedNumbers: number;
  /** Sentences removed because a number didn't match any source. */
  removed: { text: string; reason: string }[];
}

export interface ReportContent {
  version: 1;
  ticker: string;
  name: string;
  kind: ReportKind;
  title: string;
  subtitle: string;
  asOf: string;
  priceAsOf: string | null;
  dataVersion: string;
  generatedAt: string;
  model: string;
  options: ReportOptions;
  facts: Fact[];
  tables: ReportTable[];
  /** Charts referenced by sections (absent on reports written before charts existed). */
  charts?: ReportChart[];
  glance?: GlanceItem[];
  /** Peer set used for comparisons. */
  peers?: { ticker: string; name: string }[];
  sections: ReportSection[];
  qa: ReportQa;
}

/** Everything the fact builder needs; each part is optional so partial data still yields a report. */
export interface ReportInputs {
  today: string;
  data: import("@/lib/financials/types").CompanyDataset;
  price: { price: number; asOf: string } | null;
  estimates: import("@/lib/estimates/core").Estimates | null;
  promises: import("@/lib/earnings/promises").TrackedPromise[] | null;
  reactions: { reactions: import("@/lib/markets/core").Reaction[]; stats: import("@/lib/markets/core").ReactionStats | null } | null;
  coverage: { firm: string; rating: string; target: number | null; analyst: string | null; updatedAt: string } | null;
  /** Comparable companies, each reduced to sourced metrics (see peers.ts). */
  peers?: import("./peers").PeerSnapshot[];
  /** Daily bars [date, o, h, l, c, adjClose, volume] for the company and the S&P 500 ETF. */
  prices?: { self: import("@/lib/financials/types").Bar[] | null; spy: import("@/lib/financials/types").Bar[] | null };
}
