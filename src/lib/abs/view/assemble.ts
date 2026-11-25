// Turns the rows of the view's bounded selects into its payloads. Pure: the server (../read.server.ts)
// decides what to read in three steps and hands the rows here; tests hand the same rows read from a
// local database the real importer filled.
//
// The rules are those of ../AGENTS.md and of the page:
//   - only `is_current` filings feed figures; superseded ones are listed and point at what replaced them;
//   - a filing whose records state a period end after its filing date, or whose EDGAR cover period ends
//     after it, describes a pool at a cut-off (offering stage, ./stage.ts) and stays out of trends and out
//     of a deal's newest period;
//   - an amendment that shares its cover period with no other loaded filing of the deal is the
//     abs_review() condition, which members cannot call: it is derived here from the filings themselves;
//   - nothing is added across filings or deals.
import { END_METRIC, STATUS_DIM, TOTAL_METRICS } from "./codes";
import { stageOf } from "./stage";
import type {
  AbsFamily,
  Coverage,
  DealFiles,
  DealFiling,
  DealFilingRaw,
  DealPayload,
  DealRaw,
  FigureRow,
  FilingFacts,
  FilingRaw,
  MetricRaw,
  MonitorDeal,
  MonitorPayload,
  NotStoredRaw,
  ReadLimits,
  Stored,
  TrendPoint,
  CmbsLoan,
  CmbsProperty,
} from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The most periods a monitor trend holds: a year and the month before it. */
export const TREND_CAP = 13;

/** Rows a monitor may read for its trends and totals together (both selects, all pages). */
export const MONITOR_ROW_BUDGET = 6000;

/** Rows one trend period costs: the status split of the end amount plus the pool totals the monitor reads. */
export function rowsPerPoint(family: AbsFamily): number {
  return (family === "cmbs" ? 5 : 8) + TOTAL_METRICS[family].length;
}

/* ---------- the period the records state ---------- */

export type RecordsPeriod = { end: string | null; count: number };

/**
 * The period a file's records state: the date-shaped buckets of the figure `records` split by
 * `period_end`, which both readers store for every file. A record without a period (the property rows
 * of a commercial mortgage file) is the bucket "(blank)" and does not count; a file whose records state
 * more than one period end says so through `count`.
 */
export function recordsPeriods(rows: readonly { load_id: number; bucket: string }[]): Map<number, RecordsPeriod> {
  const out = new Map<number, RecordsPeriod>();
  for (const r of rows) {
    const p = out.get(r.load_id) ?? { end: null, count: 0 };
    if (DATE.test(r.bucket)) {
      p.count++;
      if (p.end == null || r.bucket > p.end) p.end = r.bucket;
    }
    out.set(r.load_id, p);
  }
  return out;
}

/** The dated facts of one filing. `read` says whether the records' period was read for it. */
export function factsOf(f: FilingRaw, period: RecordsPeriod | undefined, read: boolean): FilingFacts {
  const records_end = read ? (period?.end ?? null) : null;
  const stage = stageOf({ filed: f.filed, cover_end: f.period_end, records_end });
  return {
    accession: f.accession,
    list_cik: f.list_cik,
    form: f.form,
    filed: f.filed,
    accepted_at: f.accepted_at,
    cover_start: f.period_start,
    cover_end: f.period_end,
    records_end,
    period_ends: read ? (period?.count ?? 0) : null,
    records_read: read,
    records_after_filing: stage.recordsAfterFiling,
    cover_after_filing: stage.coverAfterFiling,
  };
}

export const isOffering = (f: FilingFacts) => f.records_after_filing || f.cover_after_filing;

/** The period a filing sits at in a series: the records' own, or the cover period when that was not read. */
export const periodKey = (f: FilingFacts): string | null => (f.records_read ? f.records_end : f.cover_end);

const desc = (a: string | null, b: string | null) =>
  a === b ? 0 : a == null ? 1 : b == null ? -1 : a < b ? 1 : -1;

/** Newest first: by the period the records state, then by SEC acceptance, then by accession. */
export function newestFirst(a: FilingFacts, b: FilingFacts): number {
  return (
    desc(periodKey(a), periodKey(b)) ||
    desc(a.accepted_at, b.accepted_at) ||
    desc(a.accession, b.accession)
  );
}

/** Newest filed first: by filing date, then by SEC acceptance, then by accession. */
export function newestFiled(a: FilingFacts, b: FilingFacts): number {
  return desc(a.filed, b.filed) || desc(a.accepted_at, b.accepted_at) || desc(a.accession, b.accession);
}

/** An ABS-EE/A that shares its cover period with no other loaded filing of the deal (abs_review()). */
export function aloneAmendments(filings: readonly FilingRaw[]): Set<string> {
  const out = new Set<string>();
  for (const f of filings) {
    if (f.form !== "ABS-EE/A") continue;
    const shared = filings.some(
      (o) => o.accession !== f.accession && o.deal_id === f.deal_id && o.period_end === f.period_end,
    );
    if (!shared) out.add(f.accession);
  }
  return out;
}

/* ---------- one deal's filings, counted ---------- */

export type DealFacts = {
  filings: (FilingFacts & FilingRaw)[];
  /** current filings that are not offering-stage, newest first */
  monthly: (FilingFacts & FilingRaw)[];
  /** current offering-stage filings, newest filed first */
  offering: (FilingFacts & FilingRaw)[];
  files: DealFiles;
};

export function dealFacts(
  filings: readonly FilingRaw[],
  periods: ReadonlyMap<number, RecordsPeriod>,
  read: (f: FilingRaw) => boolean,
): DealFacts {
  const facts = filings.map((f) => ({
    ...f,
    ...factsOf(f, f.load_id == null ? undefined : periods.get(f.load_id), read(f)),
  }));
  const monthly = facts.filter((f) => f.is_current && !isOffering(f)).sort(newestFirst);
  const offering = facts.filter((f) => f.is_current && isOffering(f)).sort(newestFiled);
  const alone = aloneAmendments(filings);
  const periodsOf = new Set(monthly.map(periodKey).filter((p): p is string => p != null));
  const firstPeriod = [...periodsOf].sort()[0] ?? null;
  const filedDates = facts.map((f) => f.filed).sort();
  return {
    filings: facts,
    monthly,
    offering,
    files: {
      loaded: facts.length,
      current: facts.filter((f) => f.is_current).length,
      offering: facts.filter(isOffering).length,
      monthly: monthly.length,
      monthly_periods: periodsOf.size,
      review: facts.filter((f) => alone.has(f.accession)).length,
      first_period: firstPeriod,
      first_filed: filedDates[0] ?? null,
      last_filed: filedDates[filedDates.length - 1] ?? null,
    },
  };
}

/* ---------- the monitor ---------- */

/**
 * The deepest trend that fits the row budget: the largest depth up to `cap` for which reading the
 * newest `depth` monthly filings of every deal stays within `budget` rows. At least 2, so a deal with
 * two periods always shows its change.
 */
export function trendDepth(monthlyCounts: readonly number[], perPoint: number, budget: number, cap = TREND_CAP): number {
  for (let depth = cap; depth > 2; depth--) {
    const rows = monthlyCounts.reduce((s, c) => s + Math.min(c, depth), 0) * perPoint;
    if (rows <= budget) return depth;
  }
  return 2;
}

export type MonitorPlan = {
  family: AbsFamily;
  depth: number;
  /** the trend is shallower than the cap because of the budget */
  cut: boolean;
  deals: { deal: DealRaw; facts: DealFacts }[];
  /** load ids whose status split is read: the trend filings of every deal */
  splitLoads: number[];
  /** load ids whose pool totals are read: the trend filings and each deal's newest offering-stage filing */
  totalLoads: number[];
};

/**
 * Step two of the monitor: given the family's deals, their loaded filings and the records' period of
 * the filings that were read, decide which filings the trends and totals need.
 */
export function planMonitor(input: {
  family: AbsFamily;
  deals: readonly DealRaw[];
  filings: readonly FilingRaw[];
  periodRows: readonly { load_id: number; bucket: string }[];
  /** load ids whose period rows were read completely */
  periodRead: ReadonlySet<number>;
  budget?: number;
}): MonitorPlan {
  const periods = recordsPeriods(input.periodRows);
  const byDeal = new Map<string, FilingRaw[]>();
  for (const f of input.filings) byDeal.set(f.deal_id, [...(byDeal.get(f.deal_id) ?? []), f]);
  const deals = input.deals
    .filter((d) => d.family === input.family && byDeal.has(d.deal_id))
    .sort((a, b) =>
      a.issuer_name < b.issuer_name ? -1 : a.issuer_name > b.issuer_name ? 1 : a.deal_id < b.deal_id ? -1 : 1,
    )
    .map((deal) => ({
      deal,
      facts: dealFacts(byDeal.get(deal.deal_id)!, periods, (f) => f.load_id != null && input.periodRead.has(f.load_id)),
    }));
  const perPoint = rowsPerPoint(input.family);
  const depth = trendDepth(
    deals.map((d) => d.facts.monthly.length),
    perPoint,
    input.budget ?? MONITOR_ROW_BUDGET,
  );
  const cut = depth < TREND_CAP && deals.some((d) => d.facts.monthly.length > depth);
  const splitLoads: number[] = [];
  const totalLoads: number[] = [];
  for (const { facts } of deals) {
    for (const f of facts.monthly.slice(0, depth)) if (f.load_id != null) splitLoads.push(f.load_id);
    const off = facts.offering[0];
    if (off?.load_id != null) totalLoads.push(off.load_id);
  }
  totalLoads.push(...splitLoads);
  return { family: input.family, depth, cut, deals, splitLoads, totalLoads: [...new Set(totalLoads)] };
}

const stored = (r: MetricRaw): Stored => [r.value, r.n, r.n_missing];

function byLoad(rows: readonly MetricRaw[]): Map<number, MetricRaw[]> {
  const out = new Map<number, MetricRaw[]>();
  for (const r of rows) out.set(r.load_id, [...(out.get(r.load_id) ?? []), r]);
  return out;
}

const factsOnly = (f: FilingFacts): FilingFacts => ({
  accession: f.accession,
  list_cik: f.list_cik,
  form: f.form,
  filed: f.filed,
  accepted_at: f.accepted_at,
  cover_start: f.cover_start,
  cover_end: f.cover_end,
  records_end: f.records_end,
  period_ends: f.period_ends,
  records_read: f.records_read,
  records_after_filing: f.records_after_filing,
  cover_after_filing: f.cover_after_filing,
});

/** Step three of the monitor: the payload, from the plan and the split and total rows it asked for. */
export function assembleMonitor(input: {
  plan: MonitorPlan;
  splitRows: readonly MetricRaw[];
  totalRows: readonly MetricRaw[];
  coverage: Coverage;
  limits: Omit<ReadLimits, "trend_cut">;
}): MonitorPayload {
  const { plan } = input;
  const endKey = END_METRIC[plan.family];
  const splits = byLoad(input.splitRows);
  const totals = byLoad(input.totalRows);
  const totalsOf = (load: number | null): Record<string, Stored> => {
    const out: Record<string, Stored> = {};
    for (const r of load == null ? [] : (totals.get(load) ?? [])) if (r.dim === "") out[r.metric] = stored(r);
    return out;
  };
  const splitOf = (load: number | null) => (load == null ? [] : (splits.get(load) ?? []));
  const deals: MonitorDeal[] = plan.deals.map(({ deal, facts }) => {
    const trendFilings = facts.monthly.slice(0, plan.depth);
    const newest = trendFilings[0];
    const off = facts.offering[0];
    const trend: TrendPoint[] = trendFilings
      .map((f): TrendPoint => {
        const split: Record<string, string | null> = {};
        for (const r of splitOf(f.load_id)) split[r.bucket] = r.value;
        return [f.records_end, f.accession, totalsOf(f.load_id)[endKey]?.[0] ?? null, split];
      })
      .reverse();
    return {
      deal_id: deal.deal_id,
      issuer_cik: deal.issuer_cik,
      issuer_name: deal.issuer_name,
      file_number: deal.file_number,
      depositor_cik: deal.depositor_cik,
      sponsor_cik: deal.sponsor_cik,
      files: facts.files,
      latest: newest
        ? {
            ...factsOnly(newest),
            totals: totalsOf(newest.load_id),
            split: Object.fromEntries(splitOf(newest.load_id).map((r) => [r.bucket, stored(r)])),
          }
        : null,
      trend,
      offering: off ? { ...factsOnly(off), totals: totalsOf(off.load_id) } : null,
    };
  });
  return {
    family: plan.family,
    periods_cap: plan.depth,
    coverage: input.coverage,
    limits: { ...input.limits, trend_cut: plan.cut },
    deals,
  };
}

/* ---------- one deal ---------- */

/** The filing a deal page details: its newest current monthly filing, or its newest offering-stage one. */
export function shownOf(facts: DealFacts): (FilingFacts & FilingRaw) | null {
  return facts.monthly[0] ?? facts.offering[0] ?? null;
}

/** Whether a figure row goes with a current filing's figures on the deal page. */
export function isDealFigure(family: AbsFamily | "other", r: MetricRaw): boolean {
  if (r.dim === "" || r.dim === "quantile") return true;
  if (family === "other") return false;
  return r.dim === STATUS_DIM[family] && [END_METRIC[family], "loans", "records"].includes(r.metric);
}

const figureRow = (r: MetricRaw): FigureRow => [r.metric, r.dim, r.bucket, r.value, r.n, r.n_missing];
const figureOrder = (a: FigureRow, b: FigureRow) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;

export const FAMILIES_READ: readonly string[] = ["auto_loan", "auto_lease", "cmbs"];

/** Step two of a deal: the facts of its filings and the filing to detail, from its filings and period rows. */
export function planDeal(input: {
  filings: readonly DealFilingRaw[];
  periodRows: readonly { load_id: number; bucket: string }[];
  periodRead: ReadonlySet<number>;
}): { facts: DealFacts; shown: (FilingFacts & FilingRaw) | null } {
  const periods = recordsPeriods(input.periodRows);
  const facts = dealFacts(input.filings, periods, (f) => f.load_id != null && input.periodRead.has(f.load_id));
  return { facts, shown: shownOf(facts) };
}

export function assembleDeal(input: {
  deal: DealRaw;
  filings: readonly DealFilingRaw[];
  facts: DealFacts;
  shown: (FilingFacts & FilingRaw) | null;
  figureRows: readonly MetricRaw[];
  breakdownRows: readonly MetricRaw[];
  loans: readonly CmbsLoan[];
  properties: readonly CmbsProperty[];
  waiting: number | null;
  notStored: readonly NotStoredRaw[];
  limits: ReadLimits;
}): DealPayload {
  const family = (FAMILIES_READ.includes(input.deal.family) ? input.deal.family : "other") as AbsFamily | "other";
  const figures = byLoad(input.figureRows.filter((r) => isDealFigure(family, r)));
  const raw = new Map(input.filings.map((f) => [f.accession, f]));
  const alone = aloneAmendments(input.filings);
  const filings: DealFiling[] = [...input.facts.filings].sort(newestFiled).map((f) => {
    const r = raw.get(f.accession)!;
    const doc = [...(r.abs_documents ?? [])].filter((d) => d.sha256 != null).sort((a, b) => a.seq - b.seq)[0];
    return {
      ...factsOnly(f),
      is_current: f.is_current,
      superseded_by: f.superseded_by,
      alone_amendment: alone.has(f.accession),
      loaded_at: r.loaded_at,
      asset_class: r.asset_class,
      issuer_name: r.issuer_name,
      depositor_cik: r.depositor_cik,
      sponsor_cik: r.sponsor_cik,
      file_number: r.file_number,
      file: doc
        ? { name: doc.name, url: doc.url, bytes: doc.bytes, sha256: doc.sha256, records: doc.records, retrieved_at: doc.retrieved_at }
        : null,
      figures:
        f.is_current && f.load_id != null ? (figures.get(f.load_id) ?? []).map(figureRow).sort(figureOrder) : null,
    };
  });
  return {
    deal: {
      deal_id: input.deal.deal_id,
      issuer_cik: input.deal.issuer_cik,
      issuer_name: input.deal.issuer_name,
      file_number: input.deal.file_number,
      family,
      depositor_cik: input.deal.depositor_cik,
      sponsor_cik: input.deal.sponsor_cik,
      updated_at: input.deal.updated_at ?? null,
    },
    filings,
    waiting: input.waiting,
    not_stored: [...input.notStored],
    shown: input.shown
      ? { accession: input.shown.accession, offering: isOffering(input.shown), records_end: input.shown.records_end }
      : null,
    breakdowns: input.breakdownRows.map(figureRow).sort((a, b) =>
      a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : figureOrder(a, b),
    ),
    loans: [...input.loans].sort((a, b) => a.rec - b.rec),
    properties: [...input.properties].sort((a, b) => a.rec - b.rec || a.seq - b.seq),
    limits: input.limits,
  };
}

/** The CIK an issuer-keyed deal id spells; null for a deal keyed by its depositor and file number. */
export function issuerCikOf(dealId: string): number | null {
  return /^\d{10}$/.test(dealId) ? Number(dealId) : null;
}
