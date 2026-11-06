// Pure fact-pack and table builder for the report library. Every fact and table cell carries
// the reference that produced it (SEC fact, derived formula over SEC facts, filing, call
// transcript URL, market/consensus snapshot or firm coverage), so a report never shows a number
// without its source. No I/O: shared by the server generator, scripts and tests.
import type { Cell, CompanyDataset, DerivedPart, Period, SegmentFact, SourceRef, Statement } from "@/lib/financials/types";
import type { Estimates, PeriodCode } from "@/lib/estimates/core";
import type { Fact, FactArea, FactRef, ReportInputs, ReportTable, TableCell } from "./types";

// ---------- formatting (ASCII minus so the number checker can read it back) ----------
export function money(v: number): string {
  const s = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(2)}`;
}
export const perShare = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
export const pct = (v: number, signed = false) => `${signed && v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
export const mult = (v: number) => `${v.toFixed(1)}x`;
const count = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

const PERIOD_NAME: Record<PeriodCode, string> = { "0q": "current quarter", "+1q": "next quarter", "0y": "current fiscal year", "+1y": "next fiscal year" };

function srcOf(c: Cell): FactRef | null {
  if (c.src) return { kind: "sec", src: c.src, label: c.src.concept };
  if (c.derived?.parts.length) return { kind: "derived", formula: c.derived.formula, parts: c.derived.parts, label: c.derived.formula };
  return null;
}
const partsOf = (c: Cell, label: string): DerivedPart[] =>
  c.src ? [{ ...c.src, label, sign: 1 }] : (c.derived?.parts ?? []);
const ratioRef = (formula: string, a: Cell, al: string, b: Cell, bl: string): FactRef => ({
  kind: "derived", formula, parts: [...partsOf(a, al), ...partsOf(b, bl)], label: formula,
});

function periodName(p: Period, quarterly: boolean): string {
  return quarterly && p.fq ? `Q${p.fq} FY${p.fy}` : `FY${p.fy}`;
}

class Pack {
  facts: Fact[] = [];
  add(area: FactArea, text: string, ref: FactRef | null): string | null {
    if (!ref) return null;
    const id = `F${this.facts.length + 1}`;
    this.facts.push({ id, area, text, ref });
    return id;
  }
  ref(id: string | null): FactRef | undefined {
    return id ? this.facts.find((f) => f.id === id)?.ref : undefined;
  }
}

const rowOf = (st: Statement | undefined, key: string) => st?.rows.find((r) => r.key === key);
const cellAt = (st: Statement | undefined, key: string, i: number): Cell | null => rowOf(st, key)?.cells[i] ?? null;

function fmtUnit(v: number, unit: string): string {
  if (unit === "usdPerShare") return perShare(v);
  if (unit === "pct") return pct(v);
  if (unit === "shares") return `${(v / 1e6).toFixed(0)}M shares`;
  if (unit === "ratio") return v.toFixed(2);
  return money(v);
}

const ANNUAL_LINES: { st: "income" | "cashflow"; key: string; label: string }[] = [
  { st: "income", key: "revenue", label: "revenue" },
  { st: "income", key: "grossProfit", label: "gross profit" },
  { st: "income", key: "operatingIncome", label: "operating income" },
  { st: "income", key: "netIncome", label: "net income" },
  { st: "income", key: "epsDiluted", label: "diluted EPS" },
  { st: "income", key: "rnd", label: "R&D expense" },
  { st: "cashflow", key: "cfo", label: "operating cash flow" },
  { st: "cashflow", key: "capex", label: "capital expenditures" },
  { st: "cashflow", key: "fcf", label: "free cash flow" },
  { st: "cashflow", key: "buybacks", label: "share repurchases" },
  { st: "cashflow", key: "dividends", label: "dividends paid" },
  { st: "cashflow", key: "sbc", label: "stock-based compensation" },
];
const BALANCE_LINES = [
  { key: "cash", label: "cash and equivalents" },
  { key: "shortTermInvestments", label: "short-term investments" },
  { key: "totalDebt", label: "total debt" },
  { key: "netDebt", label: "net debt" },
  { key: "equity", label: "shareholders' equity" },
  { key: "inventory", label: "inventory" },
  { key: "goodwill", label: "goodwill" },
];

export interface ReportData {
  facts: Fact[];
  tables: ReportTable[];
  dataVersion: string;
  background: string;
  latestQuarter: string | null;
  nextEarnings: string | null;
}

/** ISO week label (YYYY-Www) — reports refresh at most weekly unless a new filing lands. */
export function isoWeek(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Version key: changes when a new periodic filing or earnings release lands, or a new week starts. */
export function dataVersionOf(d: CompanyDataset, today: string): string {
  const periodic = d.filings.find((f) => f.form === "10-K" || f.form === "10-Q");
  const release = d.earningsReleases[0];
  return [periodic?.accn ?? "", release?.accn ?? "", isoWeek(today)].join("|");
}

export function buildReportData(inp: ReportInputs): ReportData {
  const { data: d } = inp;
  const p = new Pack();
  const t = d.profile.ticker;
  const A = d.statements.annual;
  const Q = d.statements.quarterly;
  const tables: ReportTable[] = [];
  const tenK = d.filings.find((f) => f.form === "10-K");
  const tenQ = d.filings.find((f) => f.form === "10-Q");

  // ---------- profile & filings ----------
  if (tenK) {
    p.add("profile", `${d.profile.name} (${t}) — ${d.profile.sector} / ${d.profile.industry}; headquartered in ${d.profile.address.city}, ${d.profile.address.state}; fiscal year ends ${d.profile.fiscalYearEnd.slice(0, 2)}/${d.profile.fiscalYearEnd.slice(2)}${d.profile.ceo ? `; CEO ${d.profile.ceo}` : ""}.`,
      { kind: "filing", accn: tenK.accn, doc: tenK.doc, form: tenK.form, filed: tenK.filed, label: `Form 10-K filed ${tenK.filed}` });
    p.add("filings", `Latest annual report: Form 10-K filed ${tenK.filed} for the period ending ${tenK.report ?? "n/a"}.`,
      { kind: "filing", accn: tenK.accn, doc: tenK.doc, form: tenK.form, filed: tenK.filed, label: `Form 10-K filed ${tenK.filed}` });
  }
  if (tenQ) p.add("filings", `Latest quarterly report: Form 10-Q filed ${tenQ.filed} for the period ending ${tenQ.report ?? "n/a"}.`,
    { kind: "filing", accn: tenQ.accn, doc: tenQ.doc, form: tenQ.form, filed: tenQ.filed, label: `Form 10-Q filed ${tenQ.filed}` });
  for (const r of d.earningsReleases.slice(0, 2)) {
    p.add("filings", `Earnings release furnished on Form 8-K on ${r.filed}${r.report ? ` (report date ${r.report})` : ""}.`,
      { kind: "filing", accn: r.accn, doc: r.doc, form: "8-K", filed: r.filed, label: r.title });
  }
  const since = new Date(Date.parse(inp.today) - 120 * 86400000).toISOString().slice(0, 10);
  for (const f of d.filings.filter((x) => x.form === "8-K" && x.filed >= since && x.items && !/^(2\.02,?9\.01|9\.01)$/.test(x.items)).slice(0, 5)) {
    p.add("filings", `Form 8-K filed ${f.filed} reporting items ${f.items}${f.desc && f.desc !== "8-K" ? ` (${f.desc})` : ""}.`,
      { kind: "filing", accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, label: `Form 8-K filed ${f.filed}` });
  }

  // ---------- annual ----------
  const aPeriods = A.income.periods;
  const aIdx = aPeriods.map((_, i) => i).slice(-5);
  const annualIds = new Map<string, (string | null)[]>();
  for (const line of ANNUAL_LINES) {
    const st = A[line.st];
    const ids = aIdx.map((i) => {
      const c = cellAt(st, line.key, i);
      const per = st.periods[i];
      if (!c || !per) return null;
      return p.add("annual", `${periodName(per, false)} ${line.label} (period ended ${per.end}): ${fmtUnit(c.v, rowOf(st, line.key)!.unit)}.`, srcOf(c));
    });
    annualIds.set(line.key, ids);
  }
  const growthIds = new Map<string, (string | null)[]>();
  for (const key of ["revenue", "operatingIncome", "netIncome", "epsDiluted", "fcf"]) {
    const st = key === "fcf" ? A.cashflow : A.income;
    const label = ANNUAL_LINES.find((l) => l.key === key)!.label;
    growthIds.set(key, aIdx.map((i) => {
      const c = cellAt(st, key, i), prev = cellAt(st, key, i - 1);
      const per = st.periods[i], pp = st.periods[i - 1];
      if (!c || !prev || !per || !pp || prev.v <= 0) return null;
      const g = c.v / prev.v - 1;
      return p.add("annual", `${periodName(per, false)} ${label} growth vs ${periodName(pp, false)}: ${pct(g, true)}.`,
        ratioRef(`${label} ${periodName(per, false)} ÷ ${periodName(pp, false)} − 1`, c, periodName(per, false), prev, periodName(pp, false)));
    }));
  }
  const marginIds = new Map<string, (string | null)[]>();
  for (const [key, label, st] of [["grossProfit", "gross margin", A.income], ["operatingIncome", "operating margin", A.income], ["netIncome", "net margin", A.income], ["fcf", "free-cash-flow margin", A.cashflow]] as const) {
    marginIds.set(key, aIdx.map((i) => {
      const num = cellAt(st, key, i), rev = cellAt(A.income, "revenue", i), per = A.income.periods[i];
      if (!num || !rev || !per || rev.v <= 0) return null;
      return p.add("annual", `${periodName(per, false)} ${label}: ${pct(num.v / rev.v)}.`,
        ratioRef(`${label} = ${key} ÷ revenue`, num, key, rev, "Revenue"));
    }));
  }
  // balance sheet at the latest quarter end (fresher than the annual)
  const qbLast = Q.balance.periods.length - 1;
  const qbPer = Q.balance.periods[qbLast] ?? A.balance.periods.at(-1);
  const bal = Q.balance.periods.length ? Q.balance : A.balance;
  const bi = Q.balance.periods.length ? qbLast : A.balance.periods.length - 1;
  const balanceIds = new Map<string, string | null>();
  for (const b of BALANCE_LINES) {
    const c = cellAt(bal, b.key, bi);
    balanceIds.set(b.key, c && qbPer ? p.add("balance", `${b.label} at ${qbPer.end}: ${money(c.v)}.`, srcOf(c)) : null);
  }

  // ---------- quarterly ----------
  const qPeriods = Q.income.periods;
  const qIdx = qPeriods.map((_, i) => i).slice(-8);
  const qIds = new Map<string, (string | null)[]>();
  for (const [key, label] of [["revenue", "revenue"], ["grossProfit", "gross profit"], ["operatingIncome", "operating income"], ["netIncome", "net income"], ["epsDiluted", "diluted EPS"]] as const) {
    qIds.set(key, qIdx.map((i) => {
      const c = cellAt(Q.income, key, i), per = qPeriods[i];
      if (!c || !per) return null;
      return p.add("quarterly", `${periodName(per, true)} ${label} (quarter ended ${per.end}): ${fmtUnit(c.v, rowOf(Q.income, key)!.unit)}.`, srcOf(c));
    }));
  }
  const yoyIdx = (i: number) => {
    const per = qPeriods[i];
    return qPeriods.findIndex((x) => x.fq === per?.fq && x.fy === (per?.fy ?? 0) - 1);
  };
  const qYoyIds = new Map<string, (string | null)[]>();
  for (const [key, label] of [["revenue", "revenue"], ["epsDiluted", "diluted EPS"], ["operatingIncome", "operating income"]] as const) {
    qYoyIds.set(key, qIdx.map((i) => {
      const j = yoyIdx(i);
      const c = cellAt(Q.income, key, i), prev = j >= 0 ? cellAt(Q.income, key, j) : null;
      const per = qPeriods[i], pp = qPeriods[j];
      if (!c || !prev || !per || !pp || prev.v <= 0) return null;
      return p.add("quarterly", `${periodName(per, true)} ${label} year-over-year change vs ${periodName(pp, true)}: ${pct(c.v / prev.v - 1, true)}.`,
        ratioRef(`${label} ${periodName(per, true)} ÷ ${periodName(pp, true)} − 1`, c, periodName(per, true), prev, periodName(pp, true)));
    }));
  }
  const qMarginIds = new Map<string, (string | null)[]>();
  for (const [key, label] of [["grossProfit", "gross margin"], ["operatingIncome", "operating margin"]] as const) {
    qMarginIds.set(key, qIdx.map((i) => {
      const num = cellAt(Q.income, key, i), rev = cellAt(Q.income, "revenue", i), per = qPeriods[i];
      if (!num || !rev || !per || rev.v <= 0) return null;
      return p.add("quarterly", `${periodName(per, true)} ${label}: ${pct(num.v / rev.v)}.`, ratioRef(`${label} = ${key} ÷ revenue`, num, key, rev, "Revenue"));
    }));
  }
  const latestQ = qIdx.length ? qPeriods[qIdx[qIdx.length - 1]] : null;

  // ---------- TTM ----------
  const last4 = qIdx.slice(-4);
  const ttm = (st: Statement, key: string, label: string): { v: number; ref: FactRef } | null => {
    if (last4.length < 4) return null;
    const cells = last4.map((i) => cellAt(st, key, i));
    if (cells.some((c) => !c)) return null;
    const parts = cells.flatMap((c, k) => partsOf(c!, periodName(st.periods[last4[k]], true)));
    return { v: cells.reduce((s, c) => s + c!.v, 0), ref: { kind: "derived", formula: `Sum of last four quarters of ${label}`, parts, label: `TTM ${label}` } };
  };
  const ttmRev = ttm(Q.income, "revenue", "revenue");
  const ttmNi = ttm(Q.income, "netIncome", "net income");
  const ttmEps = ttm(Q.income, "epsDiluted", "diluted EPS");
  const ttmFcf = ttm(Q.cashflow, "fcf", "free cash flow");
  const ttmDiv = ttm(Q.income, "dividendsPerShare", "dividends per share");
  const thru = latestQ ? ` (four quarters through ${latestQ.end})` : "";
  const ttmIds = {
    revenue: ttmRev ? p.add("ttm", `Trailing-twelve-month revenue${thru}: ${money(ttmRev.v)}.`, ttmRev.ref) : null,
    netIncome: ttmNi ? p.add("ttm", `Trailing-twelve-month net income${thru}: ${money(ttmNi.v)}.`, ttmNi.ref) : null,
    eps: ttmEps ? p.add("ttm", `Trailing-twelve-month diluted EPS${thru}: ${perShare(ttmEps.v)}.`, ttmEps.ref) : null,
    fcf: ttmFcf ? p.add("ttm", `Trailing-twelve-month free cash flow${thru}: ${money(ttmFcf.v)}.`, ttmFcf.ref) : null,
  };

  // ---------- segments ----------
  const segTables = segmentFacts(p, d.segments);
  // ---------- valuation ----------
  const valuationRows: ReportTable["rows"] = [];
  if (inp.price) {
    const priceRef: FactRef = { kind: "market", label: "Share price", asOf: inp.price.asOf };
    const priceId = p.add("valuation", `Share price as of ${inp.price.asOf}: ${perShare(inp.price.price)}.`, priceRef);
    valuationRows.push({ label: "Share price", cells: [{ text: perShare(inp.price.price), ref: p.ref(priceId) }, { text: `As of ${inp.price.asOf}` }] });
    const sharesCell = cellAt(Q.balance, "sharesOutstanding", Q.balance.periods.length - 1) ?? cellAt(Q.income, "sharesDiluted", qPeriods.length - 1);
    if (sharesCell) {
      const mcap = inp.price.price * sharesCell.v;
      const mcapRef: FactRef = { kind: "derived", formula: "Share price × shares outstanding", parts: partsOf(sharesCell, "Shares outstanding"), label: "Market capitalization" };
      const mcapId = p.add("valuation", `Market capitalization at ${perShare(inp.price.price)}: ${money(mcap)} (${(sharesCell.v / 1e6).toFixed(0)}M shares).`, mcapRef);
      valuationRows.push({ label: "Market cap", cells: [{ text: money(mcap), ref: p.ref(mcapId) }, { text: "Price × shares outstanding" }] });
      const debt = cellAt(bal, "totalDebt", bi), cash = cellAt(bal, "cash", bi), sti = cellAt(bal, "shortTermInvestments", bi);
      let ev: number | null = null;
      if (debt && cash) {
        ev = mcap + debt.v - cash.v - (sti?.v ?? 0);
        const evRef: FactRef = { kind: "derived", formula: "Market cap + total debt − cash − short-term investments", parts: [...partsOf(sharesCell, "Shares outstanding"), ...partsOf(debt, "Total debt"), ...partsOf(cash, "Cash"), ...(sti ? partsOf(sti, "Short-term investments") : [])], label: "Enterprise value" };
        const evId = p.add("valuation", `Enterprise value: ${money(ev)}.`, evRef);
        valuationRows.push({ label: "Enterprise value", cells: [{ text: money(ev), ref: p.ref(evId) }, { text: "Market cap + debt − cash" }] });
      }
      if (ttmEps && ttmEps.v > 0) {
        const id = p.add("valuation", `Price-to-earnings on trailing diluted EPS: ${mult(inp.price.price / ttmEps.v)}.`, { kind: "derived", formula: "Share price ÷ TTM diluted EPS", parts: (ttmEps.ref as Extract<FactRef, { kind: "derived" }>).parts, label: "P/E (TTM)" });
        valuationRows.push({ label: "P/E (TTM)", cells: [{ text: mult(inp.price.price / ttmEps.v), ref: p.ref(id) }, { text: "Price ÷ TTM diluted EPS" }] });
      }
      if (ev != null && ttmRev && ttmRev.v > 0) {
        const id = p.add("valuation", `Enterprise value to trailing revenue: ${mult(ev / ttmRev.v)}.`, { kind: "derived", formula: "EV ÷ TTM revenue", parts: (ttmRev.ref as Extract<FactRef, { kind: "derived" }>).parts, label: "EV/Sales (TTM)" });
        valuationRows.push({ label: "EV / Sales (TTM)", cells: [{ text: mult(ev / ttmRev.v), ref: p.ref(id) }, { text: "EV ÷ TTM revenue" }] });
      }
      if (ttmFcf) {
        const id = p.add("valuation", `Free-cash-flow yield (TTM free cash flow ÷ market cap): ${pct(ttmFcf.v / mcap)}.`, { kind: "derived", formula: "TTM free cash flow ÷ market cap", parts: (ttmFcf.ref as Extract<FactRef, { kind: "derived" }>).parts, label: "FCF yield" });
        valuationRows.push({ label: "FCF yield", cells: [{ text: pct(ttmFcf.v / mcap), ref: p.ref(id) }, { text: "TTM FCF ÷ market cap" }] });
      }
      if (ttmDiv && ttmDiv.v > 0) {
        const id = p.add("valuation", `Dividend yield (TTM dividends per share ÷ price): ${pct(ttmDiv.v / inp.price.price)}.`, { kind: "derived", formula: "TTM dividends per share ÷ share price", parts: (ttmDiv.ref as Extract<FactRef, { kind: "derived" }>).parts, label: "Dividend yield" });
        valuationRows.push({ label: "Dividend yield", cells: [{ text: pct(ttmDiv.v / inp.price.price), ref: p.ref(id) }, { text: "TTM DPS ÷ price" }] });
      }
    }
  }
  const nd = balanceIds.get("netDebt");
  if (nd) valuationRows.push({ label: "Net debt", cells: [{ text: p.facts.find((f) => f.id === nd)!.text.split(": ").pop()!.replace(/\.$/, ""), ref: p.ref(nd) }, { text: `At ${qbPer?.end ?? ""}` }] });

  // ---------- estimates ----------
  const est = inp.estimates;
  const estRows: ReportTable["rows"] = [];
  let nextEarnings: string | null = null;
  if (est) {
    const mref = (label: string): FactRef => ({ kind: "market", label, asOf: est.asOf.slice(0, 10) });
    for (const per of est.periods) {
      const name = PERIOD_NAME[per.code];
      const e = per.eps, r = per.revenue;
      const ids: (string | null)[] = [];
      if (e.avg != null) ids.push(p.add("estimates", `Consensus diluted EPS for the ${name}${per.endDate ? ` (ending ${per.endDate})` : ""}: ${perShare(e.avg)}${e.low != null && e.high != null ? `, range ${perShare(e.low)} to ${perShare(e.high)}` : ""}${e.analysts ? `, ${e.analysts} analysts` : ""}${e.yearAgo != null ? `; year-ago EPS ${perShare(e.yearAgo)}` : ""}.`, mref(`Consensus EPS, ${name}`)));
      if (r.avg != null) ids.push(p.add("estimates", `Consensus revenue for the ${name}: ${money(r.avg)}${r.low != null && r.high != null ? `, range ${money(r.low)} to ${money(r.high)}` : ""}${r.yearAgo != null ? `; year-ago revenue ${money(r.yearAgo)}` : ""}${r.growth != null ? ` (implied growth ${pct(r.growth, true)})` : ""}.`, mref(`Consensus revenue, ${name}`)));
      const tr = per.trend;
      let rev30: number | null = null;
      if (tr.current != null && tr.d90 != null && tr.d90 !== 0) {
        rev30 = tr.d30 != null && tr.d30 !== 0 ? tr.current / tr.d30 - 1 : null;
        p.add("estimates", `Consensus EPS for the ${name} was ${perShare(tr.d90)} 90 days ago, ${tr.d30 != null ? `${perShare(tr.d30)} 30 days ago, ` : ""}and is ${perShare(tr.current)} now (${pct(tr.current / tr.d90 - 1, true)} over 90 days).`, mref(`EPS revisions, ${name}`));
      }
      if (per.revisions.up30 != null || per.revisions.down30 != null) {
        p.add("estimates", `Last 30 days of EPS estimate revisions for the ${name}: ${per.revisions.up30 ?? 0} up, ${per.revisions.down30 ?? 0} down.`, mref(`Revision count, ${name}`));
      }
      estRows.push({ label: name[0].toUpperCase() + name.slice(1), cells: [
        { text: per.endDate ?? "—" },
        e.avg != null ? { text: perShare(e.avg), ref: p.ref(ids[0] ?? null) } : null,
        e.low != null && e.high != null ? { text: `${perShare(e.low)}–${perShare(e.high)}` } : null,
        r.avg != null ? { text: money(r.avg), ref: p.ref(ids[ids.length - 1] ?? null) } : null,
        { text: e.analysts != null ? String(e.analysts) : "—" },
        rev30 != null ? { text: pct(rev30, true), tone: rev30 >= 0 ? "positive" : "negative" } : null,
      ] });
    }
    const tg = est.target;
    if (tg.mean != null) p.add("street", `Street price target: mean ${perShare(tg.mean)}${tg.median != null ? `, median ${perShare(tg.median)}` : ""}${tg.low != null ? `, low ${perShare(tg.low)}` : ""}${tg.high != null ? `, high ${perShare(tg.high)}` : ""}${tg.analysts ? ` (${tg.analysts} analysts)` : ""}.`, mref("Street price targets"));
    if (est.rating.mean != null) p.add("street", `Average street rating ${est.rating.mean.toFixed(2)} on a 1 (strong buy) to 5 (sell) scale${est.rating.key ? ` — "${est.rating.key}"` : ""}.`, mref("Street rating"));
    const lastRatings = est.ratings[0];
    if (lastRatings) p.add("street", `Current rating mix: ${lastRatings.strongBuy} strong buy, ${lastRatings.buy} buy, ${lastRatings.hold} hold, ${lastRatings.sell} sell, ${lastRatings.strongSell} strong sell.`, mref("Rating distribution"));
    for (const s of est.surprises.slice(0, 4)) {
      if (s.actual == null || s.estimate == null) continue;
      p.add("estimates", `Reported EPS for the quarter ended ${s.quarter}: ${perShare(s.actual)} versus consensus ${perShare(s.estimate)}${s.surprisePct != null ? ` (${pct(s.surprisePct, true)} surprise)` : ""}.`, mref(`EPS surprise ${s.quarter}`));
    }
    const recent = new Date(Date.parse(inp.today) - 90 * 86400000).toISOString().slice(0, 10);
    for (const a of est.actions.filter((x) => x.date >= recent).slice(0, 10)) {
      const verb = ({ main: "maintained", reit: "reiterated", up: "upgraded to", down: "downgraded to", init: "initiated at" } as Record<string, string>)[a.action] ?? "rated";
      p.add("street", `${a.date}: ${a.firm} ${verb} ${a.toGrade}${a.fromGrade && a.fromGrade !== a.toGrade ? ` (from ${a.fromGrade})` : ""}${a.target != null ? `, price target ${a.priorTarget != null ? `${perShare(a.priorTarget)} → ` : ""}${perShare(a.target)}` : ""}.`, mref(`${a.firm} action ${a.date}`));
    }
    if (est.nextEarnings?.start) {
      nextEarnings = est.nextEarnings.start;
      p.add("estimates", `Next earnings date expected ${est.nextEarnings.start}${est.nextEarnings.end && est.nextEarnings.end !== est.nextEarnings.start ? ` to ${est.nextEarnings.end}` : ""}.`, mref("Earnings calendar"));
    }
  }

  // ---------- reactions ----------
  const reactRows: ReportTable["rows"] = [];
  if (inp.reactions?.stats && inp.reactions.stats.n) {
    const s = inp.reactions.stats;
    const last = inp.reactions.reactions[0];
    p.add("reactions", `Across the last ${s.n} earnings releases the stock moved ${pct(s.avgAbsMove)} on average (absolute, close before release to the close after), rose ${pct(s.upRate)} of the time${s.avgExcess != null ? `, average move versus SPY ${pct(s.avgExcess, true)}` : ""}${s.avgDrift20 != null ? `; average 20-day drift afterwards ${pct(s.avgDrift20, true)}` : ""}.`,
      last ? { kind: "filing", accn: last.accn, doc: last.doc, form: "8-K", filed: last.date, label: "Earnings releases; prices from market data" } : null);
    for (const r of inp.reactions.reactions.slice(0, 8)) {
      const id = p.add("reactions", `Earnings release ${r.date}: stock ${pct(r.move, true)}${r.excess != null ? ` (${pct(r.excess, true)} versus SPY)` : ""}${r.drift20 != null ? `, then ${pct(r.drift20, true)} over the next 20 sessions` : ""}.`,
        { kind: "filing", accn: r.accn, doc: r.doc, form: "8-K", filed: r.date, label: `Earnings release ${r.date}` });
      reactRows.push({ label: r.date, cells: [
        { text: pct(r.move, true), ref: p.ref(id), tone: r.move >= 0 ? "positive" : "negative" },
        r.excess != null ? { text: pct(r.excess, true) } : null,
        r.drift20 != null ? { text: pct(r.drift20, true) } : null,
      ] });
    }
  }

  // ---------- promises ----------
  for (const pr of (inp.promises ?? []).slice(0, 12)) {
    p.add("promises", `Management commitment on the ${pr.callDate} call (${pr.category}): ${pr.summary} Status: ${pr.status}${pr.deadline ? `; timeframe ${pr.deadline}` : ""}. Quote: "${pr.quote.slice(0, 260)}"`,
      { kind: "web", url: pr.callUrl, label: `Earnings call ${pr.callDate}`, date: pr.callDate, quote: pr.quote });
    if (pr.outcomeQuote && pr.outcomeUrl) {
      p.add("promises", `Follow-up on the ${pr.outcomeCallDate} call about "${pr.summary}": "${pr.outcomeQuote.slice(0, 260)}"`,
        { kind: "web", url: pr.outcomeUrl, label: `Earnings call ${pr.outcomeCallDate}`, date: pr.outcomeCallDate ?? undefined, quote: pr.outcomeQuote });
    }
  }

  // ---------- insiders ----------
  const yearAgo = new Date(Date.parse(inp.today) - 365 * 86400000).toISOString().slice(0, 10);
  const trades = d.insiders.filter((x) => (x.code === "P" || x.code === "S") && x.date >= yearAgo && x.price);
  const buys = trades.filter((x) => x.code === "P"), sells = trades.filter((x) => x.code === "S");
  for (const x of [...trades].sort((a, b) => b.shares * (b.price ?? 0) - a.shares * (a.price ?? 0)).slice(0, 8)) {
    p.add("insiders", `${x.date}: ${x.owner} (${x.role}) ${x.code === "P" ? "bought" : "sold"} ${count(x.shares)} shares at ${perShare(x.price!)} (${money(x.shares * x.price!)})${x.plan10b5 ? " under a 10b5-1 plan" : " on the open market"}.`,
      { kind: "filing", accn: x.accn, doc: x.doc, form: "4", filed: x.filed, label: `Form 4 filed ${x.filed}` });
  }
  if (trades.length) {
    const latest = trades[0];
    p.add("insiders", `Open-market insider activity over the past 12 months: ${buys.length} purchase transactions and ${sells.length} sale transactions reported on Form 4.`,
      { kind: "filing", accn: latest.accn, doc: latest.doc, form: "4", filed: latest.filed, label: "Form 4 filings, last 12 months" });
  }

  // ---------- firm coverage ----------
  if (inp.coverage) {
    const c = inp.coverage;
    p.add("coverage", `${c.firm} rating: ${c.rating}${c.target != null ? `, price target ${perShare(c.target)}` : ""}${c.analyst ? ` (analyst ${c.analyst})` : ""}, last updated ${c.updatedAt.slice(0, 10)}.`, { kind: "firm", label: `${c.firm} coverage`, asOf: c.updatedAt.slice(0, 10) });
  }

  // ---------- tables ----------
  const aCols = aIdx.map((i) => periodName(aPeriods[i], false));
  const rowFrom = (label: string, ids: (string | null)[] | undefined, bold = false, toneSign = false): ReportTable["rows"][number] => ({
    label, bold,
    cells: (ids ?? []).map((id) => {
      if (!id) return null;
      const f = p.facts.find((x) => x.id === id)!;
      const text = f.text.split(": ").pop()!.replace(/\.$/, "");
      return { text, ref: f.ref, tone: toneSign ? (text.startsWith("-") ? "negative" : "positive") : undefined } as TableCell;
    }),
  });
  if (aIdx.length) {
    tables.push({
      id: "financials", title: "Annual financial summary", columns: aCols,
      rows: [
        rowFrom("Revenue", annualIds.get("revenue"), true),
        rowFrom("Growth", growthIds.get("revenue"), false, true),
        rowFrom("Gross margin", marginIds.get("grossProfit")),
        rowFrom("Operating income", annualIds.get("operatingIncome")),
        rowFrom("Operating margin", marginIds.get("operatingIncome")),
        rowFrom("Net income", annualIds.get("netIncome")),
        rowFrom("Diluted EPS", annualIds.get("epsDiluted"), true),
        rowFrom("EPS growth", growthIds.get("epsDiluted"), false, true),
        rowFrom("Free cash flow", annualIds.get("fcf")),
        rowFrom("FCF margin", marginIds.get("fcf")),
        rowFrom("Share repurchases", annualIds.get("buybacks")),
      ].filter((r) => r.cells.some(Boolean)),
      note: "From 10-K XBRL; growth and margins are calculated from the reported values.",
    });
  }
  if (qIdx.length) {
    tables.push({
      id: "quarters", title: "Last eight quarters", columns: qIdx.map((i) => periodName(qPeriods[i], true)),
      rows: [
        rowFrom("Revenue", qIds.get("revenue"), true),
        rowFrom("YoY", qYoyIds.get("revenue"), false, true),
        rowFrom("Gross margin", qMarginIds.get("grossProfit")),
        rowFrom("Operating margin", qMarginIds.get("operatingIncome")),
        rowFrom("Net income", qIds.get("netIncome")),
        rowFrom("Diluted EPS", qIds.get("epsDiluted"), true),
        rowFrom("EPS YoY", qYoyIds.get("epsDiluted"), false, true),
      ].filter((r) => r.cells.some(Boolean)),
      note: "From 10-Q/10-K XBRL; fourth quarters are derived as fiscal year minus the first three quarters.",
    });
  }
  if (valuationRows.length) tables.push({ id: "valuation", title: "Valuation snapshot", columns: ["Value", "Basis"], rows: valuationRows, note: inp.price ? `Share price as of ${inp.price.asOf} (market data); fundamentals from SEC filings.` : undefined });
  if (estRows.length) tables.push({ id: "estimates", title: "Street consensus", columns: ["Period ends", "EPS", "EPS range", "Revenue", "Analysts", "EPS rev. 30d"], rows: estRows, note: `Third-party consensus as of ${est!.asOf.slice(0, 10)}.` });
  tables.push(...segTables);
  if (reactRows.length) tables.push({ id: "reactions", title: "Stock reaction to recent earnings", columns: ["Move", "vs SPY", "Next 20 days"], rows: reactRows, note: "Close before the release to the close after; dates link to the earnings release." });

  const co = d.profile.description?.trim();
  return {
    facts: p.facts,
    tables,
    dataVersion: dataVersionOf(d, inp.today),
    background: co ? co.slice(0, 1200) : "",
    latestQuarter: latestQ ? periodName(latestQ, true) : null,
    nextEarnings,
  };
}

/** Latest fiscal-year segment revenue for the main business and geographic axes. */
function segmentFacts(p: Pack, segs: SegmentFact[]): ReportTable[] {
  const annual = segs.filter((s) => s.metric === "revenue" && s.start && (Date.parse(s.end) - Date.parse(s.start)) / 86400000 > 350);
  if (!annual.length) return [];
  const latestEnd = annual.reduce((m, s) => (s.end > m ? s.end : m), "");
  const byAxis = new Map<string, SegmentFact[]>();
  for (const s of annual.filter((x) => x.end === latestEnd)) byAxis.set(s.axis, [...(byAxis.get(s.axis) ?? []), s]);
  const rank = (axis: string) => (/BusinessSegments|Segment/i.test(axis) ? 0 : /Product|Service/i.test(axis) ? 1 : /Geograph|Region|Country/i.test(axis) ? 2 : 3);
  const axes = [...byAxis.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length).slice(0, 2);
  const out: ReportTable[] = [];
  for (const [axis, members] of axes) {
    const uniq = [...new Map(members.map((m) => [m.member, m])).values()].sort((a, b) => b.value - a.value).slice(0, 8);
    const total = uniq.reduce((s, m) => s + m.value, 0);
    const label = uniq[0].axisLabel;
    const fy = latestEnd.slice(0, 4);
    const rows: ReportTable["rows"] = [];
    for (const m of uniq) {
      const src: SourceRef = { accn: m.accn, concept: m.concept, start: m.start, end: m.end, value: m.value };
      const id = p.add("segments", `Segment revenue for the fiscal year ended ${latestEnd} — ${m.label} (${label}): ${money(m.value)}, ${pct(m.value / total)} of the reported ${label.toLowerCase()} total.`, { kind: "sec", src, label: m.concept });
      const prev = annual.find((x) => x.axis === axis && x.member === m.member && x.end.slice(0, 4) === String(Number(fy) - 1));
      let yoy: string | null = null;
      if (prev && prev.value > 0) {
        yoy = pct(m.value / prev.value - 1, true);
        p.add("segments", `${m.label} (${label}) revenue change for the fiscal year ended ${latestEnd} versus the prior year: ${yoy}.`, {
          kind: "derived", formula: `${m.label} revenue ÷ prior-year − 1`, label: `${m.label} growth`,
          parts: [{ ...src, label: latestEnd, sign: 1 }, { accn: prev.accn, concept: prev.concept, start: prev.start, end: prev.end, value: prev.value, label: prev.end, sign: 1 }],
        });
      }
      rows.push({ label: m.label, cells: [{ text: money(m.value), ref: p.ref(id) }, { text: pct(m.value / total) }, yoy ? { text: yoy, tone: yoy.startsWith("-") ? "negative" : "positive" } : null] });
    }
    out.push({ id: `segments-${out.length + 1}`, title: `Revenue by ${label.toLowerCase()} (FY ending ${latestEnd})`, columns: ["Revenue", "Share", "YoY"], rows, note: "Segment facts from the 10-K XBRL; shares are of the members shown." });
  }
  return out;
}
