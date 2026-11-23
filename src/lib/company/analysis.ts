// Computed financial analysis for the company Overview. Everything here is arithmetic on the statements in a
// CompanyDataset (income statement, balance sheet, cash flow): growth, margins, returns, leverage, liquidity,
// cash conversion, per-share figures and capital returned, each over the trailing twelve months, a year earlier and
// the last six fiscal years. Every figure keeps the formula in words and every filed number behind it, so a click
// opens its source. Banks and brokers get the measures that fit them. No model writes any of it. Pure.
import type { SourceTarget } from "@/components/source/source-context";
import { partsFrom } from "@/lib/financials/build";
import { isBankIndustry } from "@/lib/financials/dataset";
import type { Cell, CompanyDataset, DerivedPart, Period, Statement, StatementKey } from "@/lib/financials/types";

type Stmts = Record<StatementKey, Statement>;
type FlowStatement = "income" | "cashflow";

/** A computed figure: its value, the period it covers, the formula in words and every filed number behind it. */
export interface Fig {
  v: number;
  /** "TTM to Q3 FY26", "FY2025", "Q3 FY26" */
  period: string;
  formula: string;
  parts: DerivedPart[];
  /** the figure is one filed number, not a calculation */
  direct?: boolean;
}

export type MeasureUnit = "pct" | "x" | "usd" | "perShare" | "days" | "quarters";

export interface Measure {
  key: string;
  label: string;
  unit: MeasureUnit;
  /** which direction is an improvement, for the sign colour of a change; null when neither is */
  better: "high" | "low" | null;
  /** the current figure: trailing twelve months, or the latest fiscal year when four quarters are not available */
  now: Fig | null;
  /** the same measure one year earlier */
  prior: Fig | null;
  /** fiscal-year history, oldest first (up to six years) */
  history: { fy: number; label: string; fig: Fig | null }[];
  /** median of the fiscal years in `history` that have a value, newest five at most; needs three */
  median: { v: number; n: number; from: string; to: string } | null;
  /** why the current figure is missing, when it is */
  note?: string;
}

export type GroupId = "growth" | "margins" | "returns" | "leverage" | "liquidity" | "cash" | "perShare" | "capital" | "bankProfit" | "bankBalance";

export interface MeasureGroup {
  id: GroupId;
  title: string;
  measures: Measure[];
}

/** Return on equity split into its three parts (net margin × asset turnover × equity multiplier). */
export interface DuPont {
  period: string;
  netMargin: Fig;
  assetTurnover: Fig;
  leverage: Fig;
  roe: Fig;
}

/** A headline level (dollars or dollars per share) with the same figure a year earlier and its recent run. */
export interface KeyFigure {
  key: string;
  label: string;
  unit: "usd" | "perShare";
  now: Fig | null;
  prior: Fig | null;
  /** the trailing-twelve-month value at each of the last eight quarter ends, oldest first (balances: the quarter-end value) */
  run: (number | null)[];
}

export interface FinancialAnalysis {
  ticker: string;
  kind: "bank" | "company";
  /** what "now" means in this analysis */
  basis: "ttm" | "fy";
  /** label of the current span: "TTM to Q3 FY26" or "FY2025" */
  current: string | null;
  /** the latest quarter in the statements, and the latest fiscal year */
  quarter: Period | null;
  fiscalYear: Period | null;
  keyFigures: KeyFigure[];
  groups: MeasureGroup[];
  dupont: DuPont | null;
  /** base figures of the current span that the read's rules size things against */
  facts: Record<"revenue" | "receivables" | "inventory" | "equity" | "liquid" | "totalDebt", Fig | null>;
}

/* ------------------------------------------------------------------ cells and figures */

const cellAt = (st: Statement | undefined, key: string, i: number): Cell | null => (st && i >= 0 ? (st.rows.find((r) => r.key === key)?.cells[i] ?? null) : null);

/** One statement cell as a figure. */
function point(st: Statement | undefined, key: string, i: number, name: string): Fig | null {
  const c = cellAt(st, key, i);
  const p = st?.periods[i];
  if (!c || !p) return null;
  return { v: c.v, period: p.label, formula: c.derived ? `${name} (${p.label}): ${c.derived.formula}` : `${name} (${p.label})`, parts: partsFrom(c, `${name} · ${p.label}`, 1), direct: !!c.src };
}

const follows = (prev: Period, cur: Period) => (prev.fq === 4 ? cur.fy === prev.fy + 1 && cur.fq === 1 : cur.fy === prev.fy && cur.fq === (prev.fq ?? 0) + 1);
const partKey = (p: DerivedPart) => `${p.accn}|${p.concept}|${p.start ?? ""}|${p.end}|${p.label}`;
function mergeParts(figs: Fig[]): DerivedPart[] {
  const seen = new Set<string>();
  const out: DerivedPart[] = [];
  for (const f of figs)
    for (const p of f.parts) {
      const k = partKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  return out;
}
/** The same figure shown as a subtraction in the list of parts. */
const minus = (f: Fig | null): Fig | null => (f ? { ...f, parts: f.parts.map((p) => ({ ...p, sign: (p.sign * -1) as 1 | -1 })) } : null);

/**
 * A figure computed from others. Null when a required input is missing or the result is not a finite number;
 * optional inputs count as zero when missing and bring their parts when present.
 */
function calc(period: string, formula: string, required: (Fig | null)[], f: (v: number[], o: number[]) => number | null, optional: (Fig | null)[] = []): Fig | null {
  if (required.some((x) => !x)) return null;
  const v = f(
    required.map((x) => x!.v),
    optional.map((x) => x?.v ?? 0),
  );
  if (v == null || !Number.isFinite(v)) return null;
  return { v, period, formula, parts: mergeParts([...(required as Fig[]), ...optional.filter((x): x is Fig => !!x)]) };
}

/* ------------------------------------------------------------------ spans */

/** A stretch of time a measure is computed over: the trailing twelve months to a quarter end, or one fiscal year. */
interface Span {
  kind: "ttm" | "fy";
  label: string;
  /** label of the period the span ends with ("Q3 FY26", "FY2025"): what a balance-sheet figure is dated */
  at: string;
  fy: number;
  /** a flow over the span */
  flow(st: FlowStatement, key: string, name: string): Fig | null;
  /** an income-statement line of the span's last period that is not summed (weighted share counts) */
  last(key: string, name: string): Fig | null;
  /** a balance at the end of the span */
  bal(key: string, name: string): Fig | null;
  /** the same balance one year before the end of the span */
  balPrior(key: string, name: string): Fig | null;
  /** whether a balance-sheet line carried a positive balance in the two years before the end of the span */
  had(key: string): boolean;
  /** largest ÷ smallest weighted diluted share count among the periods summed, when at least two are filed */
  shareSpread(): number | null;
  /** the same span one year earlier */
  prev(): Span | null;
}

function ttmSpan(Q: Stmts, A: Stmts, end: number): Span | null {
  const ps = Q.income.periods;
  if (end < 3 || end >= ps.length) return null;
  const idx = [end - 3, end - 2, end - 1, end];
  for (let n = 1; n < 4; n++) if (!follows(ps[idx[n - 1]], ps[idx[n]])) return null;
  const last = ps[end];
  const label = `TTM to ${last.label}`;
  const yearAgo = ps.findIndex((p) => p.fy === last.fy - 1 && p.fq === last.fq);
  return {
    kind: "ttm",
    label,
    at: last.label,
    fy: last.fy,
    flow: (st, key, name) => {
      const cells = idx.map((i) => cellAt(Q[st], key, i));
      if (cells.some((c) => !c)) return null;
      return {
        v: cells.reduce((s, c) => s + c!.v, 0),
        period: label,
        formula: `${name}, ${ps[idx[0]].label} to ${last.label}`,
        parts: idx.flatMap((i, n) => partsFrom(cells[n], `${name} · ${ps[i].label}`, 1)),
      };
    },
    last: (key, name) => {
      const own = point(Q.income, key, end, name);
      if (own || last.fq !== 4) return own;
      // a fourth quarter's weighted share count is not filed on its own: the fiscal year's stands in
      return point(A.income, key, A.income.periods.findIndex((p) => p.fy === last.fy), name);
    },
    bal: (key, name) => point(Q.balance, key, end, name),
    balPrior: (key, name) => point(Q.balance, key, yearAgo, name),
    had: (key) => {
      for (let i = Math.max(0, end - 8); i < end; i++) if ((cellAt(Q.balance, key, i)?.v ?? 0) > 0) return true;
      return false;
    },
    shareSpread: () => {
      const n = idx.map((i) => cellAt(Q.income, "sharesDiluted", i)?.v).filter((v): v is number => v != null && v > 0);
      return n.length >= 2 ? Math.max(...n) / Math.min(...n) : null;
    },
    prev: () => ttmSpan(Q, A, yearAgo),
  };
}

function fySpan(A: Stmts, i: number): Span | null {
  const p = A.income.periods[i];
  if (!p) return null;
  const before = A.income.periods.findIndex((x) => x.fy === p.fy - 1);
  return {
    kind: "fy",
    label: p.label,
    at: p.label,
    fy: p.fy,
    flow: (st, key, name) => point(A[st], key, i, name),
    last: (key, name) => point(A.income, key, i, name),
    bal: (key, name) => point(A.balance, key, i, name),
    balPrior: (key, name) => point(A.balance, key, before, name),
    had: (key) => {
      for (let k = Math.max(0, i - 2); k < i; k++) if ((cellAt(A.balance, key, k)?.v ?? 0) > 0) return true;
      return false;
    },
    shareSpread: () => null,
    prev: () => fySpan(A, before),
  };
}

/* ------------------------------------------------------------------ measure definitions */

type Def = (s: Span) => Fig | null;

const flow = (st: FlowStatement, key: string, name: string): Def => (s) => s.flow(st, key, name);
const revenue = flow("income", "revenue", "Revenue");
const netIncome = flow("income", "netIncome", "Net income");
const operatingIncome = flow("income", "operatingIncome", "Operating income");
const fcf = flow("cashflow", "fcf", "Free cash flow");
const cfo = flow("cashflow", "cfo", "Cash from operations");

/** `num ÷ den` over one span; null when the denominator is not positive. */
const over = (num: Def, den: Def, formula: string): Def => (s) => calc(s.label, formula, [num(s), den(s)], ([a, b]) => (b > 0 ? a / b : null));
/** Growth of a flow against the same span a year earlier; null when the earlier figure is not positive. */
const growth = (f: Def, what: string): Def => (s) => {
  const p = s.prev();
  return p ? calc(s.label, `${what}: ${s.label} ÷ ${p.label} − 1`, [f(s), f(p)], ([a, b]) => (b > 0 ? a / b - 1 : null)) : null;
};
/** Average of a balance at the end of the span and one year before it. */
const average = (key: string, name: string): Def => (s) =>
  calc(s.label, `Average ${name.toLowerCase()}, start and end of the period`, [s.bal(key, name), s.balPrior(key, name)], ([a, b]) => (a + b) / 2);
const balance = (key: string, name: string): Def => (s) => s.bal(key, name);

const avgAssets = average("totalAssets", "Total assets");

/** Return on equity needs positive equity at both ends of the period: an average that straddles a deficit means nothing. */
const equityEnds = (s: Span): (Fig | null)[] => [s.bal("equity", "Shareholders' equity"), s.balPrior("equity", "Shareholders' equity")];
const roe: Def = (s) => calc(s.label, "Net income ÷ average shareholders' equity (start and end of the period; preferred stock, where there is any, is part of both)", [netIncome(s), ...equityEnds(s)], ([n, e1, e0]) => (e1 > 0 && e0 > 0 ? n / ((e1 + e0) / 2) : null));
const roa: Def = (s) => calc(s.label, "Net income ÷ average total assets", [netIncome(s), avgAssets(s)], ([n, a]) => (a > 0 ? n / a : null));
/** After-tax operating income over average invested capital (total debt + equity), the tax rate held between 0 and 50%. */
const roic: Def = (s) =>
  calc(
    s.label,
    "Operating income × (1 − income tax ÷ pretax income) ÷ average (total debt + shareholders' equity)",
    [
      operatingIncome(s),
      s.flow("income", "incomeTax", "Income tax"),
      s.flow("income", "pretaxIncome", "Pretax income"),
      s.bal("totalDebt", "Total debt"),
      s.bal("equity", "Shareholders' equity"),
      s.balPrior("totalDebt", "Total debt"),
      s.balPrior("equity", "Shareholders' equity"),
    ],
    ([oi, tax, pretax, d1, e1, d0, e0]) => {
      const invested = (d1 + e1 + d0 + e0) / 2;
      if (pretax <= 0 || invested <= 0) return null;
      return (oi * (1 - Math.min(0.5, Math.max(0, tax / pretax)))) / invested;
    },
  );
/**
 * Tangible equity. Intangible assets other than goodwill are netted only when the statements give them at every
 * balance date the analysis uses: netting them at one date and not at another would move the figure for no reason.
 */
const TANGIBLE = { full: "shareholders' equity − goodwill − intangible assets", goodwillOnly: "shareholders' equity − goodwill; other intangible assets are not in the statements for every period, so they are not netted" };
const tangibleEquity =
  (netIntangibles: boolean) =>
  (s: Span, when: "bal" | "balPrior"): Fig | null =>
    calc(
      s.label,
      `Tangible equity: ${netIntangibles ? TANGIBLE.full : TANGIBLE.goodwillOnly}`,
      [s[when]("equity", "Shareholders' equity")],
      ([e], [g, i]) => e - g - i,
      [minus(s[when]("goodwill", "Goodwill")), netIntangibles ? minus(s[when]("intangibles", "Intangible assets")) : null],
    );

/**
 * Short-term investments were filed in recent periods but are absent at the end of this one. That is a changed tag in the
 * filing, not a balance of zero, so anything that nets them (net debt, the quick ratio, cash runway) is withheld.
 */
const investmentsMissing = (s: Span) => !s.bal("shortTermInvestments", "Short-term investments") && s.had("shortTermInvestments");
const MISSING_INVESTMENTS = "short-term investments are missing from this period's balance sheet in the statements";
const liquid = (s: Span): Fig | null =>
  investmentsMissing(s) ? null : calc(s.at, "Cash + short-term investments", [s.bal("cash", "Cash and equivalents")], ([c], [sti]) => c + sti, [s.bal("shortTermInvestments", "Short-term investments")]);
/** Net debt as the statements give it (total debt − cash and short-term investments), withheld when the investments line is missing. */
const netDebt: Def = (s) => (investmentsMissing(s) ? null : s.bal("netDebt", "Net debt"));

const sharesLast: Def = (s) => s.last("sharesDiluted", "Diluted shares (weighted)");

/** Diluted EPS over the span; over twelve months it is the sum of the four quarters, kept only when it agrees in sign with net income. */
const eps: Def = (s) => {
  const e = s.flow("income", "epsDiluted", "Diluted EPS");
  const n = netIncome(s);
  if (!e || (n && n.v !== 0 && Math.sign(e.v) !== Math.sign(n.v))) return null;
  // quarterly EPS figures on very different share counts (an IPO or a recapitalisation inside the period) do not add up
  const spread = s.shareSpread();
  return spread != null && spread > 1.25 ? null : e;
};

/* ------------------------------------------------------------------ building */

interface Ctx {
  cur: Span | null;
  years: Span[];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function build(ctx: Ctx, key: string, label: string, unit: MeasureUnit, better: Measure["better"], def: Def, note?: (s: Span) => string | undefined): Measure {
  const now = ctx.cur ? def(ctx.cur) : null;
  const before = ctx.cur?.prev() ?? null;
  const history = ctx.years.map((y) => ({ fy: y.fy, label: y.label, fig: def(y) }));
  const have = history.filter((h) => h.fig).slice(-5);
  return {
    key,
    label,
    unit,
    better,
    now,
    prior: before ? def(before) : null,
    history,
    median: have.length >= 3 ? { v: median(have.map((h) => h.fig!.v)), n: have.length, from: have[0].label, to: have[have.length - 1].label } : null,
    ...(!now && note && ctx.cur && note(ctx.cur) ? { note: note(ctx.cur) } : {}),
  };
}

/** Compound annual growth of a flow over `n` fiscal years ending at `s`. */
const cagr = (f: Def, n: number, back: (s: Span, n: number) => Span | null, what: string): Def => (s) => {
  const from = back(s, n);
  return from ? calc(s.label, `(${what} ${s.label} ÷ ${from.label})^(1/${n}) − 1`, [f(s), f(from)], ([a, b]) => (a > 0 && b > 0 ? Math.pow(a / b, 1 / n) - 1 : null)) : null;
};

/** Compute the analysis. `today` is not needed: nothing here depends on the clock. */
export function analyze(d: CompanyDataset): FinancialAnalysis {
  const Q = d.statements.quarterly;
  const A = d.statements.annual;
  const bank = isBankIndustry(d.profile.industry);
  const ticker = d.profile.ticker;
  const head = bank ? "netIncome" : "revenue";

  // the latest quarter and fiscal year that carry the headline line
  const lastWith = (st: Statement, key: string) => {
    const cells = st.rows.find((r) => r.key === key)?.cells ?? [];
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i]) return i;
    return -1;
  };
  const qi = Math.max(lastWith(Q.income, "revenue"), lastWith(Q.income, head));
  const ai = Math.max(lastWith(A.income, "revenue"), lastWith(A.income, head));
  const ttm = qi >= 0 ? ttmSpan(Q, A, qi) : null;
  const years: Span[] = [];
  for (let i = Math.max(0, ai - 5); i <= ai; i++) {
    const y = fySpan(A, i);
    if (y) years.push(y);
  }
  const latestYear = years.at(-1) ?? null;
  // trailing twelve months when four consecutive quarters with revenue exist; otherwise the latest fiscal year
  const cur = ttm && revenue(ttm) ? ttm : latestYear;
  const ctx: Ctx = { cur, years };
  const m = (key: string, label: string, unit: MeasureUnit, better: Measure["better"], def: Def, note?: (s: Span) => string | undefined) => build(ctx, key, label, unit, better, def, note);

  /* ---- growth: the latest quarter against a year earlier and against the quarter before, then the longer runs */
  const ps = Q.income.periods;
  const quarterGrowth = (key: string, name: string, lag: "year" | "quarter", i: number): Fig | null => {
    const p = ps[i];
    if (!p) return null;
    const j = lag === "year" ? ps.findIndex((x) => x.fy === p.fy - 1 && x.fq === p.fq) : i > 0 && follows(ps[i - 1], p) ? i - 1 : -1;
    const a = point(Q.income, key, i, name);
    const b = point(Q.income, key, j, name);
    return a && b ? calc(p.label, `${name}: ${p.label} ÷ ${ps[j].label} − 1`, [a, b], ([x, y]) => (y > 0 ? x / y - 1 : null)) : null;
  };
  const yearAgoIndex = qi >= 0 ? ps.findIndex((x) => x.fy === ps[qi].fy - 1 && x.fq === ps[qi].fq) : -1;
  const quarterly = (key: string, label: string, name: string, lag: "year" | "quarter"): Measure => ({
    key,
    label,
    unit: "pct",
    better: "high",
    now: quarterGrowth("revenue", name, lag, qi),
    prior: quarterGrowth("revenue", name, lag, yearAgoIndex),
    history: [],
    median: null,
  });
  const backYears = (s: Span, n: number): Span | null => {
    let x: Span | null = s;
    for (let k = 0; k < n && x; k++) x = x.prev();
    return x;
  };
  // compound growth is a fiscal-year measure: it is anchored on the latest fiscal year, not on the trailing twelve months
  const compound = (key: string, label: string, f: Def, n: number, what: string): Measure => {
    const def = cagr(f, n, backYears, what);
    return {
      key,
      label,
      unit: "pct",
      better: "high",
      now: latestYear ? def(latestYear) : null,
      prior: latestYear?.prev() ? def(latestYear.prev()!) : null,
      history: [],
      median: null,
    };
  };
  const growthGroup: MeasureGroup = {
    id: "growth",
    title: "Growth",
    measures: [
      m("revenueGrowth", "Revenue", "pct", "high", growth(revenue, "Revenue")),
      ...(bank ? [m("niiGrowth", "Net interest income", "pct", "high", growth(flow("income", "netInterestIncome", "Net interest income"), "Net interest income"))] : []),
      m("netIncomeGrowth", "Net income", "pct", "high", growth(netIncome, "Net income")),
      m("epsGrowth", "Diluted EPS", "pct", "high", growth(eps, "Diluted EPS")),
      ...(bank ? [] : [m("fcfGrowth", "Free cash flow", "pct", "high", growth(fcf, "Free cash flow"))]),
      quarterly("revenueYoY", "Revenue, latest quarter on a year earlier", "Revenue", "year"),
      quarterly("revenueSeq", "Revenue, latest quarter on the one before", "Revenue", "quarter"),
      compound("revenueCagr3", "Revenue, 3-year compound rate", revenue, 3, "Revenue"),
      compound("revenueCagr5", "Revenue, 5-year compound rate", revenue, 5, "Revenue"),
    ],
  };

  /* ---- per share and capital returned are the same for both kinds */
  const perShare: MeasureGroup = {
    id: "perShare",
    title: "Per share and dilution",
    measures: [
      m("eps", "Diluted EPS", "perShare", "high", eps, (s) => (s.flow("income", "epsDiluted", "Diluted EPS") ? "the quarterly EPS figures do not add up to the period's result (the share count changed within it)" : undefined)),
      ...(bank ? [] : [m("fcfPerShare", "Free cash flow per share", "perShare", "high", (s) => calc(s.label, "Free cash flow ÷ diluted shares (weighted, latest period)", [fcf(s), sharesLast(s)], ([f, n]) => (n > 0 ? f / n : null)))]),
      m("bookPerShare", "Book value per share", "perShare", "high", (s) =>
        calc(s.at, "Shareholders' equity ÷ shares outstanding at the period end", [s.bal("equity", "Shareholders' equity"), s.bal("sharesOutstanding", "Shares outstanding")], ([e, n]) => (n > 0 ? e / n : null)),
      ),
      m("dividendPerShare", "Dividends declared per share", "perShare", "high", flow("income", "dividendsPerShare", "Dividends per share")),
      m("shareChange", "Diluted share count, change over a year", "pct", "low", (s) => {
        const p = s.prev();
        return p ? calc(s.label, `Diluted shares (weighted): ${s.label} ÷ ${p.label} − 1`, [sharesLast(s), sharesLast(p)], ([a, b]) => (b > 0 ? a / b - 1 : null)) : null;
      }),
    ],
  };
  const buybacks = flow("cashflow", "buybacks", "Share repurchases");
  const dividends = flow("cashflow", "dividends", "Dividends paid");
  const capital: MeasureGroup = {
    id: "capital",
    title: "Capital returned",
    measures: [
      m("buybacks", "Share repurchases", "usd", null, buybacks),
      m("dividends", "Dividends paid", "usd", null, dividends),
      m("payout", "Dividends as a share of net income", "pct", null, (s) => calc(s.label, "Dividends paid ÷ net income", [dividends(s), netIncome(s)], ([dv, n]) => (n > 0 ? dv / n : null))),
      ...(bank
        ? [m("totalPayout", "Dividends and repurchases as a share of net income", "pct", null, (s) => calc(s.label, "(Dividends paid + share repurchases) ÷ net income", [netIncome(s)], ([n], [b, dv]) => (n > 0 && b + dv > 0 ? (b + dv) / n : null), [buybacks(s), dividends(s)]))]
        : [
            m("returnedToFcf", "Dividends and repurchases as a share of free cash flow", "pct", null, (s) =>
              calc(s.label, "(Dividends paid + share repurchases) ÷ free cash flow", [fcf(s)], ([f], [b, dv]) => (f > 0 && b + dv > 0 ? (b + dv) / f : null), [buybacks(s), dividends(s)]),
            ),
            m("buybacksNetOfSbc", "Repurchases less stock compensation", "usd", null, (s) => calc(s.label, "Share repurchases − stock-based compensation", [buybacks(s), minus(s.flow("cashflow", "sbc", "Stock-based compensation"))], ([b, c]) => b - c)),
          ]),
    ],
  };

  // intangible assets other than goodwill: netted from tangible equity only when every balance date in use has them
  const yearBefore = (i: number) => (i >= 0 ? ps.findIndex((x) => x.fy === ps[i].fy - 1 && x.fq === ps[i].fq) : -1);
  const balanceDates: [Statement, number][] = [
    ...[qi, yearBefore(qi), yearBefore(yearBefore(qi))].filter((i) => i >= 0).map((i): [Statement, number] => [Q.balance, i]),
    ...years.flatMap((y): [Statement, number][] => {
      const i = A.balance.periods.findIndex((x) => x.fy === y.fy);
      return [i, i - 1].filter((k) => k >= 0).map((k): [Statement, number] => [A.balance, k]);
    }),
  ];
  const netIntangibles = balanceDates.length > 0 && balanceDates.every(([st, i]) => !cellAt(st, "equity", i) || !!cellAt(st, "intangibles", i));
  const tangible = tangibleEquity(netIntangibles);
  const rote: Def = (s) =>
    calc(s.label, `Net income ÷ average tangible equity (${netIntangibles ? TANGIBLE.full : TANGIBLE.goodwillOnly}; preferred stock is part of equity)`, [netIncome(s), tangible(s, "bal"), tangible(s, "balPrior")], ([n, a, b]) =>
      a > 0 && b > 0 ? n / ((a + b) / 2) : null,
    );

  const returnsCommon = [
    m("roe", "Return on equity", "pct", "high", roe, (s) => (equityEnds(s).some((e) => e && e.v <= 0) ? "shareholders' equity was negative at the start or end of the period" : undefined)),
  ];

  let groups: MeasureGroup[];
  if (bank) {
    const nii = flow("income", "netInterestIncome", "Net interest income");
    const nonInterestExpense = flow("income", "nonInterestExpense", "Noninterest expense");
    const provision = flow("income", "provisionCreditLosses", "Provision for credit losses");
    groups = [
      growthGroup,
      {
        id: "bankProfit",
        title: "Profitability",
        measures: [
          m("efficiency", "Efficiency ratio", "pct", "low", over(nonInterestExpense, revenue, "Noninterest expense ÷ revenue")),
          m("netMargin", "Net margin", "pct", "high", over(netIncome, revenue, "Net income ÷ revenue")),
          m("niiShare", "Net interest income as a share of revenue", "pct", null, over(nii, revenue, "Net interest income ÷ revenue")),
          m("niiToAssets", "Net interest income to average assets", "pct", "high", (s) => calc(s.label, "Net interest income ÷ average total assets", [nii(s), avgAssets(s)], ([n, a]) => (a > 0 ? n / a : null))),
          m("provisionToLoans", "Provision for credit losses to average net loans", "pct", "low", (s) =>
            calc(s.label, "Provision for credit losses ÷ average loans net of allowance", [provision(s), average("loans", "Loans, net of allowance")(s)], ([p, l]) => (l > 0 ? p / l : null)),
          ),
          m("provisionToRevenue", "Provision for credit losses as a share of revenue", "pct", "low", (s) => calc(s.label, "Provision for credit losses ÷ revenue", [provision(s), revenue(s)], ([p, r]) => (r > 0 ? p / r : null))),
        ],
      },
      {
        id: "returns",
        title: "Returns",
        measures: [...returnsCommon, m("rote", "Return on tangible equity", "pct", "high", rote), m("roa", "Return on assets", "pct", "high", roa)],
      },
      {
        id: "bankBalance",
        title: "Balance sheet",
        measures: [
          m("loansToDeposits", "Net loans to deposits", "pct", null, (s) => calc(s.at, "Loans net of allowance ÷ deposits", [s.bal("loans", "Loans, net of allowance"), s.bal("deposits", "Deposits")], ([l, dp]) => (dp > 0 ? l / dp : null))),
          m("equityToAssets", "Equity to assets", "pct", "high", (s) => calc(s.at, "Shareholders' equity ÷ total assets", [s.bal("equity", "Shareholders' equity"), s.bal("totalAssets", "Total assets")], ([e, a]) => (a > 0 ? e / a : null))),
          m("tangibleToAssets", "Tangible equity to assets", "pct", "high", (s) => calc(s.at, `Tangible equity ÷ total assets (${netIntangibles ? TANGIBLE.full : TANGIBLE.goodwillOnly})`, [tangible(s, "bal"), s.bal("totalAssets", "Total assets")], ([e, a]) => (a > 0 ? e / a : null))),
          m("depositGrowth", "Deposits, change over a year", "pct", "high", (s) => calc(s.at, "Deposits at the period end ÷ a year earlier − 1", [s.bal("deposits", "Deposits"), s.balPrior("deposits", "Deposits")], ([a, b]) => (b > 0 ? a / b - 1 : null))),
          m("loanGrowth", "Net loans, change over a year", "pct", "high", (s) => calc(s.at, "Loans net of allowance at the period end ÷ a year earlier − 1", [s.bal("loans", "Loans, net of allowance"), s.balPrior("loans", "Loans, net of allowance")], ([a, b]) => (b > 0 ? a / b - 1 : null))),
        ],
      },
      perShare,
      capital,
    ];
  } else {
    const grossProfit = flow("income", "grossProfit", "Gross profit");
    const ebitda = flow("income", "ebitda", "EBITDA");
    const interest = flow("income", "interestExpense", "Interest expense");
    const capex = flow("cashflow", "capex", "Capital expenditures");
    const sbc = flow("cashflow", "sbc", "Stock-based compensation");
    const cogs = flow("income", "costOfRevenue", "Cost of revenue");
    const yearChange = (key: string, name: string): Def => (s) => calc(s.at, `${name} at the period end ÷ a year earlier − 1`, [s.bal(key, name), s.balPrior(key, name)], ([a, b]) => (b > 0 ? a / b - 1 : null));
    groups = [
      growthGroup,
      {
        id: "margins",
        title: "Margins",
        measures: [
          m("grossMargin", "Gross margin", "pct", "high", over(grossProfit, revenue, "Gross profit ÷ revenue")),
          m("operatingMargin", "Operating margin", "pct", "high", (s) => calc(s.label, "Operating income ÷ revenue", [operatingIncome(s), revenue(s)], ([o, r]) => (r > 0 ? o / r : null))),
          m("netMargin", "Net margin", "pct", "high", (s) => calc(s.label, "Net income ÷ revenue", [netIncome(s), revenue(s)], ([n, r]) => (r > 0 ? n / r : null))),
          m("fcfMargin", "Free cash flow margin", "pct", "high", (s) => calc(s.label, "Free cash flow ÷ revenue", [fcf(s), revenue(s)], ([f, r]) => (r > 0 ? f / r : null))),
        ],
      },
      {
        id: "returns",
        title: "Returns",
        measures: [
          ...returnsCommon,
          m("roic", "Return on invested capital", "pct", "high", roic),
          m("roa", "Return on assets", "pct", "high", roa),
        ],
      },
      {
        id: "leverage",
        title: "Leverage and coverage",
        measures: [
          m("netDebtToEbitda", "Net debt to EBITDA", "x", "low", (s) => calc(s.label, "Net debt (total debt − cash and short-term investments) ÷ EBITDA", [netDebt(s), ebitda(s)], ([n, e]) => (e > 0 ? n / e : null)), (s) => {
            if (!s.bal("totalDebt", "Total debt")) return undefined;
            if (investmentsMissing(s)) return MISSING_INVESTMENTS;
            const e = ebitda(s);
            return e && e.v <= 0 ? "EBITDA is negative" : undefined;
          }),
          m("debtToEquity", "Total debt to equity", "x", "low", (s) => calc(s.at, "Total debt ÷ shareholders' equity", [s.bal("totalDebt", "Total debt"), s.bal("equity", "Shareholders' equity")], ([dt, e]) => (e > 0 ? dt / e : null))),
          m("interestCover", "Interest cover", "x", "high", (s) => calc(s.label, "Operating income ÷ interest expense", [operatingIncome(s), interest(s)], ([o, i]) => (i > 0 && o > 0 ? o / i : null)), (s) => {
            const o = operatingIncome(s);
            if (!o) return undefined;
            if (!interest(s)) return "interest expense is not reported as its own line";
            return o.v <= 0 ? "operating income is negative" : undefined;
          }),
        ],
      },
      {
        id: "liquidity",
        title: "Liquidity",
        measures: [
          m("currentRatio", "Current ratio", "x", "high", (s) => calc(s.at, "Current assets ÷ current liabilities", [s.bal("currentAssets", "Current assets"), s.bal("currentLiabilities", "Current liabilities")], ([a, l]) => (l > 0 ? a / l : null))),
          m(
            "quickRatio",
            "Quick ratio",
            "x",
            "high",
            (s) =>
              investmentsMissing(s)
                ? null
                : calc(
                    s.at,
                    "(Cash + short-term investments + receivables) ÷ current liabilities",
                    [s.bal("cash", "Cash and equivalents"), s.bal("currentLiabilities", "Current liabilities")],
                    ([c, l], [sti, rec]) => (l > 0 ? (c + sti + rec) / l : null),
                    [s.bal("shortTermInvestments", "Short-term investments"), s.bal("receivables", "Accounts receivable")],
                  ),
            (s) => (investmentsMissing(s) ? MISSING_INVESTMENTS : undefined),
          ),
          m("cashRunway", "Cash runway at the trailing burn", "quarters", "high", (s) =>
            calc(s.label, "(Cash + short-term investments) ÷ (free cash outflow ÷ 4)", [liquid(s), fcf(s)], ([c, f]) => (f < 0 ? c / (-f / 4) : null)),
          ),
        ],
      },
      {
        id: "cash",
        title: "Cash conversion and quality",
        measures: [
          m("fcfConversion", "Free cash flow to net income", "pct", "high", (s) => calc(s.label, "Free cash flow ÷ net income", [fcf(s), netIncome(s)], ([f, n]) => (n > 0 ? f / n : null))),
          m("accruals", "Accruals to average assets", "pct", "low", (s) => calc(s.label, "(Net income − cash from operations) ÷ average total assets", [netIncome(s), minus(cfo(s)), avgAssets(s)], ([n, c, a]) => (a > 0 ? (n - c) / a : null))),
          m("capexIntensity", "Capital expenditures as a share of revenue", "pct", null, over(capex, revenue, "Capital expenditures ÷ revenue")),
          m("sbcIntensity", "Stock compensation as a share of revenue", "pct", "low", over(sbc, revenue, "Stock-based compensation ÷ revenue")),
          m("dso", "Days sales outstanding", "days", "low", (s) => calc(s.label, "Accounts receivable ÷ revenue × 365", [s.bal("receivables", "Accounts receivable"), revenue(s)], ([a, r]) => (r > 0 ? (a / r) * 365 : null))),
          m("inventoryDays", "Inventory days", "days", "low", (s) => calc(s.label, "Inventories ÷ cost of revenue × 365", [s.bal("inventory", "Inventories"), cogs(s)], ([a, c]) => (c > 0 ? (a / c) * 365 : null))),
          m("receivablesGrowth", "Receivables, change over a year", "pct", null, yearChange("receivables", "Accounts receivable")),
          m("inventoryGrowth", "Inventories, change over a year", "pct", null, yearChange("inventory", "Inventories")),
        ],
      },
      perShare,
      capital,
    ];
  }
  // a line the company does not report leaves a measure with no figure anywhere: drop it rather than show an empty row
  for (const g of groups) g.measures = g.measures.filter((x) => x.now || x.prior || x.note || x.history.some((h) => h.fig));
  groups = groups.filter((g) => g.measures.length > 0);

  /* ---- DuPont: net margin × asset turnover × equity multiplier */
  let dupont: DuPont | null = null;
  if (cur) {
    const nm = calc(cur.label, "Net income ÷ revenue", [netIncome(cur), revenue(cur)], ([n, r]) => (r > 0 ? n / r : null));
    const at = calc(cur.label, "Revenue ÷ average total assets", [revenue(cur), avgAssets(cur)], ([r, a]) => (a > 0 ? r / a : null));
    const lev = calc(cur.label, "Average total assets ÷ average shareholders' equity", [avgAssets(cur), ...equityEnds(cur)], ([a, e1, e0]) => (e1 > 0 && e0 > 0 ? a / ((e1 + e0) / 2) : null));
    const r = roe(cur);
    if (nm && at && lev && r) dupont = { period: cur.label, netMargin: nm, assetTurnover: at, leverage: lev, roe: r };
  }

  /* ---- headline levels with their run over the last eight quarter ends */
  const runOf = (def: Def): (number | null)[] => {
    if (qi < 0) return [];
    const out: (number | null)[] = [];
    for (let i = Math.max(0, qi - 7); i <= qi; i++) {
      const s = ttmSpan(Q, A, i);
      out.push(s ? (def(s)?.v ?? null) : null);
    }
    return out;
  };
  const level = (key: string, label: string, def: Def, unit: KeyFigure["unit"] = "usd"): KeyFigure => {
    const before = cur?.prev() ?? null;
    return { key, label, unit, now: cur ? def(cur) : null, prior: before ? def(before) : null, run: cur?.kind === "ttm" ? runOf(def) : years.map((y) => def(y)?.v ?? null) };
  };
  const keyFigures = (
    bank
      ? [
          level("revenue", "Revenue", revenue),
          level("netInterestIncome", "Net interest income", flow("income", "netInterestIncome", "Net interest income")),
          level("netIncome", "Net income", netIncome),
          level("deposits", "Deposits", balance("deposits", "Deposits")),
          level("loans", "Loans, net of allowance", balance("loans", "Loans, net of allowance")),
        ]
      : [
          level("revenue", "Revenue", revenue),
          level("operatingIncome", "Operating income", operatingIncome),
          level("netIncome", "Net income", netIncome),
          level("fcf", "Free cash flow", fcf),
          level("netDebt", "Net debt", netDebt),
        ]
  ).filter((k) => k.now);

  return {
    ticker,
    kind: bank ? "bank" : "company",
    basis: cur?.kind ?? "fy",
    current: cur?.label ?? null,
    quarter: qi >= 0 ? ps[qi] : null,
    fiscalYear: ai >= 0 ? A.income.periods[ai] : null,
    keyFigures,
    groups,
    dupont,
    facts: {
      revenue: cur ? revenue(cur) : null,
      receivables: cur?.bal("receivables", "Accounts receivable") ?? null,
      inventory: cur?.bal("inventory", "Inventories") ?? null,
      equity: cur?.bal("equity", "Shareholders' equity") ?? null,
      liquid: cur ? liquid(cur) : null,
      totalDebt: cur?.bal("totalDebt", "Total debt") ?? null,
    },
  };
}

/* ------------------------------------------------------------------ helpers for readers */

/** A measure by key, from any group. */
export function measureOf(a: FinancialAnalysis, key: string): Measure | null {
  for (const g of a.groups) {
    const x = g.measures.find((mm) => mm.key === key);
    if (x) return x;
  }
  return null;
}

const TARGET_UNIT: Record<MeasureUnit, string> = { pct: "pct", x: "ratio", usd: "usd", perShare: "usdPerShare", days: "days", quarters: "quarters" };

/** What the source panel opens for a figure: the filed number itself, or the calculation with every part. */
export function figTarget(ticker: string, label: string, fig: Fig, unit: MeasureUnit): SourceTarget {
  const base = { ticker, label, periodLabel: fig.period, unit: TARGET_UNIT[unit], value: fig.v };
  if (fig.direct && fig.parts.length === 1) {
    const { label: _label, sign: _sign, ...src } = fig.parts[0];
    return { ...base, src };
  }
  return { ...base, derived: { formula: fig.formula, parts: fig.parts } };
}

/** How far the current figure sits from its five-year median, in the measure's own unit (points for percentages). */
export const vsMedian = (x: Measure): number | null => (x.now && x.median ? x.now.v - x.median.v : null);
/** Change against a year earlier, in the measure's own unit (points for percentages). */
export const vsPrior = (x: Measure): number | null => (x.now && x.prior ? x.now.v - x.prior.v : null);
