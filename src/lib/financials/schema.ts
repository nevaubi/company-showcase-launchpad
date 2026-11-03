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
  /** Only meaningful for banks/brokerages; dropped for other industries. */
  bank?: boolean;
  /** When none of `concepts` is reported, sum these component concepts for the same period. */
  components?: string[];
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
      "RevenuesNetOfInterestExpense",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "SalesRevenueNet",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueGoodsNet",
    ],
    "flow",
    { bold: true },
  ),
  usd("netInterestIncome", "Net interest income", ["InterestIncomeExpenseNet", "InterestIncomeExpenseAfterProvisionForLoanLoss"], "flow", { indent: 1, bank: true }),
  usd("nonInterestIncome", "Noninterest revenue", ["NoninterestIncome"], "flow", { indent: 1, bank: true }),
  usd(
    "provisionCreditLosses",
    "Provision for credit losses",
    ["ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses", "ProvisionForCreditLosses"],
    "flow",
    { indent: 1, bank: true },
  ),
  usd("nonInterestExpense", "Noninterest expense", ["NoninterestExpense"], "flow", { indent: 1, bank: true }),
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
    "interestExpense",
    "Interest expense",
    ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"],
    "flow",
    { indent: 1 },
  ),
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
    key: "dividendsPerShare",
    label: "Dividends declared per share",
    concepts: ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
    unit: "usdPerShare",
    kind: "flow",
    additive: true,
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
  usd(
    "loans",
    "Loans, net of allowance",
    ["LoansAndLeasesReceivableNetReportedAmount", "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss"],
    "stock",
    { bank: true },
  ),
  usd("totalAssets", "Total assets", ["Assets"], "stock", { bold: true }),
  usd("accountsPayable", "Accounts payable", ["AccountsPayableCurrent"], "stock"),
  usd(
    "deferredRevenue",
    "Deferred revenue",
    ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"],
    "stock",
  ),
  usd("deposits", "Deposits", ["Deposits"], "stock", { bank: true }),
  usd(
    "shortTermDebt",
    "Short-term debt & current maturities",
    ["DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "ShortTermBorrowingsAndCurrentPortionOfLongTermDebt"],
    "stock",
    { components: ["LongTermDebtCurrent", "CommercialPaper", "ShortTermBorrowings", "OtherShortTermBorrowings"] },
  ),
  usd("currentLiabilities", "Total current liabilities", ["LiabilitiesCurrent"], "stock", { bold: true }),
  usd(
    "longTermDebt",
    "Long-term debt",
    ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt", "LongTermDebtAndFinanceLeaseObligations"],
    "stock",
  ),
  usd("operatingLeases", "Operating lease liabilities", ["OperatingLeaseLiabilityNoncurrent"], "stock"),
  usd("totalLiabilities", "Total liabilities", ["Liabilities"], "stock", { bold: true }),
  usd(
    "equity",
    "Shareholders' equity",
    ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "stock",
    { bold: true },
  ),
  usd("retainedEarnings", "Retained earnings (deficit)", ["RetainedEarningsAccumulatedDeficit"], "stock", { indent: 1 }),
  usd("liabilitiesAndEquity", "Total liabilities & equity", ["LiabilitiesAndStockholdersEquity"], "stock"),
  {
    key: "sharesOutstanding",
    label: "Shares outstanding (period end)",
    concepts: ["CommonStockSharesOutstanding"],
    unit: "shares",
    kind: "stock",
  },
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
  usd(
    "debtIssued",
    "Debt issued",
    ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromIssuanceOfDebt", "ProceedsFromIssuanceOfSeniorLongTermDebt", "ProceedsFromDebtNetOfIssuanceCosts"],
    "flow",
    { indent: 1 },
  ),
  usd(
    "debtRepaid",
    "Debt repaid",
    ["RepaymentsOfLongTermDebt", "RepaymentsOfDebt", "RepaymentsOfSeniorDebt", "RepaymentsOfLongTermDebtAndCapitalSecurities"],
    "flow",
    { indent: 1 },
  ),
  usd("buybacks", "Share repurchases", ["PaymentsForRepurchaseOfCommonStock"], "flow", { indent: 1 }),
  usd("dividends", "Dividends paid", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], "flow", {
    indent: 1,
  }),
  usd("cff", "Cash from financing", ["NetCashProvidedByUsedInFinancingActivities"], "flow", { bold: true }),
];

export const ALL_LINES = [...INCOME_LINES, ...BALANCE_LINES, ...CASHFLOW_LINES];
