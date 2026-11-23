// Read-time cross-check of the IR series against the company's SEC statements (pure; runs in the IR
// page worker after the tidy pass). The statements are the as-filed 10-Q/10-K figures of the
// company dataset, so they are an independent reading of the same quarters.
//
// What is compared: the consolidated standard lines both sides carry (revenue, operating income,
// net income, diluted EPS, and for banks net interest income and the provision for credit losses).
// An IR line counts as one of them when its printed name says so, its unit fits, and nothing in its
// name, table or scope marks it as a part of the company (a segment, a business), another basis
// (adjusted, non-GAAP, managed, fully taxable equivalent, annualized) or another measure; in each
// period only lines at least 90% the size of the largest such line are taken as the consolidated
// figure (a segment's "Net interest income" is smaller than the bank's).
//
// Tolerances: equal within 0.05% or $0.5 million (EPS within half a cent), or equal at the precision
// the release prints (a sentence's "$7.7 billion" agrees with 7,658 million).
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
  rows: { key: string; cells: ({ v: number; src?: { accn?: string; concept?: string } } | null)[] }[];
}
export interface CheckStatements {
  quarterly?: CheckStatement | null;
  annual?: CheckStatement | null;
}

export type SecStatus = "agree" | "held" | "flagged";
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
  items: SecItem[];
  /** time the check took in the worker, ms */
  ms?: number;
}

const OTHER_BASIS = /\b(adjusted|non-?gaap|core|underlying|operating basis|annuali[sz]ed|fte|fully taxable|taxable[- ]equivalent|tax[- ]equivalent|managed|pro forma|proforma|excluding|ex-|constant currency|organic|normalized|comparable|segment|segments|reportable|by business|by division|per share|margin|growth|change|yoy|guidance|outlook|forecast|budget|attributable to (noncontrolling|non-controlling|minority)|common (stock|share)holders|available to common)\b/i;

const LINE_RULES: { line: StdLine; unit: string; root: boolean; test: (n: string) => boolean }[] = [
  { line: "revenue", unit: "usd", root: true, test: (n) => /^(total )?(revenue|sales|net revenue|sales and (other )?revenue|revenue and other income|revenue net of interest expense)$/.test(n) },
  { line: "operatingIncome", unit: "usd", root: true, test: (n) => /^(total )?(operating income|operating income loss|operating loss|income from operations|income loss from operations|operating profit|operating profit loss|operating earnings|earnings from operations)$/.test(n) },
  { line: "netIncome", unit: "usd", root: true, test: (n) => /^(net income|net earnings|net loss|net income loss|net earnings loss)( attributable to [a-z0-9 &.,]+)?$/.test(n) && !/(noncontrolling|non controlling|minority|common|preferred|participating)/.test(n) },
  { line: "epsDiluted", unit: "usdPerShare", root: false, test: (n) => /\bdiluted\b/.test(n) && !/(continuing|discontinued|shares|dividend|book value|weighted)/.test(n) },
  { line: "netInterestIncome", unit: "usd", root: false, test: (n) => /^(total )?net interest income$/.test(n) },
  { line: "provisionCreditLosses", unit: "usd", root: false, test: (n) => /^(total )?provision (for|benefit for|benefit from|for benefit from) (credit|loan|loan and lease) losses$/.test(n) || n === "provision for credit losses" },
];

const groupTitleOf = (p: IrPayload) => {
  const m = new Map<string, string>();
  for (const g of p.groups) for (const r of g.rows) if (!m.has(r.k)) m.set(r.k, `${g.t ?? ""} ${g.label ?? ""}`);
  return m;
};

/** Standard line a payload series stands for, or null. */
export function stdLineOf(s: PayloadSeries, title = ""): StdLine | null {
  const words = `${s.label} ${s.bd ?? ""} ${s.sc ?? ""} ${title}`;
  if (OTHER_BASIS.test(words)) return null;
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
  if (unit === "usdPerShare") {
    if (Math.abs(ir - sec) <= 0.005 + 1e-9) return true;
    const st = printedStep(ir);
    return st >= 0.1 && Math.abs(ir - sec) <= st / 2 + 1e-9;
  }
  if (Math.abs(ir - sec) <= Math.max(Math.abs(sec) * 0.0005, 5e5)) return true;
  const st = printedStep(ir);
  return st >= 1e8 && Math.abs(ir - sec) <= st / 2;
}

interface SecSide {
  /** by period end (as printed by the filing) → value and its source */
  q: Map<string, { v: number; accn?: string; concept?: string }>;
  y: Map<string, { v: number; accn?: string; concept?: string }>;
}

function sideOf(st: CheckStatements, line: StdLine): SecSide {
  const read = (s: CheckStatement | null | undefined) => {
    const out = new Map<string, { v: number; accn?: string; concept?: string }>();
    const row = s?.rows.find((r) => r.key === line);
    if (!s || !row) return out;
    s.periods.forEach((p, i) => {
      const c = row.cells[i];
      if (c && Number.isFinite(c.v)) out.set(p.end, { v: c.v, accn: c.src?.accn, concept: c.src?.concept });
    });
    return out;
  };
  return { q: read(st.quarterly), y: read(st.annual) };
}

const find = (m: Map<string, { v: number; accn?: string; concept?: string }>, e: string) => {
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

/** Why a disagreement is a contradicted unit, sign or period (held), or null (flagged). */
function contradiction(ir: number, sec: number, unit: string, kind: "q" | "y", e: string, side: SecSide): string | null {
  const f = filingOf(kind);
  if (sec !== 0 && ir !== 0 && unit !== "usdPerShare") {
    const k = Math.log10(Math.abs(ir / sec));
    const n = Math.round(k / 3) * 3;
    if (n !== 0 && Math.abs(k - n) < 0.01) return `${fmt(ir, unit)} is ${n > 0 ? "" : "1/"}${(10 ** Math.abs(n)).toLocaleString("en-US")}× the ${f}'s ${fmt(sec, unit)}: unit contradicted by the filing`;
  }
  if (sec !== 0 && Math.sign(ir) !== Math.sign(sec) && agrees(-ir, sec, unit)) return `the ${f} reports ${fmt(sec, unit)}: sign contradicted by the filing`;
  if (unit === "usdPerShare") return null;
  if (kind === "q") {
    const yr = find(side.y, e);
    if (yr && agrees(ir, yr.v, unit) && !agrees(sec, yr.v, unit)) return `${fmt(ir, unit)} is the 10-K's full-year figure; the 10-Q reports ${fmt(sec, unit)} for the quarter`;
    if (Math.abs(sec) > 0 && Math.abs(ir / sec - 4) < 0.08) return `${fmt(ir, unit)} is about four times the 10-Q's ${fmt(sec, unit)}: an annualized or full-year figure in a quarter column`;
    for (const [k, x] of side.q) {
      const days = Math.abs(ms(k) - ms(e)) / DAY;
      if (days > 20 && days < 100 && agrees(ir, x.v, unit) && !agrees(sec, x.v, unit)) return `${fmt(ir, unit)} is the 10-Q's figure for the quarter ending ${k}; it reports ${fmt(sec, unit)} for this one`;
    }
  } else {
    const q = find(side.q, e);
    if (q && agrees(ir, q.v, unit) && !agrees(sec, q.v, unit)) return `${fmt(ir, unit)} is the fourth quarter's figure; the 10-K reports ${fmt(sec, unit)} for the year`;
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
  const titles = groupTitleOf(p);
  const candidates = new Map<StdLine, PayloadSeries[]>();
  for (const s of p.series) {
    const line = stdLineOf(s, titles.get(s.k));
    if (line) candidates.set(line, [...(candidates.get(line) ?? []), s]);
  }
  const items: SecItem[] = [];
  const hold = new Map<string, string>();
  const flag = new Map<string, PayloadCellFlag>();
  for (const [line, list] of candidates) {
    const side = sideOf(st, line);
    for (const kind of ["q", "y"] as const) {
      const sec = kind === "q" ? side.q : side.y;
      if (!sec.size) continue;
      const ends = new Set(list.flatMap((s) => Object.keys(kind === "q" ? s.q : s.y)));
      for (const e of ends) {
        const ref = find(sec, e);
        if (!ref) continue;
        const cells = list.flatMap((s) => {
          const c = (kind === "q" ? s.q : s.y)[e];
          return c ? [{ s, c }] : [];
        });
        const top = Math.max(...cells.map((x) => Math.abs(x.c.v)));
        for (const { s, c } of cells) {
          if (Math.abs(c.v) < 0.9 * top) continue;
          const base = { k: s.k, label: s.label, line, kind, e, ir: c.v, sec: ref.v, accn: ref.accn, concept: ref.concept };
          if (agrees(c.v, ref.v, s.unit)) {
            items.push({ ...base, status: "agree" });
            continue;
          }
          const bad = contradiction(c.v, ref.v, s.unit, kind, e, side);
          if (bad) {
            hold.set(keyOf(s.k, kind, e), `${bad} (${ref.accn ?? "SEC filing"})`);
            items.push({ ...base, status: "held", why: bad });
            continue;
          }
          const pct = ref.v !== 0 ? ((c.v - ref.v) / Math.abs(ref.v)) * 100 : null;
          const alt = c.alt && agrees(c.alt.v, ref.v, s.unit) ? ` ${c.alt.kind === "restated" ? "An earlier" : "Another"} document prints ${fmt(c.alt.v, s.unit)}, which agrees.` : "";
          const derived = c.f ? ` The figure is calculated: ${c.f.formula}.` : "";
          const why = `The ${filingOf(kind)} reports ${fmt(ref.v, s.unit)}; this figure is ${fmt(c.v, s.unit)}${pct != null ? ` (${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%)` : ""}.${alt}${derived}`;
          flag.set(keyOf(s.k, kind, e), { k: "sec", why, v: ref.v });
          items.push({ ...base, status: "flagged", why });
        }
      }
    }
  }
  if (!items.length) return { payload: p, check: { checked: 0, agree: 0, held: 0, flagged: 0, items } };

  // Calculated values that use a held figure are held too; tie-out checks touching one are dropped.
  const heldKeys = new Set(hold.keys());
  const usesHeld = (s: PayloadSeries, c: PayloadCell) => !!c.f?.parts.some((pt) => [...heldKeys].some((hk) => hk.startsWith(`${s.k}|`) && hk.endsWith(`|${pt.e}`) && Math.abs((s.q[pt.e] ?? s.y[pt.e])?.v - pt.v) < 1e-6));
  let extra = 0;
  const series = p.series.map((s) => {
    let changed = false;
    const out: PayloadSeries = { ...s, q: { ...s.q }, y: { ...s.y } };
    const held = { q: { ...(s.held?.q ?? {}) }, y: { ...(s.held?.y ?? {}) }, ...(s.held?.mo ? { mo: s.held.mo } : {}) };
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
  const check: SecCheck = { checked: items.length, agree: items.filter((x) => x.status === "agree").length, held, flagged: items.filter((x) => x.status === "flagged").length, items };
  return {
    payload: { ...p, series, checks, stats: { ...p.stats, held: (p.stats.held ?? 0) + held + extra } },
    check,
  };
}
