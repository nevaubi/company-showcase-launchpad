import { classConcepts } from "./share-class";
import type { StatementSector } from "./statement-layout";
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
  /** Only for companies of these statement sectors (statement-layout.ts). */
  sectors?: StatementSector[];
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
      // Last: a gas utility's only revenue line. ONE Gas prints "Regulated Operating Revenue" $2,427.4M FY2025 as the
      // statement's top line (10-K 0001587732-26-000009); for utilities that tag a total above, it is a part.
      "RegulatedOperatingRevenue",
    ],
    "flow",
    { bold: true },
  ),
  // Banks' interest lines above net interest income (statement-layout.ts orders them): JPMorgan's "Interest income"
  // $53,056M and "Interest expense" $26,020M, Q3 2026 (InterestIncomeOperating, InterestExpenseOperating); Bank of
  // America's $34,257M (InterestAndDividendIncomeOperating).
  usd("bankInterestIncome", "Interest income", ["InterestAndDividendIncomeOperating", "InterestIncomeOperating"], "flow", { indent: 1, bank: true }),
  usd("bankInterestExpense", "Interest expense", ["InterestExpenseOperating", "InterestExpense"], "flow", { indent: 1, bank: true }),
  usd("netInterestIncome", "Net interest income", ["InterestIncomeExpenseNet", "InterestIncomeExpenseAfterProvisionForLoanLoss"], "flow", { indent: 1, bank: true }),
  usd("nonInterestIncome", "Noninterest revenue", ["NoninterestIncome"], "flow", { indent: 1, bank: true }),
  usd(
    "provisionCreditLosses",
    "Provision for credit losses",
    // The newer taxonomy's credit loss expense concepts after the older ones, and Bank of America's own "Provision for
    // credit losses" $1,269M Q3 2026 (10-Q 0000070858-26-000548).
    [
      "ProvisionForLoanLeaseAndOtherLosses",
      "ProvisionForLoanAndLeaseLosses",
      "ProvisionForCreditLosses",
      "FinancingReceivableExcludingAccruedInterestAndOffBalanceSheetCreditLossExpenseReversal",
      "CreditLossExpenseReversal",
      "ProvisionForLoanLossesExpensed",
      "bac:FinancingReceivableExcludingAccruedInterestAndOffBalanceSheetLiabilityCreditLossProvisionReversal",
    ],
    "flow",
    { indent: 1, bank: true },
  ),
  usd("nonInterestExpense", "Noninterest expense", ["NoninterestExpense"], "flow", { indent: 1, bank: true }),
  // Insurers (statement-layout.ts): Progressive Q3 2026 net premiums earned $21,869.0M, investment income $1,035.0M,
  // total net realized gains on securities −$170.0M, losses and loss adjustment expenses $14,904.0M, policy
  // acquisition costs $1,607.0M, other underwriting expenses $3,196.0M, total expenses $19,956.0M (10-Q
  // 0000080661-26-000379).
  usd("premiumsEarned", "Premiums earned", ["PremiumsEarnedNet"], "flow", { indent: 1, sectors: ["insurer"] }),
  usd("investmentIncome", "Investment income", ["NetInvestmentIncome", "InterestAndDividendIncomeOperating", "InvestmentIncomeInterestAndDividend"], "flow", {
    indent: 1,
    sectors: ["insurer"],
  }),
  usd("investmentGains", "Investment gains (losses)", ["GainLossOnInvestments", "DebtAndEquitySecuritiesGainLoss", "RealizedInvestmentGainsLosses"], "flow", {
    indent: 1,
    sectors: ["insurer"],
  }),
  usd(
    "lossesBenefits",
    "Losses, claims and benefits",
    ["PolicyholderBenefitsAndClaimsIncurredNet", "LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1", "IncurredClaimsPropertyCasualtyAndLiability"],
    "flow",
    { indent: 1, sectors: ["insurer"] },
  ),
  usd("policyAcquisition", "Policy acquisition costs", ["DeferredPolicyAcquisitionCostAmortizationExpense"], "flow", { indent: 1, sectors: ["insurer"] }),
  usd("otherUnderwriting", "Other underwriting expenses", ["OtherUnderwritingExpense"], "flow", { indent: 1, sectors: ["insurer"] }),
  usd("insuranceExpenses", "Total expenses", ["BenefitsLossesAndExpenses", "CostsAndExpenses"], "flow", { sectors: ["insurer"] }),
  // Managed care: UnitedHealth Q3 2026 premiums $87,078M and medical costs $76,982M (10-Q 0000731766-26-000266).
  usd("premiums", "Premiums", ["PremiumsEarnedNet", "HealthCareOrganizationPremiumRevenue"], "flow", { indent: 1, sectors: ["managedCare"] }),
  usd("medicalCosts", "Medical costs", ["PolicyholderBenefitsAndClaimsIncurredNet", "HealthCareOrganizationMedicalCosts"], "flow", { indent: 1, sectors: ["managedCare"] }),
  // Real estate trusts: Prologis' rental revenues and rental expenses (its revenue line is its own concept, read from
  // the filing at ingest), American Tower's "Property" costs $724.9M Q3 2026.
  usd("rentalRevenue", "Rental revenue", ["OperatingLeaseLeaseIncome", "OperatingLeasesIncomeStatementLeaseRevenue", "pld:RentalRevenue"], "flow", {
    indent: 1,
    sectors: ["reit"],
  }),
  usd("propertyExpenses", "Property operating expenses", ["DirectCostsOfLeasedAndRentedPropertyOrEquipment", "CostOfOtherPropertyOperatingExpense"], "flow", {
    indent: 1,
    sectors: ["reit"],
  }),
  usd("reitDna", "Depreciation & amortization", ["DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationDepletionAndAmortization"], "flow", {
    indent: 1,
    sectors: ["reit"],
  }),
  // Utilities: NextEra Q3 2026 fuel, purchased power and interchange $1,699M (its own concept), other operations and
  // maintenance $1,428M, depreciation and amortization $1,651M, taxes other than income taxes $713M.
  usd("fuelPower", "Fuel & purchased power", ["nee:FuelPurchasedPowerAndInterchangeExpense", "FuelCosts", "CostOfPurchasedPower"], "flow", {
    indent: 1,
    sectors: ["utility"],
  }),
  usd(
    "operationsMaintenance",
    "Operations & maintenance",
    ["UtilitiesOperatingExpenseMaintenanceAndOperations", "UtilitiesOperatingExpenseMaintenanceOperationsAndOtherCostsAndExpenses"],
    "flow",
    { indent: 1, sectors: ["utility"] },
  ),
  usd(
    "utilityDna",
    "Depreciation & amortization",
    ["nee:DepreciationAndAmortizationExcludingNuclearFuel", "UtilitiesOperatingExpenseDepreciationAndAmortization", "DepreciationAndAmortization"],
    "flow",
    { indent: 1, sectors: ["utility"] },
  ),
  usd("taxesOther", "Taxes other than income taxes", ["TaxesExcludingIncomeAndExciseTaxes", "UtilitiesOperatingExpenseTaxes"], "flow", { indent: 1, sectors: ["utility"] }),
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
  // Prologis' "Total expenses" $1,450.8M Q3 2026 is its own concept; the OperatingExpenses it tags is a note figure.
  usd("opex", "Total operating expenses", ["OperatingExpenses", "CostsAndExpenses", "pld:OperatingExpensesBeforeGainsOnRealEstateTransactionsNet"], "flow", { bold: true }),
  // Gains printed between operating expenses and operating income, kept only where they close that gap
  // (dropUntiedOpex in build.ts): NextEra's "Gains on disposal of businesses/assets – net" $44M Q3 2026 (8,090 − 5,510
  // + 44 = 2,624); Prologis' gains on dispositions of development properties and of other real estate.
  usd("operatingGains", "Gains on disposals", ["DisposalGroupNotDiscontinuedOperationGainLossOnDisposal", "GainLossOnSaleOfRealEstateInvestmentPropertyNet"], "flow", {
    indent: 1,
    components: ["pld:GainsOnDispositionsOfDevelopmentPropertiesAndLandNet", "pld:GainsOnOtherDispositionsOfInvestmentsInRealEstateNet"],
  }),
  usd("operatingIncome", "Operating income", ["OperatingIncomeLoss"], "flow", { bold: true }),
  // Shown only for a period where interest income, interest expense and the other line add up to the non-operating
  // total, so that they are that total's printed lines (splitNonOperating in build.ts): Amazon Q3 2026 1,187 − 1,691
  // − 703 = −1,207; American Tower prints "Interest income" (InterestIncomeOther) the same way.
  usd("interestIncome", "Interest income", ["InvestmentIncomeInterest", "InterestIncomeOther", "InvestmentIncomeInterestAndDividend"], "flow", {
    indent: 1,
  }),
  usd(
    "interestExpense",
    "Interest expense",
    ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense", "InterestExpenseOperating", "nee:InterestExpenseAggregateExpenses"],
    "flow",
    { indent: 1 },
  ),
  // The other non-operating line, never the non-operating total: Amazon prints "Other income (expense), net" (703)
  // (OtherNonoperatingIncomeExpense) above "Total non-operating income (expense)" (1,207) (NonoperatingIncomeExpense),
  // which already holds the interest expense line (10-Q 0001018724-26-000040). NonoperatingIncomeExpense stands here
  // only for a period where it does not bridge operating income to pretax income, so that it is a line of its own
  // (Walmart's "Other (gains) and losses"; splitNonOperating in build.ts).
  usd(
    "otherIncome",
    "Other income (expense), net",
    ["OtherNonoperatingIncomeExpense", "NonoperatingIncomeExpense"],
    "flow",
    { indent: 1 },
  ),
  // Kept only for a period where operating income plus it is pretax income (splitNonOperating in build.ts).
  usd("nonOperatingTotal", "Total non-operating income (expense)", ["NonoperatingIncomeExpense"], "flow"),
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
  // Consolidated profit and the noncontrolling interests' share, printed above the attributable line by filers with
  // noncontrolling interests; kept only for periods where that share is tagged and not zero (attributableNetIncome).
  usd("netIncomeInclNci", "Net income incl. noncontrolling interests", ["ProfitLoss"], "flow"),
  usd(
    "nciIncome",
    "Less: noncontrolling interests",
    // NextEra: "Net loss attributable to noncontrolling interests" (the nonredeemable interests' concept).
    ["NetIncomeLossAttributableToNoncontrollingInterest", "MinorityInterestInNetIncomeLossOfConsolidatedEntities", "NetIncomeLossAttributableToNonredeemableNoncontrollingInterest"],
    "flow",
    { indent: 1 },
  ),
  usd(
    "netIncome",
    "Net income",
    // Net income attributable to the company's shareholders, the line EPS is computed on. Available to common
    // stands only where nothing but noncontrolling interests separates it from consolidated profit (Booking's "Net
    // income" $5,404M FY2025, 10-K 0001075531-26-000009; Caterpillar's "Profit" $3,287M Q3 2026 = profit of
    // consolidated and affiliated companies $3,286M less noncontrolling interests −$1M, 10-Q 0000018230-26-000057).
    // ProfitLoss stands only for a period with no noncontrolling interests tagged; otherwise the line is calculated
    // as ProfitLoss less the noncontrolling interests (attributableNetIncome in build.ts).
    ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
    "flow",
    { bold: true },
  ),
  {
    key: "epsBasic",
    label: "EPS, basic",
    // The continuing-operations figure only where the statement has no discontinued operations, so that it is the
    // statement's own EPS line (dropContinuingEpsBesideDiscontinued in build.ts): Freeport-McMoRan, Exelon,
    // Halliburton and Airbnb tag their only EPS lines with it.
    // Goldman Sachs prints "Basic" EPS $17.24 Q3 2026 under its own concept, earnings excluding those attributed to
    // participating securities (10-Q 0000886982-26-000532). Last, the ticker's share class's EPS where the filer tags
    // EPS by class only (Berkshire's Class B $10.33 Q3 2026; share-class.ts).
    concepts: [
      "EarningsPerShareBasic",
      "IncomeLossFromContinuingOperationsPerBasicShare",
      "gs:EarningsPerShareExcludingNetEarningsAttributedToParticipatingSecuritiesBasic",
      ...classConcepts("EarningsPerShareBasic"),
      ...classConcepts("EarningsPerShareBasicAndDiluted"),
    ],
    unit: "usdPerShare",
    kind: "flow",
    additive: true,
  },
  {
    key: "epsDiluted",
    label: "EPS, diluted",
    // Freeport-McMoRan's "Diluted" $1.52 FY2025 (10-K 0000831259-26-000012), Airbnb's "Diluted" $4.03 FY2025
    // (10-K 0001559720-26-000004): IncomeLossFromContinuingOperationsPerDilutedShare, no discontinued operations.
    concepts: [
      "EarningsPerShareDiluted",
      "EarningsPerShareBasicAndDiluted",
      "IncomeLossFromContinuingOperationsPerDilutedShare",
      ...classConcepts("EarningsPerShareDiluted"),
      ...classConcepts("EarningsPerShareBasicAndDiluted"),
    ],
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
    concepts: ["WeightedAverageNumberOfSharesOutstandingBasic", ...classConcepts("WeightedAverageNumberOfSharesOutstandingBasic")],
    unit: "shares",
    kind: "flow",
    additive: false,
  },
  {
    key: "sharesDiluted",
    label: "Weighted avg. shares, diluted",
    concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding", ...classConcepts("WeightedAverageNumberOfDilutedSharesOutstanding")],
    unit: "shares",
    kind: "flow",
    additive: false,
  },
];

export const BALANCE_LINES: LineDef[] = [
  usd(
    "cash",
    "Cash & equivalents",
    // Chevron's balance sheet line "Cash and cash equivalents" $12,804M at 30 Sep 2026 is tagged
    // CashAndCashEquivalentsExcludingTimeDeposits (10-Q 0000093410-26-000200). The restricted-cash total comes last
    // and is named for itself where it stands alone (cashLabel in build.ts).
    ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalentsExcludingTimeDeposits", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
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
  // Real estate trusts' main asset: Prologis' "Net investments in real estate properties" $82,400.1M at 30 Sep 2026.
  usd("realEstate", "Real estate investments, net", ["RealEstateInvestmentPropertyNet"], "stock", { sectors: ["reit"] }),
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
  // The cash flow statement starts from consolidated net income, noncontrolling interests included (ASC 230):
  // Berkshire's "Net earnings" $67,260M FY2025 (ProfitLoss), not the $66,968M attributable to its shareholders
  // (10-K 0001193125-26-083899). Labelled as including noncontrolling interests where they differ (build.ts).
  usd("cfNetIncome", "Net income", ["ProfitLoss", "NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"], "flow"),
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
  usd(
    "cfo",
    "Cash from operations",
    [
      "NetCashProvidedByUsedInOperatingActivities",
      // Read only for a period with no total tagged: a filer with discontinued operations whose statement prints
      // no total, only the continuing-operations subtotal of the operating section, with the discontinued
      // operations' cash in a separate block below. Becton Dickinson: "Net Cash Provided by Continuing Operating
      // Activities" $3,430M FY2025 (10-K 0000010795-25-000099); Darden: "Net cash provided by operating
      // activities of continuing operations" $1,853.1M FY2026 (10-K 0000940944-26-000025).
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "flow",
    { bold: true },
  ),
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
      // Dominion's consolidated "Plant construction and other property additions (including nuclear fuel)" $12,641M
      // FY2025 (10-K 0001193125-26-063120); its us-gaap PaymentsToAcquirePropertyPlantAndEquipment is Virginia
      // Power's line, tagged with a legal-entity dimension.
      "d:PaymentsToAcquirePropertyPlantAndEquipmentIncludingNuclearFuel",
      // Read last and under the same investing-section proof as capital improvements (PROVEN_CAPITAL_LINES in
      // build.ts): Con Edison's "Utility capital expenditures" $4,764M FY2025 (10-K 0001047862-26-000031).
      "PaymentsForConstructionInProcess",
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
  usd(
    "cfi",
    "Cash from investing",
    // The continuing-operations subtotal stands where no total is tagged, as for cash from operations: Dollar
    // Tree's "Net cash used in investing activities of continuing operations" $648.7M FY2025 (10-K 0000935703-26-000025).
    ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"],
    "flow",
    { bold: true },
  ),
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
  usd(
    "cff",
    "Cash from financing",
    // DuPont: "Cash used for financing activities - continuing operations" $1,750M FY2025 (10-K 0001666700-26-000013).
    ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"],
    "flow",
    { bold: true },
  ),
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
