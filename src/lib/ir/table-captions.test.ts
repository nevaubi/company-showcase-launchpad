import { describe, expect, it } from "vitest";
import { capitalWords, sentenceCase, tableCaptions } from "@/lib/ir/table-captions";

// Shapes of real releases: JPM's supplement prints its title inside the table, above the period heads;
// Apple's release prints it in paragraphs before the table; Honeywell's in a paragraph with a page footer before it.
const JPM = `<table><tr><td></td></tr><tr><td>JPMORGAN CHASE &amp; CO.</td></tr><tr><td>CONSOLIDATED STATEMENTS OF INCOME</td></tr>
<tr><td>(in millions, except per share and ratio data)</td></tr><tr><td></td><td>QUARTERLY TRENDS</td></tr>
<tr><td></td><td>3Q26</td><td>2Q26</td></tr><tr><td>REVENUE</td></tr><tr><td>Investment banking fees</td><td>$</td><td>2,960</td><td>3,208</td></tr>
<tr><td></td></tr><tr><td>NONINTEREST EXPENSE</td></tr><tr><td>Compensation expense</td><td>14,772</td><td>15,159</td></tr></table>`;
const AAPL = `<p>Apple Inc.</p><p>CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)</p><p>(In millions, except number of shares)</p>
<table><tr><td></td><td>Three Months Ended</td></tr><tr><td></td><td>September 26, 2026</td><td>September 27, 2025</td></tr><tr><td>Net sales:</td></tr>
<tr><td>Products</td><td>$</td><td>82,904</td><td>73,716</td></tr></table>`;
const HON = `<p>Honeywell Technologies Q3’26 Results - 3</p><p>Consolidated Statement of Operations</p><p>(Dollars in millions, except per share amounts)</p>
<table><tr><td></td><td>Three Months Ended September 30,</td></tr><tr><td></td><td>2026</td><td>2025</td></tr><tr><td>Product sales</td><td>$</td><td>3,628</td><td>3,573</td></tr></table>`;

describe("tableCaptions", () => {
  it("takes an in-table title above the period heads, skipping the company name, and the scale line", () => {
    const [c] = tableCaptions(JPM, "JPMorgan Chase");
    expect(c.title).toBe("CONSOLIDATED STATEMENTS OF INCOME");
    expect(c.unit).toBe("(in millions, except per share and ratio data)");
    expect(c.heads).toEqual([
      [6, "REVENUE"],
      [9, "NONINTEREST EXPENSE"],
    ]);
    expect(c.blank).toEqual([8]);
  });
  it("takes the title from the text before the table when the table has none, without (Unaudited)", () => {
    const [c] = tableCaptions(AAPL, "Apple");
    expect(c.title).toBe("CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS");
    expect(c.unit).toBe("(In millions, except number of shares)");
    expect(c.heads).toEqual([[2, "Net sales"]]);
  });
  it("never takes a page footer or the company's name as a title", () => {
    const [c] = tableCaptions(HON, "Honeywell");
    expect(c.title).toBe("Consolidated Statement of Operations");
    expect(c.unit).toBe("(Dollars in millions, except per share amounts)");
  });
});

// Shapes of Micron's Q4 FY26 release (title in the table's first row over "FQ4-26" heads, a highlight bullet
// before the table) and Texas Instruments' Q3 2026 release (the legal name above the table, the title in the
// label cell of the period-heads row), as the SEC copies print them (audb-06).
const MU = `<p>• Operating cash flow of $89.68 billion versus $17.53 billion for the prior year</p>
<table><tr><td></td></tr><tr><td>Quarterly Financial Results</td></tr><tr><td>(in millions, except per share amounts)</td><td>GAAP (1)</td><td></td><td>Non-GAAP (2)</td></tr>
<tr><td>FQ4-26</td><td>FQ3-26</td><td>FQ4-25</td></tr><tr><td>Revenue</td><td>$</td><td>54,229</td><td>41,456</td></tr></table>`;
const TXN = `<p>TEXAS INSTRUMENTS INCORPORATED AND SUBSIDIARIES</p>
<table><tr><td></td></tr><tr><td>Consolidated Statements of Income</td><td></td><td>For Three Months Ended September 30,</td></tr>
<tr><td>(In millions, except per-share amounts)</td><td></td><td>2026</td><td></td><td>2025</td></tr><tr><td>Revenue</td><td>$</td><td>6,055</td><td>$</td><td>4,742</td></tr></table>`;

// Netflix's Q3'26 letter: a paragraph ends with "Our summary results, and forecast for Q4, are below." over an
// untitled table (audd-07).
const NFLX = `<p>Our summary results, and forecast for Q4, are below.</p>
<table><tr><td>(in millions except per share data)</td><td>Q3'25</td><td>Q3'26</td></tr><tr><td>Revenue</td><td>$</td><td>11,510</td><td>12,874</td></tr></table>`;

describe("tableCaptions: titles inside the table", () => {
  it("NFLX: a paragraph's closing sentence is not a title", () => {
    const [c] = tableCaptions(NFLX, "Netflix");
    expect(c.title).toBeUndefined();
  });
  it("MU: a first-row title over quarter marks, never the highlight bullet before the table", () => {
    const [c] = tableCaptions(MU, "Micron");
    expect(c.title).toBe("Quarterly Financial Results");
  });
  it("TXN: the title in the period-heads row's label cell, never the legal name over the statements", () => {
    const [c] = tableCaptions(TXN, "Texas Instruments");
    expect(c.title).toBe("Consolidated Statements of Income");
  });
});

describe("sentenceCase", () => {
  const keep = capitalWords([
    "CCB average balances",
    "CIB operating metrics",
    "TOTAL NET REVENUE",
    "Non-GAAP net income",
  ]);
  it("lowers capitals word by word, keeping the company's own acronyms", () => {
    expect(sentenceCase("CONSOLIDATED STATEMENTS OF INCOME", keep)).toBe(
      "Consolidated statements of income",
    );
    expect(sentenceCase("CCB AVERAGE BALANCES", keep)).toBe("CCB average balances");
    expect(sentenceCase("NON-GAAP FINANCIAL MEASURES", keep)).toBe("Non-GAAP financial measures");
    expect(sentenceCase("U.S. OFFICES", keep)).toBe("U.S. offices");
    expect(sentenceCase("TOTAL NET REVENUE (fully taxable-equivalent (“FTE”))", keep)).toBe(
      "Total net revenue (fully taxable-equivalent (“FTE”))",
    );
    expect(sentenceCase("SEGMENT & CORPORATE RESULTS - MANAGED BASIS", keep)).toBe(
      "Segment & corporate results - managed basis",
    );
  });
  it("lowers Title Case, keeps sentence case as printed", () => {
    expect(sentenceCase("Consolidated Statement of Cash Flows", keep)).toBe(
      "Consolidated statement of cash flows",
    );
    expect(sentenceCase("Table 1: Summary of Financial Results", keep)).toBe(
      "Table 1: Summary of financial results",
    );
    expect(sentenceCase("Revenue by business", keep)).toBe("Revenue by business");
  });
  it("words of shouted line names are not taken as acronyms", () => {
    expect(keep.has("TOTAL")).toBe(false);
    expect(keep.has("CCB")).toBe(true);
  });
});
