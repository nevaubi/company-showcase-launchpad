// Shared multi-step agent loop (server reasoning step ⇄ browser tool execution), used by the side-panel assistant.
// Handles: live reasoning summaries, a model-maintained plan, clarifying questions (pauses for the user),
// transient-error retries, context compaction, approach restarts after repeated failures and a
// self-review pass in deep mode.
import type { QueryClient } from "@tanstack/react-query";
import { agentStep, type AgentOutputItem } from "@/lib/research.functions";
import { runTool, type AgentCtx } from "@/lib/research/execute";
import type { Pin } from "@/lib/research/dom-agent";

export interface Step {
  kind: "tool" | "web" | "think";
  name: string;
  args?: Record<string, unknown>;
  summary: string;
  status: "running" | "done" | "error";
  sources?: { url: string; title?: string }[];
  output?: string;
  ms?: number;
  /** The agent's one-line reason for an action, shown as narration. */
  why?: string;
  /** Epoch ms the step started (for live timers). */
  startedAt?: number;
  /** Tool calls issued in the same model step share a batch number. */
  batch?: number;
  /** Set on highlight and guide steps: the numbered stops left on the page. */
  pins?: Pin[];
}

export interface Plan {
  goal: string;
  steps: { title: string; status: "todo" | "doing" | "done" | "dropped" }[];
  notes: string;
}

export interface Turn {
  content: string;
  steps: Step[];
  plan?: Plan;
  /** Live phase label for the shimmer line */
  phase?: string;
  /** What the agent is doing, for the loader variant. */
  activity?: "thinking" | "working" | "browsing";
  error?: string;
}

export interface Question {
  question: string;
  options: string[];
}

const dedupe = <T extends { url: string }>(xs: T[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
};

/** Shrink old tool outputs so long runs stay under the request limit while keeping the recent window intact. */
export function compact(items: Record<string, unknown>[], budget = 700_000) {
  let size = JSON.stringify(items).length;
  for (let i = 0; i < items.length - 6 && size > budget; i++) {
    const it = items[i];
    if (it.type === "function_call_output" && typeof it.output === "string" && it.output.length > 600) {
      const o = it.output as string;
      const before = o.length;
      it.output = `${o.slice(0, 500)}\n…[older output compacted]`;
      size -= before - (it.output as string).length;
    }
  }
  return size;
}

const TRANSIENT = /timeout|timed out|fetch failed|network|502|503|504|429|rate|overloaded|ECONN/i;

async function stepWithRetry(items: Record<string, unknown>[], effort: "medium" | "high", stopped: () => boolean) {
  let last: unknown;
  for (let a = 0; a < 3; a++) {
    if (stopped()) throw new Error("Stopped");
    try {
      return await agentStep({ data: { items, effort } });
    } catch (e) {
      last = e;
      const m = (e as Error).message ?? "";
      if (/too long/i.test(m)) compact(items, 400_000);
      else if (!TRANSIENT.test(m)) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
    }
  }
  throw last;
}

export async function runAgent(opts: {
  qc: QueryClient;
  items: Record<string, unknown>[];
  deep: boolean;
  ctx?: AgentCtx;
  stopped: () => boolean;
  onUpdate: (t: Turn) => void;
  /** Resolve with the user's answer to a clarifying question */
  onAsk?: (q: Question) => Promise<string>;
}): Promise<Turn> {
  const { qc, items, deep, ctx, stopped, onUpdate, onAsk } = opts;
  const turn: Turn = { content: "", steps: [], phase: "Thinking" };
  const emit = () => onUpdate({ ...turn, steps: [...turn.steps] });
  const maxSteps = deep ? 32 : 14;
  let reviewed = !deep;
  let failStreak = 0;
  try {
    for (let step = 0; step < maxSteps; step++) {
      if (stopped()) throw new Error("Stopped");
      if (step === maxSteps - 1) items.push({ role: "user", content: "Tool budget reached. Write the best answer you can from what you have, noting gaps." });
      compact(items);
      turn.phase = step === 0 ? "Thinking" : "Reasoning over results";
      turn.activity = "thinking";
      emit();
      const res = await stepWithRetry(items, deep ? "high" : "medium", stopped);
      const out = JSON.parse(res.outputJson) as AgentOutputItem[];
      const calls = out.filter((o) => o.type === "function_call");
      let text = "";
      for (const o of out) {
        if (o.type === "reasoning") {
          const sum = ((o.summary as { text?: string }[] | undefined) ?? []).map((x) => x.text ?? "").join("\n").trim();
          if (sum) turn.steps.push({ kind: "think", name: "reasoning", summary: sum.split("\n")[0].replace(/\*\*/g, "").slice(0, 120), output: sum, status: "done" });
        }
        if (o.type === "web_search_call") {
          const a = o.action as { query?: string; sources?: { url: string; title?: string }[] } | undefined;
          turn.steps.push({ kind: "web", name: "web_search", summary: a?.query ?? "hosted search", status: "done", sources: a?.sources?.slice(0, 8) });
        }
        if (o.type === "message") {
          const parts = (o.content as { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[]) ?? [];
          text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
          const cites = parts.flatMap((p) => p.annotations ?? []).filter((a) => a.type === "url_citation" && a.url);
          if (cites.length) turn.steps.push({ kind: "web", name: "sources", summary: `${cites.length} web sources cited`, status: "done", sources: dedupe(cites.map((c) => ({ url: c.url!, title: c.title }))) });
        }
        items.push(o);
      }
      if (!calls.length) {
        if (!reviewed && turn.steps.filter((s) => s.kind !== "think").length >= 3) {
          // One self-review pass: the model checks its draft and either does more work or restates the answer.
          reviewed = true;
          turn.content = text;
          turn.phase = "Reviewing the draft";
          emit();
          items.push({
            role: "user",
            content:
              "[Self-review — not from the user] Check your draft critically: any number without a tool source, any part of the question unanswered, any contradiction between sources, any stale data? If more work is needed, update_plan and call tools. Otherwise reply with the final answer in full (revised if needed). Don't mention this review.",
          });
          continue;
        }
        turn.content = text || turn.content;
        break;
      }
      turn.phase = calls.length > 1 ? `Running ${calls.length} tools in parallel` : "Working";
      turn.activity = calls.some((c) => String(c.name).startsWith("browser_")) ? "browsing" : "working";
      const batch = step;
      emit();
      let failed = 0;
      // Plan / question tools are handled by the loop itself, the rest by the browser executor.
      await Promise.all(
        calls.map(async (c) => {
          const name = String(c.name);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(String(c.arguments ?? "{}"));
          } catch {
            /* malformed */
          }
          const reply = (output: string) => items.push({ type: "function_call_output", call_id: c.call_id, output });
          if (name === "update_plan") {
            turn.plan = { goal: String(args.goal ?? ""), steps: (args.steps as Plan["steps"]) ?? [], notes: String(args.notes ?? "") };
            reply("Plan updated.");
            return emit();
          }
          if (name === "ask_user") {
            const q = { question: String(args.question ?? ""), options: ((args.options as string[]) ?? []).slice(0, 4) };
            const st: Step = { kind: "tool", name, args, summary: q.question, status: "running", startedAt: Date.now(), batch };
            turn.steps.push(st);
            turn.phase = "Waiting for your answer";
            emit();
            const answer = onAsk ? await onAsk(q) : "No answer — make a sensible assumption and state it.";
            st.status = "done";
            st.output = answer;
            reply(`User answered: ${answer}`);
            return emit();
          }
          const st: Step = {
            kind: "tool",
            name,
            args,
            summary: "",
            status: "running",
            why: typeof args.why === "string" && args.why.trim() ? args.why.trim().slice(0, 200) : undefined,
            startedAt: Date.now(),
            batch,
          };
          turn.steps.push(st);
          emit();
          const t0 = performance.now();
          try {
            const r = await runTool(qc, name, args, ctx);
            st.summary = r.summary;
            st.output = r.output.slice(0, 4000);
            st.status = "done";
            st.pins = r.pins;
            reply(r.output);
          } catch (e) {
            failed++;
            st.summary = (e as Error).message;
            st.status = "error";
            reply(`ERROR: ${(e as Error).message}`);
          }
          st.ms = Math.round(performance.now() - t0);
          emit();
        }),
      );
      failStreak = failed && failed === calls.length ? failStreak + 1 : 0;
      if (failStreak >= 2) {
        failStreak = 0;
        items.push({ role: "user", content: "[Note — not from the user] Your last tool calls all failed. Step back, update_plan with a different approach (other tools, sources or queries) and continue." });
      }
    }
    if (!turn.content) turn.content = "I couldn't complete an answer within the tool budget. Try narrowing the question.";
  } catch (e) {
    const msg = (e as Error).message;
    turn.content = turn.content || (msg === "Stopped" ? "_Stopped._" : "");
    turn.error = msg === "Stopped" ? undefined : msg;
  }
  turn.phase = undefined;
  turn.activity = undefined;
  turn.steps = turn.steps.map((s) => ({ ...s, status: s.status === "running" ? "error" : s.status }));
  emit();
  return turn;
}
