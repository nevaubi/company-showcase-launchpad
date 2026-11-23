// Browser entry to the analysis: one shared web worker, with the main thread as the fallback where a
// worker cannot start (old browsers, strict content policies, tests).
import type { AnalysisInput, Technicals } from "./analysis";

type Reply = { id: number; ok: boolean; data?: Technicals | null; error?: string };

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, { resolve: (t: Technicals | null) => void; reject: (e: Error) => void; input: AnalysisInput }>();

async function onMain(input: AnalysisInput) {
  const { analyze } = await import("./analysis");
  return analyze(input);
}

function start(): Worker | null {
  if (worker || broken || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.data ?? null);
    else w.reject(new Error(e.data.error ?? "The analysis could not be computed"));
  };
  worker.onerror = (e) => {
    // The worker failed to load or crashed: finish everything that was waiting on the main thread.
    e.preventDefault?.();
    broken = true;
    worker?.terminate();
    worker = null;
    const pending = [...waiting.values()];
    waiting.clear();
    for (const w of pending) onMain(w.input).then(w.resolve, w.reject);
  };
  return worker;
}

/** One symbol's technical analysis; never blocks the page while a worker is available. */
export function runAnalysis(input: AnalysisInput): Promise<Technicals | null> {
  const w = start();
  if (!w) return onMain(input);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, input });
    w.postMessage({ id, input });
  });
}
