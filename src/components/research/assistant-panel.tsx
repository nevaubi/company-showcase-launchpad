import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp, Brain, Check, ChevronRight, Circle, CircleDot, Code2, Compass, Copy, FileSearch, Globe, GripHorizontal, ListChecks,
  MessageCircleQuestion, MessageSquarePlus, Network, PanelRight, PictureInPicture2, ScanText, Sparkles, Square, TriangleAlert, Wrench, X,
} from "lucide-react";
import { toast } from "sonner";
import { ResearchMarkdown } from "@/components/research/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { titleSession } from "@/lib/research.functions";
import { runAgent, type Plan, type Question, type Step } from "@/lib/research/loop";
import { TOOL_LABELS } from "@/lib/research/tool-defs";
import { currentUserId } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const ASSISTANT_WIDTH = "420px";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: Step[];
  plan?: Plan;
  phase?: string;
  pending?: boolean;
  error?: string;
}

function suggestionsFor(path: string): string[] {
  const t = path.match(/\/app\/companies\/([A-Z.-]+)/)?.[1];
  if (t)
    return [`Summarize what matters on this page for ${t}`, `Build a quick DCF for ${t} with bear/base/bull cases`, `Map ${t}'s IR site and pull the latest guidance from its newest release`];
  if (path.includes("supply-chain")) return ["Explain the biggest risks on this map", "Which covered companies are most exposed to TSMC?", "Simulate a 25% drop in Apple demand"];
  return ["Screen for >20% revenue growth and >25% FCF margins", "Which semis have the highest R&D intensity? Chart it", "Crawl the latest Fed statement and tell me what changed"];
}

const FLOAT_KEY = "fu:assistant-float";
const DOCK_KEY = "fu:assistant-docked";

export function AssistantPanel({ open, onClose, docked, onDockedChange }: { open: boolean; onClose: () => void; docked: boolean; onDockedChange: (d: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const answerRef = useRef<((a: string) => void) | null>(null);
  const stop = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handoffPending = useRef(false);
  const [box, setBox] = useState({ x: 0, y: 72, w: 440, h: 640 });

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? "null");
      setBox(f ?? { x: window.innerWidth - 470, y: 72, w: 440, h: Math.min(680, window.innerHeight - 100) });
      if (localStorage.getItem(DOCK_KEY) === "0") onDockedChange(false);
    } catch {
      /* ignore */
    }
  }, [onDockedChange]);
  useEffect(() => localStorage.setItem(DOCK_KEY, docked ? "1" : "0"), [docked]);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [msgs, question]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !open) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(144, Math.max(40, el.scrollHeight))}px`;
    };
    fit();
    if (handoffPending.current) {
      el.focus();
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
      handoffPending.current = false;
    }
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) { width = el.clientWidth; fit(); }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [input, open]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === "string") { handoffPending.current = true; setInput(detail); }
    };
    window.addEventListener("fu:research-request", receive);
    return () => window.removeEventListener("fu:research-request", receive);
  }, []);
  useEffect(() => {
    const resize = () => setBox((b) => clampBox(b));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function clampBox(b: typeof box) {
    const W = window.innerWidth, H = window.innerHeight;
    const w = Math.min(Math.max(b.w, 340), W - 16), h = Math.min(Math.max(b.h, 360), H - 16);
    return { w, h, x: Math.min(Math.max(b.x, 8), W - w - 8), y: Math.min(Math.max(b.y, 8), H - h - 8) };
  }
  function drag(e: RPointerEvent, mode: "move" | "resize") {
    if (docked || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, start = box;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      setBox(clampBox(mode === "move" ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBox((b) => (localStorage.setItem(FLOAT_KEY, JSON.stringify(b)), b));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function answer(a: string) {
    const t = a.trim();
    if (!t || !answerRef.current) return;
    answerRef.current(t);
    answerRef.current = null;
    setQuestion(null);
    setInput("");
  }

  async function ask(text: string) {
    if (question) return answer(text);
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
          .then((title) => session ? supabase.from("research_sessions").update({ title }).eq("id", session) : undefined)
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
    setMsgs([...history, { id: `u-${now}`, role: "user", content: q, steps: [] }, { id: asstId, role: "assistant", content: "", steps: [], pending: true, phase: "Thinking" }]);
    // Context: recent turns (with each prior plan's notes, so follow-ups keep findings) + where the user is.
    const items: Record<string, unknown>[] = [
      ...history.slice(-14).map((m) => ({
        role: m.role,
        content: (m.content || "(no answer)") + (m.role === "assistant" && m.plan?.notes ? `\n\n[Earlier working notes: ${m.plan.notes.slice(0, 1200)}]` : ""),
      })),
      {
        role: "user",
        content: `[Context — user is viewing ${window.location.pathname}${window.location.search} ("${document.title}"); mode: ${deep ? "deep research" : "fast"}; local time ${new Date().toLocaleString()}. Call get_page_context if the question refers to the page.]\n${q}`,
      },
    ];
    const turn = await runAgent({
      qc,
      items,
      deep,
      ctx: { navigate: (href) => navigate({ href }) },
      stopped: () => stop.current,
      onUpdate: (t) => setMsgs((ms) => ms.map((m) => (m.id === asstId ? { ...m, ...t } : m))),
      onAsk: (qq) =>
        new Promise<string>((resolve) => {
          answerRef.current = resolve;
          setQuestion(qq);
          setTimeout(() => inputRef.current?.focus(), 50);
        }),
    });
    setMsgs((ms) => ms.map((m) => (m.id === asstId ? { ...m, ...turn, pending: false } : m)));
    await supabase.from("research_messages").insert({
      session_id: session,
      user_id: userId,
      role: "assistant",
      content: turn.error ? `${turn.content}\n\n> Error: ${turn.error}` : turn.content,
      steps: turn.steps.map(({ output: _o, ...s }) => s) as never,
    });
    if (session) await supabase.from("research_sessions").update({ updated_at: new Date().toISOString() }).eq("id", session);
    qc.invalidateQueries({ queryKey: ["research-sessions"] });
    setBusy(false);
  }

  function halt() {
    stop.current = true;
    if (answerRef.current) answer("(user stopped)");
  }

  return (
    <aside
      aria-hidden={!open}
      aria-label="AI assistant"
      style={docked ? { width: ASSISTANT_WIDTH } : { left: box.x, top: box.y, width: box.w, height: box.h }}
      className={cn(
        "fixed z-30 flex max-w-full flex-col bg-background max-sm:!inset-0 max-sm:!h-dvh max-sm:!w-full max-sm:!rounded-none",
        docked ? "inset-y-0 right-0 w-full border-l border-rule transition-transform duration-300 max-sm:!w-full" : "overflow-hidden rounded-lg border border-rule shadow-lift transition-opacity duration-200",
        open ? (docked ? "translate-x-0 shadow-panel" : "opacity-100") : docked ? "pointer-events-none invisible translate-x-full" : "pointer-events-none invisible opacity-0",
      )}
    >
      <div onPointerDown={(e) => drag(e, "move")} className={cn("flex h-11 shrink-0 items-center gap-2 border-b px-3", !docked && "cursor-grab select-none active:cursor-grabbing")}>
        {!docked && <GripHorizontal className="size-3.5 text-muted-foreground" />}
        <span className="grid size-6 place-items-center rounded-md bg-ink text-ink-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <p className="text-[13px] font-medium">Assistant</p>
        <span className="truncate rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{path.replace("/app", "") || "/dashboard"}</span>
        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon-sm" onClick={() => onDockedChange(!docked)} aria-label={docked ? "Pop out" : "Dock to side"} title={docked ? "Pop out & move" : "Dock to side"}>
            {docked ? <PictureInPicture2 /> : <PanelRight />}
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => { setMsgs([]); setSid(null); }} aria-label="New chat" title="New chat">
            <MessageSquarePlus />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
            <X />
          </Button>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
        {!msgs.length ? (
          <div className="animate-[rise_.4s_ease-out]">
            <p className="font-display text-xl leading-tight">Your research desk</p>
            <p className="mb-2 mt-4 text-[11px] font-medium text-muted-foreground">Suggested investigations</p>
            <div className="grid grid-cols-1 gap-1.5">
              {suggestionsFor(path).map((s) => (
                <Button variant="ghost" key={s} onClick={() => setInput(s)} className="group h-auto w-full justify-start gap-2 whitespace-normal rounded-none border-b px-0 py-3 text-left text-[12.5px] leading-snug">
                  <span className="flex-1">{s}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {msgs.map((m) =>
              m.role === "user" ? (
                <p key={m.id} className="ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-3 py-2 text-[13px] text-ink-foreground">
                  {m.content}
                </p>
              ) : (
                <AssistantTurn key={m.id} m={m} />
              ),
            )}
            {question && (
              <div className="animate-[rise_.3s_ease-out] rounded-xl border border-foreground/20 bg-card p-3 shadow-paper">
                <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <MessageCircleQuestion className="size-3.5" /> Needs your input
                </p>
                <p className="mt-1.5 text-[13px] font-medium leading-snug">{question.question}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {question.options.map((o) => (
                    <button key={o} onClick={() => answer(o)} className="rounded-full border bg-background px-2.5 py-1 text-[12px] transition-colors hover:border-foreground hover:bg-secondary">
                      {o}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] text-muted-foreground">Or type your own answer below.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-2.5">
        <form
          className="rounded-xl border bg-card p-1.5 shadow-paper transition-colors focus-within:border-foreground/40"
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
            maxLength={4000}
            disabled={busy && !question}
            placeholder={question ? "Type your answer…" : busy ? "Working…" : "Ask, research, model, or “take me to…”"}
            className="max-h-36 min-h-9 resize-none border-0 bg-transparent px-1.5 text-[13px] shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-1 px-0.5">
            <div className="flex rounded-md border p-0.5 text-[10.5px]" role="radiogroup" aria-label="Research depth">
              {(["Fast", "Deep"] as const).map((l) => {
                const on = (l === "Deep") === deep;
                return (
                  <Button variant="ghost" size="xs" key={l} type="button" role="radio" aria-checked={on} onClick={() => setDeep(l === "Deep")} className={cn("h-6 rounded px-1.5 text-[10.5px] transition-colors", on ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground")}
                    title={l === "Deep" ? "More loops, cross-checks and a self-review pass" : "Quick answers"}>
                    {l}
                  </Button>
                );
              })}
            </div>
            <div className="ml-auto">
              {busy && !question ? (
                <Button type="button" size="icon-sm" variant="outline" onClick={halt} aria-label="Stop">
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" variant="ink" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </form>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          Saved to your <Link to="/app/research" className="underline">research history</Link>. Not investment advice.
        </p>
      </div>
      {!docked && <div onPointerDown={(e) => drag(e, "resize")} className="absolute bottom-0 right-0 size-4 cursor-se-resize" aria-hidden><span className="absolute bottom-1 right-1 size-2 border-b-2 border-r-2 border-rule" /></div>}
    </aside>
  );
}

function stepIcon(s: Step) {
  if (s.status === "error") return <TriangleAlert className="size-3 text-negative" />;
  const c = "size-3";
  if (s.kind === "think") return <Brain className={c} />;
  if (s.name === "run_code") return <Code2 className={c} />;
  if (s.name === "navigate_to" || s.name === "get_page_context") return <Compass className={c} />;
  if (s.name === "ask_user") return <MessageCircleQuestion className={c} />;
  if (s.name === "web_map" || s.name === "web_crawl") return <Network className={c} />;
  if (s.name === "web_extract" || s.name === "fetch_url") return <ScanText className={c} />;
  if (s.name.startsWith("read_") || s.name === "search_filings") return <FileSearch className={c} />;
  if (s.kind === "web" || s.name.startsWith("web_")) return <Globe className={c} />;
  return <Wrench className={c} />;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function StepRow({ s }: { s: Step }) {
  const [open, setOpen] = useState(false);
  const detail = s.kind === "think" ? s.output : s.output || (s.args && Object.keys(s.args).length ? JSON.stringify(s.args, null, 2) : "");
  const running = s.status === "running";
  return (
    <li className="relative">
      <span className={cn("absolute -left-[19px] top-[3px] grid size-[15px] place-items-center rounded-full border bg-background", running && "border-foreground/50")}>
        {running ? <span className="size-1.5 animate-[pulse-dot_1s_ease-in-out_infinite] rounded-full bg-foreground" /> : stepIcon(s)}
      </span>
      <button onClick={() => detail && setOpen((o) => !o)} className={cn("flex w-full min-w-0 items-baseline gap-1.5 text-left text-[11.5px]", detail && "hover:text-foreground")}>
        <span className={cn("shrink-0 font-medium", running && "text-shimmer", s.kind === "think" && "font-normal italic text-muted-foreground")}>
          {s.kind === "think" ? s.summary : (TOOL_LABELS[s.name] ?? s.name)}
        </span>
        {s.kind !== "think" && <span className={cn("truncate text-muted-foreground", s.status === "error" && "text-negative")}>{s.summary}</span>}
        {s.ms != null && s.ms > 800 && <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{(s.ms / 1000).toFixed(1)}s</span>}
      </button>
      {s.sources && s.sources.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {s.sources.slice(0, 6).map((x) => (
            <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.title ?? x.url} className="inline-flex max-w-[150px] items-center gap-1 rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
              <img src={`https://www.google.com/s2/favicons?domain=${host(x.url)}&sz=32`} alt="" className="size-3 rounded-sm" loading="lazy" />
              <span className="truncate">{host(x.url)}</span>
            </a>
          ))}
        </div>
      )}
      {open && detail && (
        <pre className={cn("mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground scrollbar-thin", s.kind === "think" && "font-sans italic")}>
          {detail}
        </pre>
      )}
    </li>
  );
}

function PlanCard({ plan, live }: { plan: Plan; live: boolean }) {
  const done = plan.steps.filter((s) => s.status === "done").length;
  return (
    <details open={live ? true : undefined} className="border-y bg-card/40 p-2.5">
      <summary className="cursor-pointer text-[11px] font-medium">Research plan · {done}/{plan.steps.length}</summary>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <ListChecks className="size-3.5" /> Plan
        <span className="ml-auto font-mono normal-case tracking-normal">{done}/{plan.steps.length}</span>
      </div>
      <div className="mt-1.5 h-0.5 overflow-hidden rounded bg-muted">
        <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${plan.steps.length ? (done / plan.steps.length) * 100 : 0}%` }} />
      </div>
      <p className="mt-2 text-[12px] font-medium leading-snug">{plan.goal}</p>
      <ul className="mt-1.5 grid gap-1">
        {plan.steps.map((s, i) => (
          <li key={i} className={cn("flex items-start gap-1.5 text-[11.5px] leading-snug", s.status === "dropped" && "text-muted-foreground line-through", s.status === "done" && "text-muted-foreground")}>
            {s.status === "done" ? <Check className="mt-px size-3 shrink-0 text-positive" /> : s.status === "doing" ? <CircleDot className="mt-px size-3 shrink-0" /> : <Circle className="mt-px size-3 shrink-0 text-muted-foreground" />}
            <span className={cn(s.status === "doing" && live && "text-shimmer")}>{s.title}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function AssistantTurn({ m }: { m: Msg }) {
  const [open, setOpen] = useState(false);
  const steps = m.steps.filter((s) => s.name !== "sources");
  const sources = Array.from(new Map(m.steps.flatMap((s) => s.sources ?? []).map((x) => [x.url, x])).values());
  const showSteps = open || m.pending;
  const visibleSteps = open ? steps : steps.slice(-3);
  const tools = steps.filter((s) => s.kind !== "think").length;
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {m.plan && m.plan.steps.length > 0 && <PlanCard plan={m.plan} live={!!m.pending} />}
      {steps.length > 0 && (
        <div>
          <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="h-6 px-0 text-[11px] text-muted-foreground">
            <ChevronRight className={cn("size-3 transition-transform", showSteps && "rotate-90")} />
            {m.pending ? "Working" : "Worked"} · {tools} tool{tools === 1 ? "" : "s"}
            {sources.length > 0 && ` · ${sources.length} sources`}
          </Button>
          {showSteps && (
            <ol className="ml-[7px] mt-1.5 grid grid-cols-1 gap-1.5 border-l pl-3">
              {visibleSteps.map((s, i) => (
                <StepRow key={i} s={s} />
              ))}
            </ol>
          )}
        </div>
      )}
      {m.pending && m.phase && <p className="text-shimmer text-[12px] font-medium">{m.phase}…</p>}
      {m.content ? <ResearchMarkdown className={cn("text-[13px] leading-relaxed", m.pending && "opacity-60")}>{m.content}</ResearchMarkdown> : null}
      {m.error && <p className="rounded-md border border-negative/30 bg-negative-soft px-2.5 py-1.5 text-xs text-negative">{m.error}</p>}
      {!m.pending && m.content && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Copy answer" onClick={() => navigator.clipboard.writeText(m.content).then(() => toast.success("Copied"))}>
            <Copy className="size-3" />
          </Button>
          {sources.slice(0, 5).map((x) => (
            <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.title ?? x.url}>
              <img src={`https://www.google.com/s2/favicons?domain=${host(x.url)}&sz=32`} alt={host(x.url)} className="size-4 rounded-sm border" loading="lazy" />
            </a>
          ))}
          {sources.length > 0 && <details className="ml-1 text-[11px]"><summary className="cursor-pointer text-muted-foreground">All {sources.length} sources</summary><ul className="mt-2 space-y-1">{sources.map((x) => <li key={x.url}><a className="block truncate text-link hover:underline" href={x.url} target="_blank" rel="noreferrer">{x.title ?? host(x.url)}</a></li>)}</ul></details>}
        </div>
      )}
    </div>
  );
}
