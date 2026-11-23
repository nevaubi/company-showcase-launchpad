// Link geometry for the supply-chain globe: the path of an arc between two markers, where it starts and stops so it
// never runs under a badge, its arrowhead, its width, and which links are drawn as one bundle because their ends sit
// in the same clusters at the current zoom. Pure (no canvas), unit-tested.
import { clamp, projectVec, slerp, type Vec3, type View } from './sphere';

/** How high an arc rises above the globe at its middle, in globe radii: a hop across an ocean stands well clear, a hop between two cities barely lifts. */
export const arcLift = (angle: number): number => 0.012 + 0.21 * clamp(angle / Math.PI, 0, 1);
/** Segments an arc is drawn with: about one every 14 px of its length, so short links stay cheap and long ones smooth. */
export const arcSegments = (lengthPx: number): number => Math.round(clamp(8 + lengthPx / 14, 10, 56));

/** A sampled arc in screen space. `k` is how visible each point is: 1 in front, fading toward the rim, a trace beyond it, 0 behind the globe. */
export interface ArcPath { n: number; x: Float64Array; y: Float64Array; k: Float64Array }
export const newArcPath = (size = 64): ArcPath => ({ n: 0, x: new Float64Array(size), y: new Float64Array(size), k: new Float64Array(size) });

const tmp: Vec3 = [0, 0, 0], pr = { x: 0, y: 0, z: 0 };
/**
 * Sample the link from place a to place b (unit vectors) into `out`.
 * Globe: the great circle, lifted by `lift` at its middle. Flat map: a curve between the two markers as drawn, bowed
 * upward by a share of its length, so it always joins the markers on screen. `lane` shifts the curve sideways in px
 * (links that share both ends are drawn side by side).
 */
export function sampleArc(view: View, a: Vec3, b: Vec3, lift: number, lane: number, segments: number, out: ArcPath): ArcPath {
  const n = Math.min(segments, out.x.length - 1);
  out.n = n + 1;
  if (view.flat) {
    const p0 = projectVec(view, a[0], a[1], a[2]), x0 = p0.x, y0 = p0.y, p1 = projectVec(view, b[0], b[1], b[2]), x1 = p1.x, y1 = p1.y;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    /* bow toward the top of the map, whichever way the link runs */
    let nx = -dy / len, ny = dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const bow = Math.min(0.2 * len, 90), side = dx >= 0 ? 1 : -1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = 4 * t * (1 - t), off = bow * s + lane * side * s;
      out.x[i] = x0 + dx * t + nx * off; out.y[i] = y0 + dy * t + ny * off; out.k[i] = 1;
    }
    return out;
  }
  const { cx, cy, R } = view;
  for (let i = 0; i <= n; i++) {
    const t = i / n, up = Math.sin(Math.PI * t);
    slerp(a, b, t, tmp);
    projectVec(view, tmp[0], tmp[1], tmp[2], lift * up, pr);
    out.x[i] = pr.x; out.y[i] = pr.y;
    if (pr.z >= 0) out.k[i] = pr.z >= 0.3 ? 1 : 0.4 + 2 * pr.z;
    else out.k[i] = Math.hypot(pr.x - cx, pr.y - cy) > R + 0.5 ? 0.4 * clamp(1 + pr.z / 0.5, 0, 1) : 0;
  }
  if (lane !== 0) {
    /* shift sideways, most at the middle, nothing at the ends */
    const dx = out.x[n] - out.x[0], dy = out.y[n] - out.y[0], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    for (let i = 1; i < n; i++) { const s = Math.sin((Math.PI * i) / n) * lane; out.x[i] += nx * s; out.y[i] += ny * s; }
  }
  return out;
}

/**
 * Cut a path back so it starts `r0` px from its first point and stops `r1` px from its last (the markers' edges).
 * Returns false when nothing is left. The path is edited in place.
 */
export function trimArc(p: ArcPath, r0: number, r1: number): boolean {
  const n = p.n;
  if (n < 2) return false;
  const ax = p.x[0], ay = p.y[0], bx = p.x[n - 1], by = p.y[n - 1];
  if (Math.hypot(bx - ax, by - ay) < r0 + r1 + 4) return false;
  let i = 1;
  while (i < n && Math.hypot(p.x[i] - ax, p.y[i] - ay) < r0) i++;
  let j = n - 2;
  while (j >= 0 && Math.hypot(p.x[j] - bx, p.y[j] - by) < r1) j--;
  if (i > j + 1) return false;
  /* the point exactly r0 from the start, on the segment that leaves the marker */
  const edge = (from: number, to: number, cx0: number, cy0: number, r: number): [number, number, number] => {
    const d0 = Math.hypot(p.x[from] - cx0, p.y[from] - cy0), d1 = Math.hypot(p.x[to] - cx0, p.y[to] - cy0);
    const t = d1 - d0 > 1e-9 ? clamp((r - d0) / (d1 - d0), 0, 1) : 0;
    return [p.x[from] + (p.x[to] - p.x[from]) * t, p.y[from] + (p.y[to] - p.y[from]) * t, p.k[from] + (p.k[to] - p.k[from]) * t];
  };
  const s = edge(i - 1, i, ax, ay, r0), e = edge(j + 1, j, bx, by, r1);
  const m = j - i + 3;
  p.x.copyWithin(1, i, j + 1); p.y.copyWithin(1, i, j + 1); p.k.copyWithin(1, i, j + 1);
  p.x[0] = s[0]; p.y[0] = s[1]; p.k[0] = s[2];
  p.x[m - 1] = e[0]; p.y[m - 1] = e[1]; p.k[m - 1] = e[2];
  p.n = m;
  return true;
}

/** Shorten a path by `len` px from its end (room for the arrowhead); returns the direction of travel at the new end, or null when the path is shorter than that. */
export function cutEnd(p: ArcPath, len: number): number | null {
  let left = len;
  for (let i = p.n - 1; i > 0; i--) {
    const dx = p.x[i] - p.x[i - 1], dy = p.y[i] - p.y[i - 1], d = Math.hypot(dx, dy);
    if (d >= left && d > 0) {
      const t = 1 - left / d;
      p.x[i] = p.x[i - 1] + dx * t; p.y[i] = p.y[i - 1] + dy * t;
      p.n = i + 1;
      return Math.atan2(dy, dx);
    }
    left -= d;
  }
  return null;
}
/** Mirror of cutEnd for the start of a path (the head of a two-way link). */
export function cutStart(p: ArcPath, len: number): number | null {
  let left = len;
  for (let i = 0; i < p.n - 1; i++) {
    const dx = p.x[i] - p.x[i + 1], dy = p.y[i] - p.y[i + 1], d = Math.hypot(dx, dy);
    if (d >= left && d > 0) {
      const t = 1 - left / d;
      p.x[i] = p.x[i + 1] + dx * t; p.y[i] = p.y[i + 1] + dy * t;
      if (i > 0) { p.x.copyWithin(0, i, p.n); p.y.copyWithin(0, i, p.n); p.k.copyWithin(0, i, p.n); p.n -= i; }
      return Math.atan2(dy, dx);
    }
    left -= d;
  }
  return null;
}

/**
 * Keep only the first `len` px of a path (from its start when `fromStart`, else from its end) and let it fade out along
 * that length: a stub that says "a link leaves here, that way" without crossing the whole frame.
 */
export function stubArc(p: ArcPath, len: number, fromStart: boolean): void {
  const n = p.n;
  if (n < 2) return;
  if (!fromStart) { reverse(p); stubArc(p, len, true); reverse(p); return; }
  let run = 0;
  p.k[0] = Math.min(p.k[0], 1);
  for (let i = 1; i < n; i++) {
    const dx = p.x[i] - p.x[i - 1], dy = p.y[i] - p.y[i - 1], d = Math.hypot(dx, dy);
    if (run + d >= len) {
      const t = d > 0 ? (len - run) / d : 0;
      p.x[i] = p.x[i - 1] + dx * t; p.y[i] = p.y[i - 1] + dy * t; p.k[i] = Math.min(p.k[i], 0.2);
      p.n = i + 1;
      return;
    }
    run += d;
    p.k[i] = Math.min(p.k[i], 1 - 0.8 * (run / len));
  }
}
function reverse(p: ArcPath): void {
  for (let i = 0, j = p.n - 1; i < j; i++, j--) {
    const x = p.x[i], y = p.y[i], k = p.k[i];
    p.x[i] = p.x[j]; p.y[i] = p.y[j]; p.k[i] = p.k[j];
    p.x[j] = x; p.y[j] = y; p.k[j] = k;
  }
}

/** Arrowhead size for a line of width w: long enough to read as a direction, never wider than a badge. */
export const headSize = (w: number): { len: number; half: number } => ({ len: 6.5 + 1.25 * w, half: 3 + 0.78 * w });
/** The three corners of an arrowhead whose tip is at (x, y), pointing along `angle`. */
export function arrowHead(x: number, y: number, angle: number, len: number, half: number): [number, number, number, number, number, number] {
  const c = Math.cos(angle), s = Math.sin(angle), bx = x - c * len, by = y - s * len;
  return [x, y, bx - s * half, by + c * half, bx + s * half, by - c * half];
}

/**
 * Line width for a link: the same square-root scale the Network view's bands use, on the same stated figure (dollars,
 * or the stated share when no dollars are given), so one very large customer does not flatten the rest.
 */
export function flowWidth(value: number, max: number, lo = 1.25, hi = 6): number {
  if (!(max > 0) || !(value > 0)) return lo;
  return lo + (hi - lo) * Math.sqrt(Math.min(value / max, 1.6));
}

export interface ArcGroup<A> { key: string; from: string; to: string; style: string; arcs: A[]; /** position among the groups that join the same two markers, centred on 0 */ lane: number }
/**
 * Links whose ends sit in the same two markers at this zoom, and that are drawn the same way, become one bundle.
 * `markOf` gives the marker (a badge or a cluster) a point is drawn in, or null when it is not on screen. Links inside one
 * marker are dropped: there is nothing to draw between a cluster and itself. Bundles that join the same two markers
 * are given lanes so they run side by side instead of on top of each other.
 */
export function bundleArcs<A extends { from: string; to: string; style: string }>(arcs: A[], markOf: (pointKey: string) => string | null): ArcGroup<A>[] {
  const groups = new Map<string, ArcGroup<A>>();
  for (const a of arcs) {
    const ma = markOf(a.from), mb = markOf(a.to);
    if (!ma || !mb || ma === mb) continue;
    const key = `${ma}>${mb}|${a.style}`;
    const g = groups.get(key);
    if (g) g.arcs.push(a); else groups.set(key, { key, from: ma, to: mb, style: a.style, arcs: [a], lane: 0 });
  }
  const pairs = new Map<string, ArcGroup<A>[]>();
  for (const g of groups.values()) {
    const pair = g.from < g.to ? `${g.from}|${g.to}` : `${g.to}|${g.from}`;
    const list = pairs.get(pair);
    if (list) list.push(g); else pairs.set(pair, [g]);
  }
  for (const list of pairs.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.style.localeCompare(b.style) || a.from.localeCompare(b.from));
    /* a lane is a side of the line between the two markers, so it flips with the direction of travel */
    list.forEach((g, i) => { const lane = i - (list.length - 1) / 2; g.lane = g.from < g.to ? lane : -lane; });
  }
  return [...groups.values()];
}

/** Distance in px from a point to a sampled path. */
export function distanceToArc(p: ArcPath, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < p.n - 1; i++) {
    if (p.k[i] <= 0 && p.k[i + 1] <= 0) continue;
    const ax = p.x[i], ay = p.y[i], dx = p.x[i + 1] - ax, dy = p.y[i + 1] - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (d < best) best = d;
  }
  return best;
}
