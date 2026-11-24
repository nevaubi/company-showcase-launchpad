// The "financial read": a handful of plain sentences, each produced by a fixed rule over the computed analysis
// (analysis.ts) and carrying the figures that triggered it. Strengths and concerns are listed side by side; the
// order is the rule's weight, not a judgement. No model writes anything here, and a sentence exists only when its
// rule's threshold is met by a figure that opens its source. Pure.
import { measureOf, type Fig, type FinancialAnalysis, type Measure, type MeasureUnit } from "./analysis";

export interface ReadPart {
  text: string;
  /** set on a number: the figure it shows, so the page can open its source */
  fig?: Fig;
  unit?: MeasureUnit;
  /** what the figure is, for the source panel */
  label?: string;
}

export interface ReadItem {
  /** the rule that produced the sentence */
  id: string;
  side: "strength" | "concern";
  /** larger first; set by the rule from how far the figure is past its threshold */
  weight: number;
  parts: ReadPart[];
}

export interface FinancialRead {
  /** the span the current figures cover ("TTM to Q3 FY26" or "FY2025") */
  span: string | null;
  strengths: ReadItem[];
  concerns: ReadItem[];
}

/** Thresholds of the rules, in one place so the page can state them and the tests can pin them. */
export const READ_RULES = {
  growthStrong: 0.1,
  growthShift: 0.05,
  marginMove: 0.01,
  marginDrop: 0.015,
  marginVsMedian: 0.02,
  roicStrong: 0.15,
  roeLeverage: { roe: 0.4, multiplier: 3 },
  conversionStrong: 1,
  conversionWeak: 0.7,
  accruals: 0.05,
  leverageHigh: 3,
  coverStrong: 10,
  coverWeak: 3,
  workingCapitalGap: 0.1,
  /** receivables and inventories are compared with revenue only when they are at least this share of it */
  receivablesShare: 0.05,
  inventoryShare: 0.02,
  profitMove: { fall: -0.05, lead: 0.05, strong: 0.15 },
  buyback: -0.01,
  dilution: 0.03,
  stockComp: 0.1,
  payoutOver: 1.1,
  runwayShort: 8,
  bank: { growthStrong: 0.06, efficiencyMove: 0.01, roeStrong: 0.12, roeWeak: 0.08, provisionMove: 0.002, capitalMove: 0.005, depositGrowth: 0.05 },
  perSide: 4,
} as const;

/* ---- formatting (kept here so a sentence is a pure function of the figures) */
const minus = (s: string) => s.replace("-", "−");
export function fmtFig(v: number, unit: MeasureUnit, opts: { abs?: boolean } = {}): string {
  const x = opts.abs ? Math.abs(v) : v;
  switch (unit) {
    case "pct":
      return minus(`${(x * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
    case "x":
      return minus(`${x.toFixed(Math.abs(x) >= 10 ? 0 : 1)}×`);
    case "usd": {
      const a = Math.abs(x);
      const s = a >= 1e12 ? `$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(0)}M` : `$${Math.round(a).toLocaleString("en-US")}`;
      return x < 0 ? `−${s}` : s;
    }
    case "perShare":
      return minus(`$${x.toFixed(2)}`).replace("$−", "−$");
    case "days":
      return `${Math.round(x)} days`;
    case "quarters":
      return `${x.toFixed(1)} quarters`;
  }
}
const points = (d: number) => `${Math.abs(d * 100).toFixed(1)} points`;

type Bit = string | ReadPart;
const n = (m: Measure, which: "now" | "prior", opts: { abs?: boolean } = {}): ReadPart => {
  const fig = m[which]!;
  return { text: fmtFig(fig.v, m.unit, opts), fig, unit: m.unit, label: m.label };
};
const med = (m: Measure): string => fmtFig(m.median!.v, m.unit);
/** "five-year median", or the number of fiscal years the median really covers. */
const medianOf = (m: Measure): string => `${["", "one", "two", "three", "four", "five"][m.median!.n] ?? m.median!.n}-year median`;
const sentence = (bits: Bit[]): ReadPart[] => bits.map((b) => (typeof b === "string" ? { text: b } : b));
/** Under this a change prints as 0.0%, so it is called flat rather than a rise or a fall. */
const FLAT = 0.0005;
/** A change in words that is true for either sign: "grew 4.0%", "fell 8.0%" (the figure shown unsigned), "was flat at 0.0%". */
const change = (m: Measure, which: "now" | "prior", up = "grew"): Bit[] => {
  const v = m[which]!.v;
  return Math.abs(v) < FLAT ? ["was flat at ", n(m, which)] : v > 0 ? [`${up} `, n(m, which)] : ["fell ", n(m, which, { abs: true })];
};

export function financialRead(a: FinancialAnalysis): FinancialRead {
  const out: ReadItem[] = [];
  const add = (id: string, side: ReadItem["side"], weight: number, bits: Bit[]) => out.push({ id, side, weight, parts: sentence(bits) });
  const get = (key: string) => measureOf(a, key);
  const R = READ_RULES;
  const over = a.basis === "ttm" ? "over the trailing twelve months" : `in ${a.current ?? "the latest fiscal year"}`;
  const bank = a.kind === "bank";

  /* ---- growth */
  const g = get("revenueGrowth");
  const gq = get("revenueYoY");
  if (g?.now) {
    const strong = bank ? R.bank.growthStrong : R.growthStrong;
    if (g.now.v >= strong) add("growth", "strength", 2 + Math.min(2, g.now.v * 4), ["Revenue grew ", n(g, "now"), ` ${over}`, ...(g.prior ? [", against ", n(g, "prior"), " a year earlier"] : []), "."]);
    else if (g.now.v <= -FLAT) add("decline", "concern", 3 + Math.min(1, -g.now.v * 5), ["Revenue fell ", n(g, "now", { abs: true }), ` ${over}`, ...(g.prior ? [", after it ", ...change(g, "prior"), " a year earlier"] : []), "."]);
    if (gq?.now && a.basis === "ttm") {
      const gap = gq.now.v - g.now.v;
      // Slowing is read only for a growing company, picking up only when the quarter itself grew: a decline that
      // eases (−10% in the quarter against −20% over the year) is not a strength and gets no sentence of its own.
      if (gap <= -R.growthShift && g.now.v > 0) add("slowing", "concern", 1.5 + Math.min(1.5, -gap * 5), ["Growth slowed: revenue in the latest quarter ", ...change(gq, "now", "rose"), " on a year earlier, against growth of ", n(g, "now"), " over twelve months."]);
      else if (gap >= R.growthShift && gq.now.v >= FLAT) {
        if (g.now.v > 0) add("accelerating", "strength", 1.5 + Math.min(1.5, gap * 5), ["Growth picked up: revenue in the latest quarter rose ", n(gq, "now"), " on a year earlier, against ", n(g, "now"), " over twelve months."]);
        else add("returnToGrowth", "strength", 1.5 + Math.min(1.5, gq.now.v * 5), ["Revenue returned to growth: the latest quarter rose ", n(gq, "now"), " on a year earlier, while twelve-month revenue ", ...change(g, "now"), "."]);
      }
    }
  }

  /* ---- net income against revenue: the same rules for both kinds */
  const ng = get("netIncomeGrowth");
  if (ng?.now) {
    if (ng.now.v <= R.profitMove.fall) add("profitDown", "concern", 2.5 + Math.min(1, -ng.now.v * 3), ["Net income fell ", n(ng, "now", { abs: true }), ` ${over}`, ...(g?.now ? [" while revenue ", ...change(g, "now")] : []), "."]);
    else if (g?.now && ng.now.v >= R.profitMove.strong && ng.now.v - g.now.v >= R.profitMove.lead) add("profitLead", "strength", 1.8 + Math.min(1.2, (ng.now.v - g.now.v) * 3), ["Net income grew ", n(ng, "now"), ` ${over}`, ...(g.now.v >= FLAT ? [", faster than revenue at ", n(g, "now")] : [" while revenue ", ...change(g, "now")]), "."]);
  }

  /* ---- share count and payouts: the same rules for both kinds */
  const sh = get("shareChange");
  if (sh?.now) {
    if (sh.now.v <= R.buyback) add("buyback", "strength", 1 + Math.min(1, -sh.now.v * 10), ["The diluted share count fell ", n(sh, "now", { abs: true }), " over a year."]);
    else if (sh.now.v >= R.dilution) add("dilution", "concern", 1.5 + Math.min(2, sh.now.v * 5), ["The diluted share count rose ", n(sh, "now"), " over a year."]);
  }

  if (bank) {
    const eff = get("efficiency");
    if (eff?.now && eff.prior) {
      const d = eff.now.v - eff.prior.v;
      if (d <= -R.bank.efficiencyMove) add("efficiency", "strength", 2 + Math.min(1, -d * 20), ["The efficiency ratio improved to ", n(eff, "now"), " from ", n(eff, "prior"), " a year earlier (expenses took a smaller share of revenue)."]);
      else if (d >= R.bank.efficiencyMove * 1.5) add("efficiencyWorse", "concern", 2 + Math.min(1, d * 20), ["The efficiency ratio rose to ", n(eff, "now"), " from ", n(eff, "prior"), " a year earlier (expenses took a larger share of revenue)."]);
    }
    const r = get("roe");
    const rt = get("rote");
    if (r?.now) {
      if (r.now.v >= R.bank.roeStrong) add("roe", "strength", 2, ["Return on equity is ", n(r, "now"), ...(rt?.now ? [", and ", n(rt, "now"), " on tangible equity"] : []), ...(r.median ? [`; the ${medianOf(r)} is ${med(r)}`] : []), "."]);
      else if (r.now.v < R.bank.roeWeak) add("roeWeak", "concern", 2, ["Return on equity is ", n(r, "now"), ...(r.median ? [`, against a ${medianOf(r)} of ${med(r)}`] : []), "."]);
    }
    const pv = get("provisionToLoans");
    if (pv?.now && pv.prior) {
      const d = pv.now.v - pv.prior.v;
      if (d >= R.bank.provisionMove) add("provisions", "concern", 2 + Math.min(1.5, d * 200), ["Provisions for credit losses rose to ", n(pv, "now"), " of average loans from ", n(pv, "prior"), " a year earlier."]);
      else if (d <= -R.bank.provisionMove) add("provisionsLower", "strength", 1.5 + Math.min(1.5, -d * 200), ["Provisions for credit losses fell to ", n(pv, "now"), " of average loans from ", n(pv, "prior"), " a year earlier."]);
    }
    const eq = get("equityToAssets");
    if (eq?.now && eq.prior) {
      const d = eq.now.v - eq.prior.v;
      if (d <= -R.bank.capitalMove) add("capitalLower", "concern", 1.5, ["Equity fell to ", n(eq, "now"), " of assets from ", n(eq, "prior"), " a year earlier."]);
      else if (d >= R.bank.capitalMove) add("capitalHigher", "strength", 1.5, ["Equity rose to ", n(eq, "now"), " of assets from ", n(eq, "prior"), " a year earlier."]);
    }
    const dep = get("depositGrowth");
    if (dep?.now) {
      if (dep.now.v >= R.bank.depositGrowth) add("deposits", "strength", 1.2, ["Deposits grew ", n(dep, "now"), " over a year."]);
      else if (dep.now.v <= -FLAT) add("depositsLower", "concern", 1.5, ["Deposits fell ", n(dep, "now", { abs: true }), " over a year."]);
    }
    const tp = get("totalPayout");
    if (tp?.now && tp.now.v > 1) add("payoutOver", "concern", 1.2, ["Dividends and repurchases were ", n(tp, "now"), " of net income."]);
  } else {
    /* ---- margins */
    const om = get("operatingMargin")?.now ? get("operatingMargin") : get("netMargin");
    let moved = false;
    if (om?.now && om.prior) {
      const d = om.now.v - om.prior.v;
      const tail: Bit[] = om.median ? [`; the ${medianOf(om)} is ${med(om)}`] : [];
      // a margin below zero does not widen or narrow: it improves or worsens
      const positive = om.now.v >= 0 && om.prior.v >= 0;
      if (d >= R.marginMove) {
        moved = true;
        add("marginUp", "strength", 2 + Math.min(1.5, d * 20), [`${om.label} ${positive ? "widened" : "improved"} to `, n(om, "now"), " from ", n(om, "prior"), " a year earlier", ...tail, "."]);
      } else if (d <= -R.marginDrop) {
        moved = true;
        add("marginDown", "concern", 2 + Math.min(1.5, -d * 20), [`${om.label} ${positive ? "narrowed" : "worsened"} to `, n(om, "now"), " from ", n(om, "prior"), " a year earlier", ...tail, "."]);
      }
    }
    if (om?.now && om.median && !moved) {
      const d = om.now.v - om.median.v;
      if (d >= R.marginVsMedian) add("marginAboveMedian", "strength", 1.5, [`${om.label} of `, n(om, "now"), ` is ${points(d)} above its ${medianOf(om)} of ${med(om)}.`]);
      else if (d <= -R.marginVsMedian) add("marginBelowMedian", "concern", 1.5, [`${om.label} of `, n(om, "now"), ` is ${points(d)} below its ${medianOf(om)} of ${med(om)}.`]);
    }
    const gm = get("grossMargin");
    if (gm?.now && gm.prior && gm.now.v - gm.prior.v <= -R.marginDrop) add("grossMarginDown", "concern", 1.8 + Math.min(1.5, (gm.prior.v - gm.now.v) * 20), [`Gross margin ${gm.now.v >= 0 && gm.prior.v >= 0 ? "narrowed" : "worsened"} to `, n(gm, "now"), " from ", n(gm, "prior"), " a year earlier."]);

    /* ---- returns */
    const ric = get("roic");
    if (ric?.now && ric.now.v >= R.roicStrong) add("roic", "strength", 2 + Math.min(1, ric.now.v), ["Return on invested capital is ", n(ric, "now"), ...(ric.median ? [`, against a ${medianOf(ric)} of ${med(ric)}`] : []), "."]);
    const r = get("roe");
    if (r?.now && a.dupont && r.now.v >= R.roeLeverage.roe && a.dupont.leverage.v >= R.roeLeverage.multiplier)
      add("roeLeverage", "concern", 1, ["Return on equity of ", n(r, "now"), " rests on a thin equity base: assets are ", { text: fmtFig(a.dupont.leverage.v, "x"), fig: a.dupont.leverage, unit: "x", label: "Equity multiplier" }, " equity."]);

    /* ---- profit and cash */
    const ni = a.keyFigures.find((k) => k.key === "netIncome");
    if (ni?.now && ni.now.v < 0) add("loss", "concern", 3, ["Net loss of ", { text: fmtFig(ni.now.v, "usd", { abs: true }), fig: ni.now, unit: "usd", label: "Net income" }, ` ${over}.`]);
    const fc = a.keyFigures.find((k) => k.key === "fcf");
    const run = get("cashRunway");
    if (fc?.now && fc.now.v < 0)
      add("burn", "concern", run?.now && run.now.v < R.runwayShort ? 3.5 : 2.5, [
        "Free cash flow was ",
        { text: fmtFig(fc.now.v, "usd"), fig: fc.now, unit: "usd", label: "Free cash flow" },
        ` ${over}`,
        ...(run?.now ? ["; cash and short-term investments cover ", n(run, "now"), " at that rate"] : []),
        ".",
      ]);
    const conv = get("fcfConversion");
    if (conv?.now) {
      if (conv.now.v >= R.conversionStrong) add("conversion", "strength", 1.5 + Math.min(1, conv.now.v - 1), ["Free cash flow was ", n(conv, "now"), " of net income."]);
      else if (conv.now.v < R.conversionWeak) add("conversionWeak", "concern", 2 + Math.min(1, R.conversionWeak - conv.now.v), ["Free cash flow was only ", n(conv, "now"), " of net income."]);
    }
    const acc = get("accruals");
    if (acc?.now && acc.now.v >= R.accruals) add("accruals", "concern", 1.5 + Math.min(1.5, acc.now.v * 5), ["Net income ran ahead of cash from operations by ", n(acc, "now"), " of average assets."]);

    /* ---- balance sheet */
    const nd = a.keyFigures.find((k) => k.key === "netDebt");
    const lev = get("netDebtToEbitda");
    if (nd?.now && nd.now.v < 0) add("netCash", "strength", 1.5, ["Cash and short-term investments exceed total debt by ", { text: fmtFig(nd.now.v, "usd", { abs: true }), fig: nd.now, unit: "usd", label: "Net debt" }, "."]);
    else if (lev?.now && lev.now.v >= R.leverageHigh) add("leverage", "concern", 2 + Math.min(2, lev.now.v / 3), ["Net debt is ", n(lev, "now"), " EBITDA."]);
    const cov = get("interestCover");
    if (cov?.now) {
      if (cov.now.v >= R.coverStrong) add("cover", "strength", 1, ["Operating income covers interest expense ", n(cov, "now"), "."]);
      else if (cov.now.v < R.coverWeak) add("coverWeak", "concern", 2.5, ["Operating income covers interest expense only ", n(cov, "now"), "."]);
    }
    const cr = get("currentRatio");
    if (cr?.now && cr.now.v < 1) add("liquidity", "concern", 1, ["Current liabilities exceed current assets: the current ratio is ", n(cr, "now"), "."]);

    /* ---- working capital against revenue */
    const rec = get("receivablesGrowth");
    const dso = get("dso");
    const share = (f: Fig | null) => (f && a.facts.revenue && a.facts.revenue.v > 0 ? f.v / a.facts.revenue.v : 0);
    if (rec?.now && g?.now && rec.now.v > 0.05 && rec.now.v - g.now.v >= R.workingCapitalGap && share(a.facts.receivables) >= R.receivablesShare)
      add("receivables", "concern", 1.5 + Math.min(1.5, rec.now.v - g.now.v), [
        "Receivables grew ",
        n(rec, "now"),
        " over a year while revenue ",
        ...change(g, "now"),
        ...(dso?.now && dso.prior ? ["; days sales outstanding went from ", n(dso, "prior"), " to ", n(dso, "now")] : []),
        ".",
      ]);
    const inv = get("inventoryGrowth");
    if (inv?.now && g?.now && inv.now.v > 0.1 && inv.now.v - g.now.v >= R.workingCapitalGap && share(a.facts.inventory) >= R.inventoryShare) add("inventory", "concern", 1.5 + Math.min(1.5, inv.now.v - g.now.v), ["Inventories grew ", n(inv, "now"), " over a year while revenue ", ...change(g, "now"), "."]);

    /* ---- stock compensation and what is paid out */
    const sbc = get("sbcIntensity");
    if (sbc?.now && sbc.now.v >= R.stockComp) add("stockComp", "concern", 1.5 + Math.min(1.5, sbc.now.v * 3), ["Stock compensation was ", n(sbc, "now"), " of revenue."]);
    const ret = get("returnedToFcf");
    if (ret?.now) {
      if (ret.now.v > R.payoutOver) add("payoutOver", "concern", 1 + Math.min(1, ret.now.v - 1), ["Dividends and repurchases were ", n(ret, "now"), " of free cash flow."]);
      else if (ret.now.v >= 0.5) add("payout", "strength", 0.8, ["Dividends and repurchases returned ", n(ret, "now"), " of free cash flow."]);
    }
  }

  const pick = (side: ReadItem["side"]) =>
    out
      .filter((x) => x.side === side)
      .sort((x, y) => y.weight - x.weight || x.id.localeCompare(y.id))
      .slice(0, R.perSide);
  return { span: a.current, strengths: pick("strength"), concerns: pick("concern") };
}

/** A sentence as plain text (for tests, exports and the assistant). */
export const readText = (item: ReadItem) => item.parts.map((p) => p.text).join("");
