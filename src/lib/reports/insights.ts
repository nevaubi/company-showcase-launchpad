// Cross-analysis, peer comparison and chart builder for library reports. Pure. Every computed
// insight becomes a fact (with the formula and the facts it was built from) so the writer can cite
// it and every plotted value opens its source; nothing here calls the network.
import type { Bar, CompanyDataset, DerivedPart, SegmentFact, SourceRef } from "@/lib/financials/types";
import type { PeriodCode, RatingMonth } from "@/lib/estimates/core";
import { isBankIndustry } from "@/lib/financials/dataset";
import { multipleStats, valuationHistory, type MultipleKey } from "@/lib/financials/valuation";
import type { Pack } from "./facts";
import { coverageOf } from "@/lib/coverage";
import { money, mult, perShare, pct, pp } from "./fmt";
import {
  METRIC_DEF, cellAt, daysBefore, fmtMetric, lastQuarter, median, ols, ordinal, partsOf, peerSnapshot, quantile, rankOf, sum4, totalReturn, weeklyCloses, withLivePrice,
  type PeerMetricKey, type PeerSnapshot,
} from "./peers";
import type { ChartPoint, ChartSeries, ChartUnit, FactRef, GlanceItem, ReportChart, ReportInputs, ReportTable, TableCell } from "./types";

export interface EstimateIds {
  revisions: Map<PeriodCode, string | null>;
  consensus: Map<PeriodCode, string | null>;
  surprises: { quarter: string; actual: number; estimate: number; surprisePct: number | null; id: string | null }[];
  ratings: { period: string; label: string; row: RatingMonth; id: string | null }[];
  target: string | null;
  nextEarnings: string | null;
}

type Ids = Map<string, (string | null)[]>;
export interface InsightCtx {
  p: Pack;
  inp: ReportInputs;
  d: CompanyDataset;
  annual: { idx: number[]; ids: Ids; growth: Ids; margin: Ids };
  quarterly: { idx: number[]; ids: Ids; yoy: Ids; margin: Ids };
  ttm: {
    revenue: { v: number; ref: FactRef } | null; netIncome: { v: number; ref: FactRef } | null;
    fcf: { v: number; ref: FactRef } | null; eps: { v: number; ref: FactRef } | null;
    ids: { revenue: string | null; netIncome: string | null; eps: string | null; fcf: string | null };
  };
  latestQ: string | null;
  val: { price?: string | null; mcap?: string | null; ev?: string | null; pe?: string | null; evSales?: string | null; fcfYield?: string | null; divYield?: string | null };
  est: EstimateIds;
  reactions: { date: string; id: string | null }[];
}

export interface Insights { charts: ReportChart[]; tables: ReportTable[]; glance: GlanceItem[]; peers: { ticker: string; name: string }[] }

const composite = (label: string, formula: string, members: (string | null | undefined)[]): FactRef | null => {
  const m = [...new Set(members.filter((x): x is string => !!x))];
  return m.length ? { kind: "composite", label, formula, members: m } : null;
};
const derived = (formula: string, parts: DerivedPart[], label = formula, market?: { label: string; value: number; asOf: string }[]): FactRef =>
  ({ kind: "derived", formula, parts, label, ...(market ? { market } : {}) });
/** Display name: the curated short name when known, else the SEC registrant name tidied up. */
const nameOf = (ticker: string, sec: string) => coverageOf(ticker)?.shortName ?? shortName(sec);
const shortName = (n: string) => n.replace(/,?\s+(Inc\.?|Corporation|Corp\.?|Company|Co\.?|plc|Ltd\.?|Holdings?|Incorporated|N\.V\.|S\.A\.)$/i, "").replace(/^The /, "");

export function buildInsights(c: InsightCtx): Insights {
  const { p, inp, d } = c;
  const t = d.profile.ticker;
  const charts: ReportChart[] = [];
  const tables: ReportTable[] = [];
  const pt = (id: string | null | undefined): ChartPoint => ({ v: p.value(id), f: id ?? undefined });
  const A = d.statements.annual, Q = d.statements.quarterly;
  const aCols = c.annual.idx.map((i) => `FY${A.income.periods[i].fy}`);
  const qCols = c.quarterly.idx.map((i) => { const per = Q.income.periods[i]; return per.fq ? `Q${per.fq} FY${String(per.fy).slice(2)}` : `FY${per.fy}`; });
  const has = (s: ChartSeries[]) => s.filter((x) => x.points.filter((q) => q.v != null).length >= 2);

  // ---------- reported trends ----------
  const series = (name: string, kind: ChartSeries["kind"], unit: ChartUnit, ids: (string | null)[] | undefined, extra: Partial<ChartSeries> = {}): ChartSeries =>
    ({ name, kind, unit, points: (ids ?? []).map(pt), ...extra });
  {
    const s = has([series("Revenue", "bar", "usd", c.annual.ids.get("revenue"), { tone: "self" }), series("Growth", "line", "pct", c.annual.growth.get("revenue"), { axis: "right" })]);
    if (s.length) charts.push({ id: "revenue-annual", type: "combo", title: "Revenue and growth", subtitle: "Fiscal years, reported", x: aCols, series: s, size: "half" });
    const q = has([series("Revenue", "bar", "usd", c.quarterly.ids.get("revenue"), { tone: "self" }), series("YoY growth", "line", "pct", c.quarterly.yoy.get("revenue"), { axis: "right" })]);
    if (q.length) charts.push({ id: "revenue-quarterly", type: "combo", title: "Quarterly revenue and year-over-year growth", subtitle: "Last eight fiscal quarters", x: qCols, series: q, size: "half" });
    const m = has([
      series("Gross margin", "line", "pct", c.annual.margin.get("grossProfit")),
      series("Operating margin", "line", "pct", c.annual.margin.get("operatingIncome"), { tone: "self" }),
      series("Net margin", "line", "pct", c.annual.margin.get("netIncome")),
      series("FCF margin", "dash", "pct", c.annual.margin.get("fcf")),
    ]);
    if (m.length) charts.push({ id: "margins-annual", type: "combo", title: "Margin trajectory", subtitle: "Fiscal years, % of revenue", x: aCols, series: m, size: "half" });
    const mq = has([
      series("Gross margin", "line", "pct", c.quarterly.margin.get("grossProfit")),
      series("Operating margin", "line", "pct", c.quarterly.margin.get("operatingIncome"), { tone: "self" }),
    ]);
    if (mq.length) charts.push({ id: "margins-quarterly", type: "combo", title: "Quarterly margins", subtitle: "% of revenue", x: qCols, series: mq, size: "half" });
    const cf = has([
      series("Operating cash flow", "bar", "usd", c.annual.ids.get("cfo")),
      series("Capex", "bar", "usd", c.annual.ids.get("capex")),
      series("Free cash flow", "line", "usd", c.annual.ids.get("fcf"), { tone: "self" }),
    ]);
    if (cf.length >= 2) charts.push({ id: "cash-flow", type: "combo", title: "Cash generation and reinvestment", subtitle: "Fiscal years", x: aCols, series: cf, size: "half" });
    const cr = has([
      series("Buybacks", "bar", "usd", c.annual.ids.get("buybacks")),
      series("Dividends", "bar", "usd", c.annual.ids.get("dividends")),
    ]);
    const fcfLine = series("Free cash flow", "dash", "usd", c.annual.ids.get("fcf"), { tone: "self" });
    // Only worth a chart when the company returns cash in most of the years shown.
    const years = c.annual.idx.filter((_, k) => cr.reduce((sum, x) => sum + Math.max(0, x.points[k]?.v ?? 0), 0) > 0).length;
    if (cr.length && years >= 3) charts.push({ id: "capital-returns", type: "stacked", title: "Capital returned versus free cash flow", subtitle: "Fiscal years", x: aCols, series: [...cr, ...(fcfLine.points.some((x) => x.v != null) ? [fcfLine] : [])], size: "half" });
  }

  // ---------- operating analysis (TTM vs prior TTM) ----------
  const last = lastQuarter(Q.income);
  const qEnd = last >= 0 ? Q.income.periods[last]?.end : null;
  const thru = qEnd ? `the four quarters through ${qEnd}` : "the last four quarters";
  const rev = sum4(Q.income, "revenue", last), revP = sum4(Q.income, "revenue", last - 4);
  const fin = isBankIndustry(d.profile.industry) || /insurance|capital markets|financial services|investment banking/i.test(d.profile.industry);
  if (rev && revP && rev.v > 0 && revP.v > 0 && !fin) {
    const bridge: { label: string; v: number; f: string | null }[] = [];
    const ratioOf = (key: string, at: number, base: { v: number }) => { const s = sum4(Q.income, key, at); return s ? { r: s.v / base.v, s } : null; };
    const op = ratioOf("operatingIncome", last, rev), opP = ratioOf("operatingIncome", last - 4, revP);
    if (op && opP) {
      const dOp = op.r - opP.r;
      const totId = p.add("analysis", `TTM operating margin moved from ${pct(opP.r)} to ${pct(op.r)} (${pp(dOp)}) in ${thru} versus the prior four quarters.`,
        derived("TTM operating income ÷ TTM revenue, now vs one year earlier", [...op.s.parts, ...opP.s.parts, ...rev.parts, ...revP.parts], "Operating margin change"), { v: dOp });
      let explained = 0;
      const gm = ratioOf("grossProfit", last, rev), gmP = ratioOf("grossProfit", last - 4, revP);
      if (gm && gmP) {
        const dg = gm.r - gmP.r;
        explained += dg;
        bridge.push({ label: "Gross margin", v: dg, f: p.add("analysis", `Gross margin contributed ${pp(dg)} to the TTM operating-margin change (${pct(gm.r)} versus ${pct(gmP.r)} a year earlier).`,
          derived("Change in TTM gross profit ÷ TTM revenue", [...gm.s.parts, ...gmP.s.parts, ...rev.parts, ...revP.parts], "Gross margin change"), { v: dg }) });
      }
      for (const [key, label] of [["rnd", "R&D"], ["salesMarketing", "Sales & marketing"], ["generalAdmin", "General & administrative"]] as const) {
        const x = ratioOf(key, last, rev), xP = ratioOf(key, last - 4, revP);
        if (!x || !xP) continue;
        const contrib = -(x.r - xP.r);
        explained += contrib;
        bridge.push({ label, v: contrib, f: p.add("analysis", `${label} expense ran at ${pct(x.r)} of TTM revenue versus ${pct(xP.r)} a year earlier, contributing ${pp(contrib)} to operating margin.`,
          derived(`Change in TTM ${label} ÷ TTM revenue (sign flipped: higher spend lowers margin)`, [...x.s.parts, ...xP.s.parts, ...rev.parts, ...revP.parts], `${label} intensity`), { v: contrib }) });
      }
      if (bridge.length) {
        const other = dOp - explained;
        if (Math.abs(other) >= 0.0005) bridge.push({ label: "Other operating items", v: other, f: totId });
        bridge.push({ label: "Operating margin change", v: dOp, f: totId });
        charts.push({ id: "margin-bridge", type: "hbar", title: "Operating margin bridge", subtitle: `TTM through ${qEnd}, vs a year earlier`, unit: "pp", signed: true,
          rows: bridge.map((b) => ({ label: b.label, v: b.v, f: b.f ?? undefined, self: b.label === "Operating margin change" })), size: "half" });
      }
      const dRev = rev.v - revP.v;
      if (dRev > 0) {
        const inc = (op.s.v - opP.s.v) / dRev;
        p.add("analysis", `Incremental operating margin over ${thru}: ${pct(inc)} (change in TTM operating income ${money(op.s.v - opP.s.v)} on ${money(dRev)} of added revenue).`,
          derived("(TTM operating income − prior TTM) ÷ (TTM revenue − prior TTM)", [...op.s.parts, ...opP.s.parts, ...rev.parts, ...revP.parts], "Incremental operating margin"), { v: inc });
      }
    }
    const fcf = sum4(Q.cashflow, "fcf", last), ni = sum4(Q.income, "netIncome", last);
    if (fcf && ni && ni.v > 0) p.add("analysis", `Cash conversion over ${thru}: free cash flow was ${(fcf.v / ni.v).toFixed(2)}x net income (${money(fcf.v)} vs ${money(ni.v)}).`,
      derived("TTM free cash flow ÷ TTM net income", [...fcf.parts, ...ni.parts], "Cash conversion"), { v: fcf.v / ni.v });
    const cx = sum4(Q.cashflow, "capex", last), cx3 = sum4(Q.cashflow, "capex", last - 12), rev3 = sum4(Q.income, "revenue", last - 12);
    if (cx && cx3 && rev3 && rev3.v > 0) p.add("analysis", `Capital intensity: capex was ${pct(cx.v / rev.v)} of revenue over ${thru}, versus ${pct(cx3.v / rev3.v)} in the same four quarters three years earlier.`,
      derived("TTM capex ÷ TTM revenue, now vs three years earlier", [...cx.parts, ...rev.parts, ...cx3.parts, ...rev3.parts], "Capex intensity"), { v: cx.v / rev.v });
    const sbc = sum4(Q.cashflow, "sbc", last);
    if (sbc && fcf && fcf.v > 0) p.add("analysis", `Stock-based compensation equalled ${pct(sbc.v / fcf.v)} of free cash flow over ${thru} (${money(sbc.v)}).`,
      derived("TTM stock-based compensation ÷ TTM free cash flow", [...sbc.parts, ...fcf.parts], "SBC vs FCF"), { v: sbc.v / fcf.v });
    const bb = sum4(Q.cashflow, "buybacks", last), dv = sum4(Q.cashflow, "dividends", last);
    if (fcf && fcf.v > 0 && (bb || dv)) {
      const ret = (bb?.v ?? 0) + (dv?.v ?? 0);
      p.add("analysis", `Shareholder payout over ${thru}: buybacks and dividends of ${money(ret)} were ${pct(ret / fcf.v)} of free cash flow.`,
        derived("(TTM buybacks + dividends) ÷ TTM free cash flow", [...(bb?.parts ?? []), ...(dv?.parts ?? []), ...fcf.parts], "FCF payout"), { v: ret / fcf.v });
    }
    const oi = sum4(Q.income, "operatingIncome", last), ie = sum4(Q.income, "interestExpense", last);
    if (oi && ie && ie.v > 0 && oi.v > 0) p.add("analysis", `Interest coverage over ${thru}: operating income was ${mult(oi.v / ie.v)} interest expense.`,
      derived("TTM operating income ÷ TTM interest expense", [...oi.parts, ...ie.parts], "Interest coverage"), { v: oi.v / ie.v });
  }
  // dilution: diluted shares vs the same quarter a year earlier
  {
    const sh = cellAt(Q.income, "sharesDiluted", last), shP = cellAt(Q.income, "sharesDiluted", last - 4);
    if (sh && shP && shP.v > 0) {
      const g = sh.v / shP.v - 1;
      p.add("analysis", `Diluted share count changed ${pct(g, true)} year over year (${(sh.v / 1e6).toFixed(0)}M in ${Q.income.periods[last].label} vs ${(shP.v / 1e6).toFixed(0)}M in ${Q.income.periods[last - 4].label}).`,
        derived("Diluted shares ÷ diluted shares a year earlier − 1", [...partsOf(sh, Q.income.periods[last].label), ...partsOf(shP, Q.income.periods[last - 4].label)], "Share count change"), { v: g });
    }
  }
  // seasonality: share of fiscal-year revenue by fiscal quarter
  {
    const fys = A.income.periods.map((x, i) => ({ fy: x.fy, i })).slice(-3);
    const shares: number[][] = [[], [], [], []];
    const parts: DerivedPart[] = [];
    for (const { fy, i } of fys) {
      const tot = cellAt(A.income, "revenue", i);
      if (!tot || tot.v <= 0) continue;
      const qs = [1, 2, 3, 4].map((fq) => { const j = Q.income.periods.findIndex((x) => x.fy === fy && x.fq === fq); return j >= 0 ? cellAt(Q.income, "revenue", j) : null; });
      if (qs.some((x) => !x)) continue;
      qs.forEach((x, k) => { shares[k].push(x!.v / tot.v); parts.push(...partsOf(x!, `Q${k + 1} FY${fy}`)); });
      parts.push(...partsOf(tot, `FY${fy}`));
    }
    if (shares[0].length >= 2) {
      const avg = shares.map((s) => s.reduce((a, b) => a + b, 0) / s.length);
      const names = ["first", "second", "third", "fourth"];
      p.add("analysis", `Seasonality: over the last ${shares[0].length} fiscal years the ${names.map((n, k) => `${n} quarter averaged ${pct(avg[k])}`).join(", ")} of full-year revenue.`,
        derived("Each fiscal quarter's revenue ÷ fiscal-year revenue, averaged", parts, "Revenue seasonality"));
    }
  }

  // ---------- segments over time ----------
  segmentHistory(c, charts);

  // ---------- peers ----------
  // Returns use stored closes for every company so the windows line up; the 52-week range and
  // multiples use today's price.
  const bars = inp.prices?.self ?? null;
  const self = peerSnapshot(d, bars, inp.price);
  const peers = (inp.peers ?? []).filter((x) => x.ticker !== t && Object.keys(x.m).length);
  const all: PeerSnapshot[] = [self, ...peers];
  const keys: PeerMetricKey[] = self.fin
    ? ["mcap", "growth", "netMargin", "roe", "pe", "pb", "ret1y", "ret3m"]
    : ["mcap", "growth", "cagr3", "grossMargin", "opMargin", "fcfMargin", "rule40", "capexPct", "pe", "evSales", "evEbitda", "fcfYield", "netLeverage", "ret1y", "ret3m"];
  const fid = new Map<string, Partial<Record<PeerMetricKey, string>>>();
  for (const co of all) {
    const row: Partial<Record<PeerMetricKey, string>> = {};
    for (const k of keys) {
      const mv = co.m[k];
      if (!mv) continue;
      // Peers' headline metrics go to the writer; the rest are plotted only (rank facts carry the medians).
      const writerSees = co.ticker === t || ["growth", "opMargin", "netMargin", "evSales", "pe", "pb", "roe", "fcfMargin"].includes(k);
      const id = p.add("peers", mv.text, mv.ref.kind === "derived" || mv.ref.kind === "sec" ? { ...mv.ref, tk: co.ticker } : mv.ref, { v: mv.v, chart: !writerSees });
      if (id) row[k] = id;
    }
    fid.set(co.ticker, row);
  }
  const rankIds: Partial<Record<PeerMetricKey, string>> = {};
  const medians: Partial<Record<PeerMetricKey, number>> = {};
  const peerNames = peers.map((x) => x.ticker).join(", ");
  if (peers.length >= 2) {
    for (const k of keys) {
      if (k === "mcap") continue;
      const def = METRIC_DEF[k];
      const sv = self.m[k]?.v;
      const pv = peers.map((x) => x.m[k]?.v).filter((x): x is number => x != null);
      if (sv == null || pv.length < 2) continue;
      const med = median(pv)!;
      medians[k] = med;
      const { rank, of } = rankOf(sv, [sv, ...pv], def.better);
      const isVal = def.unit === "mult";
      const gap = isVal && med > 0 ? ` — a ${pct(Math.abs(sv / med - 1))} ${sv >= med ? "premium" : "discount"} to the peer median` : def.unit === "pct" ? ` (${pp(sv - med)} versus the median)` : "";
      const better = def.better === "high" ? "highest" : "lowest";
      rankIds[k] = p.add("peers", `${t} ranks ${ordinal(rank)} of ${of} (1 = ${better}) on ${def.label} against ${peerNames}: ${fmtMetric(k, sv)} versus a peer median of ${fmtMetric(k, med)}${gap}.`,
        composite(`Peer comparison: ${def.label}`, `Rank among ${of} companies; median of ${pv.length} peers`, all.map((x) => fid.get(x.ticker)?.[k])), { v: sv - med }) ?? undefined;
    }
  }
  // growth-adjusted valuation
  let fitId: string | null = null;
  const [xk, yk]: [PeerMetricKey, PeerMetricKey] = self.fin ? ["roe", "pb"] : ["growth", "evSales"];
  const pts = all.filter((x) => x.m[xk] && x.m[yk]).map((x) => ({ ticker: x.ticker, self: x.ticker === t, x: x.m[xk]!.v, y: x.m[yk]!.v, fx: fid.get(x.ticker)?.[xk], fy: fid.get(x.ticker)?.[yk] }));
  const fit = ols(pts.map((q) => q.x), pts.map((q) => q.y));
  const sp = pts.find((q) => q.self);
  if (fit && sp && pts.length >= 5) {
    const implied = fit.a + fit.b * sp.x;
    const per10 = fit.b * 0.1;
    const xl = self.fin ? "return on equity" : "TTM revenue growth", yl = METRIC_DEF[yk].short;
    const weak = fit.r2 < 0.15 ? " — too weak a relationship to read a premium or discount from" : fit.r2 < 0.35 ? " — a moderate relationship" : "";
    const meaningful = fit.r2 >= 0.15;
    // A weak fit says nothing about one company's premium, so no implied multiple is quoted or drawn.
    const gapTxt = meaningful && implied > 0 ? `; at ${t}'s ${pct(sp.x)} ${self.fin ? "ROE" : "growth"} the fit implies ${mult(implied)} versus ${mult(sp.y)} actual, a ${pct(Math.abs(sp.y / implied - 1))} ${sp.y >= implied ? "premium" : "discount"}` : "";
    fitId = p.add("peers", `Across ${pts.length} companies (${t} and peers), ${yl} ${per10 >= 0 ? "rises" : "falls"} by ${mult(Math.abs(per10))} for every 10 percentage points of ${xl} (R² ${fit.r2.toFixed(2)})${gapTxt}${weak}.`,
      composite(`${yl} vs ${xl} across peers`, "Least-squares fit across the peer set", pts.flatMap((q) => [q.fx, q.fy])), { v: meaningful && implied > 0 ? sp.y / implied - 1 : 0 });
    charts.push({ id: "peer-scatter", type: "scatter", title: self.fin ? "Return on equity vs price-to-book" : "Growth vs EV / sales", subtitle: meaningful ? `${t} and peers · line = least-squares fit (R² ${fit.r2.toFixed(2)})` : `${t} and peers · no meaningful linear fit (R² ${fit.r2.toFixed(2)}), so no trend line`,
      xLabel: self.fin ? "TTM return on equity" : "TTM revenue growth", yLabel: METRIC_DEF[yk].label, xUnit: "pct", yUnit: "mult", points: pts, ...(meaningful ? { fit: { ...fit, f: fitId ?? undefined } } : {}), size: "half" });
  }
  if (peers.length >= 2) {
    const panel: PeerMetricKey[] = self.fin ? ["growth", "netMargin", "roe", "pe", "pb", "ret1y"] : ["growth", "opMargin", "fcfMargin", "evSales", "pe", "ret1y"];
    const usable = panel.filter((k) => all.filter((x) => x.m[k]).length >= 3);
    const order = [self, ...[...peers].sort((a, b) => (b.m.mcap?.v ?? 0) - (a.m.mcap?.v ?? 0))];
    if (usable.length >= 3) charts.push({
      id: "peer-panel", type: "peers", title: "Peer comparison", subtitle: `${t} vs ${peers.length} peers · dashed line = peer median`,
      metrics: usable.map((k) => ({ key: k, label: METRIC_DEF[k].short, unit: METRIC_DEF[k].unit === "mult" ? "mult" : METRIC_DEF[k].unit === "usd" ? "usd" : "pct", better: METRIC_DEF[k].better, median: medians[k] ?? null, medianF: rankIds[k] })),
      rows: order.map((co) => ({ ticker: co.ticker, name: nameOf(co.ticker, co.name), self: co.ticker === t, cells: usable.map((k) => ({ v: co.m[k]?.v ?? null, f: fid.get(co.ticker)?.[k] })) })),
      size: "full",
    });
    // comparison table
    const cols: PeerMetricKey[] = self.fin ? ["mcap", "growth", "netMargin", "roe", "pe", "pb", "ret1y"] : ["mcap", "growth", "grossMargin", "opMargin", "fcfMargin", "pe", "evSales", "ret1y"];
    const tcols = cols.filter((k) => all.filter((x) => x.m[k]).length >= 2);
    const cell = (co: PeerSnapshot, k: PeerMetricKey): TableCell | null => {
      const mv = co.m[k];
      if (!mv) return null;
      const signed = k === "growth" || k === "ret1y";
      return { text: fmtMetric(k, mv.v), ref: mv.ref.kind === "derived" || mv.ref.kind === "sec" ? { ...mv.ref, tk: co.ticker } : mv.ref, tone: signed ? (mv.v >= 0 ? "positive" : "negative") : undefined };
    };
    tables.push({
      id: "peers", title: "Peer comparison", columns: tcols.map((k) => METRIC_DEF[k].short),
      rows: [
        ...order.map((co) => ({ label: `${co.ticker} · ${nameOf(co.ticker, co.name)}`, bold: co.ticker === t, cells: tcols.map((k) => cell(co, k)) })),
        { label: "Peer median", cells: tcols.map((k) => { const v = median(peers.map((x) => x.m[k]?.v).filter((x): x is number => x != null)); return v == null ? null : { text: fmtMetric(k, v) }; }) },
      ],
      note: `TTM figures from each company's SEC filings (four quarters through each company's latest filing); multiples use dated share prices — ${t} as of ${inp.price?.asOf ?? "n/a"}, peers at their latest stored close.`,
    });
  }

  // ---------- price performance ----------
  let spyRet: string | null = null;
  if (bars?.length) {
    const lastDate = bars[bars.length - 1][0].slice(0, 10);
    const from = daysBefore(lastDate, 365);
    const spy = inp.prices?.spy ?? null;
    const r = spy ? totalReturn(spy, from) : null;
    if (r) spyRet = p.add("performance", `S&P 500 ETF (SPY) 1-year total return (${r.start} to ${r.end}): ${pct(r.r, true)}.`, { kind: "market", label: "SPY 1-year total return", asOf: r.end }, { v: r.r });
    const selfRet = fid.get(t)?.ret1y;
    const sv = self.m.ret1y?.v;
    if (sv != null && r) {
      const pm = medians.ret1y;
      p.add("performance", `Over the past year ${t} returned ${pct(sv, true)} versus ${pct(r.r, true)} for the S&P 500 (${pp(sv - r.r)})${pm != null ? ` and a peer median of ${pct(pm, true)}` : ""}.`,
        composite("Relative performance", "1-year total returns, dividends reinvested", [selfRet, spyRet, rankIds.ret1y]), { v: sv - r.r });
    }
    // 52-week range (through today's price)
    const live = withLivePrice(bars, inp.price) ?? bars;
    const yr = live.filter((b) => b[0] >= daysBefore(live[live.length - 1][0], 365));
    if (yr.length > 100) {
      const lo = Math.min(...yr.map((b) => b[4])), hi = Math.max(...yr.map((b) => b[4]));
      const cur = yr[yr.length - 1][4];
      const id = p.add("performance", `52-week closing range ${perShare(lo)}–${perShare(hi)}; the ${perShare(cur)} price on ${yr[yr.length - 1][0].slice(0, 10)} is ${pct((cur - lo) / (hi - lo || 1))} of the way up the range and ${pct(Math.abs(cur / hi - 1))} below the high.`,
        { kind: "market", label: "52-week price range", asOf: lastDate }, { v: cur });
      const rows: Extract<ReportChart, { type: "range" }>["rows"] = [];
      const tg = inp.estimates?.target;
      if (tg?.low != null && tg.high != null) rows.push({ label: "Street price targets", low: tg.low, high: tg.high, f: c.est.target ?? undefined,
        marks: [...(tg.mean != null ? [{ label: "Mean", v: tg.mean, f: c.est.target ?? undefined }] : []), ...(tg.median != null ? [{ label: "Median", v: tg.median, f: c.est.target ?? undefined }] : [])] });
      rows.push({ label: "52-week trading range", low: lo, high: hi, f: id ?? undefined, marks: [] });
      const price = inp.price;
      charts.push({ id: "target-range", type: "range", title: "Price versus street targets and trading range", subtitle: price ? `Share price ${perShare(price.price)} as of ${price.asOf}` : undefined, unit: "usdPerShare",
        rows, current: price ? { label: "Price", v: price.price, f: c.val.price ?? undefined } : undefined, size: "half" });
    }
    // indexed lines: self, SPY, peer median
    const wk = weeklyCloses(bars, from);
    if (wk.length > 20) {
      const idx = (w: [string, number][]) => {
        const out: (number | null)[] = [];
        let j = 0, base: number | null = null;
        for (const [date] of wk) {
          while (j + 1 < w.length && w[j + 1][0] <= date) j++;
          const v = w[j] && w[j][0] <= date ? w[j][1] : null;
          if (v != null && base == null) base = v;
          out.push(v != null && base ? (v / base) * 100 : null);
        }
        return out;
      };
      const selfIdx = idx(wk);
      const lines: ChartSeries[] = [{ name: t, kind: "line", unit: "index", tone: "self", points: selfIdx.map((v, i) => ({ v, f: i === selfIdx.length - 1 ? selfRet : undefined })) }];
      if (spy) { const s = idx(weeklyCloses(spy, from)); lines.push({ name: "S&P 500 (SPY)", kind: "dash", unit: "index", tone: "bench", points: s.map((v, i) => ({ v, f: i === s.length - 1 ? spyRet ?? undefined : undefined })) }); }
      const peerIdx = peers.filter((x) => x.weekly.length > 20).map((x) => idx(x.weekly));
      if (peerIdx.length >= 2) {
        const medLine = wk.map((_, i) => median(peerIdx.map((s) => s[i]).filter((v): v is number => v != null)));
        lines.push({ name: "Peer median", kind: "line", unit: "index", tone: "peer", points: medLine.map((v, i) => ({ v, f: i === medLine.length - 1 ? rankIds.ret1y : undefined })) });
      }
      charts.push({ id: "price-performance", type: "combo", title: "One-year total return", subtitle: `Indexed to 100 on ${wk[0][0]} · weekly, dividends reinvested`, x: wk.map((w) => w[0]), series: lines, size: "half" });
    }
    // valuation vs own history
    valuationBand(c, charts, bars, self.fin);
  }

  // ---------- consensus ----------
  const est = inp.estimates;
  if (est) {
    const labels = ["90d ago", "60d ago", "30d ago", "7d ago", "Now"];
    const rev: ChartSeries[] = [];
    for (const per of est.periods) {
      const tr = per.trend;
      if (tr.d90 == null || tr.d90 === 0 || tr.current == null) continue;
      const vals = [tr.d90, tr.d60, tr.d30, tr.d7, tr.current].map((x) => (x == null ? null : x / tr.d90! - 1));
      const id = c.est.revisions.get(per.code) ?? null;
      rev.push({ name: ({ "0q": "Current qtr", "+1q": "Next qtr", "0y": "Current FY", "+1y": "Next FY" } as Record<string, string>)[per.code], kind: per.code.endsWith("y") ? "line" : "dash", unit: "pct",
        tone: per.code === "0q" ? "self" : undefined, points: vals.map((v, i) => ({ v, f: i === vals.length - 1 ? id ?? undefined : undefined })) });
    }
    if (rev.length) charts.push({ id: "eps-revisions", type: "combo", title: "Consensus EPS revisions", subtitle: "Change in consensus EPS since 90 days ago", x: labels, series: rev, size: "half" });
    const sur = [...c.est.surprises].sort((a, b) => a.quarter.localeCompare(b.quarter));
    if (sur.length >= 2) charts.push({ id: "surprises", type: "combo", title: "Reported EPS versus consensus", subtitle: "Last reported quarters",
      x: sur.map((s) => s.quarter.slice(0, 7)),
      series: [
        { name: "Consensus", kind: "bar", unit: "usdPerShare", tone: "peer", points: sur.map((s) => ({ v: s.estimate, f: s.id ?? undefined })) },
        { name: "Reported", kind: "bar", unit: "usdPerShare", tone: "self", points: sur.map((s) => ({ v: s.actual, f: s.id ?? undefined })) },
      ], size: "half" });
    const rm = [...c.est.ratings].reverse();
    if (rm.length >= 2) {
      const cats = [["Strong buy", "strongBuy", "pos", 1], ["Buy", "buy", "pos", 0.55], ["Hold", "hold", "neutral", 0.6], ["Sell", "sell", "neg", 0.55], ["Strong sell", "strongSell", "neg", 1]] as const;
      charts.push({ id: "rating-mix", type: "stacked", percent: true, title: "Analyst rating mix", subtitle: "Share of ratings by month", x: rm.map((r) => r.label.replace(/^this month$/, "Now")),
        series: cats.map(([name, k, tone, opacity]) => ({ name, kind: "bar" as const, unit: "count" as const, tone, opacity, points: rm.map((r) => ({ v: r.row[k], f: r.id ?? undefined })) })), size: "half" });
    }
    // consensus vs reported trajectory
    const ny = est.periods.find((x) => x.code === "+1y") ?? est.periods.find((x) => x.code === "0y");
    const g = ny?.revenue.growth ?? (ny?.revenue.avg != null && ny.revenue.yearAgo ? ny.revenue.avg / ny.revenue.yearAgo - 1 : null);
    if (ny && g != null && self.m.growth) {
      const cagr = self.m.cagr3?.v;
      const name = ny.code === "+1y" ? "next fiscal year" : "current fiscal year";
      p.add("analysis", `Consensus implies ${name} revenue growth of ${pct(g, true)} versus ${pct(self.m.growth.v, true)} over the trailing four quarters${cagr != null ? ` and a 3-year CAGR of ${pct(cagr, true)}` : ""} — ${g > self.m.growth.v + 0.01 ? "an acceleration" : g < self.m.growth.v - 0.01 ? "a deceleration" : "roughly the current pace"}.`,
        composite("Consensus vs reported growth", "Consensus revenue growth compared with reported growth", [c.est.consensus.get(ny.code), fid.get(t)?.growth, fid.get(t)?.cagr3]), { v: g - self.m.growth.v });
    }
    const q0 = est.periods.find((x) => x.code === "0q");
    if (q0?.eps.avg && q0.eps.low != null && q0.eps.high != null && q0.eps.avg > 0) {
      p.add("analysis", `Estimate dispersion for the current quarter: the EPS range ${perShare(q0.eps.low)}–${perShare(q0.eps.high)} spans ${pct((q0.eps.high - q0.eps.low) / q0.eps.avg)} of the ${perShare(q0.eps.avg)} consensus.`,
        composite("EPS estimate dispersion", "(high − low) ÷ consensus", [c.est.consensus.get("0q")]));
    }
    if (est.target.mean != null && inp.price) {
      const up = est.target.mean / inp.price.price - 1;
      const disp = est.target.high != null && est.target.low != null ? (est.target.high - est.target.low) / est.target.mean : null;
      p.add("analysis", `The mean street target of ${perShare(est.target.mean)} implies ${pct(up, true)} from the ${perShare(inp.price.price)} share price (as of ${inp.price.asOf})${disp != null ? `; targets span ${pct(disp)} of the mean` : ""}.`,
        composite("Implied upside to street target", "Mean target ÷ share price − 1", [c.est.target, c.val.price]), { v: up });
    }
    // reaction to beats vs misses
    const rx = inp.reactions?.reactions ?? [];
    const matched = c.est.surprises.map((s) => {
      const r = rx.find((x) => x.date > s.quarter && Date.parse(x.date) - Date.parse(s.quarter) <= 75 * 86400000);
      return r && s.surprisePct != null ? { beat: s.surprisePct > 0, move: r.move, sid: s.id, rid: c.reactions.find((y) => y.date === r.date)?.id } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    const beats = matched.filter((x) => x.beat), misses = matched.filter((x) => !x.beat);
    if (matched.length >= 3) {
      const avg = (xs: { move: number }[]) => xs.reduce((s, x) => s + x.move, 0) / xs.length;
      p.add("analysis", `Reaction to results: after ${beats.length} EPS beat${beats.length === 1 ? "" : "s"} the stock moved ${beats.length ? pct(avg(beats), true) : "n/a"} on average on the release day${misses.length ? `; after ${misses.length} miss${misses.length === 1 ? "" : "es"}, ${pct(avg(misses), true)}` : ""}.`,
        composite("Earnings reactions by surprise", "Average release-day move grouped by EPS beat or miss", matched.flatMap((x) => [x.sid, x.rid])));
    }
  }

  // ---------- earnings reactions ----------
  const rx = (inp.reactions?.reactions ?? []).slice(0, 8).reverse();
  if (rx.length >= 3) charts.push({ id: "reactions", type: "combo", title: "Stock reaction to earnings", subtitle: "Release-day move and the following 20 sessions", x: rx.map((r) => r.date.slice(0, 7)),
    series: [
      { name: "Release-day move", kind: "bar", unit: "pct", tone: "signed", points: rx.map((r) => ({ v: r.move, f: c.reactions.find((y) => y.date === r.date)?.id ?? undefined })) },
      { name: "Next 20 sessions", kind: "dash", unit: "pct", points: rx.map((r) => ({ v: r.drift20 ?? null, f: c.reactions.find((y) => y.date === r.date)?.id ?? undefined })) },
    ], size: "half" });

  // ---------- insiders: monthly open-market value ----------
  {
    const since = daysBefore(inp.today, 365);
    const trades = d.insiders.filter((x) => (x.code === "P" || x.code === "S") && x.date >= since && x.price);
    if (trades.length >= 3) {
      const months: string[] = [];
      for (let k = 11; k >= 0; k--) { const m = new Date(Date.parse(`${inp.today.slice(0, 7)}-01T00:00:00Z`)); m.setUTCMonth(m.getUTCMonth() - k); months.push(m.toISOString().slice(0, 7)); }
      const pts = months.map((m) => {
        const xs = trades.filter((x) => x.date.slice(0, 7) === m);
        if (!xs.length) return { v: 0 } as ChartPoint;
        const net = xs.reduce((s, x) => s + (x.code === "P" ? 1 : -1) * x.shares * (x.price ?? 0), 0);
        const big = [...xs].sort((a, b) => b.shares * (b.price ?? 0) - a.shares * (a.price ?? 0))[0];
        const id = p.add("insiders", `Insider open-market trades in ${m}: net ${net >= 0 ? "purchases" : "sales"} of ${money(Math.abs(net))} across ${xs.length} transaction${xs.length === 1 ? "" : "s"} (largest: ${big.owner}).`,
          { kind: "filing", accn: big.accn, doc: big.doc, form: "4", filed: big.filed, label: `Form 4 filed ${big.filed}` }, { v: net, chart: true });
        return { v: net, f: id ?? undefined };
      });
      charts.push({ id: "insiders", type: "combo", title: "Insider open-market activity", subtitle: "Net purchases (+) and sales (−) by month, Form 4", x: months, series: [{ name: "Net value", kind: "bar", unit: "usd", tone: "signed", points: pts }], size: "half" });
    }
  }

  // ---------- at a glance ----------
  const glance: GlanceItem[] = [];
  const g = (label: string, id: string | null | undefined, value: string | null, sub?: string, tone?: GlanceItem["tone"]) => { if (id && value) glance.push({ label, value, sub, f: id, tone }); };
  if (inp.price) g("Share price", c.val.price, perShare(inp.price.price), `As of ${inp.price.asOf}`);
  const mc = p.value(c.val.mcap);
  g("Market cap", c.val.mcap, mc != null ? money(mc) : null, self.m.ret1y ? `${pct(self.m.ret1y.v, true)} over 1 year` : undefined, self.m.ret1y ? (self.m.ret1y.v >= 0 ? "positive" : "negative") : undefined);
  if (c.ttm.revenue) g("TTM revenue", c.ttm.ids.revenue, money(c.ttm.revenue.v), self.m.growth ? `${pct(self.m.growth.v, true)} year over year` : undefined, self.m.growth ? (self.m.growth.v >= 0 ? "positive" : "negative") : undefined);
  const marginKey: PeerMetricKey = self.fin ? "netMargin" : "opMargin";
  if (self.m[marginKey]) g(self.fin ? "Net margin (TTM)" : "Operating margin (TTM)", rankIds[marginKey] ?? fid.get(t)?.[marginKey], pct(self.m[marginKey]!.v), medians[marginKey] != null ? `Peer median ${pct(medians[marginKey]!)}` : undefined);
  const vk: PeerMetricKey = self.fin ? "pb" : self.m.pe ? "pe" : "evSales";
  if (self.m[vk]) g(METRIC_DEF[vk].short, rankIds[vk] ?? fid.get(t)?.[vk], mult(self.m[vk]!.v), medians[vk] != null ? `Peer median ${mult(medians[vk]!)}` : undefined);
  if (!self.fin && self.m.fcfYield) g("FCF yield", fid.get(t)?.fcfYield, pct(self.m.fcfYield.v), medians.fcfYield != null ? `Peer median ${pct(medians.fcfYield)}` : undefined);
  if (est?.target.mean != null && inp.price) g("Mean street target", c.est.target, perShare(est.target.mean), `${pct(est.target.mean / inp.price.price - 1, true)} implied`, est.target.mean >= inp.price.price ? "positive" : "negative");
  if (est?.nextEarnings?.start && est.nextEarnings.start >= inp.today) g("Next earnings", c.est.nextEarnings, est.nextEarnings.start, est.nextEarnings.epsAvg != null ? `Consensus EPS ${perShare(est.nextEarnings.epsAvg)}` : undefined);

  // Fill the strip to a full row with the next most useful comparisons.
  if (!self.fin && vk !== "evSales" && self.m.evSales && glance.length < 8) g("EV / Sales", rankIds.evSales ?? fid.get(t)?.evSales, mult(self.m.evSales.v), medians.evSales != null ? `Peer median ${mult(medians.evSales)}` : undefined);
  if (self.m.ret1y && glance.length < 8) g("1Y total return", rankIds.ret1y ?? fid.get(t)?.ret1y, pct(self.m.ret1y.v, true), medians.ret1y != null ? `Peer median ${pct(medians.ret1y, true)}` : undefined);
  return { charts, tables, glance: glance.slice(0, 8), peers: peers.map((x) => ({ ticker: x.ticker, name: nameOf(x.ticker, x.name) })) };
}

/** Five-year point-in-time multiple with its median and ±1σ band. */
function valuationBand(c: InsightCtx, charts: ReportChart[], bars: Bar[], fin: boolean) {
  const { p, d } = c;
  const hist = valuationHistory(d, bars, isBankIndustry(d.profile.industry));
  if (hist.length < 60) return;
  const from = daysBefore(hist[hist.length - 1].date, 5 * 365);
  const win = hist.filter((h) => h.date >= from);
  const share = (k: MultipleKey) => win.filter((h) => (h.values[k] ?? null) != null).length / win.length;
  const k: MultipleKey = fin ? (share("pb") > 0.8 ? "pb" : "pe") : share("pe") > 0.85 ? "pe" : share("evSales") > 0.8 ? "evSales" : "ps";
  const values = win.map((h) => h.values[k] ?? null);
  const st = multipleStats(values);
  const finite = values.filter((v): v is number => v != null);
  const lo = quantile(finite, 0.25), hi = quantile(finite, 0.75);
  if (st.n < 50 || st.median == null || st.current == null || lo == null || hi == null) return;
  const name = ({ pe: "P/E", evSales: "EV/sales", ps: "Price/sales", pb: "Price/book" } as Record<string, string>)[k] ?? k;
  const lastDate = win[win.length - 1].date;
  const basis = k === "pe" ? c.ttm.netIncome : k === "pb" ? null : c.ttm.revenue;
  const parts = basis?.ref.kind === "derived" ? basis.ref.parts : [];
  const pctile = Math.round((st.percentile ?? 0) * 100);
  const vsMed = st.current / st.median - 1;
  const id = p.add("history", `Point-in-time ${name} over the five years to ${lastDate} (weekly; each week uses only fundamentals filed by then): ${mult(st.current)} now versus a five-year median of ${mult(st.median)} (${pct(Math.abs(vsMed))} ${vsMed >= 0 ? "above" : "below"}), interquartile range ${mult(lo)}–${mult(hi)}, full range ${mult(st.min ?? 0)}–${mult(st.max ?? 0)}; the current reading is at the ${ordinalPct(pctile)} percentile of the period.`,
    derived(`Weekly closing price × point-in-time shares ÷ trailing fundamentals filed by each week (${name}, five years)`, parts, `${name} history`, [{ label: "Weekly closing price", value: bars[bars.length - 1][4], asOf: lastDate }]), { v: st.current });
  // Very high readings (earnings near zero) would flatten the chart: plot up to a cap and say so.
  const cap = Math.max(hi * 2.5, st.median * 3);
  const cut = finite.filter((v) => v > cap).length;
  charts.push({ id: "valuation-history", type: "band", title: `${name} versus its five-year history`, subtitle: `Weekly, point-in-time · band = middle half of readings (25th–75th percentile)${cut ? ` · ${cut} week${cut === 1 ? "" : "s"} above ${mult(cap)} not plotted` : ""}`, unit: "mult",
    dates: win.map((h) => h.date), values: values.map((v) => (v == null || v > cap ? null : Math.round(v * 100) / 100)), median: st.median, lo, hi, f: id ?? undefined, size: "half" });
}
const ordinalPct = (n: number) => ordinal(Math.max(1, Math.min(99, n)));

/** Segment revenue mix over up to five fiscal years plus each segment's contribution to growth. */
function segmentHistory(c: InsightCtx, charts: ReportChart[]) {
  const { p, d } = c;
  const annual = d.segments.filter((s) => s.metric === "revenue" && s.start && (Date.parse(s.end) - Date.parse(s.start)) / 86400000 > 350);
  if (!annual.length) return;
  const rank = (axis: string) => (/BusinessSegments|Segment/i.test(axis) ? 0 : /Product|Service/i.test(axis) ? 1 : /Geograph|Region|Country/i.test(axis) ? 2 : 3);
  const byAxis = new Map<string, SegmentFact[]>();
  for (const s of annual) byAxis.set(s.axis, [...(byAxis.get(s.axis) ?? []), s]);
  const latestEnd = annual.reduce((m, s) => (s.end > m ? s.end : m), "");
  const axes = [...byAxis.entries()].filter(([, v]) => new Set(v.filter((x) => x.end === latestEnd).map((x) => x.member)).size >= 2)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
  const pick = axes[0];
  if (!pick) return;
  const facts = pick[1];
  const ends = [...new Set(facts.map((f) => f.end))].sort().slice(-5);
  if (ends.length < 2) return;
  const at = new Map<string, SegmentFact>();
  for (const f of facts) if (ends.includes(f.end)) { const k = `${f.member}|${f.end}`; const cur = at.get(k); if (!cur || f.value > cur.value) at.set(k, f); }
  const latest = [...new Set(facts.filter((f) => f.end === ends[ends.length - 1]).map((f) => f.member))]
    .map((m) => at.get(`${m}|${ends[ends.length - 1]}`)!).sort((a, b) => b.value - a.value);
  const members = latest.slice(0, 6).map((f) => f.member);
  // Plot only the run of recent years in which every shown segment is reported, so a renamed or
  // newly created segment can't make an earlier year look smaller than it was.
  let from = ends.length - 1;
  while (from > 0 && members.every((m) => at.has(`${m}|${ends[from - 1]}`))) from--;
  ends.splice(0, from);
  if (ends.length < 2) return;
  const label = latest[0].axisLabel;
  const src = (f: SegmentFact): SourceRef => ({ accn: f.accn, concept: f.concept, start: f.start, end: f.end, value: f.value });
  const fy = (e: string) => `FY${e.slice(0, 4)}`;
  const series: ChartSeries[] = members.map((m) => {
    const name = latest.find((f) => f.member === m)!.label;
    return { name, kind: "bar", unit: "usd", points: ends.map((e) => {
      const f = at.get(`${m}|${e}`);
      if (!f) return { v: null };
      const id = p.add("segments", `${name} revenue (${label.toLowerCase()}) for the fiscal year ended ${e}: ${money(f.value)}.`, { kind: "sec", src: src(f), label: f.concept }, { v: f.value, chart: true });
      return { v: f.value, f: id ?? undefined };
    }) };
  });
  charts.push({ id: "segment-mix", type: "stacked", title: `Revenue by ${label.toLowerCase()}`, subtitle: "Fiscal years, reported segment revenue", x: ends.map(fy), series, size: "half" });

  // mix shift and growth contribution, latest year vs prior
  const [e1, e0] = [ends[ends.length - 1], ends[ends.length - 2]];
  const total = (e: string) => members.reduce((s, m) => s + (at.get(`${m}|${e}`)?.value ?? 0), 0);
  const t0 = total(e0), t1 = total(e1);
  if (t0 <= 0 || t1 <= 0) return;
  const rows: { label: string; v: number; f?: string }[] = [];
  for (const m of members) {
    const a = at.get(`${m}|${e1}`), b = at.get(`${m}|${e0}`);
    if (!a || !b) continue;
    const contrib = (a.value - b.value) / t0;
    const name = latest.find((f) => f.member === m)!.label;
    const id = p.add("segments", `${name} contributed ${pp(contrib)} to ${fy(e1)} ${label.toLowerCase()} revenue growth (${money(a.value)} versus ${money(b.value)}; share of the total ${pct(a.value / t1)} versus ${pct(b.value / t0)}).`,
      derived(`(${name} revenue − prior year) ÷ prior-year total of the segments shown`, [
        { ...src(a), label: `${name} ${fy(e1)}`, sign: 1 }, { ...src(b), label: `${name} ${fy(e0)}`, sign: -1 },
      ], `${name} growth contribution`), { v: contrib });
    rows.push({ label: name, v: contrib, f: id ?? undefined });
  }
  const first = ends[0];
  if (ends.length >= 3) {
    for (const m of members.slice(0, 3)) {
      const a = at.get(`${m}|${e1}`), b = at.get(`${m}|${first}`);
      const tf = total(first);
      if (!a || !b || tf <= 0) continue;
      const name = latest.find((f) => f.member === m)!.label;
      p.add("segments", `${name} share of ${label.toLowerCase()} revenue: ${pct(a.value / t1)} in ${fy(e1)} versus ${pct(b.value / tf)} in ${fy(first)}.`,
        derived(`${name} revenue ÷ total of the segments shown, ${fy(e1)} vs ${fy(first)}`, [{ ...src(a), label: `${name} ${fy(e1)}`, sign: 1 }, { ...src(b), label: `${name} ${fy(first)}`, sign: 1 }], `${name} mix shift`));
    }
  }
  if (rows.length >= 2) {
    const tot = (t1 - t0) / t0;
    rows.push({ label: "Total", v: tot });
    charts.push({ id: "segment-growth", type: "hbar", title: `What drove ${fy(e1)} growth`, subtitle: `Contribution to ${label.toLowerCase()} revenue growth, percentage points`, unit: "pp", signed: true,
      rows: rows.map((r) => ({ ...r, self: r.label === "Total" })), size: "half" });
  }
}
