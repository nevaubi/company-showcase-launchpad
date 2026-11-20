// Gzipped IR page data → the page's data with the merge pass applied (shared by the worker and the
// main-thread fallback, so both give the same result).
import type { IrPageData } from "@/lib/ir/client";
import { tidyPayload } from "@/lib/ir/tidy";

export async function unpackIrPage(gz: ArrayBuffer): Promise<IrPageData> {
  const json = await new Response(new Response(gz).body!.pipeThrough(new DecompressionStream("gzip"))).text();
  const data = JSON.parse(json) as IrPageData;
  // Payloads built before the merge pass (or from the partner corpus) get it here: one table per subject.
  return data.payload ? { ...data, payload: tidyPayload(data.payload) } : data;
}
