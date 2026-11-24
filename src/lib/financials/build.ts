// Turns SEC "companyfacts" XBRL JSON into standardized, source-attributed
// annual and quarterly statements. Pure functions: used by the ingest script
// and covered by unit tests.
import { BALANCE_LINES, CASHFLOW_LINES, DEBT_EVIDENCE_CONCEPTS, INCOME_LINES, TOTAL_DEBT_CONCEPTS, type LineDef } from "./schema";
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

/** Concepts are us-gaap local names, or prefix-qualified company extensions ("cop:CapitalExpendituresAndInvestments"). */
const splitConcept = (concept: string): [string, string] => {
  const i = concept.indexOf(":");
  return i < 0 ? ["us-gaap", concept] : [concept.slice(0, i), concept.slice(i + 1)];
};

export function factsFor(cf: CompanyFacts, concept: string, unit: string): RawFact[] {
  const [ns, local] = splitConcept(concept);
  const node = cf.facts[ns]?.[local];
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

/**
 * Longest discrete quarter, in days. Retailers on 52/53-week years run 12/12/12/16-week quarters
 * (Costco: 84, 168 and 252 days year to date) or 16/12/12/12 (Kroger: a 112-day first quarter), so
 * the year-to-date buckets are 160–200 and 245–290 days; with the old 170–195 and 260–285 Costco's
 * second and third quarters were never placed until its 10-K arrived.
 */
const Q_MAX = 115;

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
    let q1 = bucket(80, Q_MAX);
    let q2 = bucket(160, 200);
    let q3 = bucket(245, 290);
    if (!q1 || !q2 || !q3) {
      // Fall back to discrete three-month periods inside the year.
      const discreteEnds = durations
        .filter(
          (f) =>
            inRange(durationDays(f.start!, f.end), 80, Q_MAX) &&
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

  // Fiscal years in progress: 10-Q periods that start the day after the last 10-K year.
  const last = years.at(-1);
  if (last) {
    const yearDays = durationDays(last.start, last.end);
    const quartersFrom = (start: string) => {
      const fromStart = durations.filter((f) => near(f.start, start, 4) && f.form.startsWith("10-Q"));
      const bucket = (lo: number, hi: number) =>
        mostCommon(fromStart.filter((f) => inRange(durationDays(f.start!, f.end), lo, hi)).map((f) => f.end));
      // Keep quarters in position: when a 10-Q is missing from companyfacts (URI, DOW, ED and EIX lack
      // their Q2 FY2026 facts), a later nine-month YTD must stay Q3. Dropping the gap turned it into
      // "Q2" and derived Q2 as 9M − Q1, double the real quarter. The missing quarter keeps its
      // calendar end and simply has no cells.
      const found = [bucket(80, Q_MAX), bucket(160, 200), bucket(245, 290)];
      const lastFound = found.reduce((acc, e, i) => (e ? i : acc), -1);
      return found.slice(0, lastFound + 1).map((e, i) => e ?? quarterEndAfter(start, i + 1));
    };
    // A short 10-K or 10-KT period starting here is a transition (Ferguson moved its year end from
    // July to December with a five-month 10-KT; Paramount Skydance's successor 10-K covers 8 Aug to
    // 31 Dec 2025): the next year starts after it.
    const transitionFrom = (start: string) =>
      durations
        .filter((f) => isAnnualForm(f.form) && near(f.start, start, 4) && inRange(durationDays(f.start!, f.end), 28, 349))
        .sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    const used = new Set(years.map((y) => y.fy));
    let start = addDays(last.end, 1);
    // Several years can be in progress when a 10-K is missing from companyfacts (Clorox's FY2026
    // 10-K): each year's quarters are still placed, the year itself has no annual column.
    for (let guard = 0; guard < 4; guard++) {
      const qEnds = quartersFrom(start);
      let end = addDays(start, yearDays);
      let next = addDays(end, 1);
      let t = transitionFrom(start);
      while (t) {
        end = t.end;
        next = addDays(t.end, 1);
        // A successor period can follow a predecessor stub (Skydance: Jan–Aug, then Aug–Dec).
        t = transitionFrom(next);
      }
      const fy = fiscalYearFromEnd(end);
      if (qEnds.length && !used.has(fy) && qEnds.every((e) => toTime(e) <= toTime(end) + 6 * DAY)) {
        years.push({ fy, start, end, qEnds, partial: true });
        used.add(fy);
      }
      // Go on only when a later year's quarters exist.
      if (!durations.some((f) => near(f.start, next, 4) && f.form.startsWith("10-Q"))) break;
      start = next;
    }
  }
  return years;
}

/**
 * True when the 10-K that filed `total` reports the prior fiscal year on the same basis as that
 * year's own 10-K (within 0.5%), i.e. the filing carries no restatement. False when they differ or
 * the comparative is missing.
 */
function totalOnOriginalBasis(list: RawFact[], total: RawFact) {
  if (!total.start) return false;
  const priorEnd = addDays(total.start, -1);
  const isPrior = (f: RawFact) => !!f.start && near(f.end, priorEnd, 6) && inRange(durationDays(f.start, f.end), 350, 380) && isAnnualForm(f.form);
  const inSameFiling = list.find((f) => f.accn === total.accn && isPrior(f));
  const original = list.filter((f) => isPrior(f) && f.accn !== total.accn).sort((a, b) => (a.filed < b.filed ? -1 : 1))[0];
  if (!inSameFiling || !original || !original.val) return false;
  return Math.abs(inSameFiling.val / original.val - 1) <= 0.005;
}

/** Last day of the month `3 × q` months after the month before `start` (calendar quarter end). */
export function quarterEndAfter(start: string, q: number) {
  const d = new Date(`${start}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * q, 0));
  return end.toISOString().slice(0, 10);
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

/** Lines that can't be negative; a negative derived quarter means mismatched restatements, so it's dropped. */
const NON_NEGATIVE = new Set(["revenue", "costOfRevenue", "rnd", "sga", "salesMarketing", "generalAdmin", "dna", "sbc", "capex", "dividends", "buybacks", "sharesBasic", "sharesDiluted"]);

const ref = (p: Picked): SourceRef => ({
  accn: p.fact.accn,
  concept: p.concept.includes(":") ? p.concept : `us-gaap:${p.concept}`,
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
  const found = dedupeComponents(
    def.components.map((c) => choose(factsFor(cf, c, unitKey(def)), c, pred)).filter((x): x is Picked => !!x),
  );
  if (!found.length) return null;
  if (found.length === 1) return reportedCell(found[0]);
  const names = found.map((x) => humanizeConcept(x.concept));
  return {
    v: found.reduce((sum, x) => sum + x.fact.val, 0),
    derived: { formula: names.join(" + "), parts: found.map((x, i) => ({ ...ref(x), label: names[i], sign: 1 as const })) },
  };
}

/**
 * Components that are one line tagged twice are counted once: an identical amount under two
 * concepts (Con Edison tags its $392M "Notes payable" as both CommercialPaper and
 * NotesPayableCurrent), and commercial paper beside a short-term borrowings line.
 */
function dedupeComponents(found: Picked[]): Picked[] {
  const out: Picked[] = [];
  for (const x of found) if (!out.some((y) => y.fact.val === x.fact.val)) out.push(x);
  // Commercial paper beside a short-term borrowings line is part of it: PepsiCo's $9,223M includes $4,800M of
  // paper, FedEx tags $750M face value of paper and $745M carried; Chevron's $977M is what is left after
  // reclassifying paper to long-term. Paper alone (Home Depot's "Short-term debt") still counts.
  // OtherShortTermBorrowings is the same kind of breakdown: in the taxonomy and in the filings it is
  // the rest of the borrowings total (Citigroup 2009: $10,223M paper + $58,656M other = $68,879M
  // short-term borrowings; JPMorgan 2016: $11,738M + $22,705M = $34,443M).
  const stb = out.some((x) => x.concept === "ShortTermBorrowings");
  return stb ? out.filter((x) => x.concept !== "CommercialPaper" && x.concept !== "OtherShortTermBorrowings") : out;
}

/** "CommercialPaper" → "Commercial paper" */
export function humanizeConcept(c: string) {
  const s = c.replace(/^[\w-]+:/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
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
  const direct = firstConcept(cf, def, (f) => isDuration(80, Q_MAX)(f) && near(f.start, p.start, 4) && near(f.end, p.end, 4));
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
    // Latest-filed on both sides keeps them on the same restatement basis when a later filing
    // restated the comparatives; when it didn't (a spin-off restates the 10-K total but not old
    // 10-Qs), the non-negative guard below drops the mismatched result instead of showing it.
    const prevPred =
      k - 1 === 1
        ? (f: RawFact) => near(f.start, year.start, 4) && near(f.end, prevEnd, 4) && isDuration(80, Q_MAX)(f)
        : (f: RawFact) => near(f.start, year.start, 4) && near(f.end, prevEnd, 4) && isDuration(160, 290)(f);
    // A later 10-Q can restate the old nine months for a divestiture (IFF FY2025) while the 10-K
    // total is still on the original basis; subtracting the restated YTD inflates Q4. When the
    // 10-K's own prior-year comparative matches the original prior-year total, the 10-K wasn't
    // restated, so use the nine months as filed before it. Otherwise (restated, or no way to
    // tell) keep the latest-filed comparative.
    const prevCum =
      (k === 4 && totalOnOriginalBasis(list, cum.fact) ? choose(list, c, (f) => prevPred(f) && f.filed <= cum.fact.filed) : undefined) ??
      choose(list, c, prevPred);
    if (prevCum && !(NON_NEGATIVE.has(def.key) && cum.fact.val - prevCum.fact.val < 0)) {
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
      if (NON_NEGATIVE.has(def.key) && v < 0) return null;
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

function ratioRow(
  key: string,
  label: string,
  num: Row | undefined,
  den: Row | undefined,
  labels: [string, string],
  unit: "pct" | "ratio" = "pct",
  opts: { positiveDen?: boolean } = {},
): Row {
  const cells = (num?.cells ?? []).map((c, i) => {
    const d = den?.cells[i] ?? null;
    if (opts.positiveDen && (!d || d.v <= 0)) return null;
    return combine(c, d, "div", labels);
  });
  return { key, label, unit, cells, kind: "kpi" };
}

export interface BuildOptions {
  /** Banks and brokerages: keep bank-only lines, skip industrial-style debt and margin metrics. */
  bank?: boolean;
}

const periodDays = (p: Period) => (p.start ? durationDays(p.start, p.end) + 1 : 365);

/** Average of this and the prior fiscal year's balance. */
function avgCell(row: Row | undefined, i: number, periods: Period[], label: string): Cell | null {
  const c1 = row?.cells[i];
  const c0 = i > 0 ? row?.cells[i - 1] : null;
  if (!c1 || !c0 || periods[i - 1].fy !== periods[i].fy - 1) return null;
  return {
    v: (c1.v + c0.v) / 2,
    derived: {
      formula: `Average of ${periods[i - 1].label} and ${periods[i].label} ${label}`,
      parts: [...partsFrom(c1, `${periods[i].label} ending ${label}`, 1), ...partsFrom(c0, `${periods[i - 1].label} ending ${label}`, 1)],
    },
  };
}

/** Balance-sheet "days" metric: balance ÷ flow × days in the period (e.g. DSO, inventory days). */
function daysRow(key: string, label: string, bal: Row | undefined, flow: Row | undefined, periods: Period[], labels: [string, string]): Row {
  const cells = periods.map((p, i) => {
    const b = bal?.cells[i];
    const f = flow?.cells[i];
    if (!b || !f || f.v <= 0) return null;
    const days = periodDays(p);
    return {
      v: (b.v / f.v) * days,
      derived: { formula: `${labels[0]} ÷ ${labels[1]} × ${days} days`, parts: [...partsFrom(b, labels[0], 1), ...partsFrom(f, labels[1], 1)] },
    } satisfies Cell;
  });
  return { key, label, unit: "days", cells, kind: "kpi" };
}

export function buildKpis(
  income: Row[],
  balance: Row[],
  cash: Row[],
  periods: Period[],
  freq: "annual" | "quarterly",
  opts: BuildOptions = {},
): Row[] {
  const g = (rows: Row[], k: string) => rowOf(rows, k);
  const bank = !!opts.bank;
  const rev = g(income, "revenue");
  const ni = g(income, "netIncome");
  const oi = g(income, "operatingIncome");
  const fcf = g(cash, "fcf");
  const rows: Row[] = [
    growthRow("revenueGrowth", "Revenue growth (YoY)", rev, periods, "revenue"),
    ratioRow("grossMargin", "Gross margin", g(income, "grossProfit"), rev, ["Gross profit", "Revenue"]),
    ratioRow("operatingMargin", "Operating margin", oi, rev, ["Operating income", "Revenue"]),
    ...(bank ? [] : [ratioRow("ebitdaMargin", "EBITDA margin", g(income, "ebitda"), rev, ["EBITDA", "Revenue"])]),
    ratioRow("netMargin", "Net margin", ni, rev, ["Net income", "Revenue"]),
    ...(bank
      ? [
          ratioRow("efficiencyRatio", "Efficiency ratio (noninterest expense ÷ revenue)", g(income, "nonInterestExpense"), rev, ["Noninterest expense", "Revenue"]),
          ratioRow("niiShare", "Net interest income share of revenue", g(income, "netInterestIncome"), rev, ["Net interest income", "Revenue"]),
          ratioRow("loansToDeposits", "Loans ÷ deposits", g(balance, "loans"), g(balance, "deposits"), ["Loans", "Deposits"]),
          ratioRow("equityToAssets", "Equity ÷ assets", g(balance, "equity"), g(balance, "totalAssets"), ["Equity", "Total assets"]),
        ]
      : [
          ratioRow("fcfMargin", "Free cash flow margin", fcf, rev, ["Free cash flow", "Revenue"]),
          ratioRow("rndIntensity", "R&D as % of revenue", g(income, "rnd"), rev, ["R&D", "Revenue"]),
          ratioRow("sbcIntensity", "Stock comp as % of revenue", g(cash, "sbc"), rev, ["Stock-based comp", "Revenue"]),
          ratioRow("capexIntensity", "Capex as % of revenue", g(cash, "capex"), rev, ["Capex", "Revenue"]),
        ]),
    ratioRow("taxRate", "Effective tax rate", g(income, "incomeTax"), g(income, "pretaxIncome"), ["Income tax", "Pretax income"], "pct", { positiveDen: true }),
    growthRow("netIncomeGrowth", "Net income growth (YoY)", ni, periods, "net income"),
    growthRow("epsGrowth", "Diluted EPS growth (YoY)", g(income, "epsDiluted"), periods, "diluted EPS"),
    ...(bank ? [] : [growthRow("fcfGrowth", "Free cash flow growth (YoY)", fcf, periods, "FCF")]),
    growthRow("dpsGrowth", "Dividend per share growth (YoY)", g(income, "dividendsPerShare"), periods, "dividends per share"),
    ratioRow("payoutRatio", "Dividend payout ratio", g(cash, "dividends"), ni, ["Dividends paid", "Net income"], "pct", { positiveDen: true }),
  ];
  if (!bank) {
    const ret = g(cash, "buybacks");
    const div = g(cash, "dividends");
    rows.push(
      {
        key: "cashReturned",
        label: "Cash returned ÷ free cash flow",
        unit: "pct",
        kind: "kpi",
        cells: periods.map((_, i) => {
          const f = fcf?.cells[i];
          const b = ret?.cells[i] ?? null;
          const d = div?.cells[i] ?? null;
          if (!f || f.v <= 0 || (!b && !d)) return null;
          const returned = b && d ? combine(b, d, "add", ["Buybacks", "Dividends"])! : (b ?? d)!;
          return combine(returned, f, "div", [b && d ? "(Buybacks + dividends)" : b ? "Buybacks" : "Dividends", "Free cash flow"]);
        }),
      },
      ratioRow("fcfConversion", "FCF conversion (FCF ÷ net income)", fcf, ni, ["Free cash flow", "Net income"], "ratio", { positiveDen: true }),
      ratioRow("currentRatio", "Current ratio", g(balance, "currentAssets"), g(balance, "currentLiabilities"), ["Current assets", "Current liabilities"], "ratio"),
      ratioRow("debtToEquity", "Total debt ÷ equity", g(balance, "totalDebt"), g(balance, "equity"), ["Total debt", "Equity"], "ratio", { positiveDen: true }),
      ratioRow("interestCoverage", "Interest coverage (operating income ÷ interest)", oi, g(income, "interestExpense"), ["Operating income", "Interest expense"], "ratio", { positiveDen: true }),
      daysRow("dso", "Days sales outstanding", g(balance, "receivables"), rev, periods, ["Accounts receivable", "Revenue"]),
      daysRow("dio", "Inventory days", g(balance, "inventory"), g(income, "costOfRevenue"), periods, ["Inventories", "Cost of revenue"]),
    );
  } else {
    rows.push(ratioRow("debtToEquity", "Long-term debt ÷ equity", g(balance, "longTermDebt"), g(balance, "equity"), ["Long-term debt", "Equity"], "ratio", { positiveDen: true }));
  }

  if (freq === "annual") {
    const eq = g(balance, "equity");
    const assets = g(balance, "totalAssets");
    const avgRow = (key: string, label: string, num: Row | undefined, base: Row | undefined, baseLabel: string, numLabel: string, unit: "pct" | "ratio" = "pct"): Row => ({
      key,
      label,
      unit,
      kind: "kpi",
      cells: periods.map((p, i) => {
        const n = num?.cells[i];
        const avg = avgCell(base, i, periods, baseLabel);
        if (!n || !avg || avg.v <= 0) return null;
        return {
          v: n.v / avg.v,
          derived: { formula: `${numLabel} ÷ average ${baseLabel}`, parts: [...partsFrom(n, `${p.label} ${numLabel.toLowerCase()}`, 1), ...(avg.derived?.parts ?? [])] },
        } satisfies Cell;
      }),
    });
    rows.push(avgRow("roe", "Return on equity", ni, eq, "shareholders' equity", "Net income"));
    rows.push(avgRow("roa", "Return on assets", ni, assets, "total assets", "Net income"));
    if (!bank) {
      rows.push(avgRow("assetTurnover", "Asset turnover", rev, assets, "total assets", "Revenue", "ratio"));
      // ROIC: after-tax operating income over average invested capital (total debt + equity).
      const debt = g(balance, "totalDebt");
      const tax = g(income, "incomeTax");
      const pt = g(income, "pretaxIncome");
      const invested: Row = {
        key: "_ic",
        label: "Invested capital",
        unit: "usd",
        cells: periods.map((_, i) => combine(debt?.cells[i] ?? null, eq?.cells[i] ?? null, "add", ["Total debt", "Equity"])),
      };
      rows.push({
        key: "roic",
        label: "Return on invested capital",
        unit: "pct",
        kind: "kpi",
        cells: periods.map((p, i) => {
          const o = oi?.cells[i];
          const t = tax?.cells[i];
          const b = pt?.cells[i];
          const avg = avgCell(invested, i, periods, "total debt + equity");
          if (!o || !t || !b || b.v <= 0 || !avg || avg.v <= 0) return null;
          const rate = Math.min(0.5, Math.max(0, t.v / b.v));
          return {
            v: (o.v * (1 - rate)) / avg.v,
            derived: {
              formula: "Operating income × (1 − tax ÷ pretax income) ÷ average (total debt + equity)",
              parts: [
                ...partsFrom(o, `${p.label} operating income`, 1),
                ...partsFrom(t, `${p.label} income tax`, 1),
                ...partsFrom(b, `${p.label} pretax income`, 1),
                ...(avg.derived?.parts ?? []),
              ],
            },
          } satisfies Cell;
        }),
      });
      rows.push(ratioRow("netDebtToEbitda", "Net debt ÷ EBITDA", g(balance, "netDebt"), g(income, "ebitda"), ["Net debt", "EBITDA"], "ratio", { positiveDen: true }));
    }
  }
  return pruneEmptyRows(rows);
}

function insertAfter(rows: Row[], afterKey: string, ...add: Row[]) {
  const i = rows.findIndex((r) => r.key === afterKey);
  rows.splice(i >= 0 ? i + 1 : rows.length, 0, ...add);
}

/** Short-term borrowings that are never part of long-term debt: added to a long-term figure that includes current maturities. */
const SHORT_BORROWINGS: LineDef = {
  key: "_stb",
  label: "Short-term borrowings",
  concepts: [],
  components: ["CommercialPaper", "ShortTermBorrowings", "OtherShortTermBorrowings"],
  unit: "usd",
  kind: "stock",
};
/**
 * Beside current maturities alone, current notes payable are a separate balance sheet line too. They
 * are not added to a long-term figure that includes current maturities: there they are the current
 * notes of that same debt (Autodesk's $499M, Omnicom's $1,399.5M, Andersen's $54.8M).
 */
const SHORT_BORROWINGS_AND_NOTES: LineDef = { ...SHORT_BORROWINGS, components: [...SHORT_BORROWINGS.components!, "NotesPayableCurrent"] };

const TOTAL_DEBT_TAGGED: LineDef = { key: "_debtTagged", label: "Total debt", concepts: TOTAL_DEBT_CONCEPTS, unit: "usd", kind: "stock" };

/** Long-term debt concepts that already include current maturities. */
const INCLUDES_CURRENT = new Set(["us-gaap:LongTermDebt", "us-gaap:LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"]);
/** Short-term debt concepts that hold only the current portion of long-term debt, not short-term borrowings. */
const CURRENT_MATURITIES_ONLY = new Set(["us-gaap:LongTermDebtCurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent"]);

/**
 * The long-term figure includes current maturities when its own concept says so, or when the filing
 * tags the same amount, on the same date, with a concept that does (Chevron tags $39.8B as both
 * LongTermDebtAndCapitalLeaseObligations and …IncludingCurrentMaturities; adding its DebtCurrent
 * double counted $9.9B of reclassified short-term debt).
 */
function includesCurrent(cf: CompanyFacts, l: Cell, end: string) {
  if (!l.src) return false;
  if (INCLUDES_CURRENT.has(l.src.concept)) return true;
  // Only the explicit "including current maturities" concept counts here: plain LongTermDebt is often
  // the noncurrent line (IDACORP, Trupanion tag their noncurrent debt with it).
  return factsFor(cf, "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities", "USD").some((f) => !f.start && near(f.end, end, 4) && f.val === l.v);
}

/**
 * NotesPayableCurrent counts as short-term debt beside a long-term debt line (Oracle's "Notes payable
 * and other borrowings, current"), but alone it is usually a note figure, not a balance sheet line:
 * Meta's FY2015 balance sheet has no debt at all, yet it tags $201M of NotesPayableCurrent in a note.
 */
function dropLoneNotesPayable(balance: Row[]) {
  const s = rowOf(balance, "shortTermDebt");
  const l = rowOf(balance, "longTermDebt");
  if (!s) return;
  s.cells = s.cells.map((c, i) => (c?.src?.concept === "us-gaap:NotesPayableCurrent" && !l?.cells[i] ? null : c));
}

/** Total debt from the balance sheet lines: long-term + short-term, without double-counting current maturities or leaving out short-term borrowings. */
function debtFromLines(cf: CompanyFacts, l: Cell | null, s: Cell | null, end: string): Cell | null {
  if (!l && !s) return null;
  const atEnd = (f: RawFact) => !f.start && near(f.end, end, 4);
  if (l && includesCurrent(cf, l, end)) {
    // This figure already includes current maturities; add only short-term borrowings.
    const label = "Long-term debt incl. current maturities";
    const extra = pickCell(cf, SHORT_BORROWINGS, atEnd);
    if (extra) return combine(l, extra, "add", [label, "Short-term borrowings"]);
    return { v: l.v, derived: { formula: label, parts: partsFrom(l, label, 1) } };
  }
  // Current maturities alone (FedEx, Home Depot): short-term borrowings and commercial paper are separate lines.
  const sbAll = s?.src && CURRENT_MATURITIES_ONLY.has(s.src.concept) ? pickCell(cf, SHORT_BORROWINGS_AND_NOTES, atEnd) : null;
  // The same amount under a second concept is the same line (Goosehead: current maturities also tagged NotesPayableCurrent).
  const sb = sbAll && sbAll.v !== s!.v ? sbAll : null;
  const short = s && sb ? combine(s, sb, "add", ["Current maturities of long-term debt", "Short-term borrowings"]) : s;
  const shortLabel = sb ? "(current maturities + short-term borrowings)" : "Short-term debt";
  if (l && short) return combine(l, short, "add", ["Long-term debt", shortLabel]);
  const only = (l ?? short)!;
  const label = l ? "Long-term debt" : shortLabel;
  return { v: only.v, derived: { formula: label, parts: partsFrom(only, label, 1) } };
}

/**
 * Total debt for each period, or nothing when it cannot be established:
 * - the sum of the balance sheet lines (debtFromLines) when there is one, unless the filing's own
 *   tagged total (TOTAL_DEBT_CONCEPTS) shows the lines are only part of the debt: below three quarters
 *   of it (Travelers FY2025: $300M of current debt against $9,267M of debt). A tagged total is not
 *   preferred over complete lines, because filers also use these concepts for a debt note's subtotal:
 *   FedEx tags $24,969M against $25,714M on its balance sheet, Home Depot $51,308M against $55,772M,
 *   both without their short-term borrowings;
 * - the tagged total when no line is tagged (Aflac's "Notes payable and lease obligations"), unless
 *   another debt amount of the same date is larger, which makes it a subtotal as well;
 * - nothing, so net debt and the debt ratios stay empty too, when the lines come to less than half of
 *   another debt amount the filing tags for the same date (DEBT_EVIDENCE_CONCEPTS): a fragment.
 */
function totalDebtRow(cf: CompanyFacts, balance: Row[], periods: Period[]): Row {
  const ltd = rowOf(balance, "longTermDebt");
  const std = rowOf(balance, "shortTermDebt");
  const cells = periods.map((p, i): Cell | null => {
    const atEnd = (f: RawFact) => !f.start && near(f.end, p.end, 4);
    const lines = debtFromLines(cf, ltd?.cells[i] ?? null, std?.cells[i] ?? null, p.end);
    const evidence = Math.max(0, ...DEBT_EVIDENCE_CONCEPTS.map((c) => choose(factsFor(cf, c, "USD"), c, atEnd)?.fact.val ?? 0));
    const tagged = firstConcept(cf, TOTAL_DEBT_TAGGED, atEnd);
    if (tagged && (!lines || lines.v < tagged.fact.val * 0.75)) {
      // A tagged total below another debt amount of the same date is a subtotal too: Super Micro tags its
      // $3,977M of credit lines and term loans with it, beside $4,669M of convertible notes (Q1 FY27).
      return evidence > tagged.fact.val * 1.1 ? null : reportedCell(tagged);
    }
    if (!lines) return null;
    return evidence > lines.v * 2 ? null : lines;
  });
  return { key: "totalDebt", label: "Total debt", unit: "usd", bold: true, kind: "kpi", cells };
}

/**
 * Some filers tag share counts in millions (e.g. 751.8 instead of 751,800,000). When net
 * income ÷ EPS says the count should be a million times larger, rescale it as a derived
 * cell that keeps the tagged fact as its source.
 */
export function fixShareScale(income: Row[]) {
  const ni = rowOf(income, "netIncome");
  const eps = rowOf(income, "epsDiluted") ?? rowOf(income, "epsBasic");
  for (const key of ["sharesBasic", "sharesDiluted"]) {
    const row = rowOf(income, key);
    if (!row) continue;
    row.cells = row.cells.map((c, i) => {
      if (!c?.src || c.v <= 0 || c.v >= 1e5) return c;
      const n = ni?.cells[i]?.v;
      const e = eps?.cells[i]?.v;
      const implied = n && e ? n / e : null;
      const scaled = c.v * 1e6;
      if (implied == null || implied <= 0 || Math.abs(scaled / implied - 1) > 0.15) return c;
      return {
        v: scaled,
        derived: {
          formula: "Tagged value × 1,000,000 (the filing tagged this count in millions)",
          parts: [{ ...c.src, label: "As tagged (millions of shares)", sign: 1 as const }],
        },
      };
    });
  }
}

/** Income statement totals that run from revenue straight to pretax income on statements without an operating subtotal. */
const TOTAL_EXPENSES: LineDef = {
  key: "_totalExpenses",
  label: "Total benefits, losses and expenses",
  concepts: ["BenefitsLossesAndExpenses", "CostsAndExpenses"],
  unit: "usd",
  kind: "flow",
  additive: true,
};

/**
 * Drop an "operating income" that cannot be an income-statement subtotal. Since ASU 2023-07 some
 * filers tag their segment profit total with OperatingIncomeLoss (MetLife's $6,137M "total
 * consolidated adjusted earnings", FY2025) while the statement itself runs revenue − total
 * benefits and expenses = pretax income. When the filing's own totals show that, an operating
 * income that differs from pretax income is a segment measure, not GAAP operating income.
 */
export function dropSegmentOperatingIncome(income: Row[], totalExpenses: Row) {
  const oi = rowOf(income, "operatingIncome");
  const rev = rowOf(income, "revenue");
  const pt = rowOf(income, "pretaxIncome");
  if (!oi || !rev || !pt) return;
  oi.cells = oi.cells.map((c, i) => {
    const r = rev.cells[i];
    const t = totalExpenses.cells[i];
    const b = pt.cells[i];
    if (!c || !r || !t || !b || !r.v) return c;
    const tol = Math.abs(r.v) * 0.005;
    const straightToPretax = Math.abs(r.v - t.v - b.v) <= tol;
    return straightToPretax && Math.abs(c.v - b.v) > tol ? null : c;
  });
}

export function buildStatements(cf: CompanyFacts, opts: BuildOptions = {}) {
  const years = detectFiscalYears(cf);
  const periods = buildPeriods(years);
  const keepLine = (d: LineDef) => !!opts.bank || !d.bank;
  const out = {} as Record<"annual" | "quarterly", Record<StatementKey, Statement>>;
  for (const freq of ["annual", "quarterly"] as const) {
    const ps = periods[freq];
    const income = buildStatement(cf, INCOME_LINES.filter(keepLine), ps, years, freq);
    const balance = buildStatement(cf, BALANCE_LINES.filter(keepLine), ps, years, freq);
    const cash = buildStatement(cf, CASHFLOW_LINES.filter(keepLine), ps, years, freq);
    fillDerived(income, "grossProfit", "revenue", "costOfRevenue", ["Revenue", "Cost of revenue"]);
    dropSegmentOperatingIncome(income, buildStatement(cf, [TOTAL_EXPENSES], ps, years, freq)[0]);
    fixShareScale(income);
    fillDerived(balance, "totalLiabilities", "liabilitiesAndEquity", "equity", ["Total liabilities & equity", "Equity"]);
    dropLoneNotesPayable(balance);
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
    if (!opts.bank) {
      const oi = rowOf(income, "operatingIncome");
      const dna = rowOf(cash, "dna");
      const pretax = rowOf(income, "pretaxIncome");
      const interest = rowOf(income, "interestExpense");
      const ebitdaRow: Row = {
        key: "ebitda",
        label: "EBITDA",
        unit: "usd",
        kind: "kpi",
        cells: ps.map((_, i) => {
          const d = dna?.cells[i] ?? null;
          const fromOi = combine(oi?.cells[i] ?? null, d, "add", ["Operating income", "D&A"]);
          if (fromOi) return fromOi;
          // Filers without an operating-income subtotal (e.g. integrated oils): pretax + interest + D&A.
          const ebit = combine(pretax?.cells[i] ?? null, interest?.cells[i] ?? null, "add", ["Income before taxes", "Interest expense"]);
          return combine(ebit, d, "add", ["EBIT", "D&A"]);
        }),
      };
      if (oi?.cells.some(Boolean)) insertAfter(income, "operatingIncome", ebitdaRow);
      else insertAfter(income, "pretaxIncome", ebitdaRow);
      const debt = totalDebtRow(cf, balance, ps);
      const cashRow = rowOf(balance, "cash");
      const sti = rowOf(balance, "shortTermInvestments");
      const netDebt: Row = {
        key: "netDebt",
        label: "Net debt (cash)",
        unit: "usd",
        kind: "kpi",
        cells: ps.map((_, i) => {
          const d = debt.cells[i];
          const c = cashRow?.cells[i] ?? null;
          if (!d || !c) return null;
          const liquid = sti?.cells[i] ? combine(c, sti.cells[i], "add", ["Cash", "Short-term investments"])! : c;
          return combine(d, liquid, "sub", ["Total debt", sti?.cells[i] ? "(cash + short-term investments)" : "Cash"]);
        }),
      };
      insertAfter(balance, "operatingLeases", debt, netDebt);
    }
    const kpis = buildKpis(income, balance, cash, ps, freq, opts);

    // Keep periods with a headline figure (revenue, net income, operating cash flow) or at
    // least three income / cash-flow lines; a lone comparative fact from an old 10-K (e.g. a
    // buyback total from 2000) shouldn't create an otherwise empty column.
    const CORE = new Set(["revenue", "netIncome", "operatingIncome", "cfo", "cfNetIncome"]);
    const keep = ps.map((_, i) => {
      const filled = [...income, ...cash].filter((r) => r.cells[i]);
      return filled.some((r) => CORE.has(r.key)) || filled.length >= 3;
    });
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
