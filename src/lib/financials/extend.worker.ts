// Reads newer filings' inline XBRL into the statements off the main thread (10-K documents run to
// several megabytes and the builder pass takes ~100 ms per filing).
import { extendStatements, type Extension, type FiledReport } from "./extend";
import type { CompanyDataset } from "./types";

self.onmessage = (e: MessageEvent<{ dataset: CompanyDataset; reads: { filing: FiledReport; html: string }[] }>) => {
  try {
    const out: Extension = extendStatements(e.data.dataset, e.data.reads);
    (self as unknown as Worker).postMessage({ ok: true, out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
