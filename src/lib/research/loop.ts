// Shared multi-step agent loop (server reasoning step ⇄ browser tool execution), used by the side-panel assistant.
import type { QueryClient } from "@tanstack/react-query";
import { agentStep, type AgentOutputItem } from "@/lib/research.functions";
import { runTool, type AgentCtx } from "@/lib/research/execute";

export interface Step {
  kind: "tool" | "web";
  name: string;
  args?: Record<string, unknown>;
  summary: string;
  status: "running" | "done" | "error";
  sources?: { url: string; title?: string }[];
}

export interface Turn {
  content: string;
  steps: Step[];
  error?: string;
}

const dedupe = <T extends { url: string }>(xs: T[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
};

export async function runAgent(opts: {
  qc: QueryClient;
  items: Record<string, unknown>[];
  deep: boolean;
  ctx?: AgentCtx;
  stopped: () => boolean;
  onUpdate: (t: Turn) => void;
}): Promise<Turn> {
  const { qc, items, deep, ctx, stopped, onUpdate } = opts;
  const turn: Turn = { content: "", steps: [] };
  const emit = () => onUpdate({ ...turn, steps: [...turn.steps] });
  const maxSteps = deep ? 24 : 12;
  try {
    for (let step = 0; step < maxSteps; step++) {
      if (stopped()) throw new Error("Stopped");
      if (step === maxSteps - 1) items.push({ role: "user", content: "Tool budget reached. Write the best answer you can from what you have, noting gaps." });
      const res = await agentStep({ data: { items, effort: deep ? "high" : "medium" } });
      const out = JSON.parse(res.outputJson) as AgentOutputItem[];
      const calls = out.filter((o) => o.type === "function_call");
      for (const o of out) {
        if (o.type === "web_search_call") {
          const a = o.action as { query?: string; sources?: { url: string; title?: string }[] } | undefined;
          turn.steps.push({ kind: "web", name: "web_search", summary: a?.query ?? "web", status: "done", sources: a?.sources?.slice(0, 6) });
        }
        if (o.type === "message") {
          const parts = (o.content as { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[]) ?? [];
          const text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
          const cites = parts.flatMap((p) => p.annotations ?? []).filter((a) => a.type === "url_citation" && a.url);
          if (cites.length) turn.steps.push({ kind: "web", name: "sources", summary: `${cites.length} web sources cited`, status: "done", sources: dedupe(cites.map((c) => ({ url: c.url!, title: c.title }))) });
          if (!calls.length) turn.content = text;
        }
        items.push(o);
      }
      emit();
      if (!calls.length) break;
      await Promise.all(
        calls.map(async (c) => {
          const name = String(c.name);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(String(c.arguments ?? "{}"));
          } catch {
            /* malformed */
          }
          const st: Step = { kind: "tool", name, args, summary: "…", status: "running" };
          turn.steps.push(st);
          emit();
          try {
            const r = await runTool(qc, name, args, ctx);
            st.summary = r.summary;
            st.status = "done";
            items.push({ type: "function_call_output", call_id: c.call_id, output: r.output });
          } catch (e) {
            st.summary = (e as Error).message;
            st.status = "error";
            items.push({ type: "function_call_output", call_id: c.call_id, output: `ERROR: ${(e as Error).message}` });
          }
          emit();
        }),
      );
    }
    if (!turn.content) turn.content = "I couldn't complete an answer within the tool budget. Try narrowing the question.";
  } catch (e) {
    const msg = (e as Error).message;
    turn.content = turn.content || (msg === "Stopped" ? "_Stopped._" : "");
    turn.error = msg === "Stopped" ? undefined : msg;
  }
  turn.steps = turn.steps.map((s) => ({ ...s, status: s.status === "running" ? "error" : s.status }));
  emit();
  return turn;
}
