// Display guard for IR figures already stored (pure; runs at the end of `tidyPayload`, so stored
// payloads get it on load). Stored rows can't be repaired from the page, so a figure whose unit or
// period the documents contradict is held back: it moves out of the series' `q` / `y` / `mo` cells into
// `held`, which no chart, change, total, check or export reads, and the table shows it as a quiet flag
// with the reason and the click-to-source of the cell. A value is never "corrected" by multiplying or
// dividing it. Rules, for money and count lines only (percentages, ratios, basis points and per-share
// figures are small by nature):
//   1. marked suspect when it was stored (scale-check.ts); older builds' neighbour flags ("scale") are
//      dropped and re-decided here, because that test could hold the one correct quarter;
//   2. $10 trillion or more ($1 quadrillion for AUM, custody, client-asset and volume lines);
//   3. a cluster of the line's own values (split at 100× steps) set against the cluster most of its
//      values sit in (yearly flows count a quarter, one-month flows three times; see baselineOf): held when moving it
//      by the nearest power of 1,000 puts it among the line's other values (a unit slip), or when one or
//      two values sit 900× or more above them; anything else (fast growth, a business winding down, a
//      small value on a line that crosses zero, a line that mixes two measures) stays;
//   4. 900× or more its own printed total, or a total 900× or more the sum of its printed lines;
//   5. a figure the same document prints for another period of the same line while it prints a
//      different figure for this one (a column read under the wrong period);
//   6. a calculated value that uses a held figure.
import { CUSTODY, CUSTODY_METRICS, MAX_USD, MAX_USD_CUSTODY, SLIP, fmtTimes } from "@/lib/ir/scale-check";
import type { IrPayload, PayloadCell, PayloadCheck, PayloadSeries } from "@/lib/ir/payload";

type Kind = "q" | "y" | "mo";
const KINDS: Kind[] = ["q", "y", "mo"];
const GUARDED = new Set(["usd", "count"]);
const LOG_SLIP = Math.log10(SLIP);
/** Values split into clusters at a 100× step between neighbours in size; clusters then count as apart at 900×. */
const LOG_SPLIT = 2;

/** Reasons by series key, period kind and period end. */
export type SuspectMap = Map<string, Map<Kind, Map<string, string>>>;

const cellsOf = (s: PayloadSeries, k: Kind): Record<string, PayloadCell> => (k === "q" ? s.q : k === "y" ? s.y : (s.mo ?? {}));
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const labelKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[’']/g, "")
    .replace(/^\s*total\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** Strict name identity for rule 7: case, a leading "Total", punctuation and a plural "s" aside. */
const sameName = (s: string) =>
  labelKey(s)
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");

/** Moved by the nearest power of 1,000, does `c` land among `base`'s values? Returns the shift in decades, or 0. */
function slipShift<X extends { lg: number }>(c: X[], base: X[]): number {
  const d = median(base.map((x) => x.lg)) - median(c.map((x) => x.lg));
  const shift = 3 * Math.round(Math.abs(d) / 3) * Math.sign(d);
  if (Math.abs(d) < 2.3 || shift === 0) return 0;
  const lo = base[0].lg - 0.5;
  const hi = base[base.length - 1].lg + 0.5;
  return c.every((x) => x.lg + shift >= lo && x.lg + shift <= hi) ? shift : 0;
}

/**
 * The cluster a line's values are judged against: the one most of them sit in. When another cluster of
 * three or more is the same figures in another unit (older releases in thousands, newer in dollars), the
 * majority is no evidence, so the one nearer the company's usual line size is taken (for counts,
 * which have no usual size, neither: nothing is held on this rule). With no clear
 * majority, or a majority of two that sits farther from the company's usual size than another cluster,
 * there is no baseline and nothing is held on this rule.
 */
function baselineOf<X extends { lg: number }>(clusters: X[][], company: number | undefined, unit: string): X[] | null {
  const sizes = clusters.map((c) => c.length);
  const top = Math.max(...sizes);
  if (top < 2 || sizes.filter((n) => n === top).length !== 1) return null;
  const major = clusters[sizes.indexOf(top)];
  // Counts (shares, volumes, stores) have no usual company size: two unit twins leave no side to trust.
  if (unit === "count" && top >= 3 && clusters.some((c) => c !== major && c.length >= 3 && slipShift(c, major) !== 0)) return null;
  if (company == null) return top >= 3 ? major : null;
  const dist = (c: X[]) => Math.abs(median(c.map((x) => x.lg)) - company);
  if (top < 3) return clusters.some((c) => c !== major && dist(c) < dist(major)) ? null : major;
  // A twin outvoted by a small majority (2 against 3 or 4), or by a majority sitting ~300× and more above
  // the company's usual line size (a whole run read in the wrong unit), still decides.
  const majorTooBig = median(major.map((x) => x.lg)) - company >= 2.5;
  const twin = clusters.find((c) => c !== major && slipShift(c, major) !== 0 && dist(c) + 1 <= dist(major) && (c.length >= 3 || (c.length >= 2 && top <= 4) || majorTooBig));
  return twin ?? major;
}

/** The step a figure is printed to, from its trailing zeros (657,000,000 → 1,000,000; 896,126,437 → 1). */
export function printedStep(v: number): number {
  let n = Math.round(Math.abs(v));
  if (!n) return 1;
  let step = 1;
  while (n % 10 === 0 && step < 1e12) {
    n /= 10;
    step *= 10;
  }
  return step;
}

/** Finds the cells to hold back; see the rules at the top of this file. */
export function findSuspects(p: IrPayload): SuspectMap {
  const out: SuspectMap = new Map();
  const flag = (s: PayloadSeries, k: Kind, e: string, why: string) => {
    let byKind = out.get(s.k);
    if (!byKind) out.set(s.k, (byKind = new Map()));
    let m = byKind.get(k);
    if (!m) byKind.set(k, (m = new Map()));
    if (!m.has(e)) m.set(e, why);
  };
  const isFlagged = (s: PayloadSeries, k: Kind, e: string) => !!out.get(s.k)?.get(k)?.has(e);
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const bdOf = new Map<string, string>();
  for (const g of p.groups) for (const r of g.rows) if (g.bd) bdOf.set(r.k, g.bd);

  // The company's usual size of a line, per unit: the middle of all its printed values.
  const companyLg = new Map<string, number>();
  for (const unit of GUARDED) {
    const lgs = p.series.filter((s) => s.unit === unit).flatMap((s) => Object.values(s.q).filter((c) => c.v && !c.f).map((c) => Math.log10(Math.abs(c.v))));
    if (lgs.length >= 20) companyLg.set(unit, median(lgs));
  }
  for (const s of p.series) {
    if (!GUARDED.has(s.unit)) continue;
    const custody = CUSTODY_METRICS.has(s.met) || CUSTODY.test(`${s.label} ${s.parent ? byKey.get(s.parent)?.label ?? "" : ""} ${s.bd ?? bdOf.get(s.k) ?? ""}`);
    // 1–2. Marked at storage or by older builds; larger than any company reports.
    for (const k of KINDS)
      for (const [e, c] of Object.entries(cellsOf(s, k))) {
        // Older builds' "scale" flag (a neighbour test that could pick the wrong side) is re-decided below.
        if (c.w === "suspect") flag(s, k, e, c.why ?? "Its unit is contradicted by the documents");
        else if (s.unit === "usd" && Math.abs(c.v) >= (custody ? MAX_USD_CUSTODY : MAX_USD))
          flag(s, k, e, `Reads as more than $${custody ? "1 quadrillion" : "10 trillion"}, more than any company reports: a unit was probably applied twice`);
      }
    // 3. Clusters of the line's own values.
    const pts: { k: Kind; e: string; lg: number }[] = [];
    for (const k of KINDS)
      for (const [e, c] of Object.entries(cellsOf(s, k))) {
        if (!c.v || isFlagged(s, k, e)) continue;
        const flow = !s.pit && c.m !== 0;
        const norm = k === "y" && flow ? Math.abs(c.v) / 4 : k === "mo" && flow && c.m === 1 ? Math.abs(c.v) * 3 : Math.abs(c.v);
        pts.push({ k, e, lg: Math.log10(norm) });
      }
    pts.sort((a, b) => a.lg - b.lg);
    const signs = new Set(KINDS.flatMap((k) => Object.values(cellsOf(s, k)).filter((c) => c.v).map((c) => Math.sign(c.v))));
    const clusters: (typeof pts)[] = [];
    for (const x of pts) {
      const last = clusters[clusters.length - 1];
      if (last && x.lg - last[last.length - 1].lg < LOG_SPLIT) last.push(x);
      else clusters.push([x]);
    }
    if (clusters.length > 1) {
      const base = baselineOf(clusters, companyLg.get(s.unit), s.unit);
      if (base) {
        const baseMed = median(base.map((x) => x.lg));
        for (const c of clusters) {
          if (c === base) continue;
          const med = median(c.map((x) => x.lg));
          const d = Math.abs(med - baseMed);
          const ratio = 10 ** d;
          // A unit slip: moved by the nearest power of 1,000, the cluster lands among the line's other values.
          const shift = slipShift(c, base);
          const slip = shift !== 0;
          // A result line that crosses zero can print "(1)" in a quarter: a small value there is not a slip.
          if (med < baseMed && signs.size > 1) continue;
          // Far above the line and not a unit slip: held only as one or two stray values (glued cells).
          if (!slip && !(med > baseMed && d >= LOG_SLIP && c.length <= 2)) continue;
          const why = `About ${fmtTimes(slip ? 10 ** Math.abs(shift) : ratio)}× ${med > baseMed ? "larger" : "smaller"} than this line's other periods: a different unit was probably read here`;
          for (const x of c) flag(s, x.k, x.e, why);
        }
      }
    }
  }

  // 4. A line against its own printed total, and a total against its lines.
  const kids = new Map<string, PayloadSeries[]>();
  for (const s of p.series) if (s.parent) (kids.get(s.parent) ?? kids.set(s.parent, []).get(s.parent)!).push(s);
  for (const s of p.series) {
    if (!GUARDED.has(s.unit)) continue;
    const parent = s.parent ? byKey.get(s.parent) : undefined;
    for (const k of ["q", "y"] as Kind[])
      for (const [e, c] of Object.entries(cellsOf(s, k))) {
        if (isFlagged(s, k, e) || !c.v) continue;
        const pc = parent && parent.unit === s.unit ? cellsOf(parent, k)[e] : undefined;
        if (pc?.v && !isFlagged(parent!, k, e) && Math.abs(c.v / pc.v) >= SLIP) flag(s, k, e, `About ${fmtTimes(Math.abs(c.v / pc.v))}× its own total (${parent!.label}): a different unit was probably read here`);
        const parts = (kids.get(s.k) ?? []).filter((x) => x.unit === s.unit && cellsOf(x, k)[e] && !isFlagged(x, k, e));
        if (parts.length >= 2) {
          const sum = parts.reduce((n, x) => n + Math.abs(cellsOf(x, k)[e].v), 0);
          if (sum && Math.abs(c.v) / sum >= SLIP) flag(s, k, e, `About ${fmtTimes(Math.abs(c.v) / sum)}× the sum of its own lines: a different unit was probably read here`);
        }
      }
  }

  // 5. A column read under the wrong period: same document, same line printed in two tables.
  const printed = new Map<string, { s: PayloadSeries; k: Kind; e: string; v: number }[]>();
  for (const s of p.series) {
    if (!GUARDED.has(s.unit)) continue;
    const name = labelKey(s.label);
    for (const k of ["q", "y"] as Kind[])
      for (const [e, c] of Object.entries(cellsOf(s, k))) {
        if (c.d == null || c.f) continue;
        const id = `${c.d}|${s.unit}|${k}|${name}`;
        (printed.get(id) ?? printed.set(id, []).get(id)!).push({ s, k, e, v: c.v });
      }
  }
  // The same printed figure: equal to the coarser printing's precision ("104.1" billion and 104,129
  // million agree; 104,129 and 104,143 million are two figures, AMZN's North America operating expenses
  // and net sales). The search window stays the old 0.05%, a superset of what this accepts.
  const same = (a: number, b: number) => Math.abs(a - b) <= Math.min(Math.max(printedStep(a), printedStep(b)) / 2, Math.max(Math.abs(a), Math.abs(b)) * 5e-4);
  for (const list of printed.values()) {
    if (list.length < 3) continue;
    // Indexed by period and by value, so a label printed many times in one document stays near linear.
    const byE = new Map<string, typeof list>();
    for (const x of list) (byE.get(x.e) ?? byE.set(x.e, []).get(x.e)!).push(x);
    const sorted = [...list].sort((a, b) => a.v - b.v);
    const order = new Map(list.map((y, i) => [y, i]));
    /** Items whose value is the same figure as v (within `same`'s tolerance). */
    const near = (v: number) => {
      const tol = Math.abs(v) * 5e-4 / (1 - 5e-4);
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].v < v - tol) lo = mid + 1;
        else hi = mid;
      }
      const out: typeof list = [];
      for (let i = lo; i < sorted.length && sorted[i].v <= v + tol; i++) if (same(sorted[i].v, v)) out.push(sorted[i]);
      return out;
    };
    for (const x of list) {
      // Lines that print x's figure for another period, and what they print for x's period.
      const twins = new Map<PayloadSeries, string>();
      for (const y of near(x.v).sort((a, b) => order.get(a)! - order.get(b)!)) if (y.s !== x.s && y.e !== x.e && !twins.has(y.s)) twins.set(y.s, y.e);
      if (!twins.size) continue;
      for (const o of byE.get(x.e)!) {
        if (o.s === x.s || same(o.v, x.v)) continue;
        const twinE = twins.get(o.s);
        if (!twinE) continue;
        flag(x.s, x.k, x.e, `The same document prints this figure for the period ending ${twinE} and ${o.v.toLocaleString("en-US")} for this one (${o.s.label}): the column was probably read under the wrong period`);
        break;
      }
    }
  }

  // 7. A line printed in another unit than the same line in the same table: for one period, the cell's
  // other printed figure (alt), or a line of the same name in the same table, is 1,000× or 1,000,000×
  // this figure with the same digits to the printed precision (the digits agree; a real segment never does that to its total).
  // The same document's other figures of the line, and of the lines under it, share the table's unit.
  const proven: { s: PayloadSeries; d: number; e: string; why: string }[] = [];
  // Which side of a 1,000× pair is the slip: the one farther from the company's usual line size (all
  // its printed quarter figures of the unit; years count a quarter). HOOD prints 1,274,000,000 for a quarter and
  // another document 1,274,100,000,000: there the large side is the slip and nothing shown is held.
  const usual = new Map<string, number>();
  for (const unit of GUARDED) {
    const lgs = p.series
      .filter((s) => s.unit === unit)
      .flatMap((s) => Object.values(s.q).filter((c) => c.v && !c.f).map((c) => Math.log10(Math.abs(c.v))));
    if (lgs.length >= 6) usual.set(unit, median(lgs));
  }
  const unitSlip = (small: number, big: number, unit: string, k: Kind): number | null => {
    if (!small || Math.sign(small) !== Math.sign(big)) return null;
    // The digits must agree (review p3-ir M2: KEY -660,000 against -657,000,000 is 995×, not a slip):
    // the large figure is the small one times 1,000 or 1,000,000 to the large figure's printed
    // precision, or to the small one's last digit when the large one is printed in full.
    const f = [1e3, 1e6].find((x) => Math.abs(Math.abs(big) - Math.abs(small) * x) <= Math.max(printedStep(big), x / 2));
    const at = usual.get(unit);
    if (!f || at == null) return null;
    const lg = (v: number) => Math.log10(Math.abs(k === "y" ? v / 4 : v));
    return Math.abs(lg(big) - at) + 1 <= Math.abs(lg(small) - at) ? f : null;
  };
  const slipWhy = (other: string, big: number, f: number) =>
    `${other} prints ${big.toLocaleString("en-US")} for this period, ${f === 1e3 ? "1,000" : "1,000,000"}× this figure: this line was probably read in ${f === 1e3 ? "thousands" : "millions"} as if in dollars`;
  const tableKey = (s: PayloadSeries) => {
    const bd = s.bd ?? bdOf.get(s.k);
    return bd ? `${s.unit}|${bd.toLowerCase()}|${sameName(s.label)}` : null;
  };
  const sameTable = new Map<string, PayloadSeries[]>();
  for (const s of p.series) {
    if (!GUARDED.has(s.unit)) continue;
    const key = tableKey(s);
    if (key) (sameTable.get(key) ?? sameTable.set(key, []).get(key)!).push(s);
  }
  for (const s of p.series) {
    if (!GUARDED.has(s.unit)) continue;
    const twins = (sameTable.get(tableKey(s) ?? "") ?? []).filter((x) => x !== s);
    for (const k of ["q", "y"] as Kind[])
      for (const [e, c] of Object.entries(cellsOf(s, k))) {
        // A cell another rule already holds still proves its document's unit for the lines under it.
        if (c.f || c.d == null) continue;
        const already = isFlagged(s, k, e);
        let why: string | null = null;
        const fa = c.alt ? unitSlip(c.v, c.alt.v, s.unit, k) : null;
        if (fa && c.alt) why = slipWhy(c.alt.d != null && c.alt.d === c.d ? "This document also prints this line in the same table and" : "Another document prints this line in the same table and", c.alt.v, fa);
        for (const t of twins) {
          if (why) break;
          const tc = cellsOf(t, k)[e];
          if (!tc || tc.f || isFlagged(t, k, e)) continue;
          const f = unitSlip(c.v, tc.v, s.unit, k);
          if (f) why = slipWhy(`The same table's line “${t.label}”`, tc.v, f);
        }
        if (!why) continue;
        if (!already) flag(s, k, e, why);
        proven.push({ s, d: c.d, e, why });
      }
  }
  for (const x of proven) {
    const also = `The same document prints this table in another unit (period ending ${x.e}: ${x.why.split(": ")[0].replace(/^./, (m) => m.toLowerCase())})`;
    for (const t of [x.s, ...(kids.get(x.s.k) ?? [])])
      for (const k of KINDS)
        for (const [e, c] of Object.entries(cellsOf(t, k))) if (!c.f && c.d === x.d && !isFlagged(t, k, e)) flag(t, k, e, also);
  }

  // 6. Calculated values that use a held figure.
  for (const s of p.series)
    for (const k of KINDS)
      for (const [e, c] of Object.entries(cellsOf(s, k))) {
        if (!c.f || isFlagged(s, k, e)) continue;
        const bad = c.f.parts.find((pt) => KINDS.some((k2) => Object.entries(cellsOf(s, k2)).some(([e2, c2]) => isFlagged(s, k2, e2) && e2 === pt.e && c2.v === pt.v)));
        if (bad) flag(s, k, e, "Calculated from a figure held back on this line");
      }
  return out;
}

/** Whether `big` is `small` printed in thousands or millions: 1,000× or 1,000,000× exactly to `small`'s last digit. */
export function sameDigits(small: number, big: number): boolean {
  if (!small || Math.sign(small) !== Math.sign(big) || Math.abs(big) <= Math.abs(small)) return false;
  return [1e3, 1e6].some((f) => Math.abs(big - small * f) < f / 2);
}

/**
 * A held figure whose other printing (`alt`) is the same period of the same line can leave the right
 * figure behind (SMCI net sales Q4 FY2020: 896,126 from a release in thousands is held, the release
 * printing 896,126,000 was its `alt`; review p3-ir M1). The other printing takes the cell, keeping the
 * held figure as its `alt`, and goes through every rule again: if any holds it, the original hold stands.
 * Holds of the first pass are never undone except for the promoted cells themselves.
 */
function promoteAlts(p: IrPayload, found: SuspectMap): { p: IrPayload; found: SuspectMap } {
  const promoted: { k: string; kind: Kind; e: string }[] = [];
  const series = p.series.map((s) => {
    const byKind = found.get(s.k);
    if (!byKind) return s;
    let next: PayloadSeries | null = null;
    for (const [kind, m] of byKind)
      for (const e of m.keys()) {
        const c = cellsOf(next ?? s, kind)[e];
        // Only the same digits in another unit (1,000× or 1,000,000× to the figure's last printed
        // digit): another figure entirely (a segment total, a restatement) is no proof of anything.
        if (!c?.alt || c.f || !sameDigits(c.v, c.alt.v)) continue;
        next ??= { ...s, q: { ...s.q }, y: { ...s.y }, ...(s.mo ? { mo: { ...s.mo } } : {}) };
        const { kind: _k, ...a } = c.alt;
        const { alt: _a, w: _w, why: _why, flags: _f, ...old } = c;
        cellsOf(next, kind)[e] = { ...a, ...(c.s ? { s: c.s } : {}), alt: { ...old, kind: "conflict" } };
        promoted.push({ k: s.k, kind, e });
      }
    return next ?? s;
  });
  if (!promoted.length) return { p, found };
  const p1 = { ...p, series };
  const again = findSuspects(p1);
  const out: SuspectMap = new Map();
  const put = (k: string, kind: Kind, e: string, why: string) => {
    let byKind = out.get(k);
    if (!byKind) out.set(k, (byKind = new Map()));
    let m = byKind.get(kind);
    if (!m) byKind.set(kind, (m = new Map()));
    if (!m.has(e)) m.set(e, why);
  };
  const isPromoted = new Set(promoted.map((x) => `${x.k}|${x.kind}|${x.e}`));
  const failed = new Set(promoted.filter((x) => again.get(x.k)?.get(x.kind)?.has(x.e)).map((x) => `${x.k}|${x.kind}|${x.e}`));
  // The first pass's holds stand (rule 7's document sweep included), except promoted cells that pass.
  for (const [k, byKind] of found) for (const [kind, m] of byKind) for (const [e, why] of m) if (!isPromoted.has(`${k}|${kind}|${e}`) || failed.has(`${k}|${kind}|${e}`)) put(k, kind, e, why);
  for (const [k, byKind] of again) for (const [kind, m] of byKind) for (const [e, why] of m) if (!isPromoted.has(`${k}|${kind}|${e}`)) put(k, kind, e, why);
  // A promoted cell that fails goes back to the figure that was stored, held with its first reason.
  const restored = p1.series.map((s, i) => {
    const mine = promoted.filter((x) => x.k === s.k && failed.has(`${x.k}|${x.kind}|${x.e}`));
    if (!mine.length) return s;
    const orig = p.series[i];
    const next = { ...s, q: { ...s.q }, y: { ...s.y }, ...(s.mo ? { mo: { ...s.mo } } : {}) };
    for (const x of mine) cellsOf(next, x.kind)[x.e] = cellsOf(orig, x.kind)[x.e];
    return next;
  });
  return { p: { ...p1, series: restored }, found: out };
}

/** Moves suspect cells into `held`, drops the tie-out checks that used them and recounts the stats. */
export function holdSuspects(p0: IrPayload): IrPayload {
  const { p, found } = promoteAlts(p0, findSuspects(p0));
  let held = 0;
  let conflicts = 0;
  const heldAt = new Set<string>();
  const series = p.series.map((s) => {
    const byKind = found.get(s.k);
    const next: PayloadSeries = byKind ? { ...s, q: { ...s.q }, y: { ...s.y }, ...(s.mo ? { mo: { ...s.mo } } : {}), held: { ...s.held } } : s;
    if (byKind)
      for (const [k, m] of byKind) {
        const from = cellsOf(next, k);
        const into: Record<string, PayloadCell> = { ...(next.held![k] ?? {}) };
        for (const [e, why] of m) {
          if (!from[e]) continue;
          into[e] = { ...from[e], w: "suspect", why };
          delete from[e];
          heldAt.add(`${s.k}|${k === "y" ? "fy" : k}|${e}`);
          held++;
        }
        next.held![k] = into;
      }
    let out = next;
    for (const k of KINDS) {
      const cells = cellsOf(out, k);
      if (!Object.values(cells).some((c) => c.w === "scale")) continue;
      if (out === s) out = { ...s, q: { ...s.q }, y: { ...s.y }, ...(s.mo ? { mo: { ...s.mo } } : {}) };
      const own = cellsOf(out, k);
      for (const [e, c] of Object.entries(own)) if (c.w === "scale") own[e] = (({ w: _w, ...rest }) => rest)(c);
    }
    for (const k of KINDS) for (const c of Object.values(cellsOf(out, k))) if (c.alt) conflicts++;
    return out;
  });
  const kidsOf = new Map<string, string[]>();
  for (const s of series) if (s.parent) (kidsOf.get(s.parent) ?? kidsOf.set(s.parent, []).get(s.parent)!).push(s.k);
  const touches = (x: PayloadCheck) => heldAt.has(`${x.k}|${x.kind}|${x.e}`) || (kidsOf.get(x.k) ?? []).some((k) => heldAt.has(`${k}|${x.kind}|${x.e}`));
  const checks = heldAt.size ? p.checks.filter((x) => !touches(x)) : p.checks;
  const q = checks.filter((x) => x.kind === "q");
  const fy = checks.filter((x) => x.kind === "fy");
  const previous = p.series.reduce((n, s) => n + KINDS.reduce((m, k) => m + Object.keys(s.held?.[k] ?? {}).length, 0), 0);
  return {
    ...p,
    series,
    checks,
    stats: {
      ...p.stats,
      held: previous + held,
      conflicts,
      checksQ: { ok: q.filter((x) => x.ok).length, total: q.filter((x) => !x.partial).length, partial: q.filter((x) => x.partial).length },
      checksFY: { ok: fy.filter((x) => x.ok).length, total: fy.filter((x) => !x.partial).length, partial: fy.filter((x) => x.partial).length },
    },
  };
}
