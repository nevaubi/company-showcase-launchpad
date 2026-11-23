// Model of one sector or industry page: constituents joined with the member tape, the summary strip, the
// distribution metrics and the address (search) state. Pure.
import { z } from "zod";
import type { Constituent, GroupFile } from "./groups";
import type { MemberTape } from "./breadth";
import { median, positiveMedian, shareOf, sortBy, type Share, type SortDir } from "./stats";
import type { Unit } from "./format";

export interface Row extends Constituent {
  /** Above the 200-day average: the member tape (daily) first, then the group file. */
  a200: boolean | null;
  nearHigh: boolean | null;
}

export function joinTape(cons: readonly Constituent[], tape?: ReadonlyMap<string, MemberTape> | null): Row[] {
  return cons.map((c) => {
    const t = tape?.get(c.tk);
    return { ...c, a200: t?.above200 ?? c.above200 ?? null, nearHigh: t?.near_high ?? null };
  });
}

export interface Col {
  k: string;
  l: string;
  unit: Unit;
  /** Longer header text for the title attribute. */
  t: string;
  get: (r: Row) => number | null | undefined;
}
export const COLS: Col[] = [
  { k: "mcap", l: "Mkt cap", unit: "usd", t: "Market cap, latest close", get: (r) => r.mcap },
  { k: "w", l: "Weight", unit: "pct", t: "Share of the group's market cap", get: (r) => r.w },
  { k: "ret_1m", l: "1M", unit: "ret", t: "Price return, one month", get: (r) => r.ret_1m },
  { k: "ret_ytd", l: "YTD", unit: "ret", t: "Price return, year to date", get: (r) => r.ret_ytd },
  { k: "ret_1y", l: "1Y", unit: "ret", t: "Price return, one year", get: (r) => r.ret_1y },
  { k: "rev_growth", l: "Rev YoY", unit: "ret", t: "Revenue growth, latest quarter vs a year earlier", get: (r) => r.rev_growth },
  { k: "gm", l: "Gross m.", unit: "pct", t: "Gross margin, trailing twelve months", get: (r) => r.gm },
  { k: "om", l: "Op m.", unit: "pct", t: "Operating margin, trailing twelve months", get: (r) => r.om },
  { k: "roic", l: "ROIC", unit: "pct", t: "Return on invested capital, trailing twelve months", get: (r) => r.roic },
  { k: "pe", l: "P/E", unit: "x", t: "Price to trailing earnings", get: (r) => (r.pe != null && r.pe > 0 ? r.pe : null) },
  { k: "fcf_yield", l: "FCF yld", unit: "pct", t: "Free cash flow over market cap", get: (r) => r.fcf_yield },
];
export const SORT_KEYS = ["tk", "industry", "a200", ...COLS.map((c) => c.k)] as const;

export function sortRows(rows: readonly Row[], k: string, dir: SortDir): Row[] {
  const col = COLS.find((c) => c.k === k);
  const key = (r: Row): number | string | null | undefined =>
    col ? col.get(r) : k === "tk" ? r.tk : k === "industry" ? r.industry : k === "a200" ? (r.a200 == null ? null : r.a200 ? 1 : 0) : null;
  return sortBy(rows, key, dir, (r) => r.tk);
}

/* ---------- distribution metrics ---------- */
export interface DistMetric {
  k: string;
  l: string;
  unit: Unit;
  /** Names for the two ends, read as "highest" and "lowest" when generic. */
  hi: string;
  lo: string;
  get: (r: Row) => number | null | undefined;
}
export const DIST: DistMetric[] = [
  { k: "rev_growth", l: "Revenue growth", unit: "ret", hi: "Fastest growing", lo: "Shrinking most", get: (r) => r.rev_growth },
  { k: "om", l: "Operating margin", unit: "pct", hi: "Widest margin", lo: "Thinnest margin", get: (r) => r.om },
  { k: "gm", l: "Gross margin", unit: "pct", hi: "Widest margin", lo: "Thinnest margin", get: (r) => r.gm },
  { k: "roic", l: "ROIC", unit: "pct", hi: "Highest return", lo: "Lowest return", get: (r) => r.roic },
  { k: "pe", l: "P/E", unit: "x", hi: "Most expensive", lo: "Cheapest", get: (r) => (r.pe != null && r.pe > 0 ? r.pe : null) },
  { k: "fcf_yield", l: "FCF yield", unit: "pct", hi: "Highest yield", lo: "Lowest yield", get: (r) => r.fcf_yield },
  { k: "ret_1m", l: "1M return", unit: "ret", hi: "Strongest", lo: "Weakest", get: (r) => r.ret_1m },
  { k: "ret_1y", l: "1Y return", unit: "ret", hi: "Strongest", lo: "Weakest", get: (r) => r.ret_1y },
];

/* ---------- summary strip ---------- */
export interface Summary {
  n: number;
  mcap: number | null;
  top5: number | null;
  revAgg: number | null;
  revMed: number | null;
  omAgg: number | null;
  omMed: number | null;
  peAgg: number | null;
  peMed: number | null;
  pePct: number | null;
  ret3m: number | null;
  spy3m: number | null;
  ret1y: number | null;
  spy1y: number | null;
  above200: Share;
  nearHigh: Share;
  /** Calendar quarter of the aggregates. */
  q: string | null;
}

/** Latest non-missing value of a quarterly aggregate. */
export function lastAgg(d: GroupFile, k: string): { v: number; q: string; i: number } | null {
  const s = d.agg[k]?.agg;
  if (!s) return null;
  for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return { v: s[i]!, q: d.quarters[i], i };
  return null;
}

export function summary(d: GroupFile, rows: readonly Row[]): Summary {
  const vn = d.val_now as Record<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const caps = rows.map((r) => r.mcap ?? 0).sort((a, b) => b - a);
  const total = caps.reduce((a, b) => a + b, 0);
  return {
    n: rows.length,
    mcap: total || null,
    top5: total ? caps.slice(0, 5).reduce((a, b) => a + b, 0) / total : null,
    revAgg: lastAgg(d, "rev_growth")?.v ?? null,
    revMed: median(rows.map((r) => r.rev_growth)),
    omAgg: lastAgg(d, "om")?.v ?? null,
    omMed: median(rows.map((r) => r.om)),
    peAgg: num(vn?.pe) ?? lastAgg(d, "pe")?.v ?? null,
    peMed: positiveMedian(rows.map((r) => r.pe)),
    pePct: d.val_range?.pe?.pct ?? null,
    ret3m: d.returns?.cw?.["3M"] ?? null,
    spy3m: d.returns?.spy?.["3M"] ?? null,
    ret1y: d.returns?.cw?.["1Y"] ?? null,
    spy1y: d.returns?.spy?.["1Y"] ?? null,
    above200: shareOf(rows.map((r) => r.a200)),
    nearHigh: shareOf(rows.map((r) => r.nearHigh)),
    q: lastAgg(d, "rev_growth")?.q ?? null,
  };
}

/* ---------- address state ---------- */
const sortKey = z.enum(SORT_KEYS as unknown as [string, ...string[]]);
export const groupSearch = z.object({
  /** Quarterly trend metric and the quarter whose breakdown is open. */
  m: z.string().max(40).optional().catch(undefined),
  q: z.string().max(8).optional().catch(undefined),
  /** Trend span in quarters. */
  span: z.enum(["20", "40", "all"]).optional().catch(undefined),
  /** Performance chart window. */
  pw: z.enum(["126", "252", "all"]).optional().catch(undefined),
  /** Constituents sort and direction. */
  sort: sortKey.optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  /** Distribution metric. */
  dm: z.enum(DIST.map((x) => x.k) as [string, ...string[]]).optional().catch(undefined),
  /** Industry filter on a sector page. */
  ind: z.string().max(80).optional().catch(undefined),
});
export type GroupSearch = z.infer<typeof groupSearch>;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
