// Camera and projection math for the supply-chain globe and its flat map. Pure: no DOM, no d3, no app imports,
// so every rule here (where a place lands on screen, how zoom keeps the pointed-at place under the pointer, how the
// camera frames a set of places, how a flight between two views runs) is unit-tested.
//
// Globe: an orthographic view. The camera looks at (lon, lat) with north up; zoom 1 shows the whole disc.
// Flat map: Miller's cylindrical projection, which repeats sideways without a seam and keeps the pan and zoom of a
// street map (the picture never re-projects while it moves); zoom 1 covers the frame.

export type LonLat = [number, number];
export type Vec3 = [number, number, number];
export interface Camera { lon: number; lat: number; zoom: number }
export interface Viewport { w: number; h: number }

export const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
/** How far the globe's centre may tilt toward a pole, in degrees. */
export const MAX_LAT = 84;
/** Share of the shorter side the globe's disc fills at zoom 1. */
export const DISC_FILL = 0.92;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Longitude brought into (-180, 180]. */
export const wrapLon = (lon: number) => { const l = ((lon + 180) % 360 + 360) % 360 - 180; return l === -180 ? 180 : l; };
/** Signed shortest turn from longitude a to longitude b, in degrees. */
export const lonDelta = (a: number, b: number) => ((b - a + 540) % 360 + 360) % 360 - 180;

export const toVec = (lon: number, lat: number): Vec3 => { const cp = Math.cos(lat * RAD); return [cp * Math.cos(lon * RAD), cp * Math.sin(lon * RAD), Math.sin(lat * RAD)]; };
export const toLonLat = (v: Vec3): LonLat => [Math.atan2(v[1], v[0]) / RAD, Math.asin(clamp(v[2] / (Math.hypot(v[0], v[1], v[2]) || 1), -1, 1)) / RAD];
/** Angle between two places, in radians. */
export function angleBetween(a: LonLat, b: LonLat): number {
  const p = toVec(a[0], a[1]), q = toVec(b[0], b[1]);
  const cx = p[1] * q[2] - p[2] * q[1], cy = p[2] * q[0] - p[0] * q[2], cz = p[0] * q[1] - p[1] * q[0];
  return Math.atan2(Math.hypot(cx, cy, cz), p[0] * q[0] + p[1] * q[1] + p[2] * q[2]);
}
/** A point along the great circle from a to b (unit vectors), t from 0 to 1. Antipodal ends fall back to a. */
export function slerp(a: Vec3, b: Vec3, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1), om = Math.acos(dot), s = Math.sin(om);
  if (s < 1e-9) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; }
  const ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  out[0] = ka * a[0] + kb * b[0]; out[1] = ka * a[1] + kb * b[1]; out[2] = ka * a[2] + kb * b[2];
  return out;
}

/* ---------- Miller cylindrical (flat map) ---------- */
export const miller = (latRad: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * latRad));
export const millerInv = (y: number) => 2.5 * (Math.atan(Math.exp(0.8 * y)) - Math.PI / 4);
/** Height of the world above the equator in Miller units (the map spans ±this, and ±π sideways). */
export const MILLER_MAX = miller(Math.PI / 2);

/** One frame's view: everything needed to put a place on screen and to go back from a pixel to a place. */
export interface View {
  flat: boolean; w: number; h: number; cx: number; cy: number;
  /** pixels per radian: the globe's radius, or the flat map's scale */
  R: number;
  lon0: number; lat0: number; zoom: number;
  /** globe: rows of the rotation (east, north, toward the viewer) */
  e: Vec3; n: Vec3; f: Vec3;
  /** flat: Miller y of the centre, in radians-equivalent units */
  my0: number;
}

/** Globe radius at zoom 1, or the flat map's scale at zoom 1 (the world just covers the frame). */
export const baseScale = (vp: Viewport, flat: boolean) => (flat ? Math.max(vp.w / TAU, vp.h / (2 * MILLER_MAX)) : (Math.min(vp.w, vp.h) / 2) * DISC_FILL);

/** Keep a camera inside what can be shown: latitude within reach of the poles, the flat map never past its top or bottom. */
export function clampCamera(cam: Camera, vp: Viewport, flat: boolean, minZoom: number, maxZoom: number): Camera {
  const zoom = clamp(cam.zoom, minZoom, maxZoom);
  if (!flat) return { lon: wrapLon(cam.lon), lat: clamp(cam.lat, -MAX_LAT, MAX_LAT), zoom };
  const s = baseScale(vp, true) * zoom, room = MILLER_MAX - vp.h / (2 * s);
  const my = room <= 0 ? 0 : clamp(miller(clamp(cam.lat, -89.9, 89.9) * RAD), -room, room);
  return { lon: wrapLon(cam.lon), lat: millerInv(my) / RAD, zoom };
}

export function makeView(cam: Camera, vp: Viewport, flat: boolean): View {
  const l = cam.lon * RAD, p = cam.lat * RAD, sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cp = Math.cos(p);
  return {
    flat, w: vp.w, h: vp.h, cx: vp.w / 2, cy: vp.h / 2, R: baseScale(vp, flat) * cam.zoom, lon0: cam.lon, lat0: cam.lat, zoom: cam.zoom,
    e: [-sl, cl, 0], n: [-sp * cl, -sp * sl, cp], f: [cp * cl, cp * sl, sp], my0: miller(clamp(p, -89.9 * RAD, 89.9 * RAD)),
  };
}

export interface Projected { x: number; y: number; /** how squarely the place faces the viewer: 1 at the centre of the disc, 0 on the horizon, below 0 behind it. Always 1 on the flat map. */ z: number }
/** Screen position of a unit vector, optionally lifted above the surface (globe only: lift 0.1 is a tenth of the radius). */
export function projectVec(view: View, x: number, y: number, z: number, lift = 0, out: Projected = { x: 0, y: 0, z: 0 }): Projected {
  if (view.flat) {
    const lon = Math.atan2(y, x) / RAD, lat = Math.asin(clamp(z, -1, 1));
    out.x = view.cx + view.R * lonDelta(view.lon0, lon) * RAD; out.y = view.cy - view.R * (miller(clamp(lat, -89.9 * RAD, 89.9 * RAD)) - view.my0); out.z = 1;
    return out;
  }
  const { e, n, f } = view, k = view.R * (1 + lift);
  out.x = view.cx + k * (x * e[0] + y * e[1]); out.y = view.cy - k * (x * n[0] + y * n[1] + z * n[2]); out.z = x * f[0] + y * f[1] + z * f[2];
  return out;
}
export function project(view: View, lon: number, lat: number, lift = 0, out?: Projected): Projected {
  if (view.flat) {
    const o = out ?? { x: 0, y: 0, z: 1 };
    o.x = view.cx + view.R * lonDelta(view.lon0, lon) * RAD; o.y = view.cy - view.R * (miller(clamp(lat, -89.9, 89.9) * RAD) - view.my0); o.z = 1;
    return o;
  }
  const cp = Math.cos(lat * RAD);
  return projectVec(view, cp * Math.cos(lon * RAD), cp * Math.sin(lon * RAD), Math.sin(lat * RAD), lift, out);
}
/** The place under a pixel; null off the globe's disc or past the flat map's top and bottom. */
export function unproject(view: View, sx: number, sy: number): LonLat | null {
  if (view.flat) {
    const my = view.my0 - (sy - view.cy) / view.R;
    if (Math.abs(my) > MILLER_MAX) return null;
    return [wrapLon(view.lon0 + (sx - view.cx) / view.R / RAD), millerInv(my) / RAD];
  }
  const vx = (sx - view.cx) / view.R, vy = -(sy - view.cy) / view.R, d = vx * vx + vy * vy;
  if (d > 1) return null;
  const vz = Math.sqrt(1 - d), { e, n, f } = view;
  return toLonLat([vx * e[0] + vy * n[0] + vz * f[0], vx * e[1] + vy * n[1] + vz * f[1], vy * n[2] + vz * f[2]]);
}

/**
 * The camera centre that puts `place` exactly `dx, dy` pixels from the middle of the frame at scale R (px per radian).
 * This is what makes zoom and drag hold on to the place under the pointer. North stays up, so a place cannot be dragged
 * farther sideways than its own parallel reaches: null then (the caller turns the globe by the pointer's travel instead).
 */
export function anchorCentre(place: LonLat, dx: number, dy: number, R: number, flat: boolean, nearLon?: number): { lon: number; lat: number } | null {
  if (flat) return { lon: wrapLon(place[0] - dx / R / RAD), lat: millerInv(miller(clamp(place[1], -89.9, 89.9) * RAD) + dy / R) / RAD };
  const x = dx / R, y = -dy / R;
  if (x * x + y * y >= 0.985) return null;
  const phi = place[1] * RAD, cp = Math.cos(phi);
  if (cp < 1e-6) return null;
  const sd = x / cp;
  if (Math.abs(sd) > 0.999) return null;
  /* two meridians put the place at this sideways offset: the near one, and the one over the pole; stay on the camera's side */
  let dl = Math.asin(sd);
  if (nearLon != null) {
    const over = (sd >= 0 ? Math.PI : -Math.PI) - dl;
    if (Math.abs(lonDelta(nearLon, place[0] - over / RAD)) < Math.abs(lonDelta(nearLon, place[0] - dl / RAD))) dl = over;
  }
  const A = Math.sin(phi), B = cp * Math.cos(dl), r = Math.hypot(A, B);
  if (Math.abs(y) > r * 0.999) return null;
  const lat = (Math.acos(y / r) - Math.atan2(B, A)) / RAD;
  if (Math.abs(lat) > 89.5) return null;
  return { lon: wrapLon(place[0] - dl / RAD), lat };
}

export interface FitOptions { /** free space kept round the places, px */ pad?: number; minZoom?: number; maxZoom?: number; /** zoom used when every place is the same spot */ single?: number }
/**
 * The camera that takes in a set of places with room to spare. Globe: centred on their mean direction, zoomed until the
 * outermost still clears the padding; places spread over more than a hemisphere get the whole disc, centred on the first
 * place (the company). Flat map: the bounding box in map units, taken the short way round.
 */
export function fitCamera(places: LonLat[], vp: Viewport, flat: boolean, opts: FitOptions = {}): Camera {
  const pad = opts.pad ?? 56, minZoom = opts.minZoom ?? 1, maxZoom = opts.maxZoom ?? 24, single = opts.single ?? 5;
  const ok = places.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (!ok.length) return { lon: 0, lat: flat ? 20 : 0, zoom: minZoom };
  let x = 0, y = 0, z = 0;
  for (const [lon, lat] of ok) { const v = toVec(lon, lat); x += v[0]; y += v[1]; z += v[2]; }
  const len = Math.hypot(x, y, z) / ok.length;
  const centre: LonLat = len < 0.08 ? ok[0] : toLonLat([x, y, z]);
  const halfW = Math.max(40, vp.w / 2 - pad), halfH = Math.max(40, vp.h / 2 - pad), base = baseScale(vp, flat);
  if (flat) {
    let l0 = Infinity, l1 = -Infinity, m0 = Infinity, m1 = -Infinity;
    for (const [lon, lat] of ok) {
      const dl = lonDelta(centre[0], lon) * RAD, my = miller(clamp(lat, -85, 85) * RAD);
      l0 = Math.min(l0, dl); l1 = Math.max(l1, dl); m0 = Math.min(m0, my); m1 = Math.max(m1, my);
    }
    const spanL = l1 - l0, spanM = m1 - m0;
    const scale = spanL < 1e-4 && spanM < 1e-4 ? base * single : Math.min(spanL > 0 ? (2 * halfW) / spanL : Infinity, spanM > 0 ? (2 * halfH) / spanM : Infinity);
    return { lon: wrapLon(centre[0] + (l0 + l1) / 2 / RAD), lat: millerInv((m0 + m1) / 2) / RAD, zoom: clamp(scale / base, minZoom, maxZoom) };
  }
  const cam = { lon: centre[0], lat: clamp(centre[1], -62, 72), zoom: 1 };
  const view = makeView(cam, vp, false), p: Projected = { x: 0, y: 0, z: 0 };
  let mx = 0, my = 0, back = false;
  for (const [lon, lat] of ok) {
    project(view, lon, lat, 0, p);
    if (p.z < 0.12) back = true;
    mx = Math.max(mx, Math.abs(p.x - view.cx) / view.R); my = Math.max(my, Math.abs(p.y - view.cy) / view.R);
  }
  if (back) return { ...cam, zoom: Math.max(minZoom, 1) };
  const R = mx < 1e-4 && my < 1e-4 ? base * single : Math.min(mx > 0 ? halfW / mx : Infinity, my > 0 ? halfH / my : Infinity);
  return { ...cam, zoom: clamp(R / base, minZoom, maxZoom) };
}

/** A place with how much it counts for the opening view (a stated figure counts more than a bare mention). */
export interface WeightedPlace { lon: number; lat: number; w: number; /** the side it is on (suppliers, customers, ...): each side counts as much as any other, however many names it has */ side?: string }
/** How squarely a place faces a globe centred on (lon, lat): 1 at the centre, 0 on the horizon. */
const facing = (cLon: number, cLat: number, lon: number, lat: number) => Math.cos(angleBetween([cLon, cLat], [lon, lat]));
/** Credit a place gets for how well it can be seen: none near the horizon, where it is foreshortened into a sliver, full within about 50 degrees of the centre. */
const seen = (z: number) => clamp((z - 0.15) / 0.5, 0, 1);
/** The company itself must face the viewer at least this squarely (about 65 degrees from the centre). */
const FOCUS_FACING = 0.42;
/** A tie's far end counts as in view from this facing on (about 78 degrees from the centre): nearer the horizon it is a sliver. */
const SHOWN_FACING = 0.2;
/** The opening view's centre stays within this latitude: a view from above the Arctic is not one a reader recognises. */
export const OPEN_MAX_LAT = 50;

/**
 * The opening (and reset) view of the globe for a company and the names placed round it. When the whole set fits on the
 * near side (the company squarely in view, the centre within OPEN_MAX_LAT), it is the framing of fitCamera. When it spreads over more than a hemisphere (NVIDIA: its customers in North
 * America, its foundry, memory and assembly in Asia), the centre is the one that shows the most weight squarely, with the
 * company itself kept well inside the disc, instead of the company's own side with the rest left on the horizon. The zoom
 * then fits what faces the viewer. The flat map shows the whole set as fitCamera frames it.
 */
export function openingCamera(focus: LonLat, places: WeightedPlace[], vp: Viewport, flat: boolean, opts: FitOptions = {}): Camera {
  const ok = places.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && p.w > 0);
  const all: LonLat[] = [focus, ...ok.map((p) => [p.lon, p.lat] as LonLat)];
  const fit = fitCamera(all, vp, flat, opts);
  if (flat || !ok.length) return fit;
  /* the framing that fits everything, when it faces the company squarely enough and does not tilt toward a pole */
  const fitHolds = facing(fit.lon, fit.lat, focus[0], focus[1]) >= FOCUS_FACING && Math.abs(fit.lat) <= OPEN_MAX_LAT + 1;
  if (fitHolds && all.every(([lon, lat]) => facing(fit.lon, fit.lat, lon, lat) >= 0.12)) return fit;
  /* the set wraps round the globe: search centres on a 5 degree grid for the most of every side in plain sight, each side
     scored as the share of its weight that faces the viewer, so forty customers at home do not outvote six suppliers abroad */
  const sideTotal = new Map<string, number>();
  for (const p of ok) sideTotal.set(p.side ?? '', (sideTotal.get(p.side ?? '') ?? 0) + p.w);
  /* first the fewest ties with an end behind the edge (a tie whose both ends a view can show is not left with one hidden),
     then the most weight in plain sight; the centre never tilts past OPEN_MAX_LAT, so the reader sees a globe they know */
  let best: { lon: number; lat: number; hidden: number; score: number; near: number } | null = null;
  for (let lat = -OPEN_MAX_LAT; lat <= OPEN_MAX_LAT; lat += 5) {
    for (let lon = -180; lon < 180; lon += 5) {
      const zf = facing(lon, lat, focus[0], focus[1]);
      if (zf < FOCUS_FACING) continue;
      let score = seen(zf), hidden = 0;
      for (const p of ok) {
        const z = facing(lon, lat, p.lon, p.lat);
        if (z < SHOWN_FACING) hidden++;
        score += (p.w / (sideTotal.get(p.side ?? '') as number)) * seen(z);
      }
      /* between equal views, the one closer to the company */
      if (!best || hidden < best.hidden || (hidden === best.hidden && (score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && zf > best.near)))) best = { lon, lat, hidden, score, near: zf };
    }
  }
  if (!best) return fit;
  const shown = all.filter(([lon, lat]) => facing(best.lon, best.lat, lon, lat) >= 0.15);
  const minZoom = opts.minZoom ?? 1, maxZoom = opts.maxZoom ?? 24, pad = opts.pad ?? 56;
  const view = makeView({ lon: best.lon, lat: best.lat, zoom: 1 }, vp, false), pr: Projected = { x: 0, y: 0, z: 0 };
  let mx = 0, my = 0;
  for (const [lon, lat] of shown) { project(view, lon, lat, 0, pr); mx = Math.max(mx, Math.abs(pr.x - view.cx) / view.R); my = Math.max(my, Math.abs(pr.y - view.cy) / view.R); }
  const halfW = Math.max(40, vp.w / 2 - pad), halfH = Math.max(40, vp.h / 2 - pad), base = baseScale(vp, false);
  const R = Math.min(mx > 0 ? halfW / mx : Infinity, my > 0 ? halfH / my : Infinity);
  return { lon: wrapLon(best.lon), lat: best.lat, zoom: clamp(Number.isFinite(R) ? R / base : minZoom, minZoom, maxZoom) };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/**
 * A flight between two views: the centre travels the great circle, zoom moves on a log scale and, on a long hop between
 * two close-up views, pulls back far enough to show the way before closing in again. Returns the camera at time t (0 to 1)
 * and how long the flight should take in ms.
 */
export function flight(from: Camera, to: Camera, flat: boolean): { at: (t: number) => Camera; ms: number } {
  const a = toVec(from.lon, from.lat), b = toVec(to.lon, to.lat), turn = angleBetween([from.lon, from.lat], [to.lon, to.lat]);
  const z0 = Math.log(from.zoom), z1 = Math.log(to.zoom);
  /* the zoom at which both ends would still be in view; only used when it is farther out than both ends */
  const both = Math.log(Math.max(0.9, 0.8 / Math.max(turn, 0.02)));
  const mid = Math.min((z0 + z1) / 2, both), ctrl = 2 * mid - (z0 + z1) / 2;
  const dLon = lonDelta(from.lon, to.lon), tmp: Vec3 = [0, 0, 0];
  const ms = clamp(380 + 520 * Math.min(1, turn / 1.4) + 140 * Math.abs(z1 - z0), 320, 1300);
  return {
    ms,
    at: (t) => {
      const e = easeInOut(clamp(t, 0, 1));
      const zoom = Math.exp((1 - e) * (1 - e) * z0 + 2 * e * (1 - e) * ctrl + e * e * z1);
      if (flat || turn < 1e-6) return { lon: wrapLon(from.lon + dLon * e), lat: from.lat + (to.lat - from.lat) * e, zoom };
      const [lon, lat] = toLonLat(slerp(a, b, e, tmp));
      return { lon, lat, zoom };
    },
  };
}

/** Wheel travel in pixels, whatever unit the browser reported it in, with a single notch capped. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 18 : deltaMode === 2 ? deltaY * 360 : deltaY;
  return clamp(px, -240, 240);
}
/** Zoom factor for one mouse notch (about 100 px of travel) and the most any single wheel event may change the zoom by. */
export const NOTCH_ZOOM = 1.25;
export const MAX_EVENT_ZOOM = 1.3;
const WHEEL_K = Math.log(NOTCH_ZOOM) / 100;
/**
 * Zoom factor for a wheel travel: a notch of 100 px is 1.25 times closer or farther, a notch reported larger (120, 150 px,
 * or lines and pages) no more than 1.3 times, so ten notches take the map ten to fourteen times in and never past a region into
 * empty land. Small trackpad steps stay in proportion to their travel.
 */
export const wheelFactor = (pixels: number) => clamp(Math.exp(-pixels * WHEEL_K), 1 / MAX_EVENT_ZOOM, MAX_EVENT_ZOOM);

/**
 * The farthest zoom worth offering for a set of places: far enough in that the two closest distinct places stand far
 * enough apart for a cluster at either to open, and no farther. A scene whose places are all far apart stops at a
 * regional view; two offices a few kilometres apart let the map go down to street scale, where the base map is only a
 * backdrop.
 */
export function deepestZoom(places: LonLat[], vp: Viewport, flat: boolean, apartPx = 96, floor = 14, ceil = 400): number {
  let closest = Infinity;
  const n = Math.min(places.length, 400);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = angleBetween(places[i], places[j]);
    if (d > 2e-5 && d < closest) closest = d;
  }
  if (!Number.isFinite(closest)) return floor;
  return clamp(apartPx / (closest * baseScale(vp, flat)), floor, ceil);
}
