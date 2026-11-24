// Gzipped IR page data → the page's data with the merge pass and the read-time checks applied
// (shared by the worker and the main-thread fallback, so both give the same result).
import type { IrPageData } from "@/lib/ir/client";
import { checkConsistency } from "@/lib/ir/consistency";
import { crossCheckSec, type CheckStatements } from "@/lib/ir/sec-check";
import { tidyPayload } from "@/lib/ir/tidy";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export async function unpackIrPage(gz: ArrayBuffer, statements?: CheckStatements | null): Promise<IrPageData> {
  const t0 = now();
  const json = await new Response(new Response(gz).body!.pipeThrough(new DecompressionStream("gzip"))).text();
  const data = JSON.parse(json) as IrPageData;
  const t1 = now();
  if (!data.payload) return { ...data, timings: { unpackMs: Math.round(t1 - t0), tidyMs: 0, checkMs: 0 } };
  // Payloads built before the merge pass (or from the partner corpus) get it here: one table per subject.
  const tidied = tidyPayload(data.payload);
  const t2 = now();
  const { payload: checked, summary: consistency } = checkConsistency(tidied);
  const { payload, check } = crossCheckSec(checked, statements);
  const t3 = now();
  return {
    ...data,
    payload,
    secCheck: check ? { ...check, ms: Math.round(t3 - t2) } : null,
    consistency,
    timings: { unpackMs: Math.round(t1 - t0), tidyMs: Math.round(t2 - t1), checkMs: Math.round(t3 - t2) },
  };
}
