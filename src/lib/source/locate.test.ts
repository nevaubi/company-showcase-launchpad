import { describe, expect, it } from "vitest";
import { clearMarks, markFigure, quotedRow, rowText } from "./locate";

function page(html: string) {
  const doc = document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = html;
  return doc;
}

const SUPPLEMENT = `
  <h2 id="page-4">Page 4</h2>
  <table data-page="4">
    <tr><td>Total net revenue 43,738 42,768 44,912</td></tr>
    <tr><td>Trading Revenue (a) 387 1,859 611 408 873 ( 79) ( 56) 2,246 2,593 (13)</td></tr>
  </table>
  <h2 id="page-9">Page 9</h2>
  <table data-page="9">
    <tr><td>Investment Banking Fees $ 993 $ 1,073 $ 879 $ 893 $ 692 ( 7) % 4 3 %</td></tr>
    <tr><td>Total net revenue 43,738 42,768 44,912</td></tr>
    <tr><td>Net income 1,692 692.5 4,692</td></tr>
  </table>`;

describe("locating a quoted line", () => {
  it("finds the line on the cited page, not the same line on an earlier page", () => {
    const doc = page(SUPPLEMENT);
    const table = doc.querySelector<HTMLTableElement>('table[data-page="9"]')!;
    const row = quotedRow(table, "Total net revenue 43,738 42,768 44,912")!;
    expect(row.closest("table")?.getAttribute("data-page")).toBe("9");
    expect(Array.prototype.indexOf.call(table.rows, row)).toBe(1);
  });

  it("reads a row cell by cell and prefers the row that is exactly the quote", () => {
    const doc = page(`<table>
      <tr><td>Americas</td><td>$</td><td>52,648</td><td>$</td><td>50,430</td><td>and more</td></tr>
      <tr><td>Americas</td><td>$</td><td>52,648</td><td>$</td><td>50,430</td></tr></table>`);
    const rows = doc.querySelectorAll("tr");
    expect(rowText(rows[1])).toBe("americas $ 52,648 $ 50,430");
    expect(quotedRow(doc.body, "Americas $ 52,648 $ 50,430")).toBe(rows[1]);
    expect(quotedRow(doc.body, "Americas $ 52,648")).toBe(rows[1]); // the shortest row that contains it
  });

  it("skips a layout row that wraps another table", () => {
    const doc = page(
      `<table><tr id="outer"><td><table><tr id="inner"><td>Revenue 42</td></tr></table></td></tr></table>`,
    );
    expect(quotedRow(doc.body, "Revenue 42")?.id).toBe("inner");
  });

  it("finds a quote that runs over two printed lines by its first words", () => {
    const doc = page(
      `<table><tr><td>Net interest income excluding Markets was up</td></tr><tr><td>8% from the prior year</td></tr></table>`,
    );
    const row = quotedRow(
      doc.body,
      "Net interest income excluding Markets was up 8% from the prior year",
    );
    expect(row?.textContent).toBe("Net interest income excluding Markets was up");
    expect(quotedRow(doc.body, "Nothing like this is printed anywhere in it")).toBeNull();
  });

  it("marks the printed figure inside the line, on its own digits only", () => {
    const doc = page(SUPPLEMENT);
    const row = quotedRow(doc.body, "Net income 1,692 692.5 4,692")!;
    expect(markFigure(doc, row, "692")).toBeNull(); // only inside 1,692, 692.5 and 4,692
    const fees = quotedRow(
      doc.body,
      "Investment Banking Fees $ 993 $ 1,073 $ 879 $ 893 $ 692 ( 7) % 4 3 %",
    )!;
    const mark = markFigure(doc, fees, "692")!;
    expect(mark.tagName).toBe("MARK");
    expect(mark.textContent).toBe("692");
    expect(fees.textContent).toBe(
      "Investment Banking Fees $ 993 $ 1,073 $ 879 $ 893 $ 692 ( 7) % 4 3 %",
    );
    clearMarks(doc);
    expect(doc.querySelector("mark")).toBeNull();
    expect(fees.cells[0].childNodes).toHaveLength(1);
  });

  it("returns the table cell that is exactly the figure", () => {
    const doc = page(`<table><tr><td>Americas</td><td>$ 52,648</td><td>(1,204)</td></tr></table>`);
    const row = doc.querySelector("tr")!;
    expect(markFigure(doc, row, "52,648")?.textContent).toBe("$ 52,648");
    expect(markFigure(doc, row, "1,204")?.textContent).toBe("(1,204)");
    expect(doc.querySelector("mark")).toBeNull();
  });
});
