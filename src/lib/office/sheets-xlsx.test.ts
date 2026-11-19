import { describe, expect, it } from "vitest";
import { loadExcel } from "@/lib/export/xlsx-theme";
import { blankSheet } from "@/lib/office/workbook";
import { workbookToXlsx } from "./sheets-xlsx";

describe("xlsx export", () => {
  it("writes a filled cell's fill and leaves its font colour unset, whatever the editor shows", async () => {
    const sh = {
      ...blankSheet("Model"),
      cells: { A1: "Revenue", B1: "Margin" },
      style: { A1: { b: true, fill: "#FFF2CC" }, B1: { fill: "#1F4E79", color: "#FFFFFF" } },
    };
    const blob = await workbookToXlsx({ sheets: [sh], active: 0 }, () => null);
    const X = await loadExcel();
    const book = new X.Workbook();
    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(blob);
    });
    await book.xlsx.load(buf);
    expect(book.creator).toBe("FiledUnder");
    const ws = book.getWorksheet("Model")!;
    const a1 = ws.getCell("A1");
    expect((a1.fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe("FFFFF2CC");
    expect(a1.font?.color).toBeUndefined();
    expect(ws.getCell("B1").font?.color?.argb).toBe("FFFFFFFF");
  });
});
