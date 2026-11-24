// The technical read: five short sentences (trend, momentum, stretch, volatility, volume) and a verdict,
// assembled only from the computed measures and the evidence layer. Every sentence lists the figures it uses
// and carries the table behind them; a sentence is left out when its figures are missing.
import { EVIDENCE, reliableToday, type Evidence } from "./evidence";
import type { Measures } from "./measures";
import { fin } from "./stat";

export interface ReadFigure {
  label: string;
  value: string;
}
export interface ReadTable {
  title: string;
  /** How the figures are computed, in one or two plain sentences */
  formula: string;
  cols: string[];
  rows: string[][];
  note?: string;
}
export interface ReadSentence {
  key: "trend" | "momentum" | "stretch" | "volatility" | "volume" | "verdict";
  label: string;
  text: string;
  /** Direction the data points, for a quiet marker (not a recommendation): 1 up, -1 down, 0 neither */
  tone: 1 | -1 | 0;
  figures: ReadFigure[];
  table: ReadTable;
}

/* ---------- formatting (kept local so the worker bundle stays small) ---------- */
export const fmtPct = (v: number | null | undefined, d = 1, signed = true) =>
  fin(v)
    ? `${v < 0 ? "−" : signed && v > 0 ? "+" : ""}${Math.abs(v * 100).toFixed(d)}%`
    : "–";
export const fmtNum = (v: number | null | undefined, d = 2, signed = false) =>
  fin(v) ? `${v < 0 ? "−" : signed && v > 0 ? "+" : ""}${Math.abs(v).toFixed(d)}` : "–";
export const ordinal = (n: number) => {
  const v = Math.abs(Math.round(n));
  const end = v % 100 >= 11 && v % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][v % 10] ?? "th");
  return `${Math.round(n)}${end}`;
};
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = (iso: string | null | undefined) =>
  iso && iso.length >= 10 ? `${MONTH[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}` : "–";
/** A percentile for prose: whole numbers from 1st to 99th (a rank of 0.2% reads as the 1st, never the 0th). */
export const pctile = (v: number | null | undefined) =>
  fin(v) ? `${ordinal(Math.min(99, Math.max(1, Math.round(v * 100))))} percentile` : "–";
const aboveBelow = (v: number) => (v >= 0 ? "above" : "below");
const abs = (v: number, d = 1) => `${Math.abs(v * 100).toFixed(d)}%`;

export interface ReadContext {
  /** Percentile of the 12-1 month return among covered companies, when the cross-section file is available */
  universe?: { momPct: number; names: number; asOf: string } | null;
}

export function technicalRead(M: Measures, E: Evidence, ctx: ReadContext = {}): ReadSentence[] {
  const out: ReadSentence[] = [];
  const st = M.state;

  /* ---- trend ---- */
  const fit = M.trend.fits.find((f) => f.window === 126) ?? M.trend.fits[0];
  if (fin(st.vs200) && fin(st.vs50) && fit) {
    const arr =
      st.trend === "up"
        ? "the 50-day is above the 200-day: a rising arrangement"
        : st.trend === "down"
          ? "the 50-day is below the 200-day: a falling arrangement"
          : "the averages are not in order";
    const clear = Math.abs(fit.driftT) >= 2;
    const text =
      `The close is ${abs(st.vs200)} ${aboveBelow(st.vs200)} its 200-day average and ${abs(st.vs50)} ${aboveBelow(st.vs50)} its 50-day; ${arr}. ` +
      `The ${fit.window}-session trend line ${fit.slopeAnn >= 0 ? "rises" : "falls"} at ${abs(fit.slopeAnn, 0)} a year (R² ${fmtNum(fit.r2)}); ` +
      (clear
        ? `the drift is statistically clear (t ${fmtNum(fit.driftT, 1, true)}).`
        : `the drift is not distinguishable from zero (t ${fmtNum(fit.driftT, 1, true)}).`);
    out.push({
      key: "trend",
      label: "Trend",
      text,
      tone: clear ? (fit.driftT > 0 ? 1 : -1) : 0,
      figures: [
        { label: "vs 200-day", value: fmtPct(st.vs200) },
        { label: "vs 50-day", value: fmtPct(st.vs50) },
        { label: `${fit.window}-session slope`, value: `${fmtPct(fit.slopeAnn, 0)} a year` },
        { label: "R²", value: fmtNum(fit.r2) },
        { label: "Drift t", value: fmtNum(fit.driftT, 1, true) },
      ],
      table: {
        title: "Trend",
        formula:
          "Averages are simple means of daily closes. The trend line is a least-squares fit to the log of the total-return index; its slope is annualised as exp(252 × slope) − 1 and R² is the share of variation the line explains. A t-statistic on the fitted line would overstate the evidence, because prices wander even without drift, so the drift is tested on daily log returns with a Newey-West standard error.",
        cols: ["Measure", "Value", "Basis"],
        rows: [
          ["Close", fmtNum(M.close), fmtDay(M.asOf)],
          ["50-day average", fmtNum(st.sma50), `close ${fmtPct(st.vs50)} from it`],
          ["200-day average", fmtNum(st.sma200), `close ${fmtPct(st.vs200)} from it`],
          ...M.trend.fits.flatMap((f) => [
            [`Trend line, ${f.window} sessions`, `${fmtPct(f.slopeAnn, 0)} a year`, `R² ${fmtNum(f.r2)}`],
            [`Drift, ${f.window} sessions`, `t ${fmtNum(f.driftT, 2, true)}`, `p ${fmtNum(f.driftP, 3)}`],
            [
              `Efficiency ratio, ${f.window} sessions`,
              fmtNum(f.efficiency),
              `a random walk averages ${fmtNum(f.efficiencyRw)}`,
            ],
          ]),
          ["ADX (14)", fmtNum(st.adx, 1), "Wilder; strength only, not direction"],
        ],
      },
    });
  }

  /* ---- momentum ---- */
  const mo = M.momentum;
  if (fin(mo.mom12_1)) {
    const mkt = mo.vs.find((b) => b.kind === "market" && fin(b.rs252));
    const sec = mo.vs.find((b) => b.kind === "sector" && fin(b.rs252));
    const rel = [mkt, sec]
      .filter((b): b is NonNullable<typeof b> => !!b)
      .map((b) => `${abs(b.rs252!)} ${b.rs252! >= 0 ? "ahead of" : "behind"} ${b.sym}`);
    const text =
      `The 12-1 month return is ${fmtPct(mo.mom12_1)}` +
      (fin(mo.mom6_1) ? ` (6-1 month ${fmtPct(mo.mom6_1)})` : "") +
      (rel.length ? `; over 12 months it is ${rel.join(" and ")}` : "") +
      (ctx.universe
        ? `. The 12-1 figure is at the ${pctile(ctx.universe.momPct)} of ${ctx.universe.names.toLocaleString("en-US")} covered companies.`
        : ".");
    out.push({
      key: "momentum",
      label: "Momentum",
      text,
      tone: mo.mom12_1 > 0 ? 1 : mo.mom12_1 < 0 ? -1 : 0,
      figures: [
        { label: "12-1 month", value: fmtPct(mo.mom12_1) },
        ...(fin(mo.mom6_1) ? [{ label: "6-1 month", value: fmtPct(mo.mom6_1) }] : []),
        ...[mkt, sec]
          .filter((b): b is NonNullable<typeof b> => !!b)
          .map((b) => ({ label: `12 months vs ${b.sym}`, value: fmtPct(b.rs252) })),
        ...(ctx.universe ? [{ label: "Universe", value: pctile(ctx.universe.momPct) }] : []),
      ],
      table: {
        title: "Momentum and relative strength",
        formula:
          "Total returns (dividends reinvested). 12-1 month: from 252 to 21 sessions ago, skipping the latest month, the standard momentum definition; 6-1 month: from 126 to 21 sessions ago. Relative strength: (1 + own return) ÷ (1 + benchmark return) − 1 over the same dates.",
        cols: ["Window", "Return", ...mo.vs.map((b) => `vs ${b.sym}`)],
        rows: [
          ["1 month (21 sessions)", fmtPct(mo.r21), ...mo.vs.map(() => "–")],
          ["3 months (63)", fmtPct(mo.r63), ...mo.vs.map((b) => fmtPct(b.rs63))],
          ["6 months (126)", fmtPct(mo.r126), ...mo.vs.map(() => "–")],
          ["12 months (252)", fmtPct(mo.r252), ...mo.vs.map((b) => fmtPct(b.rs252))],
          ["12-1 month", fmtPct(mo.mom12_1), ...mo.vs.map((b) => fmtPct(b.rsMom))],
          ["6-1 month", fmtPct(mo.mom6_1), ...mo.vs.map(() => "–")],
        ],
        note: ctx.universe
          ? `Universe percentile from the cross-section of ${ctx.universe.names.toLocaleString("en-US")} covered companies as of ${fmtDay(ctx.universe.asOf)}.`
          : undefined,
      },
    });
  }

  /* ---- stretch ---- */
  const sx = M.stretch;
  if (fin(sx.z20) && fin(sx.rsi)) {
    const low = sx.z20 <= -2 || (fin(sx.rsiRank) && sx.rsiRank <= 0.1);
    const high = sx.z20 >= 2 || (fin(sx.rsiRank) && sx.rsiRank >= 0.9);
    const text =
      `The close is ${fmtNum(Math.abs(sx.z20), 1)} standard deviations ${aboveBelow(sx.z20)} its 20-day average; ` +
      `RSI(14) at ${fmtNum(sx.rsi, 0)} is at the ${pctile(sx.rsiRank)} of its own last two years: ` +
      (low ? "stretched to the downside." : high ? "stretched to the upside." : "not stretched.");
    out.push({
      key: "stretch",
      label: "Stretch",
      text,
      tone: 0,
      figures: [
        { label: "20-day z-score", value: fmtNum(sx.z20, 1, true) },
        { label: "RSI (14)", value: fmtNum(sx.rsi, 0) },
        { label: "RSI percentile", value: pctile(sx.rsiRank) },
      ],
      table: {
        title: "Stretch",
        formula:
          "z-score: (close − average of the last N closes) ÷ their standard deviation. RSI is Wilder's 14-day figure; instead of the fixed 30 and 70 lines it is ranked against its own trailing two years (up to 504 sessions), using only data up to each day.",
        cols: ["Measure", "Value", "Reading"],
        rows: [
          ["20-day z-score", fmtNum(sx.z20, 2, true), Math.abs(sx.z20) >= 2 ? "beyond 2 deviations" : "inside 2 deviations"],
          ["50-day z-score", fmtNum(sx.z50, 2, true), fin(sx.z50) ? (Math.abs(sx.z50) >= 2 ? "beyond 2 deviations" : "inside 2 deviations") : "–"],
          ["RSI (14)", fmtNum(sx.rsi, 1), pctile(sx.rsiRank)],
          ["Close in the 52-week range", fmtPct((M.close - st.lo52) / (st.hi52 - st.lo52 || 1), 0, false), `${fmtPct(st.fromHi)} from the high, ${fmtPct(st.fromLo)} from the low`],
        ],
      },
    });
  }

  /* ---- volatility ---- */
  const vo = M.volatility;
  if (fin(vo.rv21) && vo.expected.length === 2) {
    const rank = vo.rank3y ?? vo.rankAll;
    const regime = !fin(rank) ? "" : rank >= 0.8 ? " (high)" : rank <= 0.2 ? " (low)" : "";
    const [w, m] = vo.expected;
    const text =
      `Realised volatility over 21 sessions is ${fmtPct(vo.rv21, 1, false)} a year` +
      (fin(rank) ? `, the ${pctile(rank)} of its ${fin(vo.rank3y) ? "last three years" : "history"}${regime}` : "") +
      `. At that pace one standard deviation is ±${abs(w.pct)} over a week and ±${abs(m.pct)} over a month.`;
    out.push({
      key: "volatility",
      label: "Volatility",
      text,
      tone: 0,
      figures: [
        { label: "21-day volatility", value: fmtPct(vo.rv21, 1, false) },
        ...(fin(rank) ? [{ label: "Percentile", value: pctile(rank) }] : []),
        { label: "1-week move", value: `±${abs(w.pct)}` },
        { label: "1-month move", value: `±${abs(m.pct)}` },
      ],
      table: {
        title: "Volatility",
        formula:
          "Realised volatility: standard deviation of daily log returns × √252. Expected move: daily volatility × √sessions, one standard deviation, assuming volatility stays at its 21-day level; about two outcomes in three fall inside it when that holds. ATR is Wilder's 14-day average true range.",
        cols: ["Measure", "Value", "Basis"],
        rows: [
          ["Realised volatility, 21 sessions", fmtPct(vo.rv21, 1, false), fin(vo.rank3y) ? `${pctile(vo.rank3y)} of the trailing three years` : "–"],
          ["Realised volatility, 63 sessions", fmtPct(vo.rv63, 1, false), "–"],
          ["Percentile in the whole history", pctile(vo.rankAll), `${M.bars.toLocaleString("en-US")} sessions since ${fmtDay(M.first)}`],
          ["ATR (14)", fmtNum(vo.atr), `${fmtPct(vo.atrPct, 1, false)} of the close`],
          ...vo.expected.map((e) => [
            `One standard deviation, ${e.sessions} sessions`,
            `±${abs(e.pct)}`,
            `${fmtNum(e.low)} to ${fmtNum(e.high)}`,
          ]),
        ],
      },
    });
  }

  /* ---- volume ---- */
  const lq = M.liquidity;
  if (lq.hasVolume && fin(lq.relVol) && fin(lq.upVolShare)) {
    const move = mo.r21;
    const lean = lq.upVolShare - 0.5;
    const read =
      Math.abs(lean) < 0.05 || !fin(move)
        ? "volume is balanced between up and down days"
        : Math.sign(lean) === Math.sign(move)
          ? `volume has leaned with the ${move > 0 ? "rise" : "fall"} of ${abs(move)} over the month`
          : `volume has leaned against the ${move > 0 ? "rise" : "fall"} of ${abs(move)} over the month`;
    const text =
      `The last session traded ${fmtNum(lq.relVol)}× the average of the 20 before it; ` +
      `${fmtPct(lq.upVolShare, 0, false)} of the last 20 sessions' volume came on up days: ${read}.`;
    out.push({
      key: "volume",
      label: "Volume",
      text,
      tone: 0,
      figures: [
        { label: "Relative volume", value: `${fmtNum(lq.relVol)}×` },
        { label: "Up-day share", value: fmtPct(lq.upVolShare, 0, false) },
        ...(fin(move) ? [{ label: "1-month return", value: fmtPct(move) }] : []),
      ],
      table: {
        title: "Volume and liquidity",
        formula:
          "Relative volume: last session ÷ the average of the 20 sessions before it. Up-day share: volume on days the close rose ÷ all volume, last 20 sessions. Dollar volume is close × shares traded. Amihud illiquidity is the average of |daily return| ÷ dollar volume over 60 sessions, shown per $1 million traded.",
        cols: ["Measure", "Value", "Basis"],
        rows: [
          ["Relative volume", `${fmtNum(lq.relVol)}×`, "last session ÷ prior 20-session average"],
          ["Up-day share of volume", fmtPct(lq.upVolShare, 0, false), "last 20 sessions"],
          ["Median dollar volume", fmtUsd(lq.dollarVol20), "last 20 sessions"],
          ["Mean dollar volume", fmtUsd(lq.dollarVol60), "last 60 sessions"],
          ["Amihud illiquidity", fin(lq.amihud) ? `${(lq.amihud * 1e4).toFixed(lq.amihud * 1e4 >= 1 ? 1 : 3)} bp per $1M` : "–", "last 60 sessions"],
        ],
      },
    });
  }

  /* ---- verdict ---- */
  const active = E.rows.filter((r) => r.active);
  const today = reliableToday(E);
  const sampleNote = `${E.tested} tests on ${E.sample.bars.toLocaleString("en-US")} sessions since ${fmtDay(E.sample.from)}`;
  if (E.tested > 0 || active.length) {
    let text: string;
    if (today.length) {
      const best = today[0];
      const t = best.cell.test;
      const more = new Set(today.map((x) => x.row.key)).size - 1;
      text =
        `${best.row.name} has been followed by ${fmtPct(t.excess)} ${t.excess > 0 ? "more" : "less"} than its usual ${best.h}-day return ` +
        `(${t.nEff} independent cases, interval ${t.ci ? `${fmtPct(t.ci[0])} to ${fmtPct(t.ci[1])}` : "–"}), and it holds today` +
        (more > 0 ? `; ${more} more condition${more === 1 ? "" : "s"} in force also pass every check.` : ".");
    } else {
      text =
        `No statistically reliable signal today: ${active.length ? `none of the ${active.length} condition${active.length === 1 ? "" : "s"} in force` : "no tested condition is in force that"} ` +
        `has been followed by returns distinguishable from its own base rate (${sampleNote}).`;
    }
    out.push({
      key: "verdict",
      label: "Evidence",
      text,
      tone: today.length ? (today[0].cell.test.excess > 0 ? 1 : -1) : 0,
      figures: today.length
        ? [
            { label: "Excess", value: fmtPct(today[0].cell.test.excess) },
            { label: "Horizon", value: `${today[0].h} days` },
            { label: "Independent cases", value: String(today[0].cell.test.nEff) },
            ...(today[0].cell.test.ci
              ? [{ label: "95% interval", value: `${fmtPct(today[0].cell.test.ci[0])} to ${fmtPct(today[0].cell.test.ci[1])}` }]
              : []),
            { label: "q", value: fmtNum(today[0].cell.q, 3) },
          ]
        : [
            { label: "In force", value: String(active.length) },
            { label: "Tests", value: String(E.tested) },
            { label: "Reliable", value: "0" },
          ],
      table: {
        title: "Conditions in force today",
        formula: `Each condition is tested at ${EVIDENCE.horizons.join(", ")} trading days against its own all-days return. Reliable means: at least ${EVIDENCE.minIndependent} non-overlapping cases, a false-discovery rate of ${EVIDENCE.fdr * 100}% across everything tested (Benjamini-Hochberg), a bootstrap interval that excludes zero, an effect above ${EVIDENCE.cost * 100}% trading cost, the same sign in both halves of the history, and support from the cross-company statistics where they exist.`,
        cols: ["Condition", "Since", ...EVIDENCE.horizons.map((h) => `${h}-day excess`), "Verdict"],
        rows: active.map((r) => [
          r.name,
          r.kind === "state" ? fmtDay(r.atDate) : `${fmtDay(r.atDate)} (${r.sessionsAgo} sessions ago)`,
          ...EVIDENCE.horizons.map((h) => {
            const c = r.cells[h];
            return c ? `${fmtPct(c.test.excess)} (t ${fmtNum(c.test.t, 1, true)})` : "too few";
          }),
          EVIDENCE.horizons.some((h) => r.cells[h]?.verdict === "reliable") ? "reliable" : "context",
        ]),
        note: sampleNote,
      },
    });
  }
  return out;
}

export function fmtUsd(v: number | null | undefined): string {
  if (!fin(v)) return "–";
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
}
