// Plain-language price read for the company chart. Pure; bars are [date, o, h, l, c, adjClose, vol].
import { rsi, sma } from "@/lib/indicators";

type Bar = [string, number, number, number, number, number, number];

export interface Insight {
  tone: "positive" | "negative" | "neutral";
  title: string;
  detail: string;
}

export interface PerfCell {
  label: string;
  value: number | null;
  vsIndex: number | null;
}

/** Return over the window ending at the last bar; `days` = calendar days back. */
function retSince(bars: Bar[], startDate: string): number | null {
  if (bars.length < 2) return null;
  const i = bars.findIndex((b) => b[0] >= startDate);
  if (i < 0 || i >= bars.length - 1) return null;
  return bars[bars.length - 1][5] / bars[i][5] - 1;
}

const back = (d: string, days: number) => new Date(Date.parse(d) - days * 86_400_000).toISOString().slice(0, 10);

export function performance(bars: Bar[], index: Bar[]): PerfCell[] {
  if (!bars.length) return [];
  const last = bars[bars.length - 1][0];
  const windows: [string, string][] = [
    ["1W", back(last, 7)],
    ["1M", back(last, 30)],
    ["3M", back(last, 91)],
    ["YTD", `${last.slice(0, 4)}-01-01`],
    ["1Y", back(last, 365)],
    ["3Y", back(last, 365 * 3)],
    ["5Y", back(last, 365 * 5)],
  ];
  return windows.map(([label, start]) => {
    const v = bars[0][0] <= start ? retSince(bars, start) : null;
    const ix = index.length && index[0][0] <= start ? retSince(index, start) : null;
    return { label, value: v, vsIndex: v != null && ix != null ? v - ix : null };
  });
}

export interface TechRead {
  insights: Insight[];
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  hi52: number | null;
  lo52: number | null;
  /** 0 = at the 52-week low, 1 = at the high. */
  pos52: number | null;
  volRatio: number | null;
  /** Last golden/death cross of the 50- and 200-day averages within ~2 years. */
  cross: { kind: "golden" | "death"; date: string } | null;
}

export function readTechnicals(bars: Bar[], index: Bar[]): TechRead {
  const empty: TechRead = { insights: [], rsi14: null, sma50: null, sma200: null, hi52: null, lo52: null, pos52: null, volRatio: null, cross: null };
  if (bars.length < 30) return empty;
  const closes = bars.map((b) => b[4]);
  const px = closes[closes.length - 1];
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const r = rsi(closes, 14);
  const yr = bars.slice(-252);
  const hi52 = Math.max(...yr.map((b) => b[2]));
  const lo52 = Math.min(...yr.map((b) => b[3]));
  const last = (xs: (number | null)[]) => xs[xs.length - 1] ?? null;
  const m50 = last(s50);
  const m200 = last(s200);
  const rsi14 = last(r);
  const vol20 = bars.slice(-20).reduce((s, b) => s + b[6], 0) / Math.min(20, bars.length);
  const vol90 = bars.slice(-90).reduce((s, b) => s + b[6], 0) / Math.min(90, bars.length);
  const volRatio = vol90 ? vol20 / vol90 : null;

  let cross: TechRead["cross"] = null;
  for (let i = closes.length - 1; i > Math.max(200, closes.length - 504); i--) {
    const a = s50[i], b = s200[i], pa = s50[i - 1], pb = s200[i - 1];
    if (a == null || b == null || pa == null || pb == null) break;
    if (pa <= pb && a > b) { cross = { kind: "golden", date: bars[i][0] }; break; }
    if (pa >= pb && a < b) { cross = { kind: "death", date: bars[i][0] }; break; }
  }

  const insights: Insight[] = [];
  if (m50 != null && m200 != null) {
    const up = px > m50 && m50 > m200;
    const down = px < m50 && m50 < m200;
    insights.push({
      tone: up ? "positive" : down ? "negative" : "neutral",
      title: up ? "Uptrend" : down ? "Downtrend" : "Mixed trend",
      detail: `Price is ${pct(px / m50 - 1)} vs its 50-day average and ${pct(px / m200 - 1)} vs its 200-day average.`,
    });
  }
  if (cross) {
    insights.push({
      tone: cross.kind === "golden" ? "positive" : "negative",
      title: cross.kind === "golden" ? "Golden cross" : "Death cross",
      detail: `The 50-day average crossed ${cross.kind === "golden" ? "above" : "below"} the 200-day on ${cross.date}.`,
    });
  }
  const pos52 = hi52 > lo52 ? (px - lo52) / (hi52 - lo52) : null;
  if (pos52 != null) {
    insights.push({
      tone: pos52 > 0.9 ? "positive" : pos52 < 0.15 ? "negative" : "neutral",
      title: pos52 > 0.9 ? "Near 52-week high" : pos52 < 0.15 ? "Near 52-week low" : "Mid-range",
      detail: `${pct(px / hi52 - 1)} from the high of ${hi52.toFixed(2)}, ${pct(px / lo52 - 1)} above the low of ${lo52.toFixed(2)}.`,
    });
  }
  if (rsi14 != null) {
    insights.push({
      tone: rsi14 > 70 ? "negative" : rsi14 < 30 ? "positive" : "neutral",
      title: rsi14 > 70 ? "Overbought (RSI)" : rsi14 < 30 ? "Oversold (RSI)" : "Momentum neutral",
      detail: `14-day RSI is ${rsi14.toFixed(0)}${rsi14 > 70 ? ", above the usual 70 stretch line" : rsi14 < 30 ? ", below the usual 30 washout line" : ""}.`,
    });
  }
  const p = performance(bars, index);
  const rs3 = p.find((x) => x.label === "3M")?.vsIndex;
  if (rs3 != null) {
    insights.push({
      tone: rs3 > 0.02 ? "positive" : rs3 < -0.02 ? "negative" : "neutral",
      title: rs3 > 0.02 ? "Beating the S&P 500" : rs3 < -0.02 ? "Lagging the S&P 500" : "In line with the S&P 500",
      detail: `${pct(rs3)} relative to the index over three months.`,
    });
  }
  if (volRatio != null && (volRatio > 1.3 || volRatio < 0.75)) {
    insights.push({
      tone: "neutral",
      title: volRatio > 1.3 ? "Heavy trading" : "Quiet trading",
      detail: `Last 20 days averaged ${(volRatio * 100).toFixed(0)}% of the 90-day volume.`,
    });
  }
  return { insights, rsi14, sma50: m50, sma200: m200, hi52, lo52, pos52, volRatio, cross };
}

function pct(x: number) {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
