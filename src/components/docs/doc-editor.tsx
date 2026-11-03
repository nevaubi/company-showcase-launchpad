import { useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bold,
  Globe,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Sparkles,
  Table as TableIcon,
  Undo2,
  Redo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { companyQuery } from "@/lib/data";
import { docAssist } from "@/lib/docs.functions";
import { fundamentalsDigest } from "@/lib/financials/summary";
import type { StatementKey } from "@/lib/financials/types";
import { fmtCell, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "continue" | "summarize" | "rewrite" | "draft" | "critique";

export function DocEditor({ initialHtml, title, ticker, onChange }: { initialHtml: string; title: string; ticker: string | null; onChange: (html: string) => void }) {
  const qc = useQueryClient();
  const [aiBusy, setAiBusy] = useState<Mode | null>(null);
  const [prompt, setPrompt] = useState("");
  const [useWeb, setUseWeb] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true, autolink: true } }),
      Highlight,
      Typography,
      Placeholder.configure({ placeholder: "Start writing — or ask the assistant to draft a section…" }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml || "",
    editorProps: { attributes: { class: "prose-filing doc-surface min-h-[60vh] outline-none" } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  const run = async (mode: Mode) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selection = editor.state.doc.textBetween(from, to, "\n");
    if ((mode === "summarize" || mode === "rewrite") && !selection.trim()) return void toast.error("Select some text first");
    if (mode === "draft" && !prompt.trim()) return void toast.error("Describe the section to draft");
    setAiBusy(mode);
    try {
      let fundamentals = "";
      const t = ticker ?? COVERAGE.find((c) => new RegExp(`\\b${c.ticker}\\b`).test(`${title} ${prompt}`))?.ticker;
      if (t && coverageOf(t)) fundamentals = fundamentalsDigest(await qc.fetchQuery(companyQuery(t)), 6).slice(0, 6000);
      const { html } = await docAssist({
        data: { mode, instruction: prompt, selection, document: editor.getText().slice(-30000), title, fundamentals, useWeb },
      });
      if (!html) throw new Error("The assistant returned nothing");
      if (mode === "rewrite" || mode === "summarize") editor.chain().focus().insertContentAt({ from, to }, html).run();
      else if (mode === "critique") editor.chain().focus("end").insertContent(`<blockquote><p><strong>Editor's critique</strong></p>${html}</blockquote>`).run();
      else editor.chain().focus(mode === "continue" ? "end" : undefined).insertContent(html).run();
      setPrompt("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-12 z-10 flex flex-wrap items-center gap-0.5 border-b bg-card/95 px-3 py-1.5 backdrop-blur">
        <Tool editor={editor} label="Heading" icon={<Heading2 />} active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Tool editor={editor} label="Subheading" icon={<Heading3 />} active={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
        <Tool editor={editor} label="Bold" icon={<Bold />} active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} />
        <Tool editor={editor} label="Italic" icon={<Italic />} active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} />
        <Tool editor={editor} label="Highlight" icon={<Highlighter />} active={editor?.isActive("highlight")} onClick={() => editor?.chain().focus().toggleHighlight().run()} />
        <span className="mx-1 h-5 w-px bg-border" />
        <Tool editor={editor} label="Bullets" icon={<List />} active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        <Tool editor={editor} label="Numbered" icon={<ListOrdered />} active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
        <Tool editor={editor} label="Quote" icon={<Quote />} active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
        <Tool editor={editor} label="Insert data table" icon={<TableIcon />} onClick={() => setTableOpen(true)} />
        <span className="mx-1 h-5 w-px bg-border" />
        <Tool editor={editor} label="Undo" icon={<Undo2 />} onClick={() => editor?.chain().focus().undo().run()} />
        <Tool editor={editor} label="Redo" icon={<Redo2 />} onClick={() => editor?.chain().focus().redo().run()} />
      </div>

      <div className="grid grid-cols-1 min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="bg-paper/40 px-4 py-8">
          <div className="mx-auto max-w-3xl rounded-lg border bg-card px-10 py-10 shadow-paper">
            <EditorContent editor={editor} />
          </div>
        </div>
        <aside className="border-l bg-card p-4">
          <p className="eyebrow flex items-center gap-1.5">
            <Sparkles className="size-3" /> Writing assistant
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ticker ? `Grounded in ${ticker}'s latest six quarters of SEC data.` : "Mention a covered ticker in your request to ground it in SEC data."}
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Draft a 'Margin outlook' section comparing the last four quarters"
            className="mt-3 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-rule"
            maxLength={1500}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={useWeb} onChange={(e) => setUseWeb(e.target.checked)} />
            <Globe className="size-3" /> Allow web search
          </label>
          <div className="mt-3 grid gap-1.5">
            {(
              [
                ["draft", "Draft section"],
                ["continue", "Continue writing"],
                ["rewrite", "Tighten selection"],
                ["summarize", "Summarize selection"],
                ["critique", "Critique the argument"],
              ] as [Mode, string][]
            ).map(([m, l]) => (
              <Button key={m} variant={m === "draft" ? "ink" : "outline"} size="sm" className="justify-start" disabled={!!aiBusy} onClick={() => run(m)}>
                {aiBusy === m ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {l}
              </Button>
            ))}
          </div>
        </aside>
      </div>
      <DataTableDialog open={tableOpen} onOpenChange={setTableOpen} editor={editor} defaultTicker={ticker ?? "AAPL"} />
    </div>
  );
}

function Tool({ editor, icon, label, active, onClick }: { editor: Editor | null; icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" disabled={!editor} onClick={onClick} aria-label={label} title={label} className={cn(active && "bg-secondary text-foreground")}>
      {icon}
    </Button>
  );
}

const PRESETS: Record<string, { statement: StatementKey; metrics: string[] }> = {
  "Income summary": { statement: "income", metrics: ["revenue", "grossProfit", "operatingIncome", "netIncome", "epsDiluted"] },
  Margins: { statement: "kpis", metrics: ["revenueGrowth", "grossMargin", "operatingMargin", "netMargin", "fcfMargin"] },
  "Cash flow": { statement: "cashflow", metrics: ["cfo", "capex", "fcf", "buybacks", "dividends"] },
  "Balance sheet": { statement: "balance", metrics: ["cash", "totalAssets", "longTermDebt", "totalLiabilities", "equity"] },
};

function DataTableDialog({ open, onOpenChange, editor, defaultTicker }: { open: boolean; onOpenChange: (o: boolean) => void; editor: Editor | null; defaultTicker: string }) {
  const qc = useQueryClient();
  const [ticker, setTicker] = useState(defaultTicker);
  const [preset, setPreset] = useState("Income summary");
  const [freq, setFreq] = useState<"annual" | "quarterly">("quarterly");
  const [n, setN] = useState(4);
  const [busy, setBusy] = useState(false);

  const insert = async () => {
    if (!editor) return;
    setBusy(true);
    try {
      const d = await qc.fetchQuery(companyQuery(ticker));
      const p = PRESETS[preset];
      const st = d.statements[freq][p.statement];
      const start = Math.max(0, st.periods.length - n);
      const periods = st.periods.slice(start);
      const rows = p.metrics.map((k) => st.rows.find((r) => r.key === k)).filter(Boolean);
      const accns = new Set<string>();
      const body = rows
        .map((r) => `<tr><td>${r!.label}</td>${r!.cells.slice(start).map((c) => (c?.src && accns.add(c.src.accn), `<td>${c ? fmtCell(c.v, r!.unit, "M") : "—"}</td>`)).join("")}</tr>`)
        .join("");
      const filings = d.filings.filter((f) => accns.has(f.accn)).slice(0, 4);
      const html = `<table><tbody><tr><th>${ticker} · ${preset}${p.statement === "kpis" ? "" : " ($M)"}</th>${periods.map((x) => `<th>${x.label}</th>`).join("")}</tr>${body}</tbody></table><p><em>Source: ${filings.map((f) => `${f.form} filed ${fmtDate(f.filed)} (${f.accn})`).join("; ")}. Values from XBRL company facts via Filed Under.</em></p>`;
      editor.chain().focus().insertContent(html).run();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert a data table</DialogTitle>
          <DialogDescription>Reported values straight from the filings, with the source accession numbers noted below the table.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Company</Label>
            <Select value={ticker} onValueChange={setTicker}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COVERAGE.map((c) => (
                  <SelectItem key={c.ticker} value={c.ticker}>
                    {c.ticker} · {c.shortName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Table</Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(PRESETS).map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Frequency</Label>
            <Select value={freq} onValueChange={(v) => setFreq(v as typeof freq)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np">Periods</Label>
            <Input id="np" type="number" min={1} max={10} value={n} onChange={(e) => setN(Math.max(1, Math.min(10, Number(e.target.value) || 4)))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="ink" onClick={insert} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
