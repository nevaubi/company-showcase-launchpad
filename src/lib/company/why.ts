// "Why did it move": the year-over-year change in a headline figure, split into the lines that add up to
// it. Everything is arithmetic on filed numbers: revenue by reported segment, operating income by the income
// statement lines above it, free cash flow by operating cash flow and capital spending. No model writes any
// of it, so a sentence can only say what the filings say. Pure.
import { memberCoverage, segmentMatrix } from "@/lib/financials/segments";
import type { CompanyDataset, Row, Statement } from "@/lib/financials/types";

export interface WhyDriver {
  id: string;
  label: string;
  /** Signed contribution to the change, in the metric's units. */
  delta: number;
  /** Index into `series` where this driver's change was largest: where the chart marks it. */
  point: number;
}

export interface WhySegment {
  text: string;
  driver?: string;
}

export interface WhyInsight {
  segments: WhySegment[];
  drivers: WhyDriver[];
}

export interface WhyMetric {
  label: string;
  /** The quarter being explained, e.g. "Q2 FY27". */
  period: string;
  value: number;
  previous: number;
  comparisonLabel: string;
  /** The last eight quarters, oldest first, and the same quarters a year earlier. */
  series: number[];
  previousSeries: number[];
  points: string[];
}

export interface Why {
  id: "revenue" | "operatingIncome" | "fcf";
  metric: WhyMetric;
  insight: WhyInsight;
  followUps: { id: string; label: string; insight: WhyInsight }[];
  /** Which statements the figures come from, for the card footer. */
  source: string;
}

const WINDOW = 8;

const usd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : `$${Math.round(a).toLocaleString("en-US")}`;
  return v < 0 ? `-${s}` : s;
};
const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const row = (st: Statement, key: string) => st.rows.find((r) => r.key === key);
const vals = (r: Row | undefined) => (r?.cells ?? []).map((c) => c?.v ?? null);

/** Last index where the value and its year-ago counterpart both exist. */
function lastComparable(v: (number | null)[]): number {
  for (let i = v.length - 1; i >= 4; i--) if (v[i] != null && v[i - 4] != null) return i;
  return -1;
}

/** The eight quarters ending at `end` and the same quarters a year earlier, or null if any is missing. */
function windowOf(v: (number | null)[], end: number): { series: number[]; previousSeries: number[]; from: number } | null {
  const from = end - WINDOW + 1;
  if (from - 4 < 0) return null;
  const series: number[] = [];
  const previousSeries: number[] = [];
  for (let i = from; i <= end; i++) {
    if (v[i] == null || v[i - 4] == null) return null;
    series.push(v[i] as number);
    previousSeries.push(v[i - 4] as number);
  }
  return { series, previousSeries, from };
}

interface Line {
  label: string;
  /** Per-quarter values aligned to the statement's periods. */
  v: (number | null)[];
  /** +1 when a rise in the line raises the metric, -1 when it lowers it (a cost). */
  sign: 1 | -1;
}

/**
 * Turn lines into ranked drivers of the change at `end`. Each driver's chart mark sits on the quarter of the
 * window where its own year-over-year contribution was largest; marks never share a quarter.
 */
function driversOf(lines: Line[], end: number, from: number, total: number, rest: string): WhyDriver[] {
  const contrib = (l: Line, i: number) => (l.v[i] != null && l.v[i - 4] != null ? l.sign * ((l.v[i] as number) - (l.v[i - 4] as number)) : null);
  const scored = lines
    .map((l) => ({ l, delta: contrib(l, end) }))
    .filter((x): x is { l: Line; delta: number } => x.delta != null && x.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  // The card ranks three. With more lines than that, the third slot holds everything else, so the three always
  // add up to the change; with three or fewer, an unexplained remainder gets its own row when there is room.
  const named = scored.length > 3 ? scored.slice(0, 2) : scored;
  const used = new Set<number>();
  const free = () => [WINDOW - 1, WINDOW - 2, WINDOW - 3, WINDOW - 4].find((k) => !used.has(k)) ?? 0;
  const drivers: WhyDriver[] = named.map(({ l, delta }) => {
    const ranked = Array.from({ length: WINDOW }, (_, k) => ({ k, c: contrib(l, from + k) }))
      .filter((x) => x.c != null && Math.sign(x.c as number) === Math.sign(delta))
      .sort((a, b) => Math.abs(b.c as number) - Math.abs(a.c as number));
    const spot = ranked.find((x) => !used.has(x.k))?.k ?? free();
    used.add(spot);
    return { id: slug(l.label), label: l.label, delta, point: spot };
  });
  const left = total - named.reduce((s, x) => s + x.delta, 0);
  if (Math.abs(left) > Math.abs(total) * 0.02) {
    if (drivers.length === 3) {
      // No room for a fourth row: the smallest named line joins the remainder.
      const dropped = drivers.pop()!;
      used.delete(dropped.point);
      drivers.push({ id: "other", label: rest, delta: left + dropped.delta, point: free() });
    } else drivers.push({ id: "other", label: rest, delta: left, point: free() });
  }
  return drivers;
}

function sentences(lead: string, drivers: WhyDriver[], total: number, points: string[], verb: (d: WhyDriver) => string, tail?: string): WhySegment[] {
  const out: WhySegment[] = [{ text: lead }];
  drivers.forEach((d, i) => {
    const share = total !== 0 ? Math.abs(d.delta / total) : 0;
    // The remainder row has no quarter of its own, so nothing is said about when it moved.
    const where = d.id === "other" || d.point === points.length - 1 ? "" : `, with its largest step in ${points[d.point]}`;
    out.push({ text: " " });
    out.push({
      driver: d.id,
      text: `${i === 0 ? "" : i === drivers.length - 1 && drivers.length > 1 ? "And " : ""}${verb(d)}${Math.sign(d.delta) === Math.sign(total) && share <= 1 ? `, ${pct(share)} of the change` : ""}${where}.`,
    });
  });
  if (tail) out.push({ text: ` ${tail}` });
  return out;
}

const AXES: { axis: string; id: string; label: string; rest: string }[] = [
  { axis: "us-gaap:StatementBusinessSegmentsAxis", id: "segment", label: "By business segment", rest: "Other segments" },
  { axis: "srt:ProductOrServiceAxis", id: "product", label: "By product", rest: "Other products" },
  { axis: "srt:StatementGeographicalAxis", id: "geography", label: "By geography", rest: "Other regions" },
];

/** Revenue this quarter against the same quarter a year ago, split by the segments the company reports. */
export function revenueWhy(d: CompanyDataset): Why | null {
  const q = d.statements.quarterly.income;
  const rev = vals(row(q, "revenue"));
  const end = lastComparable(rev);
  const w = end >= 0 ? windowOf(rev, end) : null;
  if (!w) return null;
  const points = q.periods.slice(w.from, end + 1).map((p) => p.label);
  const value = rev[end] as number;
  const previous = rev[end - 4] as number;
  const total = value - previous;
  const lead = `Revenue was ${usd(value)} in ${q.periods[end].label}, ${total >= 0 ? "up" : "down"} ${usd(Math.abs(total))} from a year earlier.`;

  const views = AXES.flatMap((a) => {
    const m = segmentMatrix(d.segments, { axis: a.axis, metric: "revenue" }, q.periods, d.statements.annual.income.periods, "quarterly");
    if (m.members.length < 2) return [];
    // Use a breakdown only where its members add up to revenue in both quarters; nested members would double count.
    const cov = memberCoverage(m.cells, rev);
    const ok = (i: number) => cov[i] != null && (cov[i] as number) > 0.9 && (cov[i] as number) < 1.1;
    if (!ok(end) || !ok(end - 4)) return [];
    const lines: Line[] = m.members.map((mem) => ({ label: mem.label, sign: 1, v: (m.cells.get(mem.member) ?? []).map((c) => c?.v ?? null) }));
    const drivers = driversOf(lines, end, w.from, total, a.rest);
    if (!drivers.length) return [];
    const insight: WhyInsight = {
      drivers,
      segments: sentences(lead, drivers, total, points, (x) => `${x.label} ${x.delta >= 0 ? "added" : "lost"} ${usd(Math.abs(x.delta))}`),
    };
    return [{ id: a.id, label: a.label, insight }];
  });
  if (!views.length) return null;
  return {
    id: "revenue",
    metric: { label: "Revenue", period: q.periods[end].label, value, previous, comparisonLabel: "vs a year earlier", series: w.series, previousSeries: w.previousSeries, points },
    insight: views[0].insight,
    followUps: views,
    source: "10-Q segment notes",
  };
}

/** Operating income against a year ago, walked down the income statement: revenue less each cost line. */
export function operatingIncomeWhy(d: CompanyDataset): Why | null {
  const q = d.statements.quarterly.income;
  const oi = vals(row(q, "operatingIncome"));
  const end = lastComparable(oi);
  const w = end >= 0 ? windowOf(oi, end) : null;
  if (!w) return null;
  const points = q.periods.slice(w.from, end + 1).map((p) => p.label);
  const value = oi[end] as number;
  const previous = oi[end - 4] as number;
  const total = value - previous;
  const lines: Line[] = (
    [
      ["Revenue", "revenue", 1],
      ["Cost of revenue", "costOfRevenue", -1],
      ["Research and development", "rnd", -1],
      ["Selling, general and administrative", "sga", -1],
      ["Sales and marketing", "salesMarketing", -1],
      ["General and administrative", "generalAdmin", -1],
    ] as const
  )
    .map(([label, key, sign]) => ({ label, sign, v: vals(row(q, key)) }))
    .filter((l) => l.v[end] != null && l.v[end - 4] != null);
  if (lines.length < 2) return null;
  const drivers = driversOf(lines, end, w.from, total, "Other operating costs");
  if (!drivers.length) return null;
  const rev = vals(row(q, "revenue"));
  const margin = (i: number) => (rev[i] ? (oi[i] as number) / (rev[i] as number) : null);
  const m1 = margin(end);
  const m0 = margin(end - 4);
  const tail = m1 != null && m0 != null ? `Operating margin went from ${(m0 * 100).toFixed(1)}% to ${(m1 * 100).toFixed(1)}%.` : undefined;
  const lead = `Operating income was ${usd(value)} in ${q.periods[end].label}, ${total >= 0 ? "up" : "down"} ${usd(Math.abs(total))} from a year earlier.`;
  const verb = (x: WhyDriver) => {
    const cost = x.label !== "Revenue" && x.id !== "other";
    if (!cost) return `${x.label} ${x.delta >= 0 ? "added" : "took away"} ${usd(Math.abs(x.delta))}`;
    // A cost that rose shows as a negative contribution.
    return `${x.label} ${x.delta < 0 ? "rose" : "fell"} by ${usd(Math.abs(x.delta))}, which ${x.delta < 0 ? "took that much off" : "added that much"}`;
  };
  const insight: WhyInsight = { drivers, segments: sentences(lead, drivers, total, points, verb, tail) };
  return {
    id: "operatingIncome",
    metric: { label: "Operating income", period: q.periods[end].label, value, previous, comparisonLabel: "vs a year earlier", series: w.series, previousSeries: w.previousSeries, points },
    insight,
    followUps: [{ id: "bridge", label: "Line by line", insight }],
    source: "10-Q income statement",
  };
}

/** Free cash flow against a year ago: cash from operations less capital spending. */
export function fcfWhy(d: CompanyDataset): Why | null {
  const q = d.statements.quarterly.cashflow;
  const fcf = vals(row(q, "fcf"));
  const end = lastComparable(fcf);
  const w = end >= 0 ? windowOf(fcf, end) : null;
  if (!w) return null;
  const points = q.periods.slice(w.from, end + 1).map((p) => p.label);
  const value = fcf[end] as number;
  const previous = fcf[end - 4] as number;
  const total = value - previous;
  // Capital spending is stored as a positive outflow, so more of it lowers free cash flow.
  const lines: Line[] = [
    { label: "Cash from operations", sign: 1 as const, v: vals(row(q, "cfo")) },
    { label: "Capital spending", sign: -1 as const, v: vals(row(q, "capex")).map((x) => (x == null ? null : Math.abs(x))) },
  ].filter((l) => l.v[end] != null && l.v[end - 4] != null);
  if (lines.length < 2) return null;
  const drivers = driversOf(lines, end, w.from, total, "Other items");
  if (!drivers.length) return null;
  const lead = `Free cash flow was ${usd(value)} in ${q.periods[end].label}, ${total >= 0 ? "up" : "down"} ${usd(Math.abs(total))} from a year earlier.`;
  const verb = (x: WhyDriver) =>
    x.label === "Capital spending"
      ? `Capital spending ${x.delta < 0 ? "rose" : "fell"} by ${usd(Math.abs(x.delta))}, which ${x.delta < 0 ? "took that much off" : "added that much"}`
      : `${x.label} ${x.delta >= 0 ? "added" : "took away"} ${usd(Math.abs(x.delta))}`;
  const ni = vals(row(d.statements.quarterly.income, "netIncome"));
  const conv = ni[end] ? value / (ni[end] as number) : null;
  const tail = conv != null && conv > 0 ? `That is ${Math.round(conv * 100)}% of the quarter's net income.` : undefined;
  const insight: WhyInsight = { drivers, segments: sentences(lead, drivers, total, points, verb, tail) };
  return {
    id: "fcf",
    metric: { label: "Free cash flow", period: q.periods[end].label, value, previous, comparisonLabel: "vs a year earlier", series: w.series, previousSeries: w.previousSeries, points },
    insight,
    followUps: [{ id: "bridge", label: "Operations and capital spending", insight }],
    source: "10-Q cash flow statement",
  };
}

/** The three headline explanations for a company, leaving out any the filings cannot support. */
export function whyCards(d: CompanyDataset): Why[] {
  return [revenueWhy(d), operatingIncomeWhy(d), fcfWhy(d)].filter((w): w is Why => !!w);
}
