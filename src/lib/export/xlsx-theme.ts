// Shared Filed Under workbook styling: brand colours, fonts, number formats and sheet furniture.
// Pure apart from the lazily imported exceljs module, so builders can run in the browser and tests.
import type { Borders, Cell, Fill, Font, Row, Workbook, Worksheet } from "exceljs";
import type { Scale } from "@/lib/format";

export async function loadExcel() {
  const mod = await import("exceljs");
  return (mod.default ?? mod) as typeof import("exceljs");
}

/** ARGB colours, matched to the app's paper-and-ink palette. */
export const C = {
  ink: "FF1C1F26",
  inkSoft: "FF3A3F4A",
  paper: "FFFAF8F3",
  paperDeep: "FFEFEBE2",
  band: "FFF4F1EA",
  rule: "FFE2DDD2",
  ruleStrong: "FF9A958B",
  muted: "FF6B7280",
  faint: "FFA3A3A3",
  // Financial-model convention: blue = printed input, black = formula, green = link to another sheet.
  input: "FF0000FF",
  formula: "FF000000",
  link: "FF008000",
  hyperlink: "FF1D4ED8",
  positive: "FF1E7A4E",
  positiveSoft: "FFE5F3EA",
  negative: "FFB42318",
  negativeSoft: "FFFBE9E7",
  warning: "FF9A5B00",
  warningSoft: "FFFDF1D6",
  attention: "FFFFFF00",
} as const;

export const FONT = "Arial";
export const DISPLAY_FONT = "Georgia";

export const solid = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
export const font = (o: Partial<Font> = {}): Partial<Font> => ({ name: FONT, size: 10, color: { argb: C.formula }, ...o });
const thin = (argb: string) => ({ style: "thin" as const, color: { argb } });
const medium = (argb: string) => ({ style: "medium" as const, color: { argb } });
export const hairline: Partial<Borders> = { bottom: thin(C.rule) };
export const totalRule: Partial<Borders> = { top: thin(C.ink), bottom: thin(C.rule) };
export const rootRule: Partial<Borders> = { top: medium(C.ink), bottom: thin(C.ink) };

/** 1-based column letters: 1 → A, 27 → AA. */
export function col(n: number) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel sheet names: ≤ 31 chars, no []:*?/\ and unique within the workbook. */
export function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[[\]:*?/\\]/g, "-").replace(/^'+|'+$/g, "").slice(0, 31).trim() || "Sheet";
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

export const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`;

const ZERO = '"–"';
/**
 * Number format for a unit. Dollar cells always hold the full printed value; the $K/$M/$B scale
 * is applied by the format's trailing commas, so formulas stay exact.
 */
export function numFmtFor(unit: string, scale: Scale, opts: { decimals?: boolean } = {}) {
  switch (unit) {
    case "usd": {
      const body = scale === "full" ? "#,##0" : scale === "K" ? "#,##0," : scale === "M" ? "#,##0.0,," : "#,##0.00,,,";
      return `${body};(${body});${ZERO}`;
    }
    case "usdPerShare":
      return `$#,##0.00;($#,##0.00);${ZERO}`;
    case "pct":
      return `0.0%;(0.0%);${ZERO}`;
    case "bps":
      return `#,##0" bps";(#,##0" bps");${ZERO}`;
    case "ratio":
      return `0.00"×";(0.00"×");${ZERO}`;
    case "count": {
      const body = opts.decimals ? "#,##0.0" : "#,##0";
      return `${body};(${body});${ZERO}`;
    }
    default:
      return "#,##0.00";
  }
}

/** Value written to a cell: percentages become fractions so 0.0% formats and formulas work. */
export const cellValue = (v: number, unit: string) => (unit === "pct" ? v / 100 : v);

export function unitShort(unit: string, scale: Scale) {
  if (unit === "usd") return scale === "full" ? "$" : `$${scale}`;
  return { usdPerShare: "$/unit", pct: "%", bps: "bps", ratio: "×", count: "#" }[unit] ?? unit;
}

export function scaleWords(scale: Scale) {
  return scale === "full" ? "US dollars (full values)" : scale === "K" ? "US$ thousands" : scale === "M" ? "US$ millions" : "US$ billions";
}

/** Clean page: no gridlines, paper-coloured default, Arial throughout. */
export function prepareSheet(ws: Worksheet, o: { freezeCols?: number; freezeRows?: number; tab?: string; landscape?: boolean } = {}) {
  ws.views = [{ state: "frozen", xSplit: o.freezeCols ?? 0, ySplit: o.freezeRows ?? 0, showGridLines: false, zoomScale: 100 }];
  if (o.tab) ws.properties.tabColor = { argb: o.tab };
  ws.properties.defaultRowHeight = 15;
  ws.pageSetup = {
    ...ws.pageSetup,
    orientation: o.landscape === false ? "portrait" : "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.4, right: 0.4, top: 0.55, bottom: 0.55, header: 0.25, footer: 0.25 },
  };
}

/** Sheet title (serif), subtitle and a thin ink rule under them. */
export function titleBlock(ws: Worksheet, title: string, subtitle: string, lastCol: number) {
  const t = ws.getRow(1);
  t.height = 26;
  t.getCell(1).value = title;
  t.getCell(1).font = { name: DISPLAY_FONT, size: 16, color: { argb: C.ink } };
  t.getCell(1).alignment = { vertical: "middle" };
  const s = ws.getRow(2);
  s.getCell(1).value = subtitle;
  s.getCell(1).font = font({ size: 9, italic: true, color: { argb: C.muted } });
  for (let c = 1; c <= lastCol; c++) ws.getRow(2).getCell(c).border = { bottom: thin(C.ink) };
}

export function inkHeader(row: Row, from: number, to: number, o: { size?: number; height?: number; align?: (c: number) => "left" | "right" | "center" } = {}) {
  if (o.height) row.height = o.height;
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    cell.fill = solid(C.ink);
    cell.font = font({ bold: true, size: o.size ?? 9, color: { argb: C.paper } });
    cell.alignment = { vertical: "middle", horizontal: o.align?.(c) ?? "left", wrapText: true };
  }
}

export function band(row: Row, from: number, to: number, argb: string = C.band) {
  for (let c = from; c <= to; c++) row.getCell(c).fill = solid(argb);
}

export function link(cell: Cell, text: string, target: string) {
  cell.value = { text, hyperlink: target };
  cell.font = font({ color: { argb: C.hyperlink }, underline: true });
}

/** HYPERLINK() formula: no relationship entry per link, so tens of thousands stay light. */
export function linkFormula(cell: Cell, text: string, url: string) {
  const q = (s: string) => s.replace(/"/g, '""');
  cell.value = { formula: `HYPERLINK("${q(url)}","${q(text)}")`, result: text };
  cell.font = font({ color: { argb: C.hyperlink }, underline: true, size: 9 });
}

export function footer(ws: Worksheet, left: string) {
  ws.headerFooter = {
    oddFooter: `&L&8${left.replace(/&/g, "&&")}&C&8Filed Under&R&8Page &P of &N`,
  };
}

/** Width and height of a PNG from its IHDR chunk. */
export function pngSize(buf: ArrayBuffer): { width: number; height: number } | null {
  const v = new DataView(buf);
  if (buf.byteLength < 24 || v.getUint32(0) !== 0x89504e47) return null;
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

export interface CoverInfo {
  title: string;
  subtitle: string;
  facts: [string, string | number][];
  legend?: { sample: string; style: Partial<Font>; fill?: string; text: string }[];
  logo?: ArrayBuffer | null;
}

/** Overview sheet: wordmark, title, key facts and a legend. Returns the next free row. */
export function cover(wb: Workbook, ws: Worksheet, info: CoverInfo) {
  prepareSheet(ws, { landscape: false });
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 70;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 16;
  let r = 2;
  const size = info.logo ? pngSize(info.logo) : null;
  if (info.logo && size) {
    const id = wb.addImage({ buffer: info.logo as never, extension: "png" });
    const h = 22;
    ws.addImage(id, { tl: { col: 1, row: 1 }, ext: { width: (size.width / size.height) * h, height: h } });
    ws.getRow(2).height = 24;
    r = 4;
  } else {
    ws.getCell(r, 2).value = "FILED UNDER";
    ws.getCell(r, 2).font = font({ bold: true, size: 11, color: { argb: C.ink } });
    r += 2;
  }
  ws.getCell(r, 2).value = info.title;
  ws.getCell(r, 2).font = { name: DISPLAY_FONT, size: 22, color: { argb: C.ink } };
  ws.getRow(r).height = 32;
  r++;
  ws.getCell(r, 2).value = info.subtitle;
  ws.getCell(r, 2).font = font({ size: 10, color: { argb: C.muted } });
  for (let c = 2; c <= 6; c++) ws.getCell(r, c).border = { bottom: thin(C.ink) };
  r += 2;
  for (const [k, v] of info.facts) {
    ws.getCell(r, 2).value = k;
    ws.getCell(r, 2).font = font({ size: 9, color: { argb: C.muted } });
    ws.getCell(r, 3).value = v;
    ws.getCell(r, 3).font = font({ size: 10 });
    ws.getCell(r, 3).alignment = { horizontal: "left", wrapText: true };
    for (let c = 2; c <= 6; c++) ws.getCell(r, c).border = hairline;
    r++;
  }
  if (info.legend?.length) {
    r++;
    ws.getCell(r, 2).value = "How to read this workbook";
    ws.getCell(r, 2).font = font({ bold: true, size: 10, color: { argb: C.ink } });
    r++;
    for (const l of info.legend) {
      const s = ws.getCell(r, 2);
      s.value = l.sample;
      s.font = font({ ...l.style });
      s.alignment = { horizontal: "right" };
      if (l.fill) s.fill = solid(l.fill);
      ws.getCell(r, 3).value = l.text;
      ws.getCell(r, 3).font = font({ size: 9, color: { argb: C.inkSoft } });
      ws.getCell(r, 3).alignment = { wrapText: true, vertical: "top" };
      r++;
    }
  }
  return r + 1;
}

export async function workbookBlob(wb: Workbook) {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The wordmark for workbook covers; null when it can't be fetched (offline, tests). */
export async function fetchLogo(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export const slug = (s: string) =>
  s
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
