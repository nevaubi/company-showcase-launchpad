// What the "Securitized credit" view reads and the payloads its server functions return. The server
// reads the abs_* tables and *_live views with the member's own client (row security in force) in a
// few bounded selects; `assemble.ts` turns the rows into these payloads. A stored figure travels as
// its text, with the number of records behind it and the number left out, and never loses its filing.

export type AbsFamily = "auto_loan" | "auto_lease" | "cmbs";

/** A stored figure of one filing: [value as stored, n, n_missing]. A value the file does not state is null. */
export type Stored = [value: string | null, n: number, missing: number];

/** A row of `abs_pool_metrics`: [metric, dim, bucket, value, n, n_missing]. */
export type FigureRow = [
  metric: string,
  dim: string,
  bucket: string,
  value: string | null,
  n: number,
  missing: number,
];

/* ---------- rows as the selects return them ---------- */

export type DealRaw = {
  deal_id: string;
  issuer_cik: number | null;
  issuer_name: string;
  file_number: string | null;
  family: string;
  depositor_cik: number | null;
  sponsor_cik: number | null;
  updated_at?: string | null;
};

/** A loaded filing (`abs_filings`, status 'loaded'). */
export type FilingRaw = {
  accession: string;
  deal_id: string;
  list_cik: number;
  form: string;
  filed: string;
  accepted_at: string | null;
  period_start: string | null;
  period_end: string | null;
  is_current: boolean;
  superseded_by: string | null;
  load_id: number | null;
};

export type DocumentRaw = {
  seq: number;
  name: string;
  url: string;
  bytes: number | null;
  sha256: string | null;
  records: number | null;
  retrieved_at: string | null;
};

/** A filing of one deal with what the deal page shows of it, its asset file embedded. */
export type DealFilingRaw = FilingRaw & {
  asset_class: string | null;
  issuer_name: string | null;
  depositor_cik: number | null;
  sponsor_cik: number | null;
  file_number: string | null;
  status: string;
  loaded_at: string | null;
  abs_documents: DocumentRaw[] | null;
};

/** A row of `abs_pool_metrics_live`, value as text. */
export type MetricRaw = {
  load_id: number;
  metric: string;
  dim: string;
  bucket: string;
  value: string | null;
  n: number;
  n_missing: number;
};

export type NotStoredRaw = {
  accession: string;
  list_cik: number;
  form: string;
  filed: string;
  status: string;
  status_detail: string | null;
};

/* ---------- payloads ---------- */

/** The dated facts of one filing that decide its stage and its place in a series. */
export type FilingFacts = {
  accession: string;
  list_cik: number;
  form: string;
  filed: string;
  accepted_at: string | null;
  cover_start: string | null;
  cover_end: string | null;
  /** latest period end the records state (the records' own clock) */
  records_end: string | null;
  /** how many period ends the records state */
  period_ends: number | null;
  /** false when the records' period was not read (a read limit applied): the stage then rests on the cover period alone */
  records_read: boolean;
  records_after_filing: boolean;
  cover_after_filing: boolean;
};

/** One point of a deal's trend: [period end the records state, accession, end amount, {bucket: amount}]. */
export type TrendPoint = [
  recordsEnd: string | null,
  accession: string,
  end: string | null,
  split: Record<string, string | null>,
];

export type MonitorLatest = FilingFacts & {
  totals: Record<string, Stored>;
  /** the end amount by status bucket (days past due, or payment status code) */
  split: Record<string, Stored>;
};

export type MonitorOffering = FilingFacts & { totals: Record<string, Stored> };

export type DealFiles = {
  loaded: number;
  current: number;
  offering: number;
  /** current filings that are not offering-stage */
  monthly: number;
  monthly_periods: number;
  /** amendments alone in their cover period (the abs_review() condition) */
  review: number;
  first_period: string | null;
  first_filed: string | null;
  last_filed: string | null;
};

export type MonitorDeal = {
  deal_id: string;
  issuer_cik: number | null;
  issuer_name: string;
  file_number: string | null;
  depositor_cik: number | null;
  sponsor_cik: number | null;
  files: DealFiles;
  latest: MonitorLatest | null;
  trend: TrendPoint[];
  offering: MonitorOffering | null;
};

export type CoverageFamily = {
  family: AbsFamily;
  deals: number;
  /** loaded filings, or null when the count could not be read */
  filings: number | null;
};

export type Coverage = {
  families: CoverageFamily[];
  /** filings listed on EDGAR that wait to be read, set aside, or failed (any family: a waiting filing has no deal yet) */
  listed: number | null;
  skipped: number | null;
  failed: number | null;
  /** when the newest stored filing was loaded */
  newest_loaded_at: string | null;
};

/** Where a read stopped short of everything stored. Every count is zero or false when nothing was cut. */
export type ReadLimits = {
  /** loaded filings of the family (or deal) that were read */
  filings_read: number;
  /** loaded filings stored, when known */
  filings_total: number | null;
  /** current filings whose records' period was not read: their stage rests on the cover period */
  stage_unread: number;
  /** the trend holds fewer periods than its cap because of the row budget */
  trend_cut: boolean;
};

export type MonitorPayload = {
  family: AbsFamily;
  /** the trend holds at most this many periods per deal */
  periods_cap: number;
  coverage: Coverage;
  limits: ReadLimits;
  deals: MonitorDeal[];
};

export type DealFiling = FilingFacts & {
  is_current: boolean;
  superseded_by: string | null;
  alone_amendment: boolean;
  loaded_at: string | null;
  asset_class: string | null;
  issuer_name: string | null;
  depositor_cik: number | null;
  sponsor_cik: number | null;
  file_number: string | null;
  file: {
    name: string;
    url: string;
    bytes: number | null;
    sha256: string | null;
    records: number | null;
    retrieved_at: string | null;
  } | null;
  /** null for a filing that is not current: only current filings feed figures */
  figures: FigureRow[] | null;
};

/** A loan or property-only record of a commercial mortgage file, columns of `abs_cmbs_assets`. */
export type CmbsLoan = {
  rec: number;
  kind: "loan" | "property" | "other";
  asset_number: string;
  period_begin: string | null;
  period_end: string | null;
  original_loan_amount: number | null;
  maturity_date: string | null;
  properties: number | null;
  interest_only: boolean | null;
  sched_end_balance: number | null;
  actual_end_balance: number | null;
  period_rate: number | null;
  paid_through_date: string | null;
  payment_status_code: string | null;
  modified: boolean | null;
  realized_loss: number | null;
  liquidation_prepayment_code: string | null;
  liquidation_prepayment_date: string | null;
  workout_strategy_code: string | null;
  special_servicer_transfer_date: string | null;
  master_servicer_return_date: string | null;
};

/** A property block, columns of `abs_cmbs_properties`. */
export type CmbsProperty = {
  rec: number;
  seq: number;
  asset_number: string;
  loan_asset_number: string;
  link: "nested" | "number" | "none";
  name: string | null;
  city: string | null;
  state: string | null;
  type_code: string | null;
  status_code: string | null;
  occupancy_securitization: number | null;
  occupancy_recent: number | null;
  financials_recent_end: string | null;
  dscr_ncf_securitization: number | null;
  dscr_ncf_recent: number | null;
  dscr_noi_securitization: number | null;
  dscr_noi_recent: number | null;
};

export type DealPayload = {
  deal: {
    deal_id: string;
    issuer_cik: number | null;
    issuer_name: string;
    file_number: string | null;
    family: AbsFamily | "other";
    depositor_cik: number | null;
    sponsor_cik: number | null;
    updated_at: string | null;
  };
  /** every loaded filing of the deal, newest filing first */
  filings: DealFiling[];
  /** filings EDGAR lists under the trust's own CIK that are not read yet */
  waiting: number | null;
  /** filings under the trust's own CIK that were set aside or failed */
  not_stored: NotStoredRaw[];
  /** the filing whose breakdowns or loans are given */
  shown: { accession: string; offering: boolean; records_end: string | null } | null;
  breakdowns: FigureRow[];
  loans: CmbsLoan[];
  properties: CmbsProperty[];
  limits: ReadLimits;
};

/** A derived share: numerator over denominator, both stored figures of one filing. */
export type Share = {
  /** numerator ÷ denominator, or null when the denominator is missing or not above zero */
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  /** the buckets added into the numerator, as stored */
  buckets: string[];
  accession: string;
};
