// What period a yearly alt-data reading covers, and how to label it. A reading for a year that has
// not ended (calendar year, or US federal fiscal year Oct–Sep) is partial: collectors date it on the
// day it was collected and record the period in meta, so nothing is dated in the future and a
// partial year is never drawn or compared as a full one. Older rows dated at a future period end
// are read as partial too. Pure.

/** The US federal fiscal year a date falls in (FY2027 runs 2026-10-01 to 2027-09-30). */
export function federalFiscalYear(d: Date): number {
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

export interface YearPeriod {
  /** Date to store: the period end once it has passed, otherwise the collection day. */
  date: string;
  ytd: boolean;
  period_start: string;
  period_end: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** A calendar year as of `today`. */
export function calendarYearPeriod(year: number, today: Date): YearPeriod {
  const end = `${year}-12-31`;
  const ytd = end >= isoDay(today);
  return { date: ytd ? isoDay(today) : end, ytd, period_start: `${year}-01-01`, period_end: end };
}

/**
 * Days after a federal fiscal year ends before its totals are treated as final. Agencies report
 * contract actions late (the Department of Defense publishes with a 90-day delay), so a year's total
 * keeps growing for months after September 30.
 */
export const FY_SETTLE_DAYS = 120;

const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5));

/** A US federal fiscal year as of `today`; partial until FY_SETTLE_DAYS after it ends. */
export function fiscalYearPeriod(fy: number, today: Date): YearPeriod {
  const end = `${fy}-09-30`;
  const ytd = addDays(end, FY_SETTLE_DAYS) > isoDay(today);
  return { date: ytd ? (end >= isoDay(today) ? isoDay(today) : end) : end, ytd, period_start: `${fy - 1}-10-01`, period_end: end };
}

/** Whether a fiscal year that has ended is still within its reporting lag on `today`. */
export function fiscalYearUnsettled(fy: number | string, today: string): boolean {
  const end = `${fy}-09-30`;
  return end < today && addDays(end, FY_SETTLE_DAYS) > today;
}

export interface SeriesRowLike { date: string | null; meta?: PeriodMeta | null }
export interface PeriodMeta { ytd?: boolean; fiscal_year?: number | string; year?: number | string; quarters?: number; period_end?: string; as_of?: string; [k: string]: unknown }

/** Whether a stored reading covers only part of its period (flagged, or dated after `today`). */
export function isPartial(r: SeriesRowLike, today: string): boolean {
  return !!r.meta?.ytd || (!!r.date && r.date > today) || (!!r.meta?.fiscal_year && fiscalYearUnsettled(r.meta.fiscal_year, today));
}

/**
 * Short label of the period a reading covers: "FY2026", "FY2027 YTD", "2025", "2026 YTD",
 * "2026 Q1–Q2" (Medicare quarters), or the month for monthly series.
 */
export function periodLabel(r: SeriesRowLike, today: string, yearly = true): string {
  if (!r.date) return "";
  const m = r.meta ?? {};
  const partial = isPartial(r, today);
  if (m.fiscal_year) return `FY${m.fiscal_year}${!partial ? "" : `${m.fiscal_year}-09-30` < today ? " prelim." : " YTD"}`;
  const year = String(m.year ?? (typeof m.period_end === "string" ? m.period_end.slice(0, 4) : r.date.slice(0, 4)));
  if (partial && m.quarters) return `${year} Q1${Number(m.quarters) > 1 ? `–Q${m.quarters}` : ""}`;
  if (partial) return `${year} YTD`;
  return yearly ? r.date.slice(0, 4) : r.date.slice(0, 7);
}

/** Label for "latest" lines: the period, and for a partial one the day it was read ("FY2027 YTD, as of 2026-11-20"). */
export function asOfLabel(r: SeriesRowLike, today: string): string {
  if (!r.date) return "—";
  if (!isPartial(r, today)) return r.meta?.fiscal_year ? `FY${r.meta.fiscal_year}` : r.date;
  const ended = typeof r.meta?.period_end === "string" ? r.meta.period_end < today : r.meta?.fiscal_year ? `${r.meta.fiscal_year}-09-30` < today : false;
  const asOf = typeof r.meta?.as_of === "string" ? r.meta.as_of.slice(0, 10) : r.date <= today && !ended ? r.date : null;
  return `${periodLabel(r, today)}${asOf ? `, as of ${asOf}` : ""}`;
}
