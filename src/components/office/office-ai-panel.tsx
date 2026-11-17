import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, FileText, Square } from "lucide-react";
import { ResearchMarkdown } from "@/components/research/markdown";
import { Timeline } from "@/components/research/timeline";
import { BrowserStrip } from "@/components/research/browser-strip";
import { runAgent, type Turn } from "@/lib/research/loop";
import type { ToolRun } from "@/lib/research/execute";
import type { OfficeApp } from "@/lib/office/agent-tools";
import { cn } from "@/lib/utils";

type Msg = { role: "user"; text: string } | { role: "assistant"; turn: Turn };

const SUGGEST: Record<OfficeApp, string[]> = {
  writer: [
    "Write an initiation note on NVDA with a 5-year financial table",
    "Compare AAPL and MSFT margins in a two-column memo",
    "Tighten this document and fix the headings",
  ],
  sheets: [
    "Build a 5-year NVDA income statement model with growth and margins",
    "Compare revenue and net income for AAPL, MSFT, GOOGL with a chart",
    "Format this sheet like a banker model and add totals",
  ],
  slides: [
    "Build a 6-slide NVDA earnings deck with KPI cards and a revenue chart",
    "Make a peer comparison slide for AAPL, MSFT and GOOGL",
    "Tighten every slide title into an action title",
  ], pdf: [
    "Highlight every revenue, margin and guidance figure and add notes",
    "Add a one-page executive summary at the front",
    "Redact names and stamp every page CONFIDENTIAL",
  ],
};

/** OfficeAI: the research agent with the open editor's tools, docked beside the canvas. */
export function OfficeAiPanel({ app, localTool, context }: {
  app: OfficeApp;
  localTool: (name: string, args: Record<string, unknown>) => Promise<ToolRun> | null;
  context: () => string;
}) {
  const qc = useQueryClient();
  const items = useRef<Record<string, unknown>[]>([]);
  const stop = useRef(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [deep, setDeep] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  async function send(q: string) {
    if (!q.trim() || busy) return;
    setText(""); setBusy(true); stop.current = false;
    items.current.push({ role: "user", content: `${q}\n\n[Editor context — not from the user]\n${context()}` });
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", turn: { content: "", steps: [], phase: "Thinking" } }]);
    const update = (t: Turn) => {
      setMsgs((m) => [...m.slice(0, -1), { role: "assistant", turn: t }]);
      end.current?.scrollIntoView({ block: "end" });
    };
    const t = await runAgent({ qc, items: items.current, deep, stopped: () => stop.current, onUpdate: update, office: app, localTool });
    if (t.content) items.current.push({ role: "assistant", content: t.content });
    setBusy(false);
  }

  return (
    <aside className="flex h-full min-w-0 flex-col border-l bg-card" data-agent-ignore>
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-office text-office-foreground"><FileText className="h-3 w-3" /></span>
        <span className="text-xs font-semibold">OfficeAI</span>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="h-3 w-3" /> Deep
        </label>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Tell OfficeAI what to write or change. It researches SEC filings, company KPIs and the web, then edits the document for you.</p>
            {SUGGEST[app].map((s) => (
              <button key={s} onClick={() => void send(s)} className="block w-full rounded border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-office-soft">{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="ml-6 rounded-md bg-office px-2.5 py-1.5 text-xs text-office-foreground">{m.text}</div>
        ) : (
          <div key={i} className="space-y-1.5">
            {m.turn.steps.length > 0 && <Timeline steps={m.turn.steps} limit={8} />}
            {m.turn.phase && <p className="animate-pulse text-[11px] text-muted-foreground">{m.turn.phase}…</p>}
            {m.turn.content && <ResearchMarkdown className="text-xs">{m.turn.content}</ResearchMarkdown>}
            {m.turn.error && <p className="text-xs text-destructive">{m.turn.error}</p>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="@container shrink-0"><BrowserStrip /></div>
      <form className="border-t p-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <div className="flex items-end gap-1.5 rounded-md border bg-background p-1.5 focus-within:ring-1 focus-within:ring-office">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Ask OfficeAI to write, edit or research…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
            className="min-w-0 flex-1 resize-none bg-transparent px-1 text-xs outline-none" />
          <button type={busy ? "button" : "submit"} aria-label={busy ? "Stop" : "Send"} onClick={busy ? () => { stop.current = true; } : undefined}
            className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded bg-office text-office-foreground", !busy && !text.trim() && "opacity-40")}>
            {busy ? <Square className="h-3 w-3" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </form>
    </aside>
  );
}
