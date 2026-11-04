// Browser entry for the IR workbook export: runs the build in a worker, falling back to the main
// thread if the worker can't start (older browsers, blocked worker scripts).
import type { IrExportOptions, IrExportStats } from "./ir-xlsx";

class WorkerUnavailable extends Error {}

export async function exportIrWorkbook(o: IrExportOptions): Promise<{ blob: Blob; stats: IrExportStats }> {
  if (typeof Worker !== "undefined") {
    try {
      return await new Promise((resolve, reject) => {
        let w: Worker;
        try {
          w = new Worker(new URL("./ir-xlsx.worker.ts", import.meta.url), { type: "module" });
        } catch (e) {
          reject(new WorkerUnavailable((e as Error).message));
          return;
        }
        w.onmessage = (e: MessageEvent<{ ok: boolean; blob?: Blob; stats?: IrExportStats; error?: string }>) => {
          w.terminate();
          if (e.data.ok && e.data.blob && e.data.stats) resolve({ blob: e.data.blob, stats: e.data.stats });
          else reject(new Error(e.data.error ?? "The workbook could not be built"));
        };
        w.onerror = (e) => {
          w.terminate();
          e.preventDefault();
          reject(new WorkerUnavailable(e.message || "worker failed to start"));
        };
        w.postMessage(o);
      });
    } catch (e) {
      if (!(e instanceof WorkerUnavailable)) throw e;
      console.warn("Excel export: building on the main thread —", e.message);
    }
  }
  const { irWorkbookBlob } = await import("./ir-xlsx");
  return irWorkbookBlob(o);
}
