/**
 * US equity market calendar (pure): NYSE full-day holidays and weekends, so freshness limits on
 * trading-day data allow for days the market was shut instead of alarming every long weekend.
 */

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** n-th (1-based) weekday `wd` (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return iso(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0));
  const back = (lastDay.getUTCDay() - wd + 7) % 7;
  return iso(y, m, lastDay.getUTCDate() - back);
}

/** Saturday holidays move to Friday, Sunday ones to Monday (NYSE rule 7.2). */
function observed(y: number, m: number, d: number): string | null {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 6) return m === 1 && d === 1 ? null : iso(y, m, d - 1); // New Year on a Saturday is not moved back into December
  if (wd === 0) return iso(y, m, d + 1);
  return iso(y, m, d);
}

/** Easter Sunday (Anonymous Gregorian algorithm). */
function easter(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return { m: month, d: day };
}

const cache = new Map<number, Set<string>>();

/** NYSE full-day holidays of a year (ISO dates). */
export function nyseHolidays(y: number): Set<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const e = easter(y);
  const goodFriday = new Date(Date.UTC(y, e.m - 1, e.d - 2)).toISOString().slice(0, 10);
  const days = [
    observed(y, 1, 1),
    nthWeekday(y, 1, 1, 3),
    nthWeekday(y, 2, 1, 3),
    goodFriday,
    nthWeekday(y, 5, 1, -1),
    y >= 2022 ? observed(y, 6, 19) : null,
    observed(y, 7, 4),
    nthWeekday(y, 9, 1, 1),
    nthWeekday(y, 11, 4, 4),
    observed(y, 12, 25),
  ].filter((d): d is string => !!d);
  const set = new Set(days);
  cache.set(y, set);
  return set;
}

export function isTradingDay(date: string): boolean {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !nyseHolidays(d.getUTCFullYear()).has(date);
}

/**
 * Hours to add to a trading-day limit: 24 for every non-trading UTC date from the newest record's
 * date to today, both included (at most 10 days are counted).
 */
export function nonTradingHours(newestMs: number, nowMs: number): number {
  if (!(nowMs > newestMs)) return 0;
  let n = 0;
  const day = 86400_000;
  const start = Math.floor(newestMs / day) * day;
  for (let t = start, k = 0; t <= nowMs && k < 10; t += day, k++) if (!isTradingDay(new Date(t).toISOString().slice(0, 10))) n++;
  return n * 24;
}
