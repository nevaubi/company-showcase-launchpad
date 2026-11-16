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
export async function loadIrPage(ticker: string, fetchIr: IrFetch = getIrData): Promise<IrPageData> {
  const { gz } = await fetchIr({ data: { ticker } });
  const json = await new Response((gz as ReadableStream<BufferSource>).pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(json) as IrPageData;
}

export const irPageKey = (ticker: string) => ["ir", ticker] as const;
