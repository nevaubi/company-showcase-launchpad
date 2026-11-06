// Peer selection and per-company sourced metrics for report comparisons. Pure: every metric keeps the
// SEC facts it was calculated from (tagged with the company's ticker so the source panel opens the
// right filing); prices are dated market data. Shared by the report loader, scripts and tests.
import type { Bar, Cell, CompanyDataset, DerivedPart, Statement, UniverseEntry } from "@/lib/financials/types";
import { isBankIndustry } from "@/lib/financials/dataset";
import type { FactRef } from "./types";
import { money, mult, pct } from "./fmt";

export type PeerMetricKey =
  | "revenue" | "growth" | "cagr3" | "grossMargin" | "opMargin" | "fcfMargin" | "netMargin" | "rndPct" | "capexPct" | "sbcPct"
  | "roe" | "netLeverage" | "mcap" | "pe" | "evSales" | "evEbitda" | "fcfYield" | "pb" | "rule40" | "ret1y" | "ret3m";

export interface PeerValue { v: number; ref: FactRef; text: string }

export interface PeerSnapshot {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  /** Banks, brokers, insurers: enterprise-value and gross-margin metrics don't apply. */
  fin: boolean;
  /** Latest fiscal quarter end used for TTM figures. */
  asOf: string | null;
  price: { price: number; asOf: string } | null;
  m: Partial<Record<PeerMetricKey, PeerValue>>;
  /** Weekly adjusted closes for the last ~13 months: [date, close]. */
  weekly: [string, number][];
}

export const METRIC_DEF: Record<PeerMetricKey, { label: string; short: string; unit: "usd" | "pct" | "mult"; better: "high" | "low" }> = {
  revenue: { label: "TTM revenue", short: "Revenue", unit: "usd", better: "high" },
  growth: { label: "TTM revenue growth", short: "Rev. growth", unit: "pct", better: "high" },
  cagr3: { label: "3-year revenue CAGR", short: "3Y CAGR", unit: "pct", better: "high" },
  grossMargin: { label: "TTM gross margin", short: "Gross margin", unit: "pct", better: "high" },
  opMargin: { label: "TTM operating margin", short: "Op. margin", unit: "pct", better: "high" },
  fcfMargin: { label: "TTM free-cash-flow margin", short: "FCF margin", unit: "pct", better: "high" },
  netMargin: { label: "TTM net margin", short: "Net margin", unit: "pct", better: "high" },
  rndPct: { label: "TTM R&D as % of revenue", short: "R&D %", unit: "pct", better: "high" },
  capexPct: { label: "TTM capex as % of revenue", short: "Capex %", unit: "pct", better: "low" },
  sbcPct: { label: "TTM stock comp as % of revenue", short: "SBC %", unit: "pct", better: "low" },
  roe: { label: "TTM return on equity", short: "ROE", unit: "pct", better: "high" },
  netLeverage: { label: "Net debt / TTM EBITDA", short: "Net debt/EBITDA", unit: "mult", better: "low" },
  mcap: { label: "Market cap", short: "Mkt cap", unit: "usd", better: "high" },
  pe: { label: "P/E (TTM)", short: "P/E", unit: "mult", better: "low" },
  evSales: { label: "EV / TTM sales", short: "EV/Sales", unit: "mult", better: "low" },
  evEbitda: { label: "EV / TTM EBITDA", short: "EV/EBITDA", unit: "mult", better: "low" },
  fcfYield: { label: "FCF yield", short: "FCF yield", unit: "pct", better: "high" },
  pb: { label: "Price / book", short: "P/B", unit: "mult", better: "low" },
  rule40: { label: "Growth + FCF margin (rule of 40)", short: "Rule of 40", unit: "pct", better: "high" },
  ret1y: { label: "1-year total return", short: "1Y return", unit: "pct", better: "high" },
  ret3m: { label: "3-month total return", short: "3M return", unit: "pct", better: "high" },
};

const FIN = /bank|brokerage|consumer finance|insurance|capital markets|financial services|investment banking/i;
export const isFinIndustry = (industry: string | undefined) => FIN.test(industry ?? "") || isBankIndustry(industry);

export const fmtMetric = (k: PeerMetricKey, v: number) => {
  const u = METRIC_DEF[k].unit;
  return u === "usd" ? money(v) : u === "mult" ? mult(v) : pct(v, k === "growth" || k === "cagr3" || k === "ret1y" || k === "ret3m");
};

// ---------- statements ----------
export const rowOf = (st: Statement | undefined, key: string) => st?.rows.find((r) => r.key === key);
export const cellAt = (st: Statement | undefined, key: string, i: number): Cell | null => (i >= 0 ? rowOf(st, key)?.cells[i] ?? null : null);
export const partsOf = (c: Cell, label: string): DerivedPart[] => (c.src ? [{ ...c.src, label, sign: 1 }] : (c.derived?.parts ?? []));

export interface Sum { v: number; parts: DerivedPart[] }
/** Sum of four quarters ending at index `last`, or null when any is missing. */
export function sum4(st: Statement, key: string, last: number): Sum | null {
  if (last < 3) return null;
  const parts: DerivedPart[] = [];
  let v = 0;
  for (let i = last - 3; i <= last; i++) {
    const c = cellAt(st, key, i);
    if (!c) return null;
    v += c.v;
    parts.push(...partsOf(c, `${rowOf(st, key)?.label ?? key} ${st.periods[i]?.label ?? ""}`.trim()));
  }
  return { v, parts };
}

/** Last quarter index with revenue (falls back to net income for lenders without a revenue line). */
export function lastQuarter(st: Statement): number {
  for (let i = st.periods.length - 1; i >= 0; i--) if (cellAt(st, "revenue", i) || cellAt(st, "netIncome", i)) return i;
  return -1;
}

/** Weekly adjusted closes (last bar of each ISO week). */
export function weeklyCloses(bars: Bar[], fromDate: string): [string, number][] {
  const out: [string, number][] = [];
  let lastWeek = "";
  for (const b of bars) {
    if (b[0] < fromDate) continue;
    const d = new Date(`${b[0].slice(0, 10)}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const close = b[5] || b[4];
    if (!(close > 0)) continue;
    if (monday === lastWeek) out[out.length - 1] = [b[0].slice(0, 10), close];
    else out.push([b[0].slice(0, 10), close]);
    lastWeek = monday;
  }
  return out;
}

/** Total return between the close on/after `from` and the last close (adjusted for dividends and splits). */
export function totalReturn(bars: Bar[], from: string): { r: number; start: string; end: string } | null {
  const i = bars.findIndex((b) => b[0] >= from);
  if (i < 0 || i >= bars.length - 1) return null;
  const a = bars[i][5] || bars[i][4], b = bars[bars.length - 1][5] || bars[bars.length - 1][4];
  if (!(a > 0 && b > 0)) return null;
  return { r: b / a - 1, start: bars[i][0].slice(0, 10), end: bars[bars.length - 1][0].slice(0, 10) };
}

export const daysBefore = (d: string, n: number) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

/**
 * Sourced comparison metrics for one company. `price` is the dated share price used for multiples
 * (live for the report company, last stored close for peers).
 */
export function peerSnapshot(d: CompanyDataset, bars: Bar[] | null, price: { price: number; asOf: string } | null): PeerSnapshot {
  const t = d.profile.ticker;
  const fin = isFinIndustry(d.profile.industry);
  const Q = d.statements.quarterly;
  const A = d.statements.annual;
  const m: PeerSnapshot["m"] = {};
  const last = lastQuarter(Q.income);
  const end = last >= 0 ? Q.income.periods[last]?.end ?? null : null;
  const thru = end ? ` (four quarters through ${end})` : "";
  const add = (k: PeerMetricKey, v: number | null | undefined, ref: FactRef | null, text?: string) => {
    if (v == null || !Number.isFinite(v) || !ref) return;
    m[k] = { v, ref, text: text ?? `${t} ${METRIC_DEF[k].label}${thru}: ${fmtMetric(k, v)}.` };
  };
  const derived = (formula: string, parts: DerivedPart[], market?: { label: string; value: number; asOf: string }[]): FactRef =>
    ({ kind: "derived", formula, parts, label: `${t} ${formula}`, tk: t, ...(market ? { market } : {}) });

  const rev = sum4(Q.income, "revenue", last);
  const revPrior = sum4(Q.income, "revenue", last - 4);
  const ni = sum4(Q.income, "netIncome", last);
  if (rev) add("revenue", rev.v, derived("TTM revenue = sum of the last four quarters", rev.parts));
  if (rev && revPrior && revPrior.v > 0) add("growth", rev.v / revPrior.v - 1, derived("TTM revenue ÷ prior-year TTM revenue − 1", [...rev.parts, ...revPrior.parts]),
    `${t} TTM revenue growth${thru} versus the prior four quarters: ${pct(rev.v / revPrior.v - 1, true)}.`);
  // 3-year CAGR from fiscal-year revenue
  const ai = A.income.periods.length - 1;
  const r0 = cellAt(A.income, "revenue", ai), r3 = cellAt(A.income, "revenue", ai - 3);
  if (r0 && r3 && r3.v > 0 && r0.v > 0) {
    const g = (r0.v / r3.v) ** (1 / 3) - 1;
    add("cagr3", g, derived("(FY revenue ÷ revenue three years earlier)^(1/3) − 1", [...partsOf(r0, `Revenue ${A.income.periods[ai].label}`), ...partsOf(r3, `Revenue ${A.income.periods[ai - 3].label}`)]),
      `${t} 3-year revenue CAGR (${A.income.periods[ai - 3].label} to ${A.income.periods[ai].label}): ${pct(g, true)}.`);
  }
  const ratio = (k: PeerMetricKey, st: Statement, key: string, formula: string) => {
    const num = sum4(st, key, last);
    if (!num || !rev || rev.v <= 0) return null;
    add(k, num.v / rev.v, derived(formula, [...num.parts, ...rev.parts]));
    return num;
  };
  if (!fin) ratio("grossMargin", Q.income, "grossProfit", "TTM gross profit ÷ TTM revenue");
  const op = ratio("opMargin", Q.income, "operatingIncome", "TTM operating income ÷ TTM revenue");
  if (ni && rev && rev.v > 0) add("netMargin", ni.v / rev.v, derived("TTM net income ÷ TTM revenue", [...ni.parts, ...rev.parts]));
  const fcf = fin ? null : ratio("fcfMargin", Q.cashflow, "fcf", "TTM free cash flow ÷ TTM revenue");
  if (!fin) {
    ratio("rndPct", Q.income, "rnd", "TTM R&D expense ÷ TTM revenue");
    ratio("capexPct", Q.cashflow, "capex", "TTM capital expenditures ÷ TTM revenue");
  }
  ratio("sbcPct", Q.cashflow, "sbc", "TTM stock-based compensation ÷ TTM revenue");
  const bi = Q.balance.periods.length - 1;
  const eq = cellAt(Q.balance, "equity", bi);
  if (ni && eq && eq.v > 0) add("roe", ni.v / eq.v, derived("TTM net income ÷ shareholders' equity", [...ni.parts, ...partsOf(eq, `Equity ${Q.balance.periods[bi].label}`)]));
  const ebitda = sum4(Q.income, "ebitda", last);
  const netDebt = cellAt(Q.balance, "netDebt", bi);
  if (!fin && ebitda && ebitda.v > 0 && netDebt) add("netLeverage", netDebt.v / ebitda.v, derived("Net debt ÷ TTM EBITDA", [...partsOf(netDebt, "Net debt"), ...ebitda.parts]));
  const growth = m.growth?.v, fcfm = m.fcfMargin?.v;
  if (!fin && growth != null && fcfm != null && rev && revPrior && fcf) {
    add("rule40", growth + fcfm, derived("TTM revenue growth + TTM FCF margin", [...rev.parts, ...revPrior.parts, ...fcf.parts]),
      `${t} growth plus FCF margin ("rule of 40")${thru}: ${pct(growth + fcfm)}.`);
  }

  // valuation at the dated price
  if (price) {
    const sh = cellAt(Q.balance, "sharesOutstanding", bi) ?? cellAt(Q.income, "sharesDiluted", last);
    if (sh && sh.v > 0) {
      const mkt = [{ label: `${t} share price`, value: price.price, asOf: price.asOf }];
      const shParts = partsOf(sh, "Shares outstanding");
      const mcap = price.price * sh.v;
      add("mcap", mcap, derived("Share price × shares outstanding", shParts, mkt), `${t} market cap at $${price.price.toFixed(2)} (${price.asOf}): ${money(mcap)}.`);
      if (ni && ni.v > 0) add("pe", mcap / ni.v, derived("Market cap ÷ TTM net income", [...shParts, ...ni.parts], mkt), `${t} P/E on TTM net income${thru}, price as of ${price.asOf}: ${mult(mcap / ni.v)}.`);
      if (fin && eq && eq.v > 0) add("pb", mcap / eq.v, derived("Market cap ÷ shareholders' equity", [...shParts, ...partsOf(eq, "Equity")], mkt), `${t} price to book, price as of ${price.asOf}: ${mult(mcap / eq.v)}.`);
      const debt = cellAt(Q.balance, "totalDebt", bi), cash = cellAt(Q.balance, "cash", bi), sti = cellAt(Q.balance, "shortTermInvestments", bi);
      if (!fin && debt && cash) {
        const ev = mcap + debt.v - cash.v - (sti?.v ?? 0);
        const evParts = [...shParts, ...partsOf(debt, "Total debt"), ...partsOf(cash, "Cash"), ...(sti ? partsOf(sti, "Short-term investments") : [])];
        if (rev && rev.v > 0 && ev > 0) add("evSales", ev / rev.v, derived("(Market cap + debt − cash) ÷ TTM revenue", [...evParts, ...rev.parts], mkt), `${t} EV / TTM sales, price as of ${price.asOf}: ${mult(ev / rev.v)}.`);
        if (ebitda && ebitda.v > 0 && ev > 0) add("evEbitda", ev / ebitda.v, derived("(Market cap + debt − cash) ÷ TTM EBITDA", [...evParts, ...ebitda.parts], mkt), `${t} EV / TTM EBITDA, price as of ${price.asOf}: ${mult(ev / ebitda.v)}.`);
      }
      if (!fin && fcf) add("fcfYield", fcf.v / mcap, derived("TTM free cash flow ÷ market cap", [...fcf.parts, ...shParts], mkt), `${t} FCF yield (TTM free cash flow ÷ market cap), price as of ${price.asOf}: ${pct(fcf.v / mcap)}.`);
    }
  }

  // price performance
  let weekly: [string, number][] = [];
  if (bars?.length) {
    const lastDate = bars[bars.length - 1][0].slice(0, 10);
    for (const [k, days, label] of [["ret1y", 365, "1-year"], ["ret3m", 91, "3-month"]] as const) {
      const r = totalReturn(bars, daysBefore(lastDate, days));
      if (r) add(k, r.r, { kind: "market", label: `${t} ${label} total return`, asOf: r.end }, `${t} ${label} total return (${r.start} to ${r.end}, dividends reinvested): ${pct(r.r, true)}.`);
    }
    weekly = weeklyCloses(bars, daysBefore(lastDate, 395));
  }

  return { ticker: t, name: d.profile.name, sector: d.profile.sector, industry: d.profile.industry, fin, asOf: end, price, m, weekly };
}

/** Last stored close as a dated price. */
export function lastClose(bars: Bar[] | null): { price: number; asOf: string } | null {
  const b = bars?.[bars.length - 1];
  return b && b[4] > 0 ? { price: b[4], asOf: b[0].slice(0, 10) } : null;
}

/**
 * Comparable companies: the curated peer list first, then the same industry, then the same sector,
 * each ranked by closeness in revenue (log distance). Only companies with stored datasets qualify.
 */
export function selectPeers(ticker: string, universe: Pick<UniverseEntry, "ticker" | "sector" | "industry" | "revenueTTM">[], curated: string[], max = 6): string[] {
  const self = universe.find((u) => u.ticker === ticker);
  const known = new Map(universe.map((u) => [u.ticker, u]));
  const out: string[] = [];
  const push = (t: string) => { if (t !== ticker && known.has(t) && !out.includes(t) && out.length < max) out.push(t); };
  for (const t of curated) push(t);
  if (!self) return out;
  const size = (u: { revenueTTM: number | null }) => Math.abs(Math.log(Math.max(u.revenueTTM ?? 1, 1)) - Math.log(Math.max(self.revenueTTM ?? 1, 1)));
  const fin = isFinIndustry(self.industry);
  const pool = universe.filter((u) => u.ticker !== ticker && (u.revenueTTM ?? 0) > 0 && isFinIndustry(u.industry) === fin);
  for (const u of pool.filter((x) => x.industry === self.industry).sort((a, b) => size(a) - size(b))) push(u.ticker);
  for (const u of pool.filter((x) => x.sector === self.sector).sort((a, b) => size(a) - size(b))) push(u.ticker);
  return out;
}

// ---------- cross-company statistics ----------
export function median(xs: number[]): number | null {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
}

/** 1 = best. */
export function rankOf(value: number, all: number[], better: "high" | "low"): { rank: number; of: number } {
  return { rank: 1 + all.filter((x) => (better === "high" ? x > value : x < value)).length, of: all.length };
}

/** Ordinary least squares y = a + b·x with R². */
export function ols(xs: number[], ys: number[]): { a: number; b: number; r2: number } | null {
  const n = xs.length;
  if (n < 4 || ys.length !== n) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, r2: (sxy * sxy) / (sxx * syy) };
}

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
