// The charts of the company's official sections, as pure models: what each chart draws, its headline figure, its
// period and the stored record behind every mark. Nothing here reads the store or parses outside numbers.ts and
// decimal.ts; a figure is printed in reader scale only for a unit on the whitelist of boards/scale.ts, with the
// stored figure as filed beside it; a change is an exact decimal difference with its formula stated.
import { formatDecimal, parseDecimal, roundDecimal, subtractDecimal } from "../boards/decimal";
import { readerFigure, type ReaderFigure } from "../boards/scale";
import { BASIS_TEXT, FDIC_LINES, RATIO_FIELDS, TREND_FIELDS, type LineBasis } from "./fdic-fields";
import { printedDay, type ObApplication } from "./orange-book";
import { historySeries, niceDomain, quarterLabel, showCell, type SeriesPoint } from "./present";
import type { BankHistory, DepositsByState, FigureRef, OfficialCell, RecordPointer, Y9cReport } from "./types";
import { Y9C_FIELDS, Y9C_RATIO_CHART } from "./y9c-fields";

const MINUS = "−";

// ------------------------------------------------------------------ figures and axes

/** A stored cell in reader scale ("$1.908 trillion", with "1,907,928,000 USD thousands (monetary measures) as filed"), or null. */
export function readerOf(unit: string | null, cell: OfficialCell | null | undefined): ReaderFigure | null {
  if (!unit || !cell || cell.kind !== "number" || !cell.text) return null;
  const exact = parseDecimal(cell.text.trim());
  return exact ? readerFigure(unit, exact, showCell(cell, unit).text) : null;
}

export interface Axis {
  /** What the value axis is in: the reader-scale unit ("USD trillions") or the unit as filed. */
  title: string;
  /** A stored value divided by this is read on the axis (1 when the unit stays as filed). */
  divisor: number;
  min: number;
  max: number;
  /** Tick positions in the stored unit, and their text. */
  ticks: { value: number; text: string }[];
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Tick text with as many decimals as the step needs, a true minus, digits grouped. */
function tickNumber(v: number, step: number, compact: boolean): string {
  if (v === 0) return "0";
  const sign = v < 0 ? MINUS : "";
  const a = Math.abs(v);
  if (compact && a >= 10_000) return sign + COMPACT.format(a);
  const places = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  return sign + a.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
}

/**
 * The value axis of a chart. With a reader figure (the unit is on the whitelist) the axis is in its scale and titled
 * with it; otherwise the stored figures are on the axis in the unit as filed, large ones written compactly
 * ("4.5B" on an axis titled "USD thousands", which is the stored number, not a change of unit).
 */
export function valueAxis(values: number[], unit: string, opts: { reader?: ReaderFigure | null; includeZero?: boolean; asFiled?: string } = {}): Axis {
  const divisor = opts.reader ? opts.reader.axis.divisor : 1;
  const d = niceDomain(values.map(v => v / divisor), opts.includeZero ?? unit.startsWith("USD"));
  const step = d.ticks.length > 1 ? Math.abs(d.ticks[1] - d.ticks[0]) : 1;
  return {
    title: opts.reader ? opts.reader.axis.title : (opts.asFiled ?? unit),
    divisor,
    min: d.min * divisor,
    max: d.max * divisor,
    ticks: d.ticks.map(t => ({ value: t * divisor, text: tickNumber(t, step, !opts.reader) })),
  };
}

// ------------------------------------------------------------------ FDIC: trends of a charter

export interface TrendChart {
  field: string;
  label: string;
  basis: LineBasis;
  unit: string;
  points: SeriesPoint[];
  /** The latest drawable quarter and its figure in reader scale. */
  latest: SeriesPoint | null;
  reader: ReaderFigure | null;
  /** Stored cells that are not drawn. */
  gaps: number;
}

/** The three trend measures of one charter (assets, deposits, quarterly net income), those its dictionary states. */
export function trendCharts(h: BankHistory): TrendChart[] {
  return TREND_FIELDS.filter(f => h.measures.some(m => m.field === f)).map(field => {
    const s = historySeries(h, field);
    const def = FDIC_LINES.find(l => l.field === field)!;
    const drawn = s.points.filter(p => p.value != null);
    const latest = drawn[drawn.length - 1] ?? null;
    return { field, label: def.label, basis: def.basis, unit: s.unit, points: s.points, latest, reader: latest ? readerOf(s.unit, latest.cell) : null, gaps: s.points.length - drawn.length };
  });
}

/** The heading of a trend chart: the line's name and its basis ("Net income, quarter"). */
export function trendTitle(c: { label: string; basis: LineBasis }): string {
  return BASIS_TEXT[c.basis] ? `${c.label}, ${BASIS_TEXT[c.basis]}` : c.label;
}

// ------------------------------------------------------------------ FDIC: ratio stat tiles

export interface RatioStat {
  field: string;
  label: string;
  basis: LineBasis;
  unit: string;
  latest: SeriesPoint | null;
  /** The same quarter a year earlier, when stored and drawable. */
  yearEarlier: SeriesPoint | null;
  /** Latest less a year earlier, in percentage points, rounded once to two decimals ("+0.12"). */
  change: { text: string; formula: string } | null;
  /** The last 24 quarters to the latest, gaps kept as null. */
  spark: (number | null)[];
  /** Quarters stored as zero before the ratio was reported (not drawn). */
  notReported: number;
}

/** "2026-09-30" a year earlier: "2025-09-30" (quarter ends are the same day of the month every year). */
export const yearBefore = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

export const SPARK_QUARTERS = 24;

/** One FDIC ratio of a charter: its latest quarter, the change on the same quarter a year earlier, a sparkline. */
export function ratioStat(h: BankHistory, field: string): RatioStat | null {
  const m = h.measures.find(x => x.field === field);
  const def = FDIC_LINES.find(l => l.field === field);
  if (!m || !def || m.unit !== "Percent") return null;
  const s = historySeries(h, field);
  const drawn = s.points.filter(p => p.value != null);
  const latest = drawn[drawn.length - 1] ?? null;
  const yearEarlier = latest ? (s.points.find(p => p.period === yearBefore(latest.period) && p.value != null) ?? null) : null;
  let change: RatioStat["change"] = null;
  if (latest && yearEarlier) {
    const a = parseDecimal((latest.cell.text ?? "").trim());
    const b = parseDecimal((yearEarlier.cell.text ?? "").trim());
    if (a && b) change = { text: formatDecimal(roundDecimal(subtractDecimal(a, b), 2), { decimals: 2, plus: true }), formula: `${quarterLabel(latest.period)} less ${quarterLabel(yearEarlier.period)}, in percentage points of the stored ratios` };
  }
  const end = latest ? s.points.indexOf(latest) + 1 : s.points.length;
  const spark = s.points.slice(Math.max(0, end - SPARK_QUARTERS), end).map(p => p.value);
  return { field, label: def.label, basis: def.basis, unit: m.unit, latest, yearEarlier, change, spark, notReported: s.notReported };
}

/** Every ratio stat tile of a charter that its history can fill, in the order of RATIO_FIELDS. */
export function ratioStats(h: BankHistory): RatioStat[] {
  return RATIO_FIELDS.map(f => ratioStat(h, f)).filter((x): x is RatioStat => !!x && !!x.latest);
}

// ------------------------------------------------------------------ FR Y-9C

export interface Y9cPoint {
  period: string;
  value: number | null;
  cell: OfficialCell;
  ref: FigureRef;
}
export interface Y9cSeries {
  field: string;
  label: string;
  basis: "ytd" | "balance";
  unit: string;
  points: Y9cPoint[];
  latest: Y9cPoint | null;
  reader: ReaderFigure | null;
}

const y9cPoint = (period: string, cell: OfficialCell, ref: FigureRef): Y9cPoint => ({ period, value: cell.kind === "number" ? cell.value : null, cell, ref });
const withLatest = (s: Omit<Y9cSeries, "latest" | "reader">): Y9cSeries => {
  const latest = [...s.points].reverse().find(p => p.value != null) ?? null;
  return { ...s, latest, reader: latest ? readerOf(s.unit, latest.cell) : null };
};

/**
 * The holding company's charts: total assets (BHCK2170, unit from the dictionary), total equity capital and net
 * income (year to date) as amounts, and the capital ratios with the unit "Percent" on one axis. A line with no
 * established unit, or no number, is not drawn.
 */
export function y9cCharts(r: Y9cReport): { amounts: Y9cSeries[]; ratios: Y9cSeries[] } {
  const amounts: Y9cSeries[] = [];
  const unit = r.quarters[0]?.totalAssets.unit ?? null;
  if (unit && r.quarters.every(q => q.totalAssets.unit === unit))
    amounts.push(withLatest({ field: "BHCK2170", label: "Total assets", basis: "balance", unit, points: r.quarters.map(q => y9cPoint(q.reportDate, q.totalAssets, q.totalAssets.ref)) }));
  for (const def of Y9C_FIELDS.filter(f => f.group === "statement")) {
    const line = r.lines.find(l => l.field === def.field);
    if (line?.unit) amounts.push(withLatest({ field: def.field, label: def.short, basis: def.basis, unit: line.unit, points: line.cells.map((c, i) => y9cPoint(r.quarters[i].reportDate, c, c.ref)) }));
  }
  const ratios = Y9C_RATIO_CHART.map(field => r.lines.find(l => l.field === field))
    .filter(l => !!l && l.unit === "Percent")
    .map(l => withLatest({ field: l!.field, label: l!.short, basis: "balance", unit: "Percent", points: l!.cells.map((c, i) => y9cPoint(r.quarters[i].reportDate, c, c.ref)) }));
  return { amounts: amounts.filter(a => a.latest), ratios: ratios.filter(a => a.latest) };
}

// ------------------------------------------------------------------ deposits by state

export interface DepositsMark {
  code: string;
  /** The deposits drawn (null: the stored cell is not a number). */
  value: number | null;
  deposits: OfficialCell;
  branches: OfficialCell;
  ref: FigureRef;
}
export interface DepositsView {
  /** Branch states, largest deposits first; states whose cell is not a number last, in code order. */
  states: DepositsMark[];
  /** The greatest drawable deposits, for the colour scale. */
  max: number;
  unit: string;
  totals: DepositsByState["totals"];
  totalsRef: RecordPointer | null;
  /** The survey's total in reader scale, when its unit is on the whitelist. */
  reader: ReaderFigure | null;
}

/** The deposits-by-state chart of one charter: its branch states as stored, ranked, and its stored totals. */
export function depositsView(d: DepositsByState): DepositsView {
  const marks: DepositsMark[] = d.states.map(s => ({
    code: s.code,
    value: s.deposits.kind === "number" ? s.deposits.value : null,
    deposits: s.deposits,
    branches: s.branches,
    ref: { dataset: d.source.dataset, snapshot: d.source.snapshot, row: s.row, field: d.fields.deposits },
  }));
  marks.sort((a, b) => (a.value == null ? 1 : 0) - (b.value == null ? 1 : 0) || (b.value ?? 0) - (a.value ?? 0) || a.code.localeCompare(b.code));
  const max = Math.max(0, ...marks.map(m => m.value ?? 0));
  const totalsRef = d.totals && d.totalsSource ? { dataset: d.totalsSource.dataset, snapshot: d.totalsSource.snapshot, row: d.totals.row } : null;
  return { states: marks, max, unit: d.unit, totals: d.totals, totalsRef, reader: d.totals ? readerOf(d.unit, d.totals.deposits) : null };
}

/** A count cell as a reader says it ("1,734"), or null when it is not a whole number. */
export function countText(cell: OfficialCell | null | undefined): string | null {
  if (!cell || cell.kind !== "number" || cell.value == null || !Number.isInteger(cell.value) || cell.value < 0) return null;
  return cell.value.toLocaleString("en-US");
}

// ------------------------------------------------------------------ Orange Book timeline

export type ObEventKind = "patent" | "exclusivity";
/** One listed date of an application: every patent (or exclusivity code) listed to end that day. */
export interface ObEvent {
  appl: string;
  kind: ObEventKind;
  /** ISO day, for placing only; the page prints `printed`. */
  day: string;
  printed: string;
  /** Patent numbers or exclusivity codes listed to end that day, as printed. */
  items: string[];
  /** Some of the patents carry a delisting request. */
  delisted: boolean;
  refs: RecordPointer[];
}
export interface ObRow {
  appl: string;
  trade: string;
  ingredient: string;
  events: ObEvent[];
  /** The first listed date on or after today, or null. */
  next: ObEvent | null;
}
export interface ObTimeline {
  rows: ObRow[];
  /** Listed dates on or after today, the earliest first. */
  upcoming: ObEvent[];
  /** The span drawn: the earliest listed date (or today) to the latest. */
  from: string;
  to: string;
  today: string;
  /** Listed entries whose printed date could not be read as a day (not drawn). */
  undated: number;
}

/**
 * The applications' listed patent and exclusivity dates on one time axis. Entries that end the same day and are of
 * the same kind are one mark. Rows are ordered by their next listed date, the soonest first; an application with
 * none left comes last. Dates are the FDA's printed dates; nothing is forecast.
 */
export function obTimeline(apps: readonly ObApplication[], today: string): ObTimeline {
  let undated = 0;
  const rows: ObRow[] = [];
  for (const a of apps) {
    const by = new Map<string, ObEvent>();
    const add = (kind: ObEventKind, printed: string, item: string, refs: RecordPointer[], delisted: boolean) => {
      const day = printedDay(printed);
      if (!day) {
        undated += 1;
        return;
      }
      const key = `${kind}|${day}`;
      const e = by.get(key) ?? { appl: a.appl, kind, day, printed, items: [], delisted: false, refs: [] };
      if (!e.items.includes(item)) e.items.push(item);
      e.delisted = e.delisted || delisted;
      e.refs.push(...refs);
      by.set(key, e);
    };
    for (const p of a.patents) add("patent", p.expiry, p.patent, p.refs, p.delisted);
    for (const x of a.exclusivity) add("exclusivity", x.date, x.code, x.refs, false);
    const events = [...by.values()].sort((x, y) => x.day.localeCompare(y.day) || x.kind.localeCompare(y.kind));
    for (const e of events) e.items.sort();
    if (!events.length) continue;
    rows.push({ appl: a.appl, trade: a.trade.join(", "), ingredient: a.ingredient.join(", "), events, next: events.find(e => e.day >= today) ?? null });
  }
  rows.sort((x, y) => {
    if (x.next && y.next) return x.next.day.localeCompare(y.next.day) || x.trade.localeCompare(y.trade);
    if (x.next || y.next) return x.next ? -1 : 1;
    return y.events[y.events.length - 1].day.localeCompare(x.events[x.events.length - 1].day) || x.trade.localeCompare(y.trade);
  });
  const all = rows.flatMap(r => r.events);
  const upcoming = all.filter(e => e.day >= today).sort((x, y) => x.day.localeCompare(y.day) || x.appl.localeCompare(y.appl) || x.kind.localeCompare(y.kind));
  const days = all.map(e => e.day).sort();
  const from = days.length && days[0] < today ? days[0] : today;
  const to = days.length && days[days.length - 1] > today ? days[days.length - 1] : today;
  return { rows, upcoming, from, to, today, undated };
}

/** Today's date as the timeline marks it, ISO, in UTC. */
export const isoToday = (now: Date = new Date()) => now.toISOString().slice(0, 10);
