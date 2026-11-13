import { describe, expect, it } from "vitest";
import { choosePage, doclingGrid, markdownRendition, pdfRendition, tableNumberCount, type DoclingCell } from "@/lib/ir/rendition";
import { parseTables } from "@/lib/ir/tables";

const cell = (t: string, h = false, o = true): DoclingCell => ({ t, h, o });
const table: DoclingCell[][] = [
  [cell("", true), cell("Three Months Ended June 30,", true), cell("Three Months Ended June 30,", true, false)],
  [cell("In millions"), cell("2026", true), cell("2025", true)],
  [cell("Total revenues"), cell("$ 106,096"), cell("$ 98,915")],
  [cell("Operating income"), cell("4,703"), cell("2,381")],
];
const layout = "                    Three Months Ended June 30,\nIn millions          2026        2025\nTotal revenues   $ 106,096   $ 98,915\nOperating income     4,703       2,381\n";

describe("pdf rendition", () => {
  it("uses Docling's tables when they hold the page's numbers", () => {
    expect(choosePage({ layoutText: layout, tables: [table] })).toBe("docling");
  });
  it("falls back to the layout grid when Docling dropped numbers", () => {
    const partial = table.slice(0, 3);
    expect(tableNumberCount(layout)).toBe(6);
    expect(choosePage({ layoutText: layout, tables: [partial] })).toBe("layout");
  });
  it("uses OCR output on a page without a text layer", () => {
    expect(choosePage({ layoutText: "  \n", tables: [table] })).toBe("ocr");
    expect(choosePage({ layoutText: "", tables: [] })).toBe("empty");
  });
  it("repeats spanning headers but never a spanning number", () => {
    const g = doclingGrid([[cell("Q2", true), cell("Q2", true, false)], [cell("12", false), cell("12", false, false)]]);
    expect(g.text).toEqual([["Q2", "Q2"], ["12", ""]]);
  });
  it("keeps every grid position as its own cell so DOM indexes match the reader", () => {
    const { html, stats } = pdfRendition({
      title: "t",
      layoutPages: [layout],
      docling: { pages: 1, items: [{ type: "text", page: 1, label: "text", text: "Results (in millions)" }, { type: "table", page: 1, rows: table }] },
    });
    expect(stats.docling).toBe(1);
    const [t] = parseTables(html);
    expect(t.rows[0][0]).toBe("Results (in millions)");
    expect(t.rows[3]).toEqual(["Total revenues", "$ 106,096", "$ 98,915"]);
    expect(html).toContain('data-page="1"');
  });
});

describe("scanned pages left to the page-image reader", () => {
  it("keeps OCR words searchable but emits no table cells", () => {
    const { html, stats } = pdfRendition({ title: "t", layoutPages: [""], docling: { pages: 1, items: [{ type: "table", page: 1, rows: table }] }, scanned: "text" });
    expect(stats.ocr).toBe(1);
    expect(html).toContain("Total revenues $ 106,096 $ 98,915");
    expect(parseTables(html).every((t) => t.rows.length === 0)).toBe(true);
  });
});

describe("markdown rendition", () => {
  it("turns pipe tables into tables and --- into pages", () => {
    const md = "# Deck\nIntro\n---\n| Metric | Q1 | Q2 |\n|---|---:|---:|\n| Revenue | 1,200 | 1,350 |\n| Members \\| total | 10 | 11 |\n";
    const r = markdownRendition(md, "Deck");
    expect(r.pages).toBe(2);
    expect(r.tables).toBe(1);
    const [t] = parseTables(r.html);
    expect(t.rows).toEqual([["Metric", "Q1", "Q2"], ["Revenue", "1,200", "1,350"], ["Members | total", "10", "11"]]);
    expect(r.html).toContain('data-page="2"');
  });
});
