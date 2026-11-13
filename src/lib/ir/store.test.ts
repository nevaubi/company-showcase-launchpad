import { describe, expect, it } from "vitest";
import { mergeStore, passages, renditionHtml, SHEET_MAX_ROWS, storeRow, type StoreDoc } from "./store";

const doc = (over: Partial<StoreDoc> = {}): StoreDoc => ({
  id: "32d9a99e210cb699",
  ticker: "AAPL",
  url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000024/a8-kex991q4202609262026.htm",
  title: "8-K 2026-11-02 a8-kex991q4202609262026.htm (Items 2.02,9.01)",
  doc_type: "release",
  fiscal_label: "Q4 FY26",
  period_end: "2026-09-26",
  published: "2026-11-02",
  ext: ".htm",
  bytes: 172148,
  storage_path: "AAPL/32d9a99e210cb699-a8-kex991q4202609262026.htm",
  text_path: "AAPL/text/32d9a99e210cb699-v2.json",
  pages: 1,
  fetched_at: "2026-11-03T10:28:58+00:00",
  ...over,
});

describe("IR store", () => {
  it("maps store documents to library rows", () => {
    const r = storeRow(doc());
    expect(r.id).toBe("store:32d9a99e210cb699");
    expect(r.kind).toBe("press-release");
    expect(r.accn).toBe("0000320193-26-000024");
    expect(r.ext).toBe("htm");
    expect(r.filed).toBe("2026-11-02");
  });

  it("skips documents the app library already has and unstored ones", () => {
    const app = [{ ...storeRow(doc()), id: "app-1", source: "sec" }];
    expect(mergeStore(app, [doc()])).toHaveLength(0);
    expect(
      mergeStore([], [doc(), doc({ id: "b", url: "https://x", storage_path: null })]),
    ).toHaveLength(1);
  });

  it("opens in the panel only when the store holds page text", () => {
    expect(storeRow(doc()).viewable).toBe(true);
    expect(storeRow(doc({ text_path: null })).viewable).toBe(false);
  });

  it("renders page text as one table per page with a row per printed line", () => {
    const { html, pages } = renditionHtml({ kind: "pages", pages: ["Total net revenue 43,738\n\n  \nNet income <b>14,393</b>", "", "Page three"] }, "Q3 2026 & supplement");
    expect(pages).toBe(3);
    const d = new DOMParser().parseFromString(html, "text/html");
    expect(d.title).toBe("Q3 2026 & supplement");
    expect(d.querySelectorAll("table[data-page]")).toHaveLength(3);
    const first = d.querySelector<HTMLTableElement>('table[data-page="1"]')!;
    expect(Array.from(first.rows, (r) => r.textContent)).toEqual(["Total net revenue 43,738", "Net income <b>14,393</b>"]); // escaped, blank lines dropped
    expect(d.querySelector("b")).toBeNull();
    expect(d.getElementById("page-3")?.textContent).toBe("Page 3");
    expect(d.querySelector('table[data-page="2"]')!.previousElementSibling?.textContent).toMatch(/No text on this page/);
  });

  it("renders a workbook as one table per worksheet and caps very long sheets", () => {
    const rows = Array.from({ length: SHEET_MAX_ROWS + 5 }, (_, i) => [`Line ${i}`, i * 1000, null]);
    const { html, pages } = renditionHtml({ kind: "sheets", sheets: { "Income Statement": [["Revenue", "43,738", null]], Long: rows } }, "Supplement");
    expect(pages).toBe(2);
    const d = new DOMParser().parseFromString(html, "text/html");
    const income = Array.from(d.querySelectorAll<HTMLTableElement>("table[data-sheet]")).find((t) => t.getAttribute("data-sheet") === "Income Statement")!;
    expect(Array.from(income.rows[0].cells, (c) => [c.textContent, c.className])).toEqual([["Revenue", ""], ["43,738", "n"], ["", ""]]);
    expect(d.querySelectorAll('table[data-sheet="Long"] tr')).toHaveLength(SHEET_MAX_ROWS);
    expect(d.body.textContent).toContain(`Showing the first 2,000 of 2,005 rows`);
  });

  it("says so when a document has no text", () => {
    expect(renditionHtml({ kind: "pages", pages: [] }, "Empty").html).toContain("No text was read from this document");
  });

  it("finds passages with page numbers", () => {
    const hits = passages(["nothing here", "Revenue grew 8% on iPhone demand"], "iphone", 10);
    expect(hits).toEqual([{ page: 2, text: "rew 8% on iPhone demand" }]);
  });
});
