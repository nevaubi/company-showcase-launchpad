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
import { useState, type ReactNode } from "react";
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
    editorProps: { attributes: { class: "office-doc focus:outline-none min-h-[900px]" } },
  });
}

export function B({ on, title, active, children, disabled, label }: { on: () => void; title: string; active?: boolean; children: ReactNode; disabled?: boolean; label?: string }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={on} disabled={disabled}
      className={cn("inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-sm px-1 text-[11px] text-foreground/80 hover:bg-office-soft disabled:opacity-40",
        active && "bg-office-soft text-office ring-1 ring-office/30")}>
      {children}{label && <span>{label}</span>}
    </button>
  );
}
export function Group({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col justify-between border-r px-2 last:border-r-0">
      <div className="flex flex-1 flex-wrap content-center items-center gap-0.5">{children}</div>
      <span className="pb-0.5 text-center text-[10px] text-muted-foreground">{name}</span>
    </div>
  );
}
const TABS = ["Home", "Insert", "Layout"] as const;

export function WriterRibbon({ editor, settings, setSettings }: { editor: Editor; settings: WriterSettings; setSettings: (s: WriterSettings) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Home");
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
  const ic = "h-3.5 w-3.5";
  const styles = [["Normal", 0], ["Heading 1", 1], ["Heading 2", 2], ["Heading 3", 3], ["Title", 4]] as const;
  return (
    <div className="border-b bg-card" data-section="Writer ribbon">
      <div className="flex h-7 items-end gap-0.5 px-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}
            className={cn("h-6 px-3 text-[11px]", tab === t ? "border-b-2 border-office font-semibold text-office" : "text-foreground/70 hover:text-foreground")}>{t}</button>
        ))}
      </div>
      <div className="flex h-[68px] items-stretch overflow-x-auto border-t bg-background/60 py-1">
        {tab === "Home" && (<>
          <Group name="Undo">
            <B title="Undo" on={() => c().undo().run()}><Undo2 className={ic} /></B>
            <B title="Redo" on={() => c().redo().run()}><Redo2 className={ic} /></B>
          </Group>
          <Group name="Font">
            <div className="flex gap-0.5">
              <B title="Bold" active={s.bold} on={() => c().toggleBold().run()}><Bold className={ic} /></B>
              <B title="Italic" active={s.italic} on={() => c().toggleItalic().run()}><Italic className={ic} /></B>
              <B title="Underline" active={s.underline} on={() => c().toggleUnderline().run()}><Underline className={ic} /></B>
              <B title="Strikethrough" active={s.strike} on={() => c().toggleStrike().run()}><Strikethrough className={ic} /></B>
              <B title="Highlight" active={s.hl} on={() => c().toggleHighlight().run()}><Highlighter className={ic} /></B>
            </div>
          </Group>
          <Group name="Paragraph">
            <B title="Bulleted list" active={s.ul} on={() => c().toggleBulletList().run()}><List className={ic} /></B>
            <B title="Numbered list" active={s.ol} on={() => c().toggleOrderedList().run()}><ListOrdered className={ic} /></B>
            {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight], ["justify", AlignJustify]] as const).map(([a, I]) => (
              <B key={a} title={`Align ${a}`} active={s.align === a} on={() => c().setTextAlign(a).run()}><I className={ic} /></B>
            ))}
          </Group>
          <Group name="Styles">
            {styles.map(([label, l]) => (
              <button key={label} onClick={() => (l ? c().setHeading({ level: l as 1 | 2 | 3 | 4 }).run() : c().setParagraph().run())}
                className={cn("h-11 w-16 rounded-sm border bg-background px-1 text-left hover:bg-office-soft", s.level === l && "border-office ring-1 ring-office/30")}>
                <span className={cn("block truncate", l === 0 ? "text-[11px]" : l === 1 ? "text-sm font-semibold text-office" : l === 4 ? "text-base" : "text-xs font-semibold text-office")}>AaBb</span>
                <span className="block truncate text-[9px] text-muted-foreground">{label}</span>
              </button>
            ))}
          </Group>
        </>)}
        {tab === "Insert" && (<>
          <Group name="Tables">
            <B title="Insert table" label="Table" on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className={ic} /></B>
            {s.table && (<>
              <B title="Add row" label="Row" on={() => c().addRowAfter().run()}>+</B>
              <B title="Add column" label="Column" on={() => c().addColumnAfter().run()}>+</B>
              <B title="Delete row" label="Row" on={() => c().deleteRow().run()}>−</B>
              <B title="Delete column" label="Column" on={() => c().deleteColumn().run()}>−</B>
              <B title="Merge or split cells" label="Merge" on={() => c().mergeOrSplit().run()}>⊞</B>
              <B title="Delete table" label="Delete" on={() => c().deleteTable().run()}>×</B>
            </>)}
          </Group>
          <Group name="Pages">
            <B title="Page break" label="Page break" on={() => c().setHorizontalRule().run()}><Minus className={ic} /></B>
          </Group>
          <Group name="Links">
            <B title="Link" label="Link" on={() => { const u = prompt("Link URL"); if (u) c().setLink({ href: u }).run(); else c().unsetLink().run(); }}><Link2 className={ic} /></B>
          </Group>
          <Group name="Header & footer">
            <B title="Page numbers" label="Page numbers" active={settings.pageNumbers} on={() => setSettings({ ...settings, pageNumbers: !settings.pageNumbers })}>#</B>
          </Group>
        </>)}
        {tab === "Layout" && (<>
          <Group name="Page setup">
            <B title="One column" label="One" active={settings.columns === 1} on={() => setSettings({ ...settings, columns: 1 })}><AlignJustify className={ic} /></B>
            <B title="Two columns" label="Two" active={settings.columns === 2} on={() => setSettings({ ...settings, columns: 2 })}><Columns2 className={ic} /></B>
          </Group>
        </>)}
      </div>
    </div>
  );
}

export function WriterPage({ editor, settings, setSettings }: { editor: Editor; settings: WriterSettings; setSettings: (s: WriterSettings) => void }) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted py-6">
      <div className="office-paper mx-auto w-[816px] max-w-full bg-background text-foreground shadow-md ring-1 ring-border" style={{ minHeight: 1056 }}>
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
