/**
 * Records per period, pure: facet counts of the period dimension become the columns of one chart. Nothing here
 * parses a cell; a period is placed on a time axis only when every counted value parses in the snapshot's detected
 * format (`periods.ts`), otherwise the values stay categories in the store's order. Calendar years and months that
 * hold no record inside the counted range are drawn as zero: that is a count of the calendar, not a guessed cadence.
 */
import { comparePeriods, formatPeriod, parsePeriod, type ParsedPeriod, type PeriodFormat } from "@/lib/sources/periods";
import type { SourceFacetValue } from "@/lib/sources/read-types";

/** One column per period up to this many; more are grouped by calendar year (or month inside a year). */
export const MAX_PERIOD_COLUMNS = 60;
/** The default window of a dated table: the ten calendar years ending with the year of its last period. */
export const RECENT_YEARS = 10;

export type PeriodWindow = { kind: "recent" } | { kind: "all" } | { kind: "year"; year: string } | { kind: "month"; month: string };

export type PeriodAction = { kind: "filter"; period: string } | { kind: "zoom"; window: PeriodWindow };

export type PeriodColumn = {
  key: string;
  /** As a reader says it: "Q2 2026", "2023", "Apr 2023", or the stored text. */
  label: string;
  rows: number;
  /** False when a count is a floor (the scan limit) or a sum with a floor in it. */
  exact: boolean;
  /** The stored period strings this column counts, oldest first. */
  periods: string[];
  action: PeriodAction | null;
  /** Hover and focus text. */
  title: string;
};

export type PeriodChart = {
  columns: PeriodColumn[];
  grain: "period" | "month" | "year";
  window: PeriodWindow;
  /** True when every counted value parses in the format: the axis is a time axis. */
  dated: boolean;
  /** True when "All" shows more than the default window (the switch is worth offering). */
  windowed: boolean;
  /** Periods counted in the whole table, not only in the window. */
  periods: number;
  /** The largest column, for the scale. */
  max: number;
};

const n = (v: number) => v.toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

/** Ascending, in the snapshot's period order; equal strings never occur (facets are distinct). */
export function sortPeriods(values: readonly SourceFacetValue[], format: PeriodFormat): SourceFacetValue[] {
  return [...values].sort((a, b) => comparePeriods(a.value, b.value, format));
}

/** Every value parses in the format (and the format is not text). */
export function isDated(values: readonly SourceFacetValue[], format: PeriodFormat): boolean {
  return format !== "text" && values.length > 0 && values.every((v) => parsePeriod(v.value, format) !== null);
}

type Dated = { value: SourceFacetValue; parsed: ParsedPeriod };

function countText(rows: number, exact: boolean) {
  return exact ? plural(rows, "record", "records") : `at least ${plural(rows, "record", "records")}`;
}

function periodColumn(d: { value: SourceFacetValue; label: string }): PeriodColumn {
  const v = d.value;
  const stored = d.label !== v.value ? ` (${v.value} in the source)` : "";
  return {
    key: v.value,
    label: d.label,
    rows: v.rows,
    exact: v.exact,
    periods: [v.value],
    action: { kind: "filter", period: v.value },
    title: `${d.label}${stored}: ${countText(v.rows, v.exact)}. Opens its records.`,
  };
}

function groupColumn(key: string, label: string, members: Dated[], zoom: PeriodWindow | null): PeriodColumn {
  const rows = members.reduce((s, m) => s + m.value.rows, 0);
  const exact = members.every((m) => m.value.exact);
  const count = members.length;
  const what = count === 0 ? "no records" : `${countText(rows, exact)} in ${plural(count, "period", "periods")}`;
  return {
    key,
    label,
    rows,
    exact,
    periods: members.map((m) => m.value.value),
    action: count > 0 && zoom ? { kind: "zoom", window: zoom } : null,
    title: `${label}: ${what}.${count > 0 && zoom ? " Opens its periods." : ""}`,
  };
}

function byYear(kept: Dated[]): PeriodColumn[] {
  if (!kept.length) return [];
  const first = Number(kept[0].parsed.start.slice(0, 4));
  const last = Number(kept[kept.length - 1].parsed.start.slice(0, 4));
  const groups = new Map<number, Dated[]>();
  for (const d of kept) {
    const y = Number(d.parsed.start.slice(0, 4));
    groups.set(y, [...(groups.get(y) ?? []), d]);
  }
  const out: PeriodColumn[] = [];
  for (let y = first; y <= last; y++) {
    const year = String(y).padStart(4, "0");
    out.push(groupColumn(`y:${year}`, year, groups.get(y) ?? [], { kind: "year", year }));
  }
  return out;
}

function byMonth(kept: Dated[]): PeriodColumn[] {
  if (!kept.length) return [];
  const groups = new Map<string, Dated[]>();
  for (const d of kept) {
    const m = d.parsed.start.slice(0, 7);
    groups.set(m, [...(groups.get(m) ?? []), d]);
  }
  const year = kept[0].parsed.start.slice(0, 4);
  const first = Number(kept[0].parsed.start.slice(5, 7));
  const last = Number(kept[kept.length - 1].parsed.start.slice(5, 7));
  const out: PeriodColumn[] = [];
  for (let m = first; m <= last; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    out.push(groupColumn(`m:${month}`, `${MONTHS[m - 1]} ${year}`, groups.get(month) ?? [], { kind: "month", month }));
  }
  return out;
}

/**
 * The columns of one window. A dated table: the window's periods one by one when there are at most 60, otherwise by
 * calendar year (or, inside one year, by month). A text table: its values in the store's order, the last 60 in the
 * default window.
 */
export function periodChart(values: readonly SourceFacetValue[], format: PeriodFormat, window: PeriodWindow = { kind: "recent" }): PeriodChart {
  const sorted = sortPeriods(values, format);
  const dated = isDated(sorted, format);
  const max = (cols: PeriodColumn[]) => Math.max(0, ...cols.map((c) => c.rows));
  if (!dated) {
    const all = sorted.map((v) => periodColumn({ value: v, label: formatPeriod(v.value, format).text }));
    const windowed = all.length > MAX_PERIOD_COLUMNS;
    const shown = window.kind === "all" || !windowed ? all : all.slice(-MAX_PERIOD_COLUMNS);
    return { columns: shown, grain: "period", window: windowed && window.kind === "all" ? window : { kind: "recent" }, dated, windowed, periods: sorted.length, max: max(shown) };
  }
  const items: Dated[] = sorted.map((value) => ({ value, parsed: parsePeriod(value.value, format)! }));
  // the last ten calendar years, the year of the last period included, so a year column is never cut in two
  const fromYear = Number(items[items.length - 1].parsed.start.slice(0, 4)) - (RECENT_YEARS - 1);
  const recent = items.filter((d) => Number(d.parsed.start.slice(0, 4)) >= fromYear);
  const windowed = recent.length < items.length;
  let shown: PeriodWindow = window;
  let kept: Dated[];
  if (window.kind === "year") kept = items.filter((d) => d.parsed.start.slice(0, 4) === window.year);
  else if (window.kind === "month") kept = items.filter((d) => d.parsed.start.slice(0, 7) === window.month);
  else if (window.kind === "all") kept = items;
  else kept = recent;
  // a zoom that holds nothing (a stale address) falls back to the default window
  if (!kept.length) {
    kept = recent;
    shown = { kind: "recent" };
  }
  if (shown.kind === "all" && !windowed) shown = { kind: "recent" };
  let columns: PeriodColumn[];
  let grain: PeriodChart["grain"];
  if (kept.length <= MAX_PERIOD_COLUMNS || shown.kind === "month") {
    columns = kept.map((d) => periodColumn({ value: d.value, label: d.parsed.label }));
    grain = "period";
  } else if (shown.kind === "year") {
    columns = byMonth(kept);
    grain = "month";
  } else {
    columns = byYear(kept);
    grain = "year";
  }
  return { columns, grain, window: shown, dated, windowed, periods: items.length, max: max(columns) };
}

/** The window one step out from a zoom: a month goes back to its year, a year to the default window. */
export function outerWindow(window: PeriodWindow): PeriodWindow {
  if (window.kind === "month") return { kind: "year", year: window.month.slice(0, 4) };
  return { kind: "recent" };
}

/** What a window is called in the chart's controls and caption. */
export function windowLabel(window: PeriodWindow): string {
  if (window.kind === "year") return window.year;
  if (window.kind === "month") return `${MONTHS[Number(window.month.slice(5, 7)) - 1]} ${window.month.slice(0, 4)}`;
  return window.kind === "all" ? "All periods" : `${RECENT_YEARS} years`;
}

export type Tick = { index: number; label: string };

/**
 * Axis labels under the columns, at most `room` of them. Year columns get clean steps (every 1, 2, 5, 10, 20, 25
 * or 50 years, on years divisible by the step); dated periods get the first period of each labelled year (or every
 * period when each is a year or fewer than 13 are drawn); text columns get the first and the last. The last column
 * is always labelled: the latest period is named on the chart.
 */
export function periodTicks(chart: PeriodChart, room: number): Tick[] {
  const cols = chart.columns;
  if (!cols.length) return [];
  const limit = Math.max(2, Math.floor(room));
  const lastIndex = cols.length - 1;
  let ticks: Tick[] = [];
  const yearOf = (c: PeriodColumn) => (chart.grain === "year" ? c.label : c.label.slice(-4));
  if (!chart.dated) {
    ticks = cols.length === 1 ? [{ index: 0, label: cols[0].label }] : [{ index: 0, label: cols[0].label }, { index: lastIndex, label: cols[lastIndex].label }];
    return ticks.map((t) => ({ ...t, label: clip(t.label) }));
  }
  if (cols.length <= Math.min(limit, 12)) return cols.map((c, index) => ({ index, label: chart.grain === "month" ? c.label.slice(0, 3) : c.label }));
  if (chart.grain === "month") ticks = cols.map((c, index) => ({ index, label: c.label.slice(0, 3) }));
  else {
    const starts: Tick[] = [];
    let seen = "";
    cols.forEach((c, index) => {
      const y = yearOf(c);
      if (y !== seen) {
        starts.push({ index, label: y });
        seen = y;
      }
    });
    ticks = starts;
  }
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find((s) => Math.ceil(ticks.length / s) + 1 <= limit) ?? steps[steps.length - 1];
  const numeric = ticks.every((t) => /^\d{4}$/.test(t.label));
  let picked = numeric ? ticks.filter((t) => Number(t.label) % step === 0) : ticks.filter((_, i) => i % step === 0);
  if (!picked.length) picked = [ticks[0]];
  // the latest period is always named; a pick that would crowd it gives way
  const gap = cols.length / limit;
  picked = picked.filter((t) => lastIndex - t.index >= gap || t.index === lastIndex);
  const lastLabel = chart.grain === "year" ? cols[lastIndex].label : chart.grain === "month" ? cols[lastIndex].label.slice(0, 3) : cols[lastIndex].label;
  if (!picked.some((t) => t.index === lastIndex)) picked.push({ index: lastIndex, label: lastLabel });
  else picked = picked.map((t) => (t.index === lastIndex ? { index: lastIndex, label: lastLabel } : t));
  return picked;
}

const clip = (label: string) => (label.length > 14 ? `${label.slice(0, 13)}…` : label);

/**
 * The one line above the chart, assembled from the counts: "2,574,644 records from Jan 1960 to Dec 2024; most in
 * 2023". `total` is the snapshot's own row count; records whose period is null are not in the facets, and the line
 * says how many when every period was counted.
 */
export function periodCaption(values: readonly SourceFacetValue[], format: PeriodFormat, total: number, complete: boolean): string {
  if (!values.length) return "No record carries a period.";
  const sorted = sortPeriods(values, format);
  const dated = isDated(sorted, format);
  const label = (v: string) => formatPeriod(v, format).text;
  const counted = sorted.reduce((s, v) => s + v.rows, 0);
  const exact = complete && sorted.every((v) => v.exact);
  const first = label(sorted[0].value);
  const last = label(sorted[sorted.length - 1].value);
  const parts: string[] = [];
  const head = exact ? plural(counted, "record", "records") : `At least ${plural(counted, "record", "records")}`;
  if (sorted.length === 1) parts.push(`${head}, all in ${first}`);
  else {
    parts.push(`${head} from ${first} to ${last}`);
    const equal = sorted.every((v) => v.rows === sorted[0].rows && v.exact);
    if (equal) parts.push(sorted[0].rows === 1 ? "one in each period" : `${n(sorted[0].rows)} in each period`);
    else {
      // "most in" at the grain a reader sees over the whole table: years when the periods are many and dated
      const whole = dated && sorted.length > MAX_PERIOD_COLUMNS ? periodChart(sorted, format, { kind: "all" }).columns : sorted.map((v) => ({ label: label(v.value), rows: v.rows }));
      let best = whole[0];
      for (const c of whole) if (c.rows > best.rows) best = c;
      parts.push(`most in ${best.label}`);
    }
  }
  let line = parts.join("; ");
  if (!complete) line += `; counted in period order up to ${last}, later periods not counted`;
  else if (exact && counted < total) line += `; ${plural(total - counted, "record has", "records have")} no period`;
  return `${line}.`;
}
