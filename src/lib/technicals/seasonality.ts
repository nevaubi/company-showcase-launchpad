// Historical calendar returns. All legs in a comparison use the same two observed NYSE month ends.
import { isTradingDay } from "../jobs/trading-days";
import type { BenchSeries } from "./measures";

export function monthEndReturns(dates: string[], tr: number[]): [string, number][] {
  const rows: [string, number][] = [];
  let prior: { month: number; price: number } | null = null;
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i],
      monthKey = date.slice(0, 7);
    if (dates[i + 1]?.startsWith(monthKey) || !(tr[i] > 0) || !isTradingDay(date)) continue;
    // Reject an incomplete final month and a stale last print in an older month.
    let next = Date.parse(date) + 86400000;
    while (!isTradingDay(new Date(next).toISOString().slice(0, 10))) next += 86400000;
    if (new Date(next).toISOString().startsWith(monthKey)) continue;
    const month = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
    if (prior && month === prior.month + 1) rows.push([monthKey, tr[i] / prior.price - 1]);
    prior = { month, price: tr[i] };
  }
  return rows;
}

const median = (x: number[]) => {
  if (!x.length) return null;
  const s = [...x].sort((a, b) => a - b);
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2;
};

export function seasonalContext(dates: string[], tr: number[], benchmarks: BenchSeries[]) {
  const own = monthEndReturns(dates, tr);
  const comps = benchmarks.map((b) => ({
    symbol: b.sym,
    months: new Map(monthEndReturns(b.d, b.tr)),
  }));
  return Array.from({ length: 12 }, (_, m) => {
    const same = own.filter(([d]) => Number(d.slice(5)) === m + 1);
    return {
      n: same.length,
      median: median(same.map(([, r]) => r)),
      positive: same.length ? same.filter(([, r]) => r > 0).length / same.length : null,
      excess: comps.map((b) => {
        const matched = same.flatMap(([d, r]) => (b.months.has(d) ? [r - b.months.get(d)!] : []));
        return { symbol: b.symbol, n: matched.length, median: median(matched) };
      }),
    };
  });
}
