// What the stored history of each alt dataset can and cannot support. Pure.
//
// `alt_data` is filled by writers that each reach back a different distance (collect.server.ts, the
// `sec` and `alt-data` jobs, scripts/alt-slow.ts, scripts/gov-data.ts). A count, a total, a change
// or an "unusual" rule is only as good as the stretch of history that was stored whole, so every
// reader asks this module first and shows nothing the stored rows cannot carry:
//
//   events       two writers: the bulk script stores every 8-K item, the `sec` job only the last 45
//                days of each pass. A company the job reached first has no older rows, so the
//                history is whole only from its first stored record.
//   capital      the same two writers. Both drop 424B2/424B3 supplements for an issuer with more
//                than 100 of them, but one counts over every submissions file and the other over the
//                newest only, so for a frequent issuer (20 or more on file) they are a stream of their
//                own. A prospectus and its final pricing are one offering: filings of one category
//                within a week are counted once.
//   ownership    every 13D/13G filing EDGAR's search returns for the company, re-read weekly.
//   regulatory   a full-text search for the company's name: the newest 40 documents per type at
//                each collection. Mentions, not actions about the company, and cut off for busy
//                names: listed and counted per year by the source, never tested as a count.
//   contracts    actions: the newest 300 per recipient parent within 548 days, of which only those
//                of $1M or more are stored (the cap applies before the size filter, so the rows
//                cannot show whether it was hit), and the Department of Defense publishes 90 days
//                late. Awards: the largest 40 of five years. Neither is a count or a sum over time.
//   fda          every recall and approval; recalls are dated by initiation and published after
//                classification, about 90 days later.
//   recalls      every NHTSA campaign, re-read weekly.   consumer: every CPSC recall.
//   trials       the newest 1,000 by last update, dated by that update: record churn, not events.
//   attention    monthly; a row for the month in progress may be on file and is never read.
//   settlement   half-months since November 2024; a half-month without fails has no row.
//   bank         quarterly; the charge-off rate is year to date and annualised.
//
// No row says when its company was first or last collected (`created_at` was reset by a re-import),
// so the first stored record is the only evidence of where collection began, and a fall in a count
// cannot be told from a pause in collection. Counts over a window are shown only where the stored
// history covers it (`trailingCount`); the unusual-rise rule compares only windows wholly after the
// stream's first stored record (`wholeWindows`), whatever the source's reach, and never tests falls;
// a window that ends inside a publication delay is read as a lower bound.
import { isPartial, type PeriodMeta } from "@/lib/alt/periods";
import { FTD_TITLE } from "@/lib/alt/ftd";

export interface HistoryRow {
  uid: string;
  dataset: string;
  kind: string;
  date: string | null;
  title?: string;
  value?: number | null;
  // stored meta differs per dataset (same shape as AltRow.meta in query.ts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any> | null;
}

const DAY = 864e5;
const ms = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep 8, 2026" */
export const dayLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;

/* ---------------- event streams ---------------- */

/**
 * How far back one collection of a stream reaches:
 *  - `all`: everything the source holds for the company, so no record before the first means none existed;
 *  - `first-record`: one of its writers only looks back a few weeks, so the history is whole only from the first stored record;
 *  - `newest`: the newest `cap` records at each collection, whole only from the oldest stored record once `cap` are on file;
 *  - `sample`: the largest few, or records dated by something other than the event: never counted over time.
 */
export type Reach = "all" | "first-record" | "newest" | "sample";

/** Facts about all of a company's rows of one dataset that decide which stream a row belongs to. */
export interface StreamContext {
  /** 20 or more 424B2/424B3 supplements on file: the two writers treat them differently */
  frequentNotes: boolean;
}

export interface Stream {
  id: string;
  /** one counted unit, singular and plural */
  noun: [string, string];
  has: (r: HistoryRow, ctx: StreamContext) => boolean;
  reach: Reach;
  /** for `newest`: how many records one collection keeps */
  cap?: number;
  /** independently collected parts (a document type, a recipient parent); each starts on its own day */
  part?: (r: HistoryRow) => string;
  /** rows that are one filing or one recall event share a unit */
  unit?: (r: HistoryRow) => string;
  /** units of the same non-null key dated within `days` of the previous one are one unit (an offering and its pricing) */
  cluster?: { days: number; key: (r: HistoryRow) => string | null };
  /** days a record can take to be on file: the source's publication delay plus the days between collections */
  lagDays: number;
  /** whether the unusual-rise rule may watch this stream */
  watch: boolean;
  /** what is on file, in words a page can print */
  note: string;
}

const isNote = (r: HistoryRow) => /^424B[23]$/.test(String(r.meta?.form ?? ""));
/** Supplements on file at which a company counts as a frequent issuer. */
export const FREQUENT_NOTES = 20;
const isApproval = (r: HistoryRow) => r.meta?.kind === "approval";
const isAction = (r: HistoryRow) => r.uid.startsWith("usatx:");
/** The accession number of an SEC row (`8k:T:accn:item`, `cap:T:accn`, `own:T:accn`). */
const accession = (r: HistoryRow) => r.uid.split(":")[2] ?? r.uid;
/** Product-level recall records of one recall share its start day, kind and stated reason. */
const recallEvent = (r: HistoryRow) => `${r.date}|${r.meta?.kind ?? ""}|${String(r.meta?.reason ?? r.uid).slice(0, 120).toLowerCase()}`;

/** Every event dataset, as the streams its collector stores. The first stream is the dataset's main one. */
export const EVENT_STREAMS: Record<string, Stream[]> = {
  events: [
    { id: "8-K filings", noun: ["8-K filing", "8-K filings"], has: () => true, reach: "first-record", unit: accession, lagDays: 3, watch: true, note: "Every 8-K item where the full history was stored; otherwise items since the scheduled reader first reached the company." },
  ],
  capital: [
    { id: "filings", noun: ["capital-markets action", "capital-markets actions"], has: (r, c) => !(c.frequentNotes && isNote(r)), reach: "first-record", unit: accession, cluster: { days: 7, key: (r) => (r.meta?.category ? String(r.meta.category) : null) }, lagDays: 3, watch: true, note: "Registrations, offerings and tender filings where the full history was stored, otherwise since the scheduled reader first reached the company; filings of one kind within a week count as one action." },
    { id: "supplements", noun: ["prospectus supplement (424B2/424B3)", "prospectus supplements (424B2/424B3)"], has: (r, c) => c.frequentNotes && isNote(r), reach: "first-record", unit: accession, lagDays: 3, watch: false, note: "A frequent issuer's 424B2 and 424B3 supplements are kept by one writer and dropped by the other." },
  ],
  ownership: [
    { id: "filings", noun: ["13D/G filing", "13D/G filings"], has: () => true, reach: "all", unit: accession, lagDays: 8, watch: true, note: "Every Schedule 13D and 13G filing naming the company as subject, re-read weekly." },
  ],
  regulatory: [
    { id: "documents", noun: ["Federal Register document", "Federal Register documents"], has: () => true, reach: "newest", cap: 40, part: (r) => String(r.meta?.type ?? ""), lagDays: 5, watch: false, note: "Documents that mention the company's name: the newest 40 per document type at each collection. Mentions, not actions about the company." },
  ],
  contracts: [
    { id: "actions", noun: ["award action", "award actions"], has: isAction, reach: "first-record", part: (r) => String(r.meta?.parent_id ?? r.meta?.parent ?? ""), lagDays: 97, watch: false, note: "Award actions of $1M or more among the newest 300 per recipient in 18 months; the Department of Defense publishes 90 days late. A list, not a total." },
    { id: "awards", noun: ["award", "awards"], has: (r) => !isAction(r), reach: "sample", lagDays: 97, watch: false, note: "The largest 40 awards of the last five years per recipient." },
  ],
  fda: [
    { id: "recalls", noun: ["FDA recall", "FDA recalls"], has: (r) => !isApproval(r), reach: "all", unit: recallEvent, lagDays: 90, watch: true, note: "Every recall, dated by the day it began; FDA publishes a recall after classifying it, about 90 days later." },
    { id: "approvals", noun: ["approval", "approvals"], has: isApproval, reach: "all", lagDays: 14, watch: false, note: "Every drug approval and new indication." },
  ],
  recalls: [
    { id: "campaigns", noun: ["recall campaign", "recall campaigns"], has: () => true, reach: "all", lagDays: 30, watch: true, note: "Every NHTSA recall campaign of the manufacturer, re-read weekly." },
  ],
  consumer: [
    { id: "recalls", noun: ["CPSC recall", "CPSC recalls"], has: () => true, reach: "all", lagDays: 10, watch: true, note: "Every CPSC recall naming the company as maker, importer or retailer." },
  ],
  trials: [
    { id: "trials", noun: ["trial record", "trial records"], has: () => true, reach: "sample", lagDays: 5, watch: false, note: "Trial records are dated by their last update, so a count over time measures record changes, not trials." },
  ],
};

export interface Unit<T> {
  key: string;
  /** the unit's day (the earliest of its rows) */
  date: string;
  rows: T[];
}

export interface StreamHistory<T> {
  stream: Stream;
  /** dated rows of the stream */
  rows: T[];
  /** one per filing, campaign or recall event, newest first */
  units: Unit<T>[];
  /**
   * The stored history is whole after this day (and the records of that day are on file). `null`:
   * whole from the source's start. `undefined`: never countable over time.
   */
  since: string | null | undefined;
  /** the stream's oldest stored record: collection is known to be uniform only after it */
  first: string | null;
}

function unitsOf<T extends HistoryRow>(rows: T[], unit: Stream["unit"], cluster?: Stream["cluster"]): Unit<T>[] {
  const m = new Map<string, Unit<T>>();
  for (const r of rows) {
    const key = unit ? unit(r) : r.uid;
    const u = m.get(key);
    if (!u) m.set(key, { key, date: r.date!, rows: [r] });
    else {
      u.rows.push(r);
      if (r.date! < u.date) u.date = r.date!;
    }
  }
  const units = [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  if (!cluster) return units;
  // oldest first: a unit joins the open cluster of its key when it is dated within `days` of that cluster's latest unit
  const open = new Map<string, { u: Unit<T>; last: string }>();
  const out: Unit<T>[] = [];
  for (const u of [...units].reverse()) {
    const k = cluster.key(u.rows[0]);
    const c = k == null ? undefined : open.get(k);
    if (k != null && c && daysBetween(c.last, u.date) <= cluster.days) {
      c.u.rows.push(...u.rows);
      c.u.key = `${c.u.key}+${u.key}`;
      c.last = u.date;
      continue;
    }
    const fresh = { key: u.key, date: u.date, rows: [...u.rows] };
    out.push(fresh);
    if (k != null) open.set(k, { u: fresh, last: u.date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

const oldest = (rows: HistoryRow[]) => rows.reduce<string | null>((a, r) => (r.date && (!a || r.date < a) ? r.date : a), null);

/** Where one stream's stored history starts being whole. */
function sinceOf(stream: Stream, rows: HistoryRow[]): string | null | undefined {
  if (stream.reach === "sample") return undefined;
  if (stream.reach === "all" || !rows.length) return null;
  const parts = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const k = stream.part ? stream.part(r) : "";
    (parts.get(k) ?? parts.set(k, []).get(k)!).push(r);
  }
  let since: string | null = null;
  for (const rs of parts.values()) {
    // a part holding fewer than the cap was stored whole at its first collection
    const s = stream.reach === "newest" && rs.length < (stream.cap ?? Infinity) ? null : oldest(rs);
    if (s && (!since || s > since)) since = s;
  }
  return since;
}

/** One dataset's event rows split into the streams its collector stores, each with where its history starts. */
export function eventHistory<T extends HistoryRow>(dataset: string, rows: T[]): StreamHistory<T>[] {
  const dated = rows.filter((r) => r.kind === "event" && r.date);
  const ctx: StreamContext = { frequentNotes: dataset === "capital" && dated.filter(isNote).length >= FREQUENT_NOTES };
  return (EVENT_STREAMS[dataset] ?? []).map((stream) => {
    const rs = dated.filter((r) => stream.has(r, ctx));
    return { stream, rows: rs, units: unitsOf(rs, stream.unit, stream.cluster), since: sinceOf(stream, rs), first: oldest(rs) };
  });
}

export interface CountSupport<T> {
  dataset: string;
  /** units that may be counted over time, newest first */
  units: Unit<T>[];
  /** the count is whole after this day; `null`: from the source's start */
  since: string | null;
  /** the oldest stored record of the counted streams; the rise rule compares only windows after it */
  first: string | null;
  /** nothing here can be counted over time */
  none: boolean;
  /** a window ending within this many days of today is a lower bound */
  lagDays: number;
  noun: [string, string];
  /** streams on file that are left out of the count: a sample, or a history that starts later than the main one */
  aside: StreamHistory<T>[];
}

/**
 * What may be counted over time in one dataset. The main stream sets where the count starts; another
 * stream joins only when its own history reaches at least as far back, otherwise it is set aside
 * (and can be shown with its own start). `watched` keeps only streams the unusual-rise rule may test.
 */
export function countSupport<T extends HistoryRow>(dataset: string, rows: T[], opts: { watched?: boolean; streams?: string[] } = {}): CountSupport<T> {
  const all = eventHistory(dataset, rows).filter((h) => (!opts.streams || opts.streams.includes(h.stream.id)) && (!opts.watched || h.stream.watch));
  // the main stream is the first one that can be counted and has anything on file
  const main = all.find((h) => h.since !== undefined && h.rows.length);
  const base = { dataset, lagDays: Math.max(0, ...all.map((h) => h.stream.lagDays)), noun: (main ?? all[0])?.stream.noun ?? (["record", "records"] as [string, string]) };
  if (!main) return { ...base, units: [], since: null, first: null, none: true, aside: all.filter((h) => h.rows.length) };
  const reaches = (h: StreamHistory<T>) => h.since !== undefined && (h.since === null || (main.since != null && h.since <= main.since));
  const inc = all.filter((h) => h === main || (h.rows.length > 0 && reaches(h)));
  const units = inc.flatMap((h) => h.units).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const first = inc.reduce<string | null>((a, h) => (h.first && (!a || h.first < a) ? h.first : a), null);
  return { ...base, units, since: main.since ?? null, first, none: false, lagDays: Math.max(...inc.map((h) => h.stream.lagDays)), aside: all.filter((h) => !inc.includes(h) && h.rows.length) };
}

export interface TrailingCount<T> {
  /** the stored history covers the whole window */
  whole: boolean;
  /** units in the window when whole, otherwise everything on file since the history starts */
  units: Unit<T>[];
  /** "12 months", or "since Sep 8, 2026" when the history starts inside the window */
  span: string;
  /** the window of the same length before, when the history covers it as well */
  before: Unit<T>[] | null;
}

const spanWords = (days: number) => (days === 365 ? "12 months" : days % 30 === 0 && days < 365 ? `${days / 30} months` : `${days} days`);

/** The units of a trailing window ending today, or what is on file when the history starts inside it. */
export function trailingCount<T extends HistoryRow>(s: CountSupport<T>, today: string, days = 365): TrailingCount<T> {
  const from = addDays(today, -days);
  const upTo = s.units.filter((u) => u.date <= today);
  if (s.none) return { whole: false, units: [], span: "on file", before: null };
  if (s.since != null && s.since > from) return { whole: false, units: upTo.filter((u) => u.date >= s.since!), span: `since ${dayLabel(s.since)}`, before: null };
  const prior = addDays(today, -2 * days);
  return {
    whole: true,
    units: upTo.filter((u) => u.date > from),
    span: spanWords(days),
    before: s.since == null || s.since <= prior ? upTo.filter((u) => u.date > prior && u.date <= from) : null,
  };
}

/** Rows of counted units, for a figure's evidence. */
export const rowsOf = <T>(units: Unit<T>[]): T[] => units.flatMap((u) => u.rows);

export const RISE_WINDOWS = 9;
export const RISE_DAYS = 90;
/** How far back a reader must fetch for the rise rule: the windows plus one more, to see whether the history starts before them. */
export const RISE_LOOKBACK_DAYS = (RISE_WINDOWS + 1) * RISE_DAYS;

/**
 * Units per 90-day window back from today (oldest first; the last is the latest 90 days), only for
 * the windows that lie wholly after the first stored record and inside the stored history, so every
 * window compared was collected the same way. An empty result means no such window.
 */
export function wholeWindows<T extends HistoryRow>(s: CountSupport<T>, today: string, windows = RISE_WINDOWS, days = RISE_DAYS): { counts: number[]; latest: Unit<T>[] } {
  if (s.none) return { counts: [], latest: [] };
  const counts: number[] = [];
  for (let j = windows - 1; j >= 0; j--) {
    const start = addDays(today, -(j + 1) * days);
    if ((s.since != null && s.since > start) || (s.first != null && s.first > start)) continue;
    const end = addDays(today, -j * days);
    counts.push(s.units.filter((u) => u.date > start && u.date <= end).length);
  }
  const from = addDays(today, -days);
  return { counts, latest: counts.length ? s.units.filter((u) => u.date > from && u.date <= today) : [] };
}

/* ---------------- series ---------------- */

/**
 * Whether a reading's period is still running or not yet settled: a year to date, a federal fiscal
 * year inside its reporting lag, a row dated in the future, or (monthly pageviews) the month in
 * progress. Such a reading is shown apart and is never compared, summed or tested.
 */
export function inProgress(r: { dataset?: string; date: string | null; meta?: PeriodMeta | null }, today: string): boolean {
  if (isPartial(r, today)) return true;
  return r.dataset === "attention" && !!r.date && r.date.slice(0, 7) >= today.slice(0, 7);
}

/** Readings of finished periods only. */
export const settled = <T extends { dataset?: string; date: string | null; meta?: PeriodMeta | null }>(rows: T[], today: string): T[] => rows.filter((r) => !inProgress(r, today));

/**
 * A rule for series: the latest finished reading against the range of the company's own earlier
 * readings. It says only what it checks: the reading is at least `factor` times the highest (or
 * below the lowest divided by `factor`) of the readings in the `days` before it.
 */
export interface RangeRule {
  dataset: string;
  title: string;
  /** what the reading is, for the sentence */
  what: string;
  /** earlier readings compared against: those dated within this many days before the latest */
  days: number;
  /** words for that span */
  span: string;
  /** readings needed in that span before the rule runs */
  minPrior: number;
  factor: number;
  /** and at least this far beyond the range, in the series' own unit (percentage points for rates) */
  minBeyond?: number;
  /** a rise needs the latest reading to be at least this */
  minLatest?: number;
  /** the median earlier reading must be at least this */
  minLevel?: number;
  sides: "up" | "both";
  /** year-to-date annualised rates are turned into single quarters first */
  quarterOnly?: boolean;
  /** how far back a cross-company reader must fetch to give the rule its history */
  readDays: number;
  /**
   * The latest reading is "now" only when it is at most this many days old: the newest period the
   * source can have published, plus a few days. A company whose newest row is older (a half-month
   * without fails has no row) is not tested on a stale reading.
   */
  currentDays: number;
}

export const RANGE_RULES: RangeRule[] = [
  // a half-month without fails has no row, so the span is in days and a year of dataset history is required (stored since November 2024)
  { dataset: "settlement", title: FTD_TITLE, what: "Fails to deliver averaged", days: 366, span: "the prior 12 months", minPrior: 12, factor: 5, minLatest: 5e6, sides: "up", readDays: 410, currentDays: 35 },
  { dataset: "attention", title: "Wikipedia pageviews", what: "Pageviews of", days: 735, span: "the prior 24 months", minPrior: 24, factor: 1.5, minLevel: 10_000, sides: "both", readDays: 800, currentDays: 62 },
  { dataset: "bank", title: "Net charge-off rate", what: "Net charge-offs in the quarter ran at about", days: 1840, span: "the prior five years", minPrior: 16, factor: 2, minBeyond: 0.1, sides: "up", quarterOnly: true, readDays: 2100, currentDays: 155 },
  { dataset: "bank", title: "Noncurrent loans / loans", what: "Noncurrent loans / loans at", days: 1840, span: "the prior five years", minPrior: 16, factor: 1.5, minBeyond: 0.1, sides: "up", readDays: 2000, currentDays: 155 },
];

export const rangeRulesOf = (dataset: string) => RANGE_RULES.filter((r) => r.dataset === dataset);

/* ---------------- freshness ---------------- */

/**
 * How old a dataset's newest record may be while the collector is still current, given how the
 * source publishes (a yearly file can be almost two years old the day before the next one appears).
 */
export const NEWEST_RECORD_MAX_AGE_DAYS: Record<string, number> = {
  events: 10, capital: 10, ownership: 10, regulatory: 10, trials: 10, complaints: 14, contracts: 21, fda: 30,
  recalls: 45, consumer: 75, settlement: 50, attention: 70, bank: 180, medicare: 330, deposits: 520, tri: 730, medicare_states: 900,
};

/** Whether the newest record is as recent as the source's own schedule allows. */
export function isCurrent(dataset: string, newest: string | null | undefined, today: string): boolean {
  return !!newest && daysBetween(newest, today) <= (NEWEST_RECORD_MAX_AGE_DAYS[dataset] ?? 60);
}

/** The newest finished period a dataset can hold today (pageviews: last month), so a row for a period in progress is not shown as the newest. */
export function newestFinished(dataset: string, newest: string | null | undefined, today: string): string | null {
  if (!newest) return null;
  if (dataset !== "attention" || newest.slice(0, 7) < today.slice(0, 7)) return newest;
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}
