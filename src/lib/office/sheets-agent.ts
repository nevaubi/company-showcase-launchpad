// Browser executor for the Sheets tools (agent-tools.ts) against the live workbook.
import type { ToolRun } from "@/lib/research/execute";
import { colIndex, formatValue, refOf, type CellFormat, type Scalar } from "@/lib/sheet/formula";
import {
  blankSheet, clearRange, eachRef, fillRange, parseRange, rangeOf, shiftRows, sortRange, styleRange, usedRect, writeBlock,
  type CellStyle, type SheetData, type Workbook,
} from "@/lib/office/workbook";

export interface SheetsHost {
  wb: () => Workbook;
  commit: () => void;
  value: (sheet: number, ref: string) => Scalar;
  setTitle: (t: string) => void;
}

export function sheetsTool(h: SheetsHost) {
  return (name: string, a: Record<string, unknown>): Promise<ToolRun> | null => {
    if (!name.startsWith("sheet_")) return null;
    const ok = (summary: string, output = summary) => { h.commit(); return Promise.resolve({ summary, output }); };
    const wb = h.wb();
    const pick = (): { sh: SheetData; si: number } => {
      const nm = a.sheet as string | null;
      const si = nm ? wb.sheets.findIndex((s) => s.name.toLowerCase() === nm.toLowerCase()) : wb.active;
      if (si < 0) throw new Error(`No sheet "${nm}". Sheets: ${wb.sheets.map((s) => s.name).join(", ")}`);
      return { sh: wb.sheets[si], si };
    };
    switch (name) {
      case "sheet_read": {
        const { sh, si } = pick();
        const used = usedRect(sh);
        const r = a.range ? parseRange(a.range as string, sh) : used;
        const head = `Sheets: ${wb.sheets.map((s, i) => `${s.name}${i === wb.active ? " (active)" : ""}`).join(", ")}\nSheet "${sh.name}" used range: ${used ? rangeOf(used) : "empty"}; frozen ${sh.freeze.r} rows/${sh.freeze.c} cols` +
          (sh.charts.length ? `\nCharts: ${sh.charts.map((c) => `${c.id} ${c.type} "${c.title}" at ${c.at}`).join("; ")}` : "");
        if (!r) return ok(`Read ${sh.name} (empty)`, head);
        const lines: string[] = [];
        let n = 0;
        eachRef({ ...r, r1: Math.min(r.r1, r.r0 + 199), c1: Math.min(r.c1, r.c0 + 29) }, (ref) => {
          const raw = sh.cells[ref];
          if (raw == null) return;
          n++;
          const v = formatValue(h.value(si, ref), sh.fmt[ref]);
          lines.push(raw.startsWith("=") ? `${ref}: ${raw} → ${v}` : `${ref}: ${v}`);
        });
        return ok(`Read ${n} cells of ${sh.name}`, `${head}\n${lines.join("\n")}`.slice(0, 24000));
      }
      case "sheet_write": {
        const { sh } = pick();
        const n = writeBlock(sh, a.start as string, a.values as (string | number | null)[][]);
        return ok(`Wrote ${n} cells at ${a.start}`);
      }
      case "sheet_format": {
        const { sh } = pick();
        const p: CellStyle = {};
        const set = <K extends keyof CellStyle>(k: K, v: unknown) => { if (v !== null && v !== undefined) p[k] = (v === "" ? undefined : v) as CellStyle[K]; };
        set("b", a.bold); set("i", a.italic); set("u", a.underline); set("fill", a.fill); set("color", a.color); set("align", a.align); set("border", a.border);
        styleRange(sh, parseRange(a.range as string, sh), p, a.number_format as CellFormat | null);
        return ok(`Formatted ${a.range}`);
      }
      case "sheet_sort": {
        const { sh, si } = pick();
        const r = parseRange(a.range as string, sh);
        const col = colIndex(String(a.by_column).toUpperCase());
        if (col < r.c0 || col > r.c1) throw new Error(`Column ${a.by_column} is outside ${a.range}`);
        const n = sortRange(sh, r, col, !!a.descending, !!a.has_header, (ref) => h.value(si, ref));
        return ok(`Sorted ${n} rows by ${a.by_column}`);
      }
      case "sheet_fill": { const { sh } = pick(); const n = fillRange(sh, parseRange(a.range as string, sh), a.direction as "down"); return ok(`Filled ${n} cells`); }
      case "sheet_clear": { const { sh } = pick(); clearRange(sh, parseRange(a.range as string, sh), a.what as "all"); return ok(`Cleared ${a.range}`); }
      case "sheet_rows": { const { sh } = pick(); shiftRows(sh, Number(a.row) - 1, Number(a.count)); return ok(`${Number(a.count) > 0 ? "Inserted" : "Deleted"} ${Math.abs(Number(a.count))} rows at ${a.row}`); }
      case "sheet_layout": {
        const { sh } = pick();
        if (a.columns && a.width) { const r = parseRange(a.columns as string, sh); for (let c = r.c0; c <= r.c1; c++) sh.widths[c] = Math.max(40, Math.min(400, Number(a.width))); }
        if (a.freeze_rows != null) sh.freeze.r = Number(a.freeze_rows);
        if (a.freeze_cols != null) sh.freeze.c = Number(a.freeze_cols);
        return ok("Updated layout");
      }
      case "sheet_chart": {
        const { sh } = pick();
        parseRange(a.labels as string, sh); (a.series as string[]).forEach((s) => parseRange(s, sh));
        const id = `c${Date.now().toString(36).slice(-5)}`;
        sh.charts.push({ id, type: a.type as "bar", title: String(a.title), labels: String(a.labels), series: a.series as string[], at: String(a.anchor || "H2") });
        return ok(`Added ${a.type} chart "${a.title}"`, `Chart ${id} added`);
      }
      case "sheet_delete_chart": { const { sh } = pick(); sh.charts = sh.charts.filter((c) => c.id !== a.id); return ok(`Removed chart ${a.id}`); }
      case "sheet_manage": {
        const nm = String(a.name);
        const i = wb.sheets.findIndex((s) => s.name.toLowerCase() === nm.toLowerCase());
        if (a.action === "add") { if (i >= 0) throw new Error(`Sheet "${nm}" exists`); wb.sheets.push(blankSheet(nm)); wb.active = wb.sheets.length - 1; return ok(`Added sheet ${nm}`); }
        if (i < 0) throw new Error(`No sheet "${nm}"`);
        if (a.action === "rename") { wb.sheets[i].name = String(a.new_name || nm); return ok(`Renamed to ${wb.sheets[i].name}`); }
        if (a.action === "delete") { if (wb.sheets.length === 1) throw new Error("A workbook needs one sheet"); wb.sheets.splice(i, 1); wb.active = 0; return ok(`Deleted sheet ${nm}`); }
        wb.active = i; return ok(`Switched to ${nm}`);
      }
      case "sheet_set_title": h.setTitle(String(a.title)); return ok(`Renamed workbook to ${a.title}`);
    }
    return null;
  };
}
export { refOf };
