import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp, Check, ChevronLeft, ChevronRight, Circle, CircleDot, Copy, EyeOff, GripHorizontal, LayoutDashboard, ListChecks, MapPin, MessageCircleQuestion, MessageSquare,
  MessageSquarePlus, Mic, PanelRight, PanelRightClose, PictureInPicture2, Sparkles, Square, Volume2, VolumeX, X,
} from "lucide-react";
import { toast } from "sonner";
import { Canvas } from "@/components/research/canvas";
import { ResearchMarkdown } from "@/components/research/markdown";
import { Timeline } from "@/components/research/timeline";
import { Button } from "@/components/ui/button";
import LoadingState, { formatElapsed, type LoadingVariant } from "@/components/ui/loading-state";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { titleSession } from "@/lib/research.functions";
import { beginTour, clearHighlights, setCurrentStop, showPin, type Pin } from "@/lib/research/dom-agent";
import { plainForSpeech, speakText, startRecording, stopSpeaking, type Recording } from "@/lib/research/voice";
import { runAgent, type Plan, type Question, type Step, type Turn } from "@/lib/research/loop";
import { canvas, useCanvas } from "@/lib/research/views";
import { sanitizeAnswer, wantsCode } from "@/lib/research/sanitize";
import { currentUserId } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const ASSISTANT_WIDTH = "420px";
const CHAT_WIDTH = 420;

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: Step[];
  plan?: Plan;
  phase?: string;
  activity?: Turn["activity"];
  pending?: boolean;
  error?: string;
  startedAt?: number;
  /** The user asked for code, so code blocks stay visible. */
  allowCode?: boolean;
  ms?: number;
}

function suggestionsFor(path: string): string[] {
  const t = path.match(/\/app\/companies\/([A-Z.-]+)/)?.[1];
  if (t)
    return [
      `Walk me through what matters on this page for ${t}, pointing at each number`,
      `Build a dashboard of ${t}'s growth, margins and cash flow vs two peers`,
      `Open ${t}'s IR site in a browser, download the latest earnings deck and summarize it`,
    ];
  if (path.includes("supply-chain")) return ["Explain the biggest risks on this map", "Which covered companies are most exposed to TSMC?", "Simulate a 25% drop in Apple demand"];
  return [
    "Screen for >20% revenue growth and >25% FCF margins and put it in a dashboard",
    "Which semis have the highest R&D intensity? Chart it and give me a CSV",
    "Browse the latest Fed statement and the prior one in parallel and tell me what changed",
  ];
}

const COMPACT_WIDTH = "320px";
const VOICE_KEY = "fu:assistant-voice";
const FLOAT_KEY = "fu:assistant-float";
const DOCK_KEY = "fu:assistant-docked";

const VARIANT: Record<NonNullable<Turn["activity"]>, LoadingVariant> = { thinking: "Dots", working: "Drive", browsing: "Orbit" };

function useViewport() {
  const [vp, setVp] = useState({ w: 1440, h: 900, ready: false });
  useEffect(() => {
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight, ready: true });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return vp;
}

export function AssistantPanel({ open, onClose, docked, onDockedChange }: { open: boolean; onClose: () => void; docked: boolean; onDockedChange: (d: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const cv = useCanvas();
  const vp = useViewport();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [mobilePane, setMobilePane] = useState<"chat" | "canvas">("chat");
  const answerRef = useRef<((a: string) => void) | null>(null);
  const stop = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handoffPending = useRef(false);
  const [box, setBox] = useState({ x: 0, y: 72, w: 440, h: 640 });
  /** The assistant narrowed itself to show something wide; cleared when the turn ends. */
  const [compact, setCompact] = useState(false);
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const recording = useRef<Recording | null>(null);
  const voiceRef = useRef(false);
  voiceRef.current = voice;

  const mobile = vp.ready && vp.w < 640;
  const wide = cv.open;
  const wideW = Math.max(CHAT_WIDTH + 360, Math.min(1240, vp.w - (docked ? 48 : 16)));
  const canvasCount = cv.views.length + cv.files.length + cv.runs.length;

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? "null");
      setBox(f ?? { x: window.innerWidth - 470, y: 72, w: 440, h: Math.min(680, window.innerHeight - 100) });
      if (localStorage.getItem(DOCK_KEY) === "0") onDockedChange(false);
    } catch {
      /* ignore */
    }
  }, [onDockedChange]);
  useEffect(() => {
    try {
      setVoice(localStorage.getItem(VOICE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    const onLayout = (e: Event) => {
      const want = (e as CustomEvent<{ panel?: string }>).detail?.panel;
      if (want === "compact") setCompact(true);
      else if (want === "normal" || want === "restore") setCompact(false);
    };
    window.addEventListener("fu:layout", onLayout);
    return () => window.removeEventListener("fu:layout", onLayout);
  }, []);
  // The page's right padding follows the docked panel's width.
  useEffect(() => {
    document.documentElement.style.setProperty("--assistant-w", compact ? COMPACT_WIDTH : ASSISTANT_WIDTH);
  }, [compact]);
  useEffect(() => {
    if (!open) stopSpeaking();
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem(DOCK_KEY, docked ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [docked]);
  // On phones the canvas takes the whole sheet when the agent opens it.
  useEffect(() => {
    if (mobile) setMobilePane(cv.open ? "canvas" : "chat");
  }, [cv.open, cv.tab, mobile]);

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
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [input, open]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === "string") {
        handoffPending.current = true;
        setInput(detail);
      }
    };
    window.addEventListener("fu:research-request", receive);
    return () => window.removeEventListener("fu:research-request", receive);
  }, []);
  useEffect(() => {
    const resize = () => setBox((b) => clampBox(b));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!open) clearHighlights();
  }, [open]);
  // The page agent asks the floating panel to step aside when it would cover what it is pointing at.
  useEffect(() => {
    const avoid = (e: Event) => {
      const side = (e as CustomEvent<{ side: "left" | "right" }>).detail?.side;
      if (docked || !side) return;
      setBox((b) => clampBox({ ...b, x: side === "left" ? 8 : window.innerWidth - b.w - 8 }));
    };
    window.addEventListener("fu:assistant-avoid", avoid);
    return () => window.removeEventListener("fu:assistant-avoid", avoid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked]);

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
      setBox((b) => {
        try {
          localStorage.setItem(FLOAT_KEY, JSON.stringify(b));
        } catch {
          /* ignore */
        }
        return b;
      });
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
    if (mobile) setMobilePane("chat");
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
          .then((title) => (session ? supabase.from("research_sessions").update({ title }).eq("id", session) : undefined))
          .then(() => qc.invalidateQueries({ queryKey: ["research-sessions"] }))
          .catch(() => {});
      }
      await supabase.from("research_messages").insert({ session_id: session, user_id: userId, role: "user", content: q });
    } catch (e) {
      toast.error((e as Error).message);
      return setBusy(false);
    }

    const history = msgs.filter((m) => !m.pending);
    // A new turn numbers its stops from 1 and takes the last turn's marks off the page.
    beginTour();
    const now = Date.now();
    const asstId = `a-${now}`;
    setMsgs([...history, { id: `u-${now}`, role: "user", content: q, steps: [] }, { id: asstId, role: "assistant", content: "", steps: [], pending: true, phase: "Thinking", activity: "thinking", startedAt: now, allowCode: wantsCode(q) }]);
    const cs = canvas.get();
    const canvasNote = cs.views.length || cs.files.length || cs.runs.length
      ? ` Canvas has ${cs.views.length} view(s), ${cs.files.length} file(s) [${cs.files.map((f) => `${f.name}=${f.id}`).join(", ").slice(0, 300)}], ${cs.runs.length} browser task(s) [${cs.runs.map((r) => `${r.id}:${r.status}`).join(", ").slice(0, 300)}].`
      : "";
    // Context: recent turns (with each prior plan's notes, so follow-ups keep findings) + where the user is.
    const items: Record<string, unknown>[] = [
      ...history.slice(-14).map((m) => ({
        role: m.role,
        content: (m.content || "(no answer)") + (m.role === "assistant" && m.plan?.notes ? `\n\n[Earlier working notes: ${m.plan.notes.slice(0, 1200)}]` : ""),
      })),
      {
        role: "user",
        content: `[Context — user is viewing ${window.location.pathname}${window.location.search} ("${document.title}"); mode: ${deep ? "deep research" : "fast"}; screen ${window.innerWidth}px wide; canvas ${cs.open ? "open" : "closed"}.${canvasNote} Local time ${new Date().toLocaleString()}. Call get_page_context if the question refers to the page.]\n${q}`,
      },
    ];
    const turn = await runAgent({
      qc,
      items,
      deep,
      ctx: { navigate: (href) => navigate({ href }), narrate: voiceRef.current ? (text) => speakText(text) : undefined },
      stopped: () => stop.current,
      onUpdate: (t) => setMsgs((ms) => ms.map((m) => (m.id === asstId ? { ...m, ...t } : m))),
      onAsk: (qq) =>
        new Promise<string>((resolve) => {
          answerRef.current = resolve;
          setQuestion(qq);
          setTimeout(() => inputRef.current?.focus(), 50);
        }),
    });
    const ms = Date.now() - now;
    // Never show leaked specs/JSON/traces: convert or hide them; valid view specs go to the canvas.
    const clean = sanitizeAnswer(turn.content, { allowCode: wantsCode(q) });
    for (const v of clean.views) canvas.addView(v);
    turn.content = clean.markdown;
    // Give the screen back: whatever the assistant collapsed or narrowed returns to the user's setting.
    window.dispatchEvent(new CustomEvent("fu:layout", { detail: { sidebar: "restore", panel: "restore" } }));
    if (voiceRef.current && !stop.current && turn.content) void speakText(plainForSpeech(turn.content));
    setMsgs((all) => all.map((m) => (m.id === asstId ? { ...m, ...turn, pending: false, ms } : m)));
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

  function toggleVoice() {
    setVoice((v) => {
      const next = !v;
      try {
        localStorage.setItem(VOICE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) stopSpeaking();
      return next;
    });
  }

  /** Tap to talk: the first tap records, the second sends what was heard. */
  async function talk() {
    if (recording.current) {
      const rec = recording.current;
      recording.current = null;
      setListening(false);
      try {
        const heard = await rec.stop();
        if (heard) await ask(heard);
        else toast.message("Didn't catch that. Try again a little closer to the microphone.");
      } catch (e) {
        toast.error((e as Error).message || "Couldn't transcribe that");
      }
      return;
    }
    stopSpeaking();
    try {
      recording.current = await startRecording();
      setListening(true);
    } catch (e) {
      toast.error((e as Error).name === "NotAllowedError" ? "Allow microphone access in your browser to talk to the assistant" : (e as Error).message);
    }
  }

  function halt() {
    stopSpeaking();
    stop.current = true;
    if (answerRef.current) answer("(user stopped)");
  }

  function newChat() {
    stopSpeaking();
    setMsgs([]);
    setSid(null);
    canvas.reset();
    clearHighlights();
  }

  const style = mobile
    ? undefined
    : docked
      ? { width: wide ? `${wideW}px` : compact ? COMPACT_WIDTH : ASSISTANT_WIDTH }
      : wide
        ? { left: Math.max(8, Math.min(box.x, vp.w - wideW - 8)), top: box.y, width: wideW, height: Math.max(box.h, Math.min(760, vp.h - 96)) }
        : compact
          ? { left: box.x + (box.w - Math.min(box.w, 340)), top: box.y, width: Math.min(box.w, 340), height: Math.min(box.h, 440) }
          : { left: box.x, top: box.y, width: box.w, height: box.h };

  const showChat = !mobile || mobilePane === "chat" || !wide;
  const showCanvas = wide && (!mobile || mobilePane === "canvas");

  return (
    <aside
      aria-hidden={!open}
      aria-label="AI assistant"
      data-agent-ignore=""
      data-docked={docked ? "1" : "0"}
      data-wide={wide ? "1" : "0"}
      style={style}
      className={cn(
        "fixed z-30 flex max-w-full flex-col bg-background max-sm:!inset-0 max-sm:!h-dvh max-sm:!w-full max-sm:!rounded-none",
        docked
          ? "inset-y-0 right-0 w-full border-l border-rule transition-[transform,width] duration-300 max-sm:!w-full"
          : "overflow-hidden rounded-lg border border-rule shadow-lift transition-[opacity,width,height,left] duration-200",
        open ? (docked ? "translate-x-0 shadow-panel" : "opacity-100") : docked ? "pointer-events-none invisible translate-x-full" : "pointer-events-none invisible opacity-0",
      )}
    >
      <div onPointerDown={(e) => drag(e, "move")} className={cn("flex h-11 shrink-0 items-center gap-2 border-b px-3", !docked && "cursor-grab select-none active:cursor-grabbing")}>
        {!docked && <GripHorizontal className="size-3.5 text-muted-foreground" />}
        <span className="grid size-6 place-items-center rounded-md bg-ink text-ink-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <p className="text-[13px] font-medium">Assistant</p>
        <span className="hidden truncate rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground min-[400px]:inline">{path.replace("/app", "") || "/dashboard"}</span>
        <div className="ml-auto flex items-center">
          {mobile && wide && (
            <div className="mr-1 flex rounded-md border p-0.5" role="tablist" aria-label="Assistant view">
              {(["chat", "canvas"] as const).map((p) => (
                <button key={p} type="button" role="tab" aria-selected={mobilePane === p} onClick={() => setMobilePane(p)}
                  className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]", mobilePane === p ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
                  {p === "chat" ? <MessageSquare className="size-3" /> : <LayoutDashboard className="size-3" />}
                  {p === "chat" ? "Chat" : "Canvas"}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" size="icon-sm" className="relative" onClick={() => (wide ? canvas.hide() : canvas.show())} aria-pressed={wide} aria-label={wide ? "Collapse canvas" : "Expand canvas"} title={wide ? "Collapse canvas" : "Expand canvas: dashboards, browsers, files"}>
            {wide ? <PanelRightClose /> : <LayoutDashboard />}
            {!wide && canvasCount > 0 && <span className="num absolute -right-0.5 -top-0.5 grid min-w-3.5 place-items-center rounded-full bg-ink px-0.5 text-[9px] leading-[14px] text-ink-foreground">{canvasCount}</span>}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={toggleVoice} aria-pressed={voice} aria-label={voice ? "Turn voice off" : "Turn voice on"} title={voice ? "Voice on: answers and walkthroughs are read aloud" : "Read answers and walkthroughs aloud"}>
            {voice ? <Volume2 /> : <VolumeX />}
          </Button>
          <Button variant="ghost" size="icon-sm" className="max-sm:hidden" onClick={() => onDockedChange(!docked)} aria-label={docked ? "Pop out" : "Dock to side"} title={docked ? "Pop out & move" : "Dock to side"}>
            {docked ? <PictureInPicture2 /> : <PanelRight />}
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={newChat} aria-label="New chat" title="New chat">
            <MessageSquarePlus />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {showChat && (
          <div className={cn("flex min-h-0 min-w-0 flex-col", wide && !mobile ? "shrink-0 border-r" : "flex-1")} style={wide && !mobile ? { width: CHAT_WIDTH } : undefined}>
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
              {!msgs.length ? (
                <div className="animate-[rise_.4s_ease-out]">
                  <p className="font-display text-xl leading-tight">Your research desk</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    I can read this page with you, point at what matters, build dashboards and files in the canvas, and run real browsers in parallel.
                  </p>
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
                      <p key={m.id} className="step-in ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-3 py-2 text-[13px] text-ink-foreground">
                        {m.content}
                      </p>
                    ) : (
                      <AssistantTurn key={m.id} m={m} canvasOpen={wide} latest={m.id === msgs[msgs.length - 1]?.id} />
                    ),
                  )}
                  {question && (
                    <div className="step-in rounded-xl border border-foreground/20 bg-card p-3 shadow-paper">
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
                  placeholder={listening ? "Listening… tap the microphone to send" : question ? "Type your answer…" : busy ? "Working…" : "Ask, research, model, browse, or “show me…”"}
                  className="max-h-36 min-h-9 resize-none border-0 bg-transparent px-1.5 text-[13px] shadow-none focus-visible:ring-0"
                />
                <div className="flex items-center gap-1 px-0.5">
                  <div className="flex rounded-md border p-0.5 text-[10.5px]" role="radiogroup" aria-label="Research depth">
                    {(["Fast", "Deep"] as const).map((l) => {
                      const on = (l === "Deep") === deep;
                      return (
                        <Button variant="ghost" size="xs" key={l} type="button" role="radio" aria-checked={on} onClick={() => setDeep(l === "Deep")}
                          className={cn("h-6 rounded px-1.5 text-[10.5px] transition-colors", on ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground")}
                          title={l === "Deep" ? "More loops, cross-checks and a self-review pass" : "Quick answers"}>
                          {l}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {!(busy && !question) && (
                      <Button type="button" size="icon-sm" variant={listening ? "ink" : "ghost"} onClick={talk} aria-pressed={listening} aria-label={listening ? "Stop and send" : "Ask by voice"} title={listening ? "Listening. Tap to send." : "Ask by voice"} className={cn(listening && "animate-pulse")}>
                        <Mic />
                      </Button>
                    )}
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
          </div>
        )}
        {showCanvas && (
          <div className="min-h-0 min-w-0 flex-1">
            <Canvas onClose={() => canvas.hide()} />
          </div>
        )}
      </div>
      {!docked && !mobile && (
        <div onPointerDown={(e) => drag(e, "resize")} className="absolute bottom-0 right-0 size-4 cursor-se-resize" aria-hidden>
          <span className="absolute bottom-1 right-1 size-2 border-b-2 border-r-2 border-rule" />
        </div>
      )}
    </aside>
  );
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function PlanCard({ plan, live }: { plan: Plan; live: boolean }) {
  const done = plan.steps.filter((s) => s.status === "done").length;
  return (
    <details open={live ? true : undefined} className="step-in rounded-lg border bg-card/40 px-2.5 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium">
        <ListChecks className="size-3.5 text-muted-foreground" /> Plan
        <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">· {plan.goal}</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {done}/{plan.steps.length}
        </span>
      </summary>
      <div className="mt-1.5 h-0.5 overflow-hidden rounded bg-muted">
        <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${plan.steps.length ? (done / plan.steps.length) * 100 : 0}%` }} />
      </div>
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

/** The numbered stops a turn left on the page: step through them, jump to one, or clear them. */
function Walkthrough({ pins, current, onShow, onClear }: { pins: Pin[]; current: number; onShow: (n: number) => void; onClear: () => void }) {
  const idx = pins.findIndex((p) => p.n === current);
  const step = (d: 1 | -1) => onShow(pins[idx < 0 ? (d === 1 ? 0 : pins.length - 1) : (idx + d + pins.length) % pins.length].n);
  return (
    <div className="step-in rounded-lg border bg-card/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        <MapPin className="size-3.5 text-muted-foreground" /> On the page
        <span className="font-normal text-muted-foreground">
          · {idx >= 0 ? `stop ${idx + 1} of ${pins.length}` : `${pins.length} stop${pins.length === 1 ? "" : "s"}`}
        </span>
        <div className="ml-auto flex items-center">
          {pins.length > 1 && (
            <>
              <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Previous stop" onClick={() => step(-1)}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Next stop" onClick={() => step(1)}>
                <ChevronRight className="size-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Clear highlights from the page" title="Clear highlights from the page" onClick={onClear}>
            <EyeOff className="size-3.5" />
          </Button>
        </div>
      </div>
      <ol className="mt-1.5 grid gap-0.5">
        {pins.map((p) => (
          <li key={p.n}>
            <button
              type="button"
              onClick={() => onShow(p.n)}
              aria-current={p.n === current ? "step" : undefined}
              className={cn("flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-[11.5px] leading-snug transition-colors hover:bg-muted/60", p.n === current && "bg-muted/60")}
            >
              <span className="agent-pin-ref !ml-0 mt-px shrink-0">{p.n}</span>
              <span className="min-w-0 flex-1">
                <span className={cn(p.n === current && "font-medium")}>{p.label}</span>
                {p.n === current && p.explain && <span className="mt-0.5 block text-muted-foreground">{p.explain}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AssistantTurn({ m, canvasOpen, latest }: { m: Msg; canvasOpen: boolean; latest: boolean }) {
  const [open, setOpen] = useState(false);
  const [stop, setStop] = useState(0);
  const navigate = useNavigate();
  const pins = useMemo(() => m.steps.flatMap((s) => (s.status === "done" ? (s.pins ?? []) : [])), [m.steps]);
  async function showStop(n: number) {
    const pin = pins.find((p) => p.n === n);
    if (!pin) return;
    setStop(n);
    const r = await showPin(pin, (href) => navigate({ href }));
    if (!r.ok) return void toast.error(r.reason);
    let voiceOn = false;
    try {
      voiceOn = localStorage.getItem(VOICE_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (voiceOn) void speakText(`${pin.label}. ${pin.explain ?? ""}`);
  }
  // The card on the page has its own Back and Next; the strip here follows whichever stop is showing.
  const showRef = useRef(showStop);
  showRef.current = showStop;
  useEffect(() => {
    if (!latest || !pins.length) return;
    const onStep = (e: Event) => void showRef.current((e as CustomEvent<{ n: number }>).detail.n);
    const onCurrent = (e: Event) => setStop((e as CustomEvent<{ n: number | null }>).detail.n ?? 0);
    window.addEventListener("fu:tour-step", onStep);
    window.addEventListener("fu:tour-current", onCurrent);
    return () => {
      window.removeEventListener("fu:tour-step", onStep);
      window.removeEventListener("fu:tour-current", onCurrent);
    };
  }, [latest, pins.length]);
  const shown = useMemo(() => (m.pending ? sanitizeAnswer(m.content, { allowCode: m.allowCode }).markdown : m.content), [m.content, m.pending, m.allowCode]);
  const steps = m.steps.filter((s) => s.name !== "sources");
  const sources = Array.from(new Map(m.steps.flatMap((s) => s.sources ?? []).map((x) => [x.url, x])).values());
  const tools = steps.filter((s) => s.kind !== "think").length;
  const made = {
    views: steps.filter((s) => s.status === "done" && (s.name === "render_view" || (s.name === "run_code" && /Rendered|canvas/.test(s.output ?? "")))).length,
    files: steps.filter((s) => s.status === "done" && (s.name === "create_file" || s.name === "browser_files")).length,
    browsers: steps.filter((s) => s.status === "done" && s.name === "browser_task").length,
  };
  const madeText = [made.views && `${made.views} view${made.views === 1 ? "" : "s"}`, made.files && `${made.files} file${made.files === 1 ? "" : "s"}`, made.browsers && `${made.browsers} browser run${made.browsers === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {m.plan && m.plan.steps.length > 0 && <PlanCard plan={m.plan} live={!!m.pending} />}
      {steps.length > 0 &&
        (m.pending ? (
          <Timeline steps={steps} limit={10} />
        ) : (
          <div>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
              <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
              Worked{m.ms ? ` for ${formatElapsed(m.ms)}` : ""} · {tools} step{tools === 1 ? "" : "s"}
              {sources.length > 0 && ` · ${sources.length} sources`}
            </button>
            {open && (
              <div className="mt-1">
                <Timeline steps={steps} />
              </div>
            )}
          </div>
        ))}
      {m.pending && m.phase && <LoadingState label={m.phase} variant={VARIANT[m.activity ?? "thinking"]} since={m.startedAt} className="step-in px-1.5" />}
      {shown ? (
        <ResearchMarkdown className={cn("text-[13px] leading-relaxed", m.pending && "opacity-60")} onPin={pins.length ? showStop : undefined}>
          {shown}
        </ResearchMarkdown>
      ) : null}
      {!m.pending && pins.length > 0 && (
        <Walkthrough
          pins={pins}
          current={stop}
          onShow={showStop}
          onClear={() => {
            setCurrentStop(null);
            clearHighlights();
            setStop(0);
          }}
        />
      )}
      {m.error && <p className="rounded-md border border-negative/30 bg-negative-soft px-2.5 py-1.5 text-xs text-negative">{m.error}</p>}
      {!m.pending && madeText && !canvasOpen && (
        <button type="button" onClick={() => canvas.show(made.views ? "views" : made.files ? "files" : "browser")} className="step-in flex w-fit items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[11.5px] shadow-paper transition-colors hover:border-foreground/40">
          <LayoutDashboard className="size-3.5" /> {madeText} in the canvas
          <ChevronRight className="size-3 text-muted-foreground" />
        </button>
      )}
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
          {sources.length > 0 && (
            <details className="ml-1 text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">All {sources.length} sources</summary>
              <ul className="mt-2 space-y-1">
                {sources.map((x) => (
                  <li key={x.url}>
                    <a className="block truncate text-link hover:underline" href={x.url} target="_blank" rel="noreferrer">
                      {x.title ?? host(x.url)}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
