// The words behind every figure on the page. A stored figure shows the definition text of
// ../metrics.ts word for word; a figure the page derives states its formula, its numerator and its
// denominator here. Nothing on the page may describe a figure in other words than these.
import { METRICS, type MetricKey, type MetricUnit } from "../metrics";
import { DUE_30_PLUS, DUE_60_PLUS, END_LABEL, STATUS_GROUPS } from "./codes";
import type { AbsFamily } from "./types";

export type Definition = {
  label: string;
  /** the unit as the page states it */
  unit: string;
  /** definition text; for a stored figure, the text of metrics.ts */
  what: string;
  /** "stored" figures are rows of abs_pool_metrics; "derived" ones are computed by the page */
  kind: "stored" | "derived";
};

export const UNIT_LABEL: Record<MetricUnit, string> = {
  usd: "US dollars",
  count: "count",
  fraction: "fraction",
  ratio: "ratio",
  months: "months",
  score: "score points",
  as_filed: "as filed: the scale is the filer's own and is not converted",
};

const LABEL: Partial<Record<MetricKey, string>> = {
  records: "Records in the file",
  loans: "Loans",
  property_records: "Property records",
  properties: "Property blocks",
  original_balance: "Original balance",
  securitization_balance: "Balance at securitization",
  begin_balance: "Begin balance",
  sched_end_balance: "Scheduled end balance",
  actual_end_balance: "Actual end balance",
  wa_period_rate: "Weighted period rate",
  end_balance: "End balance",
  charge_offs: "Charge-offs of the period",
  recoveries: "Recoveries of the period",
  acquisition_cost: "Acquisition cost",
  begin_securitization_value: "Begin securitization value",
  end_securitization_value: "End securitization value",
  end_actual_balance: "End actual balance",
  base_residual_active: "Base residual, active leases",
  contract_residual_active: "Contract residual, active leases",
  wa_original_rate: "Weighted original rate",
  wa_credit_score: "Weighted credit score",
  wa_original_term: "Weighted original term",
  wa_remaining_term: "Weighted remaining term",
  payment_to_income: "Payment to income",
  payment_to_income_over_one: "Payment to income above 1",
};

export const isMetric = (key: string): key is MetricKey => key in METRICS;

/** The definition of a stored figure, in the words of metrics.ts. */
export function metricDefinition(key: MetricKey): Definition {
  const m = METRICS[key];
  return { label: LABEL[key] ?? key, unit: UNIT_LABEL[m.unit], what: m.what, kind: "stored" };
}

const list = (items: readonly string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export type DerivedKey =
  | "due30"
  | "due60"
  | "due60_change"
  | "status_current"
  | "status_late"
  | "status_due30"
  | "status_matured_performing"
  | "status_matured_nonperforming"
  | "status_unstated"
  | "status_due30_change"
  | "foreclosure"
  | "months";

/** The definition of a figure the page derives, for one family. */
export function derivedDefinition(key: DerivedKey, family: AbsFamily): Definition {
  const end = END_LABEL[family].toLowerCase();
  const unitShare = `% of the ${end}`;
  const group = (k: string) => STATUS_GROUPS.find((g) => g.key === k)!;
  switch (key) {
    case "due30":
      return {
        label: "30 or more days past due",
        unit: unitShare,
        kind: "derived",
        what: `Sum of the ${end} of the records ${list(DUE_30_PLUS)} past due, divided by the ${end} of every record in the file. Days past due are the day count each record states (currentDelinquencyStatus), as the deal's own documents define it. A record that states no status is in the denominator only.`,
      };
    case "due60":
      return {
        label: "60 or more days past due",
        unit: unitShare,
        kind: "derived",
        what: `Sum of the ${end} of the records ${list(DUE_60_PLUS)} past due, divided by the ${end} of every record in the file. A record that states no status is in the denominator only.`,
      };
    case "due60_change":
      return {
        label: "Change in the 60 or more share",
        unit: "percentage points",
        kind: "derived",
        what: "The share 60 or more days past due of the newest reporting period less the same share of the previous stored period of the same deal. Both periods are named with the figure; when a month is not stored the two are more than a month apart.",
      };
    case "status_due30_change":
      return {
        label: "Change in the 30 or more share",
        unit: "percentage points",
        kind: "derived",
        what: "The share of the scheduled end balance 30 or more days delinquent in the newest reporting period less the same share of the previous stored period of the same deal. Both periods are named with the figure.",
      };
    case "foreclosure":
      return {
        label: "In foreclosure or bank-owned",
        unit: unitShare,
        kind: "derived",
        what: "Scheduled end balance of the loans whose workout strategy is foreclosure, REO or deed in lieu of foreclosure (codes 2, 7, 10), or one of whose properties is in foreclosure or REO (property status 1, 2), divided by the scheduled end balance of every loan of the file. Read from the loan records of the newest file, because the payment status list has no foreclosure value.",
      };
    case "status_current":
    case "status_late":
    case "status_due30":
    case "status_matured_performing":
    case "status_matured_nonperforming":
    case "status_unstated": {
      const g = group(key.slice("status_".length));
      return {
        label: g.label,
        unit: unitShare,
        kind: "derived",
        what: `Scheduled end balance of the loans in this payment status group, divided by the scheduled end balance of all loans in the file. ${g.what} The payment status list has no foreclosure and no bank-owned value: those states show per loan in the workout strategy.`,
      };
    }
    case "months":
      return {
        label: "Periods stored",
        unit: "count of filings",
        kind: "derived",
        what: "Current filings of the deal that are not offering-stage, one per reporting period. It is what this store holds, not the age of the deal: loading continues and older months may still be waiting.",
      };
  }
}

/** A definition by key: a stored figure's own, or a derived one. */
export function definitionOf(key: string, family: AbsFamily): Definition | null {
  if (isMetric(key)) return metricDefinition(key);
  if (
    [
      "due30",
      "due60",
      "due60_change",
      "status_current",
      "status_late",
      "status_due30",
      "status_matured_performing",
      "status_matured_nonperforming",
      "status_unstated",
      "status_due30_change",
      "foreclosure",
      "months",
    ].includes(key)
  )
    return derivedDefinition(key as DerivedKey, family);
  return null;
}

/** The figures a family's page shows, in the order of the definitions list. */
export const DEFINITION_KEYS: Record<AbsFamily, string[]> = {
  auto_loan: [
    "records",
    "end_balance",
    "begin_balance",
    "original_balance",
    "due30",
    "due60",
    "due60_change",
    "charge_offs",
    "recoveries",
    "wa_credit_score",
    "wa_original_rate",
    "wa_original_term",
    "wa_remaining_term",
    "payment_to_income",
    "payment_to_income_over_one",
    "months",
  ],
  auto_lease: [
    "records",
    "end_securitization_value",
    "begin_securitization_value",
    "acquisition_cost",
    "end_actual_balance",
    "base_residual_active",
    "contract_residual_active",
    "due30",
    "due60",
    "due60_change",
    "charge_offs",
    "wa_credit_score",
    "wa_original_term",
    "wa_remaining_term",
    "payment_to_income",
    "payment_to_income_over_one",
    "months",
  ],
  cmbs: [
    "records",
    "loans",
    "property_records",
    "properties",
    "sched_end_balance",
    "actual_end_balance",
    "begin_balance",
    "securitization_balance",
    "original_balance",
    "status_current",
    "status_late",
    "status_due30",
    "status_matured_performing",
    "status_matured_nonperforming",
    "status_unstated",
    "status_due30_change",
    "foreclosure",
    "wa_period_rate",
    "months",
  ],
};
