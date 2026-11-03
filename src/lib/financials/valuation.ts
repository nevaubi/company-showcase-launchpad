// Point-in-time valuation history. For every week of price history, the multiple uses
// only fundamentals that had been filed with the SEC by that date (TTM flows from the
// latest four quarters, balance sheet at that quarter's end). Pure: shared by the app
// and tests.
import type { Bar, CompanyDataset, Statement } from "./types";

export type MultipleKey = "pe" | "evEbitda" | "evSales" | "ps" | "pfcf" | "pb" | "fcfYield" | "divYield" | "shYield";

export const MULTIPLES: { key: MultipleKey; label: string; short: string; kind: "x" | "pct"; bank?: boolean; help: string }[] = [
  { key: "pe", label: "Price / earnings", short: "P/E", kind: "x", bank: true, help: "Market cap ÷ trailing-twelve-month net income" },
  { key: "evEbitda", label: "EV / EBITDA", short: "EV/EBITDA", kind: "x", help: "(Market cap + total debt − cash & short-term investments) ÷ TTM EBITDA" },
  { key: "evSales", label: "EV / sales", short: "EV/S", kind: "x", help: "Enterprise value ÷ TTM revenue" },
  { key: "ps", label: "Price / sales", short: "P/S", kind: "x", bank: true, help: "Market cap ÷ TTM revenue" },
  { key: "pfcf", label: "Price / free cash flow", short: "P/FCF", kind: "x", help: "Market cap ÷ TTM free cash flow (operating cash flow − capex)" },
  { key: "pb", label: "Price / book", short: "P/B", kind: "x", bank: true, help: "Market cap ÷ shareholders' equity" },
  { key: "fcfYield", label: "Free-cash-flow yield", short: "FCF yield", kind: "pct", help: "TTM free cash flow ÷ market cap" },
  { key: "divYield", label: "Dividend yield", short: "Div. yield", kind: "pct", bank: true, help: "TTM dividends paid ÷ market cap" },
  { key: "shYield", label: "Shareholder yield", short: "Sh. yield", kind: "pct", bank: true, help: "TTM dividends + buybacks ÷ market cap" },
];

export interface FundamentalsAt {
  /** Fiscal quarter end */
  end: string;
  /** First date the numbers were public (SEC filing date) */
  available: string;
  label: string;
  /** Diluted shares restated to today's share basis (splits removed) */
  shares: number | null;
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
  fcf: number | null;
  dividends: number | null;
  buybacks: number | null;
  debt: number | null;
  cash: number | null;
  equity: number | null;
}

export interface ValuationPoint {
  date: string;
  price: number;
  /** Quarter whose filing supplied the fundamentals */
  basis: string;
  mcap: number | null;
  ev: number | null;
  values: Partial<Record<MultipleKey, number | null>>;
}

const cellsOf = (st: Statement | undefined, key: string) => st?.rows.find((r) => r.key === key)?.cells ?? [];

const SPLITS = [1.5, 2, 3, 4, 5, 7, 8, 10, 15, 20, 25, 40, 50];

/** Factor to multiply an earlier share count by when a split happened between two quarters. */
export function splitFactor(later: number, earlier: number): number {
  if (!(later > 0 && earlier > 0)) return 1;
  const r = later / earlier;
  const near = (x: number) => SPLITS.find((s) => Math.abs(x / s - 1) < 0.08);
  if (r >= 1.4) return near(r) ?? 1;
  if (r <= 1 / 1.4) {
    const s = near(1 / r);
    return s ? 1 / s : 1;
  }
  return 1;
}

/** Restate a share-count series to the latest basis by undoing stock splits found as step jumps. */
export function restateShares(raw: (number | null)[]): (number | null)[] {
  const out = [...raw];
  let cum = 1;
  let later: number | null = null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const v = raw[i];
    if (v == null) continue;
    if (later != null) cum *= splitFactor(later, v);
    out[i] = v * cum;
    later = v;
  }
  return out;
}

const addDays = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

/** One entry per fiscal quarter with TTM flows and point-in-time balance sheet. */
export function fundamentalsTimeline(d: CompanyDataset): FundamentalsAt[] {
  const q = d.statements.quarterly;
  const periods = q.income.periods;
  const filed = new Map(d.filings.map((f) => [f.accn, f.filed]));
  const inc = (k: string) => cellsOf(q.income, k);
  const bal = (k: string) => cellsOf(q.balance, k);
  const cf = (k: string) => cellsOf(q.cashflow, k);
  const rev = inc("revenue");
  const ebitda = inc("ebitda");
  const ni = inc("netIncome");
  const fcf = cf("fcf");
  const div = cf("dividends");
  const bb = cf("buybacks");
  const sharesRaw = periods.map((_, i) => inc("sharesDiluted")[i]?.v ?? bal("sharesOutstanding")[i]?.v ?? null);
  const shares = restateShares(sharesRaw);
  const ttm = (cells: ReturnType<typeof inc>, i: number, abs = false) => {
    if (i < 3) return null;
    let s = 0;
    for (let k = i - 3; k <= i; k++) {
      const c = cells[k];
      if (!c) return null;
      s += abs ? Math.abs(c.v) : c.v;
    }
    return s;
  };
  const optTtm = (cells: ReturnType<typeof inc>, i: number) => {
    // Dividends/buybacks rows are omitted in quarters with none; treat missing as zero once the row exists.
    if (i < 3 || !cells.length) return null;
    let s = 0;
    for (let k = i - 3; k <= i; k++) s += Math.abs(cells[k]?.v ?? 0);
    return s;
  };
  const debtCells = bal("totalDebt");
  const cashCells = bal("cash");
  const stiCells = bal("shortTermInvestments");
  const eqCells = bal("equity");
  const out: FundamentalsAt[] = [];
  periods.forEach((p, i) => {
    if (i < 3) return;
    const srcAccn = [rev[i], ni[i], eqCells[i], fcf[i]].find((c) => c?.src)?.src?.accn ?? [rev[i], ni[i]].find((c) => c?.derived)?.derived?.parts.find((x) => x.src)?.src?.accn;
    const filedOn = srcAccn ? filed.get(srcAccn) : undefined;
    // The value may come from a later filing that restated the quarter; only trust filing dates
    // shortly after the quarter ended, otherwise assume the usual 10-Q/10-K filing lag.
    const lag = addDays(p.end, p.fq === 4 || !p.fq ? 60 : 40);
    const available = filedOn && filedOn > p.end && filedOn <= addDays(p.end, 120) ? filedOn : lag;
    const cash = cashCells[i]?.v ?? null;
    out.push({
      end: p.end,
      available,
      label: p.label,
      shares: shares[i],
      revenue: ttm(rev, i),
      ebitda: ttm(ebitda, i),
      netIncome: ttm(ni, i),
      fcf: ttm(fcf, i),
      dividends: optTtm(div, i),
      buybacks: optTtm(bb, i),
      debt: debtCells[i]?.v ?? null,
      cash: cash == null ? null : cash + (stiCells[i]?.v ?? 0),
      equity: eqCells[i]?.v ?? null,
    });
  });
  return out;
}

/** Last trading day of each ISO week (keeps ten years of history light). */
export function weeklyBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let lastKey = "";
  for (const b of bars) {
    const d = new Date(`${b[0].slice(0, 10)}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    if (monday === lastKey) out[out.length - 1] = b;
    else out.push(b);
    lastKey = monday;
  }
  return out;
}

const MAX_X = 400;

export function multiplesAt(f: FundamentalsAt, price: number, bank: boolean): { mcap: number | null; ev: number | null; values: ValuationPoint["values"] } {
  const mcap = f.shares ? price * f.shares : null;
  if (!mcap) return { mcap: null, ev: null, values: {} };
  const ev = !bank && f.debt != null ? mcap + f.debt - (f.cash ?? 0) : null;
  const x = (num: number | null, den: number | null) => (num != null && den != null && den > 0 && num > 0 && num / den < MAX_X ? num / den : null);
  return {
    mcap,
    ev,
    values: {
      pe: x(mcap, f.netIncome),
      evEbitda: bank ? null : x(ev, f.ebitda),
      evSales: bank ? null : x(ev, f.revenue),
      ps: x(mcap, f.revenue),
      pfcf: bank ? null : x(mcap, f.fcf),
      pb: x(mcap, f.equity),
      fcfYield: bank || f.fcf == null ? null : f.fcf / mcap,
      divYield: f.dividends == null ? null : f.dividends / mcap,
      shYield: f.dividends == null && f.buybacks == null ? null : ((f.dividends ?? 0) + (f.buybacks ?? 0)) / mcap,
    },
  };
}

/** Weekly point-in-time multiples over the whole price history. */
export function valuationHistory(d: CompanyDataset, bars: Bar[], bank: boolean): ValuationPoint[] {
  const tl = fundamentalsTimeline(d).sort((a, b) => (a.available < b.available ? -1 : 1));
  if (!tl.length) return [];
  const out: ValuationPoint[] = [];
  let j = -1;
  for (const b of weeklyBars(bars)) {
    const date = b[0].slice(0, 10);
    while (j + 1 < tl.length && tl[j + 1].available <= date) j++;
    if (j < 0) continue;
    const f = tl[j];
    const m = multiplesAt(f, b[4], bank);
    out.push({ date, price: b[4], basis: f.label, ...m });
  }
  return out;
}

export interface MultipleStats {
  current: number | null;
  median: number | null;
  mean: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  /** Share of observations at or below the current value (0–1) */
  percentile: number | null;
  n: number;
}

export function multipleStats(values: (number | null | undefined)[]): MultipleStats {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  const current = values.length ? (values[values.length - 1] ?? null) : null;
  if (!v.length) return { current, median: null, mean: null, sd: null, min: null, max: null, percentile: null, n: 0 };
  const s = [...v].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return {
    current,
    median,
    mean,
    sd,
    min: s[0],
    max: s[s.length - 1],
    percentile: current == null ? null : v.filter((x) => x <= current).length / v.length,
    n: v.length,
  };
}
