// The IR page's data, shared by the page and the assistant so both read one cached copy.
import { getIrData, type IrDocRow } from "@/lib/ir.functions";
import type { ConsistencySummary } from "@/lib/ir/consistency";
import type { IrPayload } from "@/lib/ir/payload";
import type { CheckStatements, SecCheck } from "@/lib/ir/sec-check";

export interface IrPageData {
  payload: IrPayload | null;
  builtAt: string | null;
  documents: IrDocRow[];
  images: number;
  pending: number;
  source?: "partner";
  /** read-time cross-check against the SEC statements (null when they could not be loaded) */
  secCheck?: SecCheck | null;
  /** read-time quarters-against-year and formula checks */
  consistency?: ConsistencySummary;
  /** the statements were still loading when the IR data was ready, so the cross-check did not run */
  secCheckLate?: boolean;
  /** worker timings, ms */
  timings?: { unpackMs: number; tidyMs: number; checkMs: number };
}

/** The statement rows the cross-check needs, from a company dataset (null when it has none). */
export function checkStatementsOf(d: { statements?: { quarterly?: { income?: CheckStatement }; annual?: { income?: CheckStatement } } } | null | undefined): CheckStatements | null {
  const q = d?.statements?.quarterly?.income;
  const y = d?.statements?.annual?.income;
  if (!q && !y) return null;
  const slim = (s?: CheckStatement) => (s ? { periods: s.periods.map((p) => ({ end: p.end, start: p.start })), rows: s.rows.map((r) => ({ key: r.key, cells: r.cells.map((c) => (c ? { v: c.v, src: c.src ? { accn: c.src.accn, concept: c.src.concept } : undefined } : null)) })) } : null);
  return { quarterly: slim(q), annual: slim(y) };
}
type CheckStatement = NonNullable<CheckStatements["quarterly"]>;

/** Bank-sized payloads arrive as a gzipped byte stream (see getIrData); unpack it in the browser. */
type IrFetch = (opts: { data: { ticker: string } }) => Promise<{ gz: unknown }>;
class WorkerUnavailable extends Error {}
const STATEMENTS_WAIT_MS = 2500;

/**
 * Unpacking and tidying run in a web worker, so a bank-sized payload never freezes the page while
 * the loading state shows; the main thread is the fallback where a worker can't start.
 */
export async function loadIrPage(ticker: string, fetchIr: IrFetch = getIrData, getStatements?: () => Promise<CheckStatements | null>): Promise<IrPageData> {
  // The SEC statements for the cross-check load alongside; the page never waits on them failing.
  // Once the IR data is here, the statements get at most STATEMENTS_WAIT_MS more: the page is never
  // held back by them (the checks line then says the check did not run).
  const pending = getStatements ? getStatements().catch(() => null) : Promise.resolve(null);
  const { gz } = await fetchIr({ data: { ticker } });
  let late = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const statements = await Promise.race([pending, new Promise<null>((r) => (timer = setTimeout(() => ((late = true), r(null)), STATEMENTS_WAIT_MS)))]);
  clearTimeout(timer);
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
          if (e.data.ok && e.data.data) resolve(late ? { ...e.data.data, secCheckLate: true } : e.data.data);
          else reject(new Error(e.data.error ?? "The IR data could not be read"));
        };
        w.onerror = (e) => {
          w.terminate();
          e.preventDefault();
          reject(new WorkerUnavailable(e.message || "worker failed to start"));
        };
        // A copy goes to the worker: on a failed start the bytes are still here for the fallback.
        w.postMessage({ bytes: bytes.slice(0), statements });
      });
    } catch (e) {
      if (!(e instanceof WorkerUnavailable)) throw e;
      console.warn("IR page: tidying on the main thread —", e.message);
    }
  }
  const { unpackIrPage } = await import("./unpack");
  const data = await unpackIrPage(bytes, statements);
  return late ? { ...data, secCheckLate: true } : data;
}

export const irPageKey = (ticker: string) => ["ir", ticker] as const;
