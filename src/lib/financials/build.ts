// Turns SEC "companyfacts" XBRL JSON into standardized, source-attributed
// annual and quarterly statements. Pure functions: used by the ingest script
// and covered by unit tests.
import { BALANCE_LINES, CASHFLOW_LINES, INCOME_LINES, type LineDef } from "./schema";
import type { Cell, DerivedPart, Period, Row, SourceRef, Statement, StatementKey } from "./types";

export interface RawFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number | null;
  fp?: string | null;
  form: string;
  filed: string;
  frame?: string;
}

export interface CompanyFacts {
  facts: Record<string, Record<string, { label?: string; units: Record<string, RawFact[]> }>>;
}

const DAY = 86_400_000;
export const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const durationDays = (s: string, e: string) => Math.round((toTime(e) - toTime(s)) / DAY);
export const addDays = (d: string, n: number) => new Date(toTime(d) + n * DAY).toISOString().slice(0, 10);
const near = (a: string | undefined, b: string | undefined, tol = 5) =>
  !!a && !!b && Math.abs(toTime(a) - toTime(b)) <= tol * DAY;

/** Fiscal years are labelled by the calendar year they end in, except 52/53-week years ending in the first week of January. */
export function fiscalYearFromEnd(end: string): number {
  const d = new Date(toTime(end));
  let y = d.getUTCFullYear();
  if (d.getUTCMonth() === 0 && d.getUTCDate() <= 7) y -= 1;
  return y;
}

const PERIODIC_FORM = /^(10-K|10-Q|10-KT|10-QT)(\/A)?$/;
const isAnnualForm = (f: string) => f.startsWith("10-K");

function unitKey(def: LineDef) {
  return def.unit === "usdPerShare" ? "USD/shares" : def.unit === "shares" ? "shares" : "USD";
}

export function factsFor(cf: CompanyFacts, concept: string, unit: string): RawFact[] {
  const node = cf.facts["us-gaap"]?.[concept];
  const list = node?.units?.[unit] ?? [];
  return list.filter((f) => PERIODIC_FORM.test(f.form));
}

export interface FiscalYear {
  fy: number;
  start: string;
  end: string;
  /** Ends of Q1, Q2, Q3 (Q4 ends with the fiscal year). Empty when undetectable. */
  qEnds: string[];
  /** Fiscal year still in progress (no 10-K yet); `end` is estimated. */
  partial?: boolean;
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && best !== undefined && v < best)) [best, n] = [v, c];
  return best;
}

function allDurationFacts(cf: CompanyFacts): RawFact[] {
  const out: RawFact[] = [];
  for (const def of [...INCOME_LINES, ...CASHFLOW_LINES]) {
    if (def.unit !== "usd") continue;
    for (const c of def.concepts) for (const f of factsFor(cf, c, "USD")) if (f.start) out.push(f);
  }
  return out;
}

export function detectFiscalYears(cf: CompanyFacts): FiscalYear[] {
  const durations = allDurationFacts(cf);
  const annual = durations.filter((f) => isAnnualForm(f.form) && f.start && inRange(durationDays(f.start, f.end), 350, 380));
  // Cluster annual periods by end date.
  const byEnd = new Map<string, string[]>();
  for (const f of annual) {
    const key = [...byEnd.keys()].find((k) => near(k, f.end, 6)) ?? f.end;
    byEnd.set(key, [...(byEnd.get(key) ?? []), f.start!]);
  }
  const years: FiscalYear[] = [];
  for (const [end, starts] of byEnd) {
    const start = mostCommon(starts)!;
    const fromStart = durations.filter((f) => near(f.start, start, 4));
    const bucket = (lo: number, hi: number) =>
      mostCommon(fromStart.filter((f) => inRange(durationDays(f.start!, f.end), lo, hi)).map((f) => f.end));
    let q1 = bucket(80, 100);
    let q2 = bucket(170, 195);
    let q3 = bucket(260, 285);
    if (!q1 || !q2 || !q3) {
      // Fall back to discrete three-month periods inside the year.
      const discreteEnds = durations
        .filter(
          (f) =>
            inRange(durationDays(f.start!, f.end), 80, 100) &&
            toTime(f.end) > toTime(start) + 60 * DAY &&
            toTime(f.end) < toTime(end) - 30 * DAY,
        )
        .map((f) => f.end)
        .sort();
      const clusters: string[] = [];
      for (const e of discreteEnds) if (!clusters.some((c) => near(c, e, 6))) clusters.push(e);
      if (clusters.length === 3) [q1, q2, q3] = clusters;
    }
    years.push({ fy: fiscalYearFromEnd(end), start, end, qEnds: q1 && q2 && q3 ? [q1, q2, q3] : [] });
  }
  years.sort((a, b) => toTime(a.end) - toTime(b.end));

  // Fiscal year in progress: 10-Q periods that start the day after the last 10-K year.
  const last = years.at(-1);
  if (last) {
    const start = addDays(last.end, 1);
    const fromStart = durations.filter((f) => near(f.start, start, 4) && f.form.startsWith("10-Q"));
    const bucket = (lo: number, hi: number) =>
      mostCommon(fromStart.filter((f) => inRange(durationDays(f.start!, f.end), lo, hi)).map((f) => f.end));
    const qEnds = [bucket(80, 100), bucket(170, 195), bucket(260, 285)].filter((x): x is string => !!x);
    if (qEnds.length) {
      const end = addDays(start, durationDays(last.start, last.end));
      years.push({ fy: fiscalYearFromEnd(end), start, end, qEnds, partial: true });
    }
  }
  return years;
}

function inRange(n: number, lo: number, hi: number) {
  return n >= lo && n <= hi;
}

export function buildPeriods(years: FiscalYear[]) {
  const annual: Period[] = years
    .filter((y) => !y.partial)
    .map((y) => ({ key: `FY${y.fy}`, label: `FY${y.fy}`, fy: y.fy, start: y.start, end: y.end }));
  const quarterly: Period[] = [];
  for (const y of years) {
    if (!y.partial && y.qEnds.length !== 3) continue;
    const ends = y.partial ? [...y.qEnds] : [...y.qEnds, y.end];
    ends.forEach((end, i) => {
      const start = i === 0 ? y.start : addDays(ends[i - 1], 1);
      quarterly.push({
        key: `FY${y.fy}Q${i + 1}`,
        label: `Q${i + 1} FY${String(y.fy).slice(2)}`,
        fy: y.fy,
        fq: i + 1,
        start,
        end,
      });
    });
  }
  return { annual, quarterly };
}

interface Picked {
  fact: RawFact;
  concept: string;
  alts: string[];
}

function choose(list: RawFact[], concept: string, pred: (f: RawFact) => boolean): Picked | undefined {
  const matches = list.filter(pred);
  if (!matches.length) return undefined;
  const sorted = [...matches].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  const fact = sorted[0];
  const alts = [...new Set(sorted.slice(1).filter((f) => f.val === fact.val && f.accn !== fact.accn).map((f) => f.accn))];
  return { fact, concept, alts };
}

const ref = (p: Picked): SourceRef => ({
  accn: p.fact.accn,
  concept: `us-gaap:${p.concept}`,
  ...(p.fact.start ? { start: p.fact.start } : {}),
  end: p.fact.end,
  value: p.fact.val,
});

const reportedCell = (p: Picked): Cell => ({ v: p.fact.val, src: ref(p), ...(p.alts.length ? { alts: p.alts } : {}) });

function firstConcept(
  cf: CompanyFacts,
  def: LineDef,
  pred: (f: RawFact) => boolean,
): Picked | undefined {
  for (const c of def.concepts) {
    const p = choose(factsFor(cf, c, unitKey(def)), c, pred);
    if (p) return p;
  }
  return undefined;
}

const isDuration = (lo: number, hi: number) => (f: RawFact) => !!f.start && inRange(durationDays(f.start, f.end), lo, hi);

/** Reported value for the line, or — when the line defines components — the sum of the components reported for the same period. */
function pickCell(cf: CompanyFacts, def: LineDef, pred: (f: RawFact) => boolean): Cell | null {
  const picked = firstConcept(cf, def, pred);
  if (picked) return reportedCell(picked);
  if (!def.components?.length) return null;
  const found = def.components
    .map((c) => choose(factsFor(cf, c, unitKey(def)), c, pred))
    .filter((x): x is Picked => !!x);
  if (!found.length) return null;
  if (found.length === 1) return reportedCell(found[0]);
  const names = found.map((x) => humanizeConcept(x.concept));
  return {
    v: found.reduce((sum, x) => sum + x.fact.val, 0),
    derived: { formula: names.join(" + "), parts: found.map((x, i) => ({ ...ref(x), label: names[i], sign: 1 as const })) },
  };
}

/** "CommercialPaper" → "Commercial paper" */
export function humanizeConcept(c: string) {
  const s = c.replace(/^us-gaap:/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function annualCell(cf: CompanyFacts, def: LineDef, p: Period): Cell | null {
  return def.kind === "stock"
    ? pickCell(cf, def, (f) => !f.start && near(f.end, p.end, 4))
    : pickCell(
        cf,
        def,
        (f) => isAnnualForm(f.form) && isDuration(350, 380)(f) && near(f.start, p.start, 4) && near(f.end, p.end, 4),
      );
}

const YTD_LABEL = ["3M", "6M YTD", "9M YTD"];

function quarterCell(
  cf: CompanyFacts,
  def: LineDef,
  p: Period,
  year: FiscalYear,
  prevCells: (Cell | null)[],
): Cell | null {
  if (def.kind === "stock") return pickCell(cf, def, (f) => !f.start && near(f.end, p.end, 4));
  const direct = firstConcept(cf, def, (f) => isDuration(80, 100)(f) && near(f.start, p.start, 4) && near(f.end, p.end, 4));
  if (direct) return reportedCell(direct);
  if (!def.additive || !p.fq || p.fq === 1) return null;

  const k = p.fq;
  const approx = def.unit === "usdPerShare";
  for (const c of def.concepts) {
    const list = factsFor(cf, c, unitKey(def));
    const cum =
      k === 4
        ? choose(list, c, (f) => isAnnualForm(f.form) && isDuration(350, 380)(f) && near(f.start, year.start, 4) && near(f.end, year.end, 4))
        : choose(list, c, (f) => near(f.start, year.start, 4) && near(f.end, p.end, 4) && isDuration(160, 290)(f));
    if (!cum) continue;
    const cumLabel = k === 4 ? `FY${year.fy} total (10-K)` : `${YTD_LABEL[k - 1]} (Q${k} 10-Q)`;
    const prevEnd = year.qEnds[k - 2];
    const prevCum =
      k - 1 === 1
        ? choose(list, c, (f) => near(f.start, year.start, 4) && near(f.end, prevEnd, 4) && isDuration(80, 100)(f))
        : choose(list, c, (f) => near(f.start, year.start, 4) && near(f.end, prevEnd, 4) && isDuration(160, 290)(f));
    if (prevCum) {
      const prevLabel = k - 1 === 1 ? "Q1 (3M)" : `${YTD_LABEL[k - 2]} (Q${k - 1} 10-Q)`;
      const parts: DerivedPart[] = [
        { ...ref(cum), label: cumLabel, sign: 1 },
        { ...ref(prevCum), label: prevLabel, sign: -1 },
      ];
      return {
        v: round(cum.fact.val - prevCum.fact.val, def.unit),
        derived: { formula: `${cumLabel.split(" (")[0]} − ${prevLabel.split(" (")[0]}`, parts },
        ...(approx ? { approx } : {}),
      };
    }
    // Sum of earlier discrete quarters, when each was reported directly.
    const earlier = prevCells.slice(-(k - 1));
    if (earlier.length === k - 1 && earlier.every((x) => x?.src)) {
      const parts: DerivedPart[] = [
        { ...ref(cum), label: cumLabel, sign: 1 },
        ...earlier.map((x, i) => ({ ...x!.src!, label: `Q${i + 1}`, sign: -1 as const })),
      ];
      const v = cum.fact.val - earlier.reduce((s, x) => s + x!.v, 0);
      return {
        v: round(v, def.unit),
        derived: { formula: `${cumLabel.split(" (")[0]} − ${earlier.map((_, i) => `Q${i + 1}`).join(" − ")}`, parts },
        ...(approx ? { approx } : {}),
      };
    }
  }
  return null;
}

function round(v: number, unit: string) {
  return unit === "usdPerShare" ? Math.round(v * 100) / 100 : v;
}

export function partsFrom(cell: Cell | null | undefined, label: string, sign: 1 | -1): DerivedPart[] {
  if (!cell) return [];
  if (cell.src) return [{ ...cell.src, label, sign }];
  return (cell.derived?.parts ?? []).map((p) => ({ ...p, sign: (p.sign * sign) as 1 | -1, label: `${label} · ${p.label}` }));
}

const OP_SYMBOL = { add: "+", sub: "−", div: "÷" } as const;

export function combine(
  a: Cell | null,
  b: Cell | null,
  op: "add" | "sub" | "div",
  labels: [string, string],
): Cell | null {
  if (!a || !b) return null;
  if (op === "div" && b.v === 0) return null;
  const v = op === "add" ? a.v + b.v : op === "sub" ? a.v - b.v : a.v / b.v;
  return {
    v,
    derived: {
      formula: `${labels[0]} ${OP_SYMBOL[op]} ${labels[1]}`,
      parts: [...partsFrom(a, labels[0], 1), ...partsFrom(b, labels[1], op === "sub" ? -1 : 1)],
    },
  };
}

function buildStatement(
  cf: CompanyFacts,
  defs: LineDef[],
  periods: Period[],
  years: FiscalYear[],
  freq: "annual" | "quarterly",
): Row[] {
  return defs.map((def) => {
    const cells: (Cell | null)[] = [];
    periods.forEach((p) => {
      if (freq === "annual") {
        cells.push(annualCell(cf, def, p));
      } else {
        const year = years.find((y) => y.fy === p.fy)!;
        const sameYearPrev = cells.filter((_, i) => periods[i].fy === p.fy);
        cells.push(quarterCell(cf, def, p, year, sameYearPrev));
      }
    });
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      cells,
      ...(def.indent ? { indent: def.indent } : {}),
      ...(def.bold ? { bold: true } : {}),
      kind: "reported" as const,
    };
  });
}

const rowOf = (rows: Row[], key: string) => rows.find((r) => r.key === key);

function fillDerived(rows: Row[], key: string, a: string, b: string, labels: [string, string]) {
  const target = rowOf(rows, key);
  const ra = rowOf(rows, a);
  const rb = rowOf(rows, b);
  if (!target || !ra || !rb) return;
  target.cells = target.cells.map((c, i) => c ?? combine(ra.cells[i], rb.cells[i], "sub", labels));
}

function pruneEmptyRows(rows: Row[]) {
  return rows.filter((r) => r.cells.some(Boolean));
}

function yoyIndex(periods: Period[], i: number): number {
  const p = periods[i];
  return periods.findIndex((q) => q.fy === p.fy - 1 && (q.fq ?? 0) === (p.fq ?? 0));
}

function growthRow(key: string, label: string, src: Row | undefined, periods: Period[], name: string): Row {
  const cells = periods.map((p, i) => {
    const j = yoyIndex(periods, i);
    const cur = src?.cells[i] ?? null;
    const prev = j >= 0 ? (src?.cells[j] ?? null) : null;
    if (!cur || !prev || prev.v === 0 || prev.v < 0) return null;
    const curLabel = `${p.label} ${name}`;
    const prevLabel = `${periods[j].label} ${name}`;
    return {
      v: cur.v / prev.v - 1,
      derived: {
        formula: `${curLabel} ÷ ${prevLabel} − 1`,
        parts: [...partsFrom(cur, curLabel, 1), ...partsFrom(prev, prevLabel, 1)],
      },
    } satisfies Cell;
  });
  return { key, label, unit: "pct", cells, kind: "kpi" };
}

function ratioRow(key: string, label: string, num: Row | undefined, den: Row | undefined, labels: [string, string], unit: "pct" | "ratio" = "pct"): Row {
  const cells = (num?.cells ?? []).map((c, i) => combine(c, den?.cells[i] ?? null, "div", labels));
  return { key, label, unit, cells, kind: "kpi" };
}

export function buildKpis(
  income: Row[],
  balance: Row[],
  cash: Row[],
  periods: Period[],
  freq: "annual" | "quarterly",
): Row[] {
  const g = (rows: Row[], k: string) => rowOf(rows, k);
  const rev = g(income, "revenue");
  const rows: Row[] = [
    growthRow("revenueGrowth", "Revenue growth (YoY)", rev, periods, "revenue"),
    ratioRow("grossMargin", "Gross margin", g(income, "grossProfit"), rev, ["Gross profit", "Revenue"]),
    ratioRow("operatingMargin", "Operating margin", g(income, "operatingIncome"), rev, ["Operating income", "Revenue"]),
    ratioRow("netMargin", "Net margin", g(income, "netIncome"), rev, ["Net income", "Revenue"]),
    ratioRow("fcfMargin", "Free cash flow margin", g(cash, "fcf"), rev, ["Free cash flow", "Revenue"]),
    ratioRow("rndIntensity", "R&D as % of revenue", g(income, "rnd"), rev, ["R&D", "Revenue"]),
    ratioRow("sbcIntensity", "Stock comp as % of revenue", g(cash, "sbc"), rev, ["Stock-based comp", "Revenue"]),
    ratioRow("capexIntensity", "Capex as % of revenue", g(cash, "capex"), rev, ["Capex", "Revenue"]),
    ratioRow("taxRate", "Effective tax rate", g(income, "incomeTax"), g(income, "pretaxIncome"), ["Income tax", "Pretax income"]),
    growthRow("netIncomeGrowth", "Net income growth (YoY)", g(income, "netIncome"), periods, "net income"),
    growthRow("epsGrowth", "Diluted EPS growth (YoY)", g(income, "epsDiluted"), periods, "diluted EPS"),
    growthRow("fcfGrowth", "Free cash flow growth (YoY)", g(cash, "fcf"), periods, "FCF"),
    ratioRow("currentRatio", "Current ratio", g(balance, "currentAssets"), g(balance, "currentLiabilities"), ["Current assets", "Current liabilities"], "ratio"),
    ratioRow("debtToEquity", "Long-term debt / equity", g(balance, "longTermDebt"), g(balance, "equity"), ["Long-term debt", "Equity"], "ratio"),
    ratioRow("fcfConversion", "FCF conversion (FCF ÷ net income)", g(cash, "fcf"), g(income, "netIncome"), ["Free cash flow", "Net income"], "ratio"),
  ];
  if (freq === "annual") {
    const ni = g(income, "netIncome");
    const eq = g(balance, "equity");
    rows.push({
      key: "roe",
      label: "Return on equity",
      unit: "pct",
      kind: "kpi",
      cells: periods.map((p, i) => {
        const n = ni?.cells[i];
        const e1 = eq?.cells[i];
        const e0 = i > 0 ? eq?.cells[i - 1] : null;
        if (!n || !e1 || !e0) return null;
        const avg = (e1.v + e0.v) / 2;
        if (avg <= 0) return null;
        return {
          v: n.v / avg,
          derived: {
            formula: "Net income ÷ average shareholders' equity",
            parts: [
              ...partsFrom(n, `${p.label} net income`, 1),
              ...partsFrom(e1, `${p.label} ending equity`, 1),
              ...partsFrom(e0, `${periods[i - 1].label} ending equity`, 1),
            ],
          },
        } satisfies Cell;
      }),
    });
  }
  return pruneEmptyRows(rows);
}

export function buildStatements(cf: CompanyFacts) {
  const years = detectFiscalYears(cf);
  const periods = buildPeriods(years);
  const out = {} as Record<"annual" | "quarterly", Record<StatementKey, Statement>>;
  for (const freq of ["annual", "quarterly"] as const) {
    const ps = periods[freq];
    const income = buildStatement(cf, INCOME_LINES, ps, years, freq);
    const balance = buildStatement(cf, BALANCE_LINES, ps, years, freq);
    const cash = buildStatement(cf, CASHFLOW_LINES, ps, years, freq);
    fillDerived(income, "grossProfit", "revenue", "costOfRevenue", ["Revenue", "Cost of revenue"]);
    fillDerived(balance, "totalLiabilities", "liabilitiesAndEquity", "equity", ["Total liabilities & equity", "Equity"]);
    const cfo = rowOf(cash, "cfo");
    const capex = rowOf(cash, "capex");
    const fcf: Row = {
      key: "fcf",
      label: "Free cash flow",
      unit: "usd",
      bold: true,
      kind: "kpi",
      cells: ps.map((_, i) => combine(cfo?.cells[i] ?? null, capex?.cells[i] ?? null, "sub", ["Cash from operations", "Capex"])),
    };
    cash.push(fcf);
    const kpis = buildKpis(income, balance, cash, ps, freq);

    // Keep periods that carry at least one income or cash-flow figure (reported or derived).
    const keep = ps.map((_, i) => [...income, ...cash].some((r) => r.cells[i]));
    const sliceRows = (rows: Row[]) =>
      pruneEmptyRows(rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) })));
    const keptPeriods = ps.filter((_, i) => keep[i]);
    out[freq] = {
      income: { periods: keptPeriods, rows: sliceRows(income) },
      balance: { periods: keptPeriods, rows: sliceRows(balance) },
      cashflow: { periods: keptPeriods, rows: sliceRows(cash) },
      kpis: { periods: keptPeriods, rows: sliceRows(kpis) },
    };
  }
  return out;
}
