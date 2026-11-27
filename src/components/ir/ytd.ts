/**
 * Year-to-date sections of the IR tab (findings irrules-05 and irrules-06): a table the company prints only
 * for the year to date (most cash flow statements: "Nine months ended September 30") is shown with its
 * columns as printed, each under its length and end date ("9 months to 30 Sep 2026"), never as quarters.
 *
 * Data contract read here:
 * - `Statement.basis === "ytd"`: the section's anchor table prints only year-to-date columns (statements.ts).
 * - `PayloadSeries.ytd`: the figures as printed, keyed "<months>:<period end>" ("9:2026-09-30"), each a
 *   PayloadCell with `m` months and `e` end; never derived (payload.ts).
 * A first-quarter release prints the three months, which is also the quarter, and a year-end release prints
 * the twelve months, which is also the year: those printings live in `q` and `y`. A year-to-date section
 * shows them too, as "3 months" and "12 months" columns, when they were read from a document (not derived),
 * so the columns run through the year as the releases print them.
 */
import type { PayloadCell, PayloadSeries } from "@/lib/ir/payload";
import type { PeriodHead } from "@/lib/ir/periods";
import type { Statement } from "@/lib/ir/statements";

/** A line with its year-to-date printings (payload field `ytd`, irrules-05). */
export type YtdSeries = PayloadSeries & { ytd?: Record<string, PayloadCell> };

/** Whether the section's own table prints only year-to-date columns (set by the rules: `basis: "ytd"`). */
export const isYtdSection = (sec: Statement) =>
  (sec as Statement & { basis?: string }).basis === "ytd";

const KEY = /^(\d{1,2}):(\d{4}-\d{2}-\d{2})$/;

/** A year-to-date column key: "<months>:<period end>". */
export const ytdKey = (months: number, end: string) => `${months}:${end}`;

/** Months and period end of a year-to-date column key, or null for any other column key. */
export function parseYtdKey(key: string): { m: number; e: string } | null {
  const x = KEY.exec(key);
  return x ? { m: Number(x[1]), e: x[2] } : null;
}

/** Columns in time order (oldest first, as the tab's other sections), a shorter length first on the same end. */
export function sortYtd(keys: Iterable<string>): string[] {
  return [...new Set(keys)]
    .map((k) => [k, parseYtdKey(k)] as const)
    .filter((x): x is readonly [string, { m: number; e: string }] => !!x[1])
    .sort((a, b) => a[1].e.localeCompare(b[1].e) || a[1].m - b[1].m)
    .map((x) => x[0]);
}

/** A line's printed year-to-date figures by column key, with the printed first quarters and full years. */
export function ytdCellsOf(s: PayloadSeries): Record<string, PayloadCell> {
  const out: Record<string, PayloadCell> = {};
  for (const [k, c] of Object.entries((s as YtdSeries).ytd ?? {})) {
    const p = parseYtdKey(k);
    if (p && !c.f) out[k] = { ...c, m: c.m ?? p.m, e: c.e ?? p.e };
  }
  const add = (cells: Record<string, PayloadCell>, m: number) => {
    for (const [e, c] of Object.entries(cells)) {
      // Only a printed figure of that length: a derived cell, or a figure of another length, stays out.
      if (c.f || (c.m != null && c.m !== m) || c.d == null) continue;
      const k = ytdKey(m, e);
      if (!out[k]) out[k] = { ...c, m, e: c.e ?? e };
    }
  };
  // A quarter is also a year-to-date column only when it opens the year: its calendar month is three
  // months before the end of a printed six-month column, or six before a nine-month one. Without those
  // the line prints no year to date that a quarter could open.
  const opening = new Set<number>();
  for (const k of Object.keys(out)) {
    const p = parseYtdKey(k);
    if (p && (p.m === 6 || p.m === 9)) opening.add(monthOf(p.e, p.m - 3));
  }
  add(Object.fromEntries(Object.entries(s.q).filter(([e]) => opening.has(monthOf(e, 0)))), 3);
  if (Object.keys(out).length) add(s.y, 12);
  return out;
}

/** Calendar month (1 to 12) `back` months before the month of `end`. */
function monthOf(end: string, back: number): number {
  return ((((Number(end.slice(5, 7)) - 1 - back) % 12) + 12) % 12) + 1;
}

/** Whether the line prints any year-to-date figure. */
export const hasYtd = (s: PayloadSeries) => Object.keys(ytdCellsOf(s)).length > 0;

/**
 * One row's year-to-date figures: the first line of the row that prints a column wins (the row's lines in
 * order, as `rowCells` reads the other kinds). Same shape as `rowCells`, with nothing held.
 */
export function ytdRowCells(
  ks: string[],
  byKey: Map<string, PayloadSeries>,
): {
  cells: Record<string, PayloadCell>;
  held: Record<string, PayloadCell>;
  from: Record<string, string>;
} {
  const cells: Record<string, PayloadCell> = {};
  const from: Record<string, string> = {};
  for (const k of ks) {
    const s = byKey.get(k);
    if (!s) continue;
    for (const [key, c] of Object.entries(ytdCellsOf(s)))
      if (!cells[key]) {
        cells[key] = c;
        from[key] = k;
      }
  }
  return { cells, held: {}, from };
}

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const dayMonthYear = (e: string, names: string[]) =>
  `${Number(e.slice(8, 10))} ${names[Number(e.slice(5, 7)) - 1]} ${e.slice(0, 4)}`;

/** Column head: length over end date ("9 months to" over "30 Sep 2026"). */
export function ytdHead(key: string): PeriodHead {
  const p = parseYtdKey(key);
  if (!p) return { main: key, sub: "", short: key };
  const date = dayMonthYear(p.e, SHORT);
  return { main: `${p.m} months to`, sub: date, short: `${p.m} months to ${date}` };
}

/** The column in full, for hover titles, the source panel and exports ("9 months ended 30 September 2026"). */
export function ytdLong(key: string): string {
  const p = parseYtdKey(key);
  return p ? `${p.m} months ended ${dayMonthYear(p.e, LONG)}` : key;
}

/**
 * The columns a year-to-date section shows for a period chip: those whose end falls within the quarters the
 * chip covers on the tab's quarter grid ("8Q" shows about two years of year-to-date columns); all for "All".
 */
export function ytdInSpan(keys: string[], quarters: string[], span: string): string[] {
  if (span === "all" || !quarters.length) return keys;
  const from = quarters.slice(-Number(span))[0];
  return keys.filter((k) => (parseYtdKey(k)?.e ?? "") >= from);
}
