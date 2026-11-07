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
}
export function earningsRows(d: CalData): EarnRow[] {
  return (d.earnings?.companies ?? [])
    .map((r) => {
      const u = d.uni.get(r.ticker);
      return {
        ...earningsOf(r),
        ticker: r.ticker,
        name: u?.name ?? r.ticker,
        sector: u?.sector ?? "",
        size: u?.revenueTTM ?? 0,
        logo: u?.logo,
      };
    })
    .filter((r) => !!r.date);
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
