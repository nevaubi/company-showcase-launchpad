import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PriceSeries } from '../financials/types';
import { benchFromBars } from '../signals/context';
import { replayCalendar, replayHistory, type ReplayInputs } from '../../../scripts/lib/setup-replay';

const prices = (path: string): PriceSeries => JSON.parse(readFileSync(path, 'utf8'));
const stock = prices('src/test/fixtures/prices/JPM.json');
const symbols = { SPY: prices('public/data/prices/SPY.json').bars, XLF: prices('public/data/prices/XLF.json').bars };
const cutoff = '2026-10-16';
const calendar = replayCalendar(benchFromBars(symbols, new Map(), cutoff), cutoff);
const official = stock.bars.filter(b => b[0] >= calendar.officialFrom && b[0] <= cutoff).map(([date, open, high, low, close, adj_close, volume]) => ({ date, open, high, low, close, adj_close, volume }));
const inputs: ReplayInputs = { official, earnings: ['2026-01-13'], buys: [], short: [], fails: [] };
const replay = (file = stock, facts = inputs) => replayHistory(calendar, 'JPM', 'Financials', file, facts);

describe('authenticated historical replay', () => {
  it('matches realized returns against subsequent observed opens and closes and ignores later downloaded bars', () => {
    const { rows, receipt } = replay();
    const onlyPast = replay({ ...stock, bars: stock.bars.filter(b => b[0] <= cutoff) });
    expect(onlyPast.rows).toEqual(rows);
    expect(receipt.observedSessions).toBeGreaterThan(2400);
    expect(rows.length).toBeGreaterThan(200);
    const dates = calendar.ctx.dates;
    const price = new Map(stock.bars.map(b => [b[0], b]));
    for (const r of rows) {
      const [, side, hold] = r.variant.split(':');
      const fired = dates.indexOf(r.d), enter = price.get(dates[fired + 1])!, exit = price.get(dates[fired + Number(hold)])!;
      expect(exit[0] <= cutoff && enter[6] > 0 && exit[6] > 0).toBe(true);
      const entry = enter[1] * enter[5] / enter[4];
      expect(r.gross).toBeCloseTo((side === 'L' ? 1 : -1) * (exit[5] / entry - 1), 5);
    }
  });
  it('refuses incomplete or mismatched sources and future evidence', () => {
    expect(() => replay({ ...stock, symbol: 'BAC' })).toThrow(/Wrong/);
    expect(() => replay(stock, { ...inputs, official: official.slice(0, -1) })).toThrow(/official closing/);
    expect(() => replay(stock, { ...inputs, earnings: ['2026-10-19'] })).toThrow(/cutoff/);
    expect(() => replay({ ...stock, bars: stock.bars.slice(-40) })).toThrow(/Insufficient observed/);
    expect(() => replay({ ...stock, bars: [stock.bars[0], ...stock.bars] })).toThrow(/Invalid daily/);
  });
});
