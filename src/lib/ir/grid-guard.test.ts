import { describe, expect, it } from "vitest";
import { factsFromModel, figureSlots, headDate, headQuarter, type ModelOutput, type ModelRow } from "./extract-core";
import type { ParsedTable } from "./tables";

// Rows as parseTables reads them from the SEC documents, and the cells the model pointed at as stored
// in ir_kpi_facts (26 Nov 2026).
const table = (rows: Record<number, string[]>, n: number): ParsedTable => ({ index: 2, rows: Array.from({ length: n }, (_, r) => rows[r] ?? []) });
const row = (r: number, label: string, cells: [number, number][], o: Partial<ModelRow> = {}): ModelRow => ({ r, label, parent: "", breakdown: "", category: "product", metric: "revenue", unit: "usd", scale: 1e6, is_total: false, cells: cells.map(([c, p]) => ({ c, p })), ...o });
const read = (out: ModelOutput, t: ParsedTable, filed: string) => {
  const tables: ParsedTable[] = [];
  tables[out.tables[0].t] = t;
  return factsFromModel(out, tables, filed).rows.map((f) => `${f.label} ${f.locator.text} ${f.period_end}`);
};

// Dell Q4 FY25 release, table 2: https://www.sec.gov/Archives/edgar/data/1571996/000157199625000014/exhibit991earnings8kq4fy25.htm
const DELL_FY25 = table(
  {
    1: ["", "Three Months Ended", "", "", "", "Fiscal Year Ended", "", ""],
    2: ["", "January 31, 2025", "", "February 2, 2024", "", "Change", "", "January 31, 2025", "", "February 2, 2024", "", "Change"],
    4: ["Net revenue:", "", "", "", "", "", "", "", "", "", "", ""],
    5: ["Products", "$", "18,049", "", "", "$", "16,149", "", "", "12%", "", "$", "71,420", "", "", "$", "64,353", "", "", "11%"],
    6: ["Services", "5,882", "", "", "6,169", "", "", "(5)%", "", "24,147", "", "", "24,072", "", "", "—%"],
    7: ["Total net revenue", "23,931", "", "", "22,318", "", "", "7%", "", "95,567", "", "", "88,425", "", "", "8%"],
  },
  8,
);
const FY25 = [
  { p: 0, period_start: "2024-11-02", period_end: "2025-01-31", months: 3 },
  { p: 1, period_start: "2023-11-04", period_end: "2024-02-02", months: 3 },
  { p: 2, period_start: "2024-02-03", period_end: "2025-01-31", months: 12 },
  { p: 3, period_start: "2023-02-04", period_end: "2024-02-02", months: 12 },
];

describe("cells stored under another column's period (verb-04 DELL)", () => {
  it("Q4 FY25: Services 6,169 and Total 22,318, printed under February 2, 2024, are not stored as January 31, 2025", () => {
    const out: ModelOutput = {
      tables: [
        {
          t: 2,
          periods: FY25,
          rows: [
            row(5, "Products", [[2, 0], [6, 1], [12, 2], [16, 3]]),
            row(6, "Services", [[4, 0], [9, 2], [12, 3]]),
            row(7, "Total net revenue", [[4, 0], [9, 2], [12, 3]], { is_total: true }),
          ],
        },
      ],
    };
    expect(read(out, DELL_FY25, "2025-02-27")).toEqual(["Products 18,049 2025-01-31", "Products 16,149 2024-02-02", "Products 71,420 2025-01-31", "Products 64,353 2024-02-02"]);
  });
  it("the same rows mapped as printed are kept", () => {
    const out: ModelOutput = { tables: [{ t: 2, periods: FY25, rows: [row(5, "Products", [[2, 0], [6, 1]]), row(6, "Services", [[1, 0], [4, 1]]), row(7, "Total net revenue", [[1, 0], [4, 1]])] }] };
    expect(read(out, DELL_FY25, "2025-02-27")).toHaveLength(6);
  });
  it("Q4 FY24: a money row's cell under the Change head (3%) is never stored as $3 million", () => {
    // https://www.sec.gov/Archives/edgar/data/1571996/000157199624000008/exhibit991earnings8kq4fy24.htm table 2
    const t = table(
      {
        1: ["", "Three Months Ended", "", "", "", "Fiscal Year Ended", "", ""],
        2: ["", "February 2, 2024", "", "February 3, 2023", "", "Change", "", "February 2, 2024", "", "February 3, 2023", "", "Change"],
        4: ["Products", "$", "16,149", "", "", "$", "19,038", "", "", "(15)%", "", "$", "64,353", "", "", "$", "79,250", "", "", "(19)%"],
        5: ["Services", "6,169", "", "", "6,001", "", "", "3%", "", "24,072", "", "", "23,051", "", "", "4%"],
      },
      6,
    );
    const P = [
      { p: 0, period_start: "2023-11-04", period_end: "2024-02-02", months: 3 },
      { p: 1, period_start: "2022-10-29", period_end: "2023-02-03", months: 3 },
    ];
    const out: ModelOutput = { tables: [{ t: 2, periods: P, rows: [row(4, "Products", [[2, 0], [6, 1]]), row(5, "Services", [[4, 0], [7, 1]])] }] };
    expect(read(out, t, "2024-02-29")).toEqual(["Products 16,149 2024-02-02", "Products 19,038 2023-02-03"]);
    // A money cell printed with "%" is refused even where the heads say nothing.
    const bare: ParsedTable = { index: 2, rows: [["Services", "6,169", "", "3%"]] };
    const one: ModelOutput = { tables: [{ t: 2, periods: P, rows: [row(0, "Services", [[1, 0], [3, 1]])] }] };
    expect(read(one, bare, "2024-02-29")).toEqual(["Services 6,169 2024-02-02"]);
  });
});

// First Citizens 3Q26 financial supplement, table 2: https://www.sec.gov/Archives/edgar/data/798941/000079894126000041/a3q26_fsx993.htm
const FCNCA = table(
  {
    1: ["", "", "Three Months Ended", "", "Increase (Decrease) From LQ", "", "Nine Months Ended", "", "Increase (Decrease) From PYTD"],
    2: ["dollars in millions, except share and per share data", "", "September 30, 2026", "June 30, 2026", "March 31, 2026", "December 31, 2025", "September 30, 2025", "", "", "September 30, 2026", "September 30, 2025", ""],
    3: ["Interest income", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    4: ["Loans and leases", "", "$", "2,341", "", "$", "2,253", "", "$", "2,206", "", "$", "2,290", "", "$", "2,300", "", "", "$", "88", "", "3.9", "%", "", "$", "6,800", "", "$", "6,806", "", "", "$", "(6)", "", "(0.1)", "%"],
    5: ["Investment securities", "", "427", "", "401", "", "384", "", "424", "", "433", "", "", "26", "", "6.2", "", "", "1,212", "", "1,266", "", "", "(54)", "", "(4.2)", ""],
    6: ["Deposits at banks", "", "197", "", "197", "", "196", "", "226", "", "265", "", "", "—", "", "—", "", "", "590", "", "766", "", "", "(176)", "", "(23.0)", ""],
    7: ["Securities purchased under resale agreements", "", "2", "", "2", "", "3", "", "4", "", "5", "", "", "—", "", "—", "", "", "7", "", "15", "", "", "(8)", "", "(53.3)", ""],
  },
  8,
);
const Q5 = ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"].map((end, p) => ({ p, period_start: "", period_end: end, months: 3 }));

describe("a row whose cells contradict the columns every other row uses (auda-07)", () => {
  it("FCNCA 3Q26: Loans and leases mapped 2Q26, 3Q25, 3Q26, 1Q26, 4Q25 is not stored; the rows mapped in printed order are", () => {
    const out: ModelOutput = {
      tables: [
        {
          t: 2,
          periods: Q5,
          rows: [
            row(4, "Loans and leases", [[3, 1], [6, 4], [9, 0], [12, 2], [15, 3]]),
            ...[5, 6, 7].map((r) => row(r, `r${r}`, [[2, 0], [4, 1], [6, 2], [8, 3], [10, 4]])),
          ],
        },
      ],
    };
    const got = read(out, FCNCA, "2026-10-23");
    expect(got.filter((x) => x.startsWith("Loans"))).toEqual([]);
    expect(got).toHaveLength(15);
    expect(got.slice(0, 2)).toEqual(["r5 427 2026-09-30", "r5 401 2026-06-30"]);
  });
  it("NTRS 3Q26: Other Noninterest Income 673.0 (Q2 2026) and 169.1 (Q3 2025) swapped is not stored", () => {
    // https://www.sec.gov/Archives/edgar/data/73124/000007312426000063/q32026earningsreleaseex991.htm table 2
    const t = table(
      {
        1: ["FINANCIAL SUMMARY & KEY METRICS", "", "", "", "", ""],
        2: ["", "", "", "", "", "% Change Q3 2026 vs."],
        3: ["($ In Millions except per share data)", "Q3 2026", "Q2 2026 (1)(2)", "Q3 2025", "", "Q2 2026", "Q3 2025"],
        4: ["Trust, Investment and Other Servicing Fees", "$", "1,373.0", "", "$", "1,349.5", "", "$", "1,265.5", "", "", "2", "%", "8", "%"],
        5: ["Other Noninterest Income", "250.0", "", "673.0", "", "169.1", "", "", "(63)", "48", ""],
        7: ["Total Revenue (FTE*)", "$", "2,302.1", "", "$", "2,705.6", "", "$", "2,030.9", "", "", "(15)", "%", "13", "%"],
        13: ["Net Income", "$", "642.9", "", "$", "792.2", "", "$", "457.6", "", "", "(19)", "%", "40", "%"],
      },
      14,
    );
    const P = ["2026-09-30", "2026-06-30", "2025-09-30"].map((end, p) => ({ p, period_start: "", period_end: end, months: 3 }));
    const out: ModelOutput = {
      tables: [
        {
          t: 2,
          periods: P,
          rows: [row(4, "Trust fees", [[2, 0], [5, 1], [8, 2]]), row(5, "Other Noninterest Income", [[1, 0], [3, 2], [5, 1]]), row(7, "Total Revenue", [[2, 0], [5, 1], [8, 2]]), row(13, "Net Income", [[2, 0], [5, 1], [8, 2]])],
        },
      ],
    };
    const got = read(out, t, "2026-10-21");
    expect(got.filter((x) => x.startsWith("Other"))).toEqual([]);
    expect(got).toHaveLength(9);
    // As stored: the "$" rows' Q3 2026 cell taken as Q2 2026 (and Q2 2026 skipped) is refused too.
    const shifted: ModelOutput = { tables: [{ t: 2, periods: P, rows: [row(4, "Trust fees", [[2, 1], [8, 2]]), row(5, "Other Noninterest Income", [[1, 0], [3, 1], [5, 2]]), row(13, "Net Income", [[2, 0], [5, 1], [8, 2]])] }] };
    expect(read(shifted, t, "2026-10-21").filter((x) => x.startsWith("Trust"))).toEqual([]);
  });
  it("a table with the periods down the side (one quarter a row) is not judged by its columns", () => {
    const t: ParsedTable = {
      index: 0,
      rows: [
        ["", "North America", "Latin America", "EAME"],
        ["Third quarter 2026", "6,124", "1,021", "2,950"],
        ["Third quarter 2025", "5,800", "990", "2,700"],
        ["Second quarter 2026", "6,010", "1,005", "2,880"],
        ["First quarter 2026", "5,950", "980", "2,860"],
      ],
    };
    const P = ["2026-09-30", "2025-09-30", "2026-06-30", "2026-03-31"].map((end, p) => ({ p, period_start: "", period_end: end, months: 3 }));
    const out: ModelOutput = { tables: [{ t: 0, periods: P, rows: [1, 2, 3, 4].map((r) => row(r, `q${r}`, [[1, r - 1], [2, r - 1], [3, r - 1]])) }] };
    const tables = [t];
    expect(factsFromModel(out, tables, "2026-10-28").rows).toHaveLength(12);
  });
});

describe("grid helpers", () => {
  it("figure slots skip currency and spacer cells and count dashes and NP marks", () => {
    expect([...figureSlots(FCNCA.rows[4]).entries()].slice(0, 3)).toEqual([[3, 0], [6, 1], [9, 2]]);
    expect(figureSlots(["Net sales", "$", "124,969", "", "NP", "3.6", "%", "—"]).size).toBe(4);
  });
  it("reads dates and calendar quarters in heads", () => {
    expect(headDate("January 31, 2025")).toBe("2025-01-31");
    expect(headDate("Sept. 30, 2026")).toBe("2026-09-30");
    expect(headDate("Change")).toBeNull();
    expect(headQuarter("Q2 2026 (1)(2)")).toBe("2026-06-30");
    expect(headQuarter("3Q26")).toBe("2026-09-30");
    expect(headQuarter("Third quarter 2026")).toBe("2026-09-30");
    expect(headQuarter("Q3 FY27")).toBeNull();
  });
});
