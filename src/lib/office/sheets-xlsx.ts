// Office Sheets ⇄ real .xlsx (exceljs, lazily loaded so it stays out of SSR).
import { loadExcel } from "@/lib/export/xlsx-theme";
import { colName, parseRef, type CellFormat, type Scalar } from "@/lib/sheet/formula";
import { blankSheet, type CellStyle, type SheetData, type Workbook } from "@/lib/office/workbook";

const NUMFMT: Record<CellFormat, string | undefined> = {
  general: undefined, number: "#,##0.00", usd: '"$"#,##0.00', usdM: '"$"#,##0,,"M"', pct: "0.0%", x: '0.0"×"',
};
const argb = (hex?: string) => (hex ? `FF${hex.replace("#", "").toUpperCase()}` : undefined);
const hex = (a?: string) => (a && a.length >= 6 ? `#${a.slice(-6)}` : undefined);
/** Formulas Excel can't evaluate (Filed Under data) are written as values with the formula in a note. */
const CUSTOM = /\b(FU|PRICE)\s*\(/i;

export async function workbookToXlsx(wb: Workbook, value: (sheet: number, ref: string) => Scalar) {
  const X = await loadExcel();
  const book = new X.Workbook();
  book.creator = "FiledUnder";
  wb.sheets.forEach((sh, si) => {
    const ws = book.addWorksheet(sh.name.slice(0, 31) || `Sheet${si + 1}`, {
      views: sh.freeze.r || sh.freeze.c ? [{ state: "frozen", xSplit: sh.freeze.c, ySplit: sh.freeze.r }] : undefined,
    });
    for (const [c, w] of Object.entries(sh.widths)) ws.getColumn(Number(c) + 1).width = Math.round(w / 7);
    const refs = new Set([...Object.keys(sh.cells), ...Object.keys(sh.style), ...Object.keys(sh.fmt)]);
    for (const ref of refs) {
      const cell = ws.getCell(ref);
      const raw = sh.cells[ref];
      if (raw != null) {
        const v = value(si, ref);
        const res = typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : undefined;
        if (raw.startsWith("=") && !CUSTOM.test(raw)) cell.value = { formula: raw.slice(1), result: res } as never;
        else if (raw.startsWith("=")) { cell.value = (res ?? null) as never; cell.note = `FiledUnder: ${raw}`; }
        else cell.value = (res ?? raw) as never;
      }
      const f = sh.fmt[ref];
      if (f && NUMFMT[f]) cell.numFmt = NUMFMT[f]!;
      const s = sh.style[ref];
      if (s) {
        cell.font = { bold: s.b, italic: s.i, underline: s.u, color: s.color ? { argb: argb(s.color) } : undefined };
        if (s.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(s.fill) } };
        if (s.align) cell.alignment = { horizontal: s.align };
        if (s.border) { const b = { style: "thin" as const, color: { argb: "FFBFBFBF" } }; cell.border = { top: b, left: b, bottom: b, right: b }; }
      }
    }
  });
  const buf = await book.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const FMT_BACK = (f?: string): CellFormat | undefined =>
  !f ? undefined : f.includes("%") ? "pct" : f.includes(",,") ? "usdM" : f.includes("$") ? "usd" : f.includes("#,##0") ? "number" : undefined;

export async function xlsxToWorkbook(data: ArrayBuffer): Promise<Workbook> {
  const X = await loadExcel();
  const book = new X.Workbook();
  await book.xlsx.load(data);
  const sheets: SheetData[] = [];
  book.eachSheet((ws) => {
    const sh = blankSheet(ws.name);
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      const ref = cell.address;
      const v = cell.value as unknown;
      let raw: string | undefined;
      if (v && typeof v === "object" && "formula" in (v as object)) raw = `=${(v as { formula: string }).formula}`;
      else if (v && typeof v === "object" && "sharedFormula" in (v as object)) raw = String((v as { result?: unknown }).result ?? "");
      else if (v instanceof Date) raw = v.toISOString().slice(0, 10);
      else if (v && typeof v === "object" && "richText" in (v as object)) raw = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
      else if (v && typeof v === "object" && "text" in (v as object)) raw = String((v as { text: string }).text);
      else if (v != null) raw = String(v);
      if (raw != null && raw !== "") sh.cells[ref] = raw;
      const f = FMT_BACK(cell.numFmt);
      if (f) sh.fmt[ref] = f;
      const st: CellStyle = {};
      if (cell.font?.bold) st.b = true;
      if (cell.font?.italic) st.i = true;
      const fg = (cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
      if (fg && fg !== "FFFFFFFF") st.fill = hex(fg);
      const fc = cell.font?.color?.argb;
      if (fc && fc !== "FF000000") st.color = hex(fc);
      const al = cell.alignment?.horizontal;
      if (al === "left" || al === "center" || al === "right") st.align = al;
      if (Object.keys(st).length) sh.style[ref] = st;
      const p = parseRef(ref);
      if (p) { sh.rows = Math.max(sh.rows, p.r + 20); sh.cols = Math.max(sh.cols, p.c + 4); }
    }));
    ws.columns?.forEach((col, i) => { if (col.width && Math.abs(col.width - 9) > 0.5) sh.widths[i] = Math.round(col.width * 7); });
    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    if (view?.state === "frozen") sh.freeze = { r: view.ySplit ?? 0, c: view.xSplit ?? 0 };
    sh.cols = Math.min(sh.cols, 200);
    sheets.push(sh);
  });
  return { sheets: sheets.length ? sheets : [blankSheet()], active: 0 };
}
export { colName };
