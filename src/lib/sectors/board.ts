// The sector overview's comparison board and its relative-performance panels, built from the partner's
// sectors.json (cap-weighted returns, fundamentals, valuation range), the member tape (breadth from
// setup_series) and the sector ETFs' closes. Pure.
import type { Overview } from "./groups";
import { groupTape, type GroupTape, type MemberTape } from "./breadth";
import { compareNullable, type SortDir } from "./stats";

export const WINDOWS = ["1W", "1M", "3M", "YTD", "1Y"] as const;
export type Win = (typeof WINDOWS)[number];

export interface Member {
  ticker: string;
  sector: string;
  /** Partner industry group (coverage `group`), the same names the pipeline uses for industries. */
  group?: string;
  industry: string;
}

export interface BoardRow {
  slug: string;
  name: string;
  kind: "sector" | "industry";
  sector: string;
  etf: string | null;
  n: number;
  mcap: number | null;
  /** Cap-weighted return of the group's companies per window. */
  ret: Record<Win, number | null>;
  /** The same minus SPY's return over the window. */
  excess: Record<Win, number | null>;
  tape: GroupTape | null;
  /** Share above the 200-day average: the member tape when it covers the group, else the pipeline's figure. */
  above200: number | null;
  nearHigh: number | null;
  revGrowth: number | null;
  om: number | null;
  roic: number | null;
  pe: number | null;
  /** Where today's aggregate P/E sits in its own 10-year quarterly range, 0 to 1. */
  pePct: number | null;
  /** Latest calendar quarter the fundamentals describe. */
  q: string | null;
  top5: number | null;
}

/** Tickers of a sector (by sector name) or an industry (by its group name within the sector). */
export function membersOf(kind: "sector" | "industry", name: string, sector: string, list: readonly Member[]): string[] {
  return list
    .filter((c) => (kind === "sector" ? c.sector === name : c.sector === sector && (c.group ?? c.industry) === name))
    .map((c) => c.ticker);
}

export function boardRows(
  ov: Overview,
  level: "sector" | "industry",
  list: readonly Member[],
  tape?: ReadonlyMap<string, MemberTape> | null,
): BoardRow[] {
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
      const t = tape && tape.size ? groupTape(membersOf(g.kind, g.name, g.sector, list), tape) : null;
      const useTape = !!t && t.known > 0;
      return {
        slug: g.slug,
        name: g.name,
        kind: g.kind,
        sector: g.sector,
        etf: g.etf ?? null,
        n: g.n,
        mcap: g.mcap,
        ret,
        excess,
        tape: t,
        above200: useTape ? t!.above200.share : (g.breadth?.b200 ?? null),
        nearHigh: useTape ? t!.nearHigh.share : null,
        revGrowth: g.latest?.rev_growth?.[1] ?? null,
        om: g.latest?.om?.[1] ?? null,
        roic: g.latest?.roic?.[1] ?? null,
        pe: g.latest?.pe?.[1] ?? null,
        pePct: g.pe_range?.pct ?? null,
        q: g.latest?.rev_growth?.[0] ?? g.q ?? null,
        top5: g.top5 ?? null,
      };
    });
}

export const BOARD_SORTS = ["name", "sector", "n", "mcap", ...WINDOWS.map((w) => `r${w}` as const), "a200", "nh", "rev", "om", "roic", "pe", "pep"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export function boardKey(r: BoardRow, k: BoardSort): number | string | null {
  switch (k) {
    case "name":
      return r.name;
    case "sector":
      return r.sector;
    case "n":
      return r.n;
    case "mcap":
      return r.mcap;
    case "a200":
      return r.above200;
    case "nh":
      return r.nearHigh;
    case "rev":
      return r.revGrowth;
    case "om":
      return r.om;
    case "roic":
      return r.roic;
    case "pe":
      return r.pe;
    case "pep":
      return r.pePct;
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
