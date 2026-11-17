/**
 * Pure cross-check of a primary reader against the OpenAI second reader for table cells and page
 * tokens. Values are always re-read from the source, so readers can only disagree on what a number
 * is (period, length, metric). Policy, from the text-reader pilot: figures both readers date the same
 * are confirmed; figures they date differently are dropped; figures only the primary reads stay as
 * before; the second reader's solo finds are never stored (its labels drift). When the primary answer
 * was unusable, the second reader's answer is the page's only reading and is kept whole.
 */
const DAY = 86_400_000;
const nearDate = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 6 * DAY;

export interface Checkable {
  period_end: string;
  months: number;
  value: number;
}

export interface CrossResult<T> {
  rows: T[];
  agreed: number;
  conflicts: number;
  secondOnly: number;
}

/** Same number, same date within a week, same period length (a balance vs a flow of the same date is a conflict). */
export function sameReading(a: Checkable, b: Checkable) {
  return nearDate(a.period_end, b.period_end) && a.months === b.months && Math.abs(a.value - b.value) <= Math.abs(a.value) * 1e-9;
}

export function crossCheckBy<T extends Checkable>(primary: T[], second: T[], key: (f: T) => string): CrossResult<T> {
  const byKey = new Map<string, T[]>();
  for (const f of second) byKey.set(key(f), [...(byKey.get(key(f)) ?? []), f]);
  const seen = new Set<string>();
  const rows: T[] = [];
  let agreed = 0;
  let conflicts = 0;
  for (const f of primary) {
    const k = key(f);
    seen.add(k);
    const other = byKey.get(k);
    if (!other) {
      rows.push(f);
      continue;
    }
    if (other.some((o) => sameReading(f, o))) {
      agreed++;
      rows.push(f);
    } else conflicts++;
  }
  const secondOnly = [...byKey.keys()].filter((k) => !seen.has(k)).length;
  return { rows, agreed, conflicts, secondOnly };
}

/** Table cells: one cell is one source number. */
export const cellKey = (f: { locator: { t: number; r: number; c: number } }) => `${f.locator.t}:${f.locator.r}:${f.locator.c}`;
/** Page tokens: the printed token and its position on the page. */
export const tokenKey = (f: { locator: { page: number; box: number[]; text: string } }) => `${f.locator.page}:${f.locator.text}:${f.locator.box.map((x) => Math.round(x)).join(",")}`;
