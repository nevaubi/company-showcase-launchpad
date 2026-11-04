import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, ChevronDown, Code2, Compass, Globe, Loader2, MessageSquarePlus, Sparkles, Square, TriangleAlert, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { ResearchMarkdown } from "@/components/research/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { titleSession } from "@/lib/research.functions";
import { runAgent, type Step } from "@/lib/research/loop";
import { TOOL_LABELS } from "@/lib/research/tool-defs";
import { currentUserId } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const ASSISTANT_WIDTH = "420px";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: Step[];
  pending?: boolean;
  error?: string;
}

function suggestionsFor(path: string): string[] {
  const t = path.match(/\/app\/companies\/([A-Z.]+)/)?.[1];
  if (t)
    return [`Summarize what matters on this page for ${t}`, `Build a quick DCF for ${t} with bear/base/bull cases`, `Who are ${t}'s most important suppliers and customers, and what if its top customer cut spend 30%?`];
  if (path.includes("supply-chain")) return ["Explain the biggest risks on this map", "Which covered companies are most exposed to TSMC?", "Simulate a 25% drop in Apple demand"];
  return ["Screen for companies with >20% revenue growth and >25% FCF margins", "Which semis have the highest R&D intensity? Show me a chart page", "Open NVIDIA's valuation page and explain where its P/E sits"];
}

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const stop = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    stop.current = false;
    setInput("");
    const userId = await currentUserId().catch(() => null);
    if (!userId) {
      toast.error("Sign in to use the assistant");
      return setBusy(false);
    }
    let session = sid;
    try {
      if (!session) {
        const { data, error } = await supabase.from("research_sessions").insert({ user_id: userId, title: q.slice(0, 60) }).select("id").single();
        if (error) throw error;
        session = data.id;
        setSid(session);
        titleSession({ data: { question: q } })
          .then((title) => supabase.from("research_sessions").update({ title }).eq("id", session!))
          .then(() => qc.invalidateQueries({ queryKey: ["research-sessions"] }))
          .catch(() => {});
      }
      await supabase.from("research_messages").insert({ session_id: session, user_id: userId, role: "user", content: q });
    } catch (e) {
      toast.error((e as Error).message);
      return setBusy(false);
    }

    const history = msgs.filter((m) => !m.pending);
    const now = Date.now();
    const asstId = `a-${now}`;
    setMsgs([...history, { id: `u-${now}`, role: "user", content: q, steps: [] }, { id: asstId, role: "assistant", content: "", steps: [], pending: true }]);
    const items: Record<string, unknown>[] = [
      ...history.slice(-12).map((m) => ({ role: m.role, content: m.content || "(no answer)" })),
      { role: "user", content: `[User is viewing ${window.location.pathname}${window.location.search} — call get_page_context if the question refers to it]\n${q}` },
    ];
    const turn = await runAgent({
      qc,
      items,
      deep,
      ctx: { navigate: (href) => navigate({ href }) },
      stopped: () => stop.current,
      onUpdate: (t) => setMsgs((ms) => ms.map((m) => (m.id === asstId ? { ...m, ...t } : m))),
    });
    setMsgs((ms) => ms.map((m) => (m.id === asstId ? { ...m, ...turn, pending: false } : m)));
    await supabase.from("research_messages").insert({
      session_id: session,
      user_id: userId,
      role: "assistant",
      content: turn.error ? `${turn.content}\n\n> Error: ${turn.error}` : turn.content,
      steps: turn.steps as never,
    });
    await supabase.from("research_sessions").update({ updated_at: new Date().toISOString() }).eq("id", session!);
    qc.invalidateQueries({ queryKey: ["research-sessions"] });
    setBusy(false);
  }

  return (
    <aside
      aria-hidden={!open}
      aria-label="AI assistant"
      style={{ width: ASSISTANT_WIDTH }}
      className={cn(
        "fixed inset-y-0 right-0 z-30 flex max-w-full flex-col border-l border-rule bg-background transition-transform duration-300",
        open ? "translate-x-0 shadow-panel" : "pointer-events-none invisible translate-x-full",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="size-4" />
        <p className="text-sm font-medium">Assistant</p>
        <span className="truncate text-[11px] text-muted-foreground">· sees {path.replace("/app", "") || "/dashboard"}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => { setMsgs([]); setSid(null); }} aria-label="New chat">
            <MessageSquarePlus />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
            <X />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
        {!msgs.length ? (
          <div>
            <p className="font-display text-2xl leading-tight">Ask, calculate, or have it take you there.</p>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex gap-2"><Compass className="size-3.5 shrink-0" /> Opens pages and reads what you're looking at</li>
              <li className="flex gap-2"><Code2 className="size-3.5 shrink-0" /> Runs code on the SEC data for models and screens</li>
              <li className="flex gap-2"><Globe className="size-3.5 shrink-0" /> Researches filings, calls and the web in loops, with citations</li>
            </ul>
            <div className="mt-5 grid grid-cols-1 gap-2">
              {suggestionsFor(path).map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-lg border bg-card p-2.5 text-left text-[12.5px] leading-snug shadow-paper hover:bg-secondary/60">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {msgs.map((m) =>
              m.role === "user" ? (
                <p key={m.id} className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-3 py-2 text-[13px] text-ink-foreground">
                  {m.content}
                </p>
              ) : (
                <AssistantTurn key={m.id} m={m} />
              ),
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 border-t p-2.5">
        <form
          className="flex items-end gap-1.5 rounded-xl border bg-card p-1.5 focus-within:border-rule"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            maxLength={2000}
            disabled={busy}
            placeholder="Ask anything, or “take me to…”"
            className="max-h-32 min-h-9 resize-none border-0 bg-transparent text-[13px] shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={() => setDeep((d) => !d)}
            className={cn("shrink-0 rounded-md border px-1.5 py-1 text-[10.5px]", deep ? "border-foreground bg-ink text-ink-foreground" : "text-muted-foreground")}
            title="Deep research: more loops, more cross-checking"
          >
            {deep ? "Deep" : "Fast"}
          </button>
          {busy ? (
            <Button type="button" size="icon-sm" variant="outline" onClick={() => (stop.current = true)} aria-label="Stop">
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" variant="ink" disabled={!input.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </form>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          Saved to your <Link to="/app/research" className="underline">research history</Link>. Not investment advice.
        </p>
      </div>
    </aside>
  );
}

function AssistantTurn({ m }: { m: Msg }) {
  const [open, setOpen] = useState(false);
  const steps = m.steps.filter((s) => s.name !== "sources");
  const showSteps = open || m.pending;
  return (
    <div className="grid grid-cols-1 gap-2">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        {m.pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        {m.pending ? "Working" : "Done"} · {steps.length} step{steps.length === 1 ? "" : "s"}
        <ChevronDown className={cn("size-3 transition-transform", showSteps && "rotate-180")} />
      </button>
      {showSteps && steps.length > 0 && (
        <ol className="ml-1.5 grid grid-cols-1 gap-0.5 border-l pl-3">
          {steps.map((s, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1.5 text-[11px]">
              {s.status === "running" ? <Loader2 className="size-3 shrink-0 animate-spin" /> : s.status === "error" ? <TriangleAlert className="size-3 shrink-0 text-negative" /> : s.name === "run_code" ? <Code2 className="size-3 shrink-0" /> : s.name === "navigate_to" ? <Compass className="size-3 shrink-0" /> : s.kind === "web" ? <Globe className="size-3 shrink-0" /> : <Wrench className="size-3 shrink-0" />}
              <span className="shrink-0 font-medium">{TOOL_LABELS[s.name] ?? s.name}</span>
              <span className="truncate text-muted-foreground">{s.summary}</span>
            </li>
          ))}
        </ol>
      )}
      {m.content ? <ResearchMarkdown className="text-[13px] leading-relaxed">{m.content}</ResearchMarkdown> : null}
      {m.error && <p className="rounded-md border border-negative/30 bg-negative-soft px-2.5 py-1.5 text-xs text-negative">{m.error}</p>}
    </div>
  );
}
