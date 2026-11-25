// What the coded values of the asset files mean, and how the page groups them. The code lists are the
// ones in the SEC's ABS XML technical specification (labels as its schema annotations write them); the
// bucket names are the ones the readers store (`delinquencyBucket`, `scoreBand` in ../auto.ts). A value
// outside a list is shown as filed, never folded into a neighbour.
import type { AbsFamily } from "./types";

export const FAMILIES: readonly AbsFamily[] = ["auto_loan", "auto_lease", "cmbs"];

export const FAMILY_LABEL: Record<AbsFamily, string> = {
  auto_loan: "Auto loans",
  auto_lease: "Auto leases",
  cmbs: "Commercial mortgages",
};

/** One record of the family's asset file, singular and plural. */
export const FAMILY_ASSET: Record<AbsFamily, [string, string]> = {
  auto_loan: ["loan record", "loan records"],
  auto_lease: ["lease record", "lease records"],
  cmbs: ["loan", "loans"],
};

/** The stored figure each family's end amount is (metrics.ts), and the split of it by status. */
export const END_METRIC = {
  auto_loan: "end_balance",
  auto_lease: "end_securitization_value",
  cmbs: "sched_end_balance",
} as const satisfies Record<AbsFamily, string>;

export const END_LABEL: Record<AbsFamily, string> = {
  auto_loan: "End balance",
  auto_lease: "End securitization value",
  cmbs: "Scheduled end balance",
};

export const STATUS_DIM: Record<AbsFamily, string> = {
  auto_loan: "delinquency",
  auto_lease: "delinquency",
  cmbs: "payment_status",
};

/** The pool totals the monitor reads for each deal's filings (metrics.ts keys). */
export const TOTAL_METRICS: Record<AbsFamily, readonly string[]> = {
  auto_loan: ["records", "end_balance", "charge_offs", "recoveries", "wa_credit_score"],
  auto_lease: ["records", "end_securitization_value", "charge_offs", "wa_credit_score"],
  cmbs: ["records", "loans", "sched_end_balance", "wa_period_rate"],
};

export const BLANK = "(blank)";

/* ---------- auto: days past due ---------- */

/** Every bucket `delinquencyBucket` can store, in order of days past due; the last two state no day count. */
export const DELINQUENCY_BUCKETS = [
  "current",
  "1 to 29 days",
  "30 to 59 days",
  "60 to 89 days",
  "90 to 119 days",
  "120 days or more",
  BLANK,
  "unreadable",
] as const;

/** Buckets added into the share 30 or more days past due, and into the share 60 or more. */
export const DUE_30_PLUS = ["30 to 59 days", "60 to 89 days", "90 to 119 days", "120 days or more"];
export const DUE_60_PLUS = ["60 to 89 days", "90 to 119 days", "120 days or more"];
/** Buckets that state no day count: in the denominator of a share, in no numerator. */
export const DUE_UNSTATED = [BLANK, "unreadable"];

export const DELINQUENCY_LABEL: Record<string, string> = {
  current: "Current",
  "1 to 29 days": "1 to 29 days",
  "30 to 59 days": "30 to 59 days",
  "60 to 89 days": "60 to 89 days",
  "90 to 119 days": "90 to 119 days",
  "120 days or more": "120 days or more",
  [BLANK]: "No status stated",
  unreadable: "Status not a day count",
};

/* ---------- commercial mortgages: paymentStatusLoanCode ---------- */

export const PAYMENT_STATUS: Record<string, string> = {
  "0": "Current",
  A: "Payment not received but still in grace period or not yet due",
  B: "Late payment but less than 30 days delinquent",
  "1": "30-59 days delinquent",
  "2": "60-89 days delinquent",
  "3": "90+ days delinquent",
  "4": "Performing matured balloon",
  "5": "Non performing matured balloon",
};

/** Short form for a table cell. */
export const PAYMENT_STATUS_SHORT: Record<string, string> = {
  "0": "Current",
  A: "In grace",
  B: "Late under 30 days",
  "1": "30 to 59 days",
  "2": "60 to 89 days",
  "3": "90 days or more",
  "4": "Matured, performing",
  "5": "Matured, non-performing",
};

export type StatusGroup =
  | "current"
  | "late"
  | "due30"
  | "matured_performing"
  | "matured_nonperforming"
  | "unstated";

/**
 * The groups of the payment status list. The list stops at matured balloons: it has no foreclosure and
 * no bank-owned value, so those states are read per loan from the workout strategy and property status
 * codes and are in no group here. A performing matured balloon (4) and a non-performing one (5) are kept
 * apart: they mean opposite things for the pool.
 */
export const STATUS_GROUPS: { key: StatusGroup; label: string; codes: string[]; what: string }[] = [
  { key: "current", label: "Current", codes: ["0"], what: "Code 0, current." },
  {
    key: "late",
    label: "Grace or under 30 days",
    codes: ["A", "B"],
    what: "Codes A (payment not received but still in grace period or not yet due) and B (late payment but less than 30 days delinquent).",
  },
  {
    key: "due30",
    label: "30 days or more",
    codes: ["1", "2", "3"],
    what: "Codes 1 (30-59 days delinquent), 2 (60-89 days delinquent) and 3 (90+ days delinquent).",
  },
  {
    key: "matured_performing",
    label: "Matured, performing",
    codes: ["4"],
    what: "Code 4, performing matured balloon.",
  },
  {
    key: "matured_nonperforming",
    label: "Matured, non-performing",
    codes: ["5"],
    what: "Code 5, non performing matured balloon.",
  },
  {
    key: "unstated",
    label: "No status stated",
    codes: [BLANK],
    what: "Loans whose record states no payment status, and any code outside the list. A blank is not counted as current.",
  },
];

/** Workout strategies that put a loan in foreclosure or make its property bank-owned: 2, 7 and 10. */
export const FORECLOSURE_WORKOUT = ["2", "7", "10"];
/** Property status codes for a property in foreclosure (1) or bank-owned (2). */
export const FORECLOSURE_PROPERTY = ["1", "2"];

export function statusGroupOf(code: string): StatusGroup {
  for (const g of STATUS_GROUPS) if (g.key !== "unstated" && g.codes.includes(code)) return g.key;
  return "unstated";
}

/** How bad a payment status is, for sorting a loan table: larger is worse; a blank sorts after current. */
export function statusRank(code: string | null): number {
  const order = ["0", "A", "B", "4", "1", "2", "3", "5"];
  if (code == null) return -1;
  const i = order.indexOf(code);
  return i < 0 ? -1 : i;
}

export const WORKOUT_STRATEGY: Record<string, string> = {
  "1": "Modification",
  "2": "Foreclosure",
  "3": "Bankruptcy",
  "4": "Extension",
  "5": "Note sale",
  "6": "DPO",
  "7": "REO",
  "8": "Resolved",
  "9": "Pending return to master servicer",
  "10": "Deed-in-lieu of Foreclosure",
  "11": "Full Payoff",
  "12": "Reps and Warranties",
  "13": "TBD",
  "98": "Other",
};

export const PROPERTY_TYPE: Record<string, string> = {
  CH: "Cooperative housing",
  HC: "Health care",
  IN: "Industrial",
  LO: "Lodging",
  MF: "Multifamily",
  MH: "Mobile home park",
  MU: "Mixed use",
  OF: "Office",
  RT: "Retail",
  SE: "Securities",
  SS: "Self storage",
  WH: "Warehouse",
  ZZ: "Missing information",
  "98": "Other",
};

export const PROPERTY_STATUS: Record<string, string> = {
  "1": "In Foreclosure",
  "2": "REO",
  "3": "Defeased",
  "4": "Partial Release",
  "5": "Substituted",
  "6": "Same as at Securitization",
};

export const LIQUIDATION_PREPAYMENT: Record<string, string> = {
  "1": "Partial liquidation (curtailment)",
  "2": "Payoff prior to maturity",
  "3": "Disposition or liquidation",
  "4": "Repurchase or substitution",
  "5": "Full payoff at maturity",
  "6": "DPO",
  "7": "Liquidated",
  "8": "Payoff with penalty",
  "9": "Payoff with yield maintenance",
  "10": "Curtailment with penalty",
  "11": "Curtailment with yield maintenance",
};

/* ---------- auto: other coded values ---------- */

/** zeroBalanceCode. The same number means different things in the two schemas. */
export const ZERO_BALANCE: Record<"auto_loan" | "auto_lease", Record<string, string>> = {
  auto_loan: {
    "1": "Prepaid or matured",
    "2": "Third-party sale",
    "3": "Repurchased or replaced",
    "4": "Charged-off",
    "5": "Servicing transfer",
    "99": "Unavailable",
  },
  auto_lease: {
    "1": "Terminated",
    "2": "Repurchased or replaced",
    "3": "Charged-off",
    "4": "Servicing transfer",
    "99": "Unavailable",
  },
};

/** vehicleNewUsedCode. */
export const NEW_USED: Record<string, string> = { "1": "New", "2": "Used" };

/** Score bands as `scoreBand` stores them, lowest first; the last two hold no score in the counted range. */
export const SCORE_BANDS = [
  "under 620",
  "620 to 659",
  "660 to 719",
  "720 and over",
  "no valid score",
  BLANK,
] as const;

export const SCORE_BAND_LABEL: Record<string, string> = {
  "under 620": "Under 620",
  "620 to 659": "620 to 659",
  "660 to 719": "660 to 719",
  "720 and over": "720 and over",
  "no valid score": "No score from 300 to 900",
  [BLANK]: "No score stated",
};

/** The label of a bucket of one breakdown, or the bucket as filed when the list does not know it. */
export function bucketLabel(family: AbsFamily, dim: string, bucket: string): string {
  if (bucket === BLANK && dim !== "score_band" && dim !== "delinquency") return "Not stated";
  if (dim === "delinquency") return DELINQUENCY_LABEL[bucket] ?? bucket;
  if (dim === "score_band") return SCORE_BAND_LABEL[bucket] ?? bucket;
  if (dim === "new_used") return NEW_USED[bucket] ?? `Code ${bucket}`;
  if (dim === "zero_balance_code" && family !== "cmbs")
    return ZERO_BALANCE[family][bucket] ?? `Code ${bucket}`;
  if (dim === "payment_status") return PAYMENT_STATUS_SHORT[bucket] ?? `Code ${bucket}`;
  return bucket;
}
