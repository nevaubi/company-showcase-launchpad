import { quarterColumnNames, sourceRows, type QuarterKey, type SourceRow } from "./provenance-source";

/** Columns of the generated workbook. A holds labels, B-F the quarters, G the change vs a year ago. */
export const quarterCols: { col: string; q: QuarterKey }[] = [
  { col: "B", q: "3Q25" },
  { col: "C", q: "4Q25" },
  { col: "D", q: "1Q26" },
  { col: "E", q: "2Q26" },
  { col: "F", q: "3Q26" },
];
export const columns = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type Col = (typeof columns)[number];

export const SOURCE_DOC = {
  title: "Supplemental Information, Third Quarter 2026",
  file: "BAC_3Q26_Supplemental_Information.pdf",
  company: "Bank of America Corporation",
  ticker: "BAC",
  form: "8-K",
  exhibit: "Exhibit 99.3",
  accession: "0000070858-26-000481",
  filed: "2026-10-14",
  pageCount: 32,
  pageBase: "sources/bac-3q26/page-",
};

export type Unit = "usd_m" | "per_share" | "pct";

export type RowDef =
  | { kind: "title"; text: string; sub: string }
  | { kind: "header" }
  | { kind: "section"; text: string }
  | { kind: "blank" }
  | { kind: "source"; label: string; source: string; unit: Unit; bold?: boolean; change: "yoy" | "pts" }
  | { kind: "calc"; label: string; unit: Unit; num: number; den: number; change: "pts"; tiesTo: number }
  | { kind: "check"; label: string; a: number; b: number };

/** Sheet rows, 1-indexed in the order Excel would number them. Calc rows refer to other rows by number. */
export const sheetRows: RowDef[] = [
  { kind: "title", text: "Bank of America Corporation", sub: "$ in millions, except per share data · source: 3Q26 Supplemental Information" },
  { kind: "header" },
  { kind: "section", text: "Income statement" },
  { kind: "source", label: "Net interest income", source: "nii", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Fees and commissions", source: "fees", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Market making and similar", source: "mm", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Total noninterest income", source: "nonii", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Total revenue, net of int. exp.", source: "rev", unit: "usd_m", bold: true, change: "yoy" },
  { kind: "source", label: "Provision for credit losses", source: "prov", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Total noninterest expense", source: "exp", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Net income", source: "ni", unit: "usd_m", bold: true, change: "yoy" },
  { kind: "source", label: "Diluted EPS", source: "eps", unit: "per_share", change: "yoy" },
  { kind: "blank" },
  { kind: "section", text: "Ratios" },
  { kind: "calc", label: "Efficiency ratio (calc.)", unit: "pct", num: 10, den: 8, change: "pts", tiesTo: 16 },
  { kind: "source", label: "Efficiency ratio (reported)", source: "eff_rep", unit: "pct", change: "pts" },
  { kind: "check", label: "Check: calc = reported", a: 15, b: 16 },
  { kind: "source", label: "Return on avg. tangible common equity", source: "rotce", unit: "pct", change: "pts" },
  { kind: "blank" },
  { kind: "section", text: "Consumer Banking" },
  { kind: "source", label: "Net interest income", source: "cb_nii", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Card income", source: "cb_card", unit: "usd_m", change: "yoy" },
  { kind: "source", label: "Net income", source: "cb_ni", unit: "usd_m", bold: true, change: "yoy" },
  { kind: "blank" },
  { kind: "section", text: "Credit" },
  { kind: "source", label: "Credit card net charge-off ratio", source: "card_nco", unit: "pct", change: "pts" },
  { kind: "source", label: "Total net charge-off ratio", source: "tot_nco", unit: "pct", change: "pts" },
];

export const rowAt = (r: number) => sheetRows[r - 1];

/** Inputs are rounded to $ millions, so a ratio recomputed from them can differ from the filer's figure by 0.01 pt. */
export const ROUNDING_TOLERANCE = 0.01 + 1e-9;

/** Round half up at 2 decimals with a small epsilon so 61.215 shows as 61.22, the way the filer prints it. */
export const round2 = (x: number) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7)) / 100;

export function parseFiled(text: string) {
  return Number(text.replace(/[$,%]/g, ""));
}

export function sourceValue(row: SourceRow, q: QuarterKey) {
  const cell = row.cells.find((c) => c.q === q)!;
  return { cell, value: parseFiled(cell.text) };
}

export function rowValue(r: number, q: QuarterKey): number {
  const def = rowAt(r);
  if (def.kind === "source") return sourceValue(sourceRows[def.source], q).value;
  if (def.kind === "calc") return round2((rowValue(def.num, q) / rowValue(def.den, q)) * 100);
  if (def.kind === "check") return rowValue(def.a, q) - rowValue(def.b, q);
  return NaN;
}

export function formatValue(v: number, unit: Unit) {
  if (unit === "usd_m") return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (unit === "per_share") return v.toFixed(2);
  return `${v.toFixed(2)}%`;
}

export function formatChange(r: number) {
  const def = rowAt(r);
  if (def.kind !== "source" && def.kind !== "calc") return "";
  const now = rowValue(r, "3Q26");
  const ago = rowValue(r, "3Q25");
  if (def.change === "pts") {
    const d = round2(now - ago);
    return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(2)} pts`;
  }
  const pct = (now / ago - 1) * 100;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%`;
}

export type CellRef = { r: number; c: Col };
export const addr = (ref: CellRef) => `${ref.c}${ref.r}`;
export const quarterOf = (c: Col) => quarterCols.find((x) => x.col === c)?.q;

/** Where the PDF should go for a cell: the source line for inputs, the reported figure for derived values. */
export interface CellTarget {
  row: SourceRow;
  q: QuarterKey;
}

export interface CellInfo {
  ref: CellRef;
  kind: "source" | "calc" | "check" | "change" | "label" | "none";
  display: string;
  formula: string;
  target: CellTarget | null;
  precedents: CellRef[];
  label: string;
  unit?: Unit;
}

export function cellInfo(ref: CellRef): CellInfo {
  const def = rowAt(ref.r);
  const base: CellInfo = { ref, kind: "none", display: "", formula: "", target: null, precedents: [], label: "" };
  if (!def) return base;
  if (ref.c === "A") {
    const text = def.kind === "title" ? def.text : def.kind === "section" ? def.text : "label" in def ? def.label : def.kind === "header" ? "Line item" : "";
    return { ...base, kind: "label", display: text, formula: text, label: text };
  }
  if (def.kind === "header") {
    const q = quarterOf(ref.c);
    const text = q ?? (ref.c === "G" ? "Y/Y" : "");
    return { ...base, kind: "label", display: text, formula: text, label: text };
  }
  if (def.kind === "source" || def.kind === "calc" || def.kind === "check") {
    const q = quarterOf(ref.c);
    if (ref.c === "G") {
      if (def.kind === "check") return base;
      const formula = def.change === "pts" ? `=F${ref.r}-B${ref.r}` : `=F${ref.r}/B${ref.r}-1`;
      const tRow = def.kind === "source" ? sourceRows[def.source] : sourceRows[(rowAt(def.tiesTo) as { source: string }).source];
      return {
        ...base, kind: "change", display: formatChange(ref.r), formula, label: def.label, unit: def.unit,
        precedents: [{ r: ref.r, c: "F" }, { r: ref.r, c: "B" }],
        target: { row: tRow, q: "3Q26" },
      };
    }
    if (!q) return base;
    if (def.kind === "source") {
      const row = sourceRows[def.source];
      const v = sourceValue(row, q).value;
      return { ...base, kind: "source", display: formatValue(v, def.unit), formula: String(v), label: def.label, unit: def.unit, target: { row, q } };
    }
    if (def.kind === "calc") {
      const tied = rowAt(def.tiesTo) as { source: string };
      return {
        ...base, kind: "calc", display: formatValue(rowValue(ref.r, q), def.unit), formula: `=ROUND(${ref.c}${def.num}/${ref.c}${def.den}*100,2)`,
        label: def.label, unit: def.unit, precedents: [{ r: def.num, c: ref.c }, { r: def.den, c: ref.c }],
        target: { row: sourceRows[tied.source], q },
      };
    }
    const diff = rowValue(ref.r, q);
    const tied = rowAt(def.b) as { source: string };
    return {
      ...base, kind: "check", display: Math.abs(diff) <= ROUNDING_TOLERANCE ? "✓ ties" : `✕ ${diff.toFixed(2)}`, formula: `=IF(ABS(${ref.c}${def.a}-${ref.c}${def.b})<=0.01,"✓ ties","✕")`,
      label: def.label, precedents: [{ r: def.a, c: ref.c }, { r: def.b, c: ref.c }], target: { row: sourceRows[tied.source], q },
    };
  }
  return base;
}

export const printedPage = (pdfPage: number) => pdfPage - 1;
export { quarterColumnNames, sourceRows };
