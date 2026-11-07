/*
 * A scripted stand-in for a model, so the block runs with no props. It yields the same events a real `respond` would:
 * reasoning deltas, the sources, markdown deltas and a final usage report. Time is compressed so the preview stays snappy:
 * thinking plays in about a second and the answer arrives at roughly 110 words a second; the thinking time and duration it
 * reports are what the simulated model would have taken.
 */
import { answerScripts, type AnswerBlock, type AnswerModel, type AnswerSource } from "./ai-answer-data";
import { blocksToMarkdown, conciseBlocks } from "./ai-answer-markdown";

export type RegenerateMode = "answer" | "retry" | "concise" | "detailed" | "model";

export type AnswerEvent =
  /** A piece of the reasoning summary. */
  | { type: "reasoning"; text: string }
  /** The sources the answer cites, numbered in order: [1] is the first. Replaces any earlier list. */
  | { type: "sources"; sources: AnswerSource[] }
  /** Thinking finished and took this many seconds. Optional: without it, the time until the first text is used. */
  | { type: "thought"; seconds: number }
  /** A piece of the answer, as markdown. */
  | { type: "text"; text: string }
  /** The stream ended. Durations are in seconds; anything left out is measured on the client. */
  | { type: "done"; tokens?: number; seconds?: number; followUps?: string[] };

export interface AnswerRequest {
  question: string;
  /** Why this answer is being written: a first answer, or one of the regenerate options. */
  mode: RegenerateMode;
  model: AnswerModel;
  /** The answer being regenerated, as markdown. */
  previous?: string;
  /** Aborted when the person stops the answer or the block unmounts. */
  signal: AbortSignal;
}

export type AnswerResponder = (request: AnswerRequest) => AsyncIterable<AnswerEvent>;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const timer = window.setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
});

/** Splits text into chunks of a few words, keeping every space and newline, like tokens arriving from a model. */
function chunks(text: string, words: [number, number]) {
  const tokens = text.split(/(\s+)/);
  const out: string[] = [];
  let k = 0;
  while (k < tokens.length) {
    const size = words[0] + Math.floor(Math.random() * (words[1] - words[0] + 1));
    out.push(tokens.slice(k, k + size * 2).join(""));
    k += size * 2;
  }
  return out.filter(Boolean);
}

/** Output speed in tokens per second and a thinking factor per sample model. Sample values. */
const pace: Record<string, { tps: number; think: number }> = {
  "claude-fable-5-1": { tps: 42, think: 1.4 },
  "claude-opus-5-5": { tps: 58, think: 1 },
  "claude-sonnet-5-5": { tps: 76, think: .8 },
  "claude-haiku-5-5": { tps: 150, think: .45 },
};

const fallback: AnswerBlock[] = [
  { type: "paragraph", text: "This preview answers four sample questions about passkeys. Pass a `respond` function to stream answers from a real model for anything else." },
];

export const demoFollowUps = (question: string) => answerScripts.filter(script => script.question !== question).slice(0, 3).map(script => script.question);

export async function* demoRespond({ question, mode, model, previous, signal }: AnswerRequest): AsyncGenerator<AnswerEvent> {
  const script = answerScripts.find(item => item.question.toLowerCase() === question.trim().toLowerCase());
  const speed = pace[model.id] ?? pace["claude-opus-5-5"];

  // Thinking: the reasoning summary arrives in about a second; the sources land part way through, so the first words follow quickly.
  const reasoning = script?.reasoning ?? "The question is outside the sample script, so the preview explains how to connect a model.";
  const thinking = chunks(reasoning, [4, 8]);
  const step = Math.max(16, 900 / thinking.length);
  for (let k = 0; k < thinking.length; k++) {
    if (signal.aborted) return;
    yield { type: "reasoning", text: thinking[k] };
    if (script && k === Math.floor(thinking.length * .4)) yield { type: "sources", sources: script.sources };
    await sleep(step * (.7 + Math.random() * .6), signal);
  }
  await sleep(90, signal);

  const thought = Math.max(1, Math.round((script?.thought ?? 2) * speed.think * (mode === "concise" ? .7 : mode === "detailed" ? 1.25 : 1)));
  yield { type: "thought", seconds: thought };

  let blocks = script?.blocks ?? fallback;
  if (script && mode === "concise") blocks = conciseBlocks(script.blocks);
  if (script && mode === "detailed") blocks = [...script.blocks, ...script.extra];
  if (script && (mode === "retry" || mode === "model")) {
    // Alternate the opening, so each regenerated version reads differently from the one before it.
    const lead = previous?.startsWith(script.altLead.slice(0, 40)) ? (script.blocks[0] as Extract<AnswerBlock, { type: "paragraph" }>).text : script.altLead;
    blocks = [{ type: "paragraph", text: lead }, ...script.blocks.slice(1)];
  }
  const markdown = blocksToMarkdown(blocks);
  // Three to six words every 30 to 40ms: about 110 words a second, so a full answer lands in three to four seconds.
  for (const chunk of chunks(markdown, [3, 6])) {
    if (signal.aborted) return;
    yield { type: "text", text: chunk };
    await sleep(30 + Math.random() * 10, signal);
  }
  if (signal.aborted) return;

  const tokens = Math.round(markdown.length / 3.7);
  yield { type: "done", tokens: tokens + Math.round(reasoning.length / 3.7), seconds: Math.round((thought + tokens / speed.tps) * 10) / 10, followUps: demoFollowUps(script?.question ?? question) };
}
