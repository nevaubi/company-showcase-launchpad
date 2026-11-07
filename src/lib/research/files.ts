// Client-side file deliverables for the assistant (create_file): CSV, Markdown, JSON and XLSX.
export type FileFormat = "csv" | "md" | "json" | "xlsx";

export type Cell = string | number | boolean | null;

export interface FileInput {
  format: FileFormat;
  name: string;
  /** For csv/xlsx: header row */
  columns?: string[] | null;
  /** For csv/xlsx: data rows */
  rows?: Cell[][] | null;
  /** For md/json (json may also be built from columns+rows) */
  content?: string | null;
}

export interface BuiltFile {
  name: string;
  mime: string;
  blob: Blob;
  size: number;
  preview: string;
}

const MIME: Record<FileFormat, string> = {
  csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** File name: safe characters only, right extension. */
export function safeName(name: string, format: FileFormat) {
  const base = (name || "file")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "file";
  return `${base}.${format}`;
}

export function csvCell(v: Cell) {
  if (v == null) return "";
  const s = String(v);
  // Neutralise spreadsheet formula injection, then quote when needed.
  const guarded = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(columns: string[], rows: Cell[][]) {
  return [columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function tabular(input: FileInput) {
  const columns = input.columns ?? [];
  const rows = input.rows ?? [];
  if (!columns.length) throw new Error(`${input.format} files need columns`);
  const bad = rows.findIndex((r) => r.length !== columns.length);
  if (bad >= 0) throw new Error(`row ${bad + 1} has ${rows[bad].length} cells; expected ${columns.length}`);
  return { columns, rows };
}

export async function buildFile(input: FileInput): Promise<BuiltFile> {
  const name = safeName(input.name, input.format);
  let blob: Blob;
  let preview: string;
  if (input.format === "csv") {
    const { columns, rows } = tabular(input);
    const text = toCsv(columns, rows);
    blob = new Blob(["﻿", text], { type: MIME.csv });
    preview = text.split("\r\n").slice(0, 6).join("\n");
  } else if (input.format === "md") {
    const text = input.content ?? "";
    if (!text.trim()) throw new Error("markdown files need content");
    blob = new Blob([text], { type: MIME.md });
    preview = text.slice(0, 400);
  } else if (input.format === "json") {
    let value: unknown;
    if (input.content != null && input.content !== "") {
      try {
        value = JSON.parse(input.content);
      } catch (e) {
        throw new Error(`content is not valid JSON: ${(e as Error).message}`);
      }
    } else {
      const { columns, rows } = tabular(input);
      value = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    }
    const text = JSON.stringify(value, null, 2);
    blob = new Blob([text], { type: MIME.json });
    preview = text.slice(0, 400);
  } else {
    const { columns, rows } = tabular(input);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow(columns).font = { bold: true };
    for (const r of rows) ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v)));
    ws.columns.forEach((c, i) => {
      const w = Math.max(columns[i]?.length ?? 8, ...rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
      c.width = Math.min(48, Math.max(8, w + 2));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    blob = new Blob([buf], { type: MIME.xlsx });
    preview = [columns.join(" | "), ...rows.slice(0, 4).map((r) => r.join(" | "))].join("\n");
  }
  return { name, mime: MIME[input.format], blob, size: blob.size, preview };
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
