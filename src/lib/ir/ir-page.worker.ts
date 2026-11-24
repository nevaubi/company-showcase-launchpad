/// <reference lib="webworker" />
// Unpacks, tidies and checks an IR page payload off the main thread: a bank's payload holds 10,000+
// lines and the merge pass over it takes about a second, which would otherwise freeze the page. It
// also runs the SEC cross-check later for a page whose statements arrived after it was shown.
import type { IrPageData } from "./client";
import type { CheckStatements } from "./sec-check";
import { checkLate, unpackIrPage } from "./unpack";

type Msg = ArrayBuffer | { bytes: ArrayBuffer; statements?: CheckStatements | null } | { late: IrPageData; statements: CheckStatements | null };

self.onmessage = async (e: MessageEvent<Msg>) => {
  try {
    const msg = e.data;
    if (!(msg instanceof ArrayBuffer) && "late" in msg) {
      self.postMessage({ ok: true, data: checkLate(msg.late, msg.statements) });
      return;
    }
    const m = msg instanceof ArrayBuffer ? { bytes: msg, statements: null } : msg;
    self.postMessage({ ok: true, data: await unpackIrPage(m.bytes, m.statements) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
