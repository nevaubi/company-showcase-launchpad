import type { Unit } from "./types";

export interface LineDef {
  key: string;
  label: string;
  concepts: string[];
  unit: Unit;
  kind: "flow" | "stock";
  /** Can a missing discrete quarter be derived by subtracting year-to-date facts? */
  additive?: boolean;
  indent?: number;
  bold?: boolean;
}

const usd = (
  key: string,
  label: string,
  concepts: string[],
  kind: "flow" | "stock",
  extra: Partial<LineDef> = {},
): LineDef => ({ key, label, concepts, unit: "usd", kind, additive: kind === "flow", ...extra });

export const INCOME_LINES: LineDef[] = [
  usd(
    "revenue",
    "Revenue",
    [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "SalesRevenueNet",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueGoodsNet",
    ],
    "flow",
    { bold: true },
  ),
  usd(
    "costOfRevenue",
    "Cost of revenue",
    [
      "CostOfRevenue",
      "CostOfGoodsAndServicesSold",
      "CostOfGoodsSold",
      "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
    ],
    "flow",
    { indent: 1 },
  ),
  usd("grossProfit", "Gross profit", ["GrossProfit"], "flow", { bold: true }),
  usd(
    "rnd",
    "Research & development",
    ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
    "flow",
    { indent: 1 },
  ),
  usd(
    "sga",
    "Selling, general & administrative",
    ["SellingGeneralAndAdministrativeExpense"],
    "flow",
    { indent: 1 },
  ),
  usd("salesMarketing", "Sales & marketing", ["SellingAndMarketingExpense", "MarketingExpense"], "flow", {
    indent: 1,
  }),
  usd("generalAdmin", "General & administrative", ["GeneralAndAdministrativeExpense"], "flow", {
    indent: 1,
  }),
  usd("opex", "Total operating expenses", ["OperatingExpenses", "CostsAndExpenses"], "flow"),
  usd("operatingIncome", "Operating income", ["OperatingIncomeLoss"], "flow", { bold: true }),
  usd(
    "otherIncome",
    "Other income (expense), net",
    ["NonoperatingIncomeExpense", "OtherNonoperatingIncomeExpense"],
    "flow",
    { indent: 1 },
  ),
  usd(
    "pretaxIncome",
    "Income before taxes",
    [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
    "flow",
  ),
  usd("incomeTax", "Income tax expense", ["IncomeTaxExpenseBenefit"], "flow", { indent: 1 }),
  usd("netIncome", "Net income", ["NetIncomeLoss", "ProfitLoss"], "flow", { bold: true }),
  {
    key: "epsBasic",
    label: "EPS — basic",
    concepts: ["EarningsPerShareBasic"],
    unit: "usdPerShare",
    kind: "flow",
    additive: true,
  },
  {
    key: "epsDiluted",
    label: "EPS — diluted",
    concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
    unit: "usdPerShare",
    kind: "flow",
    additive: true,
    bold: true,
  },
  {
    key: "sharesBasic",
    label: "Weighted avg. shares — basic",
    concepts: ["WeightedAverageNumberOfSharesOutstandingBasic"],
    unit: "shares",
    kind: "flow",
    additive: false,
  },
  {
    key: "sharesDiluted",
    label: "Weighted avg. shares — diluted",
    concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    unit: "shares",
    kind: "flow",
    additive: false,
  },
];

export const BALANCE_LINES: LineDef[] = [
  usd(
    "cash",
    "Cash & equivalents",
    ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "stock",
  ),
  usd(
    "shortTermInvestments",
    "Short-term investments",
    ["MarketableSecuritiesCurrent", "ShortTermInvestments", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
    "stock",
  ),
  usd("receivables", "Accounts receivable", ["AccountsReceivableNetCurrent"], "stock"),
  usd("inventory", "Inventories", ["InventoryNet"], "stock"),
  usd("currentAssets", "Total current assets", ["AssetsCurrent"], "stock", { bold: true }),
  usd(
    "ppe",
    "Property, plant & equipment, net",
    [
      "PropertyPlantAndEquipmentNet",
      "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization",
    ],
    "stock",
  ),
  usd("goodwill", "Goodwill", ["Goodwill"], "stock"),
  usd(
    "intangibles",
    "Intangible assets, net",
    ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"],
    "stock",
  ),
  usd("totalAssets", "Total assets", ["Assets"], "stock", { bold: true }),
  usd("accountsPayable", "Accounts payable", ["AccountsPayableCurrent"], "stock"),
  usd("currentLiabilities", "Total current liabilities", ["LiabilitiesCurrent"], "stock", { bold: true }),
  usd("longTermDebt", "Long-term debt", ["LongTermDebtNoncurrent", "LongTermDebt"], "stock"),
  usd("totalLiabilities", "Total liabilities", ["Liabilities"], "stock", { bold: true }),
  usd(
    "equity",
    "Shareholders' equity",
    ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "stock",
    { bold: true },
  ),
  usd("liabilitiesAndEquity", "Total liabilities & equity", ["LiabilitiesAndStockholdersEquity"], "stock"),
];

export const CASHFLOW_LINES: LineDef[] = [
  usd("cfNetIncome", "Net income", ["NetIncomeLoss", "ProfitLoss"], "flow"),
  usd(
    "dna",
    "Depreciation & amortization",
    [
      "DepreciationDepletionAndAmortization",
      "DepreciationAmortizationAndAccretionNet",
      "DepreciationAndAmortization",
      "Depreciation",
    ],
    "flow",
    { indent: 1 },
  ),
  usd("sbc", "Stock-based compensation", ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], "flow", {
    indent: 1,
  }),
  usd("cfo", "Cash from operations", ["NetCashProvidedByUsedInOperatingActivities"], "flow", { bold: true }),
  usd(
    "capex",
    "Capital expenditures",
    ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "flow",
    { indent: 1 },
  ),
  usd(
    "acquisitions",
    "Acquisitions, net of cash",
    ["PaymentsToAcquireBusinessesNetOfCashAcquired"],
    "flow",
    { indent: 1 },
  ),
  usd("cfi", "Cash from investing", ["NetCashProvidedByUsedInInvestingActivities"], "flow", { bold: true }),
  usd("buybacks", "Share repurchases", ["PaymentsForRepurchaseOfCommonStock"], "flow", { indent: 1 }),
  usd("dividends", "Dividends paid", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], "flow", {
    indent: 1,
  }),
  usd("cff", "Cash from financing", ["NetCashProvidedByUsedInFinancingActivities"], "flow", { bold: true }),
];

export const ALL_LINES = [...INCOME_LINES, ...BALANCE_LINES, ...CASHFLOW_LINES];
