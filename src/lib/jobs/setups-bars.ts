// Joins the partner price file with `market_bars` for the nightly setups scan, with the official bar
// winning. The partner file's newest bar can be a mid-session snapshot (its close and volume are
// partial), so:
//   - every date both sources hold takes the `market_bars` row (open, high, low, close, volume);
//   - dates after the file's end are appended from `market_bars`;
//   - a file bar newer than every official row the window holds is provisional: it is dropped, so it
//     feeds no signal, stop, target, dollar volume or stored series, and the caller reports it.
// Adjusted closes stay on the file's basis: an official row's adjusted close is scaled by the ratio of
// the two sources' adjustment factors (adjusted / close) on the latest date both hold, which does not
// depend on the price level, so a partial bar on that date cannot skew it.
import type { Bar } from "@/lib/financials/types";

export interface OfficialRow {
  date: string;
  updated_at?: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  adj_close: number | string | null;
  volume: number | string | null;
}

export interface MergedBars {
  bars: Bar[];
  /** Date of the partner bar that was dropped because no official bar exists for it yet. */
  provisional: string | null;
  /** Dates where the official bar replaced a partner bar whose close differed. */
  corrected: string[];
  adjustments: { date: string; previous: string; officialStep: number; originalStep: number; vintage: string }[];
}

const num = (x: number | string | null | undefined) => (x == null || x === "" ? NaN : Number(x));
const pos = (x: number) => Number.isFinite(x) && x > 0;

/**
 * @param file   partner price file bars, ascending
 * @param rows   `market_bars` rows for the ticker, any order
 * @param from   first date the `market_bars` read covers (older file bars are not checked)
 * @param asOf   the session being scanned (later bars from either source are ignored)
 */
export function mergeOfficialBars(file: Bar[], rows: OfficialRow[], from: string, asOf: string): MergedBars {
  const official = new Map<string, Bar>();
  const vintages = new Map<string, string>();
  for (const r of rows) {
    const c = num(r.close);
    if (!pos(c) || r.date > asOf) continue;
    const adj = num(r.adj_close);
    if (r.updated_at && pos(adj)) vintages.set(r.date, r.updated_at);
    const o = num(r.open), h = num(r.high), l = num(r.low), v = num(r.volume);
    official.set(r.date, [r.date, pos(o) ? o : 0, pos(h) ? h : c, pos(l) ? l : c, c, pos(adj) ? adj : c, Number.isFinite(v) ? v : 0]);
  }
  const lastOfficial = [...official.keys()].sort().at(-1) ?? "";
  let base = file.filter((b) => b[0].slice(0, 10) <= asOf);
  let provisional: string | null = null;
  const fileLast = base.at(-1)?.[0].slice(0, 10);
  if (fileLast && fileLast >= from && fileLast > lastOfficial) {
    provisional = fileLast;
    base = base.slice(0, -1);
  }
  // Adjustment-factor ratio on the latest date both sources hold.
  let k = 1;
  for (let j = base.length - 1; j >= 0; j--) {
    const b = base[j];
    const m = official.get(b[0].slice(0, 10));
    if (!m) continue;
    if (pos(b[4]) && pos(b[5]) && pos(m[4]) && pos(m[5])) k = b[5] / b[4] / (m[5] / m[4]);
    break;
  }
  const corrected: string[] = [];
  const seen = new Set<string>();
  const out: Bar[] = base.map((b) => {
    const d = b[0].slice(0, 10);
    const m = official.get(d);
    if (!m) return b;
    seen.add(d);
    if (Math.abs(m[4] - b[4]) > 1e-9) corrected.push(d);
    // Same date in both: keep the file's own adjustment factor for that date when it has one.
    const adj = pos(b[4]) && pos(b[5]) ? m[4] * (b[5] / b[4]) : m[5] * k;
    return [b[0], m[1], m[2], m[3], m[4], adj, m[6]];
  });
  // Official sessions the file lacks (after its end, or a gap inside it).
  for (const m of official.values()) if (!seen.has(m[0])) out.push([m[0], m[1], m[2], m[3], m[4], m[5] * k, m[6]]);
  out.sort((x, y) => x[0].slice(0, 10).localeCompare(y[0].slice(0, 10)));
  // The latest downloaded series may omit a recently processed corporate action. Compare adjacent
  // adjusted/raw ratios only inside a single official fetch. Different vintages routinely contain
  // different adjustment bases, even where nothing happened on the market that day.
  const adjustments: MergedBars['adjustments'] = [];
  let scale = 1;
  for (let i = out.length - 1; i >= 0; i--) {
    const bar = out[i], previous = out[i - 1];
    const originalFactor = bar[5] / bar[4];
    if (scale !== 1) out[i] = [bar[0], bar[1], bar[2], bar[3], bar[4], bar[5] * scale, bar[6]];
    if (!previous) break;
    const day = bar[0].slice(0, 10), priorDay = previous[0].slice(0, 10);
    const vintage = vintages.get(day), before = official.get(priorDay), after = official.get(day);
    if (!before || !after || !vintage || vintage !== vintages.get(priorDay) || before[6] <= 0 || after[6] <= 0 ||
        Date.parse(day) - Date.parse(priorDay) > 7 * 86400000) continue;
    const step = (after[5] / after[4]) / (before[5] / before[4]);
    const originalStep = originalFactor / (previous[5] / previous[4]);
    // The source rounds prices to four decimals. Allow that uncertainty on all four inputs.
    const tolerance = Math.max(0.0005, 0.0001 * (1 / before[4] + 1 / before[5] + 1 / after[4] + 1 / after[5]));
    if (!pos(originalStep) || !(step > 1 + tolerance) || Math.abs(step / originalStep - 1) <= tolerance) continue;
    scale *= originalStep / step;
    adjustments.push({ date: day, previous: priorDay, officialStep: step, originalStep, vintage });
  }
  return { bars: out, provisional, corrected, adjustments: adjustments.reverse() };
}
