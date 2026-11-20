// Period grids for the IR page (pure; shared by the page, the financial map, exports and tests).
// A payload's quarter list can contain month-ends when a company also publishes monthly operating
// data (balances and counts at each month-end). Those belong in a monthly view, not in the quarterly
// tables, where they would show as mostly empty columns.
import type { IrPayload, PayloadCell, PayloadSeries } from "@/lib/ir/payload";

export type IrPeriodKind = "q" | "y" | "m";

/** Calendar month a period really closes (52/53-week years end in the first days of the next month). */
export function closingMonth(end: string): number {
  const m = Number(end.slice(5, 7));
  const day = Number(end.slice(8, 10));
  return day <= 7 ? ((m + 10) % 12) + 1 : m;
}

const mode = (xs: number[]) => {
  const n = new Map<number, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
};

/** The four calendar months that close a fiscal quarter, or null when the payload doesn't say. */
export function quarterMonths(p: Pick<IrPayload, "years" | "series">): Set<number> | null {
  let anchor = mode(p.years.map(closingMonth));
  if (anchor == null) {
    // No fiscal years: the most common closing month (mod 3) among printed three-month periods.
    const ends: number[] = [];
    for (const s of p.series) for (const [e, c] of Object.entries(s.q)) if (c.m === 3 || (!s.pit && c.m == null)) ends.push(closingMonth(c.e ?? e));
    const r = mode(ends.map((m) => m % 3));
    if (r == null) return null;
    anchor = r === 0 ? 3 : r;
  }
  return new Set([0, 3, 6, 9].map((k) => ((anchor! - 1 + k) % 12) + 1));
}

export interface PeriodGrids {
  q: string[];
  y: string[];
  /** month-ends with monthly data, plus the quarter-ends inside that range; empty when under 3 months */
  m: string[];
}

const gridCache = new WeakMap<IrPayload, PeriodGrids>();

export function periodGrids(p: IrPayload): PeriodGrids {
  const hit = gridCache.get(p);
  if (hit) return hit;
  const qm = quarterMonths(p);
  // A column with any three-month or calculated value is a quarter whatever its month (fiscal-year changes).
  const flowEnds = new Set<string>();
  for (const s of p.series) if (!s.pit) for (const e of Object.keys(s.q)) flowEnds.add(e);
  const isQ = (e: string) => !qm || flowEnds.has(e) || qm.has(closingMonth(e));
  const q = dropStrays(p, p.quarters.filter(isQ), (s) => s.q);
  const monthly = new Set([...(p.months ?? []), ...p.quarters.filter((e) => !isQ(e))]);
  let m: string[] = [];
  if (monthly.size >= 3) {
    const sorted = [...monthly].sort();
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    // Quarter-ends inside the monthly range, where a month-end balance was also printed.
    const pitEnds = new Set<string>();
    for (const s of p.series) if (s.pit) for (const e of Object.keys(s.q)) if (e >= lo && e <= hi) pitEnds.add(e);
    m = [...new Set([...sorted, ...q.filter((e) => pitEnds.has(e))])].sort();
  }
  const out = { q, y: dropStrays(p, p.years, (s) => s.y), m };
  gridCache.set(p, out);
  return out;
}

/**
 * A column a few weeks from a busy column that only a handful of lines report (a misdated value, an
 * "as of" date next to the quarter-end) would show as a second, almost empty "Dec ’25"; leave it out.
 */
export function dropStrays(p: Pick<IrPayload, "series">, ends: string[], cellsOf: (s: PayloadSeries) => Record<string, PayloadCell>): string[] {
  if (ends.length < 3) return ends;
  const n = new Map(ends.map((e) => [e, 0]));
  for (const s of p.series) for (const e of Object.keys(cellsOf(s))) if (n.has(e)) n.set(e, n.get(e)! + 1);
  const DAY = 86_400_000;
  const at = (e: string) => Date.parse(`${e}T00:00:00Z`);
  return ends.filter((e, i) => {
    const mine = n.get(e)!;
    const near = [ends[i - 1], ends[i + 1]].filter((x) => x && Math.abs(at(x) - at(e)) <= 45 * DAY);
    return !near.some((x) => n.get(x)! >= Math.max(5, mine * 10));
  });
}

const monthCache = new WeakMap<PayloadSeries, Record<string, PayloadCell>>();

/** A series' cells for one period type; the monthly view holds month-end balances and monthly flows. */
export function cellsFor(s: PayloadSeries, kind: IrPeriodKind): Record<string, PayloadCell> {
  if (kind === "q") return s.q;
  if (kind === "y") return s.y;
  let c = monthCache.get(s);
  if (!c) {
    c = s.pit ? { ...s.q, ...(s.mo ?? {}) } : { ...(s.mo ?? {}) };
    monthCache.set(s, c);
  }
  return c;
}

/**
 * Calendar month that closes the company's fiscal year: from its fiscal-year columns, else March,
 * June, September, December quarter-ends are read as a calendar fiscal year. Null when the payload
 * can't tell (quarters that end in other months and no fiscal-year column).
 */
export function fiscalYearEndMonth(p: Pick<IrPayload, "years" | "series">): number | null {
  const fy = mode(p.years.map(closingMonth));
  if (fy != null) return fy;
  const q = quarterMonths(p);
  return q && q.has(12) && q.has(3) ? 12 : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Column heads that cannot be misread: "Q3 FY25" over "Oct ’24" for a quarter, "FY25" over "Jan ’25"
 * for a fiscal year, "Oct ’24" alone for a month. The fiscal year is named by the calendar year it ends
 * in (NVIDIA's year to 26 Jan 2025 is FY25). Without a known fiscal year-end the calendar month leads.
 */
export function fiscalLabel(end: string, kind: IrPeriodKind, fyEnd: number | null): { main: string; sub: string } {
  const m = closingMonth(end);
  const y = Number(end.slice(0, 4)) - (m === 12 && Number(end.slice(5, 7)) === 1 ? 1 : 0);
  const cal = `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
  if (kind === "m" || fyEnd == null) return { main: cal, sub: kind === "y" ? "fiscal year" : "" };
  const ahead = (fyEnd - m + 12) % 12; // months from this period's close to the fiscal year-end
  const fy = y + (m + ahead > 12 ? 1 : 0);
  const fyTag = `FY${String(fy).slice(2)}`;
  if (kind === "y") return { main: fyTag, sub: cal };
  return { main: `Q${4 - Math.floor(ahead / 3)} ${fyTag}`, sub: cal };
}
