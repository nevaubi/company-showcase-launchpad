// Report library contracts. Pure types shared by the app, the server generator and scripts.
import type { DerivedPart, SourceRef } from "@/lib/financials/types";

export type ReportKind = "primer" | "preview" | "recap" | "memo";
export type ReportScope = "shared" | "firm" | "user";

/** Where a fact comes from. Every number in a report resolves to one of these. */
export type FactRef =
  | { kind: "sec"; src: SourceRef; label: string }
  | { kind: "derived"; formula: string; parts: DerivedPart[]; label: string }
  | { kind: "filing"; accn: string; doc: string; form: string; filed: string; label: string }
  | { kind: "web"; url: string; label: string; date?: string; quote?: string }
  /** Third-party market data (prices, consensus); the provider is not named in the UI. */
  | { kind: "market"; label: string; asOf: string }
  /** The firm's own coverage record (rating / target set by an analyst). */
  | { kind: "firm"; label: string; asOf: string };

export type FactArea =
  | "profile" | "annual" | "quarterly" | "ttm" | "balance" | "segments" | "valuation"
  | "estimates" | "street" | "reactions" | "promises" | "insiders" | "filings" | "coverage";

export interface Fact {
  id: string;
  area: FactArea;
  text: string;
  ref: FactRef;
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
export interface ReportSection { id: string; title: string; paragraphs: Claim[]; bullets: Claim[]; tables: string[] }

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
}
