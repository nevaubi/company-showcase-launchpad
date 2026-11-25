// One deal, from the payload of `abs_deal`. Pure. Only current filings feed figures; a filing marked
// offering-stage stays out of every series; superseded filings are listed and point at what replaced
// them; an amendment the store could not tie to the filing it replaces carries a note.
import { indexUrl } from "../edgar";
import { safeSourceHref } from "@/lib/sources/presentation";
import {
  BLANK,
  DELINQUENCY_BUCKETS,
  DUE_30_PLUS,
  DUE_60_PLUS,
  END_METRIC,
  FORECLOSURE_PROPERTY,
  FORECLOSURE_WORKOUT,
  SCORE_BANDS,
  STATUS_DIM,
  bucketLabel,
  statusRank,
} from "./codes";
import { byMetric, num, shareOf, splitOf, unstatedOf, type Figure } from "./figures";
import { groupShares, type GroupShare } from "./monitor";
import { stageOf, type Stage } from "./stage";
import type { ReadLimits } from "./types";
import type {
  AbsFamily,
  CmbsLoan,
  CmbsProperty,
  DealFiling,
  DealPayload,
  FigureRow,
  Share,
} from "./types";

/* ---------- filings ---------- */

export type FilingRow = {
  accession: string;
  cik: number;
  form: string;
  filed: string;
  acceptedAt: string | null;
  coverStart: string | null;
  coverEnd: string | null;
  recordsEnd: string | null;
  /** the records state more than one period end */
  mixedPeriods: boolean;
  stage: Stage;
  state: "current" | "superseded";
  /** the filing the store keeps as current for the same cover period, with what is known of it */
  replacedBy: { accession: string; form: string | null; filed: string | null; amendment: boolean } | null;
  /** an amendment that shares its cover period with no other filing: what it replaces is not tied to it */
  aloneAmendment: boolean;
  records: number | null;
  bytes: number | null;
  sha256: string | null;
  fileName: string | null;
  fileUrl: string | null;
  indexUrl: string;
};

export function filingRows(filings: readonly DealFiling[]): FilingRow[] {
  const byAccession = new Map(filings.map((f) => [f.accession, f]));
  return filings.map((f) => {
    const by = f.superseded_by ? byAccession.get(f.superseded_by) : undefined;
    return {
      accession: f.accession,
      cik: f.list_cik,
      form: f.form,
      filed: f.filed,
      acceptedAt: f.accepted_at,
      coverStart: f.cover_start,
      coverEnd: f.cover_end,
      recordsEnd: f.records_end,
      mixedPeriods: (f.period_ends ?? 1) > 1,
      stage: stageOf(f),
      state: f.is_current ? "current" : "superseded",
      replacedBy: f.superseded_by
        ? {
            accession: f.superseded_by,
            form: by?.form ?? null,
            filed: by?.filed ?? null,
            amendment: by?.form === "ABS-EE/A",
          }
        : null,
      aloneAmendment: f.alone_amendment,
      records: f.file?.records ?? null,
      bytes: f.file?.bytes ?? null,
      sha256: f.file?.sha256 ?? null,
      fileName: f.file?.name ?? null,
      // a stored address is a link only when it is an http(s) address, as every source link is (review int-code N7)
      fileUrl: safeSourceHref(f.file?.url),
      indexUrl: indexUrl(f.list_cik, f.accession),
    };
  });
}

/** What the store knows about a filing that is not current, in words that claim no more. */
export function replacedNote(r: FilingRow): string {
  if (!r.replacedBy) return "";
  const by = r.replacedBy;
  const when = by.filed ? `, filed ${by.filed}` : "";
  return by.amendment
    ? `Replaced by the amendment ${by.accession} (ABS-EE/A${when}) for the same cover period.`
    : `Another filing of this deal for the same cover period was accepted later: ${by.accession} (${by.form ?? "ABS-EE"}${when}). The store keeps the one SEC accepted last as current; a filer can also file alternative pools for one period on one day.`;
}

export const REVIEW_NOTE =
  "This amendment shares its cover period with no other stored filing of the deal, so the filing it replaces is not tied to it and still shows as current for the period it was filed under. Which filing an amendment replaces is stated only on its cover page, which is not read. Read this deal's series across these filings with that in mind.";

/* ---------- series ---------- */

export type AutoPoint = {
  recordsEnd: string | null;
  accession: string;
  cik: number;
  filed: string;
  records: Figure | null;
  end: Figure | null;
  begin: Figure | null;
  chargeOffs: Figure | null;
  recoveries: Figure | null;
  score: Figure | null;
  rate: Figure | null;
  originalTerm: Figure | null;
  remainingTerm: Figure | null;
  /** end amount by days past due, every bucket the file holds */
  split: Record<string, Figure>;
  due30: Share;
  due60: Share;
  unstated: { amount: number; share: number | null };
  /** payment-to-income quantiles as written by the filer: p25, p50, p75, p99, max */
  pti: Record<string, Figure>;
  ptiOverOne: Figure | null;
  /** lease-only stored figures */
  acquisitionCost: Figure | null;
  baseResidual: Figure | null;
  contractResidual: Figure | null;
  endActualBalance: Figure | null;
  originalBalance: Figure | null;
};

export type CmbsPoint = {
  recordsEnd: string | null;
  accession: string;
  cik: number;
  filed: string;
  records: Figure | null;
  loans: Figure | null;
  propertyRecords: Figure | null;
  end: Figure | null;
  actualEnd: Figure | null;
  begin: Figure | null;
  securitization: Figure | null;
  original: Figure | null;
  rate: Figure | null;
  groups: GroupShare[];
  /** scheduled end balance by payment status code as filed */
  split: Record<string, Figure>;
};

function autoPoint(family: "auto_loan" | "auto_lease", f: DealFiling): AutoPoint {
  const rows = f.figures ?? [];
  const t = byMetric(rows);
  const endKey = END_METRIC[family];
  const split = splitOf(rows, endKey, "delinquency");
  const end = t[endKey] ?? null;
  return {
    recordsEnd: f.records_end,
    accession: f.accession,
    cik: f.list_cik,
    filed: f.filed,
    records: t.records ?? null,
    end,
    begin: t[family === "auto_loan" ? "begin_balance" : "begin_securitization_value"] ?? null,
    chargeOffs: t.charge_offs ?? null,
    recoveries: t.recoveries ?? null,
    score: t.wa_credit_score ?? null,
    rate: t.wa_original_rate ?? null,
    originalTerm: t.wa_original_term ?? null,
    remainingTerm: t.wa_remaining_term ?? null,
    split,
    due30: shareOf(split, end?.text, DUE_30_PLUS, f.accession),
    due60: shareOf(split, end?.text, DUE_60_PLUS, f.accession),
    unstated: unstatedOf(split, end?.text),
    pti: splitOf(rows, "payment_to_income", "quantile"),
    ptiOverOne: t.payment_to_income_over_one ?? null,
    acquisitionCost: t.acquisition_cost ?? null,
    baseResidual: t.base_residual_active ?? null,
    contractResidual: t.contract_residual_active ?? null,
    endActualBalance: t.end_actual_balance ?? null,
    originalBalance: t.original_balance ?? null,
  };
}

function cmbsPoint(f: DealFiling): CmbsPoint {
  const rows = f.figures ?? [];
  const t = byMetric(rows);
  const split = splitOf(rows, "sched_end_balance", "payment_status");
  const stored: Record<string, [string | null, number, number]> = {};
  for (const [k, v] of Object.entries(split)) stored[k] = [v.text, v.n, v.missing];
  return {
    recordsEnd: f.records_end,
    accession: f.accession,
    cik: f.list_cik,
    filed: f.filed,
    records: t.records ?? null,
    loans: t.loans ?? null,
    propertyRecords: t.property_records ?? null,
    end: t.sched_end_balance ?? null,
    actualEnd: t.actual_end_balance ?? null,
    begin: t.begin_balance ?? null,
    securitization: t.securitization_balance ?? null,
    original: t.original_balance ?? null,
    rate: t.wa_period_rate ?? null,
    groups: groupShares(stored, t.sched_end_balance?.text, f.accession),
    split,
  };
}

const byPeriod = <T extends { recordsEnd: string | null; accession: string }>(a: T, b: T) =>
  (a.recordsEnd ?? "") < (b.recordsEnd ?? "")
    ? -1
    : (a.recordsEnd ?? "") > (b.recordsEnd ?? "")
      ? 1
      : a.accession < b.accession
        ? -1
        : 1;

/* ---------- breakdowns ---------- */

export type BreakdownItem = {
  bucket: string;
  label: string;
  /** end amount in the bucket */
  amount: number | null;
  /** share of the end amount of the whole file */
  share: number | null;
  /** records in the bucket */
  records: number | null;
};

export type Breakdown = {
  dim: string;
  /** every bucket the file holds, largest end amount first (ordered dims keep their order) */
  items: BreakdownItem[];
  /** end amount of the whole file: the denominator of every share */
  total: number | null;
};

const ORDERED: Record<string, readonly string[]> = {
  score_band: SCORE_BANDS,
  delinquency: DELINQUENCY_BUCKETS,
};

export function breakdownOf(
  family: AbsFamily,
  rows: readonly FigureRow[],
  dim: string,
  total: number | null,
): Breakdown {
  const amounts = splitOf(rows, END_METRIC[family], dim);
  const records = splitOf(rows, "records", dim);
  const buckets = [...new Set([...Object.keys(amounts), ...Object.keys(records)])];
  const items = buckets.map((bucket) => {
    const amount = amounts[bucket]?.value ?? null;
    return {
      bucket,
      label: bucketLabel(family, dim, bucket),
      amount,
      share: amount != null && total != null && total > 0 ? amount / total : null,
      records: records[bucket]?.value ?? null,
    };
  });
  const order = ORDERED[dim];
  items.sort((a, b) =>
    order
      ? (order.indexOf(a.bucket) + 1 || 99) - (order.indexOf(b.bucket) + 1 || 99)
      : (b.amount ?? -Infinity) - (a.amount ?? -Infinity) || a.bucket.localeCompare(b.bucket),
  );
  return { dim, items, total };
}

/** The first `keep` items and, when more exist, one "All other" item that adds the rest of the same file. */
export function topItems(b: Breakdown, keep: number): { items: BreakdownItem[]; folded: number } {
  if (b.items.length <= keep) return { items: b.items, folded: 0 };
  const head = b.items.slice(0, keep);
  const rest = b.items.slice(keep);
  const amount = rest.reduce((s, x) => s + (x.amount ?? 0), 0);
  const records = rest.reduce((s, x) => s + (x.records ?? 0), 0);
  return {
    items: [
      ...head,
      {
        bucket: "",
        label: `All other (${rest.length})`,
        amount,
        share: b.total != null && b.total > 0 ? amount / b.total : null,
        records,
      },
    ],
    folded: rest.length,
  };
}

/* ---------- commercial mortgage loans ---------- */

export type PropertyRow = {
  key: string;
  /** the record's own number for a property-only record; the loan's for a nested block */
  number: string;
  name: string | null;
  city: string | null;
  state: string | null;
  typeCode: string | null;
  statusCode: string | null;
  /** debt service coverage on net cash flow, as filed: most recent and at securitization */
  dscrRecent: number | null;
  dscrSecuritization: number | null;
  /** the same on net operating income, as filed */
  dscrNoiRecent: number | null;
  dscrNoiSecuritization: number | null;
  occupancySecuritization: number | null;
  occupancyRecent: number | null;
  financialsEnd: string | null;
  /** how the block is tied to its loan: nested in the loan record, or a record numbered after it */
  link: "nested" | "number" | "none";
};

export type LoanRow = {
  key: string;
  rec: number;
  number: string;
  /** the loan record's own single property block, shown on the loan's row; null when it has none or several */
  own: PropertyRow | null;
  /** property rows listed under the loan: every block when the record nests several, and property-only records */
  properties: PropertyRow[];
  /** properties the loan record itself states (NumberProperties) */
  statedProperties: number | null;
  originalAmount: number | null;
  endBalance: number | null;
  actualEndBalance: number | null;
  rate: number | null;
  maturity: string | null;
  paidThrough: string | null;
  statusCode: string | null;
  workoutCode: string | null;
  specialServicerDate: string | null;
  returnedDate: string | null;
  modified: boolean | null;
  liquidationCode: string | null;
  liquidationDate: string | null;
  realizedLoss: number | null;
  interestOnly: boolean | null;
  /** in foreclosure or bank-owned by its workout strategy (2, 7, 10) or a property's status (1, 2) */
  foreclosure: boolean;
};

const propertyRow = (p: CmbsProperty): PropertyRow => ({
  key: `${p.rec}.${p.seq}`,
  number: p.asset_number,
  name: p.name,
  city: p.city,
  state: p.state,
  typeCode: p.type_code,
  statusCode: p.status_code,
  dscrRecent: num(p.dscr_ncf_recent),
  dscrSecuritization: num(p.dscr_ncf_securitization),
  dscrNoiRecent: num(p.dscr_noi_recent),
  dscrNoiSecuritization: num(p.dscr_noi_securitization),
  occupancySecuritization: num(p.occupancy_securitization),
  occupancyRecent: num(p.occupancy_recent),
  financialsEnd: p.financials_recent_end,
  link: p.link,
});

export type LoanTable = {
  loans: LoanRow[];
  /** property blocks no loan number fits: listed, never guessed onto a loan */
  untied: PropertyRow[];
  /** records that are neither a loan nor a property of one */
  otherRecords: number;
};

/**
 * The loans of one file in file order, each with its property rows. A loan record's single nested block
 * rides on the loan's own row (for a loan with property-only records that block is the portfolio's
 * roll-up); several nested blocks, and property-only records numbered after the loan, are listed under it.
 */
export function loanTable(loans: readonly CmbsLoan[], properties: readonly CmbsProperty[]): LoanTable {
  const nested = new Map<number, CmbsProperty[]>();
  const numbered = new Map<string, CmbsProperty[]>();
  const untied: PropertyRow[] = [];
  for (const p of properties) {
    if (p.link === "nested") nested.set(p.rec, [...(nested.get(p.rec) ?? []), p]);
    else if (p.link === "number")
      numbered.set(p.loan_asset_number, [...(numbered.get(p.loan_asset_number) ?? []), p]);
    else untied.push(propertyRow(p));
  }
  const rows: LoanRow[] = [];
  let otherRecords = 0;
  for (const l of loans) {
    if (l.kind === "other") otherRecords++;
    if (l.kind !== "loan") continue;
    const own = nested.get(l.rec) ?? [];
    const after = numbered.get(l.asset_number) ?? [];
    const props = [...own, ...after];
    rows.push({
      key: String(l.rec),
      rec: l.rec,
      number: l.asset_number,
      own: own.length === 1 ? propertyRow(own[0]) : null,
      properties: [...(own.length > 1 ? own.map(propertyRow) : []), ...after.map(propertyRow)],
      statedProperties: l.properties,
      originalAmount: num(l.original_loan_amount),
      endBalance: num(l.sched_end_balance),
      actualEndBalance: num(l.actual_end_balance),
      rate: num(l.period_rate),
      maturity: l.maturity_date,
      paidThrough: l.paid_through_date,
      statusCode: l.payment_status_code,
      workoutCode: l.workout_strategy_code,
      specialServicerDate: l.special_servicer_transfer_date,
      returnedDate: l.master_servicer_return_date,
      modified: l.modified,
      liquidationCode: l.liquidation_prepayment_code,
      liquidationDate: l.liquidation_prepayment_date,
      realizedLoss: num(l.realized_loss),
      interestOnly: l.interest_only,
      foreclosure:
        (l.workout_strategy_code != null && FORECLOSURE_WORKOUT.includes(l.workout_strategy_code)) ||
        props.some((p) => p.status_code != null && FORECLOSURE_PROPERTY.includes(p.status_code)),
    });
  }
  return { loans: rows, untied, otherRecords };
}

/**
 * Loans a reader should look at first: a payment status other than current, a workout strategy, or a
 * transfer to the special servicer with no later return. Worst payment status first, then balance.
 */
export function watchLoans(table: LoanTable): LoanRow[] {
  const inSpecial = (l: LoanRow) =>
    l.specialServicerDate != null && (l.returnedDate == null || l.returnedDate < l.specialServicerDate);
  return table.loans
    .filter(
      (l) =>
        (l.statusCode != null && l.statusCode !== "0") || l.workoutCode != null || inSpecial(l),
    )
    .sort(
      (a, b) =>
        statusRank(b.statusCode) - statusRank(a.statusCode) ||
        (b.endBalance ?? 0) - (a.endBalance ?? 0) ||
        a.rec - b.rec,
    );
}

/**
 * Share of the scheduled end balance of a file's loans that is in foreclosure or bank-owned, read from
 * the loan records because the payment status list has no such value: a loan counts when its workout
 * strategy is foreclosure, REO or deed in lieu (2, 7, 10), or one of its properties is in foreclosure or
 * REO (property status 1, 2). The denominator is the scheduled end balance of every loan of the file.
 */
export function foreclosureShare(table: LoanTable, accession: string): Share & { loans: number } {
  let numerator = 0;
  let denominator = 0;
  let loans = 0;
  let stated = 0;
  for (const l of table.loans) {
    if (l.endBalance == null) continue;
    stated++;
    denominator += l.endBalance;
    if (l.foreclosure) {
      numerator += l.endBalance;
      loans++;
    }
  }
  return {
    value: stated && denominator > 0 ? numerator / denominator : null,
    numerator: stated ? numerator : null,
    denominator: stated ? denominator : null,
    buckets: [],
    accession,
    loans,
  };
}

export type LoanSortKey = "file" | "status" | "balance" | "original" | "rate" | "dscr" | "occupancy" | "maturity";

/** Sorted copy of the loans; each loan keeps its property rows. A loan without the value goes last. */
export function sortLoans(loans: readonly LoanRow[], key: LoanSortKey, dir: "asc" | "desc"): LoanRow[] {
  if (key === "file") return dir === "asc" ? [...loans] : [...loans].reverse();
  const value = (l: LoanRow): number | string | null =>
    key === "status"
      ? l.statusCode == null
        ? null
        : statusRank(l.statusCode)
      : key === "balance"
        ? l.endBalance
        : key === "original"
          ? l.originalAmount
          : key === "rate"
            ? l.rate
            : key === "dscr"
              ? (l.own?.dscrRecent ?? null)
              : key === "occupancy"
                ? (l.own?.occupancyRecent ?? null)
                : l.maturity;
  const sign = dir === "asc" ? 1 : -1;
  return [...loans].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x == null && y == null) return a.rec - b.rec;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
    return c ? sign * c : a.rec - b.rec;
  });
}

/* ---------- the whole deal ---------- */

export type DealModel = {
  dealId: string;
  family: AbsFamily | "other";
  name: string;
  cik: number | null;
  /** the filings name only their depositor: the deal is keyed by that CIK and the SEC file number */
  depositorKeyed: boolean;
  fileNumber: string | null;
  depositorCik: number | null;
  sponsorCik: number | null;
  filings: FilingRow[];
  /** current filings that are not offering-stage, oldest first */
  auto: AutoPoint[];
  cmbs: CmbsPoint[];
  /** current offering-stage filings, oldest first: shown apart, in no series */
  offeringAuto: AutoPoint[];
  offeringCmbs: CmbsPoint[];
  /** the filing whose breakdowns and loans are shown */
  shown: { accession: string; offering: boolean; recordsEnd: string | null; cik: number | null } | null;
  breakdowns: Record<string, Breakdown>;
  loanTable: LoanTable | null;
  /** filings with the abs_review() condition */
  review: FilingRow[];
  /** filings EDGAR lists under the trust's own CIK that are not read yet; null when not counted */
  waiting: number | null;
  notStored: DealPayload["not_stored"];
  limits: ReadLimits;
};

export function dealModel(p: DealPayload): DealModel {
  const family = p.deal.family;
  const filings = filingRows(p.filings);
  const current = p.filings.filter((f) => f.is_current);
  const monthly = current.filter((f) => !stageOf(f).offering);
  const offering = current.filter((f) => stageOf(f).offering);
  const isAuto = family === "auto_loan" || family === "auto_lease";
  const auto = isAuto ? monthly.map((f) => autoPoint(family, f)).sort(byPeriod) : [];
  const offeringAuto = isAuto ? offering.map((f) => autoPoint(family, f)).sort(byPeriod) : [];
  const cmbs = family === "cmbs" ? monthly.map(cmbsPoint).sort(byPeriod) : [];
  const offeringCmbs = family === "cmbs" ? offering.map(cmbsPoint).sort(byPeriod) : [];
  const shownFiling = p.shown ? p.filings.find((f) => f.accession === p.shown!.accession) : undefined;
  const breakdowns: Record<string, Breakdown> = {};
  if (isAuto && p.shown) {
    const point = [...auto, ...offeringAuto].find((x) => x.accession === p.shown!.accession);
    const total = point?.end?.value ?? null;
    for (const dim of ["state", "make", "score_band", "new_used", "zero_balance_code"])
      breakdowns[dim] = breakdownOf(family, p.breakdowns, dim, total);
    if (point) {
      const rows: FigureRow[] = Object.entries(point.split).map(([bucket, f]) => [
        END_METRIC[family],
        STATUS_DIM[family],
        bucket,
        f.text,
        f.n,
        f.missing,
      ]);
      breakdowns.delinquency = breakdownOf(family, rows, "delinquency", total);
    }
  }
  return {
    dealId: p.deal.deal_id,
    family,
    name: p.deal.issuer_name,
    cik: p.deal.issuer_cik,
    depositorKeyed: p.deal.deal_id.includes(":"),
    fileNumber: p.deal.file_number,
    depositorCik: p.deal.depositor_cik,
    sponsorCik: p.deal.sponsor_cik,
    filings,
    auto,
    cmbs,
    offeringAuto,
    offeringCmbs,
    shown: p.shown && {
      accession: p.shown.accession,
      offering: p.shown.offering,
      recordsEnd: p.shown.records_end,
      cik: shownFiling?.list_cik ?? p.deal.issuer_cik,
    },
    breakdowns,
    loanTable: family === "cmbs" ? loanTable(p.loans, p.properties) : null,
    review: filings.filter((f) => f.aloneAmendment),
    waiting: p.waiting,
    notStored: p.not_stored,
    limits: p.limits,
  };
}

export { BLANK };
