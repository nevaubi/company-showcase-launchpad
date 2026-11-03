/// <reference lib="webworker" />
// Builds IR workbooks off the main thread: large banks produce ~50,000 source rows, which would
// otherwise freeze the page for several seconds while exceljs serialises.
import { irWorkbookBlob, type IrExportOptions } from "./ir-xlsx";

self.onmessage = async (e: MessageEvent<IrExportOptions>) => {
  try {
    const { blob, stats } = await irWorkbookBlob(e.data);
    self.postMessage({ ok: true, blob, stats });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
