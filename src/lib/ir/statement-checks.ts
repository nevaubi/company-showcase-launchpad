// Pure: the arithmetic a printed statement itself proves, for the tie marks of totals and results the build
// stored no check for. The build's checks come from the parents the readers stored; a statement read straight
// from the document (table fill) has none, and a result printed under the lines it comes from (gross margin,
// operating income, net income, total assets) never had one. Both are checked here from the section's own rows:
//
// - a total with printed parts (`up`): the parts add up to it, period by period; where they only do with some
//   parts subtracted (deductions printed as positives), the same signs must hold in every period compared;
// - a result with no parts of its own: it equals the lines printed straight above it at its own level, each
//   added or subtracted (gross margin = total net sales − total cost of sales; net income = income before taxes
//   − provision; total assets = total current assets + total non-current assets). The shortest run of lines
//   above it that explains it is taken, every line of the run counts, and one set of signs must hold in every
//   period compared.
//
// A relation is stated only on evidence: at least `MIN_PERIODS` periods in which every term is printed tie to
// the printed precision (half a unit of the last printed digit per term), with figures large against that
// precision (`STRONG`: three small numbers that happen to add up are no evidence), and at most `OFF_SHARE` of
// the periods compared do not. A period that does not tie is then marked as not adding up (the figures shown
// really do not add up there); with more periods off than that the lines are not a formula and nothing is
// marked. A total's printed parts are its parts whatever the older periods say (the hierarchy is the newest
// table's, and fifteen years of history hold other compositions): its periods that tie are marked, and its
// periods that do not only when few are off. Where the periods taken together do not establish a relation,
// those in which the table printed no line it has since dropped are asked alone: the others are no evidence
// against a relation between the lines printed now. A period where a term is not printed is marked as tying only when the printed terms alone give the
// result; it is never marked as off. Neither is a period in which the table printed lines it no longer prints
// (`old` rows with a figure there: Apple's non-current liabilities held deferred revenue until 2018, so the two
// lines printed now do not add up to that year's total and say nothing against it).
// Only money and counts are added up: ratios, rates and per-share figures of neighbouring lines move together
// and "add up" by chance (JPM's capital ratios did).
// Nothing is corrected and no figure is derived.
import type { PayloadCell, PayloadCheck } from "@/lib/ir/payload";

/** Periods (quarters and years together) in which every term is printed that a relation must tie in. */
export const MIN_PERIODS = 2;
/** Share of the periods compared that may not tie before the lines are no formula at all. */
export const OFF_SHARE = 0.25;
/** Periods that must tie before a period that does not is marked as off. */
export const OFF_NEEDS = 4;
/** A period is evidence only when its largest figure is at least this many times the rounding allowed. */
export const STRONG = 20;
/** Units whose lines are added up. */
const ADDITIVE = new Set(["usd", "count"]);
/** Lines above a result tried with signs (2^n sign sets), and as a plain sum. */
export const SIGNED_RUN = 6;
export const SUM_RUN = 15;

export interface CheckFigures {
  cells: Record<string, PayloadCell>;
  /** period → key of the line that owns the figure */
  from: Record<string, string>;
}

/** A line row of a section as the checks read it. */
export interface CheckRow {
  /** index in the section's rows */
  i: number;
  label: string;
  unit: string;
  /** a balance (point in time), never mixed with flows */
  pit: boolean;
  /** printed as a total that closes parts here */
  total: boolean;
  /** index of the row it is printed as a part of */
  up?: number;
  /** a line only earlier documents print: neither a result nor a term */
  old?: boolean;
  q: CheckFigures;
  y: CheckFigures;
  /** smallest printed step of a figure, in full units (1e6 for whole millions; 1e5 for one decimal of millions) */
  step: (c: PayloadCell) => number;
}

type Freq = "q" | "y";
interface Term {
  row: CheckRow;
  sign: 1 | -1;
}

const figures = (r: CheckRow, f: Freq) => (f === "q" ? r.q : r.y);
/** A calculated figure (fourth quarter = year less nine months) carries the rounding of both its parts. */
const slack = (r: CheckRow, c: PayloadCell) => r.step(c) * (c.f ? 1 : 0.5);

interface Solved {
  signs: (1 | -1)[];
  periods: Period[];
  /** enough periods tie for one that does not to be marked as not adding up */
  marksOff: boolean;
}

interface Period {
  f: Freq;
  e: string;
  cell: PayloadCell;
  /** the terms' figures; undefined where a term is not printed for the period */
  parts: (PayloadCell | undefined)[];
  complete: boolean;
}

/** The periods of the result, with each term's figure of the same length. */
function periodsOf(result: CheckRow, terms: CheckRow[]): Period[] {
  const out: Period[] = [];
  for (const f of ["q", "y"] as const) {
    const rc = figures(result, f).cells;
    for (const [e, cell] of Object.entries(rc)) {
      const parts = terms.map((t) => {
        const c = figures(t, f).cells[e];
        return c && c.m === cell.m ? c : undefined;
      });
      out.push({ f, e, cell, parts, complete: parts.every(Boolean) });
    }
  }
  return out;
}

const tolOf = (result: CheckRow, terms: CheckRow[], p: Period) =>
  slack(result, p.cell) + p.parts.reduce((n, c, i) => n + (c ? slack(terms[i], c) : 0), 0) + 1e-6;

/**
 * The signs under which the terms give the result: tried on the complete periods, kept when enough of them tie
 * (see the module comment). Null when the lines are no formula.
 */
function solve(
  result: CheckRow,
  terms: CheckRow[],
  signed: boolean,
  /** the terms are the result's printed parts (the section's hierarchy): periods off never unmake the relation */
  parts = false,
  /** "<q|y>|<period end>" in which the table printed lines it no longer prints: no evidence either way */
  changed: ReadonlySet<string> = new Set(),
): Solved | null {
  const periods = periodsOf(result, terms);
  const complete = periods.filter((p) => p.complete && !changed.has(`${p.f}|${p.e}`));
  if (complete.length < MIN_PERIODS) return null;
  // A term printed as zero wherever it is compared says nothing: the run without it is the formula, if any.
  if (terms.some((_, i) => complete.every((p) => p.parts[i]!.v === 0))) return null;
  // Two periods that print the same figures are one piece of evidence.
  const distinct = new Set(complete.map((p) => `${p.cell.v}|${p.parts.map((c) => c!.v).join("|")}`));
  if (distinct.size < MIN_PERIODS) return null;
  const n = terms.length;
  const sets = signed ? 1 << n : 1;
  const tols = complete.map((p) => tolOf(result, terms, p));
  const strong = complete.map((p, x) => Math.max(Math.abs(p.cell.v), ...p.parts.map((c) => Math.abs(c!.v))) >= STRONG * tols[x]);
  let best: { signs: (1 | -1)[]; ok: number; strong: number } | null = null;
  let tie = false;
  for (let mask = 0; mask < sets; mask++) {
    const signs = terms.map((_, i) => ((mask >> i) & 1 ? -1 : 1) as 1 | -1);
    let ok = 0;
    let good = 0;
    complete.forEach((p, x) => {
      const sum = p.parts.reduce((s, c, i) => s + signs[i] * c!.v, 0);
      if (Math.abs(sum - p.cell.v) > tols[x]) return;
      ok++;
      if (strong[x]) good++;
    });
    if (!best || ok > best.ok) {
      best = { signs, ok, strong: good };
      tie = false;
    } else if (ok === best.ok) tie = true;
  }
  if (!best || best.ok < MIN_PERIODS || best.strong < MIN_PERIODS) return null;
  const off = complete.length - best.ok;
  const few = best.ok < OFF_NEEDS || off / complete.length > OFF_SHARE;
  if (off > 0 && few && !parts) return null;
  // Two sign sets that explain the periods equally well: the lines do not say which it is.
  if (tie) return null;
  return { signs: best.signs, periods, marksOff: !(off > 0 && few) };
}

/**
 * A relation over every period compared; failing that, over the periods in which the table printed no line it
 * has since dropped (a section with a long history of other lines still proves its newest periods).
 */
const either = (result: CheckRow, terms: CheckRow[], signed: boolean, parts: boolean, changed: ReadonlySet<string>) =>
  solve(result, terms, signed, parts) ?? (changed.size ? solve(result, terms, signed, parts, changed) : null);

const words = (terms: Term[]) =>
  terms.map((t, i) => `${i === 0 ? (t.sign < 0 ? "−" : "") : t.sign < 0 ? " − " : " + "}${t.row.label}`).join("");

/** The checks of one solved relation, keyed "<owner line>|<q|y>|<period end>". */
function emit(
  out: Map<string, PayloadCheck>,
  result: CheckRow,
  terms: CheckRow[],
  solved: Solved,
  by: "block" | "formula",
  taken: (key: string) => boolean,
  /** "<q|y>|<period end>" in which the section shows a line only earlier documents print */
  changed: Set<string>,
  /** lines were left out of the payload (see `printedChecks`) */
  partial: boolean,
) {
  const signed: Term[] = terms.map((row, i) => ({ row, sign: solved.signs[i] }));
  const sub = signed.filter((t) => t.sign < 0).map((t) => t.row.label);
  const f = by === "formula" ? `${result.label} = ${words(signed)}` : undefined;
  for (const p of solved.periods) {
    const owner = figures(result, p.f).from[p.e];
    if (!owner) continue;
    const key = `${owner}|${p.f}|${p.e}`;
    if (taken(key) || out.has(key)) continue;
    const present = p.parts.filter(Boolean).length;
    if (present < 2 && !p.complete) continue;
    const sum = p.parts.reduce((s, c, i) => s + (c ? solved.signs[i] * c.v : 0), 0);
    const ok = Math.abs(sum - p.cell.v) <= tolOf(result, terms, p);
    // A period missing a term is stated only when the printed terms alone give the result; so is a period in
    // which the table printed lines it no longer prints.
    if (!ok && (!solved.marksOff || !p.complete || changed.has(`${p.f}|${p.e}`))) continue;
    // With lines left out of the payload, the lines a table printed then are not all known: a period is off
    // only when one document prints the result and every term, and they do not add up there.
    if (!ok && partial && p.parts.some((c) => c!.d == null || c!.d !== p.cell.d)) continue;
    out.set(key, {
      k: owner,
      e: p.e,
      kind: p.f === "q" ? "q" : "fy",
      total: p.cell.v,
      sum,
      ok,
      n: present,
      ...(sub.length ? { sub } : {}),
      by,
      ...(f ? { f } : {}),
    });
  }
}

/**
 * Checks the section's rows prove for totals and results that have none yet (`taken` says a key already carries
 * a check, which then stands). See the module comment for the rules.
 */
export function printedChecks(
  rows: CheckRow[],
  taken: (key: string) => boolean,
  /**
   * The payload left lines out to fit the page (payload-budget.ts): which lines a table printed in an earlier
   * period is then not fully known, and a period is marked as not adding up only within one document.
   */
  partial = false,
): Map<string, PayloadCheck> {
  const out = new Map<string, PayloadCheck>();
  const byIndex = new Map(rows.map((r) => [r.i, r]));
  const partsOf = new Map<number, CheckRow[]>();
  for (const r of rows) if (r.up != null && byIndex.has(r.up)) partsOf.set(r.up, [...(partsOf.get(r.up) ?? []), r]);
  const comparable = (a: CheckRow, b: CheckRow) => a.unit === b.unit && a.pit === b.pit;
  const settled = new Set<number>();
  /** Periods in which a line only earlier documents print carries a figure comparable with `r`. */
  const changedFor = (r: CheckRow) => {
    const out = new Set<string>();
    for (const o of rows) {
      if (!o.old || !comparable(o, r)) continue;
      for (const f of ["q", "y"] as const) for (const e of Object.keys(figures(o, f).cells)) out.add(`${f}|${e}`);
    }
    return out;
  };

  // Totals with printed parts.
  for (const t of rows) {
    if (!t.total || t.old || !ADDITIVE.has(t.unit)) continue;
    const parts = (partsOf.get(t.i) ?? []).filter((p) => !p.old);
    if (parts.length < 2 || parts.some((p) => !comparable(p, t))) continue;
    const changed = changedFor(t);
    const solved =
      either(t, parts, false, true, changed) ??
      (parts.length <= SIGNED_RUN + 2 ? either(t, parts, true, false, changed) : null);
    if (!solved) continue;
    emit(out, t, parts, solved, "block", taken, changed, partial);
    settled.add(t.i);
  }

  // Results of the lines printed above them, at the top level of the section.
  const top = rows.filter((r) => r.up == null && !r.old);
  top.forEach((r, j) => {
    if (settled.has(r.i) || !ADDITIVE.has(r.unit)) return;
    const above: CheckRow[] = [];
    for (let x = j - 1; x >= 0 && above.length < SUM_RUN; x--) if (comparable(top[x], r)) above.unshift(top[x]);
    if (above.length < 2) return;
    const changed = changedFor(r);
    for (let k = 2; k <= above.length; k++) {
      const run = above.slice(above.length - k);
      const solved = either(r, run, k <= SIGNED_RUN, false, changed);
      if (!solved) continue;
      emit(out, r, run, solved, "formula", taken, changed, partial);
      return;
    }
  });
  return out;
}
