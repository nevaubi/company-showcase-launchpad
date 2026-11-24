// Quarterly results for the "Results & promises" tab: the latest quarter as a scorecard and the
// recent quarters as one history table. Pure (no I/O): reads the company dataset's quarterly
// statements, its earnings releases, the stock's reactions to those releases and, when the
// estimates provider has them, its EPS surprise records. Every value keeps the statement cell it
// came from (a SourceRef or a derived formula), and every computed figure carries a formula whose
// parts are those cells, so click-to-source works for all of it.
import type { Bar, Cell, CompanyDataset, DerivedPart, EarningsRelease, Filing, Period, Row, Statement } from "@/lib/financials/types";
import type { Reaction } from "@/lib/markets/core";
import type { PeriodEstimate, Surprise } from "@/lib/estimates/core";

/** A figure with its provenance: the statement cell, or a formula over statement cells. */
export interface Figure {
  v: number;
  /** Original cell (src / derived / approx) when the figure is a reported line. */
  cell?: Cell;
  /** Formula over reported cells when the figure is computed here. */
  derived?: { formula: string; parts: DerivedPart[] };
  /**
   * Set on fourth-quarter EPS, which no 10-K states as a quarter: "release" when the figure is the one
   * printed in the quarter's earnings release, "derived" when it is computed here from net income and
   * weighted diluted shares (earnings-H2). The page marks a derived figure as derived.
   */
  q4?: "release" | "derived";
  /** The release document and the printed line, for a figure taken from a release. */
  doc?: { accn: string; doc: string; quote?: string };
}

/** A per-share figure printed in an earnings release (the partner scorecard's GAAP diluted EPS), keyed by accession. */
export interface ReleaseEps {
  accn: string;
  v: number;
  quote?: string | null;
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
  /** The two adjusted closes behind the reaction, so the move can be inspected (earnings-M4). */
  window: ReactionWindow | null;
  /** Fourth quarter whose EPS is not shown: not in a release we hold and not reproducible from net income and shares. */
  q4EpsWithheld: boolean;
}

export interface ReactionWindow {
  from: { date: string; close: number };
  to: { date: string; close: number };
}

/**
 * The closes `earningsReactions` measures: the adjusted close of the session before the release date and
 * of the session after the first session on or after it. Null when the bars do not reach.
 */
export function reactionWindow(bars: Bar[] | undefined, filed: string): ReactionWindow | null {
  if (!bars?.length) return null;
  const d = filed.slice(0, 10);
  const i = bars.findIndex((b) => b[0] >= d);
  if (i <= 0 || i + 1 >= bars.length) return null;
  const a = bars[i - 1];
  const b = bars[i + 1];
  return { from: { date: a[0], close: a[5] }, to: { date: b[0], close: b[5] } };
}

/** Change of a margin in percentage points, with both margins' parts (earnings-M4). */
export function pointsChange(cur: Figure | null, prev: Figure | null, label: string, basis: string): Figure | null {
  if (!cur || !prev) return null;
  return {
    v: cur.v - prev.v,
    derived: { formula: `${label} this quarter − ${label[0].toLowerCase() + label.slice(1)} ${basis}, in percentage points`, parts: [...figPartsOf(cur, `${label}, this quarter`), ...figPartsOf(prev, `${label}, ${basis}`, -1)] },
  };
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
  if (f.doc) return [{ accn: f.doc.accn, doc: f.doc.doc, concept: "Earnings release, printed figure", end: "", value: f.v, label, sign }];
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
 * Growth from `prev` to `cur`: cur ÷ prev − 1. Null when the base is zero, negative or missing, or when
 * the current value is negative (a profit turning into a loss has no meaningful percentage).
 */
export function growth(cur: Figure | null, prev: Figure | null, label: string, basis: string): Figure | null {
  // A negative base (a loss, cash burn) has no percentage that reads the way "÷ … − 1" says (earnings-M3).
  if (!cur || !prev || !(prev.v > 0)) return null;
  if (cur.v < 0) return null;
  const lower = /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
  return {
    v: (cur.v - prev.v) / Math.abs(prev.v),
    ...(cur.q4 === "derived" || prev.q4 === "derived" ? { q4: "derived" as const } : {}),
    derived: { formula: `${label} ÷ ${lower} ${basis} − 1`, parts: [...figPartsOf(cur, `${label}, this quarter`), ...figPartsOf(prev, `${label}, ${basis}`, -1)] },
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
  /** GAAP diluted EPS printed in earnings releases, used for fourth quarters. */
  releaseEps?: ReleaseEps[];
  /** The stock's daily bars, for the closes behind each reaction. */
  bars?: Bar[];
}

const close = (a: number, b: number) => Math.abs(a - b) <= 0.006 + 0.002 * Math.abs(b);

/**
 * Fourth-quarter diluted EPS computed from net income and weighted diluted shares. A 10-K states the year,
 * not the quarter, so "year minus nine months" of EPS is off by a cent whenever the share count moved
 * (Apple Q4 FY25 1.84 against 1.85 reported). Q4 weighted shares are 4 × the full-year average less the
 * three quarterly averages (equal-length quarters). The result is used only when net income ÷ shares
 * reproduces the reported diluted EPS, to the cent, for the full year and for every one of Q1 to Q3: that
 * fails where EPS is earned on income after preferred dividends or participating securities (JPMorgan),
 * and then the quarter has no EPS rather than a wrong one. Rounded to the cent, as EPS is reported.
 */
export function deriveQ4Eps(d: CompanyDataset, i: number): Figure | null {
  const q = d.statements.quarterly.income;
  const a = d.statements.annual?.income;
  const p = q?.periods[i];
  if (!q || !a || !p) return null;
  const j = a.periods.findIndex((ap) => Math.abs(days(ap.end, p.end)) <= 5);
  if (j < 0 || i < 3) return null;
  const qni = row(q, "netIncome");
  const qsh = row(q, "sharesDiluted");
  const qeps = row(q, "epsDiluted");
  const fni = row(a, "netIncome")?.cells[j];
  const fsh = row(a, "sharesDiluted")?.cells[j];
  const feps = row(a, "epsDiluted")?.cells[j];
  const ni4 = qni?.cells[i];
  if (!ni4 || !fni || !fsh?.src || !feps || !(fsh.v > 0) || !close(fni.v / fsh.v, feps.v)) return null;
  const prior: { sh: Cell; label: string }[] = [];
  for (let k = i - 3; k < i; k++) {
    const pk = q.periods[k];
    const ni = qni?.cells[k];
    const sh = qsh?.cells[k];
    const eps = qeps?.cells[k];
    // Q1 to Q3 of the same fiscal year, each a reported quarter that reproduces its own EPS.
    if (!pk || pk.fy !== p.fy || days(pk.end, p.end) > 290 || !ni || !sh?.src || !eps || eps.approx || !(sh.v > 0)) return null;
    if (!close(ni.v / sh.v, eps.v)) return null;
    prior.push({ sh, label: pk.label });
  }
  const shares = 4 * fsh.v - prior.reduce((s, x) => s + x.sh.v, 0);
  if (!(shares > 0)) return null;
  const v = Math.round((ni4.v / shares) * 100) / 100;
  const fyLabel = a.periods[j].label;
  return {
    v,
    q4: "derived",
    derived: {
      formula: `Q4 net income ÷ Q4 weighted diluted shares, where Q4 shares = 4 × the ${fyLabel} average − the Q1 to Q3 averages; rounded to the cent`,
      parts: [
        ...partsOf(ni4, "Net income, Q4"),
        ...partsOf(fsh, `Weighted diluted shares, ${fyLabel} (× 4)`),
        ...prior.flatMap((x) => partsOf(x.sh, `Weighted diluted shares, ${x.label}`, -1)),
      ],
    },
  };
}

/** Fourth-quarter EPS: the release's printed figure when known, else derived (see `deriveQ4Eps`), else none. */
function q4Eps(d: CompanyDataset, i: number, release: EarningsRelease | null, releaseEps: ReleaseEps[] | undefined): Figure | null {
  const printed = release ? releaseEps?.find((r) => r.accn === release.accn && Number.isFinite(r.v)) : undefined;
  if (release && printed) return { v: printed.v, q4: "release", doc: { accn: release.accn, doc: release.doc, quote: printed.quote ?? undefined } };
  return deriveQ4Eps(d, i);
}

/** Every quarter in the dataset (oldest first) with its results, margins, growth, release, reaction and surprise. */
export function quarterRecords({ dataset: d, reactions = [], surprises, releaseEps, bars }: QuarterInputs): QuarterRecord[] {
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

  const releases = periods.map((p) => releaseFor(p.end, d.earningsReleases, d.filings));
  const base = periods.map((p, i) => {
    const epsCell = eps?.cells[i];
    const epsFig = epsCell?.approx ? q4Eps(d, i, releases[i], releaseEps) : fig(epsCell);
    const revenue = fig(rev?.cells[i]);
    const profit = fig(prof?.cells[i]);
    const netIncome = fig(ni?.cells[i]);
    const gross = fig(gp?.cells[i]);
    return {
      period: p,
      revenue,
      profit,
      netIncome,
      // A fourth-quarter cell is the year minus nine months (approx): never shown as the reported figure.
      eps: epsFig,
      q4EpsWithheld: !!epsCell?.approx && !epsFig,
      // Operating cash flow less capex says nothing useful about a bank or insurer (earnings-M2).
      fcf: pl.key === "operatingIncome" ? fcfAt(cf, cfIndex.get(p.key) ?? -1) : null,
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
    const release = releases[i];
    return {
      ...b,
      yoy,
      qoq,
      release,
      reaction: release ? (byDate.get(release.filed.slice(0, 10)) ?? null) : null,
      window: release && byDate.has(release.filed.slice(0, 10)) ? reactionWindow(bars, release.filed) : null,
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
