// Sector layouts of the standardized income statement: which lines a bank, an insurer, a managed care company, a
// real estate trust or a utility prints, in which order, under which names. The sector comes from the coverage
// taxonomy (sector and industry, src/lib/coverage.ts), never from a list of tickers. Pure.
import type { Row } from "./types";

export type StatementSector = "bank" | "insurer" | "managedCare" | "reit" | "utility" | "energy" | "general";

const BANK_INDUSTRY = /bank|brokerage|consumer finance/i;

/** The statement layout a company gets from its coverage sector and industry. */
export function statementSector(c: { sector?: string; industry?: string } | undefined): StatementSector {
  const sector = c?.sector ?? "";
  const industry = c?.industry ?? "";
  if (BANK_INDUSTRY.test(industry)) return "bank";
  if (/insurance/i.test(industry)) return "insurer";
  if (/managed health care/i.test(industry)) return "managedCare";
  if (/^real estate$/i.test(sector) && /\bREITs?\b/i.test(industry)) return "reit";
  if (/^utilities$/i.test(sector) || /utilit/i.test(industry)) return "utility";
  if (/^energy$/i.test(sector)) return "energy";
  return "general";
}

/**
 * Gross profit is calculated (revenue less cost of revenue) only where cost of revenue is the cost of what was sold.
 * Not for banks, insurers or managed care (their costs are interest, claims and medical costs: UnitedHealth's "Cost
 * of products sold" $13,707M is a fraction of its $106,131M of operating costs, Q3 2026), real estate trusts and
 * utilities (no such line), or oil companies, whose "purchased crude oil and products" is one cost among production,
 * exploration and depreciation (Chevron). A gross profit the filer tags itself is still shown.
 */
export const calculatesGrossProfit = (s: StatementSector) => s === "general";

/** EBITDA is no measure of a bank or an insurer: interest and investment results are their business. */
export const showsEbitda = (s: StatementSector) => s !== "bank" && s !== "insurer";

interface Layout {
  /** Row keys in printed order; "*" stands for every other row, in schema order. */
  order: string[];
  /** Rows a statement of this sector never shows. */
  drop: string[];
  labels?: Record<string, string>;
  indent?: Record<string, number>;
  bold?: Record<string, boolean>;
}

const NON_OPERATING = ["interestIncome", "interestExpense", "otherIncome", "nonOperatingTotal"];
const BOTTOM = ["pretaxIncome", "incomeTax", "netIncomeInclNci", "nciIncome", "netIncome", "epsBasic", "epsDiluted", "dividendsPerShare", "sharesBasic", "sharesDiluted"];

const LAYOUTS: Partial<Record<StatementSector, Layout>> = {
  // JPMorgan Q3 2026 (10-Q 0001628280-26-069523), Bank of America (10-Q 0000070858-26-000548): interest income,
  // interest expense, net interest income, noninterest revenue, total net revenue, provision for credit losses,
  // noninterest expense, income before income tax expense, tax, net income.
  bank: {
    order: ["bankInterestIncome", "bankInterestExpense", "netInterestIncome", "nonInterestIncome", "revenue", "provisionCreditLosses", "nonInterestExpense", "*", ...BOTTOM],
    drop: ["costOfRevenue", "grossProfit", "interestIncome", "interestExpense", "opex", "operatingGains", "otherIncome", "nonOperatingTotal"],
    labels: { revenue: "Total net revenue" },
    indent: { netInterestIncome: 0, nonInterestIncome: 0, provisionCreditLosses: 0, nonInterestExpense: 0 },
    bold: { netInterestIncome: true },
  },
  // Progressive Q3 2026 (10-Q 0000080661-26-000379): net premiums earned, investment income, net realized gains on
  // securities, total revenues, losses and loss adjustment expenses, policy acquisition costs, other underwriting
  // expenses, total expenses, income before income taxes.
  insurer: {
    order: ["premiumsEarned", "investmentIncome", "investmentGains", "revenue", "lossesBenefits", "policyAcquisition", "otherUnderwriting", "*", "insuranceExpenses", ...BOTTOM],
    drop: ["costOfRevenue", "grossProfit", "opex", "operatingGains", "operatingIncome", "interestIncome", "otherIncome", "nonOperatingTotal"],
    labels: { revenue: "Total revenues" },
  },
  // UnitedHealth Q3 2026 (10-Q 0000731766-26-000266): premiums, investment and other income, total revenues, medical
  // costs, operating costs, cost of products sold, depreciation and amortization, total operating costs, earnings
  // from operations.
  managedCare: {
    order: ["premiums", "revenue", "medicalCosts", "medicalCostRatio", "sga", "costOfRevenue", "*", "opex", "operatingGains", "operatingIncome", ...NON_OPERATING, ...BOTTOM],
    drop: ["grossProfit"],
    labels: { revenue: "Total revenues", sga: "Operating costs", costOfRevenue: "Cost of products sold", opex: "Total operating costs" },
  },
  // Prologis Q3 2026 (10-Q 0001193125-26-436160): rental revenues, total revenues, rental expenses, general and
  // administrative, depreciation and amortization, total expenses, gains on real estate, operating income.
  reit: {
    order: ["rentalRevenue", "revenue", "propertyExpenses", "generalAdmin", "sga", "reitDna", "*", "opex", "operatingGains", "operatingIncome", ...NON_OPERATING, ...BOTTOM],
    drop: ["costOfRevenue", "grossProfit"],
    labels: { opex: "Total expenses" },
  },
  // NextEra Q3 2026 (10-Q 0000753308-26-000081): operating revenues, fuel, purchased power and interchange, other
  // operations and maintenance, depreciation and amortization, taxes other than income taxes, total operating
  // expenses, gains on disposal, operating income.
  utility: {
    order: ["revenue", "fuelPower", "operationsMaintenance", "utilityDna", "taxesOther", "*", "opex", "operatingGains", "operatingIncome", ...NON_OPERATING, ...BOTTOM],
    drop: ["costOfRevenue", "grossProfit"],
    labels: { revenue: "Operating revenues" },
  },
};

/** Rows of the income statement in the sector's printed order, names and hierarchy; rows it never shows dropped. */
export function layoutIncome(rows: Row[], sector: StatementSector): Row[] {
  const l = LAYOUTS[sector];
  if (!l) return rows;
  const kept = rows.filter((r) => !l.drop.includes(r.key));
  for (const r of kept) {
    if (l.labels?.[r.key]) r.label = l.labels[r.key];
    if (l.indent && r.key in l.indent) r.indent = l.indent[r.key] || undefined;
    if (l.bold && r.key in l.bold) r.bold = l.bold[r.key] || undefined;
  }
  const named = new Set(l.order.filter((k) => k !== "*"));
  const out: Row[] = [];
  for (const k of l.order) {
    if (k === "*") out.push(...kept.filter((r) => !named.has(r.key)));
    else {
      const r = kept.find((x) => x.key === k);
      if (r) out.push(r);
    }
  }
  return out;
}
