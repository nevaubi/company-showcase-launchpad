// The figures computed from one asset data file, each with its definition. A stored row of
// `abs_pool_metrics` names its definition here through `metric`; `abs_loads.parser` names the version
// of this file and of the readers that produced it. Change a definition and PARSER changes with it, so
// a figure can always be traced to the rule that made it.

/**
 * Version of the readers and of the definitions below. Bump on any change to what gets stored.
 * abs-1: commercial mortgage files, record by record. abs-2: auto loan and auto lease files as pool
 * figures (auto.ts); what a commercial mortgage file stores is unchanged from abs-1.
 */
export const PARSER = "abs-2";

export type MetricUnit = "usd" | "count" | "fraction" | "ratio" | "months" | "score" | "as_filed";

export type MetricDef = {
  unit: MetricUnit;
  families: ("cmbs" | "auto_loan" | "auto_lease")[];
  /** what is counted or summed, over which records, with which weight */
  what: string;
};

/**
 * Pool figures. Breakdowns reuse the same keys with a `dim` (what the pool is split by) and a `bucket`
 * (the value of that split as filed, outer spaces removed and codes upper-cased; a field the record does
 * not state is the bucket "(blank)"). Auto breakdowns: period_end, delinquency, score_band, new_used, state,
 * make, zero_balance_code. Commercial mortgage breakdowns: payment_status, period_end.
 * `n` is the number of records that contributed and `n_missing` the number left out because the field
 * the figure needs is blank or unreadable: a figure never hides how much of the pool it covers.
 */
export const METRICS = {
  records: {
    unit: "count",
    families: ["cmbs", "auto_loan", "auto_lease"],
    what: "Records in the file (one <assets> element each).",
  },
  loans: {
    unit: "count",
    families: ["cmbs"],
    what: "Records that are loans: they carry loan terms, a balance or a payment status, and are not a property row of another loan.",
  },
  property_records: {
    unit: "count",
    families: ["cmbs"],
    what: "Records that carry only a property of a multi-property loan.",
  },
  properties: {
    unit: "count",
    families: ["cmbs"],
    what: "Property blocks in the file, nested in a loan record or in a record of their own.",
  },
  original_balance: {
    unit: "usd",
    families: ["cmbs", "auto_loan"],
    what: "Sum of originalLoanAmount: over loans (commercial mortgage), over all records of the file (auto loans). Not the deal's balance at closing: a file lists the records still reported.",
  },
  securitization_balance: {
    unit: "usd",
    families: ["cmbs"],
    what: "Sum of scheduledPrincipalBalanceSecuritizationAmount over loans.",
  },
  begin_balance: {
    unit: "usd",
    families: ["cmbs", "auto_loan"],
    what: "Balance at the start of the reporting period: reportPeriodBeginningScheduleLoanBalanceAmount over loans (commercial mortgage), reportingPeriodBeginningLoanBalanceAmount over all records (auto loans).",
  },
  sched_end_balance: {
    unit: "usd",
    families: ["cmbs"],
    what: "Sum of reportPeriodEndScheduledLoanBalanceAmount over loans.",
  },
  actual_end_balance: {
    unit: "usd",
    families: ["cmbs"],
    what: "Sum of reportPeriodEndActualBalanceAmount over loans.",
  },
  wa_period_rate: {
    unit: "as_filed",
    families: ["cmbs"],
    what: "reportPeriodInterestRatePercentage weighted by reportPeriodEndScheduledLoanBalanceAmount, over loans that state both with a balance above zero. Kept in the scale the file uses.",
  },
  end_balance: {
    unit: "usd",
    families: ["auto_loan"],
    what: "Sum of reportingPeriodActualEndBalanceAmount over all records, negative amounts included as filed.",
  },
  charge_offs: {
    unit: "usd",
    families: ["auto_loan", "auto_lease"],
    what: "Amounts charged off in the reporting period: sum of chargedoffPrincipalAmount (loans) or chargedOffAmount (leases), negative amounts included as filed. One period, not cumulative.",
  },
  recoveries: {
    unit: "usd",
    families: ["auto_loan"],
    what: "Sum of recoveredAmount in the reporting period, negative amounts included as filed.",
  },
  acquisition_cost: {
    unit: "usd",
    families: ["auto_lease"],
    what: "Sum of acquisitionCost over all records.",
  },
  begin_securitization_value: {
    unit: "usd",
    families: ["auto_lease"],
    what: "Sum of reportingPeriodSecuritizationValueAmount (start of the period) over all records.",
  },
  end_securitization_value: {
    unit: "usd",
    families: ["auto_lease"],
    what: "Sum of reportingPeriodEndActualSecuritizationAmount (end of the period) over all records.",
  },
  end_actual_balance: {
    unit: "usd",
    families: ["auto_lease"],
    what: "Sum of reportingPeriodEndingActualBalanceAmount over all records. Not the pool balance: some filers write undiscounted payments plus residual here.",
  },
  base_residual_active: {
    unit: "usd",
    families: ["auto_lease"],
    what: "Sum of baseResidualValue over leases with an end securitization value above zero; n_missing counts such leases without the field.",
  },
  contract_residual_active: {
    unit: "usd",
    families: ["auto_lease"],
    what: "Sum of contractResidualValue over leases with an end securitization value above zero.",
  },
  wa_original_rate: {
    unit: "as_filed",
    families: ["auto_loan"],
    what: "originalInterestRatePercentage weighted by the end balance, over records that state both with a balance above zero. Kept in the scale the file uses.",
  },
  wa_credit_score: {
    unit: "score",
    families: ["auto_loan", "auto_lease"],
    what: "Credit score weighted by the end balance (loans) or end securitization value (leases), over records with an amount above zero whose score is a number from 300 to 900. Scores outside that range are placeholders or another kind of score and are left out; n_missing counts the records with an amount above zero that were left out.",
  },
  wa_original_term: {
    unit: "months",
    families: ["auto_loan", "auto_lease"],
    what: "Original term in months weighted by the end amount, over records that state both with an amount above zero.",
  },
  wa_remaining_term: {
    unit: "months",
    families: ["auto_loan", "auto_lease"],
    what: "Remaining term in months weighted by the end amount, over records that state both with an amount above zero.",
  },
  payment_to_income: {
    unit: "as_filed",
    families: ["auto_loan", "auto_lease"],
    what: "paymentToIncomePercentage exactly as written, at the quantiles p25, p50, p75, p99 and max over the records that state a number (nearest rank, unweighted). Filers differ in scale (0.0873 against 8.73) and a fraction-scale file can hold a few values above 100, so no average is stored.",
  },
  payment_to_income_over_one: {
    unit: "count",
    families: ["auto_loan", "auto_lease"],
    what: "Records whose paymentToIncomePercentage as written is above 1: nearly all of them in a percent-point file, a handful of outliers in a fraction file.",
  },
} as const satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;

export type MetricRow = {
  metric: MetricKey;
  dim: string;
  bucket: string;
  value: string | null;
  unit: MetricUnit;
  n: number;
  n_missing: number;
};

export const BLANK = "(blank)";

export const metricRow = (
  metric: MetricKey,
  value: string | null,
  n: number,
  n_missing = 0,
  dim = "",
  bucket = "",
): MetricRow => ({
  metric,
  dim,
  bucket,
  value,
  unit: METRICS[metric].unit,
  n,
  n_missing,
});
