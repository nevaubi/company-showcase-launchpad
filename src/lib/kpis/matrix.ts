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
  const x = v / s.div;
  const d = s.div === 1 && s.head === "count" ? 0 : Math.abs(x) >= 1000 ? 0 : s.decimals;
  return `${v < 0 ? MINUS : ""}${fix(Math.abs(x), d)}`;
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
