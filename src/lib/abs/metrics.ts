// The figures computed from one asset data file, each with its definition. A stored row of
// `abs_pool_metrics` names its definition here through `metric`; `abs_loads.parser` names the version
// of this file and of the readers that produced it. Change a definition and PARSER changes with it, so
// a figure can always be traced to the rule that made it.

/** Version of the readers and of the definitions below. Bump on any change to what gets stored. */
export const PARSER = "abs-1";

export type MetricUnit = "usd" | "count" | "fraction" | "ratio" | "months" | "score" | "as_filed";

export type MetricDef = {
  unit: MetricUnit;
  families: ("cmbs" | "auto_loan" | "auto_lease")[];
  /** what is counted or summed, over which records, with which weight */
  what: string;
};

/**
 * Pool figures. Breakdowns reuse the same keys with a `dim` (what the pool is split by) and a `bucket`
 * (the value of that split exactly as filed; a blank value is the bucket "(blank)").
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
    what: "Records that are loans: they carry loan terms, a balance or a payment status.",
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
    families: ["cmbs"],
    what: "Sum of originalLoanAmount over loans.",
  },
  securitization_balance: {
    unit: "usd",
    families: ["cmbs"],
    what: "Sum of scheduledPrincipalBalanceSecuritizationAmount over loans.",
  },
  begin_balance: {
    unit: "usd",
    families: ["cmbs"],
    what: "Sum of reportPeriodBeginningScheduleLoanBalanceAmount over loans.",
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
