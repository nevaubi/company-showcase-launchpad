/**
 * What the admin Data status page shows of the coverage ledger (pure): corpus summaries, the
 * company matrix, its filters and the page's search params. Rules: ./corpora.ts.
 */
import { CORPORA, COVERAGE_STATES, STATE_OF_CODE, corpusOf, type CorpusDef, type CoverageState } from "./corpora";

/** `corpus_coverage_matrix()`: one string per company, one letter per corpus in the order of `corpora`. */
export interface MatrixPayload {
  checked: string | null;
  corpora: string[];
  rows: Record<string, string>;
  /** [day, corpus, state, companies, items] for the last 30 days */
  daily: [string, string, string, number, number][];
}
/** `corpus_coverage_rows(corpus)`: every company's row of one corpus. */
export interface CorpusRow {
  t: string;
  s: CoverageState;
  n: number;
  d: string | null;
  w: string;
}

export interface CorpusSummary {
  def: CorpusDef;
  counts: Record<CoverageState, number>;
  /** companies the corpus applies to (all less "does not apply") */
  applies: number;
  /** complete, as a share of the companies it applies to; null when it applies to none */
  share: number | null;
  /** change in the number of complete companies since the earliest day on record within a week; null without an earlier day */
  weekChange: number | null;
  /** the day `weekChange` is measured from */
  weekFrom: string | null;
}

const zero = (): Record<CoverageState, number> => ({ full: 0, partial: 0, none: 0, not_applicable: 0, held: 0 });

/** Counts per corpus, in the order of the rules; a corpus the ledger does not hold yet is left out. */
export function summaries(p: MatrixPayload): CorpusSummary[] {
  const at = new Map(p.corpora.map((id, i) => [id, i]));
  const days = [...new Set(p.daily.map((d) => d[0]))].sort();
  const newest = days[days.length - 1] ?? null;
  const out: CorpusSummary[] = [];
  for (const def of CORPORA) {
    const i = at.get(def.id);
    if (i == null) continue;
    const counts = zero();
    for (const codes of Object.values(p.rows)) {
      const s = STATE_OF_CODE[codes[i] ?? ""];
      if (s) counts[s]++;
    }
    const applies = counts.full + counts.partial + counts.none + counts.held;
    // the earliest day within seven days of the newest one, other than the newest itself
    const from = newest ? days.find((d) => d < newest && Date.parse(newest) - Date.parse(d) <= 7 * 86_400_000) ?? null : null;
    const before = from ? p.daily.find((d) => d[0] === from && d[1] === def.id && d[2] === "full")?.[3] ?? 0 : null;
    out.push({ def, counts, applies, share: applies ? counts.full / applies : null, weekChange: before == null ? null : counts.full - before, weekFrom: from });
  }
  return out;
}

export interface CompanyCells {
  ticker: string;
  /** one state per corpus, in the order of `ids`; null when the ledger has no row */
  cells: (CoverageState | null)[];
  /** corpora with nothing stored (not stored or stopped) */
  gaps: number;
  partial: number;
}

/** The matrix: every company's states, with the corpus ids in the order the rules list them. */
export function matrix(p: MatrixPayload): { ids: string[]; rows: CompanyCells[] } {
  const at = new Map(p.corpora.map((id, i) => [id, i]));
  const ids = CORPORA.map((c) => c.id).filter((id) => at.has(id));
  const rows = Object.entries(p.rows)
    .map(([ticker, codes]) => {
      const cells = ids.map((id) => STATE_OF_CODE[codes[at.get(id)!] ?? ""] ?? null);
      return { ticker, cells, gaps: cells.filter((s) => s === "none" || s === "held").length, partial: cells.filter((s) => s === "partial").length };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { ids, rows };
}

export type CoverageSort = "ticker" | "gaps";
export interface CoverageSearch {
  /** the corpus looked at; "" for the whole matrix */
  corpus: string;
  /** only companies in this state ("" for all): of the corpus when one is chosen, of any corpus otherwise */
  state: CoverageState | "";
  q: string;
  sort: CoverageSort;
  /** the company whose rows are open */
  co: string;
}
export const COVERAGE_SEARCH: CoverageSearch = { corpus: "", state: "", q: "", sort: "ticker", co: "" };

/** The page's search params, read leniently: anything unknown falls back to the default. */
export function coverageSearch(s: Record<string, unknown>): CoverageSearch {
  const text = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : "");
  const corpus = corpusOf(text("corpus")) ? text("corpus") : "";
  const state = (COVERAGE_STATES as readonly string[]).includes(text("state")) ? (text("state") as CoverageState) : "";
  const co = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(text("co")) ? text("co").toUpperCase() : "";
  return { corpus, state, q: text("q").slice(0, 40), sort: text("sort") === "gaps" ? "gaps" : "ticker", co };
}

/** The companies the filters leave, in the chosen order. `names` gives each ticker's name for the search. */
export function filterMatrix(rows: readonly CompanyCells[], ids: readonly string[], f: Pick<CoverageSearch, "corpus" | "state" | "q" | "sort">, names: ReadonlyMap<string, string>): CompanyCells[] {
  const q = f.q.trim().toLowerCase();
  const col = f.corpus ? ids.indexOf(f.corpus) : -1;
  const out = rows.filter((r) => {
    if (q && !r.ticker.toLowerCase().startsWith(q) && !(names.get(r.ticker) ?? "").toLowerCase().includes(q)) return false;
    if (!f.state) return true;
    return col >= 0 ? r.cells[col] === f.state : r.cells.includes(f.state);
  });
  if (f.sort === "gaps") out.sort((a, b) => b.gaps - a.gaps || b.partial - a.partial || a.ticker.localeCompare(b.ticker));
  return out;
}

/** "+12", "−3", "0": a change in a count, with a true minus. */
export const signed = (n: number) => (n > 0 ? `+${n.toLocaleString("en-US")}` : n < 0 ? `−${Math.abs(n).toLocaleString("en-US")}` : "0");
/** "62%": a share of companies, without decimals; under one percent but not zero reads "<1%". */
export const pct = (share: number | null) => (share == null ? "–" : share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);
