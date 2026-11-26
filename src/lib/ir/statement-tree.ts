// Pure: the printed hierarchy of a statement section's rows (which row each line is a part of, its indent
// level, which rows are totals), from the stored parent chain where the table prints it, and from the table's
// own figures where the build lost it.
//
// A stored parent counts only where the section prints it in the same block as the child: no heading between
// the two rows (Apple prints iPhone, Mac and iPad in "Net sales by category" under "Total net sales", while the
// build stored them under "Products", printed in another block; they are parts of the total printed under them,
// never indented under a row three headings up). Of several printings of the parent (a total printed under two
// blocks), the nearest one below the child wins, else the nearest above.
//
// A total whose parts lost their parent in the build gets them back from its own block: the rows above it up to a
// heading (spacer bands are crossed) that have no parent here. When some of the block's rows are stored under the
// total, the others are their siblings (JPM's segment table, where three of four segments' expense lost the total).
// When none are, they are its parts only when their figures add up to it in at least one period and differ in
// none (JPM's ten noninterest revenue lines over "Noninterest revenue"); the nearest rows are tried first, so a
// block's leading rows that belong to an earlier total never join.
import type { PayloadCell, PayloadSeries } from "@/lib/ir/payload";

export interface TreeLine {
  kind: "line";
  k: string;
  ks: string[];
  depth: number;
  total: boolean;
  sib?: boolean;
  /** index (in the section's rows) of the row it is printed as a part of */
  up?: number;
}
export type TreeRow = TreeLine | { kind: "head"; text: string; depth: number } | { kind: "gap" };

/** A row's figures for one period kind (the section's `rowCells`). */
export type CellsOf = (r: TreeLine, freq: "q" | "y") => Record<string, PayloadCell>;

const MAX_DEPTH = 6;

/** Whether a row can close parts: stored as a total, or printed as one ("Total ...", "TOTAL ..."). */
function closes(r: TreeLine, byKey: Map<string, PayloadSeries>, label: (r: TreeLine) => string) {
  return r.ks.some((k) => !!byKey.get(k)?.total) || /^total\b/i.test(label(r).trim());
}

/** Whether the parts' figures add up to the total's: at least one period compared, none off. */
export function addsUp(
  t: TreeLine,
  parts: TreeLine[],
  cells: CellsOf,
  unit: string | undefined,
): boolean {
  let compared = 0;
  for (const freq of ["q", "y"] as const) {
    const tc = cells(t, freq);
    const pc = parts.map((p) => cells(p, freq));
    for (const [e, c] of Object.entries(tc)) {
      if (pc.some((x) => !x[e])) continue;
      const sum = pc.reduce((n, x) => n + x[e].v, 0);
      const tol = Math.max(Math.abs(c.v) * 0.005, unit === "usd" ? 1.5e6 : 1.5);
      if (Math.abs(sum - c.v) > tol) return false;
      compared++;
    }
  }
  return compared > 0;
}

/**
 * Sets `up`, `depth`, `sib` and `total` on the line rows and the depth of headings (one level above the line
 * under them), in place. `label` gives a row's printed name; `cells` its figures.
 */
export function shapeRows(
  rows: TreeRow[],
  byKey: Map<string, PayloadSeries>,
  label: (r: TreeLine) => string,
  cells: CellsOf,
): void {
  const lines: number[] = [];
  rows.forEach((r, i) => {
    if (r.kind === "line") {
      lines.push(i);
      delete r.up;
      delete r.sib;
    }
  });
  const line = (i: number) => rows[i] as TreeLine;
  const headBetween = (a: number, b: number) => {
    for (let x = Math.min(a, b) + 1; x < Math.max(a, b); x++) if (rows[x].kind === "head") return true;
    return false;
  };
  // A total between a part and its parent closes another block, unless it is itself stored under that parent
  // (AMD's "Total Client and Gaming" between "Data Center Segment" and "Total net revenue").
  const totalBetween = (a: number, b: number) => {
    const parent = new Set(line(b).ks);
    for (let x = a + 1; x < b; x++) {
      const r = rows[x];
      if (r.kind !== "line" || !r.ks.some((k) => !!byKey.get(k)?.total)) continue;
      if (r.ks.some((k) => parent.has(byKey.get(k)?.parent ?? ""))) continue;
      return true;
    }
    return false;
  };
  const up = new Map<number, number>();
  const reaches = (from: number, to: number) => {
    let x: number | undefined = from;
    for (let n = 0; x != null && n <= MAX_DEPTH + 2; n++) {
      if (x === to) return true;
      x = up.get(x);
    }
    return false;
  };
  // Stored parents printed in the same block.
  for (const i of lines) {
    const ps = new Set(
      line(i)
        .ks.map((k) => byKey.get(k)?.parent)
        .filter((x): x is string => !!x),
    );
    if (!ps.size) continue;
    // A total printed below its parts may close sub-blocks under their own headings (JPM's deposits: "U.S.
    // offices", "Non-U.S. offices", then "Total deposits"), unless another total closes a block between them.
    const cands = lines.filter(
      (j) =>
        j !== i &&
        line(j).ks.some((k) => ps.has(k)) &&
        (!headBetween(i, j) || (j > i && !totalBetween(i, j))),
    );
    const below = cands.filter((j) => j > i);
    const above = cands.filter((j) => j < i);
    const order = [...below, ...above.reverse()];
    const j = order.find((x) => !reaches(x, i));
    if (j != null) up.set(i, j);
  }
  // Parts a total lost in the build, from its own block.
  for (const t of lines) {
    const tr = line(t);
    if (!closes(tr, byKey, label)) continue;
    const kids: number[] = [];
    const orphans: number[] = [];
    // Siblings of the stored parts are the orphans printed nearer the total than any subtotal (stored part or
    // not) or spacer band: rows above a subtotal are its parts (CIB's "Banking & Payments" lines above the markets lines closed
    // by "Markets & Securities Services"; CFG's commercial loans above "Total commercial").
    let sibs = 0;
    let open = true;
    for (let x = t - 1; x >= 0; x--) {
      const r = rows[x];
      // Siblings without figures to prove them stay within the run of rows printed together.
      if (r.kind === "gap") {
        open = false;
        continue;
      }
      if (r.kind === "head") break;
      if (up.get(x) === t) {
        kids.push(x);
        if (closes(r, byKey, label)) open = false;
        continue;
      }
      // A part of a part (printed above the subtotal it closes) is skipped.
      if ([...kids, ...orphans].some((p) => reaches(x, p))) continue;
      if (up.has(x)) break;
      if (reaches(t, x)) break;
      orphans.push(x);
      if (closes(r, byKey, label)) open = false;
      if (open) sibs = orphans.length;
    }
    if (!orphans.length) continue;
    let take: number[] = [];
    if (kids.length) take = orphans.slice(0, sibs);
    else {
      const unit = byKey.get(tr.k)?.unit;
      for (let n = orphans.length; n >= 2; n--) {
        const set = orphans.slice(0, n);
        if (set.some((x) => byKey.get(line(x).k)?.unit !== unit)) continue;
        if (addsUp(tr, set.map(line), cells, unit)) {
          take = set;
          break;
        }
      }
    }
    for (const x of take) {
      up.set(x, t);
      line(x).sib = true;
    }
  }
  const depthOf = (i: number) => {
    let d = 0;
    let x = up.get(i);
    while (x != null && d < MAX_DEPTH) {
      d++;
      x = up.get(x);
    }
    return d;
  };
  const hasPart = new Set(up.values());
  for (const i of lines) {
    const r = line(i);
    if (up.has(i)) r.up = up.get(i);
    r.depth = depthOf(i);
    r.total = hasPart.has(i) && closes(r, byKey, label);
  }
  // A heading sits at the level of the outermost total whose parts are all printed under it (JPM's "Revenue"
  // over noninterest revenue, net interest income and total net revenue: level 0; AMD's "Client and Gaming
  // Segment" over Client and Gaming but not Data Center: the level of "Total Client and Gaming"), else one level
  // above the line under it; a heading printed straight over another takes the lower one's level.
  const partsOf = new Map<number, number[]>();
  for (const [c, p] of up) partsOf.set(p, [...(partsOf.get(p) ?? []), c]);
  let below = 0;
  for (let h = rows.length - 1; h >= 0; h--) {
    const r = rows[h];
    if (r.kind !== "head") continue;
    let f = -1;
    for (let x = h + 1; x < rows.length && rows[x].kind !== "head"; x++)
      if (rows[x].kind === "line") {
        f = x;
        break;
      }
    if (f < 0) {
      r.depth = below;
      continue;
    }
    let d = Math.max(0, line(f).depth - 1);
    for (let x = up.get(f); x != null; x = up.get(x)) {
      if (!(partsOf.get(x) ?? []).every((c) => c > h)) break;
      d = line(x).depth;
    }
    r.depth = d;
    below = d;
  }
}
