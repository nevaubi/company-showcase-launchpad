import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";
import type { IrDocRow } from "@/lib/ir.functions";

/**
 * The Filed Under pipeline's IR document store (about 162k releases, decks, supplements and transcripts collected
 * from EDGAR exhibits and company IR sites). The index is ir/{T}.json; originals and extracted text are served as
 * short-lived signed URLs (irstore/<object path>) so large files download straight from storage.
 */
export interface StoreDoc {
  id: string;
  ticker: string;
  url: string;
  title: string | null;
  doc_type: string | null;
  fiscal_label: string | null;
  period_end: string | null;
  published: string | null;
  ext: string | null;
  bytes: number | null;
  storage_path: string | null;
  text_path: string | null;
  pages: number | null;
  fetched_at: string | null;
  extraction?: { status?: string } | null;
}

export interface StoreIndex {
  ticker: string;
  generated: string;
  documents: StoreDoc[];
}

export const storeIndexQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["ir-store", ticker],
    queryFn: () => partnerFile<StoreIndex>(`ir/${ticker}.json`),
    staleTime: 30 * 60_000,
    retry: false,
  });

const KIND: Record<string, string> = {
  release: "press-release",
  presentation: "presentation",
  supplement: "supplement",
  transcript: "transcript",
  annual_report: "annual-report",
  remarks: "report",
  other: "other",
};

export const STORE_PREFIX = "store:";

/** Library row for a store document (id prefixed so it never collides with the app's own rows). */
export function storeRow(d: StoreDoc): IrDocRow {
  return {
    id: `${STORE_PREFIX}${d.id}`,
    source: "store",
    source_url: d.url,
    accn: /\/(\d{18})\//.exec(d.url)?.[1]?.replace(/^(\d{10})(\d{2})(\d{6})$/, "$1-$2-$3") ?? null,
    exhibit: null,
    kind: KIND[d.doc_type ?? "other"] ?? "other",
    title: (d.title ?? "")
      .split("||")[0]
      .replace(/, opens in new window/gi, "")
      .trim(),
    period: d.period_end,
    filed: d.published ?? d.fetched_at?.slice(0, 10) ?? null,
    ext: (d.ext ?? "").replace(/^\./, "") || null,
    bytes: d.bytes,
    extract_status: d.text_path ? "text" : null,
    extract_facts: null,
    pages: d.pages,
    // With page text the stored copy opens in the source panel; without it only the original can be opened.
    viewable: !!d.text_path,
  };
}

/** Store rows not already in the app's library (same source URL). */
export function mergeStore(app: IrDocRow[], store: StoreDoc[]): IrDocRow[] {
  const seen = new Set(app.map((d) => d.source_url).filter(Boolean));
  return store.filter((d) => d.storage_path && !seen.has(d.url)).map(storeRow);
}

export async function storeUrl(objectPath: string): Promise<string> {
  const { url } = await partnerFile<{ url: string }>(`irstore/${objectPath}`);
  return url;
}

/** Extracted page texts of one stored document. */
export async function storeText(d: Pick<StoreDoc, "text_path">): Promise<string[]> {
  if (!d.text_path) throw new Error("This document has no extracted text yet");
  const res = await fetch(await storeUrl(d.text_path), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Text unavailable (${res.status})`);
  const j = (await res.json()) as { pages?: unknown[] };
  return (j.pages ?? []).map((p) => (typeof p === "string" ? p : JSON.stringify(p)));
}

/** Passages around each match of a phrase (case-insensitive), with page numbers. */
export function passages(pages: string[], query: string, radius = 600, max = 8) {
  const q = query.trim().toLowerCase();
  const out: { page: number; text: string }[] = [];
  if (!q) return out;
  for (let i = 0; i < pages.length && out.length < max; i++) {
    const low = pages[i].toLowerCase();
    let at = low.indexOf(q);
    while (at >= 0 && out.length < max) {
      out.push({
        page: i + 1,
        text: pages[i].slice(Math.max(0, at - radius), at + q.length + radius),
      });
      at = low.indexOf(q, at + q.length + radius);
    }
  }
  return out;
}

/** What the source viewer needs to show a stored document: its page text, or its stored HTML original. */
export interface StoreRef {
  /** Object path of the extracted text (pages or worksheets) */
  text?: string | null;
  /** Object path of the original file */
  original?: string | null;
  ext?: string | null;
}

export interface StoreTextFile {
  kind?: string;
  pages?: unknown[];
  sheets?: Record<string, unknown[][]>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isNum = (s: string) => /^[($-]*\$?\s*[\d,]+(\.\d+)?\)?%?$/.test(s.trim());
const RENDITION_STYLE =
  "<style>body{font:12.5px/1.5 -apple-system,Segoe UI,sans-serif;color:#111}" +
  "h2{font-size:11.5px;font-weight:600;color:#666;margin:26px 0 8px;padding-top:10px;border-top:1px solid #d4d4d4}h2:first-of-type{margin-top:0;padding-top:0;border-top:0}" +
  "table{border-collapse:collapse}table[data-page]{width:100%}table[data-page] td{padding:1px 4px;white-space:pre-wrap;overflow-wrap:anywhere}" +
  "table[data-sheet] td{border:1px solid #e3e3e3;padding:2px 6px;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}" +
  "p.note{color:#666;font-size:11.5px;margin:6px 0}</style>";
export const SHEET_MAX_ROWS = 2000;
export const SHEET_MAX_COLS = 60;

/**
 * A stored document's extracted text as HTML the source viewer can search and highlight, in the same shape as the
 * app's own renditions: a PDF or deck becomes one table per page (`#page-N`, `table[data-page]`, a row per printed
 * line) and a workbook one table per worksheet (`table[data-sheet]`). Text is escaped; nothing from the file runs.
 */
export function renditionHtml(file: StoreTextFile, title: string): { html: string; pages: number } {
  const parts = [`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${RENDITION_STYLE}</head><body>`];
  let pages = 0;
  if (file.sheets && typeof file.sheets === "object") {
    for (const [name, rows] of Object.entries(file.sheets)) {
      if (!Array.isArray(rows)) continue;
      pages++;
      parts.push(`<h2>Sheet: ${esc(name)}</h2>`);
      if (rows.length > SHEET_MAX_ROWS) parts.push(`<p class="note">Showing the first ${SHEET_MAX_ROWS.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows. The original file has the rest.</p>`);
      parts.push(`<table data-sheet="${esc(name)}">`);
      for (const row of rows.slice(0, SHEET_MAX_ROWS)) {
        const cells = (Array.isArray(row) ? row : []).slice(0, SHEET_MAX_COLS).map((v) => {
          const t = v == null ? "" : String(v).trim();
          return `<td${isNum(t) ? ' class="n"' : ""}>${esc(t)}</td>`;
        });
        parts.push(`<tr>${cells.join("")}</tr>`);
      }
      parts.push("</table>");
    }
  } else {
    for (const [i, p] of (file.pages ?? []).entries()) {
      pages++;
      const text = typeof p === "string" ? p : p == null ? "" : JSON.stringify(p);
      const lines = text.split("\n").filter((l) => l.trim());
      parts.push(`<h2 id="page-${i + 1}">Page ${i + 1}</h2>`);
      if (!lines.length) parts.push(`<p class="note">No text on this page (a chart or a scanned page).</p>`);
      parts.push(`<table data-page="${i + 1}">${lines.map((l) => `<tr><td>${esc(l)}</td></tr>`).join("")}</table>`);
    }
  }
  if (!pages) parts.push(`<p class="note">No text was read from this document. Open the original file.</p>`);
  parts.push("</body></html>");
  return { html: parts.join(""), pages };
}

/** HTML of a stored document for the source viewer: built from its page text, or the stored HTML original. */
export async function storeHtml(ref: StoreRef, title: string): Promise<string> {
  const path = ref.text || ref.original;
  if (!path) throw new Error("This document has no in-app copy; open the original");
  const res = await fetch(await storeUrl(path), { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`The stored copy could not be read (${res.status})`);
  if (!ref.text) return await res.text();
  return renditionHtml((await res.json()) as StoreTextFile, title).html;
}
