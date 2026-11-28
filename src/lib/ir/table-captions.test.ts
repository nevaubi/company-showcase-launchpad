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

// Citigroup's 3Q26 supplement: the page heading before the table, a change-column head alone in the table's
// first row over the figure columns, quarter heads written "3Q26" (vera-08).
const CITI = `<p>CITIGROUP CONSOLIDATED BALANCE SHEET</p><p>(In millions of dollars)</p>
<table><tr><td></td><td></td><td></td><td></td><td>3Q26 Increase/</td></tr><tr><td></td><td>September 30,</td><td>June 30,</td><td>(Decrease) from</td></tr>
<tr><td></td><td>2026</td><td>2026</td><td>2Q26</td></tr><tr><td>Assets</td></tr><tr><td>Cash and due from banks</td><td>$</td><td>23,451</td><td>24,663</td></tr></table>`;

// Alphabet's and Meta's Q3 2026 releases: a closing quotation and a headline bullet above the first table (verb-12).
const GOOGL = `<p>“... We’re excited by the range of big opportunities ahead of us.”</p>
<table><tr><td></td><td>Quarter Ended September 30,</td></tr><tr><td></td><td>2025</td><td>2026</td></tr><tr><td>Revenues</td><td>$</td><td>102,346</td><td>$</td><td>115,000</td></tr></table>`;
const META = `<p>Third Quarter 2026 Financial Highlights</p><p>Announces establishment of new class C common stock</p>
<table><tr><td></td><td>Three Months Ended September 30,</td></tr><tr><td></td><td>2026</td><td>2025</td></tr><tr><td>Revenue</td><td>$</td><td>64,601</td><td>$</td><td>51,242</td></tr></table>`;

describe("tableCaptions: titles inside the table", () => {
  it("GOOGL, META: a quotation and a headline are not titles; the heading before them is", () => {
    expect(tableCaptions(GOOGL, "Alphabet")[0].title).toBeUndefined();
    expect(tableCaptions(META, "Meta")[0].title).toBe("Third Quarter 2026 Financial Highlights");
  });
  it("C: a lone cell over the figure columns is a column head, not the title", () => {
    const [c] = tableCaptions(CITI, "Citigroup");
    expect(c.title).toBe("CITIGROUP CONSOLIDATED BALANCE SHEET");
  });
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

// Stamps and one-cell titles, as printed in the stored documents.
describe("tableCaptions: stamps and titles sharing a cell with the company's name", () => {
  // NextEra Energy, third quarter 2026 exhibit: "Preliminary" in the table's first row.
  const NEE = `<p>NextEra Energy, Inc.</p><p>Condensed Consolidated Statements of Income</p><p>(millions, except per share amounts)</p><p>(unaudited)</p>
<table><tr><td>Preliminary</td></tr><tr><td>Three Months Ended September 30, 2026</td><td>FPL</td><td>NEER</td></tr>
<tr><td>Operating Revenues</td><td>$</td><td>5,421</td><td>$</td><td>2,516</td></tr><tr><td>Fuel, purchased power and interchange</td><td>1,277</td><td>422</td></tr></table>`;
  // Merck, third quarter 2026 exhibit 99.2: the title broken over lines, then "Table" and "1a".
  const MRK = `<p>MERCK &amp; CO., INC., RAHWAY, N.J., USA</p><p>CONSOLIDATED<br>STATEMENT OF OPERATIONS - GAAP</p><p>(AMOUNTS<br>IN MILLIONS, EXCEPT PER SHARE FIGURES)</p><p>(UNAUDITED)</p><p>Table</p><p>1a</p>
<table><tr><td></td><td>3Q 2026</td><td>3Q 2025</td></tr><tr><td>Sales</td><td>$</td><td>18,085</td><td>$</td><td>17,276</td></tr><tr><td>Cost of sales</td><td>4,892</td><td>3,855</td></tr></table>`;
  // Procter & Gamble, fiscal 2026 fourth quarter release: company, scale and title in one cell.
  const PG = `<table><tr><td></td></tr><tr><td>THE PROCTER &amp; GAMBLE COMPANY AND SUBSIDIARIES (Amounts in Millions Except Per Share Amounts) Condensed Consolidated Balance Sheets</td></tr>
<tr><td></td><td>June 30, 2026</td><td>June 30, 2025</td></tr><tr><td>Cash and cash equivalents</td><td>$</td><td>9,942</td><td>$</td><td>9,556</td></tr>
<tr><td>Accounts receivable</td><td>6,056</td><td>6,185</td></tr></table>`;
  const PG_RECON = `<table><tr><td>THE PROCTER &amp; GAMBLE COMPANY AND SUBSIDIARIES Reconciliation of Non-GAAP Measures</td></tr>
<tr><td>Three Months Ended September 30, 2026</td></tr><tr><td>Cost of products sold</td><td>$</td><td>11,678</td><td>$</td><td>(44)</td></tr><tr><td>Gross profit</td><td>11,598</td><td>44</td></tr></table>`;
  // Costco, fiscal 2026 fourth quarter release: a status line between the title and the table.
  const COST = `<p>COSTCO WHOLESALE CORPORATION</p><p>CONSOLIDATED BALANCE SHEETS</p><p>(amounts in millions, except par value and share data) (unaudited)</p><p>Subject to Reclassification</p>
<table><tr><td></td><td>August 30, 2026</td><td>August 31, 2025</td></tr><tr><td>Cash and cash equivalents</td><td>$</td><td>20,207</td><td>$</td><td>14,161</td></tr><tr><td>Short-term investments</td><td>1,094</td><td>1,123</td></tr></table>`;

  it("a status stamp in the table's first row is not its title", () => {
    expect(tableCaptions(NEE, "NextEra Energy")[0].title).toBe("Condensed Consolidated Statements of Income");
  });
  it("a table number is not a title", () => {
    expect(tableCaptions(MRK, "Merck")[0].title).toBe("STATEMENT OF OPERATIONS - GAAP");
  });
  it("a title printed after the company's name and the scale line in one cell is read out of it", () => {
    const [c] = tableCaptions(PG, "Procter & Gamble");
    expect(c.title).toBe("Condensed Consolidated Balance Sheets");
    expect(c.unit).toBe("(Amounts in Millions Except Per Share Amounts)");
    expect(tableCaptions(PG_RECON, "Procter & Gamble")[0].title).toBe("Reconciliation of Non-GAAP Measures");
  });
  it("a status line printed after the title is skipped", () => {
    const [c] = tableCaptions(COST, "Costco");
    expect(c.title).toBe("CONSOLIDATED BALANCE SHEETS");
    expect(c.unit).toBe("(amounts in millions, except par value and share data)");
  });
  it("tags, exhibit numbers and footnote legends name nothing", () => {
    for (const stamp of ["Exhibit 99.1", "Category: PG-IR", "N/A Not applicable.", "Document", "each segment."]) {
      const html = `<p>Consolidated Statements of Income</p><p>${stamp}</p><table><tr><td></td><td>2026</td><td>2025</td></tr><tr><td>Revenue</td><td>100</td><td>90</td></tr></table>`;
      expect(tableCaptions(html)[0].title, stamp).toBe("Consolidated Statements of Income");
    }
  });
});
