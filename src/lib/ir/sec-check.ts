// Read-time cross-check of the IR series against the company's SEC statements (pure; runs in the IR
// page worker after the tidy pass). The statements are the as-filed 10-Q/10-K figures of the
// company dataset, so they are an independent reading of the same quarters.
//
// What is compared: the consolidated standard lines both sides carry (revenue, operating income,
// net income, diluted EPS, and for banks net interest income and the provision for credit losses).
// An IR line counts as one of them when its printed name says so, its unit fits, and nothing in its
// name, table or scope marks it as a part of the company (a segment, a business), another basis
// (adjusted, non-GAAP, managed, fully taxable equivalent, annualized, FFO/AFFO, trailing twelve
// months, guidance) or another measure. Each such figure is checked on its own against the filing's line: no line shields another. A same-signed
// figure less than half or more than twice the filing's is taken as another line of the same name
// (a segment's "Net interest income") and not compared.
//
// Sign first: a figure whose sign differs from the filing's never agrees and is always marked,
// whatever its size. A label that names a loss ("Net loss", "Loss per share") carries the sign, so
// a positive figure under it is read as negative.
//
// Tolerances: same sign, and totals within 0.5% (or at the precision a round figure prints: a
// sentence's "$7.7 billion" agrees with 7,658 million, within 5%); per-share figures within one cent
// or 1%, whichever is larger.
//
// The flag names the real source of the filing's figure: a fourth quarter the statements derive
// from the 10-K year less the first nine months is called that, and a figure taken from a filing
// made after the period's own (a comparative a later 10-Q or 10-K may have recast) is not called a
// disagreement: it is listed as compared with a later filing.
//
// A disagreement is never corrected. It is held (moved to `series.held`, like other contradicted
// figures, so no total, change, chart or export uses it) when the filing contradicts its unit
// (about 1,000×), its sign, or its period (it equals the filing's figure for another period length,
// the neighbouring quarter, or four times the quarter); otherwise the figure stays and carries a
// flag with both numbers, because a release can differ from a later 10-Q for good reasons
// (recasts, a subtotal the release calls by the same name).
import { normLabel } from "@/lib/ir/kpis";
import type { IrPayload, PayloadCell, PayloadCellFlag, PayloadSeries } from "@/lib/ir/payload";

export type StdLine = "revenue" | "operatingIncome" | "netIncome" | "epsDiluted" | "netInterestIncome" | "provisionCreditLosses";
export const STD_LINES: StdLine[] = ["revenue", "operatingIncome", "netIncome", "epsDiluted", "netInterestIncome", "provisionCreditLosses"];
export const STD_LABEL: Record<StdLine, string> = {
  revenue: "Revenue",
  operatingIncome: "Operating income",
  netIncome: "Net income",
  epsDiluted: "Diluted EPS",
  netInterestIncome: "Net interest income",
  provisionCreditLosses: "Provision for credit losses",
};

/** The statement rows the check reads (a subset of a CompanyDataset income statement). */
export interface CheckStatement {
  periods: { end: string; start?: string }[];
  rows: { key: string; cells: ({ v: number; src?: { accn?: string; concept?: string }; derived?: string } | null)[] }[];
}
export interface CheckStatements {
  quarterly?: CheckStatement | null;
  annual?: CheckStatement | null;
}

/** agree · held (contradicted unit, sign or period) · flagged (differs) · released (the unit guard had held it, the filing confirms it) · later (differs from a later filing's comparative, which may be a recast: not a disagreement) */
export type SecStatus = "agree" | "held" | "flagged" | "released" | "later";
export interface SecItem {
  k: string;
  label: string;
  line: StdLine;
  kind: "q" | "y";
  e: string;
  ir: number;
  sec: number;
  status: SecStatus;
  /** why a figure is held or flagged, with both numbers */
  why?: string;
  accn?: string;
  concept?: string;
}
export interface SecCheck {
  checked: number;
  agree: number;
  held: number;
  flagged: number;
  /** figures the display guard (suspect.ts) had held that the filing confirms: shown again */
  released: number;
  /** figures that differ only from a later filing's comparative (possibly recast): not counted as differing */
  later?: number;
  items: SecItem[];
  /** time the check took in the worker, ms */
  ms?: number;
}

const OTHER_BASIS = /\b(adjusted|non-?gaap|core|underlying|operating basis|annuali[sz]ed|fte|fully taxable|taxable[- ]equivalent|tax[- ]equivalent|managed|pro forma|proforma|excluding|ex-|constant currency|organic|normalized|comparable|segment|segments|reportable|by business|by division|per share|margin|growth|change|yoy|guidance|outlook|forecast|forecasted|projected|budget|ffo|affo|funds from operations|last twelve months|last 12 months|twelve months ended|ltm|ttm|trailing|attributable to (noncontrolling|non-controlling|minority)|common (stock|share)holders|available to common)\b/i;

const LINE_RULES: { line: StdLine; unit: string; root: boolean; test: (n: string) => boolean }[] = [
  { line: "revenue", unit: "usd", root: true, test: (n) => /^(total )?(revenue|sales|net revenue|sales and (other )?revenue|revenue and other income|revenue net of interest expense)$/.test(n) },
  { line: "operatingIncome", unit: "usd", root: true, test: (n) => /^(total )?(operating income|operating income loss|operating loss|income from operations|income loss from operations|operating profit|operating profit loss|operating earnings|earnings from operations)$/.test(n) },
  { line: "netIncome", unit: "usd", root: true, test: (n) => /^(net income|net earnings|net loss|net income loss|net earnings loss)( attributable to [a-z0-9 &.,]+)?$/.test(n) && !/(noncontrolling|non controlling|minority|common|preferred|participating)/.test(n) },
  { line: "epsDiluted", unit: "usdPerShare", root: false, test: (n) => /\bdiluted\b/.test(n) && !/(continuing|discontinued|shares|dividend|book value|weighted)/.test(n) },
  { line: "netInterestIncome", unit: "usd", root: false, test: (n) => /^(total )?net interest income$/.test(n) },
  { line: "provisionCreditLosses", unit: "usd", root: false, test: (n) => /^(total )?provision (for|benefit for|benefit from|for benefit from) (credit|loan|loan and lease) losses$/.test(n) || n === "provision for credit losses" },
];

/** Standard line a payload series stands for, or null. */
export function stdLineOf(s: PayloadSeries): StdLine | null {
  // The printed name and the table it was printed in decide; page-made group titles ("Other segment
  // revenue lines") describe the page's grouping, not the figure, so they are not read.
  const words = `${s.label} ${s.bd ?? ""} ${s.sc ?? ""}`;
  if (OTHER_BASIS.test(s.unit === "usdPerShare" ? words.replace(/\b(earnings|income) per (common )?share\b/gi, " ") : words)) return null;
  const n = normLabel(s.label);
  for (const r of LINE_RULES) {
    if (r.unit !== s.unit || !r.test(n)) continue;
    if (r.root && s.parent && !s.total) return null;
    return r.line;
  }
  return null;
}

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const near = (a: string, b: string, days = 7) => Math.abs(ms(a) - ms(b)) <= days * DAY;

/** Precision a figure is printed at, from its trailing zeros (7,700,000,000 → 100,000,000). */
export function printedStep(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return 1;
  if (!Number.isInteger(a)) {
    const s = a.toFixed(6).replace(/0+$/, "");
    return 10 ** -(s.split(".")[1]?.length ?? 0);
  }
  let step = 1;
  while (step < 1e12 && a % (step * 10) === 0) step *= 10;
  return step;
}

/** Whether an IR figure agrees with the filing's figure (see the tolerances above). */
export function agrees(ir: number, sec: number, unit: string): boolean {
  if (ir !== 0 && sec !== 0 && Math.sign(ir) !== Math.sign(sec)) return false;
  const d = Math.abs(ir - sec);
  if (unit === "usdPerShare") return d <= Math.max(0.01, Math.abs(sec) * 0.01) + 1e-9;
  if (d <= Math.abs(sec) * 0.005) return true;
  const st = printedStep(ir);
  return st >= 1e6 && d <= st / 2 && d <= Math.abs(sec) * 0.05;
}

/** A label that names a loss carries the sign: "Net loss" 0.35 is −0.35. */
export function lossNamed(label: string): boolean {
  const n = normLabel(label);
  return /\bloss(es)?\b/.test(n) && !/\b(income|earnings|profit)\b/.test(n);
}

interface Ref { v: number; accn?: string; concept?: string; derived?: string }
interface SecSide {
  /** by period end (as printed by the filing) → value and its source */
  q: Map<string, Ref>;
  y: Map<string, Ref>;
}

function sideOf(st: CheckStatements, line: StdLine): SecSide {
  const read = (s: CheckStatement | null | undefined) => {
    const out = new Map<string, Ref>();
    const row = s?.rows.find((r) => r.key === line);
    if (!s || !row) return out;
    s.periods.forEach((p, i) => {
      const c = row.cells[i];
      if (c && Number.isFinite(c.v)) out.set(p.end, { v: c.v, accn: c.src?.accn, concept: c.src?.concept, derived: c.derived ?? (c.src?.accn ? undefined : "calculated") });
    });
    return out;
  };
  return { q: read(st.quarterly), y: read(st.annual) };
}

const find = (m: Map<string, Ref>, e: string) => {
  for (const [k, x] of m) if (near(k, e)) return x;
  return undefined;
};

const fmt = (v: number, unit: string) => {
  if (unit === "usdPerShare") return `$${v.toFixed(2)}`;
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e11 ? 1 : 2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : `$${Math.round(a).toLocaleString("en-US")}`;
  return v < 0 ? `−${s}` : s;
};
const filingOf = (kind: "q" | "y") => (kind === "q" ? "10-Q" : "10-K");

/** Year a filing was made, from its accession number (0001065696-26-000012 → 2026). */
export function accnYear(accn: string | undefined): number | null {
  const m = /^\d{10}-(\d{2})-\d{6}$/.exec(accn ?? "");
  return m ? 2000 + Number(m[1]) : null;
}

/** Whether the figure comes from a filing made after the period's own (a later comparative). */
export function laterFiling(ref: Ref, kind: "q" | "y", e: string): boolean {
  const y = accnYear(ref.accn);
  if (y == null) return false;
  // a quarter's own 10-Q comes within about 45 days, a year's 10-K within about 90
  const due = new Date(ms(e) + (kind === "q" ? 75 : 120) * DAY).getUTCFullYear();
  return y > due;
}

/** The real source of the filing's figure, for the flag text. */
export function sourceOf(ref: Ref, kind: "q" | "y", e: string, yearEnds: Iterable<string>): string {
  if (kind === "q" && ref.derived && [...yearEnds].some((y) => near(y, e))) return "the 10-K year less the first nine months";
  if (ref.derived) return `the statements' calculation (${ref.derived})`;
  const yr = accnYear(ref.accn);
  if (laterFiling(ref, kind, e)) return `a ${filingOf(kind)} filed in ${yr}, after this period's own filing`;
  return `the ${filingOf(kind)}${ref.accn ? ` (${ref.accn})` : ""}`;
}

/** Why a disagreement is a contradicted unit, sign or period (held), or null (flagged). */
function contradiction(ir: number, sec: number, unit: string, kind: "q" | "y", e: string, side: SecSide, f: string): string | null {
  if (sec !== 0 && ir !== 0 && unit !== "usdPerShare") {
    const k = Math.log10(Math.abs(ir / sec));
    const n = Math.round(k / 3) * 3;
    if (n !== 0 && Math.abs(k - n) < 0.01) return `${fmt(ir, unit)} is ${n > 0 ? "" : "1/"}${(10 ** Math.abs(n)).toLocaleString("en-US")}× the ${fmt(sec, unit)} from ${f}: unit contradicted by the filing`;
  }
  if (sec !== 0 && ir !== 0 && Math.sign(ir) !== Math.sign(sec)) return agrees(-ir, sec, unit) ? `${f} gives ${fmt(sec, unit)}: sign contradicted by the filing` : `${f} gives ${fmt(sec, unit)}, ${sec < 0 ? "a loss" : "a positive figure"}; this figure, ${fmt(ir, unit)}, has the opposite sign`;
  if (unit === "usdPerShare") return null;
  if (kind === "q") {
    const yr = find(side.y, e);
    if (yr && agrees(ir, yr.v, unit) && !agrees(sec, yr.v, unit)) return `${fmt(ir, unit)} is the 10-K's full-year figure; ${f} gives ${fmt(sec, unit)} for the quarter`;
    if (Math.abs(sec) > 0 && Math.abs(ir / sec - 4) < 0.08) return `${fmt(ir, unit)} is about four times the ${fmt(sec, unit)} from ${f}: an annualized or full-year figure in a quarter column`;
    for (const [k, x] of side.q) {
      const days = Math.abs(ms(k) - ms(e)) / DAY;
      if (days > 20 && days < 100 && agrees(ir, x.v, unit) && !agrees(sec, x.v, unit)) return `${fmt(ir, unit)} is the SEC figure for the quarter ending ${k}; ${f} gives ${fmt(sec, unit)} for this one`;
    }
  } else {
    const q = find(side.q, e);
    if (q && agrees(ir, q.v, unit) && !agrees(sec, q.v, unit)) return `${fmt(ir, unit)} is the fourth quarter's figure; ${f} gives ${fmt(sec, unit)} for the year`;
  }
  return null;
}

const keyOf = (k: string, kind: "q" | "y", e: string) => `${k}|${kind}|${e}`;

/**
 * Cross-checks the payload against the statements. Returns a new payload: held figures moved to
 * `held` (with any calculated value that uses them, and the tie-out checks they touch), flagged
 * figures carrying a `sec` flag; and the summary with every checked value.
 */
export function crossCheckSec(p: IrPayload, st: CheckStatements | null | undefined): { payload: IrPayload; check: SecCheck | null } {
  if (!st || (!st.quarterly && !st.annual)) return { payload: p, check: null };
  const candidates = new Map<StdLine, PayloadSeries[]>();
  for (const s of p.series) {
    const line = stdLineOf(s);
    if (line) candidates.set(line, [...(candidates.get(line) ?? []), s]);
  }
  const items: SecItem[] = [];
  const hold = new Map<string, string>();
  const flag = new Map<string, PayloadCellFlag>();
  const release = new Map<string, PayloadCell>();
  for (const [line, list] of candidates) {
    const side = sideOf(st, line);
    for (const kind of ["q", "y"] as const) {
      const sec = kind === "q" ? side.q : side.y;
      if (!sec.size) continue;
      const ends = new Set(list.flatMap((s) => [...Object.keys(kind === "q" ? s.q : s.y), ...Object.keys((kind === "q" ? s.held?.q : s.held?.y) ?? {})]));
      for (const e of ends) {
        const ref = find(sec, e);
        if (!ref) continue;
        const cells = list.flatMap((s) => {
          const c = (kind === "q" ? s.q : s.y)[e];
          return c ? [{ s, c }] : [];
        });
        // Figures the display guard held (a unit vote, a column read twice) that the filing confirms
        // exactly are shown again: the stored value is what the document prints, and SEC agrees.
        for (const s of list) {
          const h = (kind === "q" ? s.held?.q : s.held?.y)?.[e];
          if (!h || h.f || cells.some((x) => x.s === s) || !agrees(h.v, ref.v, s.unit)) continue;
          release.set(keyOf(s.k, kind, e), h);
          items.push({ k: s.k, label: s.label, line, kind, e, ir: h.v, sec: ref.v, accn: ref.accn, concept: ref.concept, status: "released", why: `Held by the unit guard (${(h.why ?? "").replace(/\.$/, "")}); the ${filingOf(kind)} reports the same figure, so it is shown.` });
        }
        if (!cells.length) continue;
        const yearEnds = side.y.keys();
        const src = sourceOf(ref, kind, e, [...yearEnds]);
        // the value as signed: a loss-named label carries the sign
        const signed = (s: PayloadSeries, c: PayloadCell) => (lossNamed(s.label) && c.v > 0 && ref.v < 0 ? -c.v : c.v);
        const anyAgrees = cells.some(({ s, c }) => agrees(signed(s, c), ref.v, s.unit));
        const top = Math.max(...cells.map((x) => Math.abs(x.c.v)));
        for (const { s, c } of cells) {
          const v = signed(s, c);
          const base = { k: s.k, label: s.label, line, kind, e, ir: c.v, sec: ref.v, accn: ref.accn, concept: ref.concept };
          const opposite = v !== 0 && ref.v !== 0 && Math.sign(v) !== Math.sign(ref.v);
          if (!opposite && agrees(v, ref.v, s.unit)) {
            items.push({ ...base, status: "agree", ...(src.startsWith("the 10-K year less") ? { why: `Compared with ${src}.` } : {}) });
            continue;
          }
          // A same-signed figure is compared when it is within 10% of the filing's, or when it is the
          // period's largest candidate and none agrees; a smaller line of the same name (a segment's
          // net interest income) is not compared, unless it is the filing's figure at another unit.
          const r = ref.v !== 0 ? Math.abs(v) / Math.abs(ref.v) : 1;
          const eligible = opposite || Math.abs(r - 1) <= 0.1 || (Math.abs(c.v) === top && !anyAgrees);
          const unitOff = ref.v !== 0 && v !== 0 && s.unit !== "usdPerShare" && (() => {
            const k = Math.log10(r);
            const n = Math.round(k / 3) * 3;
            return n !== 0 && Math.abs(k - n) < 0.01;
          })();
          if (!eligible && !unitOff) continue;
          const bad = contradiction(v, ref.v, s.unit, kind, e, side, src.charAt(0).toUpperCase() + src.slice(1));
          if (bad && !opposite) {
            hold.set(keyOf(s.k, kind, e), `${bad} (${ref.accn ?? "SEC filing"})`);
            items.push({ ...base, status: "held", why: bad });
            continue;
          }
          if (opposite) {
            // Sign first: an opposite sign is always marked. Held when it is the filing's figure with the
            // sign lost; flagged otherwise (another line of the same name may differ in size).
            const why = bad!;
            if (agrees(-v, ref.v, s.unit)) {
              hold.set(keyOf(s.k, kind, e), `${why} (${ref.accn ?? "SEC filing"})`);
              items.push({ ...base, status: "held", why });
            } else {
              flag.set(keyOf(s.k, kind, e), { k: "sec", why: `${why}.`, v: ref.v });
              items.push({ ...base, status: "flagged", why: `${why}.` });
            }
            continue;
          }
          const pct = ref.v !== 0 ? ((v - ref.v) / Math.abs(ref.v)) * 100 : null;
          const alt = c.alt && agrees(c.alt.v, ref.v, s.unit) ? ` ${c.alt.kind === "restated" ? "An earlier" : "Another"} document prints ${fmt(c.alt.v, s.unit)}, which agrees.` : "";
          const derived = c.f ? ` The figure is calculated: ${c.f.formula}.` : "";
          const diff = `${pct != null ? ` (${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%)` : ""}`;
          if (laterFiling(ref, kind, e) && !ref.derived) {
            const why = `The SEC figure, ${fmt(ref.v, s.unit)}, comes from ${src}; that filing may have recast the period, and the figure as first filed is not in the statements. This figure is ${fmt(c.v, s.unit)}${diff}.${alt}`;
            items.push({ ...base, status: "later", why });
            continue;
          }
          const why = `${src.charAt(0).toUpperCase() + src.slice(1)} gives ${fmt(ref.v, s.unit)}; this figure is ${fmt(c.v, s.unit)}${diff}.${alt}${derived}`;
          flag.set(keyOf(s.k, kind, e), { k: "sec", why, v: ref.v });
          items.push({ ...base, status: "flagged", why });
        }
      }
    }
  }
  if (!items.length) return { payload: p, check: { checked: 0, agree: 0, held: 0, flagged: 0, released: 0, later: 0, items } };

  // Calculated values that use a held figure are held too; tie-out checks touching one are dropped.
  const heldKeys = new Set(hold.keys());
  const usesHeld = (s: PayloadSeries, c: PayloadCell) => !!c.f?.parts.some((pt) => [...heldKeys].some((hk) => hk.startsWith(`${s.k}|`) && hk.endsWith(`|${pt.e}`) && Math.abs((s.q[pt.e] ?? s.y[pt.e])?.v - pt.v) < 1e-6));
  let extra = 0;
  const series = p.series.map((s) => {
    let changed = false;
    const out: PayloadSeries = { ...s, q: { ...s.q }, y: { ...s.y } };
    const held = { q: { ...(s.held?.q ?? {}) }, y: { ...(s.held?.y ?? {}) }, ...(s.held?.mo ? { mo: s.held.mo } : {}) };
    for (const kind of ["q", "y"] as const)
      for (const [e, c] of Object.entries(held[kind])) {
        if (!release.has(keyOf(s.k, kind, e))) continue;
        const { w: _w, why: _why, ...plain } = c;
        out[kind][e] = plain;
        delete held[kind][e];
        changed = true;
      }
    for (const kind of ["q", "y"] as const) {
      const cells = out[kind];
      for (const [e, c] of Object.entries(cells)) {
        const why = hold.get(keyOf(s.k, kind, e));
        const fl = flag.get(keyOf(s.k, kind, e));
        if (why) {
          held[kind][e] = { ...c, w: "suspect", why };
          delete cells[e];
          changed = true;
        } else if (fl) {
          cells[e] = { ...c, flags: [...(c.flags ?? []).filter((x) => x.k !== "sec"), fl] };
          changed = true;
        }
      }
    }
    if (heldKeys.size) {
      for (const kind of ["q", "y"] as const) {
        for (const [e, c] of Object.entries(out[kind])) {
          if (c.f && usesHeld(s, c)) {
            held[kind][e] = { ...c, w: "suspect", why: "calculated from a figure the SEC filing contradicts" };
            delete out[kind][e];
            heldKeys.add(keyOf(s.k, kind, e));
            extra++;
            changed = true;
          }
        }
      }
    }
    if (!changed) return s;
    out.held = held;
    return out;
  });
  const parentOf = new Map(p.series.map((s) => [s.k, s.parent]));
  const kindOf = (k: "q" | "fy") => (k === "q" ? "q" : "y");
  const checks = heldKeys.size
    ? p.checks.filter((c) => !heldKeys.has(keyOf(c.k, kindOf(c.kind), c.e)) && ![...heldKeys].some((hk) => {
        const [sk, kk, e] = hk.split("|");
        return kk === kindOf(c.kind) && e === c.e && parentOf.get(sk) === c.k;
      }))
    : p.checks;
  const held = items.filter((x) => x.status === "held").length;
  const released = items.filter((x) => x.status === "released").length;
  const later = items.filter((x) => x.status === "later").length;
  const check: SecCheck = { later, checked: items.length, agree: items.filter((x) => x.status === "agree" || x.status === "released").length, held, flagged: items.filter((x) => x.status === "flagged").length, released, items };
  return {
    payload: { ...p, series, checks, stats: { ...p.stats, held: Math.max(0, (p.stats.held ?? 0) + held + extra - released) } },
    check,
  };
}

/** The statement rows the cross-check needs, from a company dataset (null when it has none). */
export function checkStatementsOf(d: { statements?: { quarterly?: { income?: DatasetStatement }; annual?: { income?: DatasetStatement } } } | null | undefined): CheckStatements | null {
  const q = d?.statements?.quarterly?.income;
  const y = d?.statements?.annual?.income;
  if (!q && !y) return null;
  const slim = (s?: DatasetStatement): CheckStatement | null =>
    s ? { periods: s.periods.map((p) => ({ end: p.end, start: p.start })), rows: s.rows.map((r) => ({ key: r.key, cells: r.cells.map((c) => (c ? { v: c.v, src: c.src ? { accn: c.src.accn, concept: c.src.concept } : undefined, ...(c.derived ? { derived: c.derived.formula } : {}) } : null)) })) } : null;
  return { quarterly: slim(q), annual: slim(y) };
}
interface DatasetStatement {
  periods: { end: string; start?: string }[];
  rows: { key: string; cells: ({ v: number; src?: { accn?: string; concept?: string }; derived?: { formula: string } } | null)[] }[];
}
