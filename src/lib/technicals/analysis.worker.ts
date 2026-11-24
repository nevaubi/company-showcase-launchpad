/// <reference lib="webworker" />
// Runs one symbol's analysis off the main thread: ten to nineteen years of daily bars, about ninety
// forward-return tests and their bootstrap intervals take a few hundred milliseconds on a slow machine,
// which would otherwise freeze the page while it loads.
import { analyze, type AnalysisInput } from "./analysis";

self.onmessage = (e: MessageEvent<{ id: number; input: AnalysisInput }>) => {
  const { id, input } = e.data;
  try {
    self.postMessage({ id, ok: true, data: analyze(input) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
