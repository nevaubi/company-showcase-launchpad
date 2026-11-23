// Open price gaps in a bar series, for shading on a price chart. Detection and fill tracking come from ta.js
// (the same library the Technicals page uses), so a gap shaded here is the gap event tested there.
import TA from "./ta";

export type OhlcBar = [string, number, number, number, number, ...unknown[]];

/** Open 2% gaps in a bar series (as the chart's daily bars), for shading on the price chart. */
export function openGaps(bars: OhlcBar[]): { date: string; top: number; bottom: number; dir: 1 | -1 }[] {
  const ok = bars.filter((b) => [b[1], b[2], b[3], b[4]].every((x) => typeof x === "number" && Number.isFinite(x) && x > 0));
  if (ok.length < 3) return [];
  const o = ok.map((b) => b[1]);
  const h = ok.map((b) => b[2]);
  const l = ok.map((b) => b[3]);
  const c = ok.map((b) => b[4]);
  const { events } = TA.detect(o, h, l, c);
  return TA.gapFills(events, h, l)
    .filter((g) => g.filled == null)
    .map((g) => ({
      date: ok[g.i][0].slice(0, 10),
      top: g.top,
      bottom: g.bottom,
      dir: (g.type === "gap_up" ? 1 : -1) as 1 | -1,
    }));
}
