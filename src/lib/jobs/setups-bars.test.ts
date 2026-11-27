import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/financials/types";
import { align, features } from "@/lib/signals/features";
import { riskPlan } from "@/lib/signals/setups";
import { mergeOfficialBars, type OfficialRow } from "./setups-bars";

// 260 weekday sessions ending on 2026-11-20 (holidays do not matter for the merge).
const dates: string[] = (() => {
  const out: string[] = [];
  const t = new Date("2026-11-20T12:00:00Z");
  while (out.length < 260) {
    if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) out.unshift(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() - 1);
  }
  return out;
})();
const LAST = dates.at(-1)!;
const PREV = dates.at(-2)!;
const FROM = dates[dates.length - 46];

const close = (i: number) => 100 + 10 * Math.sin(i / 9) + i * 0.05;
// Partner file: adjusted closes 2% below closes (a dividend after the bars), one million shares a day.
const fileBar = (i: number): Bar => [dates[i], close(i) - 0.3, close(i) + 1, close(i) - 1, close(i), close(i) * 0.98, 1_000_000];
const officialRow = (i: number, over: Partial<OfficialRow> = {}): OfficialRow => ({
  date: dates[i], open: close(i) - 0.3, high: close(i) + 1, low: close(i) - 1, close: close(i), adj_close: close(i), volume: 1_000_000, ...over,
});
const windowRows = (n = dates.length) => dates.slice(0, n).map((_, i) => i).filter((i) => dates[i] >= FROM);

const n = dates.length;
const L = n - 1;
const fullFile = () => dates.map((_, i) => fileBar(i));
// The official close for the last session: 8% above the partner snapshot, with full-day volume.
const OFFICIAL_LAST = close(L) * 1.08;
// Partner snapshot of the last session: mid-session price, a third of the day's volume.
const intradayFile = () => [...fullFile().slice(0, -1), [LAST, close(L) - 0.3, close(L) + 0.5, close(L) - 1, close(L), close(L) * 0.98, 330_000] as Bar];
const officialWithLast = () => windowRows().map((i) => (i === L ? officialRow(i, { close: OFFICIAL_LAST, high: OFFICIAL_LAST + 0.5, adj_close: OFFICIAL_LAST, volume: 1_000_000 }) : officialRow(i)));

const plan = (bars: Bar[]) => {
  const a = align(dates, bars);
  const f = features(a, new Float64Array(n).fill(1).map((_, i) => 400 + i));
  return { c: a.c[L], v: a.v[L], dv20: f.dv20[L], atr: f.atr14[L], r5: a.c[L] / a.c[L - 5] - 1, risk: riskPlan("momentum", 1, a.c[L], f.atr14[L]), series: Array.from(a.c) };
};

describe('corporate-action adjustments', () => {
  const vintage = '2026-11-26T18:48:02.881Z';
  const dates = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'];
  const series: Bar[] = dates.map(d => [d,100,101,99,100,100,1000000]);
  const quotes: OfficialRow[] = dates.map((date,i) => ({date,open:100,high:101,low:99,close:100,
    adj_close:i===3?100:99,volume:1000000,updated_at:vintage}));
  it('recovers a missing adjustment from a single official fetch, preserving current price and prior relative returns', () => {
    const result = mergeOfficialBars(series, quotes, dates[0], dates[3]);
    expect(result.adjustments.map(a=>a.date)).toEqual([dates[3]]);
    expect(result.bars.map(b=>b[5])).toEqual([99,99,99,100]);
    const incoming = result.bars.map(b=>[...b] as Bar);
    expect(mergeOfficialBars(incoming,quotes,dates[0],dates[3]).adjustments).toEqual([]);
    expect(series.map(b=>b[5])).toEqual([100,100,100,100]);
  });
  it('refuses a change across different official snapshots or below raw price precision', () => {
    const mixed=quotes.map((b,i)=>i===3?{...b,updated_at:'other batch'}:b);
    expect(mergeOfficialBars(series,mixed,dates[0],dates[3]).adjustments).toEqual([]);
    const rounded=quotes.map((b,i)=>({...b,close:0.1,adj_close:i===3?0.1:0.0999}));
    expect(mergeOfficialBars(series,rounded,dates[0],dates[3]).adjustments).toEqual([]);
  });
});

describe("mergeOfficialBars", () => {
  it("replaces an intraday partner bar with the official bar everywhere the scan uses it", () => {
    const m = mergeOfficialBars(intradayFile(), officialWithLast(), FROM, LAST);
    expect(m.provisional).toBeNull();
    expect(m.corrected).toEqual([LAST]);
    expect(m.bars).toHaveLength(n);
    const last = m.bars.at(-1)!;
    expect(last[4]).toBeCloseTo(OFFICIAL_LAST, 9);
    expect(last[6]).toBe(1_000_000);
    // Adjusted close stays on the partner file's basis (factor 0.98).
    expect(last[5]).toBeCloseTo(OFFICIAL_LAST * 0.98, 9);

    const got = plan(m.bars);
    // Same result as a history that held the official bar from the start.
    const truth = plan([...fullFile().slice(0, -1), [LAST, close(L) - 0.3, OFFICIAL_LAST + 0.5, close(L) - 1, OFFICIAL_LAST, OFFICIAL_LAST * 0.98, 1_000_000]]);
    expect(got.c).toBeCloseTo(truth.c, 9); // stored series close, signal price
    expect(got.series.at(-1)).toBeCloseTo(OFFICIAL_LAST * 0.98, 9);
    expect(got.dv20).toBeCloseTo(truth.dv20, 6); // dollar volume uses full-day volume
    expect(got.atr).toBeCloseTo(truth.atr, 9);
    expect(got.r5).toBeCloseTo(truth.r5, 12);
    expect(got.risk).toEqual(truth.risk); // stop and target

    // The unmerged join (file wins) would have kept the snapshot: the test is not vacuous.
    const bad = plan(intradayFile());
    expect(Math.abs(bad.c / got.c - 1)).toBeGreaterThan(0.05);
    expect(bad.dv20).toBeLessThan(got.dv20);
  });

  it("drops a partner bar that has no official bar yet and reports it", () => {
    const rows = officialWithLast().filter((r) => r.date !== LAST);
    const m = mergeOfficialBars(intradayFile(), rows, FROM, LAST);
    expect(m.provisional).toBe(LAST);
    expect(m.bars.at(-1)![0]).toBe(PREV); // the series ends at the last official session
    expect(m.bars.some((b) => b[0] === LAST)).toBe(false);
    expect(m.bars).toHaveLength(n - 1);
  });

  it("keeps a file bar older than the official window without flagging it", () => {
    const old = fullFile().slice(0, 100);
    const m = mergeOfficialBars(old, [], FROM, LAST);
    expect(m.provisional).toBeNull();
    expect(m.bars).toEqual(old);
  });

  it("changes nothing when the two sources agree", () => {
    const file = fullFile();
    const rows = windowRows().map((i) => officialRow(i));
    const m = mergeOfficialBars(file, rows, FROM, LAST);
    expect(m.provisional).toBeNull();
    expect(m.corrected).toEqual([]);
    expect(m.bars).toHaveLength(n);
    m.bars.forEach((b, i) => {
      expect(b[0]).toBe(file[i][0]);
      for (let j = 1; j <= 6; j++) expect(b[j] as number).toBeCloseTo(file[i][j] as number, 9);
    });
  });

  it("appends official sessions after the file's end on the file's adjusted basis", () => {
    const file = fullFile().slice(0, -2);
    const rows = windowRows().map((i) => officialRow(i));
    const m = mergeOfficialBars(file, rows, FROM, LAST);
    expect(m.provisional).toBeNull();
    expect(m.bars.map((b) => b[0]).slice(-2)).toEqual([PREV, LAST]);
    expect(m.bars.at(-1)![5]).toBeCloseTo(close(L) * 0.98, 9);
  });

  it("ignores bars after the session being scanned", () => {
    const file = fullFile();
    const rows = windowRows().map((i) => officialRow(i));
    const m = mergeOfficialBars(file, rows, FROM, PREV);
    expect(m.bars.at(-1)![0]).toBe(PREV);
    expect(m.provisional).toBeNull();
  });
});
