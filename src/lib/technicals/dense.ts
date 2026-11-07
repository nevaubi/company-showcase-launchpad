// Dense technical read for one symbol: the indicator board, gap and level tables, and the event log.
// Everything is derived from ta.js (the same library the signal statistics use), so a value shown here matches
// the value the scorecard and the summary sentences use.
import TA, { type Analysis, type TaEvent } from "./ta";
import type { Hist } from "./data";

type Arr = (number | null)[];

/** ta.js functions that exist in the library but are not in its declaration file. */
interface TAExtra {
  stochastic(
    h: number[],
    l: number[],
    c: number[],
    kN?: number,
    kSmooth?: number,
    dN?: number,
  ): { raw: Arr; k: Arr; d: Arr };
  adx(h: number[], l: number[], c: number[], n?: number): { pdi: Arr; mdi: Arr; dx: Arr; adx: Arr };
  obv(c: number[], v: number[]): Arr;
  mfi(h: number[], l: number[], c: number[], v: number[], n?: number): Arr;
  cmf(h: number[], l: number[], c: number[], v: number[], n?: number): Arr;
  donchian(h: number[], l: number[], n?: number): { upper: Arr; lower: Arr; mid: Arr };
  keltner(
    h: number[],
    l: number[],
    c: number[],
    n?: number,
    mult?: number,
    atrN?: number,
  ): { mid: Arr; upper: Arr; lower: Arr };
  atr(h: number[], l: number[], c: number[], n?: number): Arr;
  detect(
    o: number[],
    h: number[],
    l: number[],
    c: number[],
  ): { events: TaEvent[]; squeeze: boolean[] };
  gapFills(ev: TaEvent[], h: number[], l: number[]): GapRaw[];
}
interface GapRaw extends TaEvent {
  edge: number;
  top: number;
  bottom: number;
  filled: number | null;
}
const X = TA as unknown as typeof TA & TAExtra;

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Last bar where a crossed b (a - b changed sign), with the direction after the cross. */
export function lastCross(a: Arr, b: Arr | number): { i: number; dir: 1 | -1 } | null {
  const at = (k: number) => {
    const x = a[k];
    const y = typeof b === "number" ? b : b[k];
    return fin(x) && fin(y) ? x - y : null;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const now = at(i),
      prev = at(i - 1);
    if (now == null || prev == null) continue;
    if (prev <= 0 && now > 0) return { i, dir: 1 };
    if (prev >= 0 && now < 0) return { i, dir: -1 };
  }
  return null;
}

/** Bars the current sign of x has held (counting back from the last bar). */
export function runLength(x: Arr): number {
  const L = x.length;
  const last = x[L - 1];
  if (!fin(last) || last === 0) return 0;
  let n = 0;
  for (let i = L - 1; i >= 0; i--) {
    const v = x[i];
    if (!fin(v) || Math.sign(v) !== Math.sign(last)) break;
    n++;
  }
  return n;
}

/** Linear-regression slope of the last n values, per bar, as a share of their mean (null if too few). */
export function relSlope(x: Arr, n: number): number | null {
  const pts: [number, number][] = [];
  for (let i = Math.max(0, x.length - n); i < x.length; i++) {
    const v = x[i];
    if (fin(v)) pts.push([i, v]);
  }
  if (pts.length < Math.max(3, n / 2)) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const num = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const den = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (!den) return null;
  const scale = pts.reduce((s, p) => s + Math.abs(p[1]), 0) / pts.length;
  return scale ? num / den / scale : null;
}

export interface BoardRow {
  key: string;
  label: string;
  value: string;
  /** Short plain reading of the value */
  read: string;
  tone?: 1 | -1 | 0;
  /** How it is computed, and the inputs behind it, for the calculation sheet */
  formula: string;
  calc?: { cols: string[]; rows: (string | number)[][] };
}
export interface BoardGroup {
  title: string;
  rows: BoardRow[];
}

const pct = (v: number | null | undefined, d = 1) =>
  fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%` : "–";
const num = (v: number | null | undefined, d = 2) => (fin(v) ? v.toFixed(d) : "–");

/** Last k bars of several series as calculation-sheet rows (newest first). */
function tail(H: Hist, k: number, cols: [string, Arr | number[]][], d = 2) {
  const rows: (string | number)[][] = [];
  for (let i = H.n - 1; i >= Math.max(0, H.n - k); i--)
    rows.push([H.d[i], ...cols.map(([, s]) => (fin(s[i]) ? (s[i] as number).toFixed(d) : "–"))]);
  return { cols: ["Day", ...cols.map(([c]) => c)], rows };
}

/** The indicator board: every indicator the library computes, latest value, a plain read, and its inputs. */
export function indicatorBoard(H: Hist, A: Analysis): BoardGroup[] {
  const { o: _o, h, l, c, v } = H;
  void _o;
  const st = A.state;
  const i = H.n - 1;
  const s20 = TA.sma(c, 20),
    s50 = TA.sma(c, 50),
    s200 = TA.sma(c, 200),
    e21 = TA.ema(c, 21);
  const r = TA.rsi(c, 14);
  const m = TA.macd(c);
  const dmi = X.adx(h, l, c, 14);
  const stc = X.stochastic(h, l, c);
  const atr = X.atr(h, l, c, 14);
  const bb = TA.bollinger(c, 20, 2);
  const kc = X.keltner(h, l, c, 20, 1.5, 20);
  const dc = X.donchian(h, l, 20);
  const sup = TA.supertrend(h, l, c, 10, 3);
  const ob = X.obv(c, v);
  const mf = X.mfi(h, l, c, v, 14);
  const cm = X.cmf(h, l, c, v, 20);
  const v20 = TA.sma(v, 20);
  const hasVol = v.slice(-60).some((x) => x > 0);
  const date = (k: number | undefined) => (k == null ? "–" : H.d[k]);
  const ago = (k: number | undefined) => (k == null ? "" : `${i - k} bars ago`);

  const goldenDeath = lastCross(s50, s200);
  const macdX = lastCross(m.line, m.signal);
  const priceX50 = lastCross(c, s50);
  const priceX200 = lastCross(c, s200);
  const rsiRun = (() => {
    let n = 0;
    const zone = (x: number | null) => (x == null ? 0 : x >= 70 ? 1 : x <= 30 ? -1 : 0);
    const z = zone(r[i]);
    if (!z) return { z, n };
    for (let k = i; k >= 0 && zone(r[k]) === z; k--) n++;
    return { z, n };
  })();
  const stRun = runLength(sup.dir);
  const pdiLead = runLength(
    dmi.pdi.map((x, k) => (fin(x) && fin(dmi.mdi[k]) ? x - (dmi.mdi[k] as number) : null)),
  );
  const range52 = st.hi52 > st.lo52 ? (st.close - st.lo52) / (st.hi52 - st.lo52) : null;
  const dcPos =
    fin(dc.upper[i]) && fin(dc.lower[i]) && dc.upper[i]! > dc.lower[i]!
      ? (c[i] - dc.lower[i]!) / (dc.upper[i]! - dc.lower[i]!)
      : null;
  const relVol = hasVol && fin(v20[i]) && v20[i] ? v[i] / v20[i]! : null;
  const obvSlope = hasVol ? relSlope(ob, 20) : null;
  const smaSlope200 = fin(s200[i]) && fin(s200[i - 20]) ? s200[i]! / s200[i - 20]! - 1 : null;

  const trend: BoardGroup = {
    title: "Trend",
    rows: [
      {
        key: "regime",
        label: "Moving-average stack",
        value: st.trend ?? "–",
        read:
          st.trend === "up"
            ? "Close above the 50-day, 50-day above the 200-day"
            : st.trend === "down"
              ? "Close below the 50-day, 50-day below the 200-day"
              : "Averages not in order: no clean trend",
        tone: st.trend === "up" ? 1 : st.trend === "down" ? -1 : 0,
        formula:
          "Up when close > SMA(50) > SMA(200); down when close < SMA(50) < SMA(200); otherwise mixed.",
        calc: tail(H, 30, [
          ["Close", c],
          ["SMA 20", s20],
          ["SMA 50", s50],
          ["SMA 200", s200],
        ]),
      },
      {
        key: "vs20",
        label: "Close vs 20-day",
        value: pct(fin(s20[i]) ? c[i] / s20[i]! - 1 : null),
        read: fin(s20[i])
          ? c[i] >= s20[i]!
            ? "Above the short-term average"
            : "Below the short-term average"
          : "Too little history",
        tone: fin(s20[i]) ? (c[i] >= s20[i]! ? 1 : -1) : 0,
        formula: "Close ÷ SMA(20) − 1.",
        calc: tail(H, 30, [
          ["Close", c],
          ["SMA 20", s20],
        ]),
      },
      {
        key: "vs50",
        label: "Close vs 50-day",
        value: pct(st.vs50),
        read: priceX50
          ? `Last crossed ${priceX50.dir > 0 ? "above" : "below"} on ${date(priceX50.i)} (${ago(priceX50.i)})`
          : "No cross in the history",
        tone: fin(st.vs50) ? (st.vs50 >= 0 ? 1 : -1) : 0,
        formula:
          "Close ÷ SMA(50) − 1. Cross date: last bar where the close moved from one side of the 50-day to the other.",
        calc: tail(H, 30, [
          ["Close", c],
          ["SMA 50", s50],
        ]),
      },
      {
        key: "vs200",
        label: "Close vs 200-day",
        value: pct(st.vs200),
        read: priceX200
          ? `Last crossed ${priceX200.dir > 0 ? "above" : "below"} on ${date(priceX200.i)} (${ago(priceX200.i)})`
          : "No cross in the history",
        tone: fin(st.vs200) ? (st.vs200 >= 0 ? 1 : -1) : 0,
        formula: "Close ÷ SMA(200) − 1.",
        calc: tail(H, 30, [
          ["Close", c],
          ["SMA 200", s200],
        ]),
      },
      {
        key: "cross",
        label: "50-day vs 200-day",
        value: fin(s50[i]) && fin(s200[i]) ? pct(s50[i]! / s200[i]! - 1) : "–",
        read: goldenDeath
          ? `${goldenDeath.dir > 0 ? "Golden" : "Death"} cross on ${date(goldenDeath.i)} (${ago(goldenDeath.i)})`
          : "No cross in the history",
        tone: goldenDeath ? goldenDeath.dir : 0,
        formula:
          "SMA(50) ÷ SMA(200) − 1. A golden cross is the 50-day moving above the 200-day; a death cross the reverse.",
        calc: tail(H, 30, [
          ["SMA 50", s50],
          ["SMA 200", s200],
        ]),
      },
      {
        key: "slope",
        label: "Average slopes, 20 bars",
        value: `${pct(st.slope50)} / ${pct(smaSlope200)}`,
        read: `50-day ${fin(st.slope50) ? (st.slope50 >= 0 ? "rising" : "falling") : "–"}, 200-day ${fin(smaSlope200) ? (smaSlope200 >= 0 ? "rising" : "falling") : "–"}`,
        tone: fin(st.slope50) ? (st.slope50 >= 0 ? 1 : -1) : 0,
        formula: "SMA today ÷ SMA 20 bars earlier − 1, for the 50-day and the 200-day.",
        calc: tail(H, 25, [
          ["SMA 50", s50],
          ["SMA 200", s200],
        ]),
      },
      {
        key: "ema21",
        label: "Close vs 21-day EMA",
        value: pct(fin(e21[i]) ? c[i] / e21[i]! - 1 : null),
        read: fin(e21[i]) ? (c[i] >= e21[i]! ? "Above" : "Below") : "–",
        tone: fin(e21[i]) ? (c[i] >= e21[i]! ? 1 : -1) : 0,
        formula: "Close ÷ EMA(21) − 1; EMA seeded with the first 21-bar SMA, multiplier 2/22.",
        calc: tail(H, 30, [
          ["Close", c],
          ["EMA 21", e21],
        ]),
      },
      {
        key: "supertrend",
        label: "Supertrend (10, 3)",
        value: st.st == null ? "–" : `${st.st === 1 ? "up" : "down"} · ${num(st.stLine)}`,
        read:
          st.st == null
            ? "–"
            : `${st.st === 1 ? "Up" : "Down"} for ${stRun} bars; line ${pct(fin(st.stLine) ? st.stLine / st.close - 1 : null)} from the close`,
        tone: st.st === 1 ? 1 : st.st === -1 ? -1 : 0,
        formula:
          "Bands at (high+low)/2 ± 3 × ATR(10, Wilder), carried forward; the trend flips when the close crosses the previous bar's band.",
        calc: tail(
          H,
          30,
          [
            ["Close", c],
            ["Line", sup.line],
            ["Direction", sup.dir],
          ],
          2,
        ),
      },
    ],
  };

  const momentum: BoardGroup = {
    title: "Momentum",
    rows: [
      {
        key: "rsi",
        label: "RSI (14)",
        value: num(st.rsi, 1),
        read: rsiRun.z
          ? `${rsiRun.z > 0 ? "Overbought (≥ 70)" : "Oversold (≤ 30)"} for ${rsiRun.n} bars`
          : fin(st.rsi)
            ? st.rsi >= 50
              ? "Above 50: gains outweigh losses over 14 bars"
              : "Below 50: losses outweigh gains over 14 bars"
            : "–",
        tone: fin(st.rsi) ? (st.rsi >= 70 ? -1 : st.rsi <= 30 ? 1 : 0) : 0,
        formula:
          "Wilder RSI: 100 − 100 ÷ (1 + average gain ÷ average loss), both smoothed over 14 bars.",
        calc: tail(
          H,
          30,
          [
            ["Close", c],
            ["RSI", r],
          ],
          2,
        ),
      },
      {
        key: "macd",
        label: "MACD (12, 26, 9)",
        value: `${num(st.macd)} / ${num(st.macdSig)}`,
        read: macdX
          ? `Line ${macdX.dir > 0 ? "above" : "below"} signal since ${date(macdX.i)} (${ago(macdX.i)})`
          : "–",
        tone: macdX ? macdX.dir : 0,
        formula:
          "Line = EMA(12) − EMA(26) of the close; signal = EMA(9) of the line; histogram = line − signal.",
        calc: tail(
          H,
          30,
          [
            ["Line", m.line],
            ["Signal", m.signal],
            ["Histogram", m.hist],
          ],
          3,
        ),
      },
      {
        key: "macdh",
        label: "MACD histogram",
        value: num(st.macdHist, 3),
        read:
          fin(st.macdHist) && fin(m.hist[i - 1])
            ? `${st.macdHist >= 0 ? "Positive" : "Negative"}, ${Math.abs(st.macdHist) >= Math.abs(m.hist[i - 1]!) ? "widening" : "narrowing"} versus the prior bar`
            : "–",
        tone: fin(st.macdHist) ? (st.macdHist >= 0 ? 1 : -1) : 0,
        formula: "MACD line − signal line; widening means the gap grew since the previous bar.",
        calc: tail(H, 30, [["Histogram", m.hist]], 3),
      },
      {
        key: "stoch",
        label: "Stochastic (14, 3, 3)",
        value: `${num(stc.k[i], 0)} / ${num(stc.d[i], 0)}`,
        read: fin(stc.k[i])
          ? stc.k[i]! >= 80
            ? "Near the top of the 14-bar range"
            : stc.k[i]! <= 20
              ? "Near the bottom of the 14-bar range"
              : "Mid-range"
          : "–",
        tone: fin(stc.k[i]) ? (stc.k[i]! >= 80 ? -1 : stc.k[i]! <= 20 ? 1 : 0) : 0,
        formula:
          "%K = SMA(3) of 100 × (close − 14-bar low) ÷ (14-bar high − 14-bar low); %D = SMA(3) of %K.",
        calc: tail(
          H,
          30,
          [
            ["%K", stc.k],
            ["%D", stc.d],
          ],
          1,
        ),
      },
      {
        key: "roc",
        label: "Rate of change",
        value: `${pct(H.tr[i] / H.tr[Math.max(0, i - 21)] - 1)} 1M · ${pct(H.tr[i] / H.tr[Math.max(0, i - 63)] - 1)} 3M`,
        read: `12 months ${pct(H.tr[i] / H.tr[Math.max(0, i - 252)] - 1)}; 12 months ex last month ${pct(H.tr[Math.max(0, i - 21)] / H.tr[Math.max(0, i - 252)] - 1)}`,
        tone: H.tr[i] >= H.tr[Math.max(0, i - 63)] ? 1 : -1,
        formula:
          "Total-return index (dividends reinvested) today ÷ N trading days earlier − 1, for N = 21, 63 and 252; the last figure skips the most recent 21 days (the usual momentum definition).",
        calc: tail(H, 30, [["TR index", H.tr]], 4),
      },
    ],
  };

  const strength: BoardGroup = {
    title: "Trend strength",
    rows: [
      {
        key: "adx",
        label: "ADX (14)",
        value: num(st.adx, 1),
        read: fin(st.adx)
          ? st.adx >= 25
            ? "Trending (≥ 25)"
            : st.adx < 20
              ? "No clear trend (< 20)"
              : "Weak trend (20–25)"
          : "–",
        tone: 0,
        formula:
          "Wilder ADX: 14-bar smoothing of DX = 100 × |+DI − −DI| ÷ (+DI + −DI). Strength only, not direction.",
        calc: tail(
          H,
          30,
          [
            ["ADX", dmi.adx],
            ["+DI", dmi.pdi],
            ["−DI", dmi.mdi],
          ],
          1,
        ),
      },
      {
        key: "di",
        label: "+DI / −DI",
        value: `${num(st.pdi, 1)} / ${num(st.mdi, 1)}`,
        read:
          fin(st.pdi) && fin(st.mdi)
            ? `${st.pdi >= st.mdi ? "Buyers" : "Sellers"} lead, for ${pdiLead} bars`
            : "–",
        tone: fin(st.pdi) && fin(st.mdi) ? (st.pdi >= st.mdi ? 1 : -1) : 0,
        formula:
          "+DI = 100 × smoothed up-move ÷ ATR; −DI = 100 × smoothed down-move ÷ ATR (Wilder, 14 bars).",
        calc: tail(
          H,
          30,
          [
            ["+DI", dmi.pdi],
            ["−DI", dmi.mdi],
          ],
          1,
        ),
      },
      {
        key: "range52",
        label: "52-week range",
        value: range52 == null ? "–" : `${Math.round(range52 * 100)}% of range`,
        read: `High ${num(st.hi52)} on ${date(st.hi52i)} (${pct(st.fromHi)}); low ${num(st.lo52)} on ${date(st.lo52i)} (${pct(st.fromLo)})`,
        tone: range52 == null ? 0 : range52 >= 0.8 ? 1 : range52 <= 0.2 ? -1 : 0,
        formula:
          "(close − 252-bar low) ÷ (252-bar high − 252-bar low), using intraday highs and lows.",
      },
      {
        key: "donchian",
        label: "Donchian (20)",
        value: dcPos == null ? "–" : `${Math.round(dcPos * 100)}% of channel`,
        read: fin(dc.upper[i]) ? `20-bar high ${num(dc.upper[i])}, low ${num(dc.lower[i])}` : "–",
        tone: dcPos == null ? 0 : dcPos >= 0.9 ? 1 : dcPos <= 0.1 ? -1 : 0,
        formula: "Position of the close in the highest high and lowest low of the last 20 bars.",
        calc: tail(H, 30, [
          ["Close", c],
          ["Upper", dc.upper],
          ["Lower", dc.lower],
        ]),
      },
    ],
  };

  const vol: BoardGroup = {
    title: "Volatility",
    rows: [
      {
        key: "atr",
        label: "ATR (14)",
        value: `${num(st.atr)} · ${pct(st.atrPct).replace("+", "")}`,
        read: fin(st.atr)
          ? `A typical day moves about ${num(st.atr)} (${pct(st.atrPct).replace("+", "")} of price)`
          : "–",
        tone: 0,
        formula:
          "Wilder average of the true range (max of high − low, |high − prior close|, |low − prior close|) over 14 bars.",
        calc: tail(H, 30, [
          ["High", h],
          ["Low", l],
          ["Close", c],
          ["ATR", atr],
        ]),
      },
      {
        key: "bbw",
        label: "Bollinger width (20, 2)",
        value: fin(st.bbWidth) ? `${(st.bbWidth * 100).toFixed(1)}%` : "–",
        read: fin(st.bbWidthPct)
          ? `${Math.round(st.bbWidthPct * 100)}th percentile of the last year: ${st.bbWidthPct <= 0.2 ? "narrow" : st.bbWidthPct >= 0.8 ? "wide" : "typical"}`
          : "–",
        tone: 0,
        formula:
          "(upper − lower) ÷ middle band, with bands at SMA(20) ± 2 standard deviations; percentile against the trailing 252 bars.",
        calc: tail(H, 30, [
          ["Close", c],
          ["Upper", bb.upper],
          ["Middle", bb.mid],
          ["Lower", bb.lower],
        ]),
      },
      {
        key: "pctb",
        label: "%B",
        value: num(bb.pctb[i], 2),
        read: fin(bb.pctb[i])
          ? bb.pctb[i]! > 1
            ? "Above the upper band"
            : bb.pctb[i]! < 0
              ? "Below the lower band"
              : "Inside the bands"
          : "–",
        tone: fin(bb.pctb[i]) ? (bb.pctb[i]! > 1 ? -1 : bb.pctb[i]! < 0 ? 1 : 0) : 0,
        formula: "(close − lower band) ÷ (upper band − lower band).",
        calc: tail(H, 30, [["%B", bb.pctb]], 2),
      },
      {
        key: "squeeze",
        label: "Squeeze",
        value: st.squeeze ? `on, ${st.squeeze} bars` : "off",
        read: st.squeeze
          ? "Bollinger bands inside the Keltner channel: range compressed"
          : (() => {
              const lastOn = [...A.squeeze].lastIndexOf(true);
              return lastOn >= 0
                ? `Last on ${H.d[lastOn]} (${i - lastOn} bars ago)`
                : "Not seen in the history";
            })(),
        tone: 0,
        formula: "On while Bollinger(20, 2) sits entirely inside Keltner(EMA 20 ± 1.5 × ATR 20).",
        calc: tail(H, 30, [
          ["BB upper", bb.upper],
          ["KC upper", kc.upper],
          ["BB lower", bb.lower],
          ["KC lower", kc.lower],
        ]),
      },
      {
        key: "keltner",
        label: "Keltner position",
        value:
          fin(kc.upper[i]) && fin(kc.lower[i]) && kc.upper[i]! > kc.lower[i]!
            ? `${Math.round(((c[i] - kc.lower[i]!) / (kc.upper[i]! - kc.lower[i]!)) * 100)}%`
            : "–",
        read: fin(kc.upper[i])
          ? c[i] > kc.upper[i]!
            ? "Above the channel"
            : c[i] < kc.lower[i]!
              ? "Below the channel"
              : "Inside the channel"
          : "–",
        tone: 0,
        formula:
          "Position of the close between EMA(20) − 1.5 × ATR(20) and EMA(20) + 1.5 × ATR(20).",
        calc: tail(H, 30, [
          ["Close", c],
          ["Upper", kc.upper],
          ["Lower", kc.lower],
        ]),
      },
    ],
  };

  const volume: BoardGroup = {
    title: "Volume",
    rows: hasVol
      ? [
          {
            key: "relvol",
            label: "Volume vs 20-day average",
            value: relVol == null ? "–" : `${relVol.toFixed(2)}×`,
            read:
              relVol == null
                ? "–"
                : relVol >= 1.5
                  ? "Heavy session"
                  : relVol <= 0.6
                    ? "Light session"
                    : "Normal session",
            tone: 0,
            formula: "Last session's volume ÷ SMA(20) of volume.",
            calc: tail(
              H,
              30,
              [
                ["Volume", v],
                ["20-day avg", v20],
              ],
              0,
            ),
          },
          {
            key: "obv",
            label: "On-balance volume, 20-bar trend",
            value: obvSlope == null ? "–" : obvSlope >= 0 ? "rising" : "falling",
            read:
              obvSlope == null
                ? "–"
                : `Volume on up days ${obvSlope >= 0 ? "outweighs" : "trails"} volume on down days over the last 20 bars`,
            tone: obvSlope == null ? 0 : obvSlope >= 0 ? 1 : -1,
            formula:
              "OBV adds the day's volume on up closes and subtracts it on down closes; trend is the sign of its 20-bar regression slope.",
            calc: tail(
              H,
              30,
              [
                ["Close", c],
                ["Volume", v],
                ["OBV", ob],
              ],
              0,
            ),
          },
          {
            key: "mfi",
            label: "Money flow index (14)",
            value: num(mf[i], 1),
            read: fin(mf[i])
              ? mf[i]! >= 80
                ? "High (≥ 80)"
                : mf[i]! <= 20
                  ? "Low (≤ 20)"
                  : "Mid-range"
              : "–",
            tone: fin(mf[i]) ? (mf[i]! >= 80 ? -1 : mf[i]! <= 20 ? 1 : 0) : 0,
            formula:
              "RSI-style ratio of 14-bar positive to negative money flow, where money flow = typical price × volume.",
            calc: tail(H, 30, [["MFI", mf]], 1),
          },
          {
            key: "cmf",
            label: "Chaikin money flow (20)",
            value: num(cm[i], 3),
            read: fin(cm[i])
              ? cm[i]! >= 0
                ? "Closes nearer the highs on volume"
                : "Closes nearer the lows on volume"
              : "–",
            tone: fin(cm[i]) ? (cm[i]! >= 0 ? 1 : -1) : 0,
            formula:
              "Sum over 20 bars of ((close − low) − (high − close)) ÷ (high − low) × volume, ÷ total volume.",
            calc: tail(H, 30, [["CMF", cm]], 3),
          },
        ]
      : [],
  };
  return [trend, momentum, strength, vol, volume].filter((g) => g.rows.length);
}

export interface GapRow {
  date: string;
  i: number;
  dir: 1 | -1;
  /** Open versus the prior close */
  size: number;
  top: number;
  bottom: number;
  /** Prior bar's high (up gap) or low (down gap): price must trade back through it to fill */
  edge: number;
  filledDate: string | null;
  barsToFill: number | null;
  /** Close today versus the edge (open gaps only) */
  distance: number | null;
}

/** Every 2% gap in the history, open ones first (newest first), then filled ones newest first. */
export function gapRows(H: Hist, A: Analysis): GapRow[] {
  const close = H.c[H.n - 1];
  const rows = A.gaps.map((g) => {
    const up = g.type === "gap_up";
    return {
      date: H.d[g.i],
      i: g.i,
      dir: (up ? 1 : -1) as 1 | -1,
      size: H.o[g.i] / H.c[g.i - 1] - 1,
      top: g.top,
      bottom: g.bottom,
      edge: g.edge,
      filledDate: g.filled == null ? null : H.d[g.filled],
      barsToFill: g.filled == null ? null : g.filled - g.i,
      distance: g.filled == null ? g.edge / close - 1 : null,
    };
  });
  return rows.sort(
    (a, b) => (a.filledDate == null ? 0 : 1) - (b.filledDate == null ? 0 : 1) || b.i - a.i,
  );
}

export interface GapStats {
  total: number;
  open: number;
  up: number;
  down: number;
  filledShare: number | null;
  medianBarsToFill: number | null;
  filledWithin5: number | null;
}
export function gapStats(rows: GapRow[]): GapStats {
  const filled = rows
    .filter((r) => r.barsToFill != null)
    .map((r) => r.barsToFill!)
    .sort((a, b) => a - b);
  return {
    total: rows.length,
    open: rows.filter((r) => r.filledDate == null).length,
    up: rows.filter((r) => r.dir > 0).length,
    down: rows.filter((r) => r.dir < 0).length,
    filledShare: rows.length ? filled.length / rows.length : null,
    medianBarsToFill: filled.length ? filled[Math.floor((filled.length - 1) / 2)] : null,
    filledWithin5: rows.length ? filled.filter((b) => b <= 5).length / rows.length : null,
  };
}

export interface LevelRow {
  price: number;
  kind: "support" | "resistance";
  touches: number;
  highs: number;
  lows: number;
  first: string;
  last: string;
  distance: number;
  /** Bars since the last touch */
  age: number;
}
export function levelRows(H: Hist, A: Analysis): LevelRow[] {
  return [...A.levels]
    .sort((a, b) => b.price - a.price)
    .map((L) => ({
      price: L.price,
      kind: L.kind,
      touches: L.touches,
      highs: L.highs,
      lows: L.lows,
      first: H.d[L.first],
      last: H.d[L.last],
      distance: L.distance,
      age: H.n - 1 - L.last,
    }));
}

export interface TrendLineRow {
  side: "support" | "resistance";
  from: string;
  to: string;
  p1: number;
  p2: number;
  /** Price change per bar, as a share of the start price */
  slopePct: number;
  touches: number;
  now: number;
  distance: number;
}
export function trendLineRows(H: Hist, A: Analysis): TrendLineRow[] {
  const close = H.c[H.n - 1];
  const lines = (Array.isArray(A.trend) ? A.trend : []) as {
    side: "support" | "resistance";
    i1: number;
    i2: number;
    p1: number;
    p2: number;
    slope: number;
    touches: number;
    now: number;
  }[];
  return lines.map((t) => ({
    side: t.side,
    from: H.d[t.i1],
    to: H.d[t.i2],
    p1: t.p1,
    p2: t.p2,
    slopePct: t.slope / t.p1,
    touches: t.touches,
    now: t.now,
    distance: t.now / close - 1,
  }));
}

export interface EventRow {
  date: string;
  i: number;
  type: string;
  name: string;
  dir: 1 | -1;
  close: number;
  /** Forward total return by horizon; null while pending */
  fwd: Record<number, number | null>;
}

/** Every detected event, newest first, with what the total-return index did over each horizon afterwards. */
export function eventRows(H: Hist, A: Analysis, horizons = [5, 20, 60]): EventRow[] {
  return [...A.events]
    .sort((a, b) => b.i - a.i)
    .map((e) => {
      const sg = TA.SIGNALS[e.type];
      const fwd: Record<number, number | null> = {};
      for (const h of horizons) fwd[h] = e.i + h < H.n ? H.tr[e.i + h] / H.tr[e.i] - 1 : null;
      return {
        date: H.d[e.i],
        i: e.i,
        type: e.type,
        name: sg?.name ?? e.type,
        dir: (sg?.dir ?? 1) as 1 | -1,
        close: H.c[e.i],
        fwd,
      };
    });
}

export type OhlcBar = [string, number, number, number, number, ...unknown[]];

/** Open 2% gaps in a bar series (as the chart's daily bars), for shading on the price chart. */
export function openGaps(
  bars: OhlcBar[],
): { date: string; top: number; bottom: number; dir: 1 | -1 }[] {
  const ok = bars.filter((b) =>
    [b[1], b[2], b[3], b[4]].every((x) => typeof x === "number" && Number.isFinite(x) && x > 0),
  );
  if (ok.length < 3) return [];
  const o = ok.map((b) => b[1]),
    h = ok.map((b) => b[2]),
    l = ok.map((b) => b[3]),
    c = ok.map((b) => b[4]);
  const { events } = X.detect(o, h, l, c);
  return X.gapFills(events, h, l)
    .filter((g) => g.filled == null)
    .map((g) => ({
      date: ok[g.i][0].slice(0, 10),
      top: g.top,
      bottom: g.bottom,
      dir: (g.type === "gap_up" ? 1 : -1) as 1 | -1,
    }));
}
