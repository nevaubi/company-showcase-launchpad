// Map geometry for the supply-chain globe: a world-atlas topology packed into flat typed arrays, and the two loops
// that trace it onto a canvas (the globe and the flat map). Pure: no DOM and no app imports, so it runs in a worker
// (the 1:50m and 1:10m maps are packed off the page's thread and transferred without copying) and in unit tests.
//
// Level of detail is continuous. Every vertex carries an importance: the distance at which leaving it out stops
// being visible (Douglas-Peucker on each topology arc, so two countries drop the same points of a shared border
// and no gap opens between them). A frame keeps the vertices that matter at its scale. The choice depends only on
// the scale, never on where the camera points, so turning the globe does not make coastlines crawl.
import type { GeometryObject, Topology } from 'topojson-specification';
import { MILLER_MAX, miller, type View } from './sphere';

export type MapRes = 110 | 50 | 10;
/** Stroke of the edge that starts at a vertex: a shore, a border this ring draws, or a border its neighbour draws. */
export const EDGE_NONE = 0, EDGE_COAST = 1, EDGE_BORDER = 2;

export interface PackedGeo {
  res: MapRes;
  /** unit vectors, 3 per vertex; rings are stored without their closing point */
  xyz: Float32Array;
  /** per vertex: the chord (in radians) below which the vertex can be left out; Infinity where arcs meet */
  imp: Float32Array;
  /** per vertex: EDGE_* of the edge to the next vertex of its ring */
  flag: Uint8Array;
  /** ring r spans vertices ringStart[r] .. ringStart[r + 1] */
  ringStart: Int32Array;
  /** polygon p spans rings polyRing[p] .. polyRing[p + 1]; the first is its outline, the rest are holes */
  polyRing: Int32Array;
  /** per polygon: centre (unit vector) and angular radius of a cap that contains it */
  polyCap: Float32Array;
  /** per polygon: index into names */
  polyCountry: Int16Array;
  names: string[];
  maxRing: number;
}

/** The buffers of a packed map, for a zero-copy postMessage. */
export const transferables = (g: PackedGeo): ArrayBuffer[] => [g.xyz, g.imp, g.flag, g.ringStart, g.polyRing, g.polyCap, g.polyCountry].map((a) => a.buffer as ArrayBuffer);

const RAD = Math.PI / 180;

/** Topology arcs as unit vectors (3 per point), undoing the delta encoding and the quantisation. */
function decodeArcs(topo: Topology): Float32Array[] {
  const tf = topo.transform;
  return topo.arcs.map((arc) => {
    const out = new Float32Array(arc.length * 3);
    let x = 0, y = 0;
    for (let i = 0; i < arc.length; i++) {
      let lon: number, lat: number;
      if (tf) { x += arc[i][0]; y += arc[i][1]; lon = x * tf.scale[0] + tf.translate[0]; lat = y * tf.scale[1] + tf.translate[1]; } else { lon = arc[i][0]; lat = arc[i][1]; }
      const cp = Math.cos(lat * RAD);
      out[3 * i] = cp * Math.cos(lon * RAD); out[3 * i + 1] = cp * Math.sin(lon * RAD); out[3 * i + 2] = Math.sin(lat * RAD);
    }
    return out;
  });
}

/**
 * Importance of each point of one arc: the largest distance from the simplified line that dropping it would cause
 * (Douglas-Peucker), capped by its parent's so that keeping "everything above a threshold" is always a valid
 * simplification. The two ends are always kept. Distances are chords on the unit sphere, close to radians at this size.
 */
export function arcImportance(xyz: ArrayLike<number>, n: number): Float32Array {
  const imp = new Float32Array(n);
  if (n === 0) return imp;
  imp[0] = Infinity; imp[n - 1] = Infinity;
  const stack: number[] = [0, n - 1, Infinity];
  while (stack.length) {
    const cap = stack.pop() as number, b = stack.pop() as number, a = stack.pop() as number;
    if (b - a < 2) continue;
    const ax = xyz[3 * a], ay = xyz[3 * a + 1], az = xyz[3 * a + 2];
    const dx = xyz[3 * b] - ax, dy = xyz[3 * b + 1] - ay, dz = xyz[3 * b + 2] - az, len2 = dx * dx + dy * dy + dz * dz;
    let best = -1, at = a + 1;
    for (let i = a + 1; i < b; i++) {
      const px = xyz[3 * i] - ax, py = xyz[3 * i + 1] - ay, pz = xyz[3 * i + 2] - az;
      const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / len2)) : 0;
      const qx = px - t * dx, qy = py - t * dy, qz = pz - t * dz, d = qx * qx + qy * qy + qz * qz;
      if (d > best) { best = d; at = i; }
    }
    const v = Math.min(Math.sqrt(best), cap);
    imp[at] = v;
    stack.push(a, at, v, at, b, v);
  }
  return imp;
}

type Rings = number[][];
const polygonsOf = (g: GeometryObject): Rings[] => (g.type === 'Polygon' ? [g.arcs as Rings] : g.type === 'MultiPolygon' ? (g.arcs as Rings[]) : []);

/** Pack the `countries` object of a world-atlas topology. Countries keep their order; names come from `properties.name`. */
export function packTopology(topo: Topology, res: MapRes): PackedGeo {
  const arcs = decodeArcs(topo), imps = arcs.map((a) => arcImportance(a, a.length / 3));
  const geoms = (topo.objects.countries as { geometries: GeometryObject[] }).geometries;
  /* which countries use each arc: one user is a shore, two are a border (drawn once, by the first) */
  const first = new Int32Array(arcs.length).fill(-1), second = new Int32Array(arcs.length).fill(-1);
  let nv = 0, nr = 0, np = 0;
  geoms.forEach((g, gi) => {
    for (const poly of polygonsOf(g)) {
      np++;
      for (const ring of poly) {
        nr++;
        for (const ref of ring) {
          const a = ref < 0 ? ~ref : ref;
          nv += arcs[a].length / 3 - 1;
          if (first[a] === -1) first[a] = gi; else if (first[a] !== gi && second[a] === -1) second[a] = gi;
        }
      }
    }
  });
  const out: PackedGeo = {
    res, xyz: new Float32Array(nv * 3), imp: new Float32Array(nv), flag: new Uint8Array(nv), ringStart: new Int32Array(nr + 1), polyRing: new Int32Array(np + 1),
    polyCap: new Float32Array(np * 4), polyCountry: new Int16Array(np), names: geoms.map((g) => String((g.properties as { name?: string } | undefined)?.name ?? '')), maxRing: 0,
  };
  let v = 0, r = 0, p = 0;
  geoms.forEach((g, gi) => {
    for (const poly of polygonsOf(g)) {
      out.polyRing[p] = r; out.polyCountry[p] = gi;
      poly.forEach((ring, ri) => {
        out.ringStart[r] = v;
        const from = v;
        for (const ref of ring) {
          const a = ref < 0 ? ~ref : ref, pts = arcs[a], imp = imps[a], n = pts.length / 3;
          const edge = second[a] === -1 ? EDGE_COAST : first[a] === gi ? EDGE_BORDER : EDGE_NONE;
          /* every point but the last: the next arc starts there */
          for (let k = 0; k < n - 1; k++) {
            const i = ref < 0 ? n - 1 - k : k;
            out.xyz[3 * v] = pts[3 * i]; out.xyz[3 * v + 1] = pts[3 * i + 1]; out.xyz[3 * v + 2] = pts[3 * i + 2];
            out.imp[v] = imp[i]; out.flag[v] = edge;
            v++;
          }
        }
        out.maxRing = Math.max(out.maxRing, v - from);
        if (ri === 0) {
          /* a cap round the outline: centre on the mean direction, radius to the farthest point */
          let sx = 0, sy = 0, sz = 0;
          for (let i = from; i < v; i++) { sx += out.xyz[3 * i]; sy += out.xyz[3 * i + 1]; sz += out.xyz[3 * i + 2]; }
          const len = Math.hypot(sx, sy, sz) || 1;
          sx /= len; sy /= len; sz /= len;
          let far = 1;
          for (let i = from; i < v; i++) far = Math.min(far, out.xyz[3 * i] * sx + out.xyz[3 * i + 1] * sy + out.xyz[3 * i + 2] * sz);
          out.polyCap[4 * p] = sx; out.polyCap[4 * p + 1] = sy; out.polyCap[4 * p + 2] = sz; out.polyCap[4 * p + 3] = Math.acos(Math.max(-1, Math.min(1, far))) + 0.002;
        }
        r++;
      });
      p++;
    }
  });
  out.ringStart[r] = v; out.polyRing[p] = r;
  return out;
}

/** Polygons of each country, by name, for tinting. */
export function polygonsByName(geo: PackedGeo): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (let p = 0; p < geo.polyCountry.length; p++) {
    const name = geo.names[geo.polyCountry[p]];
    if (!name) continue;
    const list = out.get(name);
    if (list) list.push(p); else out.set(name, [p]);
  }
  return out;
}

/* ---------- level of detail ---------- */
/** Pixels per radian from which each finer map is drawn, and from which it is fetched so it is ready by then. */
export const LOD = { use10: 1150, fetch10: 520 } as const;
/**
 * Which map a frame draws at scale R (px per radian), given what has arrived. The finer map takes over while its
 * coarser neighbour's points are still about two pixels apart, so nothing is ever seen coarse; until a map arrives
 * the next coarser one stands in.
 */
export function pickRes(R: number, have: { 50: boolean; 10: boolean }): MapRes {
  if (R >= LOD.use10 && have[10]) return 10;
  return have[50] ? 50 : 110;
}
/** A vertex is left out when the line would move by less than this many pixels without it. */
export const DETAIL_PX = 0.4;
/** Islands smaller than this on screen are not drawn. */
const MIN_POLY_PX = 0.7;

/* ---------- tracing ---------- */
export interface PathSink { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void; closePath(): void }
export interface TraceTarget { fill: PathSink | null; coast: PathSink | null; border: PathSink | null }

let SX = new Float64Array(4096), SY = new Float64Array(4096), SZ = new Float64Array(4096), SF = new Uint8Array(4096), SO = new Uint8Array(4096);
const ensure = (n: number) => {
  if (SX.length >= n) return;
  const size = Math.max(n, SX.length * 2);
  SX = new Float64Array(size); SY = new Float64Array(size); SZ = new Float64Array(size); SF = new Uint8Array(size); SO = new Uint8Array(size);
};
/** Which sides of the frame a point lies beyond (with a small margin): two points that share a side cannot cross the frame. */
const outcode = (x: number, y: number, w: number, h: number) => (x < -4 ? 1 : x > w + 4 ? 2 : 0) | (y < -4 ? 4 : y > h + 4 ? 8 : 0);

/** A closed ring that lies wholly on the near side (or on the flat map): the outline with runs outside the frame folded away, and its strokes. */
function emitWhole(k: number, t: TraceTarget): void {
  if (t.fill && k >= 3) {
    const fill = t.fill;
    fill.moveTo(SX[0], SY[0]);
    let acc = SO[0], held = -1;
    for (let j = 1; j < k; j++) {
      const oc = SO[j];
      if (acc & oc) { acc &= oc; held = j; continue; }
      if (held >= 0) { fill.lineTo(SX[held], SY[held]); acc = SO[held]; held = -1; if (acc & oc) { acc &= oc; held = j; continue; } }
      fill.lineTo(SX[j], SY[j]); acc = oc;
    }
    if (held >= 0) fill.lineTo(SX[held], SY[held]);
    fill.closePath();
  }
  if (!t.coast && !t.border) return;
  let pen = -1, penType = 0;
  for (let a = 0; a < k; a++) {
    const type = SF[a], b = a + 1 === k ? 0 : a + 1;
    if (type === EDGE_NONE || (SO[a] & SO[b])) continue;
    const sink = type === EDGE_COAST ? t.coast : t.border;
    if (!sink) continue;
    if (pen !== a || penType !== type) sink.moveTo(SX[a], SY[a]);
    sink.lineTo(SX[b], SY[b]);
    pen = b; penType = type;
  }
}

/** A ring the horizon cuts: the near part, closed along the limb, and the near part of its strokes. */
function emitClipped(k: number, t: TraceTarget, cx: number, cy: number, R: number): void {
  let start = -1;
  for (let j = 0; j < k; j++) if (SZ[j] >= 0 && SZ[j === 0 ? k - 1 : j - 1] < 0) { start = j; break; }
  if (start < 0) return;
  const fill = k >= 3 ? t.fill : null;
  let firstAngle = 0, exitAngle = 0, open = false, penType = 0, penDown = false;
  /* where the edge a -> b meets the horizon, pushed out onto the limb */
  let X = 0, Y = 0;
  const cross = (a: number, b: number) => {
    const s = SZ[a] / (SZ[a] - SZ[b]);
    const x = SX[a] + (SX[b] - SX[a]) * s - cx, y = SY[a] + (SY[b] - SY[a]) * s - cy, len = Math.hypot(x, y) || 1;
    X = cx + (x * R) / len; Y = cy + (y * R) / len;
    return Math.atan2(y, x);
  };
  const limb = (from: number, to: number) => {
    let d = to - from;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 1e-6) (fill as PathSink).arc(cx, cy, R, from, to, d < 0);
  };
  const stroke = (type: number, x0: number, y0: number, x1: number, y1: number, joined: boolean) => {
    const sink = type === EDGE_COAST ? t.coast : type === EDGE_BORDER ? t.border : null;
    if (!sink) { penDown = false; return; }
    if (!joined || !penDown || penType !== type) sink.moveTo(x0, y0);
    sink.lineTo(x1, y1);
    penDown = true; penType = type;
  };
  for (let step = 0; step < k; step++) {
    const i = (start + step) % k, prev = i === 0 ? k - 1 : i - 1, type = SF[prev];
    if (SZ[i] >= 0) {
      if (SZ[prev] < 0) {
        const ang = cross(prev, i);
        if (fill) { if (!open) { fill.moveTo(X, Y); firstAngle = ang; open = true; } else { limb(exitAngle, ang); fill.lineTo(X, Y); } fill.lineTo(SX[i], SY[i]); }
        stroke(type, X, Y, SX[i], SY[i], false);
      } else {
        if (fill) fill.lineTo(SX[i], SY[i]);
        stroke(type, SX[prev], SY[prev], SX[i], SY[i], true);
      }
    } else if (SZ[prev] >= 0) {
      exitAngle = cross(prev, i);
      if (fill) fill.lineTo(X, Y);
      stroke(type, SX[prev], SY[prev], X, Y, true);
      penDown = false;
    }
  }
  if (fill && open) { limb(exitAngle, firstAngle); fill.closePath(); }
}

/**
 * Trace the map onto the globe: every polygon whose cap can reach the frame, each ring thinned to the frame's scale,
 * cut at the horizon and closed along it. `only` limits the trace to some polygons (a country to tint).
 * Returns the number of vertices kept, for diagnostics.
 */
export function traceGlobe(geo: PackedGeo, view: View, t: TraceTarget, only?: ArrayLike<number> | null, detailPx = DETAIL_PX): number {
  const { xyz, imp, flag, ringStart, polyRing, polyCap } = geo, { e, n, f, R, cx, cy, w, h } = view;
  const thr = detailPx / R, half = Math.hypot(w, h) / 2, reach = half >= R ? Math.PI / 2 : Math.asin(half / R);
  const count = only ? only.length : polyRing.length - 1;
  ensure(geo.maxRing + 2);
  let kept = 0;
  for (let q = 0; q < count; q++) {
    const p = only ? only[q] : q, capR = polyCap[4 * p + 3];
    if (capR * R < MIN_POLY_PX) continue;
    const lim = reach + capR;
    if (lim < Math.PI && polyCap[4 * p] * f[0] + polyCap[4 * p + 1] * f[1] + polyCap[4 * p + 2] * f[2] < Math.cos(lim)) continue;
    for (let r = polyRing[p]; r < polyRing[p + 1]; r++) {
      let k = 0, near = 0;
      for (let i = ringStart[r], end = ringStart[r + 1]; i < end; i++) {
        if (imp[i] < thr) continue;
        const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2], vz = x * f[0] + y * f[1] + z * f[2];
        const sx = cx + R * (x * e[0] + y * e[1]), sy = cy - R * (x * n[0] + y * n[1] + z * n[2]);
        SX[k] = sx; SY[k] = sy; SZ[k] = vz; SF[k] = flag[i]; SO[k] = outcode(sx, sy, w, h);
        if (vz >= 0) near++;
        k++;
      }
      if (k < 2 || near === 0) continue;
      kept += k;
      if (near === k) emitWhole(k, t); else emitClipped(k, t, cx, cy, R);
    }
  }
  return kept;
}

/* ---------- flat map ---------- */
export interface FlatGeo {
  /** per vertex: longitude in radians, continuous along its ring (so it may run past ±π), and Miller y */
  lm: Float32Array;
  /** per ring: lowest and highest longitude, lowest and highest Miller y */
  box: Float32Array;
  /** per ring: 0, or the pole it encloses (1 north, -1 south): closed along the map's edge instead of across it */
  polar: Int8Array;
}
const flatCache = new WeakMap<PackedGeo, FlatGeo>();
/** The packed map in flat-map coordinates, computed once per map. */
export function flatOf(geo: PackedGeo): FlatGeo {
  const got = flatCache.get(geo);
  if (got) return got;
  const nv = geo.imp.length, nr = geo.ringStart.length - 1;
  const lm = new Float32Array(nv * 2), box = new Float32Array(nr * 4), polar = new Int8Array(nr), lim = 89.5 * RAD;
  for (let r = 0; r < nr; r++) {
    let prev = 0, l0 = Infinity, l1 = -Infinity, m0 = Infinity, m1 = -Infinity, zs = 0;
    const s = geo.ringStart[r], end = geo.ringStart[r + 1];
    for (let i = s; i < end; i++) {
      const x = geo.xyz[3 * i], y = geo.xyz[3 * i + 1], z = geo.xyz[3 * i + 2];
      let lon = Math.atan2(y, x);
      if (i > s) { while (lon - prev > Math.PI) lon -= 2 * Math.PI; while (lon - prev < -Math.PI) lon += 2 * Math.PI; }
      prev = lon;
      const my = miller(Math.max(-lim, Math.min(lim, Math.asin(Math.max(-1, Math.min(1, z))))));
      lm[2 * i] = lon; lm[2 * i + 1] = my; zs += z;
      if (lon < l0) l0 = lon; if (lon > l1) l1 = lon; if (my < m0) m0 = my; if (my > m1) m1 = my;
    }
    if (end > s) {
      /* a ring that comes back a whole turn away from where it started goes round a pole */
      let back = lm[2 * s] - prev;
      while (back > Math.PI) back -= 2 * Math.PI;
      while (back < -Math.PI) back += 2 * Math.PI;
      if (Math.abs(prev + back - lm[2 * s]) > Math.PI) {
        polar[r] = zs < 0 ? -1 : 1;
        if (polar[r] < 0) m0 = -MILLER_MAX; else m1 = MILLER_MAX;
        /* with its closing edge the ring spans one whole turn */
        if (prev > lm[2 * s]) l1 = l0 + 2 * Math.PI; else l0 = l1 - 2 * Math.PI;
      }
    }
    box[4 * r] = l0; box[4 * r + 1] = l1; box[4 * r + 2] = m0; box[4 * r + 3] = m1;
  }
  const out = { lm, box, polar };
  flatCache.set(geo, out);
  return out;
}

/** Trace the map onto the flat map, once for every copy of the world the frame can see. */
export function traceFlat(geo: PackedGeo, view: View, t: TraceTarget, only?: ArrayLike<number> | null, detailPx = DETAIL_PX): number {
  const { imp, flag, ringStart, polyRing, polyCap } = geo, { lm, box, polar } = flatOf(geo), { R, cx, cy, w, h } = view;
  const thr = detailPx / R, l0 = view.lon0 * RAD, TAU = 2 * Math.PI;
  const viewL0 = l0 - cx / R, viewL1 = l0 + (w - cx) / R, viewM1 = view.my0 + cy / R, viewM0 = view.my0 - (h - cy) / R;
  const count = only ? only.length : polyRing.length - 1;
  ensure(geo.maxRing + 4);
  let kept = 0;
  for (let q = 0; q < count; q++) {
    const p = only ? only[q] : q;
    if (polyCap[4 * p + 3] * R < MIN_POLY_PX) continue;
    for (let r = polyRing[p]; r < polyRing[p + 1]; r++) {
      if (box[4 * r + 3] < viewM0 || box[4 * r + 2] > viewM1) continue;
      const kLo = Math.ceil((viewL0 - box[4 * r + 1]) / TAU), kHi = Math.floor((viewL1 - box[4 * r]) / TAU);
      for (let c = kLo; c <= kHi; c++) {
        const ox = cx + R * (c * TAU - l0), oy = cy + R * view.my0;
        let k = 0;
        for (let i = ringStart[r], end = ringStart[r + 1]; i < end; i++) {
          if (imp[i] < thr) continue;
          const sx = ox + R * lm[2 * i], sy = oy - R * lm[2 * i + 1];
          SX[k] = sx; SY[k] = sy; SZ[k] = 1; SF[k] = flag[i]; SO[k] = outcode(sx, sy, w, h);
          k++;
        }
        if (k < 2) continue;
        kept += k;
        if (polar[r] !== 0 && k >= 2) {
          /* close along the map's edge: out past the last point, down (or up) to the edge, back under the first */
          const edge = oy - R * (polar[r] < 0 ? -MILLER_MAX - 0.2 : MILLER_MAX + 0.2);
          const endX = SX[0] + (SX[k - 1] > SX[0] ? TAU : -TAU) * R;
          const strokes = k;
          SX[k] = endX; SY[k] = SY[0]; SF[k] = EDGE_NONE; SO[k] = outcode(endX, SY[0], w, h); k++;
          SX[k] = endX; SY[k] = edge; SF[k] = EDGE_NONE; SO[k] = outcode(endX, edge, w, h); k++;
          SX[k] = SX[0]; SY[k] = edge; SF[k] = EDGE_NONE; SO[k] = outcode(SX[0], edge, w, h); k++;
          emitWhole(k, { fill: t.fill, coast: null, border: null });
          /* the shore itself, without the edge run; its last edge joins the first point one turn on */
          if (t.coast || t.border) emitWhole(strokes + 1, { fill: null, coast: t.coast, border: t.border });
          continue;
        }
        emitWhole(k, t);
      }
    }
  }
  return kept;
}

/** Meridians and parallels every `step` degrees. Lines stop short of the poles so they do not bunch into a knot. */
export function traceGraticule(view: View, step: number, sink: PathSink): void {
  const { e, n, f, R, cx, cy, w, h } = view;
  if (view.flat) {
    const l0 = view.lon0 * RAD, left = l0 - cx / R, right = l0 + (w - cx) / R;
    for (let lon = Math.ceil(left / RAD / step) * step; lon * RAD <= right; lon += step) { const x = cx + R * (lon * RAD - l0); sink.moveTo(x, 0); sink.lineTo(x, h); }
    for (let lat = -90 + step; lat < 90; lat += step) { const y = cy - R * (miller(lat * RAD) - view.my0); if (y >= 0 && y <= h) { sink.moveTo(0, y); sink.lineTo(w, y); } }
    return;
  }
  const seg = 3, top = 90 - step;
  const line = (points: number, at: (i: number) => [number, number]) => {
    let down = false;
    for (let i = 0; i <= points; i++) {
      const [lon, lat] = at(i), cp = Math.cos(lat * RAD), x = cp * Math.cos(lon * RAD), y = cp * Math.sin(lon * RAD), z = Math.sin(lat * RAD);
      if (x * f[0] + y * f[1] + z * f[2] < 0) { down = false; continue; }
      const sx = cx + R * (x * e[0] + y * e[1]), sy = cy - R * (x * n[0] + y * n[1] + z * n[2]);
      if (down) sink.lineTo(sx, sy); else sink.moveTo(sx, sy);
      down = true;
    }
  };
  for (let lon = -180; lon < 180; lon += step) line(Math.round((2 * top) / seg), (i) => [lon, -top + i * seg]);
  for (let lat = -top; lat <= top; lat += step) line(360 / seg, (i) => [-180 + i * seg, lat]);
}
