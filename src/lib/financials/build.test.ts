import { describe, expect, it } from "vitest";
import { buildStatements, quarterEndAfter, type CompanyFacts, type RawFact } from "./build";
import { fmtCell, scaled, unitLabel } from "../format";
import debtFacts from "./fixtures/debt-facts.json";
import convertibleFacts from "./fixtures/debt-facts-convertible.json";
import leftOutFacts from "./fixtures/debt-facts-left-out.json";
import heldFacts from "./fixtures/debt-facts-held.json";
import capexOilFacts from "./fixtures/capex-oil-facts.json";
import stiCapexFacts from "./fixtures/sti-capex-facts.json";
import linesFacts from "./fixtures/debt-facts-lines.json";
import capexImprovementsFacts from "./fixtures/capex-improvements-facts.json";
import cfoContinuingFacts from "./fixtures/cfo-continuing-facts.json";
import capexProvenFacts from "./fixtures/capex-proven-facts.json";
import epsContinuingFacts from "./fixtures/eps-continuing-facts.json";
import incomeLinesFacts from "./fixtures/income-lines-facts.json";
import periodsEpsFacts from "./fixtures/periods-eps-facts.json";

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
    fact("2025-01-01", "2025-12-31", 480, "10-K", "2026-02-01", "0000000001-26-100001"),
    fact("2024-01-01", "2024-12-31", 400, "10-K", "2026-02-01", "0000000001-26-100001"), // same basis as the FY2024 10-K
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

// Causes found by checking the builder against filings' own statements (round 3 accuracy sample).
describe("headline lines against the filed statements", () => {
  const at = (end: string, val: number) => fact(undefined, end, val, "10-K", "2026-02-20");
  const fy25 = (s: ReturnType<typeof buildStatements>, stmt: "income" | "balance" | "cashflow", key: string) => {
    const st = s.annual[stmt];
    return st.rows.find((r) => r.key === key)?.cells[st.periods.findIndex((p) => p.key === "FY2025")] ?? null;
  };
  const base = { Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } };

  it("does not add short-term debt a long-term figure already includes (Chevron FY2025: tag choice)", () => {
    // CVX tags $39,781M as both LongTermDebtAndCapitalLeaseObligations and …IncludingCurrentMaturities; DebtCurrent $10,918M
    // is gross short-term debt before $9,941M was reclassified into long-term. Face: 977 + 39,781 = 40,758.
    const s = buildStatements(filer({
      ...base,
      LongTermDebtAndCapitalLeaseObligations: { facts: [at("2025-12-31", 39_781)] },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { facts: [at("2025-12-31", 39_781)] },
      DebtCurrent: { facts: [at("2025-12-31", 10_918)] },
      ShortTermBorrowings: { facts: [at("2025-12-31", 977)] },
    }));
    const d = fy25(s, "balance", "totalDebt")!;
    expect(d.v).toBe(40_758);
    expect(d.derived?.parts.map((p) => p.concept)).toEqual(["us-gaap:LongTermDebtAndCapitalLeaseObligations", "us-gaap:ShortTermBorrowings"]);
  });

  it("adds short-term borrowings beside current maturities (FedEx FY2026, Home Depot: tag choice)", () => {
    // FDX: current portion 1,676 + short-term borrowings 745 + long-term 23,293 = 25,714 (we showed 24,969).
    const s = buildStatements(filer({
      ...base,
      LongTermDebtNoncurrent: { facts: [at("2025-12-31", 23_293)] },
      LongTermDebtAndCapitalLeaseObligationsCurrent: { facts: [at("2025-12-31", 1_676)] },
      ShortTermBorrowings: { facts: [at("2025-12-31", 745)] },
    }));
    const d = fy25(s, "balance", "totalDebt")!;
    expect(d.v).toBe(25_714);
    expect(d.derived?.parts.map((p) => p.value)).toEqual([23_293, 1_676, 745]);
  });

  it("reads notes payable and loans as debt (Oracle: tag choice, total debt was the current part only)", () => {
    const s = buildStatements(filer({
      ...base,
      LongTermNotesAndLoans: { facts: [at("2025-12-31", 117_712)] },
      NotesPayableCurrent: { facts: [at("2025-12-31", 7_625)] },
    }));
    expect(fy25(s, "balance", "totalDebt")!.v).toBe(125_337);
  });

  it("reads Deere's long-term borrowings from its company extension (company extension)", () => {
    const cf = filer({ ...base, DebtCurrent: { facts: [at("2025-12-31", 13_796)] } });
    cf.facts.de = { LongTermDebtAndFinanceLeasesNoncurrent: { units: { USD: [at("2025-12-31", 43_544)] } } };
    const d = fy25(buildStatements(cf), "balance", "totalDebt")!;
    expect(d.v).toBe(57_340);
    expect(d.derived?.parts[0].concept).toBe("de:LongTermDebtAndFinanceLeasesNoncurrent");
  });

  it("drops a segment-measure 'operating income' when the statement runs straight to pretax (MetLife FY2025: tag choice)", () => {
    const y = (v: number) => [fact("2025-01-01", "2025-12-31", v, "10-K", "2026-02-19")];
    const s = buildStatements(filer({
      Revenues: { facts: y(77_084) },
      BenefitsLossesAndExpenses: { facts: y(72_423) },
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: { facts: y(4_661) },
      OperatingIncomeLoss: { facts: y(6_137) }, // "Total consolidated adjusted earnings" in the segment note
      NetIncomeLoss: { facts: y(3_379) },
    }));
    expect(fy25(s, "income", "operatingIncome")).toBeNull();
    expect(fy25(s, "income", "pretaxIncome")!.v).toBe(4_661);
  });

  it("keeps operating income when costs and expenses lead to it, not to pretax income", () => {
    const y = (v: number) => [fact("2025-01-01", "2025-12-31", v, "10-K", "2026-02-19")];
    const s = buildStatements(filer({
      Revenues: { facts: y(1_000) },
      CostsAndExpenses: { facts: y(800) },
      OperatingIncomeLoss: { facts: y(200) },
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: { facts: y(180) },
    }));
    expect(fy25(s, "income", "operatingIncome")!.v).toBe(200);
  });

  it("takes a utility's total operating revenues over its contract-revenue note figure (Duke FY2025: tag choice)", () => {
    const y = (v: number) => [fact("2025-01-01", "2025-12-31", v, "10-K", "2026-02-26")];
    const s = buildStatements(filer({
      RegulatedAndUnregulatedOperatingRevenue: { facts: y(32_237) },
      RevenueFromContractWithCustomerIncludingAssessedTax: { facts: y(31_741) },
      OperatingIncomeLoss: { facts: y(6_000) },
    }));
    expect(fy25(s, "income", "revenue")!.src?.concept).toBe("us-gaap:RegulatedAndUnregulatedOperatingRevenue");
    expect(fy25(s, "income", "revenue")!.v).toBe(32_237);
  });
});

describe("52/53-week retail calendars (fiscal calendar)", () => {
  const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  it("places 12/12/12/16-week quarters before the 10-K (Costco: Q2 and Q3 were missing all year)", () => {
    const y0 = "2024-09-02", y1 = "2025-08-31", s1 = "2025-09-01";
    const rev = [
      fact(y0, y1, 1000, "10-K", "2025-10-08"),
      fact(s1, add(s1, 83), 230, "10-Q", "2025-12-15"), // 12 weeks
      fact(add(s1, 84), add(s1, 167), 240, "10-Q", "2026-03-10"),
      fact(s1, add(s1, 167), 470, "10-Q", "2026-03-10"), // 24 weeks: 168 days
      fact(add(s1, 168), add(s1, 251), 250, "10-Q", "2026-06-02"),
      fact(s1, add(s1, 251), 720, "10-Q", "2026-06-02"), // 36 weeks: 252 days
    ];
    const q = buildStatements(filer({ Revenues: { facts: rev } })).quarterly.income;
    expect(q.periods.filter((p) => p.fy === 2026).map((p) => [p.key, p.end])).toEqual([
      ["FY2026Q1", add(s1, 83)],
      ["FY2026Q2", add(s1, 167)],
      ["FY2026Q3", add(s1, 251)],
    ]);
    expect(q.rows.find((r) => r.key === "revenue")!.cells.slice(-3).map((c) => c?.v)).toEqual([230, 240, 250]);
  });

  it("places a 16-week first quarter (Kroger, Albertsons: no quarters at all before)", () => {
    const s0 = "2025-02-02", e0 = "2026-01-31";
    const rev = [
      fact(s0, add(s0, 111), 450, "10-Q", "2025-06-20"), // 16 weeks
      fact(add(s0, 112), add(s0, 195), 340, "10-Q", "2025-09-12"),
      fact(s0, add(s0, 195), 790, "10-Q", "2025-09-12"), // 28 weeks: 196 days
      fact(add(s0, 196), add(s0, 279), 345, "10-Q", "2025-12-05"),
      fact(s0, add(s0, 279), 1135, "10-Q", "2025-12-05"), // 40 weeks: 280 days
      fact(s0, e0, 1480, "10-K", "2026-04-01"),
      fact("2024-02-04", "2025-02-01", 1400, "10-K", "2025-04-01"),
    ];
    const q = buildStatements(filer({ Revenues: { facts: rev } })).quarterly.income;
    expect(q.rows.find((r) => r.key === "revenue")!.cells.slice(-4).map((c) => c?.v)).toEqual([450, 340, 345, 345]);
  });
});

describe("years in progress beyond the last 10-K (fiscal calendar)", () => {
  it("places the next year's quarters when a 10-K is missing from companyfacts (Clorox FY2026)", () => {
    const rev = [
      fact("2024-07-01", "2025-06-30", 700, "10-K", "2025-08-10"),
      fact("2023-07-01", "2024-06-30", 690, "10-K", "2024-08-10"),
      fact("2025-07-01", "2025-09-30", 170, "10-Q", "2025-11-03"),
      fact("2025-07-01", "2025-12-31", 350, "10-Q", "2026-02-03"),
      fact("2025-10-01", "2025-12-31", 180, "10-Q", "2026-02-03"),
      fact("2025-07-01", "2026-03-31", 520, "10-Q", "2026-04-30"),
      fact("2026-01-01", "2026-03-31", 170, "10-Q", "2026-04-30"),
      // no FY2026 10-K facts; the FY2027 Q1 10-Q:
      fact("2026-07-01", "2026-09-30", 175, "10-Q", "2026-11-02"),
    ];
    const q = buildStatements(filer({ Revenues: { facts: rev } })).quarterly.income;
    expect(q.periods.slice(-2).map((p) => [p.key, p.end])).toEqual([["FY2026Q3", "2026-03-31"], ["FY2027Q1", "2026-09-30"]]);
    expect(q.rows.find((r) => r.key === "revenue")!.cells.at(-1)?.v).toBe(175);
  });

  it("starts the new year after a transition period 10-KT (Ferguson: July year end to December)", () => {
    const rev = [
      fact("2023-08-01", "2024-07-31", 290, "10-K", "2024-09-20"),
      fact("2024-08-01", "2025-07-31", 300, "10-K", "2025-09-20"),
      fact("2025-08-01", "2025-10-31", 80, "10-Q", "2025-12-09"),
      fact("2025-08-01", "2025-12-31", 130, "10-KT", "2026-02-27"), // five-month transition period
      fact("2026-01-01", "2026-03-31", 75, "10-Q", "2026-05-05"),
      fact("2026-04-01", "2026-06-30", 82, "10-Q", "2026-08-10"),
      fact("2026-01-01", "2026-06-30", 157, "10-Q", "2026-08-10"),
      fact("2026-07-01", "2026-09-30", 84, "10-Q", "2026-11-09"),
      fact("2026-01-01", "2026-09-30", 241, "10-Q", "2026-11-09"),
    ];
    const q = buildStatements(filer({ Revenues: { facts: rev } })).quarterly.income;
    expect(q.periods.slice(-3).map((p) => [p.key, p.end])).toEqual([["FY2026Q1", "2026-03-31"], ["FY2026Q2", "2026-06-30"], ["FY2026Q3", "2026-09-30"]]);
    expect(q.rows.find((r) => r.key === "revenue")!.cells.slice(-3).map((c) => c?.v)).toEqual([75, 82, 84]);
  });
});

describe("debt lines tagged twice", () => {
  const at = (end: string, val: number) => fact(undefined, end, val, "10-K", "2026-02-20");
  const base = { Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } };
  const debt = (s: ReturnType<typeof buildStatements>) => {
    const st = s.annual.balance;
    return st.rows.find((r) => r.key === "totalDebt")!.cells[st.periods.findIndex((p) => p.key === "FY2025")]!;
  };
  it("counts one amount tagged under two concepts once (Con Edison: CommercialPaper and NotesPayableCurrent)", () => {
    const s = buildStatements(filer({ ...base, LongTermDebtNoncurrent: { facts: [at("2025-12-31", 26_844)] }, CommercialPaper: { facts: [at("2025-12-31", 392)] }, NotesPayableCurrent: { facts: [at("2025-12-31", 392)] }, LongTermDebtCurrent: { facts: [at("2025-12-31", 250)] } }));
    expect(debt(s).v).toBe(26_844 + 250 + 392);
  });
  it("does not add commercial paper inside a larger short-term borrowings total (PepsiCo)", () => {
    const s = buildStatements(filer({ ...base, LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { facts: [at("2025-12-31", 42_658)] }, ShortTermBorrowings: { facts: [at("2025-12-31", 9_223)] }, CommercialPaper: { facts: [at("2025-12-31", 4_800)] } }));
    expect(debt(s).v).toBe(51_881);
  });
  it("keeps current maturities when plain LongTermDebt is the noncurrent line (IDACORP)", () => {
    const s = buildStatements(filer({ ...base, LongTermDebtNoncurrent: { facts: [at("2025-12-31", 3_331_038)] }, LongTermDebt: { facts: [at("2025-12-31", 3_331_038)] }, LongTermDebtCurrent: { facts: [at("2025-12-31", 116_300)] } }));
    expect(debt(s).v).toBe(3_447_338);
  });
});

describe("commercial paper beside short-term borrowings", () => {
  const at = (end: string, val: number) => fact(undefined, end, val, "10-K", "2026-02-20");
  const base = { Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } };
  const debt = (s: ReturnType<typeof buildStatements>) => {
    const st = s.annual.balance;
    return st.rows.find((r) => r.key === "totalDebt")!.cells[st.periods.findIndex((p) => p.key === "FY2025")]!.v;
  };
  it("is not added on top of the borrowings line (FedEx FY2026: $750M paper, $745M borrowings)", () => {
    expect(debt(buildStatements(filer({ ...base, LongTermDebtNoncurrent: { facts: [at("2025-12-31", 23_293)] }, LongTermDebtAndCapitalLeaseObligationsCurrent: { facts: [at("2025-12-31", 1_676)] }, ShortTermBorrowings: { facts: [at("2025-12-31", 745)] }, CommercialPaper: { facts: [at("2025-12-31", 750)] } })))).toBe(25_714);
  });
  it("is not added after paper was reclassified to long-term (Chevron FY2025)", () => {
    expect(debt(buildStatements(filer({ ...base, LongTermDebtAndCapitalLeaseObligations: { facts: [at("2025-12-31", 39_781)] }, LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { facts: [at("2025-12-31", 39_781)] }, ShortTermBorrowings: { facts: [at("2025-12-31", 977)] }, CommercialPaper: { facts: [at("2025-12-31", 4_642)] } })))).toBe(40_758);
  });
  it("does not add other short-term borrowings that are part of the borrowings total (Citigroup 2009, JPMorgan 2016)", () => {
    expect(debt(buildStatements(filer({ ...base, LongTermDebtNoncurrent: { facts: [at("2025-12-31", 364_019)] }, ShortTermBorrowings: { facts: [at("2025-12-31", 68_879)] }, CommercialPaper: { facts: [at("2025-12-31", 10_223)] }, OtherShortTermBorrowings: { facts: [at("2025-12-31", 58_656)] } })))).toBe(364_019 + 68_879);
  });
  it("still counts other short-term borrowings when there is no borrowings total (NextEra)", () => {
    expect(debt(buildStatements(filer({ ...base, LongTermDebtNoncurrent: { facts: [at("2025-12-31", 80_000)] }, CommercialPaper: { facts: [at("2025-12-31", 3_000)] }, OtherShortTermBorrowings: { facts: [at("2025-12-31", 1_500)] } })))).toBe(84_500);
  });
  it("does not turn a lone NotesPayableCurrent note figure into debt (Meta FY2015)", () => {
    const s = buildStatements(filer({ ...base, NotesPayableCurrent: { facts: [at("2025-12-31", 201)] } }));
    const st = s.annual.balance;
    const i = st.periods.findIndex((p) => p.key === "FY2025");
    expect(st.rows.find((r) => r.key === "shortTermDebt")?.cells[i] ?? null).toBeNull();
    expect(st.rows.find((r) => r.key === "totalDebt")?.cells[i] ?? null).toBeNull();
  });
  it("counts NotesPayableCurrent beside long-term debt (Oracle)", () => {
    expect(debt(buildStatements(filer({ ...base, LongTermNotesAndLoans: { facts: [at("2025-12-31", 92_568)] }, NotesPayableCurrent: { facts: [at("2025-12-31", 7_271)] } })))).toBe(99_839);
  });
  it("still counts paper that is the only short-term line (Home Depot)", () => {
    expect(debt(buildStatements(filer({ ...base, LongTermDebtAndCapitalLeaseObligations: { facts: [at("2025-12-31", 46_341)] }, LongTermDebtAndCapitalLeaseObligationsCurrent: { facts: [at("2025-12-31", 4_967)] }, CommercialPaper: { facts: [at("2025-12-31", 4_464)] } })))).toBe(55_772);
  });
});

/**
 * Reduced copies of the companies' SEC companyfacts (statement-relevant concepts only, cached 23 Nov 2026),
 * checked against the balance sheets of the filings named in each case.
 */
describe("total debt, net debt and short-term investments on real filings", () => {
  const FIXTURE = debtFacts as unknown as Record<string, CompanyFacts>;
  const cellAt = (t: string, freq: "annual" | "quarterly", key: string, end: string) => {
    const st = buildStatements(FIXTURE[t])[freq].balance;
    const i = st.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    return st.rows.find((r) => r.key === key)?.cells[i] ?? null;
  };

  it("does not add current notes to a long-term figure that already includes them (Autodesk Q2 FY27, 10-Q 0000769397-26-000061)", () => {
    // Face: short-term borrowings 994 + current notes 499 + long-term notes 1,985 = $3,478M; LongTermDebt $2,500M is the principal of all notes.
    const d = cellAt("ADSK", "quarterly", "totalDebt", "2026-07-31")!;
    expect(d.v).toBe(3_478_000_000);
    expect(d.derived?.parts.map((p) => p.concept).sort()).toEqual(["us-gaap:LongTermNotesPayable", "us-gaap:NotesPayableCurrent", "us-gaap:ShortTermBorrowings"]);
  });

  it("reads LongTermNotesPayable as long-term debt (Omnicom Q3 2026, 10-Q 0000029989-26-000026; FY2025, 10-K 0000029989-26-000006)", () => {
    expect(cellAt("OMC", "quarterly", "totalDebt", "2026-09-30")!.v).toBeCloseTo(10_018_300_000, -3); // 568.3 + 60.5 + 9,389.5
    expect(cellAt("OMC", "annual", "totalDebt", "2025-12-31")!.v).toBeCloseTo(9_116_500_000, -3); // 1,399.5 + 62 + 7,655
    expect(cellAt("OMC", "quarterly", "longTermDebt", "2026-09-30")!.src?.concept).toBe("us-gaap:LongTermNotesPayable");
  });

  it("adds current notes to a plain LongTermDebt when the filing's notes total says it is the noncurrent line (Biogen Q1 2025, 10-Q 0000875045-25-000018)", () => {
    // LongTermDebt 4,548.7 + NotesPayableCurrent 1,749.1 = NotesPayable 6,297.8.
    expect(cellAt("BIIB", "quarterly", "totalDebt", "2025-03-31")!.v).toBeCloseTo(6_297_800_000, -3);
  });

  it("falls back to LongTermDebt when the noncurrent notes line is only part of the debt (BKV Q3 2024: zero notes, $190M of debt)", () => {
    expect(cellAt("BKV", "quarterly", "totalDebt", "2024-09-30")!.v).toBe(190_000_000);
  });

  it("adds LongTermDebt beside a notes group that NotesPayable totals (TerrAscend Q3 2026, 10-Q 0001754195-26-000089; FY2025, 10-K 0001754195-26-000019)", () => {
    // Face: current notes 4,239 + notes 88,654 + private placement notes 196,008 (tagged LongTermDebt) = $288,901K;
    // NotesPayable 93,765 totals the two notes lines. FY2025: 4,077 + 90,839 + 136,741.
    expect(cellAt("TRLV", "quarterly", "totalDebt", "2026-09-30")!.v).toBe(288_901_000);
    expect(cellAt("TRLV", "annual", "totalDebt", "2025-12-31")!.v).toBe(231_657_000);
  });

  it("matches the face when current and long-term notes add up to LongTermDebt (Andersen Q3 2026, 10-Q 0002065708-26-000009)", () => {
    expect(cellAt("ANDG", "quarterly", "totalDebt", "2026-09-30")!.v).toBe(287_713_000); // 54.8 + 232.9
  });

  it("still adds current notes beside a noncurrent line, which agrees with the tagged total (Waters FY2025, 10-K 0001193125-26-062604)", () => {
    const d = cellAt("WAT", "annual", "totalDebt", "2025-12-31")!;
    expect(d.v).toBe(1_407_000_000); // 460 + 947 (the 10-Q comparative, filed later, rounds the 10-K's 947.4)
    expect(d.derived).toBeTruthy();
  });

  it("shows the balance sheet's own debt total when the lines are only part of it (Travelers FY2025, 10-K 0000086312-26-000065)", () => {
    const d = cellAt("TRV", "annual", "totalDebt", "2025-12-31")!;
    expect(d.v).toBe(9_267_000_000); // was $300M, DebtCurrent only
    expect(d.src?.concept).toBe("us-gaap:DebtLongtermAndShorttermCombinedAmount");
  });

  it("reads debt and lease obligations as total debt (Aflac Q3 2026, 10-Q 0001628280-26-070776: notes payable and lease obligations)", () => {
    const d = cellAt("AFL", "quarterly", "totalDebt", "2026-09-30")!;
    expect(d.v).toBe(8_900_000_000);
    expect(d.src?.concept).toBe("us-gaap:DebtAndCapitalLeaseObligations");
  });

  it("shows the tagged total when the lines are a fraction of it (GATX Q3 2026, 10-Q 0000040211-26-000096: 34.6 + 11,904.0)", () => {
    const d = cellAt("GATX", "quarterly", "totalDebt", "2026-09-30")!;
    expect(d.v).toBeCloseTo(11_938_600_000, -3); // was $34.6M, commercial paper only
  });

  it("leaves total debt and net debt empty when the tagged total is itself a subtotal (Super Micro Q1 FY27, 10-Q 0001375365-26-000027)", () => {
    // Face: credit lines and term loans 1,962.7 + 2,014.4 (company extensions; $3,977.1M tagged as the combined amount) + convertible notes 4,668.9.
    expect(cellAt("SMCI", "quarterly", "totalDebt", "2026-09-30")).toBeNull();
    expect(cellAt("SMCI", "quarterly", "netDebt", "2026-09-30")).toBeNull();
  });

  it("counts current debt securities as short-term investments, so net debt has the right sign (NVIDIA Q2 FY27, 10-Q 0001045810-26-000075)", () => {
    const sti = cellAt("NVDA", "quarterly", "shortTermInvestments", "2026-07-26")!;
    expect(sti.v).toBe(34_143_000_000);
    expect(sti.src?.concept).toBe("us-gaap:DebtSecuritiesCurrent");
    const debt = cellAt("NVDA", "quarterly", "totalDebt", "2026-07-26")!;
    const net = cellAt("NVDA", "quarterly", "netDebt", "2026-07-26")!;
    expect(net.v).toBe(debt.v - 22_443_000_000 - 34_143_000_000);
    expect(net.v).toBeLessThan(0);
  });
});

describe("total debt that cannot be established", () => {
  const at = (end: string, val: number) => fact(undefined, end, val, "10-K", "2026-02-20");
  const base = { Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } };
  it("is left empty, with net debt, when the lines found are a fragment of the debt the filing tags", () => {
    const s = buildStatements(filer({ ...base, DebtCurrent: { facts: [at("2025-12-31", 300)] }, LongTermDebt: { facts: [at("2025-12-31", 9_000)] }, CashAndCashEquivalentsAtCarryingValue: { facts: [at("2025-12-31", 500)] } }));
    const st = s.annual.balance;
    const i = st.periods.findIndex((p) => p.key === "FY2025");
    // LongTermDebt is read as the long-term line here, so the lines are complete: 9,000 incl. current.
    expect(st.rows.find((r) => r.key === "totalDebt")?.cells[i]?.v).toBe(9_000);
    const frag = buildStatements(filer({ ...base, DebtCurrent: { facts: [at("2025-12-31", 300)] }, DebtInstrumentCarryingAmount: { facts: [at("2025-12-31", 9_000)] }, CashAndCashEquivalentsAtCarryingValue: { facts: [at("2025-12-31", 500)] } }));
    const fs = frag.annual.balance;
    const j = fs.periods.findIndex((p) => p.key === "FY2025");
    expect(fs.rows.find((r) => r.key === "totalDebt")?.cells[j] ?? null).toBeNull();
    expect(fs.rows.find((r) => r.key === "netDebt")?.cells[j] ?? null).toBeNull();
  });
});

describe("a tagged debt total below the balance sheet lines", () => {
  const at = (end: string, val: number) => fact(undefined, end, val, "10-K", "2026-02-20");
  it("keeps the lines when the tagged total is a debt note subtotal (FedEx FY2026: $24,969M tagged, $25,714M on the face)", () => {
    const s = buildStatements(filer({ Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC }, LongTermDebtNoncurrent: { facts: [at("2025-12-31", 23_293)] }, LongTermDebtAndCapitalLeaseObligationsCurrent: { facts: [at("2025-12-31", 1_676)] }, ShortTermBorrowings: { facts: [at("2025-12-31", 745)] }, DebtAndCapitalLeaseObligations: { facts: [at("2025-12-31", 24_969)] } }));
    const st = s.annual.balance;
    expect(st.rows.find((r) => r.key === "totalDebt")!.cells[st.periods.findIndex((p) => p.key === "FY2025")]!.v).toBe(25_714);
  });
});

describe("capital expenditure from company extensions", () => {
  it("reads Cigna's net purchases of property and equipment (FY2025 $1,212M, 10-K 0001739940-26-000006)", () => {
    const cf = filer({ Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } });
    cf.facts.ci = {
      PaymentsForProceedsFromPropertyPlantAndEquipment: {
        units: { USD: [fact("2025-01-01", "2025-12-31", 1212, "10-K", "2026-02-26", "0001739940-26-000006"), fact("2024-01-01", "2024-12-31", 1406, "10-K", "2026-02-26", "0001739940-26-000006")] },
      },
    };
    const a = buildStatements(cf).annual.cashflow;
    const cell = a.rows.find((r) => r.key === "capex")!.cells[a.periods.findIndex((p) => p.key === "FY2025")]!;
    expect(cell.v).toBe(1212);
    expect(cell.src?.concept).toBe("ci:PaymentsForProceedsFromPropertyPlantAndEquipment");
  });
});

/** Reduced companyfacts (AKAM, MRNA, DDOG cached 23 Nov 2026, ONDS 24 Nov 2026), checked against each filing's balance sheet. */
describe("convertible notes and credit lines as balance sheet debt lines", () => {
  const FIXTURE = convertibleFacts as unknown as Record<string, CompanyFacts>;
  const cellAt = (t: string, freq: "annual" | "quarterly", key: string, end: string) => {
    const st = buildStatements(FIXTURE[t])[freq].balance;
    const i = st.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    return st.rows.find((r) => r.key === key)?.cells[i] ?? null;
  };

  it("reads current and noncurrent convertible notes (Akamai Q3 2026, 10-Q 0001086222-26-000100)", () => {
    // Face: convertible senior notes 1,148,346 (current) + 6,419,341 = $7,567,687K; no other debt line.
    expect(cellAt("AKAM", "quarterly", "totalDebt", "2026-09-30")!.v).toBe(7_567_687_000);
    expect(cellAt("AKAM", "quarterly", "longTermDebt", "2026-09-30")!.v).toBe(6_419_341_000);
  });

  it("reads a lone convertible notes line (Datadog Q3 2026, 10-Q 0001628280-26-070292)", () => {
    expect(cellAt("DDOG", "quarterly", "totalDebt", "2026-09-30")!.v).toBe(986_595_000);
  });

  it("adds convertible notes to a drawn credit line (Moderna Q3 2026, 10-Q 0001682852-26-000197)", () => {
    // Face: "Long-term debt" 591 (LongTermLineOfCredit) + convertible notes 2,958 = $3,549M.
    expect(cellAt("MRNA", "quarterly", "totalDebt", "2026-09-30")!.v).toBe(3_549_000_000);
  });

  it("shows no total when the convertibles are tagged inconsistently (Ondas FY2025, 10-K 0001213900-26-035981)", () => {
    // Face: 1,500 + 704 + 3,500 + 2,950 + 3,834 = $12,488K, three of the lines under company extensions.
    expect(cellAt("ONDS", "annual", "totalDebt", "2025-12-31")).toBeNull();
    expect(cellAt("ONDS", "annual", "totalDebt", "2024-12-31")).toBeNull();
  });
});


/**
 * Reduced companyfacts (fetched 24 Nov 2026 by the p3-fin review) of six filers whose balance sheet prints a
 * debt line under a concept the total is not built from, or whose plain LongTermDebt is the notes' principal.
 * Each face was read from the 10-Q's balance sheet. A fragment is never shown as total debt: these stay empty.
 */
describe("total debt that leaves out a tagged debt line", () => {
  const FIXTURE = leftOutFacts as unknown as Record<string, CompanyFacts>;
  const debtAt = (t: string, end: string) => {
    const st = buildStatements(FIXTURE[t]).quarterly.balance;
    const i = st.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    return st.rows.find((r) => r.key === "totalDebt")?.cells[i] ?? null;
  };

  it("does not show a note's convertible figure as the total (Tempus Q3 2026, 10-Q 0001193125-26-442624)", () => {
    // Face: convertible senior notes $1,174.877M under a company extension; companyfacts has only $175.967M
    // of ConvertibleDebtNoncurrent from a note. Before: 175,967,000.
    expect(debtAt("TEM", "2026-09-30")).toBeNull();
  });

  it("does not drop term loans beside convertible notes (Collegium Q3 2026, 10-Q 0001628280-26-070589)", () => {
    // Face: 60.5 (LoansPayableCurrent) + 782.0 (LongTermLoansPayable) + 239.0 convertible = $1,081.5M. Before: 239.0.
    expect(debtAt("COLL", "2026-09-30")).toBeNull();
  });

  it("does not drop convertible notes beside other debt (Applied Optoelectronics Q3 2026, 10-Q 0001437749-26-035282)", () => {
    // Face: 60.0 + 36.6 + 128.8 convertible = $225.4M. Before: 96.6.
    expect(debtAt("AAOI", "2026-09-30")).toBeNull();
  });

  it("does not drop a current term loan (Dropbox Q3 2026, 10-Q 0001467623-26-000061)", () => {
    // Face: 0.0 + 27.1 (LinesOfCreditCurrent) + 691.1 + 2,580.2 = $3,298.4M. Before: 3,271.3.
    expect(debtAt("DBX", "2026-09-30")).toBeNull();
  });

  it("does not show the notes' principal as the carrying amount (Onto Q3 2026, Peloton Q3 2026)", () => {
    // Onto face: convertible notes $1,473.2M; LongTermDebt is the $1,500.0M principal (10-Q 0001193125-26-453859).
    expect(debtAt("ONTO", "2026-09-30")).toBeNull();
    // Peloton face: 10.0 + 345.3 + 943.7 = $1,299.0M; LongTermDebt $1,327.5M (10-Q 0001639825-26-000048).
    expect(debtAt("PTON", "2026-09-30")).toBeNull();
  });
});

/** Reduced companyfacts (fetched 24 Nov 2026 by the p3-fin review); figures as printed in each 10-K. */
describe("short-term investments and capex under other concepts", () => {
  const FIXTURE = stiCapexFacts as unknown as Record<string, CompanyFacts>;
  const annual = (t: string, st: "balance" | "cashflow", key: string, end: string) => {
    const s = buildStatements(FIXTURE[t]).annual[st];
    const i = s.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    return s.rows.find((r) => r.key === key)?.cells[i] ?? null;
  };

  it("reads current debt securities as short-term investments (DocuSign FY2026, 10-K 0001261333-26-000021)", () => {
    // Face: "Investments—current" $264,084K. Before: empty.
    expect(annual("DOCU", "balance", "shortTermInvestments", "2026-01-31")!.v).toBe(264_084_000);
  });

  it("reads other short-term investments (Old Republic FY2025, 10-K 0000074260-26-000008)", () => {
    // Face: "Short-term investments" $1,613.6M. Before: empty, and net debt overstated by that amount.
    expect(Math.round(annual("ORI", "balance", "shortTermInvestments", "2025-12-31")!.v / 1e5)).toBe(16_136);
  });

  it("does not read capital improvements as capex where the investing section does not prove it (Mid-America FY2025 stays empty)", () => {
    // Mid-America's face line "Capital improvements" $360.2M is its whole capital line, but its tagged investing
    // lines do not add up to net cash from investing (a line sits under an extension), the same evidence that keeps
    // Weyerhaeuser's $51M of reforestation, a fragment beside $423M under its own extension, from being read.
    expect(annual("MAA", "cashflow", "capex", "2025-12-31")).toBeNull();
  });

  it("reads additions to oil and gas properties as capex (Gulfport FY2025, 10-K 0001628280-26-011487)", () => {
    // Face: "Additions to oil and natural gas properties" $527.6M. Before: empty.
    expect(Math.round(annual("GPOR", "cashflow", "capex", "2025-12-31")!.v / 1e5)).toBe(5_276);
  });
});

/**
 * Reduced companyfacts (24 Nov 2026 cache) of filers whose total debt the hold rule must leave standing, or
 * must hold for a stated reason. Every figure below was read from the filing's balance sheet (R page) on
 * 24 Nov 2026; in $M.
 */
describe("total debt held only when the facts contradict it", () => {
  const FIXTURE = heldFacts as unknown as Record<string, CompanyFacts>;
  const debtAt = (t: string, freq: "annual" | "quarterly", end: string) => {
    const st = buildStatements(FIXTURE[t])[freq].balance;
    const i = st.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    return st.rows.find((r) => r.key === "totalDebt")?.cells[i] ?? null;
  };
  const m = (c: { v: number } | null) => (c ? Math.round(c.v / 1e5) / 10 : null);

  it("keeps convertible notes that are all of a company's debt (Palo Alto Networks, Okta, Hims & Hers)", () => {
    // "Long-term convertible senior notes" $1,774M, 10-K 0001327567-26-000023. Held empty by the first rule.
    expect(m(debtAt("PANW", "annual", "2026-07-31"))).toBe(1774);
    // "Convertible senior notes, net" $350M current, $0 noncurrent, 10-K 0001660134-26-000020.
    expect(m(debtAt("OKTA", "annual", "2026-01-31"))).toBe(350);
    // "Convertible senior notes, net" $972.6M, 10-K 0001773751-26-000022.
    expect(m(debtAt("HIMS", "annual", "2025-12-31"))).toBe(972.6);
  });

  it("holds a note's convertible figure when the balance sheet leaves room for a larger untagged line (Tempus Q3 2026)", () => {
    // Face: convertible senior notes $1,174.9M under tem:ConvertibleSeniorNotesNet; ConvertibleDebtNoncurrent $176.0M is
    // a note figure, and $1,197M of noncurrent liabilities have no tagged line (10-Q 0001193125-26-442624).
    expect(debtAt("TEM", "quarterly", "2026-09-30")).toBeNull();
  });

  it("holds convertible notes beside another long-term line it does not read (TransMedics FY2025, Knight-Swift Q3 2026)", () => {
    // Face: 10.0 + 452.8 convertible + 49.6 term loan (OtherLongTermDebtNoncurrent) = $512.4M (10-K 0001193125-26-067032). Main: 462.8.
    expect(debtAt("TMDX", "annual", "2025-12-31")).toBeNull();
    // Face: 167.6 + 180.2 + convertible senior notes (ConvertibleDebtNoncurrent $1,467.4M) (10-Q 0001492691-26-000069). Main: 231.9.
    expect(debtAt("KNX", "quarterly", "2026-09-30")).toBeNull();
  });

  it("keeps a total when the other concept is the same debt at principal or the whole of it (Tractor Supply, Allegiant)", () => {
    // Face: "Long-term debt" $1,765.0M; UnsecuredDebt $1,780.0M is the notes' principal (10-K 0000916365-26-000014).
    expect(m(debtAt("TSCO", "annual", "2025-12-27"))).toBe(1765);
    // Face: 118.1 + 1,681.5 = $1,799.6M; SecuredLongTermDebt tags the same $1,799.6M (10-K 0001362468-26-000008).
    expect(m(debtAt("ALGT", "annual", "2025-12-31"))).toBe(1799.6);
  });

  it("keeps a long-term line that is the convertible notes themselves (Viavi FY2026)", () => {
    // Face: short-term debt 244.8 + long-term debt 397.1 (ConvertibleDebtNoncurrent, also tagged LongTermDebt) (10-K 0001628280-26-056765).
    expect(m(debtAt("VIAV", "annual", "2026-06-27"))).toBe(641.9);
  });

  it("reads a real-estate trust's total from its own lines (Camden, Regency, Rexford, Equity LifeStyle)", () => {
    // Face: unsecured notes 3,921.5 + secured notes 306.8 = $4,228.3M; its $600M of commercial paper is inside the
    // unsecured notes (10-Q 0001628280-26-071470). Main: 4,828.3.
    expect(m(debtAt("CPT", "quarterly", "2026-09-30"))).toBe(4228.3);
    // Face: notes payable 4,619.3 + unsecured credit facility 120.0 = $4,739.3M = LongTermDebt (10-K 0001193125-26-051668).
    expect(m(debtAt("REG", "annual", "2025-12-31"))).toBe(4739.3);
    // Face: "Notes payable" $3,251.9M (LongTermDebt); secured + unsecured $3,278.6M are principal (10-K 0001571283-26-000006).
    expect(m(debtAt("REXR", "annual", "2025-12-31"))).toBe(3251.9);
    // Face: 2,779.2 + 437.5 + 105.0 = $3,321.6M; LongTermDebt $3,345.9M is that plus $24.3M of unamortized costs
    // (10-K 0001628280-26-008722). Main: 3,345.9.
    expect(m(debtAt("ELS", "annual", "2025-12-31"))).toBe(3321.6);
  });

  it("holds a trust's LongTermDebt that its lines do not explain (Essex Q2 2026, Kimco FY2025, Welltower Q3 2026)", () => {
    // Face: 5,569.3 + 784.2 + 345.0 (ess:LinesOfCreditAndCommercialPaper) = $6,698.5M; LongTermDebt $6,386.5M (10-Q 0000920522-26-000022).
    expect(debtAt("ESS", "quarterly", "2026-06-30")).toBeNull();
    // Face: notes payable 7,718.7 + mortgages 467.2 = $8,185.9M; LongTermDebt $7,718.7M is the notes alone (10-K 0001193125-26-060760).
    expect(debtAt("KIM", "annual", "2025-12-31")).toBeNull();
    // Face: 1,041.1 + 14,687.0 + 3,467.1 (well: extension) = $19,195.2M; LongTermDebt $18,154.1M (10-Q 0000766704-26-000046).
    expect(debtAt("WELL", "quarterly", "2026-09-30")).toBeNull();
  });
});

/** Reduced companyfacts (24 Nov 2026 cache); figures as printed on each 10-K's cash flow statement, in $M. */
describe("capex of oil and gas producers", () => {
  const FIXTURE = capexOilFacts as unknown as Record<string, CompanyFacts>;
  const capex = (t: string, end: string) => {
    const s = buildStatements(FIXTURE[t]).annual.cashflow;
    const i = s.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    const c = s.rows.find((r) => r.key === "capex")?.cells[i];
    return c ? Math.round(c.v / 1e5) / 10 : null;
  };

  it("reads development spending, not property acquisitions (Diamondback, SM Energy FY2025)", () => {
    // Face: "Additions to oil and natural gas properties" (3,523) beside "Property acquisitions" (5,938), 10-K 0001539838-26-000010.
    expect(capex("FANG", "2025-12-31")).toBe(3523);
    // Face: "Capital expenditures" (1,438) beside acquisitions (34), 10-K 0000893538-26-000032.
    expect(capex("SM", "2025-12-31")).toBe(1438);
    // Face: "Additions to oil and natural gas properties" (527.6), its only capital line, 10-K 0001628280-26-011487.
    expect(capex("GPOR", "2025-12-31")).toBe(527.6);
  });
});

describe("total debt the facts prove complete (reduced real companyfacts)", () => {
  const FIXTURE = linesFacts as unknown as Record<string, CompanyFacts>;
  const debtAt = (t: string, freq: "annual" | "quarterly", end: string) => {
    const st = buildStatements(FIXTURE[t])[freq].balance;
    const i = st.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    return st.rows.find((r) => r.key === "totalDebt")?.cells[i] ?? null;
  };
  const m = (c: { v: number } | null) => (c ? Math.round(c.v / 1e5) / 10 : null);

  it("ignores a credit-line figure the current liabilities add up without (Materion, Portland General)", () => {
    // Face: "Short-term debt" 22.4 + "Long-term debt" 436.3; no credit line among current liabilities of 253.6,
    // although LinesOfCreditCurrent 221.1 is tagged from a note (10-K 0001104657-26-000011).
    expect(m(debtAt("MTRN", "annual", "2025-12-31"))).toBe(458.8);
    // Face: "Long-term debt, net of current portion" 5,010; current liabilities 912 without the 320 (10-Q 0001193125-26-436451).
    expect(m(debtAt("POR", "quarterly", "2026-09-30"))).toBe(5010);
  });

  it("adds a credit line the current liabilities prove a balance sheet line (Seaboard, IDEXX, Dave)", () => {
    // Face: "Lines of credit" 711 among current liabilities of 1,785, "Long-term debt, less current maturities" 969
    // (10-Q 0000088121-26-000067); 10-K 0000088121-26-000012: 458 + 977. Main showed 969 and 977 alone.
    expect(m(debtAt("SEB", "quarterly", "2026-10-03"))).toBe(1680);
    expect(m(debtAt("SEB", "annual", "2025-12-31"))).toBe(1435);
    // Face: "Credit Facility" 474.0 + current portion 75.0 + long-term 299.9 (10-Q 0000874716-26-000135).
    expect(m(debtAt("IDXX", "quarterly", "2026-09-30"))).toBe(848.9);
    // Face: "Debit facility, current" 75.0, long-term 0 (10-K 0001193125-26-085370).
    expect(m(debtAt("DAVE", "annual", "2025-12-31"))).toBe(75);
  });

  it("does not add it when the short-term debt read beside it is not a current line (Iridium)", () => {
    // Face: credit facility 214.3 + term loan 1,925.0 (10-Q); NotesPayableCurrent 172.8 is not among the current lines,
    // so lines + credit line would overstate the debt: the total stays held.
    expect(debtAt("IRDM", "quarterly", "2026-09-30")).toBeNull();
  });

  it("does not read current maturities inside LongTermDebt as the notes' carrying amount (CBL)", () => {
    // Face: "Mortgage and other indebtedness, net" 2,025.5, of which 1,981.9 matures within a year (10-Q 0001193125-26-453440).
    expect(m(debtAt("CBL", "quarterly", "2026-09-30"))).toBe(2025.5);
  });

  it("keeps LongTermDebt when a tagged credit line makes up the rest exactly (FirstCash)", () => {
    // Face: revolver 169.0 + other long-term debt 2,278.1 = 2,447.1 (10-Q 0000840489-26-000099).
    expect(m(debtAt("FCFS", "quarterly", "2026-09-30"))).toBe(2447.1);
  });

  it("counts construction loans among a trust's face lines (Bluerock Homes)", () => {
    // Face: mortgages 1,099.9 + credit facility 112.6 + term loan 139.2 + construction loans 271.9 = 1,623.6
    // (10-Q 0000907254-26-000051), equal to its LongTermDebt.
    expect(m(debtAt("BFS", "quarterly", "2026-09-30"))).toBe(1623.6);
  });
});

describe("capex from capital improvements only where the investing section proves it (reduced real companyfacts)", () => {
  const FIXTURE = capexImprovementsFacts as unknown as Record<string, CompanyFacts>;
  const capex = (t: string, freq: "annual" | "quarterly", end: string) => {
    const s = buildStatements(FIXTURE[t])[freq].cashflow;
    const i = s.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    const c = s.rows.find((r) => r.key === "capex")?.cells[i];
    const f = s.rows.find((r) => r.key === "fcf")?.cells[i];
    return { capex: c ? Math.round(c.v / 1e5) / 10 : null, fcf: f ? Math.round(f.v / 1e5) / 10 : null };
  };

  it("reads it when it is the whole capital line (Snap-on, Rexford)", () => {
    // Face: "Capital expenditures" (76.0), the only property line of investing (10-K 0000091440-26-000045).
    expect(capex("SNA", "annual", "2026-01-03").capex).toBe(76);
    expect(capex("SNA", "annual", "2026-01-03").fcf).not.toBeNull();
    // Third quarter: nine months (69.0, 10-Q 0000091440-26-000172) less six months (44.3, 10-Q 0000091440-26-000144).
    expect(capex("SNA", "quarterly", "2026-10-03").capex).toBe(24.7);
    // Face: "Capital expenditures" (333,424) thousand (10-K 0001571283-26-000006).
    expect(capex("REXR", "annual", "2025-12-31").capex).toBe(333.4);
  });

  it("leaves it out where it is a fragment or another kind of payment (Weyerhaeuser, Nuvation Bio, STAG)", () => {
    // Face: "Capital expenditures for property and equipment" (423) under wy:, reforestation (51) under this concept
    // (10-K 0001193125-26-051422): 51 would understate capex eightfold.
    expect(capex("WY", "annual", "2025-12-31")).toEqual({ capex: null, fcf: null });
    // Face: "Cash paid for capitalized market approval intangibles" (8,000) beside "Purchases of property and
    // equipment" (354) under PaymentsToAcquireMachineryAndEquipment (10-K 0001193125-26-085584).
    expect(capex("NUVB", "annual", "2025-12-31").capex).toBeNull();
    // Face: this concept is labelled "Acquisitions of land and buildings and improvements" (204,517), beside
    // (398,417) of real estate additions (10-K 0001479094-26-000009).
    expect(capex("STAG", "annual", "2025-12-31").capex).toBeNull();
  });
});

/** Annual cell of one line, in millions to one decimal, from reduced real companyfacts. */
function annualM(fixture: unknown, t: string, st: "income" | "cashflow" | "balance", key: string, end: string) {
  const s = buildStatements((fixture as Record<string, CompanyFacts>)[t]).annual[st];
  const i = s.periods.findIndex((p) => p.end === end);
  expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
  const c = s.rows.find((r) => r.key === key)?.cells[i];
  return c ? Math.round(c.v / 1e5) / 10 : null;
}
const cellAt = (fixture: unknown, t: string, st: "income" | "cashflow" | "balance", key: string, end: string) => {
  const s = buildStatements((fixture as Record<string, CompanyFacts>)[t]).annual[st];
  const i = s.periods.findIndex((p) => p.end === end);
  expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
  return s.rows.find((r) => r.key === key)?.cells[i] ?? null;
};

describe("cash from operations where the statement prints only the continuing-operations subtotal", () => {
  it("reads the continuing-operations line for a year with no total tagged", () => {
    // Face: "Net Cash Provided by Continuing Operating Activities" 3,430 / 3,844 (FY2025 / FY2024), discontinued
    // operations' cash (0 / −46) in its own block, no total line (10-K 0000010795-25-000099).
    expect(annualM(cfoContinuingFacts, "BDX", "cashflow", "cfo", "2025-09-30")).toBe(3430);
    expect(annualM(cfoContinuingFacts, "BDX", "cashflow", "cfo", "2024-09-30")).toBe(3844);
    expect(cellAt(cfoContinuingFacts, "BDX", "cashflow", "cfo", "2025-09-30")?.src?.concept).toBe(
      "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    );
    // Face: "Net cash provided by operating activities of continuing operations" 1,853.1, investing −711.4
    // (10-K 0000940944-26-000025); free cash flow follows.
    expect(annualM(cfoContinuingFacts, "DRI", "cashflow", "cfo", "2026-05-31")).toBe(1853.1);
    expect(annualM(cfoContinuingFacts, "DRI", "cashflow", "fcf", "2026-05-31")).not.toBeNull();
    // Face: "Net Cash Provided by Operating Activities of Continuing Operations" 13,122, investing −16,421,
    // financing 3,097 (10-K 0000310158-22-000003, FY2021).
    expect(annualM(cfoContinuingFacts, "MRK", "cashflow", "cfo", "2021-12-31")).toBe(13122);
    expect(annualM(cfoContinuingFacts, "MRK", "cashflow", "cfi", "2021-12-31")).toBe(-16421);
    expect(annualM(cfoContinuingFacts, "MRK", "cashflow", "cff", "2021-12-31")).toBe(3097);
  });

  it("keeps the tagged total where there is one", () => {
    // Merck FY2022 tags the total 19,095 (equal to continuing operations that year).
    expect(cellAt(cfoContinuingFacts, "MRK", "cashflow", "cfo", "2022-12-31")?.src?.concept).toBe("us-gaap:NetCashProvidedByUsedInOperatingActivities");
  });
});

describe("capex from construction spending and from Dominion's extension", () => {
  it("reads construction spending only for a year the investing section proves it the whole capital line (Con Edison)", () => {
    // Face: "Utility capital expenditures" 4,764 (PaymentsForConstructionInProcess), "Non-utility capital
    // expenditures" 0 / 1 (FY2025 / FY2024, an extension), 10-K 0001047862-26-000031.
    expect(annualM(capexProvenFacts, "ED", "cashflow", "capex", "2025-12-31")).toBe(4764);
    // FY2024: the extension line of 1 sits beside it, the tagged lines do not add up without it: left empty.
    expect(annualM(capexProvenFacts, "ED", "cashflow", "capex", "2024-12-31")).toBeNull();
  });

  it("reads Dominion's consolidated property additions (FY2025 $12,641M, 10-K 0001193125-26-063120)", () => {
    const cf = filer({ Revenues: { facts: REVENUE }, OperatingIncomeLoss: { facts: OPINC } });
    cf.facts.d = {
      PaymentsToAcquirePropertyPlantAndEquipmentIncludingNuclearFuel: {
        units: { USD: [fact("2025-01-01", "2025-12-31", 12641, "10-K", "2026-02-27", "0001193125-26-063120")] },
      },
    };
    const a = buildStatements(cf).annual.cashflow;
    const cell = a.rows.find((r) => r.key === "capex")!.cells[a.periods.findIndex((p) => p.key === "FY2025")]!;
    expect(cell.v).toBe(12641);
    expect(cell.src?.concept).toBe("d:PaymentsToAcquirePropertyPlantAndEquipmentIncludingNuclearFuel");
  });
});

describe("diluted EPS tagged as continuing-operations EPS", () => {
  const eps = (t: string, end: string) => cellAt(epsContinuingFacts, t, "income", "epsDiluted", end)?.v ?? null;
  it("reads it where the statement has no discontinued operations", () => {
    // Face: "Diluted" $1.52 (10-K 0000831259-26-000012, FY2025); Airbnb "Diluted (in USD per share)" $4.03
    // (10-K 0001559720-26-000004, FY2025). Both under IncomeLossFromContinuingOperationsPerDilutedShare.
    expect(eps("FCX", "2025-12-31")).toBe(1.52);
    expect(eps("ABNB", "2025-12-31")).toBe(4.03);
    expect(cellAt(epsContinuingFacts, "ABNB", "income", "epsBasic", "2025-12-31")?.v).toBe(4.1);
  });

  it("leaves it empty beside discontinued operations (Dell FY2022)", () => {
    // Face: continuing $6.26 and discontinued $0.76 diluted, no total line (10-K 0001571996-22-000009).
    expect(eps("DELL", "2022-01-28")).toBeNull();
    // FY2026 keeps its EarningsPerShareDiluted figure.
    expect(cellAt(epsContinuingFacts, "DELL", "income", "epsDiluted", "2026-01-30")?.src?.concept).toBe("us-gaap:EarningsPerShareDiluted");
  });
});

describe("net income and revenue lines tagged with other concepts", () => {
  const FIXTURE = incomeLinesFacts as unknown as Record<string, CompanyFacts>;
  const at = (t: string, key: string, end: string, bank = false) => {
    const s = buildStatements(FIXTURE[t], { bank }).annual.income;
    const i = s.periods.findIndex((p) => p.end === end);
    expect(i, `${t} ${end}`).toBeGreaterThanOrEqual(0);
    return s.rows.find((r) => r.key === key)?.cells[i] ?? null;
  };

  it("reads Booking's net income tagged as available to common stockholders", () => {
    // Face: "Net income" $5,404M FY2025, NetIncomeLossAvailableToCommonStockholdersBasic (10-K 0001075531-26-000009).
    expect(at("BKNG", "netIncome", "2025-12-31")?.v).toBe(5404e6);
  });

  it("does not read it for a year with noncontrolling interests tagged", () => {
    // Booking's own facts with one added noncontrolling-interest amount for FY2025: the common figure is then not
    // net income, so the cell stays empty.
    const cf = structuredClone(FIXTURE.BKNG);
    cf.facts["us-gaap"].NetIncomeLossAttributableToNoncontrollingInterest = {
      units: { USD: [{ start: "2025-01-01", end: "2025-12-31", val: 10e6, accn: "0000000001-26-999999", form: "10-K", filed: "2026-02-20" }] },
    };
    const s = buildStatements(cf).annual.income;
    const i = s.periods.findIndex((p) => p.end === "2025-12-31");
    expect(s.rows.find((r) => r.key === "netIncome")?.cells[i] ?? null).toBeNull();
  });

  it("reads a gas utility's regulated operating revenue (ONE Gas FY2025 $2,427.4M, 10-K 0001587732-26-000009)", () => {
    expect(at("OGS", "revenue", "2025-12-31")?.v).toBe(2427428000);
  });

  it("does not show a bank's contract fee revenue as its revenue (Fifth Third FY2023)", () => {
    // Face: net interest income 5,827, total noninterest income 2,881, no revenue total; the $577M of
    // RevenueFromContractWithCustomerIncludingAssessedTax is a note figure (10-K 0000035527-24-000088).
    expect(at("FITB", "revenue", "2023-12-31", true)).toBeNull();
    expect(at("FITB", "netInterestIncome", "2023-12-31", true)?.v).toBe(5827e6);
  });
});

describe("annual columns after a change of fiscal year end, and EPS against a net loss", () => {
  const FIXTURE = periodsEpsFacts as unknown as Record<string, CompanyFacts>;
  const annual = (t: string) => buildStatements(FIXTURE[t]).annual.income;

  it("keeps one column per year after a reverse merger (Chronoscale)", () => {
    // 10-K 0001628280-26-058018 reports the acquirer's years to 31 May 2026 and 2025 (net loss 50,320 / 72,730);
    // the registrant's own calendar 2024 and 2025 overlap them and leave.
    const s = annual("CHRN");
    const labels = s.periods.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(s.periods.map((p) => p.end)).toEqual(expect.arrayContaining(["2025-05-31", "2026-05-31"]));
    expect(s.periods.map((p) => p.end)).not.toContain("2025-12-31");
    expect(s.periods.map((p) => p.end)).not.toContain("2024-12-31");
  });

  it("keeps the audited year, not a recast comparative, when one filing reports both (Bristow)", () => {
    // 10-K 0001525221-24-000011 prints the year to 31 March 2022 (net loss attributable 15,791), the nine months to
    // 31 December 2022 and calendar 2023; calendar 2022 is a comparative only.
    const ends = annual("VTOL").periods.map((p) => p.end);
    expect(ends).toContain("2022-03-31");
    expect(ends).not.toContain("2022-12-31");
  });

  it("empties a positive EPS in a loss year unless income available to common is positive", () => {
    // Spyre FY2023: 10-K/A 0001636282-24-000107 tags +13.76 against a net loss of 338,790; the 10-K printed −49.12.
    const sy = annual("SYRE");
    const i = sy.periods.findIndex((p) => p.end === "2023-12-31");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(sy.rows.find((r) => r.key === "epsDiluted")?.cells[i] ?? null).toBeNull();
    // Corsair FY2023: net loss 2,590, available to common +3,187, EPS 0.03 (10-K 0000950170-24-021415): kept.
    const cr = annual("CRSR");
    const j = cr.periods.findIndex((p) => p.end === "2023-12-31");
    expect(cr.rows.find((r) => r.key === "epsDiluted")?.cells[j]?.v).toBe(0.03);
  });
});
