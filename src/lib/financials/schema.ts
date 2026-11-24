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
      // Utilities' face total ("Total operating revenues"); without it Duke's FY2025 revenue was the
      // $31,741M contract-revenue note figure instead of the $32,237M on its income statement.
      "RegulatedAndUnregulatedOperatingRevenue",
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
    ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense", "InterestExpenseOperating"],
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
    label: "EPS, basic",
    concepts: ["EarningsPerShareBasic"],
    unit: "usdPerShare",
    kind: "flow",
    additive: true,
  },
  {
    key: "epsDiluted",
    label: "EPS, diluted",
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
    label: "Weighted avg. shares, basic",
    concepts: ["WeightedAverageNumberOfSharesOutstandingBasic"],
    unit: "shares",
    kind: "flow",
    additive: false,
  },
  {
    key: "sharesDiluted",
    label: "Weighted avg. shares, diluted",
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
    [
      "MarketableSecuritiesCurrent",
      "ShortTermInvestments",
      "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
      // NVIDIA tags its "Marketable securities" ($34,143M at 26 Jul 2026) with this concept from its FY2026 10-K on.
      "DebtSecuritiesCurrent",
      // Read only when none of the above is tagged (the first concept found is the line, nothing is summed):
      // DocuSign's "Investments—current" $264.1M (10-K 0001261333-26-000021), Old Republic's "Short-term
      // investments" $1,613.6M (10-K 0000074260-26-000008).
      "DebtSecuritiesAvailableForSaleExcludingAccruedInterestCurrent",
      "OtherShortTermInvestments",
    ],
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
    {
      components: [
        "LongTermDebtCurrent",
        "CommercialPaper",
        "ShortTermBorrowings",
        "OtherShortTermBorrowings",
        "NotesPayableCurrent",
      ],
    },
  ),
  usd("currentLiabilities", "Total current liabilities", ["LiabilitiesCurrent"], "stock", { bold: true }),
  usd(
    "longTermDebt",
    "Long-term debt",
    [
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligations",
      // The noncurrent notes line ("less current portion"): Omnicom's $9,389.5M at 30 Sep 2026, Autodesk's
      // $1,985M at 31 Jul 2026. Ahead of LongTermDebt, which these filers tag with the principal of all
      // notes, current ones included.
      "LongTermNotesPayable",
      "LongTermDebt",
      "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
      "LongTermDebtAndFinanceLeaseObligations",
      // Oracle's balance sheet line ("Notes payable and other borrowings, non-current").
      "LongTermNotesAndLoans",
      // Company extension (read from the filings' inline XBRL at ingest): Deere's "Long-term borrowings".
      "de:LongTermDebtAndFinanceLeasesNoncurrent",
    ],
    "stock",
    {
      // Without one of the lines above, the balance sheet's long-term debt is often convertible notes and a
      // drawn credit line, each its own line: Datadog's $986.6M, Akamai's $6,419.3M, Moderna's $2,958M of
      // convertible notes beside $591M under its credit facility (30 Sep 2026). Before, these companies had
      // no long-term debt and no total debt at all.
      // ConvertibleDebtNoncurrent alone is checked against the balance sheet's liabilities before it stands
      // (debtLineLeftOut in build.ts): Tempus tags $176.0M of it from a note while its balance sheet carries
      // $1,174.9M of convertible notes under a company extension (10-Q 0001193125-26-442624).
      components: ["ConvertibleLongTermNotesPayable", "ConvertibleDebtNoncurrent", "LongTermLineOfCredit"],
    },
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
    [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PaymentsToAcquireOtherPropertyPlantAndEquipment",
      "PaymentsToAcquireOtherProductiveAssets",
      "PaymentsToDevelopRealEstateAssets",
      // Oil and gas producers' capital line, read only when none of the above is tagged: Gulfport's "Additions to
      // oil and gas properties" $527.6M (10-K 0001628280-26-011487).
      // The development concept comes ahead of the two acquisition concepts, which some producers use for property purchases beside it: Diamondback's
      // "Additions to oil and natural gas properties" $3,523M beside "Property acquisitions" $5,938M
      // (PaymentsToAcquireOilAndGasProperty, 10-K 0001539838-26-000010), SM Energy's "Capital expenditures" $1,438M
      // beside $34M of acquisitions (PaymentsToAcquireOilAndGasPropertyAndEquipment, 10-K 0000893538-26-000032).
      "PaymentsToExploreAndDevelopOilAndGasProperties",
      "PaymentsToAcquireOilAndGasPropertyAndEquipment",
      "PaymentsToAcquireOilAndGasProperty",
      // Company extensions (read from the filings' inline XBRL at ingest) for filers with no us-gaap capex line.
      "cop:PaymentToAcquireProductiveAssetsAndInvestments",
      "cop:CapitalExpendituresAndInvestments",
      "nee:CapitalExpendituresIndependentPowerInvestmentsAndNuclearFuelPurchases",
      // Cigna's "Purchases of property and equipment, net" ($1,212M FY2025, 10-K 0001739940-26-000006).
      "ci:PaymentsForProceedsFromPropertyPlantAndEquipment",
      // Last, and kept only where the investing section proves it the whole capital line (capitalImprovementsProven
      // in build.ts): it is that for Snap-on's "Capital expenditures" $76.0M, and a fragment for Weyerhaeuser, which
      // tags $51M of reforestation with it beside $423M of capital spending under its own extension.
      "PaymentsForCapitalImprovements",
    ],
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
    [
      "ProceedsFromIssuanceOfLongTermDebt",
      "ProceedsFromIssuanceOfDebt",
      "ProceedsFromIssuanceOfSeniorLongTermDebt",
      "ProceedsFromDebtNetOfIssuanceCosts",
      "ProceedsFromIssuanceOfLongTermDebtAndCapitalSecuritiesNet",
    ],
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
  usd(
    "buybacks",
    "Share repurchases",
    // Last resort: the equity-statement amount, for filers that don't tag the cash-flow line.
    ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity", "StockRepurchasedDuringPeriodValue"],
    "flow",
    { indent: 1 },
  ),
  usd("dividends", "Dividends paid", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends"], "flow", {
    indent: 1,
  }),
  usd("cff", "Cash from financing", ["NetCashProvidedByUsedInFinancingActivities"], "flow", { bold: true }),
];

/**
 * Total debt as the filing itself tags it, current and noncurrent together: Travelers' balance sheet
 * "Debt" ($9,267M FY2025) and Aflac's "Notes payable and lease obligations" ($8,900M at 30 Sep 2026).
 * Filers also use them for a debt note's subtotal, so they are used only when no debt line is tagged
 * or the lines come to less than three quarters of them (totalDebtRow in build.ts).
 */
export const TOTAL_DEBT_CONCEPTS = ["DebtLongtermAndShorttermCombinedAmount", "DebtAndCapitalLeaseObligations"];

/**
 * Debt amounts a filing tags beside its balance sheet lines. A line sum below half of one of them
 * is a fragment (Travelers' $300M current debt against $9,267M of debt), not a total.
 */
export const DEBT_EVIDENCE_CONCEPTS = [
  "LongTermDebt",
  "DebtInstrumentCarryingAmount",
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  "NotesPayable",
  "LongTermNotesPayable",
  "SeniorNotes",
  "SeniorLongTermNotes",
  "ConvertibleNotesPayable",
  // Super Micro's balance sheet line, beside credit lines it tags only with company extensions.
  "ConvertibleLongTermNotesPayable",
  "LongTermLineOfCredit",
  "SecuredDebt",
  "UnsecuredDebt",
];

export const ALL_LINES = [...INCOME_LINES, ...BALANCE_LINES, ...CASHFLOW_LINES];
