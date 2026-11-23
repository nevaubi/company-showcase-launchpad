// Browser entry for the read-time extension: runs in a worker, or on the main thread when a worker
// cannot start.
import type { Extension, FiledReport } from "./extend";
import type { CompanyDataset } from "./types";

class WorkerUnavailable extends Error {}

export async function extendInBrowser(dataset: CompanyDataset, reads: { filing: FiledReport; html: string }[]): Promise<Extension> {
  if (typeof Worker !== "undefined") {
    try {
      return await new Promise<Extension>((resolve, reject) => {
        let w: Worker;
        try {
          w = new Worker(new URL("./extend.worker.ts", import.meta.url), { type: "module" });
        } catch (e) {
          reject(new WorkerUnavailable((e as Error).message));
          return;
        }
        w.onmessage = (e: MessageEvent<{ ok: boolean; out?: Extension; error?: string }>) => {
          w.terminate();
          if (e.data.ok && e.data.out) resolve(e.data.out);
          else reject(new Error(e.data.error ?? "The filing could not be read"));
        };
        w.onerror = (e) => {
          w.terminate();
          e.preventDefault();
          reject(new WorkerUnavailable(e.message || "worker failed to start"));
        };
        w.postMessage({ dataset, reads });
      });
    } catch (e) {
      if (!(e instanceof WorkerUnavailable)) throw e;
    }
  }
  const { extendStatements } = await import("./extend");
  return extendStatements(dataset, reads);
}
