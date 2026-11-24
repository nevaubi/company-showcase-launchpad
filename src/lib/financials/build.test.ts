import { describe, expect, it } from "vitest";
import { buildStatements, quarterEndAfter, type CompanyFacts, type RawFact } from "./build";
import { fmtCell, scaled, unitLabel } from "../format";
import debtFacts from "./fixtures/debt-facts.json";

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
