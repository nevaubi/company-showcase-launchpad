// Sector layouts of the income statement, on real companies' SEC facts (subsets of companyfacts).
import { describe, expect, it } from "vitest";
import { buildStatements, type CompanyFacts } from "./build";
import { statementOptions } from "./dataset";
import { statementSector } from "./statement-layout";
import type { Statement } from "./types";
import jpm from "./fixtures/sector-jpm-facts.json";
import pgr from "./fixtures/sector-pgr-facts.json";
import unh from "./fixtures/sector-unh-facts.json";
import nee from "./fixtures/sector-nee-facts.json";
import cvx from "./fixtures/sector-cvx-facts.json";

const M = 1e6;
const keys = (s: Statement) => s.rows.map((r) => r.key);
const at = (s: Statement, key: string, label: string) => {
  const i = s.periods.findIndex((p) => p.label === label);
  expect(i, `period ${label}`).toBeGreaterThanOrEqual(0);
  return s.rows.find((r) => r.key === key)?.cells[i] ?? null;
};
const income = (cf: unknown, c: { sector: string; industry: string }) => buildStatements(cf as CompanyFacts, statementOptions(c)).quarterly.income;

describe("statement sector from the coverage taxonomy", () => {
  it("reads sector and industry, never a ticker", () => {
    expect(statementSector({ sector: "Financials", industry: "Diversified Banks" })).toBe("bank");
    expect(statementSector({ sector: "Financials", industry: "Investment Banking & Brokerage" })).toBe("bank");
    expect(statementSector({ sector: "Financials", industry: "Insurance" })).toBe("insurer");
    expect(statementSector({ sector: "Health Care", industry: "Managed Health Care" })).toBe("managedCare");
    expect(statementSector({ sector: "Real Estate", industry: "Industrial REITs" })).toBe("reit");
    expect(statementSector({ sector: "Real Estate", industry: "Real Estate Management & Services" })).toBe("general");
    expect(statementSector({ sector: "Utilities", industry: "Electric Utilities" })).toBe("utility");
    expect(statementSector({ sector: "Energy", industry: "Integrated Oil & Gas" })).toBe("energy");
    expect(statementSector({ sector: "Financials", industry: "Transaction & Payment Processing Services" })).toBe("general");
  });
});

describe("sector income statements (finaud-04, 06, 09, 12, 15, 16)", () => {
  it("lays out JPMorgan's income statement as a bank prints it", () => {
    const s = income(jpm, { sector: "Financials", industry: "Diversified Banks" });
    // 10-Q 0001628280-26-069523: interest income 53,056, interest expense 26,020, net interest income 27,036,
    // noninterest revenue 23,136, total net revenue 50,172, provision 2,743, noninterest expense 27,295.
    const order = ["bankInterestIncome", "bankInterestExpense", "netInterestIncome", "nonInterestIncome", "revenue", "provisionCreditLosses", "nonInterestExpense", "pretaxIncome", "incomeTax", "netIncome"];
    expect(keys(s).filter((k) => order.includes(k))).toEqual(order);
    expect(keys(s)).not.toContain("interestExpense");
    expect(keys(s)).not.toContain("grossProfit");
    expect(keys(s)).not.toContain("ebitda");
    expect(at(s, "bankInterestIncome", "Q3 FY26")?.v).toBe(53_056 * M);
    expect(at(s, "bankInterestExpense", "Q3 FY26")?.v).toBe(26_020 * M);
    expect(s.rows.find((r) => r.key === "revenue")?.label).toBe("Total net revenue");
  });

  it("shows Progressive's premiums, investment results, losses and underwriting costs, no EBITDA", () => {
    const s = income(pgr, { sector: "Financials", industry: "Insurance" });
    // 10-Q 0000080661-26-000379: net premiums earned 21,869.0; losses and LAE 14,904.0; policy acquisition 1,607.0;
    // other underwriting 3,196.0; total expenses 19,956.0.
    expect(at(s, "premiumsEarned", "Q3 FY26")?.v).toBe(21_869 * M);
    expect(at(s, "lossesBenefits", "Q3 FY26")?.v).toBe(14_904 * M);
    expect(at(s, "policyAcquisition", "Q3 FY26")?.v).toBe(1_607 * M);
    expect(at(s, "otherUnderwriting", "Q3 FY26")?.v).toBe(3_196 * M);
    expect(at(s, "insuranceExpenses", "Q3 FY26")?.v).toBe(19_956 * M);
    const k = keys(s);
    expect(k.indexOf("premiumsEarned")).toBeLessThan(k.indexOf("revenue"));
    expect(k.indexOf("revenue")).toBeLessThan(k.indexOf("lossesBenefits"));
    expect(k).not.toContain("ebitda");
    expect(k).not.toContain("grossProfit");
  });

  it("shows UnitedHealth's premiums and medical costs, a calculated medical cost ratio, and no calculated gross profit", () => {
    const s = income(unh, { sector: "Health Care", industry: "Managed Health Care" });
    // 10-Q 0000731766-26-000266: premiums 87,078; medical costs 76,982; cost of products sold 13,707.
    expect(at(s, "premiums", "Q3 FY26")?.v).toBe(87_078 * M);
    expect(at(s, "medicalCosts", "Q3 FY26")?.v).toBe(76_982 * M);
    const ratio = at(s, "medicalCostRatio", "Q3 FY26");
    expect(ratio?.v).toBeCloseTo(76_982 / 87_078, 6);
    expect(ratio?.derived?.formula).toBe("Medical costs ÷ Premiums");
    expect(s.rows.find((r) => r.key === "medicalCostRatio")?.calc).toBe("Medical costs ÷ Premiums");
    expect(keys(s)).not.toContain("grossProfit");
    expect(s.rows.find((r) => r.key === "costOfRevenue")?.label).toBe("Cost of products sold");
  });

  it("shows NextEra's operating lines and the gains that close revenue less expenses to operating income", () => {
    const s = buildStatements(nee as CompanyFacts, statementOptions({ sector: "Utilities", industry: "Electric Utilities" })).annual.income;
    const k = keys(s);
    expect(k.slice(0, 1)).toEqual(["revenue"]);
    expect(k.indexOf("operationsMaintenance")).toBeLessThan(k.indexOf("opex"));
    expect(k.indexOf("opex")).toBeLessThan(k.indexOf("operatingIncome"));
    const rev = at(s, "revenue", "FY2025")!.v;
    const opex = at(s, "opex", "FY2025")!.v;
    const gains = at(s, "operatingGains", "FY2025")?.v ?? 0;
    expect(Math.abs(rev - opex + gains - at(s, "operatingIncome", "FY2025")!.v)).toBeLessThan(rev * 0.02);
  });

  it("does not calculate Chevron's gross profit from purchased crude oil alone", () => {
    const s = income(cvx, { sector: "Energy", industry: "Integrated Oil & Gas" });
    expect(keys(s)).not.toContain("grossProfit");
    const general = buildStatements(cvx as CompanyFacts).quarterly.income;
    expect(keys(general)).toContain("grossProfit");
  });
});
