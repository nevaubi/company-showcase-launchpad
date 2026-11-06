// Browser-side comparison for filing pairs that weren't precomputed. Call from effects/handlers only.
import { buildRedline, compactRedline, type Redline } from "./core";

export function computeRedlineInBrowser(input: Parameters<typeof buildRedline>[0]): Promise<Redline> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL("./redline.worker.ts", import.meta.url), { type: "module" });
    } catch {
      // No worker support: run inline (slower, blocks briefly).
      try { resolve(compactRedline(buildRedline(input))); } catch (e) { reject(e); }
      return;
    }
    w.onmessage = (e: MessageEvent<{ ok: boolean; redline?: Redline; error?: string }>) => {
      w.terminate();
      if (e.data.ok && e.data.redline) resolve(e.data.redline); else reject(new Error(e.data.error ?? "Comparison failed"));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "Comparison failed")); };
    w.postMessage(input);
  });
}
