/**
 * Build searchable HTML renditions of stored IR spreadsheets and PDFs so their numbers can be
 * extracted and highlighted cell-by-cell like an HTML press release. The original file stays in
 * storage untouched; the rendition sits next to it (`<path>.rendition.html`).
 *   - XLSX: one <table> per worksheet; cell index = spreadsheet column (A = 0)
 *   - PDF:  one <table> per page (pdftotext -layout); each text line is a row, columns split on 2+ spaces
 * Run: bun scripts/ir-renditions.ts [--ticker=AAPL] [--limit=200]
 */
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const STYLE = `<style>body{font:12px/1.4 -apple-system,Segoe UI,sans-serif;color:#111}h2{font-size:13px;margin:28px 0 6px;padding-top:8px;border-top:1px solid #ccc}table{border-collapse:collapse}td{border:1px solid #e3e3e3;padding:2px 6px;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}</style>`;
const isNum = (s: string) => /^[($-]*\$?\s*[\d,]+(\.\d+)?\)?%?$/.test(s.trim());

async function xlsxHtml(buf: ArrayBuffer, title: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const parts = [`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${STYLE}</head><body>`];
  let sheets = 0;
  wb.eachSheet((ws) => {
    sheets++;
    const cols = Math.min(ws.columnCount, 40);
    parts.push(`<h2>Sheet: ${esc(ws.name)}</h2><table data-sheet="${esc(ws.name)}">`);
    for (let r = 1; r <= Math.min(ws.rowCount, 600); r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) {
        const cell = row.getCell(c);
        let t = "";
        try {
          t = cell.text ?? "";
        } catch {
          t = "";
        }
        if (!t && cell.formula && cell.result != null) t = String(cell.result);
        t = t.trim();
        cells.push(`<td${isNum(t) ? ' class="n"' : ""}>${esc(t)}</td>`);
      }
      parts.push(`<tr>${cells.join("")}</tr>`);
    }
    parts.push("</table>");
  });
  parts.push("</body></html>");
  return { html: parts.join(""), pages: sheets };
}

function pdfHtml(buf: ArrayBuffer, title: string) {
  const dir = mkdtempSync(join(tmpdir(), "irpdf-"));
  const file = join(dir, "doc.pdf");
  writeFileSync(file, Buffer.from(buf));
  const text = execFileSync("pdftotext", ["-layout", "-l", "150", file, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  const pages = text.split("\f");
  if (pages.at(-1)?.trim() === "") pages.pop();
  const parts = [`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${STYLE}</head><body>`];
  pages.forEach((p, i) => {
    parts.push(`<h2 id="page-${i + 1}">Page ${i + 1}</h2><table data-page="${i + 1}">`);
    for (const line of p.split("\n")) {
      if (!line.trim()) continue;
      const cells = line.trim().split(/\s{2,}/);
      parts.push(`<tr>${cells.map((c) => `<td${isNum(c) ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`);
    }
    parts.push("</table>");
  });
  parts.push("</body></html>");
  return { html: parts.join(""), pages: pages.length };
}

let q = sb.from("ir_documents").select("id, ticker, path, ext, title").is("rendition_path", null).in("ext", ["xlsx", "xlsm", "pdf"]).neq("kind", "image").limit(Number(args.limit ?? 300));
if (args.ticker) q = q.eq("ticker", args.ticker);
const { data: docs, error } = await q;
if (error) throw error;
console.log(`${docs!.length} documents to render`);
let ok = 0;
for (const d of docs!) {
  try {
    const { data: file, error: e } = await sb.storage.from("ir-documents").download(d.path!);
    if (e || !file) throw new Error(e?.message ?? "download failed");
    const buf = await file.arrayBuffer();
    const r = d.ext === "pdf" ? pdfHtml(buf, d.title) : await xlsxHtml(buf, d.title);
    const rpath = `${d.path}.rendition.html`;
    const up = await sb.storage.from("ir-documents").upload(rpath, new Blob([r.html], { type: "text/html" }), { contentType: "text/html", upsert: true });
    if (up.error) throw new Error(up.error.message);
    await sb.from("ir_documents").update({ rendition_path: rpath, pages: r.pages, extract_status: null, extracted_at: null }).eq("id", d.id);
    ok++;
    console.log(`  ${d.ticker} ${d.ext} ${r.pages}p ${(r.html.length / 1024).toFixed(0)}KB  ${d.title}`);
  } catch (e) {
    await sb.from("ir_documents").update({ rendition_path: "", extract_status: `rendition failed: ${(e as Error).message.slice(0, 120)}` }).eq("id", d.id);
    console.warn(`  ! ${d.ticker} ${d.title}: ${(e as Error).message}`);
  }
}
console.log(`rendered ${ok}/${docs!.length}`);
