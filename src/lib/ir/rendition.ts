// Pure builders for the HTML copies ("renditions") of stored IR files that the table reader and
// the source viewer share. Cell indexes are DOM indexes (`table.rows[r].cells[c]`), so every table
// is emitted as a plain grid: no row/col spans, one <td> per grid position.
//   - PDF:      per page, Docling's tables (reading order, header cells kept) when they hold the
//               page's numbers; otherwise the pdftotext layout grid (a row per printed line)
//   - Markdown: pipe tables → tables, `---` page breaks → page numbers
import { parseNumber } from "@/lib/ir/tables";

export const RENDITION_STYLE = `<style>body{font:12px/1.4 -apple-system,Segoe UI,sans-serif;color:#111}h2{font-size:13px;margin:28px 0 6px;padding-top:8px;border-top:1px solid #ccc}h3{font-size:12px;margin:14px 0 4px}p{margin:4px 0}table{border-collapse:collapse;margin:6px 0}td{border:1px solid #e3e3e3;padding:2px 6px;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}td.h{font-weight:600}tr.cap td{border:0;color:#555;font-style:italic;white-space:normal}</style>`;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const isNum = (s: string) => /^[($-]*\$?\s*[\d,]+(\.\d+)?\)?%?$/.test(s.trim());

/**
 * Lay a pdftotext page onto a grid: numeric columns are found from the right edges of numbers
 * (financial tables right-align), and every token lands in the column whose edge it is nearest,
 * so headers and values of the same period share a column index.
 */
export function alignPage(text: string): string[][] {
  const lines = text.split("\n").filter((l) => l.trim());
  const toks = lines.map((l) => [...l.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ s: m[0], a: m.index!, b: m.index! + m[0].length })));
  const edges: number[] = [];
  for (const row of toks) for (const t of row.slice(1)) if (isNum(t.s)) edges.push(t.b);
  edges.sort((x, y) => x - y);
  const anchors: number[] = [];
  for (const e of edges) {
    const last = anchors.at(-1);
    if (last != null && e - last <= 3) continue;
    if (edges.filter((x) => Math.abs(x - e) <= 3).length >= 2) anchors.push(e);
  }
  if (!anchors.length) return toks.map((r) => r.map((t) => t.s));
  return toks.map((row) => {
    const out: string[] = new Array(anchors.length + 1).fill("");
    for (const t of row) {
      if (t.b < anchors[0] - 12 && !isNum(t.s)) {
        out[0] = out[0] ? `${out[0]} ${t.s}` : t.s;
        continue;
      }
      // numbers by right edge, words by centre
      const x = isNum(t.s) ? t.b : (t.a + t.b) / 2;
      let k = 0;
      for (let j = 1; j < anchors.length; j++) if (Math.abs(anchors[j] - x) < Math.abs(anchors[k] - x)) k = j;
      out[k + 1] = out[k + 1] ? `${out[k + 1]} ${t.s}` : t.s;
    }
    return out;
  });
}

const td = (c: string, extra = "") => `<td${isNum(c) || extra ? ` class="${[isNum(c) ? "n" : "", extra].filter(Boolean).join(" ")}"` : ""}>${esc(c)}</td>`;

/** One printed page as the layout grid (a row per printed line). */
export function layoutTable(page: number, text: string) {
  return `<table data-page="${page}">${alignPage(text)
    .map((cells) => `<tr>${cells.map((c) => td(c)).join("")}</tr>`)
    .join("")}</table>`;
}

/** Numbers that sit in table-like lines (two or more numbers on the line) — the figures a table reader can use. */
export function tableNumberCount(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    const nums = [...line.matchAll(/\S+(?: \S+)*/g)].filter((m) => isNum(m[0]) && /\d/.test(m[0])).length;
    if (nums >= 2) n += nums;
  }
  return n;
}

/** Words on a page's text layer; under 5 means a scanned page. */
export const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;

export interface DoclingCell {
  /** text */
  t: string;
  /** column header */
  h: boolean;
  /** first grid position of a spanning cell (false on the repeated positions) */
  o: boolean;
}
export type DoclingItem = { type: "table"; page: number | null; rows: DoclingCell[][] } | { type: "text"; page: number | null; label: string; text: string };
export interface DoclingDoc {
  pages: number;
  items: DoclingItem[];
}

/**
 * A spanning cell repeats its text on every grid position it covers; header text stays repeated
 * (each period column keeps its "Three Months Ended" heading), numbers appear once only.
 */
export function doclingGrid(rows: DoclingCell[][]): { text: string[][]; header: boolean[][] } {
  const text = rows.map((r) => r.map((c) => (c.o || c.h || parseNumber(c.t) == null ? c.t : "")));
  const header = rows.map((r) => r.map((c) => c.h));
  return { text, header };
}

const numericCells = (rows: DoclingCell[][]) => rows.reduce((n, r) => n + r.filter((c) => c.o && parseNumber(c.t) != null).length, 0);

export type PageSource = "docling" | "layout" | "ocr" | "empty";

/**
 * Which copy of a page the table reader should see. Docling wins when its tables hold at least
 * `minShare` of the numbers printed in table-like lines (so nothing the layout grid shows is lost);
 * scanned pages (no text layer) use Docling's OCR output.
 */
export function choosePage(o: { layoutText: string; tables: DoclingCell[][][]; minShare?: number }): PageSource {
  const scanned = wordCount(o.layoutText) < 5;
  const dNums = o.tables.reduce((n, t) => n + numericCells(t), 0);
  if (scanned) return o.tables.length || dNums ? "ocr" : "empty";
  if (!o.tables.length) return "layout";
  const need = tableNumberCount(o.layoutText);
  return dNums >= Math.ceil(need * (o.minShare ?? 0.9)) ? "docling" : "layout";
}

/** Short text items just above a table (units, period headings) become caption rows inside it. */
const CAPTION_MAX = 240;

function doclingTable(page: number, rows: DoclingCell[][], captions: string[], ocr: boolean) {
  const { text, header } = doclingGrid(rows);
  const width = Math.max(1, ...text.map((r) => r.length));
  const cap = captions.map((c) => `<tr class="cap"><td>${esc(c)}</td>${"<td></td>".repeat(width - 1)}</tr>`).join("");
  const body = text.map((r, ri) => `<tr>${r.map((c, ci) => td(c, header[ri][ci] ? "h" : "")).join("")}</tr>`).join("");
  return `<table data-page="${page}" data-src="${ocr ? "docling-ocr" : "docling"}">${cap}${body}</table>`;
}

export interface RenditionStats {
  pages: number;
  docling: number;
  layout: number;
  ocr: number;
  empty: number;
}

/**
 * The hybrid PDF copy: `layoutPages[i]` is pdftotext -layout text of page i+1; `docling` is the
 * worker's output (null when Docling failed — every page then uses the layout grid).
 */
export function pdfRendition(o: {
  title: string;
  layoutPages: string[];
  docling: DoclingDoc | null;
  engine?: string;
  minShare?: number;
  /** "text": scanned pages keep their OCR words as searchable paragraphs but no tables, because the
   *  page-image reader (ir-vision) reads scanned pages; "tables" (default) emits the OCR tables. */
  scanned?: "tables" | "text";
}): { html: string; stats: RenditionStats } {
  const byPage = new Map<number, DoclingItem[]>();
  for (const it of o.docling?.items ?? []) {
    if (it.page == null) continue;
    const list = byPage.get(it.page) ?? [];
    list.push(it);
    byPage.set(it.page, list);
  }
  const stats: RenditionStats = { pages: o.layoutPages.length, docling: 0, layout: 0, ocr: 0, empty: 0 };
  const parts = [`<!doctype html><html><head><meta charset="utf-8"><meta name="rendition" content="${esc(o.engine ?? "pdftotext-layout")}"><title>${esc(o.title)}</title>${RENDITION_STYLE}</head><body>`];
  o.layoutPages.forEach((layoutText, i) => {
    const page = i + 1;
    const items = byPage.get(page) ?? [];
    const tables = items.filter((x): x is Extract<DoclingItem, { type: "table" }> => x.type === "table").map((x) => x.rows);
    const src = o.docling ? choosePage({ layoutText, tables, minShare: o.minShare }) : wordCount(layoutText) < 5 ? "empty" : "layout";
    stats[src]++;
    parts.push(`<h2 id="page-${page}">Page ${page}</h2>`);
    if (src === "layout") {
      parts.push(layoutTable(page, layoutText));
      return;
    }
    if (src === "empty") {
      parts.push(`<table data-page="${page}"></table>`);
      return;
    }
    if (src === "ocr" && o.scanned === "text") {
      for (const it of items) {
        if (it.type === "text") parts.push(`<p>${esc(it.text)}</p>`);
        else for (const row of doclingGrid(it.rows).text) if (row.some(Boolean)) parts.push(`<p>${esc(row.filter(Boolean).join(" "))}</p>`);
      }
      parts.push(`<table data-page="${page}"></table>`);
      return;
    }
    let pending: string[] = [];
    let wroteTable = false;
    for (const it of items) {
      if (it.type === "text") {
        const tag = it.label === "title" || it.label === "section_header" ? "h3" : "p";
        parts.push(`<${tag}>${esc(it.text)}</${tag}>`);
        if (it.text.length <= CAPTION_MAX) pending = [...pending, it.text].slice(-2);
        else pending = [];
        continue;
      }
      parts.push(doclingTable(page, it.rows, pending, src === "ocr"));
      pending = [];
      wroteTable = true;
    }
    // Keep `table[data-page=N]` resolvable for quote lookups even on a text-only OCR page.
    if (!wroteTable) parts.push(`<table data-page="${page}"></table>`);
  });
  parts.push("</body></html>");
  return { html: parts.join(""), stats };
}

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const PAGE_BREAK = /^\s*-{3,}\s*$/;
const inline = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<sup>(.*?)<\/sup>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/\\\|/g, "|")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function splitPipeRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur);
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur);
  return cells.map(inline);
}

/** Markdown text copies (decks/releases the host would not let us download as PDF). */
export function markdownRendition(md: string, title: string): { html: string; pages: number; tables: number } {
  const lines = md.replace(/\r/g, "").split("\n");
  const paged = lines.some((l) => PAGE_BREAK.test(l));
  let page = 1;
  let tables = 0;
  const parts = [`<!doctype html><html><head><meta charset="utf-8"><meta name="rendition" content="markdown"><title>${esc(title)}</title>${RENDITION_STYLE}</head><body>`];
  if (paged) parts.push(`<h2 id="page-1">Page 1</h2>`);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (paged && PAGE_BREAK.test(line)) {
      page++;
      parts.push(`<h2 id="page-${page}">Page ${page}</h2>`);
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        if (!SEPARATOR.test(lines[i])) rows.push(splitPipeRow(lines[i]));
        i++;
      }
      const width = Math.max(...rows.map((r) => r.length));
      tables++;
      parts.push(
        `<table${paged ? ` data-page="${page}"` : ""} data-src="markdown">${rows.map((r) => `<tr>${[...r, ...new Array(width - r.length).fill("")].map((c) => td(c)).join("")}</tr>`).join("")}</table>`,
      );
      continue;
    }
    const text = inline(line.replace(/^#+\s*/, ""));
    if (text) parts.push(/^#/.test(line) ? `<h3>${esc(text)}</h3>` : `<p>${esc(text)}</p>`);
    i++;
  }
  parts.push("</body></html>");
  return { html: parts.join(""), pages: page, tables };
}
