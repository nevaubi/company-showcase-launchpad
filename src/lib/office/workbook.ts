// Office Sheets workbook model and pure range operations (shared by the grid,
// the OfficeAI tool executor, xlsx import/export and tests).
import { colIndex, colName, parseRef, refOf, type CellFormat } from "@/lib/sheet/formula";

export interface CellStyle { b?: boolean; i?: boolean; u?: boolean; fill?: string; color?: string; align?: "left" | "center" | "right"; border?: boolean }
export interface SheetChart { id: string; type: "bar" | "line" | "pie" | "area"; title: string; labels: string; series: string[]; at: string }
export interface SheetData {
  name: string; rows: number; cols: number;
  cells: Record<string, string>; fmt: Record<string, CellFormat>; style: Record<string, CellStyle>;
  widths: Record<number, number>; freeze: { r: number; c: number }; charts: SheetChart[];
}
export interface Workbook { sheets: SheetData[]; active: number }

export const blankSheet = (name = "Sheet1"): SheetData => ({ name, rows: 100, cols: 26, cells: {}, fmt: {}, style: {}, widths: {}, freeze: { r: 0, c: 0 }, charts: [] });
export const blankWorkbook = (): Workbook => ({ sheets: [blankSheet()], active: 0 });

export interface Rect { c0: number; r0: number; c1: number; r1: number }
/** "A1", "A1:C5", "B:B" or "2:2" → rectangle (0-based, inclusive). */
export function parseRange(s: string, sh?: Pick<SheetData, "rows" | "cols">): Rect {
  const t = s.replace(/\$/g, "").trim().toUpperCase();
  const col = t.match(/^([A-Z]{1,3}):([A-Z]{1,3})$/);
  if (col) return norm({ c0: colIndex(col[1]), c1: colIndex(col[2]), r0: 0, r1: (sh?.rows ?? 100) - 1 });
  const row = t.match(/^(\d+):(\d+)$/);
  if (row) return norm({ c0: 0, c1: (sh?.cols ?? 26) - 1, r0: Number(row[1]) - 1, r1: Number(row[2]) - 1 });
  const [a, b = a] = t.split(":");
  const pa = parseRef(a), pb = parseRef(b);
  if (!pa || !pb) throw new Error(`Bad range "${s}". Use A1 or A1:C5`);
  return norm({ c0: pa.c, r0: pa.r, c1: pb.c, r1: pb.r });
}
const norm = (r: Rect): Rect => ({ c0: Math.min(r.c0, r.c1), c1: Math.max(r.c0, r.c1), r0: Math.min(r.r0, r.r1), r1: Math.max(r.r0, r.r1) });
export const rangeOf = (r: Rect) => (r.c0 === r.c1 && r.r0 === r.r1 ? refOf(r.c0, r.r0) : `${refOf(r.c0, r.r0)}:${refOf(r.c1, r.r1)}`);
export function eachRef(r: Rect, f: (ref: string, c: number, row: number) => void) {
  for (let row = r.r0; row <= r.r1; row++) for (let c = r.c0; c <= r.c1; c++) f(refOf(c, row), c, row);
}

/** Grow the sheet so a rectangle fits. */
export function ensure(sh: SheetData, r: Rect) {
  sh.rows = Math.max(sh.rows, r.r1 + 1);
  sh.cols = Math.max(sh.cols, r.c1 + 1);
}

/** Write a 2-D block of raw values (formulas start with "=") at a top-left cell. */
export function writeBlock(sh: SheetData, start: string, values: (string | number | null)[][]) {
  const p = parseRef(start);
  if (!p) throw new Error(`Bad cell "${start}"`);
  let n = 0;
  values.forEach((row, ri) => row.forEach((v, ci) => {
    const ref = refOf(p.c + ci, p.r + ri);
    if (v == null || v === "") delete sh.cells[ref]; else sh.cells[ref] = String(v);
    n++;
  }));
  ensure(sh, { c0: p.c, r0: p.r, c1: p.c + Math.max(0, ...values.map((r) => r.length)) - 1, r1: p.r + values.length - 1 });
  return n;
}

export function clearRange(sh: SheetData, r: Rect, what: "all" | "contents" | "formats" = "all") {
  eachRef(r, (ref) => {
    if (what !== "formats") delete sh.cells[ref];
    if (what !== "contents") { delete sh.fmt[ref]; delete sh.style[ref]; }
  });
}

/** Shift a formula's relative references by (dc, dr) — used when sorting or filling. */
export function shiftFormula(f: string, dc: number, dr: number) {
  if (!f.startsWith("=")) return f;
  return f.replace(/("[^"]*")|(\$?)([A-Z]{1,3})(\$?)(\d{1,5})(?![\w(])/g, (m, q, dcol, col, drow, row) => {
    if (q) return q;
    const c = dcol ? col : colName(Math.max(0, colIndex(col) + dc));
    const r = drow ? row : String(Math.max(1, Number(row) + dr));
    return `${dcol}${c}${drow}${r}`;
  });
}

/** Sort the rows of a range by one column, moving values, formats and styles together. */
export function sortRange(sh: SheetData, r: Rect, byCol: number, desc: boolean, header: boolean, val: (ref: string) => unknown) {
  const r0 = header ? r.r0 + 1 : r.r0;
  const rows: { cells: (string | undefined)[]; fmt: (CellFormat | undefined)[]; style: (CellStyle | undefined)[]; key: unknown; from: number }[] = [];
  for (let row = r0; row <= r.r1; row++) {
    const o = { cells: [] as (string | undefined)[], fmt: [] as (CellFormat | undefined)[], style: [] as (CellStyle | undefined)[], key: val(refOf(byCol, row)), from: row };
    for (let c = r.c0; c <= r.c1; c++) { const ref = refOf(c, row); o.cells.push(sh.cells[ref]); o.fmt.push(sh.fmt[ref]); o.style.push(sh.style[ref]); }
    rows.push(o);
  }
  const rank = (v: unknown) => (v == null || v === "" ? 2 : typeof v === "number" ? 0 : 1);
  rows.sort((a, b) => {
    const ra = rank(a.key), rb = rank(b.key);
    if (ra !== rb) return ra - rb; // blanks always last
    if (ra === 2) return 0;
    const d = ra === 0 ? (a.key as number) - (b.key as number) : String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
    return desc ? -d : d;
  });
  rows.forEach((o, i) => {
    const row = r0 + i;
    for (let c = r.c0, k = 0; c <= r.c1; c++, k++) {
      const ref = refOf(c, row);
      const v = o.cells[k];
      if (v == null) delete sh.cells[ref]; else sh.cells[ref] = shiftFormula(v, 0, row - o.from);
      if (o.fmt[k]) sh.fmt[ref] = o.fmt[k]!; else delete sh.fmt[ref];
      if (o.style[k]) sh.style[ref] = o.style[k]!; else delete sh.style[ref];
    }
  });
  return rows.length;
}

export function styleRange(sh: SheetData, r: Rect, patch: CellStyle, fmt?: CellFormat | null) {
  eachRef(r, (ref) => {
    const next = { ...sh.style[ref], ...patch };
    for (const k of Object.keys(next) as (keyof CellStyle)[]) if (next[k] === undefined || next[k] === "" || next[k] === false) delete next[k];
    if (Object.keys(next).length) sh.style[ref] = next; else delete sh.style[ref];
    if (fmt) { if (fmt === "general") delete sh.fmt[ref]; else sh.fmt[ref] = fmt; }
  });
}

/** Fill the first row/column of a range down/right, shifting relative refs (Excel fill handle). */
export function fillRange(sh: SheetData, r: Rect, dir: "down" | "right") {
  let n = 0;
  if (dir === "down") for (let c = r.c0; c <= r.c1; c++) { const src = sh.cells[refOf(c, r.r0)]; if (src == null) continue; for (let row = r.r0 + 1; row <= r.r1; row++) { sh.cells[refOf(c, row)] = shiftFormula(src, 0, row - r.r0); n++; } }
  else for (let row = r.r0; row <= r.r1; row++) { const src = sh.cells[refOf(r.c0, row)]; if (src == null) continue; for (let c = r.c0 + 1; c <= r.c1; c++) { sh.cells[refOf(c, row)] = shiftFormula(src, c - r.c0, 0); n++; } }
  return n;
}

/** Insert (count>0) or delete (count<0) rows at index, moving everything below. */
export function shiftRows(sh: SheetData, at: number, count: number) {
  const move = <T,>(m: Record<string, T>) => {
    const out: Record<string, T> = {};
    for (const [ref, v] of Object.entries(m)) {
      const p = parseRef(ref)!;
      if (p.r < at) out[ref] = v;
      else if (count < 0 && p.r < at - count) continue;
      else out[refOf(p.c, p.r + count)] = v;
    }
    return out;
  };
  sh.cells = move(sh.cells); sh.fmt = move(sh.fmt); sh.style = move(sh.style);
  sh.rows = Math.max(20, sh.rows + count);
}

export function usedRect(sh: SheetData): Rect | null {
  let c1 = -1, r1 = -1;
  for (const ref of Object.keys(sh.cells)) { const p = parseRef(ref); if (p) { c1 = Math.max(c1, p.c); r1 = Math.max(r1, p.r); } }
  return c1 < 0 ? null : { c0: 0, r0: 0, c1, r1 };
}

/** Chart rows from label and series cell values (each a 1-D range). A series one cell longer than the
 *  labels, or whose first cell is text while the label's is too, uses that cell as its name. */
export function chartData(labels: unknown[], series: unknown[][]) {
  let labs = labels;
  const names = series.map((s, i) => (typeof s[0] === "string" && (s.length > labels.length || typeof labels[0] === "string") ? String(s[0]) : `Series ${i + 1}`));
  const vals = series.map((s, i) => (names[i] !== `Series ${i + 1}` ? s.slice(1) : s));
  if (vals.length && vals.every((v) => v.length < labs.length)) labs = labs.slice(labs.length - vals[0].length);
  const rows = labs.map((l, i) => {
    const o: Record<string, string | number> = { label: l == null ? "" : String(l) };
    vals.forEach((v, k) => { o[names[k]] = typeof v[i] === "number" ? (v[i] as number) : 0; });
    return o;
  });
  return { rows, names };
}
