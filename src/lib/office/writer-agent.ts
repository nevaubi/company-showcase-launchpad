// Browser executor for the Writer tools (agent-tools.ts) against a live Tiptap editor.
import type { Editor } from "@tiptap/react";
import type { ToolRun } from "@/lib/research/execute";
import type { WriterSettings } from "@/lib/office/writer-docx";

type Node = { type: { name: string }; textContent: string; nodeSize: number; attrs: Record<string, unknown>; forEach: (f: (c: Node) => void) => void };

function blocks(ed: Editor) {
  const out: { pos: number; node: Node }[] = [];
  ed.state.doc.forEach((node, pos) => out.push({ pos, node: node as unknown as Node }));
  return out;
}
function describe(n: Node) {
  const t = n.type.name;
  if (t === "heading") return `H${n.attrs.level}: ${n.textContent}`;
  if (t === "table") {
    const rows: string[] = [];
    n.forEach((r) => { const cells: string[] = []; r.forEach((c) => cells.push(c.textContent)); rows.push(cells.join(" | ")); });
    return `table:\n    ${rows.join("\n    ")}`;
  }
  if (t === "horizontalRule") return "page break";
  return `${t}: ${n.textContent}`;
}
const clean = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");

export function writerTool(ed: Editor, page: { settings: WriterSettings; setSettings: (s: WriterSettings) => void; setTitle: (t: string) => void }) {
  return (name: string, a: Record<string, unknown>): Promise<ToolRun> | null => {
    if (!name.startsWith("doc_")) return null;
    const ok = (summary: string, output = summary) => Promise.resolve({ summary, output });
    const bs = blocks(ed);
    const range = (from: number, to: number) => {
      const f = bs[Math.max(0, from)], l = bs[Math.min(bs.length - 1, to)];
      if (!f || !l) throw new Error(`No blocks ${from}..${to} (document has ${bs.length})`);
      return { from: f.pos, to: l.pos + l.node.nodeSize };
    };
    switch (name) {
      case "doc_read": {
        const lines = bs.map((b, i) => `[${i}] ${describe(b.node)}`.slice(0, 1500));
        return ok(`Read ${bs.length} blocks`, lines.length ? `${lines.join("\n")}\n\nPage: ${JSON.stringify(page.settings)}` : "(empty document)");
      }
      case "doc_insert": {
        const html = clean(String(a.html));
        const pos = a.position as string;
        const i = Number(a.index ?? 0);
        let at: number;
        if (pos === "cursor") at = ed.state.selection.to;
        else if (pos === "start") at = 0;
        else if (pos === "before") at = bs[i]?.pos ?? 0;
        else if (pos === "after") at = bs[i] ? bs[i].pos + bs[i].node.nodeSize : ed.state.doc.content.size;
        else at = ed.state.doc.content.size;
        const empty = bs.length === 1 && !bs[0].node.textContent && bs[0].node.type.name === "paragraph";
        if (empty) ed.commands.setContent(html, { emitUpdate: true });
        else ed.chain().insertContentAt(at, html).run();
        ed.commands.scrollIntoView();
        return ok("Inserted content");
      }
      case "doc_replace_blocks": {
        ed.chain().insertContentAt(range(Number(a.from), Number(a.to)), clean(String(a.html))).run();
        return ok(`Rewrote blocks ${a.from}–${a.to}`);
      }
      case "doc_delete_blocks": {
        ed.chain().deleteRange(range(Number(a.from), Number(a.to))).run();
        return ok(`Deleted blocks ${a.from}–${a.to}`);
      }
      case "doc_find_replace": {
        const find = String(a.find); let count = 0;
        const hits: { from: number; to: number }[] = [];
        ed.state.doc.descendants((n, p) => {
          if (!n.isText || !n.text) return true;
          let k = n.text.indexOf(find);
          while (k >= 0) { hits.push({ from: p + k, to: p + k + find.length }); if (!a.all) return false; k = n.text.indexOf(find, k + find.length); }
          return true;
        });
        for (const h of (a.all ? hits : hits.slice(0, 1)).reverse()) { ed.chain().insertContentAt(h, String(a.replace)).run(); count++; }
        return ok(`Replaced ${count} match${count === 1 ? "" : "es"}`);
      }
      case "doc_format_blocks": {
        const r = range(Number(a.from), Number(a.to));
        const c = ed.chain().setTextSelection(r);
        const st = a.style as string | null;
        if (st === "paragraph") c.setParagraph();
        else if (st && st.startsWith("h")) c.setHeading({ level: Number(st[1]) as 1 | 2 | 3 | 4 });
        else if (st === "bullet_list") c.toggleBulletList();
        else if (st === "numbered_list") c.toggleOrderedList();
        if (a.align) c.setTextAlign(String(a.align));
        for (const m of (a.marks as string[] | null) ?? []) c.setMark(m);
        c.run();
        return ok(`Formatted blocks ${a.from}–${a.to}`);
      }
      case "doc_page_setup": {
        const s = { ...page.settings };
        if (a.header != null) s.header = String(a.header);
        if (a.footer != null) s.footer = String(a.footer);
        if (a.page_numbers != null) s.pageNumbers = Boolean(a.page_numbers);
        if (a.columns != null) s.columns = Number(a.columns) === 2 ? 2 : 1;
        page.setSettings(s);
        return ok("Updated page setup");
      }
      case "doc_set_title":
        page.setTitle(String(a.title));
        return ok(`Renamed to “${a.title}”`);
    }
    return null;
  };
}
