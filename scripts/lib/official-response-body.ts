import { open } from "node:fs/promises";

/** Persist exact response chunks within the refresh byte budget. */
export async function writeOfficialResponseBody(
  body: ReadableStream<Uint8Array>, filePath: string, signal: AbortSignal, maxBytes: number,
): Promise<number> {
  // Bun 1.2.23 can throw from releaseLock() when a fetched body finishes
  // buffering between its first access and getReader(). Lock before disk I/O.
  const reader = body.getReader();
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let bytes = 0;
  try {
    file = await open(filePath, "wx", 0o600);
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Official source exceeds the bounded refresh payload size");
      let offset = 0;
      while (offset < value.length) {
        const written = await file.write(value, offset, value.length - offset);
        if (!written.bytesWritten) throw new Error("Could not persist complete official response bytes");
        offset += written.bytesWritten;
      }
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally {
    try { await file?.close(); }
    finally { reader.releaseLock(); }
  }
  return bytes;
}
