// Which filed line each standardized row takes, checked on real companies' SEC facts (subsets of companyfacts).
import { describe, expect, it } from "vitest";
import { buildStatements, type CompanyFacts } from "./build";
import type { Statement } from "./types";
import brk from "./fixtures/nci-brk-facts.json";
import cat from "./fixtures/nci-cat-facts.json";
import pld from "./fixtures/dps-opex-pld-facts.json";
import visa from "./fixtures/dps-v-facts.json";
import nvda from "./fixtures/dps-nvda-facts.json";
import amzn from "./fixtures/nonop-amzn-facts.json";
import wmt from "./fixtures/nonop-wmt-facts.json";
import jpm from "./fixtures/q4-concept-jpm-facts.json";
import aaplBs from "./fixtures/bs-aapl-facts.json";
import catBs from "./fixtures/bs-cat-facts.json";
import cvxBs from "./fixtures/bs-cvx-facts.json";
import geBs from "./fixtures/bs-ge-facts.json";

const M = 1e6;
const at = (s: Statement, key: string, label: string) => {
  const i = s.periods.findIndex((p) => p.label === label);
  expect(i, `period ${label}`).toBeGreaterThanOrEqual(0);
  return s.rows.find((r) => r.key === key)?.cells[i] ?? null;
};
const row = (s: Statement, key: string) => s.rows.find((r) => r.key === key);

describe("net income and noncontrolling interests", () => {
  it("starts the cash flow from consolidated net income, as Berkshire's statement prints it (finaud-08)", () => {
    const st = buildStatements(brk as CompanyFacts);
    const cash = st.annual.cashflow;
    // 10-K 0001193125-26-083899: cash flow "Net earnings" $67,260M; attributable to Berkshire shareholders $66,968M.
    expect(at(cash, "cfNetIncome", "FY2025")?.v).toBe(67_260 * M);
    expect(at(cash, "cfNetIncome", "FY2025")?.src?.concept).toBe("us-gaap:ProfitLoss");
    expect(row(cash, "cfNetIncome")?.label).toBe("Net income incl. noncontrolling interests");
    expect(at(st.annual.income, "netIncome", "FY2025")?.v).toBe(66_968 * M);
  });

  it("shows Caterpillar's printed Profit, not profit including noncontrolling interests (finaud-13)", () => {
    const inc = buildStatements(cat as CompanyFacts).quarterly.income;
    // 10-Q 0000018230-26-000057: profit of consolidated and affiliated companies 3,286; noncontrolling (1); Profit 3,287.
    expect(at(inc, "netIncome", "Q3 FY26")?.v).toBe(3_287 * M);
    expect(at(inc, "netIncomeInclNci", "Q3 FY26")?.v).toBe(3_286 * M);
    expect(at(inc, "nciIncome", "Q3 FY26")?.v).toBe(-1 * M);
    expect(row(inc, "netIncome")?.label).toBe("Net income attributable to shareholders");
  });

  it("calculates attributable net income where only consolidated profit is tagged for the period", () => {
    const inc = buildStatements(pld as CompanyFacts).quarterly.income;
    const c = at(inc, "netIncome", "Q4 FY25");
    expect(c?.src).toBeUndefined();
    expect(c?.derived?.formula).toBe("Net income incl. noncontrolling interests − Noncontrolling interests");
    const incl = at(inc, "netIncomeInclNci", "Q4 FY25")!;
    const nci = at(inc, "nciIncome", "Q4 FY25")!;
    expect(c?.v).toBeCloseTo(incl.v - nci.v, 0);
  });
});

describe("derived fourth quarters and dividends per share", () => {
  it("never subtracts quarters of one concept from a year of another (finaud-02, Prologis −3.00)", () => {
    const st = buildStatements(pld as CompanyFacts);
    // 10-K 0001193125-26-051453: $1.01 a quarter and $4.04 for 2025 (CommonStockDividendsPerShareCashPaid); the
    // $0.03 tagged under CommonStockDividendsPerShareDeclared for the year is not the common dividend.
    expect(at(st.annual.income, "dividendsPerShare", "FY2025")?.v).toBe(4.04);
    const q4 = at(st.quarterly.income, "dividendsPerShare", "Q4 FY25");
    expect(q4?.v).toBe(1.01);
    expect(new Set(q4?.derived?.parts.map((p) => p.concept))).toEqual(new Set(["us-gaap:CommonStockDividendsPerShareCashPaid"]));
  });

  it("keeps one concept on both sides of JPMorgan's derived fourth-quarter revenue", () => {
    const q4 = at(buildStatements(jpm as CompanyFacts, { bank: true }).quarterly.income, "revenue", "Q4 FY25");
    expect(q4?.derived).toBeDefined();
    expect(new Set(q4!.derived!.parts.map((p) => p.concept)).size).toBe(1);
  });

  it("does not take Visa's quarterly rate for the year's dividend, nor derive a zero fourth quarter (finaud-14)", () => {
    const st = buildStatements(visa as CompanyFacts);
    // 10-K 0001403161-26-000134: "Dividends declared, quarterly, per share" $0.67 on the FY2026 duration.
    expect(at(st.annual.income, "dividendsPerShare", "FY2026")).toBeNull();
    expect(at(st.quarterly.income, "dividendsPerShare", "Q4 FY26")).toBeNull();
    expect(at(st.quarterly.income, "dividendsPerShare", "Q1 FY26")?.v).toBe(0.67);
  });

  it("keeps NVIDIA's split-adjusted dividends: quarters of an older basis are no reason to reject a year", () => {
    const st = buildStatements(nvda as CompanyFacts);
    const fy = st.annual.income.periods.find((p) => p.end.startsWith("2025-01"))!;
    const c = at(st.annual.income, "dividendsPerShare", fy.label);
    expect(c?.src?.concept).toBe("us-gaap:CommonStockDividendsPerShareDeclared");
    expect(c?.v).toBeLessThan(0.05);
  });
});

describe("operating expenses and the non-operating section", () => {
  it("drops an operating expense total that is negative or does not tie revenue to operating income (finaud-03)", () => {
    const st = buildStatements(pld as CompanyFacts);
    expect(at(st.annual.income, "opex", "FY2025")).toBeNull(); // OperatingExpenses −2,280.7M, a reconciling item
    expect(at(st.quarterly.income, "opex", "Q3 FY25")).toBeNull(); // a note subtotal
    expect(at(st.quarterly.income, "opex", "Q4 FY25")).toBeNull();
  });

  it("shows Amazon's other line beside interest, under the non-operating total that holds them (finaud-11)", () => {
    const inc = buildStatements(amzn as CompanyFacts).quarterly.income;
    // 10-Q 0001018724-26-000040: interest income 1,187; interest expense (1,691); other (703); total (1,207).
    expect(at(inc, "interestIncome", "Q3 FY26")?.v).toBe(1_187 * M);
    expect(at(inc, "otherIncome", "Q3 FY26")?.v).toBe(-703 * M);
    expect(at(inc, "nonOperatingTotal", "Q3 FY26")?.v).toBe(-1_207 * M);
    expect(row(inc, "nonOperatingTotal")?.label).toBe("Total non-operating income (expense)");
  });

  it("keeps Walmart's other gains and losses as a line, since it does not bridge operating income to pretax income", () => {
    const inc = buildStatements(wmt as CompanyFacts).quarterly.income;
    const label = inc.periods.at(-1)!.label;
    expect(at(inc, "otherIncome", label)?.src?.concept).toBe("us-gaap:NonoperatingIncomeExpense");
    expect(at(inc, "nonOperatingTotal", label)).toBeNull();
  });
});

describe("balance sheet lines from the statement itself (finaud-05)", () => {
  it("leaves out Apple's intangibles where the quarters beside them are empty, and keeps a line of every balance sheet", () => {
    const st = buildStatements(aaplBs as CompanyFacts);
    // 10-K FY2026 (0000320193-26-000026): no intangible line on the balance sheet; accounts payable is printed.
    // Tagged at 27 Sep 2025 and 28 Mar 2026 with the quarters beside them empty. (The 10-Qs of the next two quarters
    // tag it as well, so those columns stay: the rule cannot tell their notes from a balance sheet line.)
    expect(at(st.annual.balance, "intangibles", "FY2025")).toBeNull();
    expect(at(st.quarterly.balance, "intangibles", "Q2 FY26")).toBeNull();
    expect(at(st.annual.balance, "accountsPayable", "FY2026")?.src?.concept).toBe("us-gaap:AccountsPayableCurrent");
  });

  it("leaves out Caterpillar's year-end debt note totals, its balance sheet prints debt by business only", () => {
    const st = buildStatements(catBs as CompanyFacts);
    expect(at(st.annual.balance, "shortTermDebt", "FY2025")).toBeNull();
    expect(at(st.annual.balance, "longTermDebt", "FY2025")).toBeNull();
    expect(at(st.annual.balance, "totalDebt", "FY2025")).toBeNull();
    expect(at(st.quarterly.balance, "netDebt", "Q4 FY25")).toBeNull();
  });

  it("names a cash row made of the cash, equivalents and restricted cash total for what it is (GE)", () => {
    const b = buildStatements(geBs as CompanyFacts).quarterly.balance;
    expect(row(b, "cash")?.label).toBe("Cash, cash equivalents & restricted cash");
    expect(row(b, "cashOnly")).toBeUndefined();
  });

  it("never mixes cash and equivalents with the restricted-cash total in one row (Chevron)", () => {
    const b = buildStatements(cvxBs as CompanyFacts).quarterly.balance;
    const cash = row(b, "cash")!;
    expect(cash.label).toBe("Cash, cash equivalents & restricted cash");
    expect(new Set(cash.cells.filter(Boolean).map((c) => c!.src?.concept))).toEqual(new Set(["us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]));
    expect(at(b, "cashOnly", "Q1 FY24")?.src?.concept).toBe("us-gaap:CashAndCashEquivalentsAtCarryingValue");
  });
});

describe("parts of a printed line (finaud-10)", () => {
  it("leaves out Apple's note breakdown of SG&A where the statement prints SG&A", () => {
    const facts = structuredClone(aaplBs) as CompanyFacts;
    // 10-K 0000320193-26-000026: SG&A 29,774; its parts in a note, sales and marketing 21,134 and G&A 8,640.
    const fy = (val: number) => [{ start: "2025-09-28", end: "2026-09-26", val, accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03" }];
    facts.facts["us-gaap"].SellingGeneralAndAdministrativeExpense = { units: { USD: fy(29_774 * M) } };
    facts.facts["us-gaap"].SellingAndMarketingExpense = { units: { USD: fy(21_134 * M) } };
    facts.facts["us-gaap"].GeneralAndAdministrativeExpense = { units: { USD: fy(8_640 * M) } };
    const inc = buildStatements(facts).annual.income;
    expect(at(inc, "sga", "FY2026")?.v).toBe(29_774 * M);
    expect(row(inc, "salesMarketing")).toBeUndefined();
    expect(row(inc, "generalAdmin")).toBeUndefined();
    delete facts.facts["us-gaap"].SellingGeneralAndAdministrativeExpense;
    expect(at(buildStatements(facts).annual.income, "salesMarketing", "FY2026")?.v).toBe(21_134 * M);
  });
});
