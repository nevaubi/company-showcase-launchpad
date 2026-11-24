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
  // A failure in the read-time checks never blanks the page: the tidied payload is shown and the
  // checks line says the check did not run (review iracc M3).
  let checked = tidied;
  let consistency: IrPageData["consistency"];
  try {
    ({ payload: checked, summary: consistency } = checkConsistency(tidied));
  } catch (e) {
    console.warn("IR consistency check failed", e);
  }
  let payload = checked;
  let check: ReturnType<typeof crossCheckSec>["check"] = null;
  try {
    ({ payload, check } = crossCheckSec(checked, statements));
  } catch (e) {
    console.warn("IR SEC cross-check failed", e);
    payload = checked;
    check = null;
  }
  const t3 = now();
  return {
    ...data,
    payload,
    secCheck: check ? { ...check, ms: Math.round(t3 - t2) } : null,
    consistency,
    timings: { unpackMs: Math.round(t1 - t0), tidyMs: Math.round(t2 - t1), checkMs: Math.round(t3 - t2) },
  };
}

/**
 * The SEC cross-check for a page shown before the company's statements arrived: the tidied and
 * consistency-checked payload is checked as it is, so the page keeps every figure where it was and
 * only gains its holds and flags. The same guard applies: a failure leaves the page as shown, and
 * no statements (or none with income lines) end the wait, so the checks line stops saying "not yet".
 */
export function checkLate(data: IrPageData, statements: CheckStatements | null | undefined): IrPageData {
  if (!data.payload || data.secCheck) return data.secCheckLate ? { ...data, secCheckLate: false } : data;
  const t0 = now();
  try {
    const { payload, check } = crossCheckSec(data.payload, statements);
    if (!check) return { ...data, secCheckLate: false };
    const ms = Math.round(now() - t0);
    return { ...data, payload, secCheck: { ...check, ms }, secCheckLate: false, ...(data.timings ? { timings: { ...data.timings, checkMs: data.timings.checkMs + ms } } : {}) };
  } catch (e) {
    console.warn("IR SEC cross-check failed", e);
    return { ...data, secCheckLate: false };
  }
}
