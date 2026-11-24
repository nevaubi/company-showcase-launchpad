// The sector overview's comparison board and its relative-performance panels, built from the partner's
// sectors.json (cap-weighted returns, fundamentals, valuation range), the member tape (breadth and
// volatility from setup_series), the markets file (earnings moves, chart signals) and the sector ETFs'
// closes. The board has three column sets: overview, fundamentals, and risk and signals. Pure.
import type { GroupSummary, Overview } from "./groups";
import { groupTape, type GroupTape, type MemberTape } from "./breadth";
import { membersOf, type Member } from "./members";
import { groupMarket, type Based, type GroupSignals, type MarketIndex } from "./risk";
import { compareNullable, type SortDir } from "./stats";

export { membersOf, type Member } from "./members";

export const WINDOWS = ["1W", "1M", "3M", "YTD", "1Y"] as const;
export type Win = (typeof WINDOWS)[number];

/** A figure of the latest reported quarter, with that quarter and the number of companies behind it. */
export interface Cell {
  v: number | null;
  q: string | null;
  n: number | null;
}

/** Aggregates the pipeline publishes per group for its latest quarter (etl/sectors.py METRICS). */
export const FUND_KEYS = ["rev_ttm", "rev_growth", "ni_growth", "gm", "om", "nm", "fcfm", "roic", "nd_ebitda"] as const;
export type FundKey = (typeof FUND_KEYS)[number];

export interface BoardRow {
  slug: string;
  name: string;
  kind: "sector" | "industry";
  sector: string;
  etf: string | null;
  /** Members on the page's member list; every breadth share on the page is counted over these. */
  n: number;
  mcap: number | null;
  /** Cap-weighted return of the group's companies per window. */
  ret: Record<Win, number | null>;
  /** The same minus SPY's return over the window. */
  excess: Record<Win, number | null>;
  /** Roll-up of the member tape. Null only when the tape did not load at all; then `above200` is the pipeline's own share. */
  tape: GroupTape | null;
  above200: number | null;
  nearHigh: number | null;
  /** Latest-quarter aggregates: Σ numerator ÷ Σ denominator over the members reporting both. */
  f: Record<FundKey, Cell>;
  /** Aggregate multiples on today's market caps (Σ market cap ÷ Σ trailing figure) and the companies behind them. */
  pe: number | null;
  ps: number | null;
  /** Σ free cash flow ÷ Σ market cap, the inverse of the aggregate P/FCF. */
  fcfYield: number | null;
  valN: number | null;
  /** Set when the file has no current multiples and the latest quarter's (quarter-end caps) stand in. */
  valQuarter: string | null;
  /** Where today's aggregate P/E sits in its own 10-year quarterly range, 0 to 1. */
  pePct: number | null;
  /** Latest calendar quarter the fundamentals describe. */
  q: string | null;
  /** Share of the group's market cap in its five largest members. */
  top5: number | null;
  /** Cross-sectional standard deviation of the members' 21-day returns. */
  disp: number | null;
  /** Median 60-day volatility of the members, annualised. */
  vol: number | null;
  /** From the markets file; null until it has loaded. */
  earnings: Based | null;
  signals: GroupSignals | null;
  /** Members present in the markets file. */
  covered: number | null;
}

const cell = (g: GroupSummary, k: string): Cell => {
  const l = g.latest?.[k];
  return { v: l?.[1] ?? null, q: l?.[0] ?? null, n: l?.[2] ?? null };
};

export function boardRows(
  ov: Overview,
  level: "sector" | "industry",
  list: readonly Member[],
  tape?: ReadonlyMap<string, MemberTape> | null,
  market?: MarketIndex | null,
): BoardRow[] {
  const tapeOn = !!tape && tape.size > 0;
  return ov.groups
    .filter((g) => g.kind === level)
    .map((g) => {
      const ret = Object.fromEntries(WINDOWS.map((w) => [w, g.returns?.cw?.[w] ?? null])) as Record<Win, number | null>;
      const excess = Object.fromEntries(
        WINDOWS.map((w) => {
          const s = ov.spy_returns?.[w];
          return [w, ret[w] != null && s != null ? ret[w]! - s : null];
        }),
      ) as Record<Win, number | null>;
      const members = membersOf(g.kind, g.name, g.sector, list);
      // One rule for the whole page: with the tape, a group's breadth is its members' own rows and nothing
      // else; without it, the pipeline's share for every group.
      const t = tapeOn ? groupTape(members, tape!) : null;
      const m = market ? groupMarket(members, market) : null;
      const pfcf = g.val_now?.pfcf ?? g.latest?.pfcf?.[1] ?? null;
      const today = g.val_now?.pe != null;
      return {
        slug: g.slug,
        name: g.name,
        kind: g.kind,
        sector: g.sector,
        etf: g.etf ?? null,
        n: members.length || g.n,
        mcap: g.mcap,
        ret,
        excess,
        tape: t,
        above200: t ? t.above200.share : (g.breadth?.b200 ?? null),
        nearHigh: t ? t.nearHigh.share : null,
        f: Object.fromEntries(FUND_KEYS.map((k) => [k, cell(g, k)])) as Record<FundKey, Cell>,
        pe: g.val_now?.pe ?? g.latest?.pe?.[1] ?? null,
        ps: g.val_now?.ps ?? g.latest?.ps?.[1] ?? null,
        fcfYield: pfcf != null && pfcf > 0 ? 1 / pfcf : null,
        valN: today ? (g.val_now?.n ?? null) : (g.latest?.pe?.[2] ?? null),
        valQuarter: today ? null : (g.latest?.pe?.[0] ?? null),
        pePct: g.pe_range?.pct ?? null,
        q: g.latest?.rev_growth?.[0] ?? g.q ?? null,
        top5: g.top5 ?? null,
        disp: g.disp ?? null,
        vol: t?.vol ?? null,
        earnings: m?.earnings ?? null,
        signals: m?.signals ?? null,
        covered: m?.covered ?? null,
      };
    });
}

/** The quarter every row's fundamentals describe, or null when the rows do not share one. */
export function sharedQuarter(rows: readonly Pick<BoardRow, "q">[]): string | null {
  const qs = new Set(rows.map((r) => r.q).filter((q): q is string => !!q));
  return qs.size === 1 ? [...qs][0] : null;
}

/** Companies on the list without a tape row, over all rows of one level (each company is in one row). */
export const withoutTapeRow = (rows: readonly Pick<BoardRow, "tape">[]) => rows.reduce((s, r) => s + (r.tape?.noRow ?? 0), 0);

/* ---------- column sets and sorting ---------- */
export const BOARD_SETS = {
  overview: ["mcap", "r1W", "r1M", "r3M", "rYTD", "r1Y", "a200", "nh", "rev", "om", "roic", "pe", "pep"],
  fundamentals: ["revttm", "rev", "ni", "gm", "om", "nm", "fcfm", "roic", "nde", "pe", "ps", "fcfy"],
  risk: ["mcap", "r3M", "vol", "disp", "top5", "em", "sig", "bull", "bear"],
} as const;
export type BoardSet = keyof typeof BOARD_SETS;
export const BOARD_SET_KEYS = Object.keys(BOARD_SETS) as BoardSet[];
const SET_DEFAULT: Record<BoardSet, BoardSort> = { overview: "r3M", fundamentals: "revttm", risk: "vol" };

export const BOARD_SORTS = ["name", ...new Set(Object.values(BOARD_SETS).flat())] as const as readonly BoardSort[];
export type BoardSort = "name" | (typeof BOARD_SETS)[BoardSet][number];

/**
 * The sort that applies: the asked column when the open column set shows it, else the set's own default,
 * so a table is never ordered by a column that is not on screen.
 */
export function boardSort(set: BoardSet, sort: string | undefined, dir: SortDir | undefined): { sort: BoardSort; dir: SortDir } {
  const shown = sort === "name" || (BOARD_SETS[set] as readonly string[]).includes(sort ?? "");
  if (shown) return { sort: sort as BoardSort, dir: dir ?? (sort === "name" ? "asc" : "desc") };
  return { sort: SET_DEFAULT[set], dir: "desc" };
}

/**
 * Columns each set gives up first when the board does not fit its wrapper (below about 1400 px), least
 * useful first. A board that fits needs no sideways scroller, so its head can stick to the page.
 */
export const BOARD_DROP: Record<BoardSet, readonly BoardSort[]> = {
  overview: ["r1W", "rYTD", "pep", "nh", "roic", "om"],
  fundamentals: ["nm", "ps", "fcfm", "ni", "nde", "gm"],
  risk: ["top5", "bull", "bear", "disp"],
};

/**
 * The board's columns at a wrapper width of `avail` px with a name column of `nameW` px: drop columns in
 * `drop` order (never the sorted one) until the table fits. When it still does not fit (a phone), the
 * wrapper scrolls sideways; if the sorted column would then start off screen it moves to the front, so the
 * column the rows are ordered by is always in view. An unmeasured wrapper (0) keeps every column.
 */
export function fitBoard<C extends { k: BoardSort; w: number }>(cols: readonly C[], drop: readonly BoardSort[], sort: BoardSort, avail: number, nameW: number): C[] {
  let out = [...cols];
  if (!(avail > 0)) return out;
  const total = () => nameW + out.reduce((s, c) => s + c.w, 0);
  for (const k of drop) {
    if (total() <= avail) break;
    if (k !== sort) out = out.filter((c) => c.k !== k);
  }
  if (total() > avail && sort !== "name") {
    const i = out.findIndex((c) => c.k === sort);
    const right = nameW + out.slice(0, i + 1).reduce((s, c) => s + c.w, 0);
    if (i > 0 && right > avail) out = [out[i], ...out.slice(0, i), ...out.slice(i + 1)];
  }
  return out;
}

/** Share of the members in the markets file with at least one live chart signal. */
export const signalShare = (r: Pick<BoardRow, "signals" | "covered">) => (r.signals && r.covered ? r.signals.companies / r.covered : null);

export function boardKey(r: BoardRow, k: BoardSort): number | string | null {
  switch (k) {
    case "name":
      return r.name;
    case "mcap":
      return r.mcap;
    case "a200":
      return r.above200;
    case "nh":
      return r.nearHigh;
    case "revttm":
      return r.f.rev_ttm.v;
    case "rev":
      return r.f.rev_growth.v;
    case "ni":
      return r.f.ni_growth.v;
    case "gm":
      return r.f.gm.v;
    case "om":
      return r.f.om.v;
    case "nm":
      return r.f.nm.v;
    case "fcfm":
      return r.f.fcfm.v;
    case "roic":
      return r.f.roic.v;
    case "nde":
      return r.f.nd_ebitda.v;
    case "pe":
      return r.pe;
    case "ps":
      return r.ps;
    case "fcfy":
      return r.fcfYield;
    case "pep":
      return r.pePct;
    case "vol":
      return r.vol;
    case "disp":
      return r.disp;
    case "top5":
      return r.top5;
    case "em":
      return r.earnings?.v ?? null;
    case "sig":
      return signalShare(r);
    case "bull":
      return r.signals && r.covered ? r.signals.bullish : null;
    case "bear":
      return r.signals && r.covered ? r.signals.bearish : null;
    default:
      return r.ret[k.slice(1) as Win];
  }
}

export function sortBoard(rows: readonly BoardRow[], k: BoardSort, dir: SortDir): BoardRow[] {
  return [...rows].sort((a, b) => compareNullable(boardKey(a, k), boardKey(b, k), dir) || a.name.localeCompare(b.name));
}

/** Bars as [date, adjusted close] pairs. */
export type Closes = readonly (readonly [string, number])[];

/**
 * Price of `a` relative to `b`, rebased to 0 at the first shared date of the last `n` shared sessions:
 * (a_t / a_0) / (b_t / b_0) − 1. Above zero means `a` beat `b` over the span.
 */
export function relativeSeries(a: Closes, b: Closes, n: number): { date: string; v: number }[] {
  const bm = new Map(b.map(([d, v]) => [d, v]));
  const shared = a.filter(([d, v]) => v > 0 && (bm.get(d) ?? 0) > 0);
  const tail = shared.slice(-Math.max(2, n + 1));
  if (tail.length < 2) return [];
  const [d0, a0] = tail[0];
  const b0 = bm.get(d0)!;
  return tail.map(([d, v]) => ({ date: d, v: v / a0 / (bm.get(d)! / b0) - 1 }));
}

export const SPANS = [
  { v: "3M", l: "3M", n: 63 },
  { v: "6M", l: "6M", n: 126 },
  { v: "1Y", l: "1Y", n: 252 },
] as const;
export type Span = (typeof SPANS)[number]["v"];
