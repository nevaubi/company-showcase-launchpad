// The arithmetic of the IR charts, pure and tested apart from rendering (model.test.ts). Nothing here rescales a
// figure or invents a ratio: changes are percent changes of one line (points for percentages), shares are a part over
// its own printed total in the same unit, and a bridge is the parts' printed changes between two periods in which
// they add up to the printed total.
import type {
  VizBridge,
  VizCadence,
  VizChange,
  VizParts,
  VizPoint,
  VizSeries,
  VizStat,
  VizUnit,
} from "./types";

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;

/** The length of one period of a cadence in days, and how far a fiscal calendar may drift from it. */
export const STEP: Record<VizCadence, { days: number; tol: number }> = {
  q: { days: 91.31, tol: 20 },
  y: { days: 365.25, tol: 20 },
  m: { days: 30.44, tol: 6 },
};

/** Quarters and months are drawn as a line, fiscal years as columns. */
export const markOf = (cadence: VizCadence): "line" | "columns" =>
  cadence === "y" ? "columns" : "line";

export function pointAt(s: VizSeries, period: string): VizPoint | null {
  return s.points.find((p) => p.period === period) ?? null;
}

/** The point closest to `offsetDays` from `period`, within the cadence's drift; null when the company printed none. */
export function pointNear(
  s: VizSeries,
  period: string,
  offsetDays: number,
  tol: number,
): VizPoint | null {
  let best: VizPoint | null = null;
  let gap = Infinity;
  for (const p of s.points) {
    const g = Math.abs(daysBetween(period, p.period) - offsetDays);
    if (g <= tol && g < gap) {
      best = p;
      gap = g;
    }
  }
  return best;
}

/** The same period a year earlier (52/53-week calendars drift a few days). */
export const yearAgo = (s: VizSeries, p: VizPoint) => pointNear(s, p.period, -365.25, 20);

/** The period before (the quarter or month before; for years, the year before). */
export const priorPeriod = (s: VizSeries, p: VizPoint) =>
  pointNear(s, p.period, -STEP[s.cadence].days, STEP[s.cadence].tol);

/** Percent change for amounts and counts; points for percentages; basis points stay basis points. */
export function changeBetween(
  now: VizPoint,
  base: VizPoint | null,
  unit: VizUnit,
): VizChange | null {
  if (!base) return null;
  if (unit === "pct") return { kind: "pts", value: now.value - base.value, base };
  if (unit === "bps") return { kind: "bps", value: now.value - base.value, base };
  if (base.value === 0 || Math.sign(now.value) !== Math.sign(base.value)) return null;
  return { kind: "pct", value: ((now.value - base.value) / Math.abs(base.value)) * 100, base };
}

/** Costs, provisions, charge-offs and cost ratios improve when they fall. */
export function isInverted(s: Pick<VizSeries, "label">, cat?: string, met?: string): boolean {
  return (
    cat === "cost" ||
    met === "expense" ||
    met === "cost" ||
    /expense|charge-?off|provision|non-?performing|delinquen|efficiency ratio|overhead ratio|allowance/i.test(
      s.label,
    )
  );
}

/** The tile of one line: its latest figure, the change on a year and on the period before, 12 periods of trend. */
export function statOf(s: VizSeries, inverted = isInverted(s)): VizStat | null {
  const latest = s.points.at(-1);
  if (!latest) return null;
  const step = STEP[s.cadence];
  const spark: (VizPoint | null)[] = [];
  for (let i = 11; i >= 0; i--)
    spark.push(i === 0 ? latest : pointNear(s, latest.period, -i * step.days, step.tol));
  while (spark.length && spark[0] == null) spark.shift();
  return {
    series: s,
    latest,
    yoy: changeBetween(latest, yearAgo(s, latest), s.unit),
    qoq: s.cadence === "y" ? null : changeBetween(latest, priorPeriod(s, latest), s.unit),
    spark,
    inverted,
  };
}

/** The number a printed cell shows ("$1,212" is 1212, "(658)" is -658); null when it shows none. */
export function printedNumber(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/[$\s,%€£]/g, "").match(/^(\()?([-−])?(\d+(?:\.\d+)?)\)?$/);
  if (!m) return null;
  const n = Number(m[3]);
  return m[1] || m[2] ? -n : n;
}

/**
 * Half of the last printed digit, in the figure's own unit: "23,136" printed for 23,136,000,000 rounds to half a
 * million. Zero when the printed text does not show the figure's number.
 */
export function halfUnit(p: VizPoint): number {
  const n = printedNumber(p.printed);
  if (n == null || n === 0 || p.value === 0) return 0;
  const mult = Math.abs(p.value / n);
  const dec = (p.printed ?? "").match(/\.(\d+)/)?.[1].length ?? 0;
  return (mult * 10 ** -dec) / 2;
}

export interface Tie {
  period: string;
  total: number;
  sum: number;
  ok: boolean;
  /** the rounding the printed figures allow */
  tolerance: number;
}

/**
 * Whether the parts (signed: a subtracted line counts minus) add up to the printed total in one period, within the
 * rounding of the printed figures. Null when the total or any part is not printed for the period.
 */
export function tieAt(
  total: VizSeries,
  parts: VizSeries[],
  subtracted: string[],
  period: string,
): Tie | null {
  const t = pointAt(total, period);
  if (!t || !parts.length) return null;
  let sum = 0;
  let tolerance = halfUnit(t);
  for (const s of parts) {
    const p = pointAt(s, period);
    if (!p) return null;
    sum += subtracted.includes(s.key) ? -p.value : p.value;
    tolerance += halfUnit(p);
  }
  if (tolerance === 0) tolerance = Math.abs(t.value) * 0.001;
  return {
    period,
    total: t.value,
    sum,
    ok: Math.abs(sum - t.value) <= tolerance + 1e-9 * Math.abs(t.value),
    tolerance,
  };
}

/** The periods in which the parts tie to the total. */
export function tiedPeriods(total: VizSeries, parts: VizSeries[], subtracted: string[]): string[] {
  return total.points
    .map((p) => tieAt(total, parts, subtracted, p.period))
    .filter((t): t is Tie => !!t?.ok)
    .map((t) => t.period);
}

/** The signed contribution of a part in a period (a subtracted line counts minus). */
const signed = (parts: VizParts, s: VizSeries, p: VizPoint) =>
  parts.subtracted.includes(s.key) ? -p.value : p.value;

/**
 * Stacking is honest only when every contribution in every tied period is zero or more: a negative part (a loss on
 * securities) would have to hang below the axis and the stack would no longer read as the total.
 */
export function stackable(parts: VizParts): boolean {
  if (!parts.ties.length || parts.parts.length < 2) return false;
  return parts.ties.every((e) =>
    parts.parts.every((s) => {
      const p = pointAt(s, e);
      return !!p && signed(parts, s, p) >= 0;
    }),
  );
}

export interface StackSegment {
  key: string;
  label: string;
  /** index of the part in the section's order, which fixes its colour */
  slot: number;
  point: VizPoint;
  /** what is drawn: the figure in its unit, or its share of the total in percent */
  value: number;
  y0: number;
  y1: number;
}
export interface StackColumn {
  period: string;
  short: string;
  periodLabel: string;
  total: VizPoint;
  segments: StackSegment[];
}

/** Columns of a stacked (absolute) or 100 percent view, for the tied periods only. share = part ÷ total × 100. */
export function stackColumns(parts: VizParts, mode: "stacked" | "share"): StackColumn[] {
  if (!stackable(parts)) return [];
  return parts.ties.map((e) => {
    const total = pointAt(parts.total, e)!;
    let acc = 0;
    const segments = parts.parts.map((s, slot) => {
      const point = pointAt(s, e)!;
      const v = signed(parts, s, point);
      const value = mode === "share" ? (total.value ? (v / total.value) * 100 : 0) : v;
      const seg = { key: s.key, label: s.label, slot, point, value, y0: acc, y1: acc + value };
      acc += value;
      return seg;
    });
    return { period: e, short: total.short, periodLabel: total.periodLabel, total, segments };
  });
}

/**
 * A bridge between two periods across the parts, stated only when the parts tie to the total in both; otherwise
 * null with the reason in words.
 */
export function bridgeOf(
  parts: VizParts,
  from: string,
  to: string,
): { bridge: VizBridge | null; reason: string } {
  const a = tieAt(parts.total, parts.parts, parts.subtracted, from);
  const b = tieAt(parts.total, parts.parts, parts.subtracted, to);
  const fa = pointAt(parts.total, from);
  const fb = pointAt(parts.total, to);
  if (!fa || !fb)
    return { bridge: null, reason: `${parts.label} is not printed for both periods.` };
  if (!a || !b)
    return {
      bridge: null,
      reason: `Not every line of ${parts.label} is printed for ${!a ? fa.short : fb.short}, so no bridge is drawn.`,
    };
  if (!a.ok || !b.ok)
    return {
      bridge: null,
      reason: `The lines of ${parts.label} do not add up to the printed total in ${!a.ok ? fa.short : fb.short}, so no bridge is drawn.`,
    };
  const steps = parts.parts.map((s) => {
    const p0 = pointAt(s, from)!;
    const p1 = pointAt(s, to)!;
    return {
      key: s.key,
      label: s.label,
      from: p0,
      to: p1,
      delta: signed(parts, s, p1) - signed(parts, s, p0),
    };
  });
  const gap = daysBetween(from, to);
  const span =
    Math.abs(gap - 365.25) <= 20
      ? "yoy"
      : Math.abs(gap - STEP.q.days) <= STEP.q.tol
        ? "qoq"
        : "other";
  return {
    bridge: { key: parts.key, label: parts.label, unit: parts.unit, from: fa, to: fb, steps, span },
    reason: "",
  };
}

/** The default bridge: the latest tied period against the same period a year earlier, else the tied period before. */
export function defaultBridge(parts: VizParts): { bridge: VizBridge | null; reason: string } {
  const to = parts.ties.at(-1);
  if (!to)
    return {
      bridge: null,
      reason: `The lines of ${parts.label} never add up to the printed total, so no bridge is drawn.`,
    };
  const year = parts.ties.find((e) => Math.abs(daysBetween(e, to) - 365.25) <= 20);
  const prev = parts.ties.length > 1 ? parts.ties.at(-2)! : null;
  const from = year ?? prev;
  if (!from)
    return {
      bridge: null,
      reason: `The lines of ${parts.label} add up to the printed total in one period only, so no bridge is drawn.`,
    };
  return bridgeOf(parts, from, to);
}

export interface WaterfallBar {
  key: string;
  label: string;
  kind: "total" | "step";
  /** where the bar starts and ends on the value axis */
  start: number;
  end: number;
  delta: number;
  point?: VizPoint;
  from?: VizPoint;
}

/** The bars of a bridge: the first total, one floating bar per part's change, the last total. */
export function waterfallBars(b: VizBridge): WaterfallBar[] {
  const bars: WaterfallBar[] = [
    {
      key: "from",
      label: b.from.short,
      kind: "total",
      start: 0,
      end: b.from.value,
      delta: b.from.value,
      point: b.from,
    },
  ];
  let acc = b.from.value;
  for (const s of b.steps) {
    bars.push({
      key: s.key,
      label: s.label,
      kind: "step",
      start: acc,
      end: acc + s.delta,
      delta: s.delta,
      point: s.to,
      from: s.from,
    });
    acc += s.delta;
  }
  bars.push({
    key: "to",
    label: b.to.short,
    kind: "total",
    start: 0,
    end: b.to.value,
    delta: b.to.value,
    point: b.to,
  });
  return bars;
}

/** The steps' changes add up to the change of the total, within the printed rounding of both periods. */
export function bridgeCloses(b: VizBridge): boolean {
  const sum = b.steps.reduce((a, s) => a + s.delta, 0);
  const tol =
    halfUnit(b.from) +
    halfUnit(b.to) +
    b.steps.reduce((a, s) => a + halfUnit(s.from) + halfUnit(s.to), 0);
  return (
    Math.abs(sum - (b.to.value - b.from.value)) <= (tol || Math.abs(b.to.value) * 0.002) + 1e-6
  );
}

/**
 * Vertical positions for end labels that keep at least `gap` px between neighbours and stay inside [lo, hi]. Labels
 * keep their order; a crowded group is spread around its centre.
 */
export function spreadLabels(
  items: { key: string; y: number }[],
  gap: number,
  lo: number,
  hi: number,
): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y).map((d) => ({ ...d }));
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 1; i < sorted.length; i++) {
      const over = sorted[i - 1].y + gap - sorted[i].y;
      if (over > 0) {
        sorted[i - 1].y -= over / 2;
        sorted[i].y += over / 2;
      }
    }
    if (sorted.length) {
      if (sorted[0].y < lo) {
        const d = lo - sorted[0].y;
        for (const s of sorted) s.y += d;
      }
      const last = sorted[sorted.length - 1];
      if (last.y > hi) {
        const d = last.y - hi;
        for (const s of sorted) s.y -= d;
      }
    }
  }
  return new Map(sorted.map((s) => [s.key, s.y]));
}

/**
 * The lines a chart may draw on one value axis: those sharing the first line's unit (and printed unit), at most
 * `max`. The rest are counted so the caption can say what was left out.
 */
export function oneAxis(series: VizSeries[], max = 6): { shown: VizSeries[]; leftOut: number } {
  const first = series.find((s) => s.points.length);
  if (!first) return { shown: [], leftOut: series.length };
  const same = series.filter(
    (s) =>
      s.points.length &&
      s.unit === first.unit &&
      (s.printedUnit ?? "") === (first.printedUnit ?? ""),
  );
  const shown = same.slice(0, max);
  return { shown, leftOut: series.length - shown.length };
}

/** The periods any of the lines prints, in order. */
export function periodsOf(series: VizSeries[]): string[] {
  return [...new Set(series.flatMap((s) => s.points.map((p) => p.period)))].sort();
}

/** A value domain that includes zero for columns and amounts, padded for lines of ratios. */
export function valueDomain(values: number[], includeZero: boolean): [number, number] {
  if (!values.length) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  } else {
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
    // Padding never carries an axis of positive figures below zero (or of negative ones above it).
    lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    hi = hi <= 0 ? Math.min(0, hi + pad) : hi + pad;
  }
  if (lo === hi) hi = lo + 1;
  return [lo, hi];
}

/**
 * At most `max` parts keep their own colour: the largest `max - 1` by their latest tied figure stay in the company's
 * order and the rest fold into one "Other lines" part (their sum in each tied period, which has no single source).
 * A ninth hue is never generated.
 */
export function foldParts(parts: VizParts, max = 5): VizParts {
  if (parts.parts.length <= max) return parts;
  const last = parts.ties.at(-1);
  const size = (s: VizSeries) =>
    Math.abs((last && pointAt(s, last)?.value) || s.points.at(-1)?.value || 0);
  const keep = new Set(
    [...parts.parts]
      .sort((a, b) => size(b) - size(a))
      .slice(0, max - 1)
      .map((s) => s.key),
  );
  const kept = parts.parts.filter((s) => keep.has(s.key));
  const rest = parts.parts.filter((s) => !keep.has(s.key));
  const names = rest.map((s) => s.label).join(", ");
  const points: VizPoint[] = parts.ties.flatMap((e) => {
    const t = pointAt(parts.total, e)!;
    const ps = rest.map((s) => pointAt(s, e));
    if (ps.some((p) => !p)) return [];
    const value = rest.reduce(
      (a, s, i) => a + (parts.subtracted.includes(s.key) ? -ps[i]!.value : ps[i]!.value),
      0,
    );
    return [
      {
        period: e,
        periodLabel: t.periodLabel,
        short: t.short,
        value,
        note: `Sum of ${rest.length} printed lines: ${names}`,
      },
    ];
  });
  const other: VizSeries = {
    key: "__other",
    label: `Other lines (${rest.length})`,
    unit: parts.unit,
    cadence: parts.cadence,
    points,
  };
  return {
    ...parts,
    parts: [...kept, other],
    subtracted: parts.subtracted.filter((k) => keep.has(k)),
  };
}
