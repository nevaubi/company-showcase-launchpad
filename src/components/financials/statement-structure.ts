// Pure: how the standardized statements are set (section heads, subtotals, the closing totals, calculated
// rows), from the rows' own data: the builder's row keys in the order it lays them out (schema.ts and
// statement-layout.ts), the `bold`, `indent` and `calc` flags it sets, and, once the builder sets them
// (finding finstyle-01), `total` and `section` on the row, which then win. Never from label text.
import type { Row, StatementKey } from "@/lib/financials/types";

export type StructureKind = "line" | "sub" | "grand" | "emph";

/** What the builder may say about a row itself; read first when present. */
type Flagged = Row & { total?: "sub" | "grand"; section?: string };

/** Lines that close a statement as printed (a double rule under the figures). */
const GRAND: Record<StatementKey, string[]> = {
  income: ["netIncome"],
  balance: ["totalAssets", "liabilitiesAndEquity"],
  cashflow: [],
  kpis: [],
};

/**
 * Printed totals the builder does not mark bold: a sector's total revenue over its printed parts, the
 * non-operating and pretax totals, consolidated net income before noncontrolling interests, total
 * liabilities, and each activity's net cash.
 */
const SUB: Record<StatementKey, string[]> = {
  income: ["insuranceExpenses", "nonOperatingTotal", "pretaxIncome", "netIncomeInclNci", "netInterestIncome", "opex", "grossProfit", "operatingIncome"],
  balance: ["currentAssets", "currentLiabilities", "totalLiabilities", "equity"],
  cashflow: ["cfo", "cfi", "cff"],
  kpis: [],
};

/** Revenue is a total where the sector prints its parts above it (interest and noninterest revenue, premiums, rents). */
const REVENUE_PARTS = ["bankInterestIncome", "netInterestIncome", "nonInterestIncome", "premiumsEarned", "investmentIncome", "investmentGains", "premiums", "rentalRevenue"];

/** Section heads drawn before the first row of each block that the statement holds, in the builder's order. */
const HEADS: Record<StatementKey, { text: string; keys: string[]; needs?: string }[]> = {
  income: [
    // A sector's own operating lines head the block where it prints them (medical costs, property expenses, fuel).
    { text: "Operating expenses", keys: ["medicalCosts", "propertyExpenses", "fuelPower", "rnd", "sga", "salesMarketing", "generalAdmin"], needs: "opex|operatingIncome" },
    { text: "Non-operating income (expense)", keys: ["interestIncome", "interestExpense", "otherIncome"], needs: "nonOperatingTotal" },
    { text: "Earnings per share", keys: ["epsBasic", "epsDiluted", "dividendsPerShare"] },
    { text: "Weighted average shares", keys: ["sharesBasic", "sharesDiluted"] },
  ],
  balance: [
    { text: "Current assets", keys: ["cash", "shortTermInvestments", "receivables", "inventory"], needs: "currentAssets" },
    { text: "Assets", keys: ["cash", "shortTermInvestments", "receivables", "inventory", "loans", "ppe", "realEstate", "goodwill", "intangibles"] },
    { text: "Current liabilities", keys: ["accountsPayable", "deferredRevenue", "shortTermDebt"], needs: "currentLiabilities" },
    { text: "Liabilities", keys: ["accountsPayable", "deferredRevenue", "deposits", "shortTermDebt", "longTermDebt", "operatingLeases", "totalLiabilities"] },
    { text: "Equity", keys: ["equity"] },
  ],
  cashflow: [
    { text: "Operating activities", keys: ["cfNetIncome", "dna", "sbc", "cfo"] },
    { text: "Investing activities", keys: ["capex", "acquisitions", "cfi"] },
    { text: "Financing activities", keys: ["debtIssued", "debtRepaid", "buybacks", "dividends", "cff"] },
  ],
  kpis: [],
};

export interface Structured {
  /** a section head drawn before the row */
  head?: string;
  kind: StructureKind;
  /** a wholly calculated row (`calc`): its formula, for the row's title and screen readers */
  calc?: string;
}

/** How each row of a standardized statement is set, and the heads drawn before rows. */
export function statementStructure(statement: StatementKey, rows: Row[]): Structured[] {
  const keys = new Set(rows.map((r) => r.key));
  // Each head once, before the first row of its block present here; "Assets" only where "Current assets" is not drawn.
  const headAt = new Map<number, string>();
  const drawn = new Set<string>();
  for (const h of HEADS[statement]) {
    if (h.needs && !h.needs.split("|").some((k) => keys.has(k))) continue;
    if (h.text === "Assets" && drawn.has("Current assets")) continue;
    if (h.text === "Liabilities" && drawn.has("Current liabilities")) continue;
    const i = rows.findIndex((r) => h.keys.includes(r.key));
    if (i < 0 || headAt.has(i)) continue;
    headAt.set(i, h.text);
    drawn.add(h.text);
  }
  rows.forEach((r, i) => {
    const own = (r as Flagged).section;
    if (own) headAt.set(i, own);
  });
  const revenueIsTotal = rows.findIndex((r) => r.key === "revenue") > rows.findIndex((r) => REVENUE_PARTS.includes(r.key)) && rows.some((r) => REVENUE_PARTS.includes(r.key));
  return rows.map((r, i) => {
    const flag = (r as Flagged).total;
    let kind: StructureKind;
    if (flag) kind = flag;
    else if (GRAND[statement].includes(r.key)) kind = "grand";
    else if (r.calc || r.kind === "kpi") kind = r.bold ? "emph" : "line";
    else if (SUB[statement].includes(r.key) || (r.key === "revenue" && revenueIsTotal)) kind = "sub";
    else if (r.bold) kind = r.unit === "usdPerShare" || r.unit === "pct" || r.unit === "ratio" ? "emph" : "sub";
    else kind = "line";
    return { ...(headAt.has(i) ? { head: headAt.get(i) } : {}), kind, ...(r.calc ? { calc: r.calc } : {}) };
  });
}

/**
 * A class-of-stock concept the builder merged under a class prefix ("classB:EarningsPerShareBasic") names the
 * filing's own fact (us-gaap:EarningsPerShareBasic on the class-of-stock axis); for the cell's source and its
 * title. Other concepts come back unchanged.
 */
export function classConcept(concept: string): { concept: string; label: string } {
  const m = concept.match(/^class([ABC]):(.+)$/);
  if (!m) return { concept, label: concept };
  return { concept: `us-gaap:${m[2]}`, label: `us-gaap:${m[2]}, Class ${m[1]} shares` };
}

/** Which statement a list of rows is, from the builder's keys (the table is handed rows, not the statement's name). */
export function statementKeyOf(rows: Pick<Row, "key">[]): StatementKey {
  const k = new Set(rows.map((r) => r.key));
  if (k.has("totalAssets") || k.has("liabilitiesAndEquity") || k.has("currentAssets") || k.has("equity")) return "balance";
  if (k.has("cfo") || k.has("cfi") || k.has("cff") || k.has("cfNetIncome")) return "cashflow";
  return "income";
}
