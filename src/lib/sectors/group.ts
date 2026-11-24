// Model of one sector or industry page: constituents joined with the member tape and the markets file,
// the reference quarter and the summary strip, the column sets of the company table, the distribution
// metrics and the address (search) state. Pure.
import { z } from "zod";
import type { Constituent, GroupFile } from "./groups";
import { annualised, type GroupTape, type MemberTape } from "./breadth";
import type { MarketIndex, Signal } from "./risk";
import { shareOf, sortBy, type Share, type SortDir } from "./stats";
import type { Unit } from "./format";

export interface Row extends Constituent {
  /** Above the 200-day average and within 2% of the 52-week high, by the page's one breadth rule. */
  a200: boolean | null;
  nearHigh: boolean | null;
  /** 60-day volatility, annualised (member tape). */
  vol: number | null;
  /** Average absolute earnings move and the releases behind it (markets file). */
  em: number | null;
  prints: number;
  /** Chart patterns that triggered in the last ten sessions (markets file). */
  signals: Signal[];
  /** Whether the markets file has the company at all. */
  inMarket: boolean;
}

export interface Sources {
  tape?: ReadonlyMap<string, MemberTape> | null;
  market?: MarketIndex | null;
}

/** True when the member tape loaded: then it alone decides every trend flag on the page. */
export const tapeOn = (tape?: ReadonlyMap<string, MemberTape> | null): tape is ReadonlyMap<string, MemberTape> => !!tape && tape.size > 0;

/**
 * Constituents with their trend flags, volatility, earnings move and live signals. The breadth rule is
 * the page's: with the tape, a company's flags are its tape row's (none without a row); only when the
 * tape did not load at all do the group file's own flags stand in, for every company alike.
 */
export function joinRows(cons: readonly Constituent[], src: Sources = {}): Row[] {
  const on = tapeOn(src.tape);
  return cons.map((c) => {
    const t = on ? src.tape!.get(c.tk) : undefined;
    const m = src.market?.by.get(c.tk);
    return {
      ...c,
      a200: on ? (t?.above200 ?? null) : (c.above200 ?? null),
      nearHigh: on ? (t?.near_high ?? null) : null,
      vol: annualised(t?.vol60),
      em: m?.avgAbsMove ?? null,
      prints: m?.prints ?? 0,
      signals: m?.signals ?? [],
      inMarket: !!m,
    };
  });
}

/* ---------- company table: columns and column sets ---------- */
export interface Col {
  k: string;
  l: string;
  unit: Unit | "ratio";
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
  { k: "beta", l: "Beta", unit: "ratio", t: "Beta of daily returns to SPY over one year", get: (r) => r.beta },
  { k: "vol", l: "Volatility", unit: "pct", t: "Standard deviation of daily returns over 60 sessions, annualised", get: (r) => r.vol },
  { k: "em", l: "Earn. move", unit: "pct", t: "Average absolute move from the close before an earnings release to the close of the day after", get: (r) => r.em },
];
const COL = new Map(COLS.map((c) => [c.k, c]));

/** Column sets of the company table. `a200`, `nh` and `sig` are drawn by the table itself. */
export const COL_SETS = {
  fundamentals: ["mcap", "w", "ret_1m", "ret_ytd", "ret_1y", "a200", "rev_growth", "gm", "om", "roic", "pe", "fcf_yield"],
  risk: ["mcap", "ret_1m", "ret_1y", "a200", "nh", "beta", "vol", "em", "sig"],
} as const;
export type ColSet = keyof typeof COL_SETS;
export const SORT_KEYS = ["tk", "industry", ...new Set(Object.values(COL_SETS).flat())] as const as readonly string[];

const flag = (v: boolean | null) => (v == null ? null : v ? 1 : 0);

export function sortRows(rows: readonly Row[], k: string, dir: SortDir): Row[] {
  const col = COL.get(k);
  const key = (r: Row): number | string | null | undefined => {
    if (col) return col.get(r);
    if (k === "tk") return r.tk;
    if (k === "industry") return r.industry;
    if (k === "a200") return flag(r.a200);
    if (k === "nh") return flag(r.nearHigh);
    if (k === "sig") return r.inMarket ? r.signals.length : null;
    return null;
  };
  return sortBy(rows, key, dir, (r) => r.tk);
}

/**
 * The sort that applies to a column set: the asked column when the set shows it (or the company or
 * industry column), else market cap, so the table is never ordered by a column that is not on screen.
 */
export function tableSort(set: ColSet, sort: string | undefined, dir: SortDir | undefined): { sort: string; dir: SortDir } {
  const shown = sort === "tk" || sort === "industry" || (COL_SETS[set] as readonly string[]).includes(sort ?? "");
  if (!shown) return { sort: "mcap", dir: "desc" };
  return { sort: sort!, dir: dir ?? (sort === "tk" || sort === "industry" || sort === "pe" ? "asc" : "desc") };
}

/* ---------- distribution metrics ---------- */
export interface DistMetric {
  k: string;
  /** Full name, and a short one for the control. */
  l: string;
  s: string;
  unit: Unit;
  get: (r: Row) => number | null | undefined;
}
export const DIST: DistMetric[] = [
  { k: "rev_growth", l: "Revenue growth", s: "Rev growth", unit: "ret", get: (r) => r.rev_growth },
  { k: "om", l: "Operating margin", s: "Op margin", unit: "pct", get: (r) => r.om },
  { k: "gm", l: "Gross margin", s: "Gross margin", unit: "pct", get: (r) => r.gm },
  { k: "roic", l: "ROIC", s: "ROIC", unit: "pct", get: (r) => r.roic },
  { k: "pe", l: "P/E", s: "P/E", unit: "x", get: (r) => (r.pe != null && r.pe > 0 ? r.pe : null) },
  { k: "fcf_yield", l: "FCF yield", s: "FCF yield", unit: "pct", get: (r) => r.fcf_yield },
  { k: "ret_1m", l: "1M return", s: "1M", unit: "ret", get: (r) => r.ret_1m },
  { k: "ret_1y", l: "1Y return", s: "1Y", unit: "ret", get: (r) => r.ret_1y },
];

/* ---------- reference quarter ---------- */
/**
 * The pipeline's rule for a group's latest quarter (etl/sectors.py `_last_idx`): the newest quarter with any
 * report, unless fewer than half as many companies have reported it as the quarter before; then that one.
 */
export function lastFullIndex(ns: readonly (number | null | undefined)[]): number | null {
  const idx: number[] = [];
  ns.forEach((n, i) => {
    if (n) idx.push(i);
  });
  if (!idx.length) return null;
  const i = idx[idx.length - 1];
  if (idx.length > 1 && (ns[i] ?? 0) < 0.5 * (ns[idx[idx.length - 2]] ?? 0)) return idx[idx.length - 2];
  return i;
}

export interface RefQuarter {
  i: number;
  q: string;
  /** Companies with revenue or earnings growth reported for it. */
  n: number;
  /** A newer quarter some companies have reported, too few to be the headline yet. */
  early: { q: string; n: number } | null;
}

/** The one quarter every fundamental headline on the page describes. */
export function refQuarter(d: Pick<GroupFile, "quarters" | "agg">): RefQuarter | null {
  const a = d.agg.rev_growth?.n ?? [];
  const b = d.agg.ni_growth?.n ?? [];
  const ns = d.quarters.map((_, i) => a[i] || b[i] || 0);
  const i = lastFullIndex(ns);
  if (i == null) return null;
  let last = -1;
  ns.forEach((n, j) => {
    if (n) last = j;
  });
  return { i, q: d.quarters[i], n: ns[i], early: last > i ? { q: d.quarters[last], n: ns[last] } : null };
}

export interface Fig {
  /** Σ numerator ÷ Σ denominator over the companies reporting both. */
  v: number | null;
  /** Company median for the same quarter. */
  med: number | null;
  q: string | null;
  n: number | null;
  i: number | null;
}

/** A quarterly aggregate at the reference quarter; when the group has no value there, its newest earlier one. */
export function figAt(d: Pick<GroupFile, "quarters" | "agg">, k: string, ref: RefQuarter | null): Fig {
  const s = d.agg[k];
  if (!s || !ref) return { v: null, med: null, q: null, n: null, i: null };
  for (let i = ref.i; i >= 0; i--) {
    if (s.agg[i] != null) return { v: s.agg[i]!, med: s.med?.[i] ?? null, q: d.quarters[i], n: s.n?.[i] ?? null, i };
  }
  return { v: null, med: null, q: null, n: null, i: null };
}

/* ---------- summary strip ---------- */
export interface Summary {
  n: number;
  mcap: number | null;
  top5: number | null;
  /** The quarter the fundamentals describe, by the pipeline's rule. */
  ref: RefQuarter | null;
  rev: Fig;
  om: Fig;
  /** Operating margin a year before `om`, for the change in points. */
  omYearAgo: number | null;
  pe: {
    v: number | null;
    /** Companies behind it. */
    n: number | null;
    /** Null when it is today's multiple; the quarter when the latest quarter's stands in. */
    q: string | null;
    /** Where it sits in its own 10-year range, 0 to 1. */
    pct: number | null;
  };
  ret3m: number | null;
  spy3m: number | null;
  ret1y: number | null;
  spy1y: number | null;
  /**
   * Breadth by the page's one rule: the tape roll-up (with its counts), or, when the tape did not load, the
   * pipeline's own share (the overview row's when the page has it, so the strip equals the group's row
   * among its peers; else counted from the group file's flags).
   */
  breadth: { from: "tape" | "pipeline"; share: number | null; above200: Share | null; nearHigh: Share | null; noRow: number | null };
}

export function summary(d: GroupFile, rows: readonly Row[], tape: GroupTape | null, pipelineShare?: number | null): Summary {
  const vn = d.val_now as Record<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const caps = rows.map((r) => r.mcap ?? 0).sort((a, b) => b - a);
  const total = caps.reduce((a, b) => a + b, 0);
  const ref = refQuarter(d);
  const om = figAt(d, "om", ref);
  const peToday = num(vn?.pe);
  const peQ = figAt(d, "pe", ref);
  const flags = shareOf(rows.map((r) => r.a200));
  return {
    n: rows.length,
    mcap: total || null,
    top5: total ? caps.slice(0, 5).reduce((a, b) => a + b, 0) / total : null,
    ref,
    rev: figAt(d, "rev_growth", ref),
    om,
    omYearAgo: om.i != null && om.i >= 4 ? (d.agg.om.agg[om.i - 4] ?? null) : null,
    pe: peToday != null ? { v: peToday, n: num(vn?.n), q: null, pct: d.val_range?.pe?.pct ?? null } : { v: peQ.v, n: peQ.n, q: peQ.q, pct: null },
    ret3m: d.returns?.cw?.["3M"] ?? null,
    spy3m: d.returns?.spy?.["3M"] ?? null,
    ret1y: d.returns?.cw?.["1Y"] ?? null,
    spy1y: d.returns?.spy?.["1Y"] ?? null,
    breadth: tape
      ? { from: "tape", share: tape.above200.share, above200: tape.above200, nearHigh: tape.nearHigh, noRow: tape.noRow }
      : pipelineShare != null
        ? { from: "pipeline", share: pipelineShare, above200: null, nearHigh: null, noRow: null }
        : { from: "pipeline", share: flags.share, above200: flags, nearHigh: null, noRow: null },
  };
}

/* ---------- address state ---------- */
const sortKey = z.enum(SORT_KEYS as unknown as [string, ...string[]]);
export const groupSearch = z.object({
  /** Quarterly trend metric and the quarter whose breakdown is open. */
  m: z.string().max(40).optional().catch(undefined),
  q: z.string().max(8).optional().catch(undefined),
  /** Trend span in quarters. */
  span: z.enum(["5y", "10y", "all"]).optional().catch(undefined),
  /** Performance chart window. */
  pw: z.enum(["6m", "1y", "2y"]).optional().catch(undefined),
  /** Company table: column set, sort and direction. */
  cols: z.enum(["risk"]).optional().catch(undefined),
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
