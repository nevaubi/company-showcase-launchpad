// Browser executor for the PDF Studio tools (agent-tools.ts) against the open PDF.
import type { ToolRun } from "@/lib/research/execute";
import { findPhrase, uid, type Annot, type AnnotType, type PdfDoc, type TextItem } from "@/lib/office/pdfdoc";

export interface PageText { w: number; h: number; items: TextItem[] }
export interface PdfHost { doc: () => PdfDoc; commit: () => Promise<void>; setTitle: (t: string) => void; text: () => Promise<PageText[]>; goTo: (page: number) => void }

const join = (it: TextItem[]) => it.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
function range(spec: unknown, n: number): number[] {
  if (!spec) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (const part of String(spec).split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    for (let i = a; i <= (b || a); i++) if (i >= 1 && i <= n) out.push(i - 1);
  }
  return out;
}

export function pdfTool(h: PdfHost) {
  const run = async (name: string, a: Record<string, unknown>): Promise<ToolRun> => {
    const d = h.doc();
    const pageAt = (n: unknown) => { const i = Number(n) - 1; const p = d.pages[i]; if (!p) throw new Error(`No page ${n} — PDF has ${d.pages.length}`); return { p, i }; };
    const done = async (summary: string, output = summary) => { await h.commit(); return { summary, output }; };
    switch (name) {
      case "pdf_read": {
        const t = await h.text(), pages = range(a.pages, d.pages.length), per = Math.max(600, Math.floor(30000 / Math.max(1, pages.length)));
        const out = pages.map((i) => {
          const pg = d.pages[i], an = d.annots.filter((x) => x.page === pg.id);
          return `--- Page ${i + 1} (${Math.round(t[i]?.w ?? 0)}×${Math.round(t[i]?.h ?? 0)}pt, ${pg.src === "gen" ? "created page" : "original"})\n${join(t[i]?.items ?? []).slice(0, per) || "(no text layer)"}` +
            (an.length ? `\nAnnotations: ${an.map((x) => `${x.id} ${x.type} @${Math.round(x.x)},${Math.round(x.y)} ${Math.round(x.w)}×${Math.round(x.h)}${x.text ? ` "${x.text.slice(0, 60)}"` : ""}`).join("; ")}` : "");
        });
        return { summary: `Read ${pages.length} of ${d.pages.length} pages`, output: `${d.pages.length} pages, ${d.annots.length} annotations\n${out.join("\n")}`.slice(0, 32000) };
      }
      case "pdf_search": {
        const t = await h.text(), q = String(a.query ?? "").toLowerCase(), hits: string[] = [];
        t.forEach((pg, i) => {
          const s = join(pg.items), l = s.toLowerCase();
          for (let k = l.indexOf(q); k >= 0 && hits.length < 60; k = l.indexOf(q, k + q.length)) hits.push(`p${i + 1}: …${s.slice(Math.max(0, k - 80), k + q.length + 80)}…`);
        });
        if (hits[0]) h.goTo(Number(hits[0].slice(1, hits[0].indexOf(":"))));
        return { summary: `${hits.length} matches for “${a.query}”`, output: hits.join("\n") || "No matches. The PDF may be scanned (no text layer) or the wording differs." };
      }
      case "pdf_mark_text": {
        const t = await h.text(), style = (a.style as AnnotType) ?? "highlight";
        const pages = a.page ? [Number(a.page) - 1] : t.map((_, i) => i);
        let count = 0, first: { i: number; box: { x: number; y: number; w: number; h: number } } | null = null;
        for (const i of pages) {
          const pg = d.pages[i]; if (!pg || !t[i]) continue;
          for (const boxes of findPhrase(t[i].items, String(a.phrase ?? ""))) {
            for (const b of boxes) d.annots.push({ id: uid(), page: pg.id, type: style, x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2, color: (a.color as string) ?? undefined });
            count++; if (!first) first = { i, box: boxes[0] };
            if (a.first_only) break;
          }
          if (a.first_only && count) break;
        }
        if (!count) return { summary: `“${String(a.phrase).slice(0, 40)}” not found`, output: "Phrase not found — use pdf_search or pdf_read to copy the exact wording (pages without a text layer can't be marked by phrase; use pdf_annotate)." };
        if (a.note && first) {
          const nx = Math.max(4, t[first.i].w - 186);
          d.annots.push({ id: uid(), page: d.pages[first.i].id, type: "note", x: nx, y: Math.max(4, first.box.y - 4), w: 180, h: 60, text: String(a.note) });
        }
        if (first) h.goTo(first.i + 1);
        return done(`${style} ×${count}: “${String(a.phrase).slice(0, 40)}”`);
      }
      case "pdf_annotate": {
        const { p, i } = pageAt(a.page);
        const an: Annot = { id: uid(), page: p.id, type: a.type as AnnotType, x: Number(a.x), y: Number(a.y), w: Number(a.w), h: Number(a.h), text: (a.text as string) ?? undefined, color: (a.color as string) ?? undefined };
        d.annots.push(an); h.goTo(i + 1);
        return done(`Added ${an.type} on page ${i + 1}`, `Annotation ${an.id} added`);
      }
      case "pdf_annotation_update": {
        const an = d.annots.find((x) => x.id === a.id); if (!an) throw new Error(`No annotation ${a.id}`);
        if (a.delete) { d.annots = d.annots.filter((x) => x !== an); return done(`Deleted annotation ${an.id}`); }
        for (const k of ["text", "color", "x", "y", "w", "h"] as const) if (a[k] != null) (an as unknown as Record<string, unknown>)[k] = a[k];
        return done(`Updated annotation ${an.id}`);
      }
      case "pdf_add_page": {
        const pos = a.position ? Math.max(0, Math.min(d.pages.length, Number(a.position) - 1)) : d.pages.length;
        // A blank new PDF starts with one empty page: fill it instead of leaving it behind.
        const empty = d.pages.length === 1 && d.pages[0].src === "gen" && !d.pages[0].title && !d.pages[0].body;
        const pg = { id: uid(), src: "gen" as const, title: String(a.title ?? ""), body: String(a.body ?? "") };
        if (empty) d.pages[0] = { ...pg, id: d.pages[0].id }; else d.pages.splice(pos, 0, pg);
        const at = empty ? 1 : pos + 1; h.goTo(at);
        return done(`Added page ${at}: ${pg.title.slice(0, 40)}`);
      }
      case "pdf_page_update": {
        const { p, i } = pageAt(a.page);
        if (p.src !== "gen") throw new Error("Only pages created with pdf_add_page can be rewritten; annotate original pages instead");
        if (a.title != null) p.title = String(a.title); if (a.body != null) p.body = String(a.body);
        h.goTo(i + 1); return done(`Rewrote page ${i + 1}`);
      }
      case "pdf_pages": {
        const { p, i } = pageAt(a.page);
        if (a.action === "delete") { if (d.pages.length < 2) throw new Error("A PDF needs one page"); d.pages.splice(i, 1); d.annots = d.annots.filter((x) => x.page !== p.id); return done(`Deleted page ${i + 1}`); }
        if (a.action === "duplicate") {
          const c = { ...p, id: uid() }; d.pages.splice(i + 1, 0, c);
          d.annots.push(...d.annots.filter((x) => x.page === p.id).map((x) => ({ ...x, id: uid(), page: c.id })));
          return done(`Duplicated page ${i + 1}`);
        }
        const to = Math.max(0, Math.min(d.pages.length - 1, Number(a.to) - 1)); d.pages.splice(i, 1); d.pages.splice(to, 0, p);
        return done(`Moved page ${i + 1} to ${to + 1}`);
      }
      case "pdf_set_title": h.setTitle(String(a.title)); return { summary: `Renamed to ${a.title}`, output: "ok" };
    }
    throw new Error(`Unknown tool ${name}`);
  };
  return (name: string, a: Record<string, unknown>): Promise<ToolRun> | null => (name.startsWith("pdf_") ? run(name, a) : null);
}
