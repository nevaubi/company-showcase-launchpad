/// <reference lib="webworker" />
// Unpacks, tidies and checks an IR page payload off the main thread: a bank's payload holds 10,000+
// lines and the merge pass over it takes about a second, which would otherwise freeze the page.
import type { CheckStatements } from "./sec-check";
import { unpackIrPage } from "./unpack";

self.onmessage = async (e: MessageEvent<ArrayBuffer | { bytes: ArrayBuffer; statements?: CheckStatements | null }>) => {
  try {
    const msg = e.data instanceof ArrayBuffer ? { bytes: e.data, statements: null } : e.data;
    self.postMessage({ ok: true, data: await unpackIrPage(msg.bytes, msg.statements) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
