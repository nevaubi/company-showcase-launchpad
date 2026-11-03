import { describe, expect, it } from "vitest";
import { buildStatements, type CompanyFacts, type RawFact } from "./build";
import { fmtCell, scaled, unitLabel } from "../format";

let n = 0;
const fact = (start: string | undefined, end: string, val: number, form: string, filed: string, accn = `0000000001-26-${String(++n).padStart(6, "0")}`): RawFact => ({
  start,
  end,
  val,
  form,
  filed,
  accn,
  fy: Number(end.slice(0, 4)),
  fp: form.startsWith("10-K") ? "FY" : "Q",
});

/** A calendar-year filer: FY2024 and FY2025 10-Ks plus FY2025 Q1–Q3 10-Qs. */
function filer(concepts: Record<string, { unit?: string; facts: RawFact[] }>): CompanyFacts {
  const out: CompanyFacts = { facts: { "us-gaap": {} } };
  for (const [c, v] of Object.entries(concepts)) out.facts["us-gaap"][c] = { units: { [v.unit ?? "USD"]: v.facts } };
  return out;
}

const REVENUE = [
  fact("2024-01-01", "2024-12-31", 400, "10-K", "2025-02-01"),
  fact("2025-01-01", "2025-12-31", 480, "10-K", "2026-02-01"),
  fact("2025-01-01", "2025-03-31", 100, "10-Q", "2025-04-30"),
  fact("2025-04-01", "2025-06-30", 110, "10-Q", "2025-07-30"),
  fact("2025-01-01", "2025-06-30", 210, "10-Q", "2025-07-30"), // six-month YTD
  fact("2025-01-01", "2025-09-30", 340, "10-Q", "2025-10-30"), // nine-month YTD
  fact("2025-07-01", "2025-09-30", 130, "10-Q", "2025-10-30"),
];
const OPINC = [
  fact("2024-01-01", "2024-12-31", 80, "10-K", "2025-02-01"),
  fact("2025-01-01", "2025-12-31", 100, "10-K", "2026-02-01"),
];

describe("statement builder", () => {
  it("derives a fourth quarter as the annual total minus nine-month YTD, with both parts sourced", () => {
    const s = buildStatements(filer({ Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } }));
    const q = s.quarterly.income;
    const i = q.periods.findIndex((p) => p.key === "FY2025Q4");
    const cell = q.rows.find((r) => r.key === "revenue")!.cells[i]!;
    expect(cell.v).toBe(140); // 480 − 340
    expect(cell.derived?.parts.map((p) => [p.sign, p.value])).toEqual([
      [1, 480],
      [-1, 340],
    ]);
  });

  it("builds EBITDA from pretax income + interest + D&A when there is no operating-income line", () => {
    const y = (v: number, y: number) => fact(`${y}-01-01`, `${y}-12-31`, v, "10-K", `${y + 1}-02-01`);
    const s = buildStatements(
      filer({
        Revenues: { facts: [y(400, 2024), y(480, 2025)] },
        IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: { facts: [y(70, 2024), y(90, 2025)] },
        InterestExpense: { facts: [y(5, 2024), y(6, 2025)] },
        DepreciationDepletionAndAmortization: { facts: [y(20, 2024), y(24, 2025)] },
        NetCashProvidedByUsedInOperatingActivities: { facts: [y(60, 2024), y(75, 2025)] },
      }),
    );
    const ebitda = s.annual.income.rows.find((r) => r.key === "ebitda")!;
    expect(ebitda.cells.at(-1)!.v).toBe(120); // 90 + 6 + 24
  });

  it("reads dividends from PaymentsOfOrdinaryDividends when the usual tags are absent (e.g. BAC, JNJ)", () => {
    const y = (v: number, y: number) => fact(`${y}-01-01`, `${y}-12-31`, v, "10-K", `${y + 1}-02-01`);
    const s = buildStatements(
      filer({
        Revenues: { facts: [y(400, 2024), y(480, 2025)] },
        NetCashProvidedByUsedInOperatingActivities: { facts: [y(60, 2024), y(75, 2025)] },
        PaymentsOfOrdinaryDividends: { facts: [y(9, 2024), y(10, 2025)] },
      }),
    );
    const div = s.annual.cashflow.rows.find((r) => r.key === "dividends")!;
    expect(div.cells.at(-1)!.v).toBe(10);
    expect(div.cells.at(-1)!.src?.concept).toBe("us-gaap:PaymentsOfOrdinaryDividends");
  });

  it("drops a fiscal year that has only a stray comparative fact", () => {
    // A buyback total from 1999 appears in an old 10-K's multi-year table, with nothing else for that year.
    const y = (v: number, yr: number) => fact(`${yr}-01-01`, `${yr}-12-31`, v, "10-K", `${yr + 1}-02-01`);
    const s = buildStatements(
      filer({
        Revenues: { facts: [y(400, 2024), y(480, 2025)] },
        PaymentsForRepurchaseOfCommonStock: { facts: [y(3, 1999), y(7, 2024), y(8, 2025)] },
      }),
    );
    expect(s.annual.income.periods.map((p) => p.key)).toEqual(["FY2024", "FY2025"]);
  });
});

describe("unit scale", () => {
  it("shows full dollars with separators, and scaled values in K / M / B", () => {
    expect(fmtCell(416_161_000_000, "usd", "full")).toBe("416,161,000,000");
    expect(fmtCell(416_161_000_000, "usd", "M")).toBe("416,161");
    expect(fmtCell(416_161_000_000, "usd", "B")).toBe("416.2");
    expect(fmtCell(-2_500_000, "usd", "M")).toBe("(3)"); // whole millions, negatives in parentheses
  });
  it("leaves per-share, percent and ratio values alone when the scale changes", () => {
    expect(fmtCell(7.46, "usdPerShare", "B")).toBe("7.46");
    expect(scaled(7.46, "usdPerShare", "B")).toBe(7.46);
    expect(scaled(5_000_000_000, "usd", "B")).toBe(5);
  });
  it("labels each scale", () => {
    expect(unitLabel("usd", "full")).toBe("$");
    expect(unitLabel("usd", "B")).toBe("$B");
    expect(unitLabel("shares", "M")).toBe("M sh");
  });
});
