import { createHash } from 'node:crypto';
import type { Bar, PriceSeries } from '../../src/lib/financials/types';
import { barProblem } from '../../src/lib/jobs/bar-check';
import { mergeOfficialBars, type OfficialRow } from '../../src/lib/jobs/setups-bars';
import { contextFromBench, type BenchFile } from '../../src/lib/signals/context';
import type { TickerEvents } from '../../src/lib/signals/events';
import { MIN_BARS, scanTicker } from '../../src/lib/signals/scan';

export const sha256 = (contents: string) => createHash('sha256').update(contents).digest('hex');
export type ReplayInputs = TickerEvents & { official: OfficialRow[] };

export function replayCalendar(bench: BenchFile, asOf: string) {
  const dates = bench.dates;
  if (!dates || dates.length < MIN_BARS || dates.at(-1) !== asOf || dates.some((d, i) =>
    !/^\d{4}-\d{2}-\d{2}$/.test(d) || (i > 0 && dates[i - 1] >= d) || !(Number(bench.o.SPY?.[i]) > 0 && Number(bench.c.SPY?.[i]) > 0))) {
    throw new Error(`Benchmark history is incomplete for ${asOf}`);
  }
  return { ctx: contextFromBench(bench), first: dates[0], asOf, officialFrom: dates[dates.length - 45] };
}

/** Only the price/event families are replayable from a single issuer. No live signal is manufactured. */
export function replayHistory(calendar: ReturnType<typeof replayCalendar>, ticker: string, sector: string, file: PriceSeries, inputs: ReplayInputs) {
  const { ctx, asOf, officialFrom } = calendar;
  if (file.symbol !== ticker || file.interval !== '1d' || !Array.isArray(file.bars)) throw new Error(`Wrong daily price file for ${ticker}`);
  if (!inputs.official.some(b => b.date === asOf)) throw new Error(`Missing official closing bar for ${asOf}`);
  for (const bar of inputs.official) {
    if (bar.date > asOf || bar.date < officialFrom || barProblem({ open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close) })) {
      throw new Error(`Invalid official OHLC for ${ticker} on ${bar.date}`);
    }
  }
  if (inputs.earnings.some(d => d > asOf) || inputs.buys.some(b => b.filed > asOf) || inputs.short.some(s => s.date > asOf) || inputs.fails?.some(f => f.end > asOf)) {
    throw new Error('Event snapshot contains observations beyond the cutoff');
  }
  const { bars, corrected } = mergeOfficialBars(file.bars, inputs.official, officialFrom, asOf);
  const sessions = new Set(ctx.dates);
  const dated = bars.filter(b => sessions.has(b[0].slice(0, 10)));
  const observed = dated.filter(b => b[6] > 0);
  if (observed.length < MIN_BARS || observed.at(-1)?.[0].slice(0, 10) !== asOf) throw new Error(`Insufficient observed history (${observed.length} sessions)`);
  for (let i = 0; i < dated.length; i++) {
    const [date, open, high, low, close, adjusted, volume] = dated[i] as Bar;
    if ((i && dated[i - 1][0].slice(0, 10) === date.slice(0, 10)) || !(adjusted > 0) || !Number.isFinite(volume) || volume < 0 || barProblem({ open, high, low, close })) {
      throw new Error(`Invalid daily history for ${ticker} on ${date}`);
    }
  }
  const out = scanTicker(ctx, { ticker, sector, bars: dated, events: inputs });
  if (!out) throw new Error(`Insufficient scan history for ${ticker}`);
  const rows = out.samples.map(s => ({ ticker, variant: s.variant, d: ctx.dates[s.i], net: +s.net.toFixed(6), ex: +s.ex.toFixed(6), gross: +s.gross.toFixed(6) }));
  return { rows, receipt: { asOf, firstSession: dated[0][0].slice(0, 10), observedSessions: observed.length, samples: rows.length,
    filingCutoff: 'next-session-v1', scope: 'single-ticker price, event and confluence strategies', shortVolumeTiming: 'Next session close or later confirmed collection', corrected: corrected.length, sector, officialBars: inputs.official.length, earnings: inputs.earnings.length, insiderBuys: inputs.buys.length,
    shortVolumeDays: inputs.short.length, settlementPeriods: inputs.fails?.length ?? 0, eventsAndOfficialBarsSha256: sha256(JSON.stringify(inputs)) } };
}
