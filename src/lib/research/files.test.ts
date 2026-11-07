import { describe, expect, it } from "vitest";
import { buildFile, csvCell, fmtBytes, safeName, toCsv } from "./files";

// jsdom's Blob has no text()/arrayBuffer(); read through FileReader.
const read = (b: Blob, as: "text" | "buffer") =>
  new Promise<string | ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string | ArrayBuffer);
    r.onerror = () => reject(r.error);
    if (as === "text") r.readAsText(b);
    else r.readAsArrayBuffer(b);
  });
const text = (b: Blob) => read(b, "text") as Promise<string>;

describe("file deliverables", () => {
  it("escapes CSV cells and blocks formula injection", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x\ny"]])).toBe('a,b\r\n1,"x\ny"\r\n');
  });

  it("names files safely with the right extension", () => {
    expect(safeName("Semis R&D / intensity.csv", "csv")).toBe("Semis-RD-intensity.csv");
    expect(safeName("", "md")).toBe("file.md");
  });

  it("builds csv, md and json files", async () => {
    const csv = await buildFile({ format: "csv", name: "t", columns: ["Ticker", "PE"], rows: [["NVDA", 48.2]] });
    expect(csv.name).toBe("t.csv");
    expect(csv.mime).toMatch(/text\/csv/);
    expect(csv.preview).toContain("NVDA,48.2");
    const md = await buildFile({ format: "md", name: "memo", content: "# Memo" });
    expect(await text(md.blob)).toBe("# Memo");
    const json = await buildFile({ format: "json", name: "rows", columns: ["a"], rows: [[1], [2]] });
    expect(JSON.parse(await text(json.blob))).toEqual([{ a: 1 }, { a: 2 }]);
    const parsed = await buildFile({ format: "json", name: "obj", content: '{"x":1}' });
    expect(JSON.parse(await text(parsed.blob))).toEqual({ x: 1 });
  });

  it("builds an xlsx workbook", async () => {
    const x = await buildFile({ format: "xlsx", name: "book", columns: ["Ticker", "PE"], rows: [["NVDA", 48.2], ["=CMD", 1]] });
    expect(x.name).toBe("book.xlsx");
    expect(x.size).toBeGreaterThan(1000);
    const head = new Uint8Array((await read(x.blob, "buffer")) as ArrayBuffer).slice(0, 2);
    expect(String.fromCharCode(...head)).toBe("PK");
  });

  it("rejects bad input with a clear reason", async () => {
    await expect(buildFile({ format: "csv", name: "t", columns: ["a", "b"], rows: [["x"]] })).rejects.toThrow(/row 1 has 1 cells/);
    await expect(buildFile({ format: "json", name: "t", content: "{oops" })).rejects.toThrow(/not valid JSON/);
    await expect(buildFile({ format: "md", name: "t", content: " " })).rejects.toThrow(/need content/);
  });

  it("formats sizes", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
  });
});
