// PDF Studio document model: page order (original pages or generated text pages) + annotations
// in PDF points from the page's top-left. buildPdf bakes everything into real PDF bytes (pdf-lib).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type PdfPage = { id: string; src: "base"; index: number } | { id: string; src: "gen"; title: string; body: string };
export type AnnotType = "highlight" | "underline" | "strike" | "note" | "text" | "rect" | "redact" | "stamp";
export interface Annot { id: string; page: string; type: AnnotType; x: number; y: number; w: number; h: number; text?: string; color?: string }
export interface PdfDoc { hasBase: boolean; pages: PdfPage[]; annots: Annot[] }

export const uid = () => Math.random().toString(36).slice(2, 9);
export const blankPdf = (): PdfDoc => {
  const id = uid();
  return { hasBase: false, pages: [{ id, src: "gen", title: "", body: "" }], annots: [] };
};
export const fromBase = (count: number): PdfDoc => ({ hasBase: true, pages: Array.from({ length: count }, (_, index) => ({ id: uid(), src: "base" as const, index })), annots: [] });

const DEF: Record<AnnotType, string> = { highlight: "#ffe14d", underline: "#d92d20", strike: "#d92d20", note: "#f5c518", text: "#111111", rect: "#d92d20", redact: "#000000", stamp: "#c0262d" };
export const annotColor = (a: Annot) => a.color && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : DEF[a.type];
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** Drop characters the standard PDF fonts cannot encode. */
function safe(font: PDFFont, s: string) {
  let o = "";
  for (const ch of s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')) {
    try { font.widthOfTextAtSize(ch, 10); o += ch; } catch { o += ch.trim() ? "?" : " "; }
  }
  return o;
}

/** Greedy word wrap using the font's real widths. */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${w}` : w;
      if (measure(t) <= width || !line) line = t; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

function drawWrapped(p: PDFPage, font: PDFFont, text: string, x: number, top: number, w: number, size: number, color: string, maxBottom: number) {
  const H = p.getHeight(); let y = top + size;
  for (const l of wrap(safe(font, text), w, (s) => font.widthOfTextAtSize(s, size))) {
    if (y > maxBottom) break;
    p.drawText(l, { x, y: H - y, size, font, color: hex(color) }); y += size * 1.3;
  }
}

function drawGen(p: PDFPage, title: string, body: string, f: PDFFont, b: PDFFont) {
  const H = p.getHeight(), W = p.getWidth(), M = 64, maxW = W - 2 * M;
  let y = M;
  const line = (s: string, font: PDFFont, size: number, indent = 0, color = "#1a1a1a") => {
    for (const l of wrap(safe(font, s), maxW - indent, (t) => font.widthOfTextAtSize(t, size))) {
      if (y + size > H - M) return;
      p.drawText(l, { x: M + indent, y: H - y - size, size, font, color: hex(color) }); y += size * 1.35;
    }
  };
  if (title) { line(title, b, 20); y += 8; p.drawLine({ start: { x: M, y: H - y }, end: { x: W - M, y: H - y }, thickness: 0.8, color: hex("#c0262d") }); y += 14; }
  for (const raw of body.split("\n")) {
    const s = raw.trimEnd();
    if (!s.trim()) { y += 6; continue; }
    if (s.startsWith("## ")) { y += 4; line(s.slice(3), b, 13, 0, "#c0262d"); y += 2; }
    else if (s.startsWith("# ")) { y += 6; line(s.slice(2), b, 15); y += 2; }
    else if (/^[-*] /.test(s)) { const y0 = y; line(s.slice(2), f, 10.5, 14); if (y > y0) p.drawText("•", { x: M + 3, y: H - y0 - 10.5, size: 10.5, font: f }); }
    else line(s, f, 10.5);
  }
}

export async function buildPdf(base: ArrayBuffer | null, doc: PdfDoc, title: string): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(title || "Untitled"); out.setProducer("Filed Under PDF Studio");
  const src = base && doc.hasBase ? await PDFDocument.load(base, { ignoreEncryption: true }) : null;
  const f = await out.embedFont(StandardFonts.Helvetica), b = await out.embedFont(StandardFonts.HelveticaBold);
  const baseIdx = doc.pages.filter((p) => p.src === "base").map((p) => (p as { index: number }).index);
  const copied = src && baseIdx.length ? await out.copyPages(src, baseIdx) : [];
  let k = 0;
  const pageOf = new Map<string, PDFPage>();
  for (const pg of doc.pages) {
    let p: PDFPage;
    if (pg.src === "base") { p = copied[k++]; if (!p) continue; out.addPage(p); }
    else { p = out.addPage([612, 792]); drawGen(p, pg.title, pg.body, f, b); }
    pageOf.set(pg.id, p);
  }
  if (!out.getPageCount()) out.addPage([612, 792]);
  for (const a of doc.annots) {
    const p = pageOf.get(a.page); if (!p) continue;
    const H = p.getHeight(), c = hex(annotColor(a)), y = H - a.y - a.h;
    switch (a.type) {
      case "highlight": p.drawRectangle({ x: a.x, y, width: a.w, height: a.h, color: c, opacity: 0.38 }); break;
      case "underline": p.drawLine({ start: { x: a.x, y: y + 0.5 }, end: { x: a.x + a.w, y: y + 0.5 }, thickness: 1.2, color: c }); break;
      case "strike": p.drawLine({ start: { x: a.x, y: y + a.h / 2 }, end: { x: a.x + a.w, y: y + a.h / 2 }, thickness: 1.2, color: c }); break;
      case "rect": p.drawRectangle({ x: a.x, y, width: a.w, height: a.h, borderColor: c, borderWidth: 1.5 }); break;
      case "redact": p.drawRectangle({ x: a.x, y, width: a.w, height: a.h, color: c }); break;
      case "note":
        p.drawRectangle({ x: a.x, y, width: a.w, height: a.h, color: hex("#fff7cc"), borderColor: c, borderWidth: 1 });
        drawWrapped(p, f, a.text ?? "", a.x + 5, a.y + 3, a.w - 10, 8.5, "#3a3000", a.y + a.h - 4); break;
      case "text": drawWrapped(p, f, a.text ?? "", a.x, a.y, a.w, 11, annotColor(a), a.y + a.h); break;
      case "stamp": {
        const t = safe(b, (a.text || "REVIEWED").toUpperCase()), size = Math.min(a.h * 0.55, 28);
        p.drawRectangle({ x: a.x, y, width: a.w, height: a.h, borderColor: c, borderWidth: 2.5, opacity: 0, borderOpacity: 0.85 });
        p.drawText(t, { x: a.x + Math.max(4, (a.w - b.widthOfTextAtSize(t, size)) / 2), y: y + (a.h - size) / 2 + size * 0.18, size, font: b, color: c, opacity: 0.85 }); break;
      }
    }
  }
  return out.save();
}

export interface TextItem { s: string; x: number; y: number; w: number; h: number }
/** Find a phrase on a page's text items (case/space-insensitive); returns one box per touched item. */
export function findPhrase(items: TextItem[], phrase: string): { x: number; y: number; w: number; h: number }[][] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const q = norm(phrase.trim()); if (!q) return [];
  let full = ""; const spans: { a: number; b: number; it: TextItem }[] = [];
  for (const it of items) { if (full && !full.endsWith(" ")) full += " "; const a = full.length; full += norm(it.s); spans.push({ a, b: full.length, it }); }
  const hits: { x: number; y: number; w: number; h: number }[][] = [];
  for (let i = full.indexOf(q); i >= 0; i = full.indexOf(q, i + q.length)) {
    const j = i + q.length, boxes = [];
    for (const { a, b, it } of spans) {
      if (b <= i || a >= j || b === a) continue;
      const s0 = (Math.max(a, i) - a) / (b - a), s1 = (Math.min(b, j) - a) / (b - a);
      boxes.push({ x: it.x + it.w * s0, y: it.y, w: Math.max(1, it.w * (s1 - s0)), h: it.h });
    }
    if (boxes.length) hits.push(boxes);
  }
  return hits;
}
