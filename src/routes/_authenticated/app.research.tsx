import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowUp, Bot, Check, ChevronDown, Globe, Loader2, MessageSquarePlus, Square, Trash2, TriangleAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import { ResearchMarkdown } from "@/components/research/markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { agentStep, titleSession, type AgentOutputItem } from "@/lib/research.functions";
import { runTool } from "@/lib/research/execute";
import { TOOL_LABELS } from "@/lib/research/tool-defs";
import { fmtRelative } from "@/lib/format";
import { currentUserId } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/research")({
  validateSearch: z.object({ session: z.string().uuid().optional(), q: z.string().max(500).optional() }),
  head: () => ({
    meta: [
      { title: "Research agent — Filed Under" },
      { name: "description", content: "An AI analyst that reads SEC filings, prices, FRED data and the web, and cites every source." },
      { property: "og:title", content: "Research agent — Filed Under" },
      { property: "og:description", content: "An AI analyst that reads SEC filings, prices, FRED data and the web, and cites every source." },
    ],
  }),
  component: Research,
});

export interface Step {
  kind: "tool" | "web";
  name: string;
  args?: Record<string, unknown>;
  summary: string;
  status: "running" | "done" | "error";
  sources?: { url: string; title?: string }[];
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: Step[];
  created_at: string;
  pending?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  "How fast is NVIDIA's Data Center business growing, and what did management say drives it?",
  "Compare capex intensity at Microsoft, Amazon and Alphabet over the last 8 quarters.",
  "Has Apple's Services gross margin advantage widened? Cite the 10-K.",
  "What are Tesla's biggest risk factors in its latest 10-Q, and how have insiders traded?",
  "How do today's yield curve and credit spreads compare with a year ago?",
  "Who are Amazon's main competitors in cloud, and how does AWS margin compare with Azure's disclosures?",
];

const MAX_STEPS = 10;

function Research() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const [input, setInput] = useState(search.q ?? "");
  const [deep, setDeep] = useState(false);
  const [live, setLive] = useState<Msg[] | null>(null);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const sessionId = search.session;

  const sessions = useQuery({
    queryKey: ["research-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("research_sessions").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const messages = useQuery({
    queryKey: ["research-messages", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase.from("research_messages").select("*").eq("session_id", sessionId!).order("created_at");
      if (error) throw error;
      return data.map((m) => ({ ...m, role: m.role as Msg["role"], steps: (m.steps ?? []) as unknown as Step[] }));
    },
  });

  useEffect(() => {
    if (!busy) setLive(null);
  }, [sessionId, busy]);

  const shown: Msg[] = live ?? (sessionId ? (messages.data ?? []) : []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [shown.length, shown.at(-1)?.steps.length, shown.at(-1)?.content]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("research_sessions").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["research-sessions"] });
      if (id === sessionId) navigate({ search: {} });
    },
  });

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    stopRef.current = false;
    setInput("");
    const userId = await currentUserId().catch((e) => {
      toast.error((e as Error).message);
      return null;
    });
    if (!userId) return setBusy(false);

    let sid = sessionId;
    const history = sid ? (messages.data ?? []) : [];
    try {
      if (!sid) {
        const { data, error } = await supabase.from("research_sessions").insert({ user_id: userId, title: q.slice(0, 60) }).select("id").single();
        if (error) throw error;
        sid = data.id;
        titleSession({ data: { question: q } })
          .then((title) => supabase.from("research_sessions").update({ title }).eq("id", sid!))
          .then(() => qc.invalidateQueries({ queryKey: ["research-sessions"] }));
        navigate({ search: { session: sid } });
      }
      await supabase.from("research_messages").insert({ session_id: sid, user_id: userId, role: "user", content: q });
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
      return;
    }

    const now = new Date().toISOString();
    const userMsg: Msg = { id: `u-${now}`, role: "user", content: q, steps: [], created_at: now };
    const asst: Msg = { id: `a-${now}`, role: "assistant", content: "", steps: [], created_at: now, pending: true };
    const base = [...history, userMsg];
    const update = (patch: Partial<Msg>) => {
      Object.assign(asst, patch);
      setLive([...base, { ...asst, steps: [...asst.steps] }]);
    };
    update({});

    const items: Record<string, unknown>[] = [
      ...history.slice(-12).map((m) => ({ role: m.role, content: m.content || "(no answer)" })),
      { role: "user", content: q },
    ];

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current) throw new Error("Stopped");
        const forceAnswer = step === MAX_STEPS - 1;
        if (forceAnswer) items.push({ role: "user", content: "Tool budget reached. Write the best answer you can from what you have, noting gaps." });
        const res = await agentStep({ data: { items, effort: deep ? "high" : "medium" } });
        const out = JSON.parse(res.outputJson) as AgentOutputItem[];
        const calls = out.filter((o) => o.type === "function_call");
        for (const o of out) {
          if (o.type === "web_search_call") {
            const action = o.action as { query?: string; queries?: string[]; sources?: { url: string; title?: string }[] } | undefined;
            asst.steps.push({ kind: "web", name: "web_search", summary: action?.query ?? action?.queries?.join(" · ") ?? "web", status: "done", sources: action?.sources?.slice(0, 6) });
          }
          if (o.type === "message") {
            const parts = (o.content as { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[]) ?? [];
            const text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
            const cites = parts.flatMap((p) => p.annotations ?? []).filter((a) => a.type === "url_citation" && a.url);
            if (cites.length) {
              asst.steps.push({ kind: "web", name: "sources", summary: `${cites.length} web sources cited`, status: "done", sources: dedupe(cites.map((c) => ({ url: c.url!.replace(/[?&]utm_source=openai/, ""), title: c.title }))) });
            }
            if (!calls.length) asst.content = text;
          }
          // Keep everything (reasoning carries encrypted state) except our UI-only fields.
          items.push(o);
        }
        update({});
        if (!calls.length) break;
        await Promise.all(
          calls.map(async (c) => {
            const name = String(c.name);
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(String(c.arguments ?? "{}"));
            } catch {
              /* malformed args */
            }
            const st: Step = { kind: "tool", name, args, summary: "…", status: "running" };
            asst.steps.push(st);
            update({});
            try {
              const r = await runTool(qc, name, args);
              st.summary = r.summary;
              st.status = "done";
              items.push({ type: "function_call_output", call_id: c.call_id, output: r.output });
            } catch (e) {
              st.summary = (e as Error).message;
              st.status = "error";
              items.push({ type: "function_call_output", call_id: c.call_id, output: `ERROR: ${(e as Error).message}` });
            }
            update({});
          }),
        );
      }
      if (!asst.content) asst.content = "I couldn't complete an answer within the tool budget. Try narrowing the question.";
    } catch (e) {
      const msg = (e as Error).message;
      asst.content = asst.content || (msg === "Stopped" ? "_Stopped._" : "");
      asst.error = msg === "Stopped" ? undefined : msg;
    }
    asst.pending = false;
    update({});
    const steps = asst.steps.map((s) => ({ ...s, status: s.status === "running" ? "error" : s.status }));
    await supabase.from("research_messages").insert({
      session_id: sid,
      user_id: userId,
      role: "assistant",
      content: asst.error ? `${asst.content}\n\n> Error: ${asst.error}` : asst.content,
      steps: steps as never,
    });
    await supabase.from("research_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sid!);
    await qc.invalidateQueries({ queryKey: ["research-messages", sid] });
    qc.invalidateQueries({ queryKey: ["research-sessions"] });
    setBusy(false);
  }

  return (
    <div className="-mx-4 -mb-16 -mt-6 grid h-[calc(100dvh-3rem)] grid-cols-1 lg:-mx-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="hidden flex-col border-r bg-sidebar lg:flex">
        <div className="p-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => navigate({ search: {} })} disabled={busy}>
            <MessageSquarePlus /> New research
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
          <p className="eyebrow px-2 pb-1.5">History</p>
          {sessions.isLoading && <Skeleton className="mx-2 h-24" />}
          {(sessions.data ?? []).map((s) => (
            <div key={s.id} className={cn("group flex items-center rounded-md", s.id === sessionId ? "bg-secondary" : "hover:bg-secondary/60")}>
              <button onClick={() => !busy && navigate({ search: { session: s.id } })} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                <span className="block truncate text-[13px]">{s.title}</span>
                <span className="block text-[10.5px] text-muted-foreground">{fmtRelative(s.updated_at)}</span>
              </button>
              <button onClick={() => del.mutate(s.id)} className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:text-negative group-hover:opacity-100" aria-label="Delete session">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {sessions.data && !sessions.data.length && <p className="px-2 text-xs text-muted-foreground">Your research sessions are saved here.</p>}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-3xl px-5 py-8">
            {!shown.length && !messages.isLoading ? (
              <div className="pt-6">
                <p className="eyebrow">Research agent</p>
                <h1 className="mt-2 font-display text-[2.6rem] leading-[1.05]">
                  Ask anything. <span className="hl">Every number cited.</span>
                </h1>
                <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                  The agent pulls statements and segments from SEC XBRL, reads 10-K, 10-Q and 8-K text, checks prices, insider trades and FRED, and searches the web — then shows you each source.
                </p>
                <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => ask(s)} className="rounded-lg border bg-card p-3 text-left text-[13px] leading-snug shadow-paper transition-colors hover:border-rule hover:bg-secondary/60">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-8">
                {messages.isLoading && !live && <Skeleton className="h-40" />}
                {shown.map((m) => (m.role === "user" ? <UserBubble key={m.id} text={m.content} /> : <AssistantMessage key={m.id} m={m} />))}
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <div className="border-t bg-background/95 px-5 py-3 backdrop-blur">
          <form
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-card p-2 shadow-paper focus-within:border-rule"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              rows={1}
              placeholder={sessionId ? "Ask a follow-up…" : "Ask about a company, a filing, the macro…"}
              className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              maxLength={2000}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => setDeep((d) => !d)}
              className={cn("shrink-0 rounded-md border px-2 py-1.5 text-[11px]", deep ? "border-foreground bg-ink text-ink-foreground" : "text-muted-foreground")}
              title="Deeper reasoning takes longer"
            >
              {deep ? "Deep" : "Standard"}
            </button>
            {busy ? (
              <Button type="button" size="icon" variant="outline" onClick={() => (stopRef.current = true)} aria-label="Stop">
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon" variant="ink" disabled={!input.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            )}
          </form>
          <p className="mx-auto mt-1.5 max-w-3xl text-center text-[10.5px] text-muted-foreground">AI can make mistakes — open the cited filings to verify. Not investment advice.</p>
        </div>
      </section>
    </div>
  );
}

function dedupe<T extends { url: string }>(xs: T[]) {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-[14px] text-ink-foreground">{text}</p>
    </div>
  );
}

function AssistantMessage({ m }: { m: Msg }) {
  const [open, setOpen] = useState(!!m.pending);
  useEffect(() => {
    if (m.pending) setOpen(true);
  }, [m.pending]);
  const toolSteps = m.steps.filter((s) => s.name !== "sources");
  const sources = useMemo(() => dedupe(m.steps.flatMap((s) => (s.name === "sources" ? (s.sources ?? []) : []))), [m.steps]);
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex size-6 items-center justify-center rounded-full border bg-card">
          <Bot className="size-3.5" />
        </span>
        <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 hover:text-foreground">
          {m.pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          {m.pending ? "Researching" : "Researched"} · {toolSteps.length} step{toolSteps.length === 1 ? "" : "s"}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && toolSteps.length > 0 && (
        <ol className="ml-3 grid grid-cols-1 gap-1 border-l pl-4">
          {toolSteps.map((s, i) => (
            <li key={i} className="text-[12px]">
              <span className="flex items-center gap-1.5">
                {s.status === "running" ? (
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                ) : s.status === "error" ? (
                  <TriangleAlert className="size-3 text-negative" />
                ) : s.kind === "web" ? (
                  <Globe className="size-3 text-muted-foreground" />
                ) : (
                  <Wrench className="size-3 text-muted-foreground" />
                )}
                <span className="font-medium">{TOOL_LABELS[s.name] ?? s.name}</span>
                <span className="truncate text-muted-foreground">{s.summary}</span>
              </span>
              {s.sources && s.sources.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1 pl-4.5">
                  {s.sources.slice(0, 4).map((src, j) => (
                    <a key={`${src.url}-${j}`} href={src.url} target="_blank" rel="noreferrer" className="max-w-56 truncate rounded border bg-card px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground">
                      {hostOf(src.url)}
                    </a>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {m.content ? (
        <ResearchMarkdown className="text-[14.5px] leading-relaxed">{m.content}</ResearchMarkdown>
      ) : m.pending ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : null}
      {m.error && (
        <p className="flex items-center gap-1.5 rounded-md border border-negative/30 bg-negative-soft px-3 py-2 text-sm text-negative">
          <TriangleAlert className="size-4" /> {m.error}
        </p>
      )}
      {sources.length > 0 && !m.pending && (
        <div>
          <p className="eyebrow mb-1.5">Web sources</p>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s, i) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="max-w-72 truncate rounded-md border bg-card px-2 py-1 text-[11px] hover:bg-secondary" title={s.title}>
                <span className="num mr-1 text-muted-foreground">{i + 1}</span>
                {s.title ?? hostOf(s.url)}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
