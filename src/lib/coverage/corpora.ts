/**
 * Coverage ledger rules (pure): for one company and one corpus, what the app holds.
 *
 * A corpus is one kind of stored content (statements, calls, IR figures, supply links …). The
 * database measures each corpus per company (`corpus_measure`, migration 0087: how many items, the
 * newest date and a few facts); the rules here turn a measurement into a state and one sentence
 * saying why. `scripts/coverage.ts` runs them once a day and stores the result in `corpus_coverage`,
 * which the admin Data status page, the company tabs' empty states and the assistant read.
 *
 * States:
 *   full            everything the rule can check is stored. With 0 items it means "looked, and the
 *                   company has none" (a 10-K read that names no customer), never "not looked".
 *   partial         something is stored and something the rule names is missing or old
 *   none            nothing stored, and no record that there is nothing to store
 *   not_applicable  the corpus does not exist for this company (commitments need two calls)
 *   held            nothing stored and the lane that would fill it is stopped by the owner
 *
 * Every rule has a test. A rule never guesses: where the app keeps no record of having looked, the
 * state is `none` and the sentence says that it is not known whether anything exists.
 */
import { statementSector, type StatementSector } from "@/lib/financials/statement-layout";

export type CoverageState = "full" | "partial" | "none" | "not_applicable" | "held";
export const COVERAGE_STATES: readonly CoverageState[] = ["full", "partial", "none", "not_applicable", "held"];
/** One letter per state, for the matrix (one string per company, a letter per corpus). */
export const STATE_CODE: Record<CoverageState, string> = { full: "f", partial: "p", none: "n", not_applicable: "x", held: "h" };
export const STATE_OF_CODE: Record<string, CoverageState> = { f: "full", p: "partial", n: "none", x: "not_applicable", h: "held" };
export const STATE_LABEL: Record<CoverageState, string> = { full: "Complete", partial: "Partial", none: "Not stored", not_applicable: "Does not apply", held: "Stopped" };

/** What the database measured: items, newest date (YYYY-MM-DD) and corpus-specific facts. */
export interface Measure {
  n: number;
  d: string | null;
  x: Record<string, unknown>;
}
export interface CompanyLike {
  ticker: string;
  sector?: string;
  industry?: string;
}
export interface Ctx {
  /** the day of the check, YYYY-MM-DD */
  today: string;
  /** first filing date in the SEC index (the index is kept from this day on) */
  filingsFrom: string | null;
  /** lanes stopped by the owner, by lane id */
  held: ReadonlyMap<string, string>;
}
export interface Verdict {
  state: CoverageState;
  why: string;
}
export type CorpusGroup = "Filings" | "Markets" | "Investor relations" | "Calls" | "Supply chain" | "Research";
export interface CorpusDef {
  id: string;
  label: string;
  group: CorpusGroup;
  /** one sentence: what the corpus is and where it comes from */
  what: string;
  /** lanes that fill it: when one is stopped by the owner and nothing is stored, the state is `held` */
  lanes: readonly string[];
  /** the company tab that shows it (path after /app/companies/$ticker), when one does */
  tab?: string;
  /** facts the rule reads from another corpus's measurement of the same company (added to `x`) */
  from?: { corpus: string; take(other: Measure | undefined): Record<string, unknown> };
  judge(m: Measure, c: CompanyLike, ctx: Ctx): Verdict;
}

// ---------- small helpers ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-27" → "27 Nov 2026"; anything else is returned as it is. */
export function day(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
/** Whole days from `from` to `to` (both YYYY-MM-DD); null when either is not a date. */
export function daysBetween(from: string | null | undefined, to: string): number | null {
  const a = Date.parse(`${(from ?? "").slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
/** True when `d` is a date at most `days` before `today`. */
const within = (d: string | null, today: string, days: number) => {
  const age = daysBetween(d, today);
  return age != null && age <= days;
};
const v = (state: CoverageState, why: string): Verdict => ({ state, why });

// ---------- thresholds ----------

/** A company reports once a quarter: 92 days, plus the 43 a late report may take. */
export const QUARTER_DAYS = 135;
/** A registrant files something at least every quarter (10-Q or 10-K, usually an 8-K or Form 4 sooner). */
export const FILING_DAYS = 100;
/** Estimates and options are refreshed daily; a week covers holidays and a slow rotation. */
export const WEEK_DAYS = 7;
/** A long weekend: Wednesday's close is still the newest bar on the following Monday. */
export const PRICE_DAYS = 5;
/** IR figures: the newest period read should be one of the last two quarter ends. */
export const IR_PERIOD_DAYS = 200;
/** Fewer figures than this is a company the reader has barely started (one small table). */
export const IR_MIN_FIGURES = 200;
/** Calls: the last eight quarters, counted over two years and a month. */
export const CALL_WINDOW_DAYS = 760;
export const CALL_QUARTERS = 8;
/** Supply intelligence is re-read weekly in rotation. */
export const INTEL_DAYS = 45;

// ---------- statements: empty headline values ----------

export interface HeadlineDef {
  /** column of the screener file */
  id: string;
  label: string;
  applies(s: StatementSector, c: CompanyLike): boolean;
}
const all = () => true;
/**
 * Headline values every company with statements should have, read from the screener file. Only
 * values that cannot be empty by their own definition are listed, so an empty one is a defect:
 *   - latest quarter, market cap (price × cover-page shares), price to sales and net margin (both
 *     need revenue for the trailing four quarters), return on assets: every company;
 *   - operating margin: not banks, insurers, real estate trusts or other financial companies, which
 *     often print no operating income line.
 * Left out on purpose: P/E (no earnings), ROE and P/B (negative equity), growth (zero base), gross
 * margin (no cost-of-sales line), current ratio (unclassified balance sheet), enterprise value and
 * net debt (empty for a company without debt, and not calculated for financial companies).
 */
export const HEADLINES: readonly HeadlineDef[] = [
  { id: "lq_end", label: "latest quarter", applies: all },
  { id: "mcap", label: "market cap", applies: all },
  { id: "ps", label: "price to sales", applies: all },
  { id: "nm", label: "net margin", applies: all },
  { id: "roa", label: "return on assets", applies: all },
  { id: "om", label: "operating margin", applies: (s, c) => s !== "bank" && s !== "insurer" && s !== "reit" && !/^financials$/i.test(c.sector ?? "") },
];
/** Labels of the headline values that apply to the company and are empty in its screener row. */
export function emptyHeadlines(row: Record<string, unknown>, c: CompanyLike): string[] {
  const sector = statementSector(c);
  return HEADLINES.filter((h) => h.applies(sector, c) && (row[h.id] == null || row[h.id] === "")).map((h) => h.label);
}

// ---------- the corpora ----------

export const CORPORA: readonly CorpusDef[] = [
  {
    id: "statements",
    label: "Statements",
    group: "Filings",
    what: "Income statement, balance sheet and cash flow built from the company's SEC filings.",
    lanes: [],
    tab: "financials",
    judge(m) {
      const row = m.x["row"] === true;
      const empty = Array.isArray(m.x["empty"]) ? (m.x["empty"] as unknown[]).map(String) : [];
      const lq = str(m.x["lq_end"]);
      if (!row && !m.n) return v("none", "No statements are stored for this company.");
      if (!row) return v("partial", "A statements file is stored, but the company is missing from the screener file, so its headline values were not checked.");
      if (empty.length) return v("partial", `Statements are stored${lq ? ` through the quarter ended ${day(lq)}` : ""}; empty headline ${empty.length === 1 ? "value" : "values"}: ${empty.join(", ")}.`);
      return v("full", `Statements are stored through the quarter ended ${day(lq)}; every headline value that applies is filled.`);
    },
  },
  {
    id: "filing_detail",
    label: "Filing detail",
    group: "Filings",
    what: "Segment, customer and region figures tagged in the company's 10-K and 10-Q filings.",
    lanes: ["loop:detail"],
    tab: "financials",
    judge(m) {
      if (m.n) return v("full", `Tagged segment, customer and region detail is stored (file of ${day(m.d)}).`);
      return v("none", "The tagged detail of this company's filings has not been read yet.");
    },
  },
  {
    id: "filings",
    label: "SEC filing index",
    group: "Filings",
    what: "Every filing of the company as SEC lists it, kept from the day the index began.",
    lanes: ["loop:sec-catchup"],
    tab: "filings",
    judge(m, _c, ctx) {
      const from = ctx.filingsFrom ? ` (kept from ${day(ctx.filingsFrom)})` : "";
      if (!m.n) return v("none", `No filing of this company is in the SEC index${from}.`);
      if (within(m.d, ctx.today, FILING_DAYS)) return v("full", `${plural(m.n, "filing")} indexed${from}; newest ${day(m.d)}.`);
      return v("partial", `The newest indexed filing is from ${day(m.d)}. A company files at least once a quarter, so newer filings are probably missing.`);
    },
  },
  {
    id: "releases",
    label: "Earnings releases",
    group: "Filings",
    what: "The 8-K filings (Item 2.02) that carry each quarter's results.",
    lanes: [],
    tab: "earnings",
    judge(m, _c, ctx) {
      if (!m.n) return v("none", "No earnings release (8-K, Item 2.02) is stored for this company.");
      if (within(m.d, ctx.today, QUARTER_DAYS)) return v("full", `${plural(m.n, "earnings release")} stored; newest ${day(m.d)}.`);
      return v("partial", `The newest stored earnings release is from ${day(m.d)}, more than a quarter and a half ago.`);
    },
  },
  {
    id: "redlines",
    label: "Filing changes",
    group: "Filings",
    what: "Each 10-K and 10-Q compared with the one before it, paragraph by paragraph.",
    lanes: ["loop:filing-steps"],
    tab: "redline",
    // the newest 10-K or 10-Q in the SEC index: a comparison older than it is behind
    from: { corpus: "filings", take: (f) => ({ report: f?.x["report"] ?? null }) },
    judge(m) {
      const report = str(m.x["report"]);
      if (!m.n) return v("none", "No pair of this company's filings has been compared yet.");
      if (report && m.d && m.d < report) return v("partial", `Changes are compared through the filing of ${day(m.d)}; a newer report was filed on ${day(report)}.`);
      return v("full", `${plural(m.n, "filing pair")} compared; newest filing ${day(m.d)}.`);
    },
  },
  {
    id: "insiders",
    label: "Insider trades",
    group: "Filings",
    what: "Transactions reported by officers and directors on Form 4.",
    lanes: ["loop:form4-repair"],
    tab: "insiders",
    judge(m, _c, ctx) {
      const indexed = num(m.x["indexed"]);
      const unread = Math.max(0, indexed - num(m.x["read"]));
      const from = ctx.filingsFrom ? ` (kept from ${day(ctx.filingsFrom)})` : "";
      const since = str(m.x["since"]);
      if (!m.n && !indexed) return v("none", `No insider transaction is stored, and no Form 4 of this company is in the SEC index${from}. Earlier filings were not collected.`);
      if (!m.n && unread) return v("none", `${plural(indexed, "Form 4 filing")} of this company ${indexed === 1 ? "is" : "are"} indexed and ${unread === indexed ? "not read yet" : `${int(unread)} are not read yet`}.`);
      if (!m.n) return v("full", `The ${plural(indexed, "indexed Form 4 filing")} ${indexed === 1 ? "was" : "were"} read: ${indexed === 1 ? "it reports" : "they report"} no share transaction.`);
      if (unread) return v("partial", `${plural(m.n, "transaction")} stored; ${int(unread)} of ${plural(indexed, "indexed Form 4 filing")} ${unread === 1 ? "is" : "are"} not read yet.`);
      return v("full", `${plural(m.n, "transaction")} stored${since ? ` since ${day(since)}` : ""}; every indexed Form 4 is read.`);
    },
  },
  {
    id: "prices",
    label: "Prices",
    group: "Markets",
    what: "Daily prices: the long history file and the official daily bars stored since.",
    lanes: [],
    judge(m, _c, ctx) {
      const file = m.x["file"] === true;
      if (!m.n && !file) return v("none", "No price history is stored for this company.");
      if (!m.n) return v("partial", "The price history file is stored; no official daily bar has been stored since.");
      if (within(m.d, ctx.today, PRICE_DAYS)) return v("full", `Daily prices are stored through ${day(m.d)}.`);
      return v("partial", `The newest stored daily bar is from ${day(m.d)}.`);
    },
  },
  {
    id: "estimates",
    label: "Analyst estimates",
    group: "Markets",
    what: "Consensus estimates, price targets and rating changes.",
    lanes: [],
    tab: "estimates",
    judge(m, _c, ctx) {
      const noneAt = str(m.x["none_at"]);
      if (!m.n && noneAt) return v("not_applicable", `The estimates provider listed no analyst coverage for this company when last asked (${day(noneAt)}).`);
      if (!m.n) return v("none", "No analyst estimates are stored. It is not recorded whether any analyst covers this company.");
      if (within(m.d, ctx.today, WEEK_DAYS)) return v("full", `Analyst estimates were refreshed on ${day(m.d)}.`);
      return v("partial", `Analyst estimates were last refreshed on ${day(m.d)}.`);
    },
  },
  {
    id: "options",
    label: "Options",
    group: "Markets",
    what: "One summary of the option chain per trading day: implied volatility, skew, put and call activity.",
    lanes: ["loop:options-night"],
    judge(m, _c, ctx) {
      const noneAt = str(m.x["none_at"]);
      if (!m.n && noneAt) return v("not_applicable", `The source listed no options for this company when last looked (${day(noneAt)}).`);
      if (!m.n) return v("none", "No options day is stored. It is not recorded whether this company has listed options.");
      if (within(m.d, ctx.today, WEEK_DAYS)) return v("full", `${plural(m.n, "trading day")} stored; newest ${day(m.d)}.`);
      return v("partial", `${plural(m.n, "trading day")} stored; the newest is ${day(m.d)}.`);
    },
  },
  {
    id: "alt_data",
    label: "Alt data",
    group: "Markets",
    what: "Public datasets matched to the company: contracts, recalls, trials, settlement fails and others.",
    lanes: ["loop:alt-slow"],
    tab: "alt-data",
    judge(m) {
      const sets = num(m.x["datasets"]);
      if (!m.n) return v("none", "No public alt data is matched to this company yet.");
      return v("full", `${plural(m.n, "record")} in ${plural(sets, "dataset")}; newest ${day(m.d)}.`);
    },
  },
  {
    id: "ir_documents",
    label: "IR documents",
    group: "Investor relations",
    what: "Releases, supplements, presentations and data files from the company's 8-K exhibits and its own site.",
    lanes: ["loop:ir-site", "loop:mirror"],
    tab: "filings",
    judge(m, _c, ctx) {
      const undated = num(m.x["undated"]);
      const tail = undated ? ` ${int(undated)} of them have no date.` : "";
      if (!m.n) return v("none", "No investor-relations document is stored for this company.");
      if (!m.d) return v("partial", `${plural(m.n, "document")} stored, none with a date.`);
      if (within(m.d, ctx.today, QUARTER_DAYS)) return v("full", `${plural(m.n, "document")} stored; newest dated ${day(m.d)}.${tail}`);
      return v("partial", `${plural(m.n, "document")} stored; the newest dated one is from ${day(m.d)}, more than a quarter and a half ago.${tail}`);
    },
  },
  {
    id: "ir_figures",
    label: "IR figures",
    group: "Investor relations",
    what: "Figures read from the company's own documents, each with the cell or line it was read from.",
    lanes: ["loop:company"],
    tab: "ir",
    judge(m, _c, ctx) {
      const built = str(m.x["built"]);
      if (!m.n) return v("none", "No figures have been read from this company's documents yet.");
      if (m.n < IR_MIN_FIGURES) return v("partial", `${plural(m.n, "figure")} read so far; the documents are not read through yet.`);
      if (!built) return v("partial", `${plural(m.n, "figure")} are read, but the series for the IR page are not built yet.`);
      if (!within(m.d, ctx.today, IR_PERIOD_DAYS)) return v("partial", `${plural(m.n, "figure")} read, through the period ended ${day(m.d)}; newer quarters are not read yet.`);
      return v("full", `${plural(m.n, "figure")} read, through the period ended ${day(m.d)}.`);
    },
  },
  {
    id: "calls",
    label: "Call transcripts",
    group: "Calls",
    what: "Earnings calls as speaker turns, from the issuer's own published transcript.",
    lanes: ["call-source-worker", "call-discovery-worker"],
    tab: "calls",
    judge(m, _c, ctx) {
      const store = num(m.x["store"]);
      const checked = str(m.x["checked"]);
      const recent = Math.min(CALL_QUARTERS, num(m.x["recent"]));
      if (!m.n && store) return v("none", `No call can be read yet: ${plural(store, "transcript file")} of this company ${store === 1 ? "is" : "are"} stored and not yet turned into speaker turns.`);
      if (!m.n && checked) return v("none", `No call is stored. The company's own site was searched on ${day(checked)} and no transcript was found.`);
      if (!m.n) return v("none", "No call is stored, and none has been searched for yet.");
      if (recent >= CALL_QUARTERS && within(m.d, ctx.today, QUARTER_DAYS)) return v("full", `${plural(m.n, "call")} stored; each of the last eight quarters has one (newest ${day(m.d)}).`);
      return v("partial", `${plural(m.n, "call")} stored (newest ${day(m.d)}); ${recent} of the last eight quarters ${recent === 1 ? "has" : "have"} one.`);
    },
  },
  {
    id: "promises",
    label: "Commitments",
    group: "Calls",
    what: "What management committed to on its calls, each with its quote and what happened since.",
    lanes: ["call-commitments-worker"],
    tab: "earnings",
    from: { corpus: "calls", take: (calls) => ({ calls: calls?.n ?? 0, call_newest: calls?.d ?? null }) },
    judge(m) {
      const calls = num(m.x["calls"]);
      const newestCall = str(m.x["call_newest"]);
      const read = m.x["read"] === true;
      if (calls < 2) return v("not_applicable", `Commitments are tracked across at least two stored calls; this company has ${calls === 0 ? "none" : "one"}.`);
      if (!read) return v("none", "The commitments in this company's stored calls have not been read yet.");
      if (str(m.x["error"])) return v("partial", "The last reading of this company's commitments did not finish.");
      if (newestCall && m.d && m.d < newestCall) return v("partial", `Commitments are read through the call of ${day(m.d)}; a newer call (${day(newestCall)}) is stored.`);
      if (!m.n) return v("full", `The calls through ${day(m.d)} were read: no commitment in them could be verified word for word.`);
      return v("full", `${plural(m.n, "commitment")} tracked through the call of ${day(m.d)}.`);
    },
  },
  {
    id: "supply_links",
    label: "Supply links",
    group: "Supply chain",
    what: "Customers, suppliers and partners named in the company's 10-K and 10-Q, each with its sentence.",
    lanes: ["loop:filing-steps"],
    // the newest 10-K in the SEC index: links from an older one are behind until it is read
    from: { corpus: "filings", take: (f) => ({ annual: f?.x["annual"] ?? null }) },
    judge(m) {
      const scanFiled = str(m.x["scan_filed"]);
      const scanAt = str(m.x["scan_at"]);
      const scanForm = str(m.x["scan_form"]) ?? "10-K";
      const annual = str(m.x["annual"]);
      const history = num(m.x["history"]);
      const covered = [m.d, scanFiled].filter((d): d is string => !!d).sort().pop() ?? null;
      // the newest 10-K on record as read gave no link: looked, and there is none
      if (!m.n && scanFiled && num(m.x["scan_links"]) === 0) {
        return v("full", `The ${scanForm} filed ${day(scanFiled)} was read${scanAt ? ` on ${day(scanAt)}` : ""}: it names no customer, supplier or partner.${history ? ` ${plural(history, "link")} from older filings ${history === 1 ? "is" : "are"} kept as history.` : ""}`);
      }
      // links exist, but only from filings that are no longer the current ones
      if (!m.n && history) return v("partial", `No current link: the ${plural(history, "stored link")} ${history === 1 ? "comes" : "come"} from older filings (newest filed ${day(str(m.x["history_newest"]))}).`);
      if (!m.n) return v("none", "No filing of this company has been read for supply links yet.");
      if (annual && covered && covered < annual) return v("partial", `${plural(m.n, "current link")} from filings through ${day(covered)}; the 10-K filed ${day(annual)} is not read yet.`);
      return v("full", `${plural(m.n, "current link")}, from filings through ${day(m.d)}.`);
    },
  },
  {
    id: "concentration",
    label: "Tagged customer shares",
    group: "Supply chain",
    what: "Customer and supplier shares the company tags in its filings' XBRL.",
    lanes: ["loop:detail"],
    judge(m) {
      if (m.n) return v("full", `${plural(m.n, "tagged share")} of customers or suppliers; newest filing ${day(m.d)}.`);
      if (m.x["file"] === true) return v("full", "The tagged detail of the company's filings was read: no customer or supplier share is tagged.");
      return v("none", "The tagged detail of this company's filings has not been read yet.");
    },
  },
  {
    id: "supply_intel",
    label: "Supply intelligence",
    group: "Supply chain",
    what: "Supply-chain statements from filings and calls: capacity, shortages, pricing, concentration.",
    lanes: ["loop:filing-steps"],
    judge(m, _c, ctx) {
      if (!m.n) return v("none", "Supply-chain intelligence has not been read for this company yet.");
      if (within(m.d, ctx.today, INTEL_DAYS)) return v("full", `${plural(m.n, "statement")} stored; last read ${day(m.d)}.`);
      return v("partial", `${plural(m.n, "statement")} stored; last read ${day(m.d)}, more than six weeks ago.`);
    },
  },
  {
    id: "reports",
    label: "Reports",
    group: "Research",
    what: "The written reports of the library, every sentence checked against sourced facts.",
    lanes: ["loop:reports"],
    tab: "reports",
    judge(m) {
      const kinds = Array.isArray(m.x["kinds"]) ? (m.x["kinds"] as unknown[]).map(String) : [];
      const failed = Array.isArray(m.x["failed"]) ? (m.x["failed"] as unknown[]).map(String) : [];
      if (!m.n) return v("none", failed.length ? `No report is stored; the last attempt (${failed.join(", ")}) failed.` : "No report is stored for this company.");
      if (!kinds.includes("primer")) return v("partial", `Stored: ${kinds.join(", ")}. The primer is missing${failed.includes("primer") ? " (its last attempt failed)" : ""}.`);
      return v("full", `Stored: ${kinds.join(", ")}; newest ${day(m.d)}.`);
    },
  },
];

export const CORPUS_IDS: readonly string[] = CORPORA.map((c) => c.id);
/** The corpus ids by name, for the pages that ask about one (a typo fails to compile). */
export const CORPUS = {
  statements: "statements",
  filingDetail: "filing_detail",
  filings: "filings",
  releases: "releases",
  redlines: "redlines",
  insiders: "insiders",
  prices: "prices",
  estimates: "estimates",
  options: "options",
  altData: "alt_data",
  irDocuments: "ir_documents",
  irFigures: "ir_figures",
  calls: "calls",
  promises: "promises",
  supplyLinks: "supply_links",
  concentration: "concentration",
  supplyIntel: "supply_intel",
  reports: "reports",
} as const;
export type CorpusId = (typeof CORPUS)[keyof typeof CORPUS];
export const corpusOf = (id: string): CorpusDef | undefined => CORPORA.find((c) => c.id === id);
export const NO_MEASURE: Measure = { n: 0, d: null, x: {} };

export interface CoverageRow {
  ticker: string;
  corpus: string;
  state: CoverageState;
  items: number;
  newest: string | null;
  why: string;
}

/**
 * The stored row for one company and corpus. A corpus with nothing stored whose lane the owner has
 * stopped is `held`; a partial one says so in its sentence and stays partial (what is stored is real).
 */
export function judge(def: CorpusDef, m: Measure | undefined, c: CompanyLike, ctx: Ctx): CoverageRow {
  const measure = m ?? NO_MEASURE;
  const verdict = def.judge(measure, c, ctx);
  const stopped = def.lanes.find((l) => ctx.held.has(l));
  let { state, why } = verdict;
  if (stopped && state === "none") {
    state = "held";
    why = `${why} Its collection is stopped by the owner.`;
  } else if (stopped && state === "partial") {
    why = `${why} Its collection is stopped by the owner.`;
  }
  return { ticker: c.ticker, corpus: def.id, state, items: measure.n, newest: measure.d, why };
}

/** What a tab says when it has nothing to show, from the ledger row (null: say nothing special). */
export function emptyNote(row: Pick<CoverageRow, "state" | "why" | "items"> | null | undefined): { title: string; body: string } | null {
  if (!row) return null;
  if (row.state === "not_applicable") return { title: "Does not apply to this company", body: row.why };
  if (row.state === "held") return { title: "Not stored: collection is stopped", body: row.why };
  if (row.state === "none") return { title: "Not stored yet", body: row.why };
  if (row.state === "full" && row.items === 0) return { title: "Checked: there is none", body: row.why };
  return null;
}

/** Counts by state for one corpus, in the order of COVERAGE_STATES. */
export function tally(states: Iterable<CoverageState>): Record<CoverageState, number> {
  const out: Record<CoverageState, number> = { full: 0, partial: 0, none: 0, not_applicable: 0, held: 0 };
  for (const s of states) out[s]++;
  return out;
}
