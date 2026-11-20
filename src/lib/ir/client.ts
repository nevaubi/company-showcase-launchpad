// The IR page's data, shared by the page and the assistant so both read one cached copy.
import { getIrData, type IrDocRow } from "@/lib/ir.functions";
import type { IrPayload } from "@/lib/ir/payload";

export interface IrPageData {
  payload: IrPayload | null;
  builtAt: string | null;
  documents: IrDocRow[];
  images: number;
  pending: number;
  source?: "partner";
}

/** Bank-sized payloads arrive as a gzipped byte stream (see getIrData); unpack it in the browser. */
type IrFetch = (opts: { data: { ticker: string } }) => Promise<{ gz: unknown }>;
class WorkerUnavailable extends Error {}

/**
 * Unpacking and tidying run in a web worker, so a bank-sized payload never freezes the page while
 * the loading state shows; the main thread is the fallback where a worker can't start.
 */
export async function loadIrPage(ticker: string, fetchIr: IrFetch = getIrData): Promise<IrPageData> {
  const { gz } = await fetchIr({ data: { ticker } });
  const bytes = await new Response(gz as ReadableStream<BufferSource>).arrayBuffer();
  if (typeof Worker !== "undefined") {
    try {
      return await new Promise<IrPageData>((resolve, reject) => {
        let w: Worker;
        try {
          w = new Worker(new URL("./ir-page.worker.ts", import.meta.url), { type: "module" });
        } catch (e) {
          reject(new WorkerUnavailable((e as Error).message));
          return;
        }
        w.onmessage = (e: MessageEvent<{ ok: boolean; data?: IrPageData; error?: string }>) => {
          w.terminate();
          if (e.data.ok && e.data.data) resolve(e.data.data);
          else reject(new Error(e.data.error ?? "The IR data could not be read"));
        };
        w.onerror = (e) => {
          w.terminate();
          e.preventDefault();
          reject(new WorkerUnavailable(e.message || "worker failed to start"));
        };
        // A copy goes to the worker: on a failed start the bytes are still here for the fallback.
        w.postMessage(bytes.slice(0));
      });
    } catch (e) {
      if (!(e instanceof WorkerUnavailable)) throw e;
      console.warn("IR page: tidying on the main thread —", e.message);
    }
  }
  const { unpackIrPage } = await import("./unpack");
  return unpackIrPage(bytes);
}

export const irPageKey = (ticker: string) => ["ir", ticker] as const;
