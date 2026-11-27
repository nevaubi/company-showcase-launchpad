import type { IrPayload } from "./payload";

// Pure: how large a stored IR payload the page fetches. A bank with thousands of read files can hold a
// payload no browser page loads (47 MB did not render; 19 MB takes about 20 s); until its bounded
// rebuild the page says so and lists the documents instead of hanging.

/** Largest stored payload the page fetches, in bytes of JSON. */
export const IR_PAYLOAD_VIEW_MAX = 32_000_000;

/** The stored size when it is beyond what the page fetches, else 0. */
export function oversizeOf(payloadBytes: number | null | undefined): number {
  const n = Number(payloadBytes ?? 0);
  return Number.isFinite(n) && n > IR_PAYLOAD_VIEW_MAX ? n : 0;
}

export interface IrRequestedPeriod {
  end: string;
  frequency: "q" | "y" | "m";
}

export function containsIrPeriod(payload: IrPayload | null, period?: IrRequestedPeriod): boolean {
  if (!payload?.series.length) return false;
  if (!period) return true;
  return payload.series.some((s) => {
    const cells = period.frequency === "y" ? s.y : period.frequency === "m" ? s.mo : s.q;
    return cells?.[period.end] !== undefined;
  });
}

/** Native observations retain their filing metadata even if an upstream archive has more rows. */
export async function selectIrPayload(
  cached: IrPayload | null,
  period: IrRequestedPeriod | undefined,
  readNative: () => Promise<IrPayload | null>,
  readArchive: () => Promise<IrPayload | null>,
): Promise<{ payload: IrPayload | null; source?: "partner" }> {
  if (containsIrPeriod(cached, period)) return { payload: cached };
  const native = await readNative();
  if (containsIrPeriod(native, period)) return { payload: native };
  const archived = await readArchive();
  return containsIrPeriod(archived, period)
    ? { payload: archived, source: "partner" }
    : { payload: null };
}
