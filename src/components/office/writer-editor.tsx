import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Columns2, Highlighter, Italic, Link2, List, ListOrdered,
  Minus, Redo2, Strikethrough, Table as TableIcon, Underline, Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { JNode, WriterSettings } from "@/lib/office/writer-docx";

export function useWriter(initial: JNode | string | null, onChange: () => void) {
  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false, autolink: true } }),
      Highlight, TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
    ],
    content: initial ?? "",
    onUpdate: onChange,
    editorProps: { attributes: { class: "prose prose-sm max-w-none focus:outline-none min-h-[900px]" } },
  });
}

function B({ on, title, active, children, disabled }: { on: () => void; title: string; active?: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={on} disabled={disabled}
      className={cn("inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs hover:bg-accent disabled:opacity-40", active && "bg-accent text-foreground")}>
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px bg-border" />;

export function WriterRibbon({ editor, settings, setSettings }: { editor: Editor; settings: WriterSettings; setSettings: (s: WriterSettings) => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      hl: e.isActive("highlight"), ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), table: e.isActive("table"),
      level: ([1, 2, 3, 4].find((l) => e.isActive("heading", { level: l })) ?? 0) as number,
      align: (["center", "right", "justify"].find((a) => e.isActive({ textAlign: a })) ?? "left") as string,
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-card px-2 py-1" data-section="Writer ribbon">
      <B title="Undo" on={() => c().undo().run()}><Undo2 className="h-3.5 w-3.5" /></B>
      <B title="Redo" on={() => c().redo().run()}><Redo2 className="h-3.5 w-3.5" /></B>
      <Sep />
      <select aria-label="Paragraph style" value={s.level} className="h-7 rounded border bg-background px-1 text-xs"
        onChange={(e) => { const l = Number(e.target.value); if (l) c().setHeading({ level: l as 1 | 2 | 3 | 4 }).run(); else c().setParagraph().run(); }}>
        <option value={0}>Normal</option><option value={1}>Heading 1</option><option value={2}>Heading 2</option>
        <option value={3}>Heading 3</option><option value={4}>Heading 4</option>
      </select>
      <Sep />
      <B title="Bold" active={s.bold} on={() => c().toggleBold().run()}><Bold className="h-3.5 w-3.5" /></B>
      <B title="Italic" active={s.italic} on={() => c().toggleItalic().run()}><Italic className="h-3.5 w-3.5" /></B>
      <B title="Underline" active={s.underline} on={() => c().toggleUnderline().run()}><Underline className="h-3.5 w-3.5" /></B>
      <B title="Strikethrough" active={s.strike} on={() => c().toggleStrike().run()}><Strikethrough className="h-3.5 w-3.5" /></B>
      <B title="Highlight" active={s.hl} on={() => c().toggleHighlight().run()}><Highlighter className="h-3.5 w-3.5" /></B>
      <B title="Link" on={() => { const u = prompt("Link URL"); if (u) c().setLink({ href: u }).run(); else c().unsetLink().run(); }}><Link2 className="h-3.5 w-3.5" /></B>
      <Sep />
      {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight], ["justify", AlignJustify]] as const).map(([a, I]) => (
        <B key={a} title={`Align ${a}`} active={s.align === a} on={() => c().setTextAlign(a).run()}><I className="h-3.5 w-3.5" /></B>
      ))}
      <Sep />
      <B title="Bulleted list" active={s.ul} on={() => c().toggleBulletList().run()}><List className="h-3.5 w-3.5" /></B>
      <B title="Numbered list" active={s.ol} on={() => c().toggleOrderedList().run()}><ListOrdered className="h-3.5 w-3.5" /></B>
      <Sep />
      <B title="Insert table" on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-3.5 w-3.5" /></B>
      {s.table && (<>
        <B title="Add row" on={() => c().addRowAfter().run()}>+Row</B>
        <B title="Add column" on={() => c().addColumnAfter().run()}>+Col</B>
        <B title="Delete row" on={() => c().deleteRow().run()}>−Row</B>
        <B title="Delete column" on={() => c().deleteColumn().run()}>−Col</B>
        <B title="Merge or split cells" on={() => c().mergeOrSplit().run()}>Merge</B>
        <B title="Delete table" on={() => c().deleteTable().run()}>×Table</B>
      </>)}
      <B title="Page break" on={() => c().setHorizontalRule().run()}><Minus className="h-3.5 w-3.5" /></B>
      <Sep />
      <B title="Two columns" active={settings.columns === 2} on={() => setSettings({ ...settings, columns: settings.columns === 2 ? 1 : 2 })}><Columns2 className="h-3.5 w-3.5" /></B>
      <B title="Page numbers" active={settings.pageNumbers} on={() => setSettings({ ...settings, pageNumbers: !settings.pageNumbers })}>#</B>
    </div>
  );
}

export function WriterPage({ editor, settings, setSettings }: { editor: Editor; settings: WriterSettings; setSettings: (s: WriterSettings) => void }) {
  return (
    <div className="min-w-0 overflow-x-auto bg-muted/40 py-6">
      <div className="mx-auto w-[816px] max-w-full bg-background shadow-sm ring-1 ring-border" style={{ minHeight: 1056 }}>
        <input aria-label="Header" placeholder="Header" value={settings.header} onChange={(e) => setSettings({ ...settings, header: e.target.value })}
          className="w-full border-b border-dashed border-transparent bg-transparent px-24 pt-8 pb-2 text-right text-xs text-muted-foreground outline-none hover:border-border focus:border-border" />
        <div className={cn("px-24 py-6 [&_hr]:my-8 [&_hr]:border-dashed", settings.columns === 2 && "[&_.ProseMirror]:columns-2 [&_.ProseMirror]:gap-8")}>
          <EditorContent editor={editor} />
        </div>
        <div className="flex items-center gap-2 px-24 pt-2 pb-8 text-xs text-muted-foreground">
          <input aria-label="Footer" placeholder="Footer" value={settings.footer} onChange={(e) => setSettings({ ...settings, footer: e.target.value })}
            className="min-w-0 flex-1 bg-transparent outline-none" />
          {settings.pageNumbers && <span>Page 1</span>}
        </div>
      </div>
    </div>
  );
}
