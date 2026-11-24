// Quarterly results for the "Results & promises" tab: the latest quarter as a scorecard and the
// recent quarters as one history table. Pure (no I/O): reads the company dataset's quarterly
// statements, its earnings releases, the stock's reactions to those releases and, when the
// estimates provider has them, its EPS surprise records. Every value keeps the statement cell it
// came from (a SourceRef or a derived formula), and every computed figure carries a formula whose
// parts are those cells, so click-to-source works for all of it.
import type { Cell, CompanyDataset, DerivedPart, EarningsRelease, Filing, Period, Row, Statement } from "@/lib/financials/types";
import type { Reaction } from "@/lib/markets/core";
import type { PeriodEstimate, Surprise } from "@/lib/estimates/core";

/** A figure with its provenance: the statement cell, or a formula over statement cells. */
export interface Figure {
  v: number;
  /** Original cell (src / derived / approx) when the figure is a reported line. */
  cell?: Cell;
  /** Formula over reported cells when the figure is computed here. */
  derived?: { formula: string; parts: DerivedPart[] };
}

export type MetricKey = "revenue" | "profit" | "netIncome" | "eps" | "fcf";

export interface QuarterRecord {
  period: Period;
  revenue: Figure | null;
  /** Operating income; pre-tax income for companies that report no operating line (banks, insurers). */
  profit: Figure | null;
  netIncome: Figure | null;
  eps: Figure | null;
  fcf: Figure | null;
  grossMargin: Figure | null;
  profitMargin: Figure | null;
  netMargin: Figure | null;
  /** Year-over-year growth against the quarter ending about a year earlier. */
  yoy: Partial<Record<MetricKey, Figure>>;
  /** Change against the immediately preceding quarter. */
  qoq: Partial<Record<MetricKey, Figure>>;
  /** The earnings release that reported this quarter (see `releaseFor`); null when it cannot be established. */
  release: EarningsRelease | null;
  /** The stock's reaction to that release. */
  reaction: Reaction | null;
  /** Estimates provider's EPS actual vs consensus for this quarter. */
  surprise: Surprise | null;
}

export interface ProfitLine {
  key: "operatingIncome" | "pretaxIncome";
  label: string;
  marginLabel: string;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

function row(s: Statement | undefined, key: string): Row | undefined {
  return s?.rows.find((r) => r.key === key);
}

/** Statement parts behind a cell, labelled for the source panel. */
export function partsOf(cell: Cell | undefined, label: string, sign: 1 | -1 = 1): DerivedPart[] {
  if (!cell) return [];
  if (cell.derived) return cell.derived.parts.map((p) => ({ ...p, label: `${label} · ${p.label}`, sign: (p.sign * sign) as 1 | -1 }));
  if (cell.src) return [{ ...cell.src, label, sign }];
  return [];
}

function figPartsOf(f: Figure | null | undefined, label: string, sign: 1 | -1 = 1): DerivedPart[] {
  if (!f) return [];
  if (f.cell) return partsOf(f.cell, label, sign);
  return (f.derived?.parts ?? []).map((p) => ({ ...p, sign: (p.sign * sign) as 1 | -1 }));
}

/** Operating income when the company reports it in its latest quarters, otherwise pre-tax income. */
export function profitLine(d: CompanyDataset): ProfitLine {
  const inc = d.statements.quarterly.income;
  const op = row(inc, "operatingIncome");
  const recent = op?.cells.slice(-4).filter(Boolean).length ?? 0;
  return recent >= 2
    ? { key: "operatingIncome", label: "Operating income", marginLabel: "Operating margin" }
    : { key: "pretaxIncome", label: "Pre-tax income", marginLabel: "Pre-tax margin" };
}

/** Ratio a ÷ b as a figure with both statement cells as its parts. Null when b is not positive. */
export function ratio(a: Figure | null, b: Figure | null, formula: string, aLabel: string, bLabel: string): Figure | null {
  if (!a || !b || !(b.v > 0)) return null;
  return { v: a.v / b.v, derived: { formula, parts: [...figPartsOf(a, aLabel), ...figPartsOf(b, bLabel)] } };
}

/**
 * Growth from `prev` to `cur`: (cur − prev) ÷ |prev|. Null when the base is zero or missing, or when the
 * sign flips (a loss turning into a profit has no meaningful percentage).
 */
export function growth(cur: Figure | null, prev: Figure | null, label: string, basis: string): Figure | null {
  if (!cur || !prev || prev.v === 0) return null;
  if (Math.sign(cur.v) !== Math.sign(prev.v) && cur.v !== 0) return null;
  return {
    v: (cur.v - prev.v) / Math.abs(prev.v),
    derived: { formula: `${label} ÷ ${label.toLowerCase()} ${basis} − 1`, parts: [...figPartsOf(cur, `${label}, this quarter`), ...figPartsOf(prev, `${label}, ${basis}`, -1)] },
  };
}

/** Index of the quarter ending about a year (350 to 380 days) before period `i`. */
export function yearAgoIndex(periods: Period[], i: number): number {
  const end = periods[i]?.end;
  if (!end) return -1;
  for (let k = i - 1; k >= 0; k--) {
    const g = days(periods[k].end, end);
    if (g >= 350 && g <= 380) return k;
    if (g > 380) break;
  }
  return -1;
}

/** Index of the quarter immediately before `i` (its end 75 to 105 days earlier). */
export function priorIndex(periods: Period[], i: number): number {
  const k = i - 1;
  if (k < 0) return -1;
  const g = days(periods[k].end, periods[i].end);
  return g >= 75 && g <= 105 ? k : -1;
}

const PERIODIC_FORMS = new Set(["10-Q", "10-K", "10-QT", "10-KT"]);

/**
 * Filing date of the periodic report (original 10-Q or 10-K, not an amendment) whose report period ends
 * within five days of `end`: the document whose statements hold that quarter. Null when the filing list
 * has none (it is not filed yet, or the list does not reach back that far).
 */
export function periodicFiledFor(end: string, filings: Filing[] | null | undefined): string | null {
  let best: string | null = null;
  for (const f of filings ?? []) {
    if (!PERIODIC_FORMS.has(f.form) || !f.report) continue;
    if (Math.abs(days(f.report, end)) > 5) continue;
    const filed = f.filed.slice(0, 10);
    if (!best || filed < best) best = filed;
  }
  return best;
}

/**
 * The release that reported a quarter. Companies often file more than one Item 2.02 8-K a quarter
 * (Tesla's deliveries report, AbbVie's and EOG's pre-announcements), so position in the list says
 * nothing. When the periodic report holding the quarter is known, the release is the last one filed
 * after the quarter end and no later than that report (the results release precedes or accompanies the
 * 10-Q/10-K). Without that report, a release is matched only when it is the single one within 100 days
 * of the quarter end; two or more candidates leave the quarter unmatched rather than guessed.
 */
export function releaseFor(end: string, releases: EarningsRelease[], filings?: Filing[] | null): EarningsRelease | null {
  const periodic = periodicFiledFor(end, filings);
  const cands = releases.filter((r) => {
    const filed = r.filed.slice(0, 10);
    const g = days(end, filed);
    if (g <= 0) return false;
    return periodic ? filed <= periodic && g <= 120 : g <= 100;
  });
  if (!cands.length) return null;
  if (periodic) return cands.reduce((a, b) => (b.filed > a.filed ? b : a));
  return cands.length === 1 ? cands[0] : null;
}

/** The provider's surprise record for a quarter: its "quarter" date within 31 days of the period end (calendar vs fiscal ends). */
export function surpriseFor(end: string, surprises: Surprise[] | null | undefined): Surprise | null {
  let best: Surprise | null = null;
  let gap = Infinity;
  for (const s of surprises ?? []) {
    if (!s.quarter) continue;
    const g = Math.abs(days(s.quarter, end));
    if (g <= 31 && g < gap) {
      best = s;
      gap = g;
    }
  }
  return best;
}

function fig(c: Cell | null | undefined): Figure | null {
  return c && Number.isFinite(c.v) ? { v: c.v, cell: c } : null;
}

/** Free cash flow: the statement's own line, or operating cash flow minus capital expenditure. */
function fcfAt(cf: Statement | undefined, j: number): Figure | null {
  if (!cf || j < 0) return null;
  const own = fig(row(cf, "fcf")?.cells[j]);
  if (own) return own;
  const cfo = row(cf, "cfo")?.cells[j];
  const capex = row(cf, "capex")?.cells[j];
  if (!cfo || !capex) return null;
  return {
    v: cfo.v - Math.abs(capex.v),
    derived: { formula: "Cash from operations − capital expenditure", parts: [...partsOf(cfo, "Cash from operations"), ...partsOf(capex, "Capital expenditure", -1)] },
  };
}

export interface QuarterInputs {
  dataset: CompanyDataset;
  reactions?: Reaction[];
  surprises?: Surprise[] | null;
}

/** Every quarter in the dataset (oldest first) with its results, margins, growth, release, reaction and surprise. */
export function quarterRecords({ dataset: d, reactions = [], surprises }: QuarterInputs): QuarterRecord[] {
  const inc = d.statements.quarterly.income;
  const cf = d.statements.quarterly.cashflow;
  const periods = inc?.periods ?? [];
  if (!periods.length) return [];
  const pl = profitLine(d);
  const rev = row(inc, "revenue");
  const gp = row(inc, "grossProfit");
  const prof = row(inc, pl.key);
  const ni = row(inc, "netIncome");
  const eps = row(inc, "epsDiluted") ?? row(inc, "epsBasic");
  const cfIndex = new Map((cf?.periods ?? []).map((p, j) => [p.key, j]));
  const byDate = new Map(reactions.map((r) => [r.date, r]));

  const base = periods.map((p, i) => {
    const revenue = fig(rev?.cells[i]);
    const profit = fig(prof?.cells[i]);
    const netIncome = fig(ni?.cells[i]);
    const gross = fig(gp?.cells[i]);
    return {
      period: p,
      revenue,
      profit,
      netIncome,
      eps: fig(eps?.cells[i]),
      fcf: fcfAt(cf, cfIndex.get(p.key) ?? -1),
      grossMargin: ratio(gross, revenue, "Gross profit ÷ revenue", "Gross profit", "Revenue"),
      profitMargin: ratio(profit, revenue, `${pl.label} ÷ revenue`, pl.label, "Revenue"),
      netMargin: ratio(netIncome, revenue, "Net income ÷ revenue", "Net income", "Revenue"),
    };
  });

  const labels: Record<MetricKey, string> = { revenue: "Revenue", profit: pl.label, netIncome: "Net income", eps: "Diluted EPS", fcf: "Free cash flow" };
  const keys: MetricKey[] = ["revenue", "profit", "netIncome", "eps", "fcf"];
  return base.map((b, i) => {
    const y = yearAgoIndex(periods, i);
    const q = priorIndex(periods, i);
    const yoy: Partial<Record<MetricKey, Figure>> = {};
    const qoq: Partial<Record<MetricKey, Figure>> = {};
    for (const k of keys) {
      const gy = y >= 0 ? growth(b[k], base[y][k], labels[k], "a year earlier") : null;
      const gq = q >= 0 ? growth(b[k], base[q][k], labels[k], "the prior quarter") : null;
      if (gy) yoy[k] = gy;
      if (gq) qoq[k] = gq;
    }
    const release = releaseFor(b.period.end, d.earningsReleases, d.filings);
    return {
      ...b,
      yoy,
      qoq,
      release,
      reaction: release ? (byDate.get(release.filed.slice(0, 10)) ?? null) : null,
      surprise: surpriseFor(b.period.end, surprises),
    };
  });
}

/** The latest quarter with reported revenue or profit, and the quarters before it (newest first, up to `n` in all). */
export function recentQuarters(records: QuarterRecord[], n = 12): QuarterRecord[] {
  const withData = records.filter((r) => r.revenue || r.profit || r.netIncome);
  return withData.slice(-n).reverse();
}

export interface PendingRelease {
  /** The newest of the releases filed after the statements' latest quarter. */
  release: EarningsRelease;
  /** How many Item 2.02 releases were filed after the statements' latest quarter (and its periodic report). */
  count: number;
  /** The quarter the statements end with. */
  throughEnd: string;
  throughLabel: string;
  reaction: Reaction | null;
  /** The provider's EPS record for the quarter that release reports: its quarter end within 100 days before the release. */
  surprise: Surprise | null;
}

/**
 * Earnings releases filed after every quarter the statements hold: the company has reported results
 * whose figures the dataset does not have yet. A release counts only when it is filed after the latest
 * quarter's end, after the release matched to it and after the 10-Q/10-K that holds it, so a second
 * Item 2.02 filing inside the same quarter is never taken for a newer quarter. Which quarter each
 * release reports is not stated here (a company can file several a quarter); the caller names only
 * the count and the newest date. Null when the statements are current.
 */
export function pendingRelease(
  records: QuarterRecord[],
  releases: EarningsRelease[],
  reactions: Reaction[] = [],
  surprises?: Surprise[] | null,
  filings?: Filing[] | null,
): PendingRelease | null {
  const latest = [...records].reverse().find((r) => r.revenue || r.profit || r.netIncome);
  if (!latest) return null;
  const used = new Set(records.map((r) => r.release?.accn).filter(Boolean));
  const periodic = periodicFiledFor(latest.period.end, filings);
  const newer = releases
    .filter((r) => {
      const filed = r.filed.slice(0, 10);
      if (used.has(r.accn) || days(latest.period.end, filed) <= 0) return false;
      if (latest.release && r.filed <= latest.release.filed) return false;
      if (periodic && filed <= periodic) return false;
      return true;
    })
    .sort((a, b) => b.filed.localeCompare(a.filed));
  const rel = newer[0];
  if (!rel) return null;
  const relDate = rel.filed.slice(0, 10);
  const minEnd = latest.period.end;
  let surprise: Surprise | null = null;
  for (const s of surprises ?? []) {
    if (!s.quarter || s.quarter >= relDate || days(minEnd, s.quarter) <= 20) continue;
    if (days(s.quarter, relDate) > 100) continue;
    if (!surprise || s.quarter > surprise.quarter) surprise = s;
  }
  return {
    release: rel,
    count: newer.length,
    throughEnd: latest.period.end,
    throughLabel: latest.period.label,
    reaction: reactions.find((r) => r.date === relDate) ?? null,
    surprise,
  };
}

export interface ReactionSummary {
  n: number;
  /** Median absolute two-day move. */
  medianAbs: number;
  /** Share of releases followed by a rise. */
  upRate: number;
  /** Median two-day move minus the S&P 500 (SPY) over the same window. */
  medianExcess: number | null;
  /** Median drift over the 20 sessions after the reaction window. */
  medianDrift20: number | null;
  /** Largest absolute move. */
  largest: Reaction | null;
}

const median = (xs: number[]) => {
  const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Typical reaction over the last `n` releases (newest first in, any order accepted). */
export function reactionSummary(reactions: Reaction[], n = 12): ReactionSummary | null {
  const rs = [...reactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
  if (rs.length < 3) return null;
  const ex = rs.map((r) => r.excess).filter((x): x is number => x != null);
  const dr = rs.map((r) => r.drift20).filter((x): x is number => x != null);
  return {
    n: rs.length,
    medianAbs: median(rs.map((r) => Math.abs(r.move))),
    upRate: rs.filter((r) => r.move > 0).length / rs.length,
    medianExcess: ex.length >= 3 ? median(ex) : null,
    medianDrift20: dr.length >= 3 ? median(dr) : null,
    largest: rs.reduce<Reaction | null>((m, r) => (!m || Math.abs(r.move) > Math.abs(m.move) ? r : m), null),
  };
}

/**
 * The consensus for the next quarter to be reported: the earliest provider period (this quarter or next)
 * that ends more than 20 days after the last quarter already reported. Null without estimates.
 */
export function nextConsensus(periods: PeriodEstimate[] | null | undefined, lastReportedEnd: string | null): PeriodEstimate | null {
  if (!periods?.length || !lastReportedEnd) return null;
  const cands = periods
    .filter((p) => (p.code === "0q" || p.code === "+1q") && p.endDate && days(lastReportedEnd, p.endDate) > 20)
    .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""));
  const p = cands[0];
  return p && (p.eps.avg != null || p.revenue.avg != null) ? p : null;
}
