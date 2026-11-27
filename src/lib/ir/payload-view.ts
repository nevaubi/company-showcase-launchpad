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
