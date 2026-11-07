import { describe, expect, it } from "vitest";
import { buildStatements, quarterEndAfter, type CompanyFacts, type RawFact } from "./build";
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
  it("uses a company-extension capex concept when no us-gaap capex is filed, keeping its qualified name as the source", () => {
    const cf = filer({ Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } });
    cf.facts.cop = {
      PaymentToAcquireProductiveAssetsAndInvestments: {
        units: { USD: [fact("2025-01-01", "2025-12-31", 12553, "10-K", "2026-02-17"), fact("2024-01-01", "2024-12-31", 12118, "10-K", "2025-02-18")] },
      },
    };
    const a = buildStatements(cf).annual.cashflow;
    const i = a.periods.findIndex((p) => p.label === "FY2025");
    const cell = a.rows.find((r) => r.key === "capex")!.cells[i]!;
    expect(cell.v).toBe(12553);
    expect(cell.src?.concept).toBe("cop:PaymentToAcquireProductiveAssetsAndInvestments");
  });

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

describe("data-quality guards", () => {
  const restated = (extra: RawFact[]) =>
    buildStatements(
      filer({
        Revenues: {
          facts: [
            fact("2024-01-01", "2024-12-31", 400, "10-K", "2025-02-01"),
            fact("2025-01-01", "2025-03-31", 100, "10-Q", "2025-04-30"),
            fact("2025-01-01", "2025-06-30", 210, "10-Q", "2025-07-30"),
            fact("2025-01-01", "2025-09-30", 340, "10-Q", "2025-10-30"),
            fact("2025-01-01", "2025-12-31", 300, "10-K", "2026-02-01"), // restated after a spin-off
            ...extra,
          ],
        },
        OperatingIncomeLoss: { facts: OPINC },
      }),
    );
  const q4 = (s: ReturnType<typeof buildStatements>) => {
    const q = s.quarterly.income;
    return q.rows.find((r) => r.key === "revenue")!.cells[q.periods.findIndex((p) => p.key === "FY2025Q4")];
  };

  it("derives Q4 from a restated annual total and the restated nine-month comparative", () => {
    // The next year's Q3 10-Q carries the restated 9M comparative (220).
    expect(q4(restated([fact("2025-01-01", "2025-09-30", 220, "10-Q", "2026-10-30")]))?.v).toBe(80);
  });

  it("drops a fourth quarter that would come out negative from mismatched restatements", () => {
    // Only the original 9M (340) exists, so 300 − 340 would show negative revenue.
    expect(q4(restated([]))?.v ?? null).toBeNull();
  });

  it("rescales share counts a filing tagged in millions, keeping the tagged fact as the source", () => {
    const y = (v: number, yr: number) => fact(`${yr}-01-01`, `${yr}-12-31`, v, "10-K", `${yr + 1}-02-01`);
    const s = buildStatements(
      filer({
        Revenues: { facts: [y(25_000_000_000, 2024), y(26_000_000_000, 2025)] },
        NetIncomeLoss: { facts: [y(8_223_000_000, 2024), y(8_563_000_000, 2025)] },
        EarningsPerShareDiluted: { unit: "USD/shares", facts: [y(11.39, 2024), y(11.95, 2025)] },
        WeightedAverageNumberOfDilutedSharesOutstanding: { unit: "shares", facts: [y(721.9, 2024), y(716_400_000, 2025)] },
      }),
    );
    const sh = s.annual.income.rows.find((r) => r.key === "sharesDiluted")!;
    expect(sh.cells[0]!.v).toBe(721_900_000);
    expect(sh.cells[0]!.derived?.parts[0].value).toBe(721.9);
    expect(sh.cells[1]!.v).toBe(716_400_000);
    expect(sh.cells[1]!.src).toBeDefined();
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

describe("fiscal year in progress with a missing 10-Q", () => {
  // FY2026 10-Qs: Q1 and Q3 present, the Q2 filing absent from companyfacts.
  const facts = [
    ...REVENUE,
    fact("2026-01-01", "2026-03-31", 120, "10-Q", "2026-04-30"),
    fact("2026-01-01", "2026-09-30", 400, "10-Q", "2026-10-30"),
    fact("2026-07-01", "2026-09-30", 145, "10-Q", "2026-10-30"),
  ];
  const s = buildStatements(filer({ Revenues: { facts }, OperatingIncomeLoss: { facts: OPINC } }));
  const q = s.quarterly.income;
  const rev = q.rows.find((r) => r.key === "revenue")!;
  const at = (key: string) => rev.cells[q.periods.findIndex((p) => p.key === key)];

  it("keeps the nine-month quarter as Q3 instead of deriving Q2 as 9M − Q1", () => {
    // The empty Q2 column is pruned like any period without figures; TTM then reports null
    // because the quarters aren't contiguous, rather than summing the wrong four.
    expect(q.periods.filter((p) => p.fy === 2026).map((p) => [p.key, p.start, p.end])).toEqual([
      ["FY2026Q1", "2026-01-01", "2026-03-31"],
      ["FY2026Q3", "2026-07-01", "2026-09-30"],
    ]);
    expect(at("FY2026Q1")?.v).toBe(120);
    expect(at("FY2026Q3")?.v).toBe(145);
    expect(at("FY2026Q3")?.src).toBeTruthy();
  });

  it("quarterEndAfter gives calendar quarter ends", () => {
    expect(quarterEndAfter("2026-01-01", 2)).toBe("2026-06-30");
    expect(quarterEndAfter("2025-10-01", 1)).toBe("2025-12-31");
    expect(quarterEndAfter("2025-02-01", 2)).toBe("2025-07-31");
  });
});

describe("Q4 derivation across a later restatement", () => {
  // FY2025 10-K total (filed Feb 2026) on the original basis; the FY2026 Q3 10-Q later restates the
  // FY2025 nine months for a divestiture. Q4 must use the nine months as filed before the 10-K.
  const facts = [
    fact("2024-01-01", "2024-12-31", 400, "10-K", "2025-02-01"),
    fact("2025-01-01", "2025-12-31", 480, "10-K", "2026-02-01"),
    fact("2025-01-01", "2025-03-31", 100, "10-Q", "2025-04-30"),
    fact("2025-04-01", "2025-06-30", 110, "10-Q", "2025-07-30"),
    fact("2025-01-01", "2025-06-30", 210, "10-Q", "2025-07-30"),
    fact("2025-01-01", "2025-09-30", 340, "10-Q", "2025-10-30"),
    fact("2025-07-01", "2025-09-30", 130, "10-Q", "2025-10-30"),
    fact("2025-01-01", "2025-09-30", 250, "10-Q", "2026-10-30"), // restated comparative
  ];
  it("subtracts the nine months filed before the 10-K, not the later restated figure", () => {
    const q = buildStatements(filer({ Revenues: { facts }, OperatingIncomeLoss: { facts: OPINC } })).quarterly.income;
    const cell = q.rows.find((r) => r.key === "revenue")!.cells[q.periods.findIndex((p) => p.key === "FY2025Q4")]!;
    expect(cell.v).toBe(140); // 480 − 340, not 480 − 250
  });
});
