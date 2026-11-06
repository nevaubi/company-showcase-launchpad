// Builds a filing comparison off the main thread (two multi-megabyte filings take a moment to parse).
import { buildRedline, compactRedline } from "./core";

self.onmessage = (e: MessageEvent<Parameters<typeof buildRedline>[0]>) => {
  try {
    (self as unknown as Worker).postMessage({ ok: true, redline: compactRedline(buildRedline(e.data)) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message || "Comparison failed" });
  }
};
