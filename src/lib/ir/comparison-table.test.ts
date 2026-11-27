import { describe, expect, it } from "vitest";
import { comparisonColumns, fillDocument, isComparisonPosition } from "./table-fill";
import type { IrFact } from "./kpis";
import { parseGrid } from "./table-grid";

describe("as-filed comparison column groups", () => {
  it("handles the Wells Fargo group whose dated subcolumns project beyond its printed colspan", () => {
    const grid = parseGrid(
      "<table><tr><td></td><td>Quarter ended</td><td>Sep 30, 2024 % Change from</td></tr><tr><td></td><td>Sep 30, 2024</td><td></td><td>Jun 30, 2024</td><td>Sep 30, 2023</td></tr><tr><td>Deposits</td><td>773.6</td><td></td><td>(1)</td><td>(3)</td></tr></table>",
    );
    expect([...comparisonColumns(grid[0], 2)]).toEqual([2, 3, 4]);
    expect(isComparisonPosition(grid, { t: 0, r: 2, c: 1 })).toBe(false);
    expect(isComparisonPosition(grid, { t: 0, r: 2, c: 3 })).toBe(true);
  });
  it("keeps the last year-ago filed actual and the subsequent year-to-date actuals in a narrow comparative heading", () => {
    const grid =
      parseGrid(`<table><tr><td></td><td colspan="2">Quarter ended</td><td>Sep 30, 2025 % Change from</td><td>Nine months ended</td></tr>
      <tr><td></td><td>Sep 30, 2025</td><td>Jun 30, 2025</td><td>Sep 30, 2024</td><td>Jun 30, 2025</td><td>Sep 30, 2024</td><td>Sep 30, 2025</td><td>Sep 30, 2024</td></tr>
      <tr><td>Return on equity</td><td>12.5</td><td>12.1</td><td>11.7</td><td>3</td><td>7</td><td>12.4</td><td>11.8</td></tr></table>`);
    expect([...comparisonColumns(grid[0], 2)]).toEqual([4, 5]);
    expect(isComparisonPosition(grid, { t: 0, r: 2, c: 3 })).toBe(false);
    expect(isComparisonPosition(grid, { t: 0, r: 2, c: 6 })).toBe(false);
  });
  it("stops at the next group of actuals and keeps a percent unit on a reported margin", () => {
    const grid = parseGrid(
      "<table><tr><td></td><td>Quarter ended</td><td>Change from</td><td></td><td>Nine months ended</td><td>%</td></tr><tr><td>Margin</td><td>3</td><td>2</td><td>4</td><td>5</td><td>6</td></tr></table>",
    );
    expect([...comparisonColumns(grid[0], 1)]).toEqual([2, 3]);
  });
});

describe("equity reconciliation accounting basis", () => {
  const anchor = (r: number, c: number, value: number): IrFact => ({
    id: `anchor:${r}:${c}`,
    document_id: "issuer",
    document_kind: "supplement",
    category: "statement",
    metric: "other",
    label: r === 3 ? "Net income" : "Total equity",
    parent: null,
    is_total: false,
    period_start: c === 1 ? "2024-07-01" : "2023-07-01",
    period_end: c === 1 ? "2024-09-30" : "2023-09-30",
    months: 3,
    value: value * 1e6,
    unit: "usd",
    accn: null,
    doc: null,
    filed: "2024-10-11",
    locator: { t: 0, r, c, text: String(value) },
  });
  function read(section: string) {
    const html = `<table><tr><td>($ in millions)</td><td colspan="2">Quarter ended</td></tr>
      <tr><td></td><td>Sep 30, 2024</td><td>Sep 30, 2023</td></tr>
      <tr><td>${section}</td></tr>
      <tr><td>Net income</td><td>115</td><td>111</td></tr><tr><td>Total equity</td><td>230</td><td>218</td></tr>
      <tr><td>Adjustments:</td></tr>
      <tr><td>Goodwill</td><td>(10)</td><td>(9)</td></tr>
      <tr><td>Unearned ESOP shares</td><td>(14)</td><td>(12)</td></tr>
      <tr><td>Common stock – $1 par value, authorized 100 shares</td><td>80</td><td>70</td></tr></table>`;
    return fillDocument({
      doc: "issuer",
      html,
      facts: [anchor(3, 1, 115), anchor(3, 2, 111), anchor(4, 1, 230), anchor(4, 2, 218)],
    }).facts;
  }
  it("keeps average equity adjustments in the quarter and identifies ESOP/stock carrying values as currency", () => {
    const rows = read("Return on average tangible common equity:");
    for (const [label, v] of [
      ["Goodwill", -10e6],
      ["Unearned ESOP shares", -14e6],
      ["Common stock", 80e6],
    ] as const)
      expect(
        rows.find((f) => f.label.startsWith(label) && f.period_end === "2024-09-30"),
      ).toMatchObject({ months: 3, unit: "usd", value: v });
  });
  it("uses period-end values for the same adjustments in a book value reconciliation", () => {
    const rows = read("Tangible book value per common share:");
    expect(rows.find((f) => f.label === "Goodwill" && f.period_end === "2024-09-30")).toMatchObject(
      { months: 0, unit: "usd", value: -10e6 },
    );
  });
  it("keeps capital printed in billions in the currency unit, separate from per-share reporting", () => {
    const html = `<table><tr><td>($ in billions)</td><td colspan="2">Quarter ended</td></tr>
      <tr><td></td><td>Sep 30, 2024</td><td>Sep 30, 2023</td></tr><tr><td>Capital:</td></tr>
      <tr><td>Deposits</td><td>115</td><td>111</td></tr><tr><td>Liquidity</td><td>230</td><td>218</td></tr>
      <tr><td>Total equity</td><td>$182.9</td><td>182.7</td></tr>
      <tr><td>Common stockholders’ equity</td><td>163.2</td><td>161.1</td></tr>
      <tr><td>Tangible common equity</td><td>141.2</td><td>140.2</td></tr></table>`;
    const facts = [anchor(3, 1, 115), anchor(3, 2, 111), anchor(4, 1, 230), anchor(4, 2, 218)].map(
      (f) => ({ ...f, value: f.value * 1000 }),
    );
    const rows = fillDocument({ doc: "issuer", html, facts }).facts;
    for (const [label, value] of [
      ["Total equity", 182.9e9],
      ["Common stockholders’ equity", 163.2e9],
      ["Tangible common equity", 141.2e9],
    ] as const)
      expect(rows.find((f) => f.label === label && f.period_end === "2024-09-30")).toMatchObject({
        unit: "usd",
        value,
      });
  });
});
