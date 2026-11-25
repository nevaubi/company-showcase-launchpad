// Auto loan and auto lease asset files: pool figures computed in one pass, record by record.
//
// These files are not stored row by row. One deal's monthly file holds 20,000 to 120,000 records and
// 30 to 220 MB; every month of every deal would be more than a terabyte. What is stored is the pool:
// totals, weighted averages and breakdowns of one file, each with how many records it rests on, and the
// file itself stays on EDGAR under the recorded address, size and SHA-256.
//
// Values are read as written. A filer omits an element instead of leaving it empty, so "missing" is
// counted, never treated as zero. Scales are not harmonised: some filers write payment-to-income as
// 0.0873 and others as 8.73, and a file written in fractions can still hold a few values above 100, so
// that field is reported as quantiles and a count above one, not as an average. Definitions: metrics.ts.
import { monthFirstDate } from "./cmbs";
import { add, dec, div, fmt, mul, ZERO, type Dec } from "./decimal";
import { BLANK, metricRow, type MetricKey, type MetricRow } from "./metrics";
import type { AbsRecord } from "./xml";

export type AutoFamily = "auto_loan" | "auto_lease";

/** The element each figure reads. The two schemas name the same thing differently. */
export const AUTO_FIELDS = {
  auto_loan: {
    periodEnd: "reportingPeriodEndingDate",
    original: "originalLoanAmount",
    begin: "reportingPeriodBeginningLoanBalanceAmount",
    end: "reportingPeriodActualEndBalanceAmount",
    rate: "originalInterestRatePercentage",
    score: "obligorCreditScore",
    state: "obligorGeographicLocation",
    originalTerm: "originalLoanTerm",
    remainingTerm: "remainingTermToMaturityNumber",
    chargeOff: "chargedoffPrincipalAmount",
    recovered: "recoveredAmount",
  },
  auto_lease: {
    periodEnd: "reportingPeriodEndDate",
    original: "acquisitionCost",
    begin: "reportingPeriodSecuritizationValueAmount",
    end: "reportingPeriodEndActualSecuritizationAmount",
    rate: null,
    score: "lesseeCreditScore",
    state: "lesseeGeographicLocation",
    originalTerm: "originalLeaseTermNumber",
    remainingTerm: "remainingTermNumber",
    chargeOff: "chargedOffAmount",
    recovered: null,
  },
} as const;

/** The metric each family's totals are stored under. */
const KEYS = {
  auto_loan: { original: "original_balance", begin: "begin_balance", end: "end_balance" },
  auto_lease: {
    original: "acquisition_cost",
    begin: "begin_securitization_value",
    end: "end_securitization_value",
  },
} as const satisfies Record<AutoFamily, Record<"original" | "begin" | "end", MetricKey>>;

/** A credit score counts only inside this range; outside it the value is a placeholder or another kind of score. */
export const SCORE_MIN = 300;
export const SCORE_MAX = 900;

export const scoreBand = (text: string | undefined): string => {
  if (text == null) return BLANK;
  const t = text.trim();
  const n = /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  if (!(n >= SCORE_MIN && n <= SCORE_MAX)) return "no valid score";
  return n < 620 ? "under 620" : n < 660 ? "620 to 659" : n < 720 ? "660 to 719" : "720 and over";
};

/** Days past due as the file states them, in the usual buckets. */
export const delinquencyBucket = (text: string | undefined): string => {
  if (text == null) return BLANK;
  const t = text.trim();
  if (!/^\d+$/.test(t)) return "unreadable";
  const d = Number(t);
  return d === 0
    ? "current"
    : d < 30
      ? "1 to 29 days"
      : d < 60
        ? "30 to 59 days"
        : d < 90
          ? "60 to 89 days"
          : d < 120
            ? "90 to 119 days"
            : "120 days or more";
};

type Sum = { total: Dec; n: number };
const sum = (): Sum => ({ total: ZERO, n: 0 });
const put = (s: Sum, v: Dec) => {
  s.total = add(s.total, v);
  s.n++;
};
/** A weighted mean in the making: the weight and the weighted sum over the records that state both. */
type Mean = { weight: Dec; weighted: Dec; n: number };
const mean = (): Mean => ({ weight: ZERO, weighted: ZERO, n: 0 });

/** The value at the p-th percentile by nearest rank: always a value the file states, never an interpolation. */
export function quantile(sorted: readonly string[], p: number): string | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/**
 * Takes the records of an auto loan or auto lease file one at a time and keeps only running figures,
 * so memory does not grow with the file (except the payment-to-income values, a few megabytes).
 */
export function autoCollector(family: AutoFamily) {
  const F = AUTO_FIELDS[family];
  const K = KEYS[family];
  let records = 0;
  const totals = {
    original: sum(),
    begin: sum(),
    end: sum(),
    chargeOff: sum(),
    recovered: sum(),
    balance: sum(),
    baseResidual: sum(),
    contractResidual: sum(),
  };
  const means = { rate: mean(), score: mean(), originalTerm: mean(), remainingTerm: mean() };
  /** dim -> bucket -> records and end amount */
  const splits = new Map<string, Map<string, { records: number; end: Sum }>>();
  const pti: string[] = [];
  let ptiOverOne = 0;
  let positive = 0;

  const split = (dim: string, bucket: string, end: Dec | null) => {
    const d = splits.get(dim) ?? new Map<string, { records: number; end: Sum }>();
    splits.set(dim, d);
    const b = d.get(bucket) ?? { records: 0, end: sum() };
    d.set(bucket, b);
    b.records++;
    if (end) put(b.end, end);
  };
  const weigh = (m: Mean, value: Dec | null, weight: Dec | null) => {
    if (!value || !weight || weight.v <= 0n) return;
    m.weight = add(m.weight, weight);
    m.weighted = add(m.weighted, mul(value, weight));
    m.n++;
  };

  return {
    family,
    add(record: AbsRecord) {
      records++;
      // the first value of each field; a repeated field (subvented, modificationTypeCode) is not read here
      const f: Record<string, string> = {};
      for (const [name, text] of record.fields) if (!(name in f)) f[name] = text;
      const num = (name: string | null) =>
        name == null || f[name] == null ? null : dec(f[name].trim());
      const end = num(F.end);
      const original = num(F.original);
      const begin = num(F.begin);
      if (original) put(totals.original, original);
      if (begin) put(totals.begin, begin);
      if (end) {
        put(totals.end, end);
        if (end.v > 0n) positive++;
      }
      const chargeOff = num(F.chargeOff);
      if (chargeOff) put(totals.chargeOff, chargeOff);
      const recovered = num(F.recovered);
      if (recovered) put(totals.recovered, recovered);
      if (family === "auto_lease") {
        const balance = num("reportingPeriodEndingActualBalanceAmount");
        if (balance) put(totals.balance, balance);
        // residual value of the leases still in the pool: those with a securitization value above zero
        if (end && end.v > 0n) {
          const base = num("baseResidualValue");
          if (base) put(totals.baseResidual, base);
          const contract = num("contractResidualValue");
          if (contract) put(totals.contractResidual, contract);
        }
      }
      weigh(means.rate, num(F.rate), end);
      weigh(means.originalTerm, num(F.originalTerm), end);
      weigh(means.remainingTerm, num(F.remainingTerm), end);
      const band = scoreBand(f[F.score]);
      if (band !== BLANK && band !== "no valid score")
        weigh(means.score, dec(f[F.score].trim()), end);

      const period = f[F.periodEnd];
      split(
        "period_end",
        period == null
          ? BLANK
          : (monthFirstDate(period.trim()) ?? `as written: ${period.trim().slice(0, 20)}`),
        end,
      );
      split("delinquency", delinquencyBucket(f.currentDelinquencyStatus), end);
      split("score_band", band, end);
      split("new_used", f.vehicleNewUsedCode?.trim() || BLANK, end);
      split("state", f[F.state]?.trim().toUpperCase() || BLANK, end);
      split("make", f.vehicleManufacturerName?.trim().toUpperCase() || BLANK, end);
      split("zero_balance_code", f.zeroBalanceCode?.trim() || BLANK, end);

      const p = f.paymentToIncomePercentage?.trim();
      if (p != null && dec(p)) {
        pti.push(p);
        if (Number(p) > 1) ptiOverOne++;
      }
    },

    /** The figures of the file read so far. */
    metrics(): MetricRow[] {
      const rows: MetricRow[] = [metricRow("records", String(records), records)];
      const total = (metric: MetricKey, s: Sum, of = records) =>
        rows.push(metricRow(metric, s.n ? fmt(s.total) : null, s.n, of - s.n));
      total(K.original, totals.original);
      total(K.begin, totals.begin);
      total(K.end, totals.end);
      total("charge_offs", totals.chargeOff);
      if (family === "auto_loan") total("recoveries", totals.recovered);
      else {
        total("end_actual_balance", totals.balance);
        total("base_residual_active", totals.baseResidual, positive);
        total("contract_residual_active", totals.contractResidual, positive);
      }
      const average = (metric: MetricKey, m: Mean, places: number) => {
        const v = m.n ? div(m.weighted, m.weight, places) : null;
        rows.push(metricRow(metric, v ? fmt(v) : null, m.n, positive - m.n));
      };
      if (family === "auto_loan") average("wa_original_rate", means.rate, 10);
      average("wa_credit_score", means.score, 4);
      average("wa_original_term", means.originalTerm, 4);
      average("wa_remaining_term", means.remainingTerm, 4);

      const sorted = [...pti].sort((a, b) => Number(a) - Number(b));
      for (const [bucket, p] of [
        ["p25", 0.25],
        ["p50", 0.5],
        ["p75", 0.75],
        ["p99", 0.99],
        ["max", 1],
      ] as const)
        rows.push(
          metricRow(
            "payment_to_income",
            quantile(sorted, p),
            sorted.length,
            records - sorted.length,
            "quantile",
            bucket,
          ),
        );
      rows.push(
        metricRow(
          "payment_to_income_over_one",
          String(ptiOverOne),
          sorted.length,
          records - sorted.length,
        ),
      );

      for (const [dim, buckets] of [...splits].sort(([a], [b]) => (a < b ? -1 : 1)))
        for (const [bucket, b] of [...buckets].sort(([a], [x]) => (a < x ? -1 : a > x ? 1 : 0))) {
          rows.push(metricRow("records", String(b.records), b.records, 0, dim, bucket));
          if (dim !== "period_end")
            rows.push(
              metricRow(
                K.end,
                b.end.n ? fmt(b.end.total) : null,
                b.end.n,
                b.records - b.end.n,
                dim,
                bucket,
              ),
            );
        }
      return rows;
    },
  };
}
