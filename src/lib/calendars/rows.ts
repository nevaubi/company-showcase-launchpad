import type { UniverseEntry } from "@/lib/financials/types";
import {
  dayDiff,
  earningsOf,
  type Declaration,
  type DividendRow,
  type DividendsFile,
  type EarningsEntry,
  type EstimatesIndex,
  type IposFile,
  type MacroRelease,
} from "@/lib/calendars/data";

export interface CalData {
  today: string;
  earnings?: EstimatesIndex;
  releases?: MacroRelease[];
  dividends?: DividendsFile;
  ipos?: IposFile;
  uni: Map<string, UniverseEntry>;
}

// ---------------------------------------------------------------- derived rows
export interface EarnRow extends EarningsEntry {
  ticker: string;
  name: string;
  sector: string;
  size: number;
  logo?: string;
  /** upcoming: the scheduled date; reported: the 8-K that reported the latest quarter (date = its filing date) */
  kind: "upcoming" | "reported";
  /** an upcoming date already in the past whose results are not on file yet */
  awaiting?: boolean;
}
/** Upcoming dates plus the latest reported quarter of each company, so past days show actual against expected. */
export function earningsRows(d: CalData): EarnRow[] {
  const out: EarnRow[] = [];
  for (const r of d.earnings?.companies ?? []) {
    const u = d.uni.get(r.ticker);
    const e = earningsOf(r);
    const base = {
      ...e,
      ticker: r.ticker,
      name: u?.name ?? r.ticker,
      sector: u?.sector ?? "",
      size: u?.revenueTTM ?? 0,
      logo: u?.logo,
    };
    const filed = e.last?.report?.filed ?? null;
    // a scheduled date that has passed and was met by a report within three days is shown as that report
    const met = !!(e.date && filed && e.date <= d.today && Math.abs(dayDiff(filed, e.date)) <= 3);
    if (e.date && !met) {
      const awaiting = e.date < d.today && (!filed || dayDiff(filed, e.date) > 3);
      out.push({ ...base, kind: "upcoming", awaiting });
    }
    if (filed && (met || !e.date || Math.abs(dayDiff(filed, e.date)) > 3))
      out.push({ ...base, date: filed, is_estimate: false, kind: "reported" });
  }
  return out;
}
export interface DivEvent {
  ticker: string;
  name: string;
  date: string;
  kind: "declared" | "projected";
  amount: number;
  dec?: Declaration;
  row: DividendRow;
}
export function dividendEvents(d: CalData): DivEvent[] {
  const out: DivEvent[] = [];
  for (const r of d.dividends?.rows ?? []) {
    const name = d.uni.get(r.ticker)?.name ?? r.name ?? r.ticker;
    const declaredDates = new Set<string>();
    for (const x of r.declared) {
      const date = x.ex_date ?? x.record ?? x.payable;
      if (!date) continue;
      declaredDates.add(date);
      out.push({
        ticker: r.ticker,
        name,
        date,
        kind: "declared",
        amount: x.amount,
        dec: x,
        row: r,
      });
    }
    const p = r.projected;
    // a projection is dropped once a declaration lands within two weeks of it
    if (p && ![...declaredDates].some((x) => Math.abs(dayDiff(x, p.ex_date)) <= 14))
      out.push({
        ticker: r.ticker,
        name,
        date: p.ex_date,
        kind: "projected",
        amount: p.amount,
        row: r,
      });
  }
  return out;
}
