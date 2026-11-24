/// <reference lib="webworker" />
// Unpacks and tidies an IR page payload off the main thread: a bank's payload holds 10,000+ lines and
// the merge pass over it takes about a second, which would otherwise freeze the page while it loads.
import { unpackIrPage } from "./unpack";

self.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ ok: true, data: await unpackIrPage(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
