// The deal monitor: one row per deal (the issuing entity) of one family. Pure. Every figure of a row is
// of one filing, the deal's newest current filing that is not offering-stage; nothing is added across
// deals, and a share always carries its numerator and denominator.
import {
  DUE_30_PLUS,
  DUE_60_PLUS,
  DUE_UNSTATED,
  END_METRIC,
  STATUS_GROUPS,
  statusGroupOf,
  type StatusGroup,
} from "./codes";
import { daysBetween, figure, num, shareOf, unstatedOf, type Figure } from "./figures";
import type { AbsFamily, MonitorDeal, MonitorPayload, ReadLimits, Share, Stored, TrendPoint } from "./types";

export type TrendValue = {
  recordsEnd: string | null;
  accession: string;
  /** the headline share of that period; null when the file gives none */
  share: number | null;
  numerator: number | null;
  denominator: number | null;
};

export type GroupShare = Share & { key: StatusGroup; label: string; loans: number };

export type MonitorRow = {
  dealId: string;
  family: AbsFamily;
  name: string;
  cik: number | null;
  /** the filings name only their depositor: the deal is keyed by that CIK and the SEC file number */
  depositorKeyed: boolean;
  /** current filings that are not offering-stage */
  periods: number;
  /** distinct reporting periods among them; differs from `periods` when two filings state one period */
  distinctPeriods: number;
  loaded: number;
  offeringFiles: number;
  /** an amendment of the deal shares its cover period with no other filing (the abs_review() condition) */
  review: boolean;
  latest: {
    accession: string;
    cik: number;
    form: string;
    filed: string;
    recordsEnd: string | null;
    coverEnd: string | null;
    /** the file's records state more than one period end */
    mixedPeriods: boolean;
    records: Figure | null;
    loans: Figure | null;
    end: Figure | null;
    /* auto */
    due30: Share | null;
    due60: Share | null;
    /** end amount whose records state no status */
    unstated: { amount: number; share: number | null } | null;
    chargeOffs: Figure | null;
    recoveries: Figure | null;
    score: Figure | null;
    /* commercial mortgages */
    groups: GroupShare[] | null;
    rate: Figure | null;
  } | null;
  /** the headline share per stored period, oldest first: 60 or more days (auto), 30 or more (commercial mortgages) */
  trend: TrendValue[];
  /** newest headline share less the previous stored period's, with both period ends */
  change: { value: number; from: string | null; to: string | null; days: number | null } | null;
  /** the newest current offering-stage filing, when the deal has one */
  offering: {
    accession: string;
    cik: number;
    form: string;
    filed: string;
    recordsEnd: string | null;
    coverEnd: string | null;
    recordsAfterFiling: boolean;
    coverAfterFiling: boolean;
    count: Figure | null;
    end: Figure | null;
  } | null;
};

/** Shares of the scheduled end balance by payment status group, with the loans in each. */
export function groupShares(
  split: Record<string, Stored | string | null>,
  denominator: string | number | null | undefined,
  accession: string,
  loansBy?: Record<string, number>,
): GroupShare[] {
  const den = num(denominator);
  const codes = Object.keys(split);
  return STATUS_GROUPS.map((g) => {
    const mine = codes.filter((c) => statusGroupOf(c) === g.key);
    let amount = 0;
    let loans = 0;
    for (const c of mine) {
      const v = split[c];
      amount += (Array.isArray(v) ? num(v[0]) : num(v)) ?? 0;
      loans += loansBy ? (loansBy[c] ?? 0) : Array.isArray(v) ? v[1] + v[2] : 0;
    }
    return {
      key: g.key,
      label: g.label,
      loans,
      value: codes.length && den != null && den > 0 ? amount / den : null,
      numerator: codes.length ? amount : null,
      denominator: den,
      buckets: mine,
      accession,
    };
  });
}

/** Payment status codes in the headline share of a commercial mortgage pool: 30 days or more. */
export const HEADLINE_CMBS = STATUS_GROUPS.find((g) => g.key === "due30")!.codes;

function trendValue(family: AbsFamily, p: TrendPoint): TrendValue {
  const [recordsEnd, accession, end, split] = p;
  const s =
    family === "cmbs"
      ? shareOf(split, end, HEADLINE_CMBS, accession, ["(blank)"])
      : shareOf(split, end, DUE_60_PLUS, accession);
  return { recordsEnd, accession, share: s.value, numerator: s.numerator, denominator: s.denominator };
}

export function monitorRow(family: AbsFamily, d: MonitorDeal): MonitorRow {
  const endKey = END_METRIC[family];
  const l = d.latest;
  const trend = d.trend.map((p) => trendValue(family, p));
  const withShare = trend.filter((t) => t.share != null);
  const last = withShare[withShare.length - 1];
  const prev = withShare[withShare.length - 2];
  const isNewest = !!last && !!l && last.accession === l.accession;
  const endText = l?.totals[endKey]?.[0];
  return {
    dealId: d.deal_id,
    family,
    name: d.issuer_name,
    cik: d.issuer_cik,
    depositorKeyed: d.deal_id.includes(":"),
    periods: d.files.monthly,
    distinctPeriods: d.files.monthly_periods,
    loaded: d.files.loaded,
    offeringFiles: d.files.offering,
    review: d.files.review > 0,
    latest: l && {
      accession: l.accession,
      cik: l.list_cik,
      form: l.form,
      filed: l.filed,
      recordsEnd: l.records_end,
      coverEnd: l.cover_end,
      mixedPeriods: (l.period_ends ?? 1) > 1,
      records: figure(l.totals.records),
      loans: figure(l.totals.loans),
      end: figure(l.totals[endKey]),
      due30: family === "cmbs" ? null : shareOf(l.split, endText, DUE_30_PLUS, l.accession),
      due60: family === "cmbs" ? null : shareOf(l.split, endText, DUE_60_PLUS, l.accession),
      unstated: family === "cmbs" ? null : unstatedOf(l.split, endText, DUE_UNSTATED),
      chargeOffs: figure(l.totals.charge_offs),
      recoveries: figure(l.totals.recoveries),
      score: figure(l.totals.wa_credit_score),
      groups: family === "cmbs" ? groupShares(l.split, endText, l.accession) : null,
      rate: figure(l.totals.wa_period_rate),
    },
    trend,
    change:
      isNewest && prev && last.share != null && prev.share != null
        ? {
            value: last.share - prev.share,
            from: prev.recordsEnd,
            to: last.recordsEnd,
            days: daysBetween(prev.recordsEnd, last.recordsEnd),
          }
        : null,
    offering: d.offering && {
      accession: d.offering.accession,
      cik: d.offering.list_cik,
      form: d.offering.form,
      filed: d.offering.filed,
      recordsEnd: d.offering.records_end,
      coverEnd: d.offering.cover_end,
      recordsAfterFiling: d.offering.records_after_filing,
      coverAfterFiling: d.offering.cover_after_filing,
      count: figure(family === "cmbs" ? d.offering.totals.loans : d.offering.totals.records),
      end: figure(d.offering.totals[endKey]),
    },
  };
}

/* ---------- sort and filter ---------- */

export const SORT_KEYS = {
  auto_loan: ["due60", "change", "due30", "end", "charge_offs", "score", "records", "period", "periods", "name"],
  auto_lease: ["due60", "change", "due30", "end", "charge_offs", "score", "records", "period", "periods", "name"],
  cmbs: ["due30", "change", "nonperforming", "late", "end", "rate", "loans", "period", "periods", "name"],
} as const satisfies Record<AbsFamily, readonly string[]>;

export type SortKey = (typeof SORT_KEYS)[AbsFamily][number];
export type SortDir = "asc" | "desc";
export type Sort = { key: SortKey; dir: SortDir };

/** The default answers "which pools are deteriorating": the worst headline share first. */
export const DEFAULT_SORT: Record<AbsFamily, Sort> = {
  auto_loan: { key: "due60", dir: "desc" },
  auto_lease: { key: "due60", dir: "desc" },
  cmbs: { key: "due30", dir: "desc" },
};

/** Reads "key:dir" for a family; anything else gives the family's default. */
export function parseSort(family: AbsFamily, text: string | undefined): Sort {
  const [key, dir] = (text ?? "").split(":");
  const keys: readonly string[] = SORT_KEYS[family];
  return keys.includes(key) && (dir === "asc" || dir === "desc")
    ? { key: key as SortKey, dir }
    : DEFAULT_SORT[family];
}

export const sortText = (s: Sort) => `${s.key}:${s.dir}`;

export const isDefaultSort = (family: AbsFamily, s: Sort) =>
  DEFAULT_SORT[family].key === s.key && DEFAULT_SORT[family].dir === s.dir;

/** The direction a first click on a column gives: text and dates ascending, figures largest first. */
export const firstDir = (key: SortKey): SortDir => (key === "name" ? "asc" : "desc");

/** The sort a click on a column header gives: the other direction on the same column, else its first. */
export function nextSort(current: Sort, key: SortKey): Sort {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) };
}

const group = (r: MonitorRow, key: StatusGroup) =>
  r.latest?.groups?.find((g) => g.key === key)?.value ?? null;

function sortValue(r: MonitorRow, key: SortKey): number | string | null {
  const l = r.latest;
  switch (key) {
    case "name":
      return r.name.toLocaleLowerCase();
    case "period":
      return l?.recordsEnd ?? null;
    case "periods":
      return l ? r.periods : null;
    case "records":
      return l?.records?.value ?? null;
    case "loans":
      return l?.loans?.value ?? null;
    case "end":
      return l?.end?.value ?? null;
    case "due30":
      return r.family === "cmbs" ? group(r, "due30") : (l?.due30?.value ?? null);
    case "due60":
      return l?.due60?.value ?? null;
    case "change":
      return r.change?.value ?? null;
    case "charge_offs":
      return l?.chargeOffs?.value ?? null;
    case "score":
      return l?.score?.value ?? null;
    case "nonperforming":
      return group(r, "matured_nonperforming");
    case "late":
      return group(r, "late");
    case "rate":
      return l?.rate?.value ?? null;
  }
}

/** Sorted copy. A row without the figure goes last in either direction; ties keep name order. */
export function sortRows(rows: readonly MonitorRow[], sort: Sort): MonitorRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
    return c ? sign * c : a.name.localeCompare(b.name);
  });
}

/** Rows whose name, CIK or deal id contains the text (case ignored). */
export function filterRows(rows: readonly MonitorRow[], text: string | undefined): MonitorRow[] {
  const needle = (text ?? "").trim().toLocaleLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (r) =>
      r.name.toLocaleLowerCase().includes(needle) ||
      r.dealId.includes(needle) ||
      (r.cik != null && String(r.cik).includes(needle)),
  );
}

export type MonitorModel = {
  family: AbsFamily;
  /** deals with at least one current filing that is not offering-stage */
  rows: MonitorRow[];
  /** deals whose only current filings are offering-stage */
  offeringOnly: MonitorRow[];
  /** the trend holds at most this many periods per deal */
  trendCap: number;
  /** distinct newest period ends among the rows, newest first, with how many deals report each */
  periodEnds: { recordsEnd: string; deals: number }[];
  limits: ReadLimits;
};

export function monitorModel(payload: MonitorPayload): MonitorModel {
  const all = payload.deals.map((d) => monitorRow(payload.family, d));
  const rows = all.filter((r) => r.latest);
  const counts = new Map<string, number>();
  for (const r of rows)
    if (r.latest?.recordsEnd) counts.set(r.latest.recordsEnd, (counts.get(r.latest.recordsEnd) ?? 0) + 1);
  return {
    family: payload.family,
    rows,
    offeringOnly: all.filter((r) => !r.latest && r.offering),
    trendCap: payload.periods_cap,
    periodEnds: [...counts]
      .map(([recordsEnd, deals]) => ({ recordsEnd, deals }))
      .sort((a, b) => (a.recordsEnd < b.recordsEnd ? 1 : -1)),
    limits: payload.limits,
  };
}
