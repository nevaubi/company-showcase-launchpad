// Commercial mortgage asset files: each record becomes one `abs_cmbs_assets` row and each <property>
// block one `abs_cmbs_properties` row. Pure: text in, rows out.
//
// A value is stored as the file states it. A column holds the number, date or yes/no the text spells;
// text that does not spell one (a date in another shape, "N/A" in a number field) leaves the column
// empty and is kept word for word under `unparsed`. A field with no column is kept word for word under
// `extra`. Nothing is rescaled: a rate written .03486 is stored 0.03486.
import { add, dec, div, fmt, isDecimal, mul, ZERO, type Dec } from "./decimal";
import { BLANK, metricRow, type MetricRow } from "./metrics";
import type { AbsField, AbsRecord } from "./xml";

type Kind = "text" | "num" | "int" | "date" | "bool";
type Spec = readonly [column: string, element: string, kind: Kind];

export const ASSET_COLUMNS: readonly Spec[] = [
  ["asset_type_number", "assetTypeNumber", "text"],
  ["group_id", "GroupID", "text"],
  ["period_begin", "reportingPeriodBeginningDate", "date"],
  ["period_end", "reportingPeriodEndDate", "date"],
  ["originator_name", "originatorName", "text"],
  ["origination_date", "originationDate", "date"],
  ["original_loan_amount", "originalLoanAmount", "num"],
  ["original_term_months", "originalTermLoanNumber", "int"],
  ["maturity_date", "maturityDate", "date"],
  ["original_amortization_months", "originalAmortizationTermNumber", "int"],
  ["original_interest_only_months", "originalInterestOnlyTermNumber", "int"],
  ["first_payment_date", "firstLoanPaymentDueDate", "date"],
  ["original_rate", "originalInterestRatePercentage", "num"],
  ["securitization_rate", "interestRateSecuritizationPercentage", "num"],
  ["rate_type_code", "originalInterestRateTypeCode", "text"],
  ["accrual_method_code", "interestAccrualMethodCode", "text"],
  ["lien_position_code", "lienPositionSecuritizationCode", "text"],
  ["loan_structure_code", "loanStructureCode", "text"],
  ["payment_type_code", "paymentTypeCode", "text"],
  ["payment_frequency_code", "paymentFrequencyCode", "text"],
  ["properties_securitization", "NumberPropertiesSecuritization", "int"],
  ["properties", "NumberProperties", "int"],
  ["interest_only", "interestOnlyIndicator", "bool"],
  ["balloon", "balloonIndicator", "bool"],
  ["securitization_balance", "scheduledPrincipalBalanceSecuritizationAmount", "num"],
  ["begin_balance", "reportPeriodBeginningScheduleLoanBalanceAmount", "num"],
  ["sched_end_balance", "reportPeriodEndScheduledLoanBalanceAmount", "num"],
  ["actual_end_balance", "reportPeriodEndActualBalanceAmount", "num"],
  ["period_rate", "reportPeriodInterestRatePercentage", "num"],
  ["sched_interest", "scheduledInterestAmount", "num"],
  ["sched_principal", "scheduledPrincipalAmount", "num"],
  ["unsched_principal", "unscheduledPrincipalCollectedAmount", "num"],
  ["total_pi_due", "totalScheduledPrincipalInterestDueAmount", "num"],
  ["paid_through_date", "paidThroughDate", "date"],
  ["payment_status_code", "paymentStatusLoanCode", "text"],
  ["pi_advances_outstanding", "totalPrincipalInterestAdvancedOutstandingAmount", "num"],
  ["ti_advances_outstanding", "totalTaxesInsuranceAdvancesOutstandingAmount", "num"],
  ["other_advances_outstanding", "otherExpensesAdvancedOutstandingAmount", "num"],
  ["non_recoverable", "nonRecoverabilityIndicator", "bool"],
  ["asset_added", "assetAddedIndicator", "bool"],
  ["period_modified", "reportPeriodModificationIndicator", "bool"],
  ["modified", "modifiedIndicator", "bool"],
  ["modification_code", "modificationCode", "text"],
  ["last_modification_date", "lastModificationDate", "date"],
  ["realized_loss", "realizedLossToTrustAmount", "num"],
  ["liquidation_prepayment_code", "liquidationPrepaymentCode", "text"],
  ["liquidation_prepayment_date", "liquidationPrepaymentDate", "date"],
  ["workout_strategy_code", "workoutStrategyCode", "text"],
  ["special_servicer_transfer_date", "mostRecentSpecialServicerTransferDate", "date"],
  ["master_servicer_return_date", "mostRecentMasterServicerReturnDate", "date"],
  ["primary_servicer_name", "primaryServicerName", "text"],
  ["subject_to_demand", "assetSubjectDemandIndicator", "bool"],
];

export const PROPERTY_COLUMNS: readonly Spec[] = [
  ["name", "propertyName", "text"],
  ["address", "propertyAddress", "text"],
  ["city", "propertyCity", "text"],
  ["state", "propertyState", "text"],
  ["zip", "propertyZip", "text"],
  ["county", "propertyCounty", "text"],
  ["type_code", "propertyTypeCode", "text"],
  ["status_code", "propertyStatusCode", "text"],
  ["defeased_code", "DefeasedStatusCode", "text"],
  ["year_built", "yearBuiltNumber", "int"],
  ["year_renovated", "yearLastRenovated", "int"],
  ["sq_ft", "netRentableSquareFeetNumber", "num"],
  ["sq_ft_securitization", "netRentableSquareFeetSecuritizationNumber", "num"],
  ["units", "unitsBedsRoomsNumber", "num"],
  ["units_securitization", "unitsBedsRoomsSecuritizationNumber", "num"],
  ["valuation_securitization", "valuationSecuritizationAmount", "num"],
  ["valuation_securitization_date", "valuationSecuritizationDate", "date"],
  ["valuation_source_securitization", "valuationSourceSecuritizationCode", "text"],
  ["valuation_recent", "mostRecentValuationAmount", "num"],
  ["valuation_recent_date", "mostRecentValuationDate", "date"],
  ["valuation_recent_source", "mostRecentValuationSourceCode", "text"],
  ["occupancy_securitization", "physicalOccupancySecuritizationPercentage", "num"],
  ["occupancy_recent", "mostRecentPhysicalOccupancyPercentage", "num"],
  ["financials_securitization_date", "financialsSecuritizationDate", "date"],
  ["financials_recent_start", "mostRecentFinancialsStartDate", "date"],
  ["financials_recent_end", "mostRecentFinancialsEndDate", "date"],
  ["revenue_securitization", "revenueSecuritizationAmount", "num"],
  ["revenue_recent", "mostRecentRevenueAmount", "num"],
  ["opex_securitization", "operatingExpensesSecuritizationAmount", "num"],
  ["opex_recent", "operatingExpensesAmount", "num"],
  ["noi_securitization", "netOperatingIncomeSecuritizationAmount", "num"],
  ["noi_recent", "mostRecentNetOperatingIncomeAmount", "num"],
  ["ncf_securitization", "netCashFlowFlowSecuritizationAmount", "num"],
  ["ncf_recent", "mostRecentNetCashFlowAmount", "num"],
  ["noi_ncf_code_securitization", "netOperatingIncomeNetCashFlowSecuritizationCode", "text"],
  ["noi_ncf_code_recent", "netOperatingIncomeNetCashFlowCode", "text"],
  ["debt_service_recent", "mostRecentDebtServiceAmount", "num"],
  [
    "dscr_noi_securitization",
    "debtServiceCoverageNetOperatingIncomeSecuritizationPercentage",
    "num",
  ],
  ["dscr_noi_recent", "mostRecentDebtServiceCoverageNetOperatingIncomePercentage", "num"],
  ["dscr_ncf_securitization", "debtServiceCoverageNetCashFlowSecuritizationPercentage", "num"],
  ["dscr_ncf_recent", "mostRecentDebtServiceCoverageNetCashFlowpercentage", "num"],
  ["dscr_code_securitization", "debtServiceCoverageSecuritizationCode", "text"],
  ["dscr_code_recent", "mostRecentDebtServiceCoverageCode", "text"],
  ["tenant1", "largestTenant", "text"],
  ["tenant1_sq_ft", "squareFeetLargestTenantNumber", "num"],
  ["tenant1_lease_end", "leaseExpirationLargestTenantDate", "date"],
  ["tenant2", "secondLargestTenant", "text"],
  ["tenant2_sq_ft", "squareFeetSecondLargestTenantNumber", "num"],
  ["tenant2_lease_end", "leaseExpirationSecondLargestTenantDate", "date"],
  ["tenant3", "thirdLargestTenant", "text"],
  ["tenant3_sq_ft", "squareFeetThirdLargestTenantNumber", "num"],
  ["tenant3_lease_end", "leaseExpirationThirdLargestTenantDate", "date"],
  ["lease_rollover_review_date", "mostRecentAnnualLeaseRolloverReviewDate", "date"],
];

/** A record is a loan when it states any of these; a record with none of them and a property block is that property. */
const LOAN_EVIDENCE = [
  "originalLoanAmount",
  "originationDate",
  "maturityDate",
  "scheduledPrincipalBalanceSecuritizationAmount",
  "reportPeriodBeginningScheduleLoanBalanceAmount",
  "reportPeriodEndScheduledLoanBalanceAmount",
  "reportPeriodEndActualBalanceAmount",
  "paymentStatusLoanCode",
];

export type Cell = string | number | boolean | null;
export type Kept = Record<string, string | string[]>;
export type CmbsAssetRow = {
  rec: number;
  kind: "loan" | "property" | "other";
  asset_number: string;
  extra: Kept;
  unparsed: Kept;
} & Record<string, Cell | Kept>;
export type CmbsPropertyRow = {
  rec: number;
  seq: number;
  asset_number: string;
  loan_asset_number: string;
  link: "nested" | "number" | "none";
  extra: Kept;
  unparsed: Kept;
} & Record<string, Cell | Kept>;

const INT_MAX = 2147483647;

/** A calendar date written month first (MM-DD-YYYY, as the files do, or MM/DD/YYYY) as YYYY-MM-DD; null when it is not one. */
export function monthFirstDate(text: string): string | null {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(text);
  if (!m) return null;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1000 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
    ? `${m[3]}-${m[1]}-${m[2]}`
    : null;
}

/** The typed value a field's text spells. `bad` is true when the text is not blank and does not spell one. */
export function typed(kind: Kind, source: string): { value: Cell; bad: boolean } {
  const t = source.trim();
  if (t === "") return { value: null, bad: false };
  if (kind === "text") return { value: t, bad: false };
  if (kind === "num") return isDecimal(t) ? { value: t, bad: false } : { value: null, bad: true };
  if (kind === "int") {
    const m = /^([+-]?\d+)(?:\.0*)?$/.exec(t);
    const n = m ? Number(m[1]) : NaN;
    return Number.isSafeInteger(n) && Math.abs(n) <= INT_MAX
      ? { value: n, bad: false }
      : { value: null, bad: true };
  }
  if (kind === "date") {
    const d = monthFirstDate(t);
    return { value: d, bad: d == null };
  }
  const b = /^(true|1)$/i.test(t) ? true : /^(false|0)$/i.test(t) ? false : null;
  return { value: b, bad: b == null };
}

function columns(specs: readonly Spec[], fields: AbsField[], skip: ReadonlySet<string>) {
  const byName = new Map<string, string[]>();
  for (const [name, text] of fields) byName.set(name, [...(byName.get(name) ?? []), text]);
  const out: Record<string, Cell> = {};
  const unparsed: Kept = {};
  const used = new Set<string>(skip);
  for (const [column, element, kind] of specs) {
    used.add(element);
    const values = byName.get(element);
    if (!values) out[column] = null;
    else if (values.length > 1) {
      // the same field twice in one record: no single value can be claimed
      out[column] = null;
      unparsed[element] = values;
    } else {
      const { value, bad } = typed(kind, values[0]);
      out[column] = value;
      if (bad) unparsed[element] = values[0];
    }
  }
  const extra: Kept = {};
  for (const [name, values] of byName)
    if (!used.has(name)) extra[name] = values.length === 1 ? values[0] : values;
  return { out, extra, unparsed, byName };
}

const NUMBER_ONLY = new Set(["assetNumber"]);

/** One record as its asset row and the rows of its property blocks (not yet linked to a loan). */
export function cmbsRows(record: AbsRecord): {
  asset: CmbsAssetRow;
  properties: CmbsPropertyRow[];
} {
  const { out, extra, unparsed, byName } = columns(ASSET_COLUMNS, record.fields, NUMBER_ONLY);
  const numbers = byName.get("assetNumber") ?? [];
  const asset_number = numbers.length === 1 ? numbers[0].trim() : "";
  if (!asset_number)
    throw new Error(
      `record ${record.rec} has ${numbers.length > 1 ? "more than one" : "no"} assetNumber`,
    );
  const other = record.blocks.filter((b) => b.name !== "property");
  if (other.length)
    throw new Error(
      `record ${record.rec} holds a <${other[0].name}> block, which this reader does not know`,
    );
  const loan = LOAN_EVIDENCE.some((name) => (byName.get(name) ?? []).some((v) => v.trim() !== ""));
  const kind = loan ? "loan" : record.blocks.length ? "property" : "other";
  const properties = record.blocks.map((b, i): CmbsPropertyRow => {
    const p = columns(PROPERTY_COLUMNS, b.fields, new Set());
    return {
      rec: record.rec,
      seq: i + 1,
      asset_number,
      loan_asset_number: asset_number,
      link: loan ? "nested" : "none",
      ...p.out,
      extra: p.extra,
      unparsed: p.unparsed,
    };
  });
  return { asset: { rec: record.rec, kind, asset_number, ...out, extra, unparsed }, properties };
}

/**
 * Ties the properties filed in records of their own to their loan. Such a record is numbered after its
 * loan ("9.01", "9.02" under loan "9"); the loan is the longest loan number the record's number starts
 * with, followed by a dot or a hyphen. A record no loan number fits stays unlinked (`none`): a guess
 * would attach a property to the wrong loan.
 */
export function linkProperties(assets: CmbsAssetRow[], properties: CmbsPropertyRow[]): void {
  const loans = assets.filter((a) => a.kind === "loan").map((a) => a.asset_number);
  for (const p of properties) {
    if (p.link === "nested") continue;
    let best = "";
    for (const n of loans)
      if (
        n.length > best.length &&
        p.asset_number.startsWith(n) &&
        /^[.-]/.test(p.asset_number.slice(n.length))
      )
        best = n;
    if (best) {
      p.loan_asset_number = best;
      p.link = "number";
    }
  }
}

const text = (v: Cell | Kept) => (typeof v === "string" ? v : null);

/** Pool figures of one commercial mortgage file. Definitions: metrics.ts. */
export function cmbsMetrics(assets: CmbsAssetRow[], properties: CmbsPropertyRow[]): MetricRow[] {
  const loans = assets.filter((a) => a.kind === "loan");
  const rows: MetricRow[] = [
    metricRow("records", String(assets.length), assets.length),
    metricRow("loans", String(loans.length), loans.length),
    metricRow(
      "property_records",
      String(assets.filter((a) => a.kind === "property").length),
      assets.filter((a) => a.kind === "property").length,
    ),
    metricRow("properties", String(properties.length), properties.length),
  ];
  const sum = (column: string, of: CmbsAssetRow[]) => {
    let total: Dec = ZERO;
    let n = 0;
    for (const a of of) {
      const v = text(a[column]);
      const d = v == null ? null : dec(v);
      if (d) {
        total = add(total, d);
        n++;
      }
    }
    return { total, n };
  };
  for (const [metric, column] of [
    ["original_balance", "original_loan_amount"],
    ["securitization_balance", "securitization_balance"],
    ["begin_balance", "begin_balance"],
    ["sched_end_balance", "sched_end_balance"],
    ["actual_end_balance", "actual_end_balance"],
  ] as const) {
    const s = sum(column, loans);
    rows.push(metricRow(metric, s.n ? fmt(s.total) : null, s.n, loans.length - s.n));
  }
  // rate weighted by the scheduled balance at period end
  let weight: Dec = ZERO;
  let weighted: Dec = ZERO;
  let n = 0;
  for (const a of loans) {
    const r = text(a.period_rate);
    const b = text(a.sched_end_balance);
    const rate = r == null ? null : dec(r);
    const bal = b == null ? null : dec(b);
    if (!rate || !bal || bal.v <= 0n) continue;
    weight = add(weight, bal);
    weighted = add(weighted, mul(rate, bal));
    n++;
  }
  const wa = n ? div(weighted, weight, 10) : null;
  rows.push(metricRow("wa_period_rate", wa ? fmt(wa) : null, n, loans.length - n));
  // split by payment status and by the reporting period each record states
  const group = (of: CmbsAssetRow[], key: (a: CmbsAssetRow) => string) => {
    const g = new Map<string, CmbsAssetRow[]>();
    for (const a of of) g.set(key(a), [...(g.get(key(a)) ?? []), a]);
    return [...g].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  };
  for (const [bucket, members] of group(loans, (a) => text(a.payment_status_code) ?? BLANK)) {
    const s = sum("sched_end_balance", members);
    rows.push(
      metricRow("loans", String(members.length), members.length, 0, "payment_status", bucket),
    );
    rows.push(
      metricRow(
        "sched_end_balance",
        s.n ? fmt(s.total) : null,
        s.n,
        members.length - s.n,
        "payment_status",
        bucket,
      ),
    );
  }
  for (const [bucket, members] of group(assets, (a) => text(a.period_end) ?? BLANK))
    rows.push(
      metricRow("records", String(members.length), members.length, 0, "period_end", bucket),
    );
  return rows;
}
