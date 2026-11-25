// Reads of the "Securitized credit" view, with the signed-in member's own client: row security of
// migration 0067 stays in force, and nothing here needs a function that is not in production. Every
// select names its columns, filters on an indexed key (deal id, load id, status, CIK), orders by a key
// and is read in pages of at most 1,000 rows up to a stated cap; the payload says where a cap applied.
// Rows are turned into payloads by the pure functions of ./view/assemble.ts.
//
// The monitor is three steps: the deals; then the family's loaded filings with the period their
// records state, and the coverage counts; then the status split and pool totals of the filings its
// trends need. A deal is three steps too: the deal and its filings; the figures of its filings; the
// breakdowns or loan records of the filing it details.
import {
  assembleDeal,
  assembleMonitor,
  issuerCikOf,
  planDeal,
  planMonitor,
} from "./view/assemble";
import { END_METRIC, FAMILIES, STATUS_DIM, TOTAL_METRICS } from "./view/codes";
import type {
  AbsFamily,
  CmbsLoan,
  CmbsProperty,
  Coverage,
  DealFilingRaw,
  DealPayload,
  DealRaw,
  FilingRaw,
  MetricRaw,
  MonitorPayload,
  NotStoredRaw,
} from "./view/types";

type Result<T> = {
  data: T[] | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

/** The part of a PostgREST query builder these reads use. */
export interface AbsQuery<T> extends PromiseLike<Result<T>> {
  eq(column: string, value: string | number | boolean): AbsQuery<T>;
  in(column: string, values: readonly (string | number)[]): AbsQuery<T>;
  not(column: string, operator: string, value: unknown): AbsQuery<T>;
  order(column: string, options?: { ascending?: boolean }): AbsQuery<T>;
  range(from: number, to: number): AbsQuery<T>;
  limit(count: number): AbsQuery<T>;
}

/** The caller's user-scoped client, never the admin client. */
export type AbsReadClient = {
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): AbsQuery<unknown>;
  };
};

export class AbsReadError extends Error {
  constructor(what: string, error: { message: string; code?: string }) {
    super(`Could not read ${what}: ${error.message}`);
    this.name = "AbsReadError";
  }
}

export const PAGE = 1000;
/** Ids in one `in` filter: keeps each request address short. */
export const IDS_PER_REQUEST = 300;

type Paged<T> = { rows: T[]; complete: boolean };

/**
 * Every row of a query up to `cap`, in pages of `PAGE`. The last page asks for one row more than the
 * cap, so `complete` says exactly whether rows were left unread.
 */
export async function readPages<T>(
  what: string,
  build: (from: number, to: number) => AbsQuery<unknown>,
  cap: number,
): Promise<Paged<T>> {
  const rows: T[] = [];
  for (let from = 0; from <= cap; from += PAGE) {
    const to = Math.min(from + PAGE - 1, cap);
    const { data, error } = await build(from, to);
    if (error) throw new AbsReadError(what, error);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < to - from + 1) return { rows, complete: true };
  }
  return rows.length > cap ? { rows: rows.slice(0, cap), complete: false } : { rows, complete: true };
}

/** The same over a list of ids too long for one request: one paged query per slice, run together. */
async function readByIds<T>(
  what: string,
  ids: readonly (string | number)[],
  build: (slice: readonly (string | number)[], from: number, to: number) => AbsQuery<unknown>,
  cap: number,
): Promise<Paged<T>> {
  if (!ids.length) return { rows: [], complete: true };
  const slices: (string | number)[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) slices.push(ids.slice(i, i + IDS_PER_REQUEST));
  const parts = await Promise.all(
    slices.map((slice) => readPages<T>(what, (from, to) => build(slice, from, to), cap)),
  );
  return { rows: parts.flatMap((p) => p.rows), complete: parts.every((p) => p.complete) };
}

async function countOf(what: string, query: AbsQuery<unknown>): Promise<number | null> {
  const { count, error } = await query;
  if (error) throw new AbsReadError(what, error);
  return count ?? null;
}

const DEAL_COLUMNS = "deal_id,issuer_cik,issuer_name,file_number,family,depositor_cik,sponsor_cik";
const FILING_COLUMNS =
  "accession,deal_id,list_cik,form,filed,accepted_at,period_start,period_end,is_current,superseded_by,load_id";
const METRIC_COLUMNS = "load_id,metric,dim,bucket,value::text,n,n_missing";
const LOAN_COLUMNS =
  "rec,kind,asset_number,period_begin,period_end,original_loan_amount,maturity_date,properties,interest_only," +
  "sched_end_balance,actual_end_balance,period_rate,paid_through_date,payment_status_code,modified,realized_loss," +
  "liquidation_prepayment_code,liquidation_prepayment_date,workout_strategy_code,special_servicer_transfer_date," +
  "master_servicer_return_date";
const PROPERTY_COLUMNS =
  "rec,seq,asset_number,loan_asset_number,link,name,city,state,type_code,status_code,occupancy_securitization," +
  "occupancy_recent,financials_recent_end,dscr_ncf_securitization,dscr_ncf_recent,dscr_noi_securitization,dscr_noi_recent";

/** Caps, in rows. */
export const CAPS = {
  deals: 1000,
  filings: 5000,
  periods: 6000,
  split: 4000,
  totals: 3000,
  dealFilings: 2000,
  dealFigures: 6000,
  breakdowns: 3000,
  loans: 3000,
  properties: 4000,
  notStored: 50,
} as const;

async function readDeals(db: AbsReadClient): Promise<DealRaw[]> {
  const { rows } = await readPages<DealRaw>(
    "deals",
    (from, to) => db.from("abs_deals").select(DEAL_COLUMNS).order("deal_id").range(from, to),
    CAPS.deals,
  );
  return rows;
}

async function readCoverage(db: AbsReadClient, deals: readonly DealRaw[]): Promise<Coverage> {
  const ids = (family: AbsFamily) => deals.filter((d) => d.family === family).map((d) => d.deal_id);
  const filingCount = async (family: AbsFamily) => {
    const list = ids(family);
    if (!list.length) return 0;
    let total = 0;
    for (let i = 0; i < list.length; i += IDS_PER_REQUEST) {
      const n = await countOf(
        "filing counts",
        db
          .from("abs_filings")
          .select("accession", { count: "exact", head: true })
          .eq("status", "loaded")
          .in("deal_id", list.slice(i, i + IDS_PER_REQUEST)),
      );
      if (n == null) return null;
      total += n;
    }
    return total;
  };
  const statusCount = (status: string) =>
    countOf(
      "filing counts",
      db.from("abs_filings").select("accession", { count: "exact", head: true }).eq("status", status),
    );
  const [counts, listed, skipped, failed, newest] = await Promise.all([
    Promise.all(FAMILIES.map(filingCount)),
    statusCount("listed"),
    statusCount("skipped"),
    statusCount("failed"),
    db
      .from("abs_filings")
      .select("loaded_at")
      .eq("status", "loaded")
      .not("loaded_at", "is", null)
      .order("loaded_at", { ascending: false })
      .limit(1),
  ]);
  if (newest.error) throw new AbsReadError("the newest load", newest.error);
  const top = (newest.data ?? [])[0] as { loaded_at: string | null } | undefined;
  return {
    families: FAMILIES.map((family, i) => ({ family, deals: ids(family).length, filings: counts[i] })),
    listed,
    skipped,
    failed,
    newest_loaded_at: top?.loaded_at ?? null,
  };
}

/** The deal monitor of one family, with the coverage counts of all three. */
export async function readMonitor(db: AbsReadClient, family: AbsFamily): Promise<MonitorPayload> {
  const deals = await readDeals(db);
  const ids = deals.filter((d) => d.family === family).map((d) => d.deal_id);
  const endKey = END_METRIC[family];
  const [filings, periods, coverage] = await Promise.all([
    readByIds<FilingRaw>(
      "filings",
      ids,
      (slice, from, to) =>
        db
          .from("abs_filings")
          .select(FILING_COLUMNS)
          .eq("status", "loaded")
          .in("deal_id", slice)
          .order("filed", { ascending: false })
          .order("accession", { ascending: false })
          .range(from, to),
      CAPS.filings,
    ),
    readByIds<{ load_id: number; accession: string; bucket: string }>(
      "reporting periods",
      ids,
      (slice, from, to) =>
        db
          .from("abs_pool_metrics_live")
          .select("load_id,accession,bucket")
          .in("deal_id", slice)
          .eq("metric", "records")
          .eq("dim", "period_end")
          .order("filed", { ascending: false })
          .order("accession", { ascending: false })
          .order("bucket")
          .range(from, to),
      CAPS.periods,
    ),
    readCoverage(db, deals),
  ]);
  const periodRead = completeLoads(periods);
  const plan = planMonitor({ family, deals, filings: filings.rows, periodRows: periods.rows, periodRead });
  const [split, totals] = await Promise.all([
    readByIds<MetricRaw>(
      "status splits",
      plan.splitLoads,
      (slice, from, to) =>
        db
          .from("abs_pool_metrics_live")
          .select(METRIC_COLUMNS)
          .in("load_id", slice)
          .eq("metric", endKey)
          .eq("dim", STATUS_DIM[family])
          .order("load_id")
          .order("bucket")
          .range(from, to),
      CAPS.split,
    ),
    readByIds<MetricRaw>(
      "pool totals",
      plan.totalLoads,
      (slice, from, to) =>
        db
          .from("abs_pool_metrics_live")
          .select(METRIC_COLUMNS)
          .in("load_id", slice)
          .eq("dim", "")
          .in("metric", TOTAL_METRICS[family])
          .order("load_id")
          .order("metric")
          .range(from, to),
      CAPS.totals,
    ),
  ]);
  const current = filings.rows.filter((f) => f.is_current && f.load_id != null);
  return assembleMonitor({
    plan,
    splitRows: split.rows,
    totalRows: totals.rows,
    coverage,
    limits: {
      filings_read: filings.rows.length,
      filings_total: coverage.families.find((f) => f.family === family)?.filings ?? null,
      stage_unread: current.filter((f) => !periodRead.has(f.load_id!)).length,
    },
  });
}

/**
 * Load ids whose period rows were read whole. Rows come newest filing first; when the read stopped at
 * its cap, the last filing seen may be cut, so it counts as unread.
 */
function completeLoads(p: Paged<{ load_id: number; accession: string }>): Set<number> {
  const seen = new Set(p.rows.map((r) => r.load_id));
  if (!p.complete && p.rows.length) seen.delete(p.rows[p.rows.length - 1].load_id);
  return seen;
}

/** One deal: its filings, the figures of its current filings and the detail of its newest one. */
export async function readDeal(db: AbsReadClient, dealId: string): Promise<DealPayload | null> {
  const cik = issuerCikOf(dealId);
  const [dealRows, filings, waiting, notStored] = await Promise.all([
    readPages<DealRaw>(
      "the deal",
      (from, to) =>
        db.from("abs_deals").select(`${DEAL_COLUMNS},updated_at`).eq("deal_id", dealId).range(from, to),
      1,
    ),
    readPages<DealFilingRaw>(
      "the deal's filings",
      (from, to) =>
        db
          .from("abs_filings")
          .select(
            `${FILING_COLUMNS},asset_class,issuer_name,depositor_cik,sponsor_cik,file_number,status,loaded_at,` +
              "abs_documents(seq,name,url,bytes,sha256,records,retrieved_at)",
          )
          .eq("deal_id", dealId)
          .eq("status", "loaded")
          .not("abs_documents.sha256", "is", null)
          .order("filed", { ascending: false })
          .order("accession", { ascending: false })
          .range(from, to),
      CAPS.dealFilings,
    ),
    cik == null
      ? Promise.resolve(null)
      : countOf(
          "waiting filings",
          db
            .from("abs_filings")
            .select("accession", { count: "exact", head: true })
            .eq("list_cik", cik)
            .eq("status", "listed"),
        ),
    cik == null
      ? Promise.resolve({ rows: [] as NotStoredRaw[], complete: true })
      : readPages<NotStoredRaw>(
          "filings not stored",
          (from, to) =>
            db
              .from("abs_filings")
              .select("accession,list_cik,form,filed,status,status_detail")
              .eq("list_cik", cik)
              .in("status", ["skipped", "failed"])
              .order("filed", { ascending: false })
              .range(from, to),
          CAPS.notStored,
        ),
  ]);
  const deal = dealRows.rows[0];
  if (!deal) return null;
  const family = deal.family as AbsFamily;
  const known = (FAMILIES as readonly string[]).includes(deal.family);
  const loads = filings.rows.filter((f) => f.load_id != null).map((f) => f.load_id!);
  const currentLoads = filings.rows.filter((f) => f.is_current && f.load_id != null).map((f) => f.load_id!);
  const [periods, figures] = await Promise.all([
    readByIds<{ load_id: number; accession: string; bucket: string }>(
      "reporting periods",
      loads,
      (slice, from, to) =>
        db
          .from("abs_pool_metrics_live")
          .select("load_id,accession,bucket")
          .in("load_id", slice)
          .eq("metric", "records")
          .eq("dim", "period_end")
          .order("load_id")
          .order("bucket")
          .range(from, to),
      CAPS.periods,
    ),
    known
      ? Promise.all([
          readByIds<MetricRaw>(
            "pool totals",
            currentLoads,
            (slice, from, to) =>
              db
                .from("abs_pool_metrics_live")
                .select(METRIC_COLUMNS)
                .in("load_id", slice)
                .eq("dim", "")
                .order("load_id")
                .order("metric")
                .range(from, to),
            CAPS.dealFigures,
          ),
          readByIds<MetricRaw>(
            "status splits",
            currentLoads,
            (slice, from, to) =>
              db
                .from("abs_pool_metrics_live")
                .select(METRIC_COLUMNS)
                .in("load_id", slice)
                .in("dim", [STATUS_DIM[family], "quantile"])
                .in("metric", [END_METRIC[family], "loans", "records", "payment_to_income"])
                .order("load_id")
                .order("metric")
                .order("dim")
                .order("bucket")
                .range(from, to),
            CAPS.dealFigures,
          ),
        ])
      : Promise.resolve([] as Paged<MetricRaw>[]),
  ]);
  // Period rows are ordered by load id here, so a cut read leaves an unknown filing: none counts as read.
  const periodRead = periods.complete ? new Set(loads) : new Set<number>();
  const { facts, shown } = planDeal({ filings: filings.rows, periodRows: periods.rows, periodRead });
  const shownLoad = shown?.load_id ?? null;
  let breakdowns: MetricRaw[] = [];
  let loans: CmbsLoan[] = [];
  let properties: CmbsProperty[] = [];
  if (known && shownLoad != null) {
    if (family === "cmbs") {
      const [l, p] = await Promise.all([
        readPages<CmbsLoan>(
          "loan records",
          (from, to) =>
            db.from("abs_cmbs_assets_live").select(LOAN_COLUMNS).eq("load_id", shownLoad).order("rec").range(from, to),
          CAPS.loans,
        ),
        readPages<CmbsProperty>(
          "property records",
          (from, to) =>
            db
              .from("abs_cmbs_properties_live")
              .select(PROPERTY_COLUMNS)
              .eq("load_id", shownLoad)
              .order("rec")
              .order("seq")
              .range(from, to),
          CAPS.properties,
        ),
      ]);
      loans = l.rows;
      properties = p.rows;
    } else {
      const b = await readPages<MetricRaw>(
        "breakdowns",
        (from, to) =>
          db
            .from("abs_pool_metrics_live")
            .select(METRIC_COLUMNS)
            .eq("load_id", shownLoad)
            .in("dim", ["state", "make", "score_band", "new_used", "zero_balance_code"])
            .in("metric", [END_METRIC[family], "records"])
            .order("dim")
            .order("metric")
            .order("bucket")
            .range(from, to),
        CAPS.breakdowns,
      );
      breakdowns = b.rows;
    }
  }
  const figureRows = figures.flatMap((p) => p.rows);
  return assembleDeal({
    deal,
    filings: filings.rows,
    facts,
    shown,
    figureRows,
    breakdownRows: breakdowns,
    loans,
    properties,
    waiting,
    notStored: notStored.rows,
    limits: {
      filings_read: filings.rows.length,
      filings_total: filings.complete ? filings.rows.length : null,
      stage_unread: periods.complete ? 0 : loads.length,
      trend_cut: !figures.every((p) => p.complete),
    },
  });
}
