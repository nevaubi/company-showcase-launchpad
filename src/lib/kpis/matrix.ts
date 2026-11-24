// Presentation rules for the standardized KPI matrix (/app/kpis): one unit and scale per column, the
// period most companies in a column report (so only the exceptions need a label), and value and change
// formatting with a true minus. Pure.

export interface MatrixKpi {
  uclass: string;
  unit: string;
}
/** A stored latest point: [period end, value, period label, change vs a year earlier or null]. */
export type MatrixPoint = [string, number, string, number | null];

const MINUS = "−";
const fix = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** The scale a column's amounts are shown in, chosen from the column's median magnitude. */
export interface ColumnScale {
  div: number;
  /** suffix after each number ("B", "M", "K" or "") */
  suffix: string;
  /** the unit stated once in the column head ("%", "×", "$B", "$ per share", "M") */
  head: string;
  decimals: number;
}

const UNIT_HEAD: Record<string, string> = { pct: "%", x: "×", usd_ps: "$ per share", usd_pu: "$ per unit", cents: "cents" };

export function columnScale(k: MatrixKpi, values: number[]): ColumnScale {
  if (k.uclass === "pct") return { div: 1, suffix: "", head: "%", decimals: 1 };
  if (k.uclass === "x") return { div: 1, suffix: "", head: "×", decimals: 2 };
  if (UNIT_HEAD[k.uclass]) return { div: 1, suffix: "", head: UNIT_HEAD[k.uclass], decimals: 2 };
  const a = values.filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y);
  const med = a.length ? a[a.length >> 1] : 0;
  const [div, suffix] = med >= 1e9 ? [1e9, "B"] : med >= 1e6 ? [1e6, "M"] : med >= 1e4 ? [1e3, "K"] : [1, ""];
  const tail = k.unit && !["count", "USD"].includes(k.unit) ? ` ${k.unit}` : "";
  const head = k.uclass === "usd" ? `$${suffix}` : `${suffix}${tail}`.trim() || "count";
  return { div, suffix, head, decimals: div === 1 && med < 100 ? 2 : 1 };
}

/** A value in its column's scale, without the unit the head already states. */
export function fmtInScale(v: number | null | undefined, s: ColumnScale): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const x = Math.abs(v / s.div);
  let d = s.div === 1 && s.head === "count" ? 0 : x >= 1000 ? 0 : s.decimals;
  // A small amount in a scaled column ($45M under $B) keeps two significant digits instead of printing 0.0.
  if (s.div > 1 && x > 0 && x < 1) d = Math.min(6, Math.max(d, 1 - Math.floor(Math.log10(x))));
  const t = fix(x, d);
  return `${v < 0 && /[1-9]/.test(t) ? MINUS : ""}${t}`;
}

/** Year-over-year change: percentage points for rates, percent for amounts. */
export function fmtChange(c: number | null | undefined, k: MatrixKpi): string {
  if (c == null || !Number.isFinite(c)) return "–";
  const sign = c > 0 ? "+" : c < 0 ? MINUS : "";
  return k.uclass === "pct" ? `${sign}${fix(Math.abs(c), 1)} pt` : `${sign}${fix(Math.abs(c * 100), 1)}%`;
}

/** The period label most points in a column carry (ties go to the later period end). */
export function modalPeriod(points: (MatrixPoint | null | undefined)[]): string | null {
  const n = new Map<string, { c: number; end: string }>();
  for (const p of points) {
    if (!p) continue;
    const cur = n.get(p[2]);
    n.set(p[2], { c: (cur?.c ?? 0) + 1, end: cur && cur.end > p[0] ? cur.end : p[0] });
  }
  let best: string | null = null;
  let bc = -1;
  let be = "";
  for (const [label, { c, end }] of n) if (c > bc || (c === bc && end > be)) [best, bc, be] = [label, c, end];
  return best;
}

/** Short period label for a cell ("Q2 2026" → "Q2 26", "FY2025" → "FY25"). */
export const shortPeriod = (label: string) => label.replace(/(19|20)(\d{2})(?!\d)/, "$2");

const DAY = 864e5;

/** The period end most points in a column carry (ties go to the later end). */
export function modalEnd(points: (MatrixPoint | null | undefined)[]): string | null {
  const n = new Map<string, number>();
  for (const p of points) if (p) n.set(p[0], (n.get(p[0]) ?? 0) + 1);
  let best: string | null = null;
  let bc = -1;
  for (const [end, c] of n) if (c > bc || (c === bc && best != null && end > best)) [best, bc] = [end, c];
  return best;
}

/** Days from which a period end counts as a different period than the column's (quarter ends drift by a few days). */
export const OFF_PERIOD_DAYS = 45;
/** Days after which a value is marked as old. */
export const STALE_MARK_DAYS = 200;

/**
 * The small label a cell carries, or null when it is the column's own period and recent.
 * A cell is an exception when its fiscal label differs from the column's or its period ended more than
 * 45 days from the column's most common end (a "Q3 2026" that ended in March under a September "Q3 2026").
 * An old value always carries its label, so the stale colour is never lost.
 */
export function periodMark(
  p: MatrixPoint,
  col: { period: string | null; end: string | null },
  now = Date.now(),
): { text: string; stale: boolean } | null {
  const stale = (now - Date.parse(p[0])) / DAY > STALE_MARK_DAYS;
  const labelOff = col.period != null && p[2] !== col.period;
  const endOff = col.end != null && Math.abs(Date.parse(p[0]) - Date.parse(col.end)) / DAY > OFF_PERIOD_DAYS;
  if (!labelOff && !endOff && !stale) return null;
  if (labelOff || !endOff) return { text: shortPeriod(p[2]), stale };
  // Same label, different end: name the month the period ended.
  const d = new Date(p[0]);
  const text = `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCFullYear()).slice(2)}`;
  return { text, stale };
}
