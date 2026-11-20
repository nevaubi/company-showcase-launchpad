// Display guard for IR figures already stored (pure; runs at the end of `tidyPayload`, so stored
// payloads get it on load). Stored rows can't be repaired from the page, so a figure whose unit or
// period the documents contradict is held back: it moves out of the series' `q` / `y` / `mo` cells into
// `held`, which no chart, change, total, check or export reads, and the table shows it as a quiet flag
// with the reason and the click-to-source of the cell. A value is never "corrected" by multiplying or
// dividing it. Rules, for money and count lines only (percentages, ratios, basis points and per-share
// figures are small by nature):
//   1. marked suspect when it was stored (scale-check.ts), or flagged ~1,000× off its neighbours by older builds;
//   2. $10 trillion or more ($1 quadrillion for custody, client-asset and volume lines);
//   3. a cluster of the line's own values 900× or more away from the cluster most of its values sit in
//      (yearly flows count a quarter of their value, monthly flows three times theirs): above it always,
//      below it only when the step is close to a power of 1,000 (a unit slip, not a business winding down);
//   4. 900× or more its own printed total, or a total 900× or more the sum of its printed lines;
//   5. a figure the same document prints for another period of the same line while it prints a
//      different figure for this one (a column read under the wrong period);
//   6. a calculated value that uses a held figure.
import { CUSTODY, MAX_USD, MAX_USD_CUSTODY, SLIP, fmtTimes } from "@/lib/ir/scale-check";
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

  for (const s of p.series) {
    if (!GUARDED.has(s.unit)) continue;
    const custody = CUSTODY.test(`${s.label} ${s.parent ? byKey.get(s.parent)?.label ?? "" : ""} ${s.bd ?? bdOf.get(s.k) ?? ""}`);
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
    const clusters: (typeof pts)[] = [];
    for (const x of pts) {
      const last = clusters[clusters.length - 1];
      if (last && x.lg - last[last.length - 1].lg < LOG_SPLIT) last.push(x);
      else clusters.push([x]);
    }
    if (clusters.length > 1) {
      const sizes = clusters.map((c) => c.length);
      const top = Math.max(...sizes);
      // A tie between two clusters leaves nothing to compare with: nothing is held on this rule.
      if (top >= 2 && sizes.filter((n) => n === top).length === 1) {
        const base = clusters[sizes.indexOf(top)];
        const baseMed = median(base.map((x) => x.lg));
        for (const c of clusters) {
          if (c === base) continue;
          const med = median(c.map((x) => x.lg));
          const d = Math.abs(med - baseMed);
          const ratio = 10 ** d;
          // A unit slip: moved by the nearest power of 1,000, the cluster lands among the line's other values.
          const shift = 3 * Math.round(d / 3) * Math.sign(baseMed - med);
          const lo = base[0].lg - 0.5;
          const hi = base[base.length - 1].lg + 0.5;
          const slip = d >= 2.3 && shift !== 0 && c.every((x) => x.lg + shift >= lo && x.lg + shift <= hi);
          if (!slip && !(med > baseMed && d >= LOG_SLIP)) continue;
          const why = `About ${fmtTimes(slip ? 10 ** Math.abs(shift) : ratio)}× ${med > baseMed ? "larger" : "smaller"} than this line's other periods: a different unit was probably read here`;
          for (const x of c) flag(s, x.k, x.e, why);
        }
      }
    }
  }

  // 4. A line against its own printed total, and a total against its lines.
  const kids = new Map<string, PayloadSeries[]>();
  for (const s of p.series) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
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
    for (const k of ["q", "y"] as Kind[])
      for (const [e, c] of Object.entries(cellsOf(s, k))) {
        if (c.d == null || c.f) continue;
        const id = `${c.d}|${s.unit}|${k}|${labelKey(s.label)}`;
        printed.set(id, [...(printed.get(id) ?? []), { s, k, e, v: c.v }]);
      }
  }
  const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 5e-4;
  for (const list of printed.values()) {
    if (list.length < 3) continue;
    for (const x of list) {
      for (const o of list) {
        if (o.s === x.s || o.e !== x.e || same(o.v, x.v)) continue;
        const twin = list.find((y) => y.s === o.s && y.e !== x.e && same(y.v, x.v));
        if (!twin) continue;
        flag(x.s, x.k, x.e, `The same document prints this figure for the period ending ${twin.e} and ${o.v.toLocaleString("en-US")} for this one (${o.s.label}): the column was probably read under the wrong period`);
        break;
      }
    }
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

/** Moves suspect cells into `held`, drops the tie-out checks that used them and recounts the stats. */
export function holdSuspects(p: IrPayload): IrPayload {
  const found = findSuspects(p);
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
  for (const s of series) if (s.parent) kidsOf.set(s.parent, [...(kidsOf.get(s.parent) ?? []), s.k]);
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
