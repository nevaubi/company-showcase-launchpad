// Canvas renderer for the supply-chain globe: camera, drawing, clustering and pointer handling.
// No React and no app imports, so it can be driven by any scene. Browser-only: it is loaded lazily
// by supply-globe.tsx and never runs during server rendering or in unit tests.
import { geoArea, geoCentroid, geoContains, geoDistance, geoGraticule10, geoInterpolate, geoNaturalEarth1, geoOrthographic, geoPath, geoRotation, type GeoPermissibleObjects, type GeoProjection } from 'd3';
import type { Feature, MultiLineString, Polygon } from 'geojson';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world110 from 'world-atlas/countries-110m.json';
import world50 from 'world-atlas/countries-50m.json';
import { HiGeo, packHi, type HiPacked } from './hi-geo';

/* ---------- public types ---------- */
export interface GlobePoint {
  key: string; name: string; hub: string;
  lon: number; lat: number;
  color: string;
  /** drives the dot size; any non-negative number, compared on a square-root scale */
  weight: number;
  /** false when the current filters exclude the company: drawn as a faint speck, not clickable */
  active: boolean;
  /** logo image address; a plain dot is drawn until it loads or when it fails */
  logo?: string;
  /** true when the place is only known to country level: drawn as an open ring */
  hollow?: boolean;
  /** the company the scene is about: a cluster that holds it is named after it */
  lead?: boolean;
  /** drawn pale but still clickable: outside the current scenario */
  faded?: boolean;
  /** colour of a ring that marks the company as linked to the selection */
  ring?: string;
  /** marker shape: the host gives each relation its own, so relations differ without colour */
  shape?: GlobeShape;
}
export type GlobeShape = 'circle' | 'square' | 'diamond' | 'triangle';
/** A screen rectangle (CSS px, relative to the canvas) that labels must keep clear of: controls laid over the map. */
export interface GlobeBox { x: number; y: number; w: number; h: number }
export interface GlobeArc { id: string; a: [number, number]; b: [number, number]; color: string; dash: number[]; twoWay: boolean; hot: boolean; dim: boolean; /** line width in px; 1.8 when absent */ width?: number; /** no direction marks: for ties that are not a flow of goods */ plain?: boolean }
export interface GlobeBadge { lon: number; lat: number; text: string; /** key of the point the badge belongs to, so badges that share a cluster are drawn as one */ key?: string }
export interface GlobeScene { points: GlobePoint[]; arcs: GlobeArc[]; badges: GlobeBadge[]; selected: string | null }
/** A country to tint, by its world-atlas name (see countryPlaces). */
export interface GlobeFill { name: string; color: string; alpha: number }
export interface GlobePalette { ocean: string; land: string; border: string; coast: string; ink2: string; grid: string; ink: string; ink3: string; panel: string; accent: string; /** hairline round the globe's disc */ rim: string }
export type GlobeHit =
  | { kind: 'point'; point: GlobePoint; x: number; y: number }
  | { kind: 'cluster'; points: GlobePoint[]; x: number; y: number; lon: number; lat: number };
export interface GlobeCallbacks {
  onHover: (hit: GlobeHit | null, clientX: number, clientY: number) => void;
  onPick: (point: GlobePoint) => void;
  /** a cluster too small or too tight to split by zooming: the host shows its members */
  onClusterMenu: (points: GlobePoint[], clientX: number, clientY: number) => void;
  /** the camera moved because of the user */
  onMove: () => void;
  /** the pointer is over, or clicked, a tinted country (world-atlas name); null when it left */
  onCountry?: (name: string | null, kind: 'hover' | 'pick', clientX: number, clientY: number) => void;
}

/* ---------- map geometry, prepared once ---------- */
interface Geo { land: GeoPermissibleObjects; borders: GeoPermissibleObjects }
const prep = (topo: Topology): Geo => ({
  land: feature(topo, topo.objects.land as GeometryCollection),
  borders: mesh(topo, topo.objects.countries as GeometryCollection, (a, b) => a !== b),
});
let geoCache: { low: Geo; high: Geo } | null = null;
const geo = () => (geoCache ??= { low: prep(world110 as unknown as Topology), high: prep(world50 as unknown as Topology) });
const GRATICULE = geoGraticule10();
const RAD = Math.PI / 180;

/* ---------- finer detail: country names, country shapes for tinting, and 1:10m borders loaded on demand ---------- */
let shapeCache: { low: Map<string, Feature>; high: Map<string, Feature> } | null = null;
const shapesOf = (topo: Topology): Map<string, Feature> => {
  const out = new Map<string, Feature>();
  for (const f of feature(topo, topo.objects.countries as GeometryCollection).features) {
    const name = (f.properties as { name?: string } | null)?.name;
    if (name) out.set(name, f as Feature);
  }
  return out;
};
const shapes = () => (shapeCache ??= { low: shapesOf(world110 as unknown as Topology), high: shapesOf(world50 as unknown as Topology) });
/** Every country in the base map with the centre of its largest landmass: the host matches its own country names against these. */
export const countryPlaces = (): { name: string; at: [number, number] }[] => countryLabels().map((l) => ({ name: l.atlas, at: l.at }));

interface CountryLabel { name: string; /** name as spelled in the base map */ atlas: string; at: [number, number]; size: number }
let labelCache: CountryLabel[] | null = null;
/** One label per country, placed on its largest landmass so overseas territories do not drag it out to sea. */
const countryLabels = (): CountryLabel[] => {
  if (labelCache) return labelCache;
  const topo = world110 as unknown as Topology;
  const fc = feature(topo, topo.objects.countries as GeometryCollection);
  const out: CountryLabel[] = [];
  for (const f of fc.features) {
    const name = (f.properties as { name?: string } | null)?.name;
    const g = f.geometry;
    if (!name || name === 'Antarctica' || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const parts: Polygon[] = g.type === 'Polygon' ? [g] : g.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
    let best = parts[0], area = 0;
    for (const part of parts) { const a = geoArea(part); if (a > area) { area = a; best = part; } }
    out.push({ name: name === 'United States of America' ? 'United States' : name, atlas: name, at: geoCentroid(best), size: Math.sqrt(area) });
  }
  return (labelCache = out.sort((a, b) => b.size - a.size));
};

let hi: HiGeo | null = null, hiState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
const hiWaiters = new Set<() => void>();
/** How the last 1:10m load ran, for diagnostics: 'worker', 'main' (fallback) or empty. */
export let hiLoadedBy: '' | 'worker' | 'main' = '';
const hiDone = (packed: HiPacked | null, by: 'worker' | 'main') => {
  if (packed) { hi = new HiGeo(packed); hiState = 'ready'; hiLoadedBy = by; } else hiState = 'failed';
  hiWaiters.forEach((f) => f()); hiWaiters.clear();
};
/** Parse on the main thread: only when a worker cannot start. */
const loadHiHere = () => {
  import('world-atlas/countries-10m.json')
    .then((m) => hiDone(packHi((m.default ?? m) as unknown as Topology), 'main'))
    .catch(() => hiDone(null, 'main'));
};
/**
 * Fetch and prepare the 1:10m borders the first time someone zooms in far enough to see the difference.
 * The parsing runs in a worker so the page does not freeze for most of a second; the packed arrays are transferred, not copied.
 */
const loadHi = (onReady: () => void): void => {
  if (hiState === 'ready' || hiState === 'failed') return;
  hiWaiters.add(onReady);
  if (hiState === 'loading') return;
  hiState = 'loading';
  if (typeof Worker === 'undefined') { loadHiHere(); return; }
  let w: Worker;
  try {
    w = new Worker(new URL('./hi-geo.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    loadHiHere();
    return;
  }
  w.onmessage = (e: MessageEvent<{ ok: boolean; packed?: HiPacked }>) => { w.terminate(); if (e.data.ok && e.data.packed) hiDone(e.data.packed, 'worker'); else loadHiHere(); };
  w.onerror = (e) => { e.preventDefault(); w.terminate(); loadHiHere(); };
  w.postMessage(null);
};
const HI_ZOOM = 5;
/** from this zoom on, a lone company is drawn as its logo */
const LOGO_ZOOM = 1.5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const MIN_ZOOM = 0.85, MAX_ZOOM = 120, CLUSTER_PX = 24;
/** from this zoom on, a small cluster opens into a ring of its members instead of a count */
const SPIDER_ZOOM = 10, SPIDER_MAX = 24;
/** Offsets for an opened cluster: a ring for a few members, a sunflower spiral for more. Returns the offsets and the radius they need. */
const fan = (n: number): { at: [number, number][]; reach: number } => {
  const at: [number, number][] = [];
  if (n <= 7) {
    const ring = n <= 2 ? 16 : n <= 5 ? 24 : 30;
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; at.push([ring * Math.cos(a), ring * Math.sin(a)]); }
    return { at, reach: ring + 12 };
  }
  let reach = 0;
  for (let i = 0; i < n; i++) { const r = 14 * Math.sqrt(i + 1), a = i * 2.39996; at.push([r * Math.cos(a), r * Math.sin(a)]); reach = Math.max(reach, r); }
  return { at, reach: reach + 12 };
};
const clusterKey = (c: Cluster): string => `${c.members[0].key}:${c.members.length}`;
/** The hub most of a cluster's members belong to. */
const mainHub = (members: GlobePoint[]): string => {
  const lead = members.find((m) => m.lead);
  if (lead) return members.length > 1 ? `${lead.name} + ${members.length - 1} nearby` : lead.name;
  const tally = new Map<string, number>();
  for (const m of members) tally.set(m.hub, (tally.get(m.hub) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0][0];
};

/** Trace a marker of the given shape, centred on (x, y), about as large as a circle of radius r. */
function shapePath(ctx: CanvasRenderingContext2D, shape: GlobeShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (shape === 'square') { const h = r * 0.88; ctx.rect(x - h, y - h, 2 * h, 2 * h); }
  else if (shape === 'diamond') { const h = r * 1.2; ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); }
  else if (shape === 'triangle') { const h = r * 1.2; ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.95, y + h * 0.7); ctx.lineTo(x - h * 0.95, y + h * 0.7); ctx.closePath(); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}

interface Camera { lon: number; lat: number; zoom: number }
interface Projected { x: number; y: number; visible: boolean; /** how squarely the point faces the viewer: 1 at the centre of the disc, 0 on the horizon, negative behind it */ z: number }
interface Pill { x: number; y: number; w: number; text: string }
interface Cluster { x: number; y: number; r: number; members: GlobePoint[] }
interface ArcGeom { arc: GlobeArc; at: (t: number) => [number, number]; angle: number }

/** Canvas renderer for the globe and the flat map: camera, drawing, clustering and pointer handling. No React. */
export class GlobeEngine {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam: Camera = { lon: -98, lat: 39, zoom: 1 };
  private flat = false;
  private scene: GlobeScene = { points: [], arcs: [], badges: [], selected: null };
  private arcs: ArcGeom[] = [];
  private palette: GlobePalette | null = null;
  private images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
  private fills: GlobeFill[] = [];
  private home: Camera = { lon: -98, lat: 39, zoom: 1 };
  private overCountry: string | null = null;
  private clusters: Cluster[] = [];
  /** lines from an opened cluster's true position to each member on its ring */
  private spokes: { x: number; y: number; members: Cluster[]; hub: string; reach: number }[] = [];
  private hover: string | null = null;
  private raf = 0;
  private dirty = true;
  private last = 0;
  private lastDraw = 0;
  private clock = 0;
  private autoRotate: boolean;
  private reduced: boolean;
  private fly: { from: Camera; to: Camera; start: number; ms: number } | null = null;
  private velocity = { lon: 0, lat: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: number; time: number; pinch: number } | null = null;
  private cleanup: (() => void)[] = [];
  /** the map without arcs and markers, redrawn only when the camera, theme or tint changes */
  private base: HTMLCanvasElement | null = null;
  private baseKey = '';
  private version = 0;
  private onScreen = true;
  private wasMoving = false;
  /** controls laid over the map, which labels keep clear of */
  private reserved: GlobeBox[] = [];

  constructor(private canvas: HTMLCanvasElement, private cb: GlobeCallbacks) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = motion.matches;
    const onMotion = () => { this.reduced = motion.matches; this.dirty = true; };
    motion.addEventListener('change', onMotion);
    this.cleanup.push(() => motion.removeEventListener('change', onMotion));
    /* nothing is drawn while the globe is scrolled out of view or the tab is in the background */
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => { this.onScreen = entries.some((e) => e.isIntersecting); if (this.onScreen) this.dirty = true; });
      io.observe(canvas);
      this.cleanup.push(() => io.disconnect());
    }
    this.autoRotate = false;
    this.bind();
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  /* ---------- host API ---------- */
  setScene(scene: GlobeScene): void {
    this.scene = scene;
    this.arcs = scene.arcs.map((arc) => ({ arc, at: geoInterpolate(arc.a, arc.b), angle: geoDistance(arc.a, arc.b) }));
    this.dirty = true;
  }
  setPalette(p: GlobePalette): void { this.palette = p; this.version++; this.dirty = true; }
  /** Countries to tint under the borders, by world-atlas name. */
  setFills(fills: GlobeFill[]): void { this.fills = fills; this.version++; this.dirty = true; }
  /** Screen areas covered by the host's controls: names are not written under them. */
  setReserved(boxes: GlobeBox[]): void { this.reserved = boxes; this.dirty = true; }
  /** Where reset() returns to. */
  setHome(lon: number, lat: number, zoom = 1): void { this.home = { lon, lat, zoom }; }
  private image(url: string): HTMLImageElement | null {
    const got = this.images.get(url);
    if (got) return typeof got === 'string' ? null : got;
    this.images.set(url, 'loading');
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { this.images.set(url, img); this.dirty = true; };
    img.onerror = () => { this.images.set(url, 'failed'); };
    img.src = url;
    return null;
  }
  setFlat(flat: boolean): void {
    if (flat === this.flat) return;
    this.flat = flat; this.autoRotate = false;
    this.cam.zoom = clamp(this.cam.zoom, flat ? 1 : MIN_ZOOM, MAX_ZOOM);
    this.dirty = true;
  }
  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.dirty = true;
  }
  flyTo(lon: number, lat: number, zoom?: number, ms = 900): void {
    this.autoRotate = false; this.velocity = { lon: 0, lat: 0 };
    const to: Camera = { lon, lat: clamp(lat, -80, 80), zoom: clamp(zoom ?? this.cam.zoom, this.flat ? 1 : MIN_ZOOM, MAX_ZOOM) };
    if (this.reduced || ms <= 0) { this.cam = to; this.fly = null; this.dirty = true; return; }
    this.fly = { from: { ...this.cam }, to, start: performance.now(), ms };
  }
  /** Frame two places: centre on their midpoint at a zoom that keeps both in view. */
  frame(a: [number, number], b: [number, number]): void {
    const mid = geoInterpolate(a, b)(0.5), angle = Math.max(geoDistance(a, b), 0.004);
    this.flyTo(mid[0], mid[1], clamp(0.85 / angle, MIN_ZOOM, 40));
  }
  zoomBy(factor: number): void { this.flyTo(this.cam.lon, this.cam.lat, this.cam.zoom * factor, 320); }
  reset(): void { this.flyTo(this.home.lon, this.home.lat, this.home.zoom); }
  get zoom(): number { return this.cam.zoom; }
  /** True while the camera is animating, being dragged or coasting: the detailed map waits until it settles. */
  private moving(): boolean { return this.fly != null || this.drag != null && this.drag.moved > 4 || Math.abs(this.velocity.lon) > 0.002 || Math.abs(this.velocity.lat) > 0.002; }
  destroy(): void { cancelAnimationFrame(this.raf); this.cleanup.forEach((f) => f()); this.cleanup = []; this.base = null; }

  /* ---------- projection ---------- */
  private get radius(): number { return (Math.min(this.w, this.h) / 2) * 0.9 * this.cam.zoom; }
  private get flatScale(): number { return Math.min(this.w / 5.6, this.h / 2.95) * this.cam.zoom; }

  private projection(): GeoProjection {
    const cx = this.w / 2, cy = this.h / 2;
    if (!this.flat) {
      return geoOrthographic().translate([cx, cy]).scale(this.radius).rotate([-this.cam.lon, -this.cam.lat]).clipAngle(90).precision(this.cam.zoom >= HI_ZOOM ? 1 : 0.5).clipExtent([[0, 0], [this.w, this.h]]);
    }
    const p = geoNaturalEarth1().scale(this.flatScale).rotate([-this.cam.lon, 0]).translate([cx, cy]).precision(this.cam.zoom >= HI_ZOOM ? 1 : 0.5);
    const centre = p([this.cam.lon, this.cam.lat]);
    return p.translate([cx, cy + (centre ? cy - centre[1] : 0)]).clipExtent([[0, 0], [this.w, this.h]]);
  }

  /** Screen position of a place, optionally lifted above the surface (globe only). */
  private makeProjector(proj: GeoProjection): (lon: number, lat: number, lift?: number) => Projected {
    if (this.flat) {
      return (lon, lat) => {
        const p = proj([lon, lat]);
        return p ? { x: p[0], y: p[1], z: 1, visible: p[0] > -20 && p[0] < this.w + 20 && p[1] > -20 && p[1] < this.h + 20 } : { x: 0, y: 0, z: 1, visible: false };
      };
    }
    const rot = geoRotation([-this.cam.lon, -this.cam.lat]), R = this.radius, cx = this.w / 2, cy = this.h / 2;
    return (lon, lat, lift = 0) => {
      const [l, p] = rot([lon, lat]);
      const cp = Math.cos(p * RAD), x = cp * Math.sin(l * RAD), y = Math.sin(p * RAD), z = cp * Math.cos(l * RAD), k = 1 + lift;
      return { x: cx + R * k * x, y: cy - R * k * y, z, visible: z > 0.015 || Math.hypot(x, y) * k > 1.002 };
    };
  }

  /* ---------- frame loop ---------- */
  private tick = (now: number): void => {
    const dt = Math.min(64, now - (this.last || now));
    this.last = now;
    if (this.fly) {
      const t = clamp((now - this.fly.start) / this.fly.ms, 0, 1), e = ease(t), { from, to } = this.fly;
      const dLon = ((to.lon - from.lon + 540) % 360) - 180;
      this.cam = { lon: from.lon + dLon * e, lat: from.lat + (to.lat - from.lat) * e, zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e) };
      if (t >= 1) this.fly = null;
      this.dirty = true;
    } else if (!this.drag && (Math.abs(this.velocity.lon) > 0.002 || Math.abs(this.velocity.lat) > 0.002)) {
      this.cam.lon += this.velocity.lon * dt; this.cam.lat = clamp(this.cam.lat + this.velocity.lat * dt, -80, 80);
      this.velocity.lon *= 0.92; this.velocity.lat *= 0.92;
      this.dirty = true;
    } else if (this.autoRotate && !this.drag) {
      this.cam.lon += dt * 0.0045;
      this.dirty = true;
    }
    const mv = this.moving();
    if (mv !== this.wasMoving) { this.wasMoving = mv; this.dirty = true; }
    const showing = this.onScreen && !document.hidden;
    /* dots travel only along the selected link, at about 30 frames a second; with no selection the globe is still */
    if (showing && !this.reduced && this.arcs.some((a) => a.arc.hot)) { this.clock += dt; if (now - this.lastDraw >= 32) this.dirty = true; }
    if (showing && this.dirty && this.palette && this.w > 1) { this.dirty = false; this.lastDraw = now; this.draw(); }
    this.raf = requestAnimationFrame(this.tick);
  };

  /* ---------- drawing ---------- */
  private draw(): void {
    const { ctx } = this, pal = this.palette as GlobePalette;
    /* the map itself is kept on its own canvas and only redrawn when something about it changed */
    const key = [this.cam.lon.toFixed(4), this.cam.lat.toFixed(4), this.cam.zoom.toFixed(4), this.flat, this.canvas.width, this.canvas.height, this.version, this.overCountry ?? '', hiState, this.moving()].join('|');
    if (!this.base || key !== this.baseKey) {
      const base = (this.base ??= document.createElement('canvas'));
      if (base.width !== this.canvas.width || base.height !== this.canvas.height) { base.width = this.canvas.width; base.height = this.canvas.height; }
      const bctx = base.getContext('2d');
      if (bctx) {
        const real = this.ctx;
        this.ctx = bctx;
        try { this.drawBase(); } finally { this.ctx = real; }
        this.baseKey = key;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.base) ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const at = this.makeProjector(this.projection());
    this.drawSpecks(at, pal);
    this.drawArcs(at);
    this.cluster(at);
    const pills = this.layoutBadges(at);
    this.drawMarkers(pal, pills);
    this.drawBadges(pills, pal);
  }

  /** Sea, land, tinted countries, borders, names and shading: everything under the links. */
  private drawBase(): void {
    const { ctx, w, h } = this, pal = this.palette as GlobePalette;
    const cx = w / 2, cy = h / 2, R = this.radius;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const proj = this.projection(), path = geoPath(proj, ctx), at = this.makeProjector(proj);
    /* while the camera moves the coarse map is drawn; the detailed one follows as soon as it settles */
    const zoom = this.cam.zoom, moving = this.moving(), g = zoom < 1.8 || moving ? geo().low : geo().high;
    if (zoom >= HI_ZOOM && !hi) loadHi(() => { this.version++; this.dirty = true; });
    const fine = zoom >= HI_ZOOM && !moving ? hi : null;

    /* flat sea, no glow or shading: the land and the links carry the picture */
    ctx.fillStyle = pal.ocean; ctx.beginPath();
    if (this.flat) path({ type: 'Sphere' }); else ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    if (zoom < 9) { ctx.beginPath(); path(GRATICULE); ctx.strokeStyle = pal.grid; ctx.lineWidth = 0.6; ctx.stroke(); }
    ctx.lineJoin = 'round';
    if (fine) {
      /* 1:10m shapes, limited to what the view can contain */
      const centre: [number, number] = [this.cam.lon, this.cam.lat];
      const half = Math.hypot(w, h) / 2;
      const reach = (this.flat ? half / this.flatScale : Math.asin(Math.min(1, half / R))) * 1.15;
      ctx.beginPath();
      for (let i = 0; i < fine.polyCount; i++) if (fine.near('polys', i, centre, reach)) path(fine.poly(i));
      ctx.fillStyle = pal.land; ctx.fill();
      ctx.strokeStyle = pal.land; ctx.lineWidth = 0.6; ctx.stroke();
      this.drawFills(path, true);
      const lines = (set: 'borders' | 'coast'): MultiLineString => {
        const coordinates = [];
        for (let i = 0, n = fine.lineCount(set); i < n; i++) if (fine.near(set, i, centre, reach)) coordinates.push(fine.line(set, i));
        return { type: 'MultiLineString', coordinates };
      };
      ctx.beginPath(); path(lines('coast')); ctx.strokeStyle = pal.coast; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); path(lines('borders')); ctx.strokeStyle = pal.border; ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.beginPath(); path(g.land); ctx.fillStyle = pal.land; ctx.fill();
      ctx.strokeStyle = pal.coast; ctx.lineWidth = 0.8; ctx.stroke();
      this.drawFills(path, zoom >= 1.8 && !moving);
      ctx.beginPath(); path(g.borders); ctx.strokeStyle = pal.border; ctx.lineWidth = zoom > 3 ? 1 : 0.7; ctx.stroke();
    }
    this.drawCountryNames(at, pal);
    if (!this.flat) { ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = pal.rim; ctx.lineWidth = 1; ctx.stroke(); }
  }

  /** Tinted countries, drawn over the land and under the borders. */
  private drawFills(path: (o: GeoPermissibleObjects) => void, fine: boolean): void {
    if (!this.fills.length) return;
    const { ctx } = this, set = fine ? shapes().high : shapes().low;
    for (const f of this.fills) {
      const shape = set.get(f.name) ?? shapes().low.get(f.name);
      if (!shape) continue;
      ctx.beginPath(); path(shape);
      ctx.globalAlpha = f.name === this.overCountry ? Math.min(1, f.alpha + 0.18) : f.alpha;
      ctx.fillStyle = f.color; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  /** The tinted country under a screen position, if any. */
  private countryAt(x: number, y: number): string | null {
    if (!this.fills.length) return null;
    const at = this.projection().invert?.([x, y]);
    if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
    if (!this.flat && Math.hypot(x - this.w / 2, y - this.h / 2) > this.radius) return null;
    const low = shapes().low;
    for (const f of this.fills) { const shape = low.get(f.name); if (shape && geoContains(shape, at)) return f.name; }
    return null;
  }

  /** Country names, shown once a country is wide enough on screen to hold its own name. */
  private drawCountryNames(at: (lon: number, lat: number, lift?: number) => Projected, pal: GlobePalette): void {
    const { ctx } = this, zoom = this.cam.zoom;
    if (zoom < 1.5 || zoom > 26) return;
    const scale = this.flat ? this.flatScale : this.radius;
    ctx.font = '600 10.5px "Geist", ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = pal.ink2; ctx.globalAlpha = 0.9;
    for (const l of countryLabels()) {
      const text = l.name.toUpperCase(), width = text.length * 7.4;
      if (l.size * scale < width * 0.9) continue;
      const s = at(l.at[0], l.at[1]);
      if (!s.visible || s.x < 0 || s.y < 0 || s.x > this.w || s.y > this.h) continue;
      /* letter-spaced by hand: canvas letterSpacing is not available everywhere */
      let x = s.x - width / 2 + 3.7;
      for (const ch of text) { ctx.fillText(ch, x, s.y); x += 7.4; }
    }
    ctx.globalAlpha = 1;
  }

  /** Companies excluded by the filters: faint specks that keep the geography readable. */
  private drawSpecks(at: (lon: number, lat: number, lift?: number) => Projected, pal: GlobePalette): void {
    const { ctx } = this;
    ctx.fillStyle = pal.ink3; ctx.globalAlpha = 0.4;
    for (const p of this.scene.points) {
      if (p.active) continue;
      const s = at(p.lon, p.lat);
      if (!s.visible) continue;
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawArcs(at: (lon: number, lat: number, lift?: number) => Projected): void {
    const { ctx } = this, N = 64;
    for (const { arc, at: along, angle } of this.arcs) {
      const peak = this.flat ? 0 : 0.03 + 0.24 * (angle / Math.PI);
      const pos = (t: number) => { const [lon, lat] = along(t); return at(lon, lat, peak * Math.sin(Math.PI * t)); };
      const alpha = arc.dim ? 0.22 : 0.95, lw = arc.width ?? 1.8;
      ctx.strokeStyle = arc.color; ctx.lineWidth = arc.hot ? lw + 1.2 : lw; ctx.lineCap = 'round'; ctx.setLineDash(arc.dash);
      /* a line thins out as it nears the horizon and is gone behind it, so nothing stops dead in mid-air */
      const facing = (p: Projected) => clamp((p.z + 0.02) / 0.3, 0, 1);
      const pts: Projected[] = [];
      for (let i = 0; i <= N; i++) pts.push(pos(i / N));
      let open = false;
      const flush = () => { if (open) { ctx.globalAlpha = alpha; ctx.stroke(); open = false; } };
      for (let i = 0; i < N; i++) {
        const a = pts[i], b = pts[i + 1];
        const k = a.visible && b.visible ? Math.min(facing(a), facing(b)) : 0;
        const jump = this.flat && Math.abs(b.x - a.x) > this.w / 2; // crossed the edge of the flat map
        if (k <= 0 || jump) { flush(); continue; }
        if (k >= 1) {
          if (!open) { ctx.beginPath(); ctx.moveTo(a.x, a.y); open = true; }
          ctx.lineTo(b.x, b.y);
        } else {
          flush();
          ctx.globalAlpha = alpha * k; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      flush();
      ctx.setLineDash([]); ctx.globalAlpha = alpha; ctx.fillStyle = arc.color;
      /* direction: a fixed chevron for still images, travelling dots when motion is allowed */
      const chevron = (t: number, dir: 1 | -1) => {
        const p = pos(t), q = pos(t + 0.012 * dir);
        if (!p.visible || !q.visible || facing(p) < 0.5) return;
        const ang = Math.atan2(q.y - p.y, q.x - p.x), size = 4.5 + lw;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * size, p.y + Math.sin(ang) * size);
        ctx.lineTo(p.x + Math.cos(ang + 2.5) * size, p.y + Math.sin(ang + 2.5) * size);
        ctx.lineTo(p.x + Math.cos(ang - 2.5) * size, p.y + Math.sin(ang - 2.5) * size);
        ctx.closePath(); ctx.fill();
      };
      if (arc.plain) continue;
      if (arc.twoWay) { chevron(0.42, -1); chevron(0.58, 1); } else chevron(0.5, 1);
      if (!this.reduced && arc.hot) {
        const phase = (this.clock / 3200) % 1;
        for (const d of [0, 1 / 3, 2 / 3]) {
          const t = (phase + d) % 1;
          for (const dir of arc.twoWay ? [t, 1 - t] : [t]) {
            const s = pos(dir);
            if (!s.visible || facing(s) <= 0) continue;
            ctx.globalAlpha = alpha * facing(s);
            ctx.beginPath(); ctx.arc(s.x, s.y, arc.hot ? 2.8 : 2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      for (const end of [0, 1]) {
        const s = pos(end);
        if (!s.visible || s.z <= 0) continue;
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Greedy screen-space clustering: the largest companies seed clusters, neighbours within reach join them. */
  private cluster(at: (lon: number, lat: number, lift?: number) => Projected): void {
    const cell = CLUSTER_PX, grid = new Map<string, Cluster[]>(), out: Cluster[] = [];
    const pts = this.scene.points.filter((p) => p.active).sort((a, b) => b.weight - a.weight);
    for (const p of pts) {
      const s = at(p.lon, p.lat);
      if (!s.visible || s.x < -30 || s.y < -30 || s.x > this.w + 30 || s.y > this.h + 30) continue;
      const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
      let home: Cluster | null = null;
      for (let i = gx - 1; i <= gx + 1 && !home; i++) for (let j = gy - 1; j <= gy + 1 && !home; j++) {
        for (const c of grid.get(`${i},${j}`) ?? []) if (Math.hypot(c.x - s.x, c.y - s.y) < CLUSTER_PX) { home = c; break; }
      }
      if (home) { home.members.push(p); continue; }
      const c: Cluster = { x: s.x, y: s.y, r: 0, members: [p] };
      out.push(c);
      const key = `${gx},${gy}`;
      grid.set(key, [...(grid.get(key) ?? []), c]);
    }
    const size = (c: Cluster) => (c.members.length === 1 ? clamp(3.5 + Math.sqrt(c.members[0].weight) / 9, 4.5, 11) : Math.min(30, 10 + 3.4 * Math.sqrt(c.members.length)));
    /* how much room a cluster takes on screen: a lone company may be drawn as a logo tile */
    const logoTiles = this.cam.zoom >= LOGO_ZOOM;
    const room = (c: Cluster) => (c.members.length === 1 && logoTiles ? 13 : c.r);
    for (const c of out) c.r = size(c);
    /* rings are wider than the distance that seeds them, so fold together any that would cover each other */
    for (let merged = true; merged;) {
      merged = false;
      scan: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const halo = a.members.some((m) => m.ring) || b.members.some((m) => m.ring) ? 11 : 5; // outlines and link rings sit outside the radius
        if (Math.hypot(a.x - b.x, a.y - b.y) >= room(a) + room(b) + halo) continue;
        const [keep, drop] = a.members.length >= b.members.length ? [a, b] : [b, a];
        keep.members.push(...drop.members);
        keep.members.sort((m, n) => n.weight - m.weight);
        keep.r = size(keep);
        out.splice(out.indexOf(drop), 1);
        merged = true;
        break scan;
      }
    }
    this.spokes = [];
    if (this.cam.zoom < SPIDER_ZOOM) { this.clusters = out; return; }
    /* zoomed in: a cluster that can no longer split by zooming opens into a ring of its members */
    /* largest first, and only where the opened shape will not land on a neighbour */
    const open: Cluster[] = [], taken: { x: number; y: number; r: number }[] = out.map((c) => ({ x: c.x, y: c.y, r: room(c) }));
    const order = out.map((_, i) => i).sort((a, b) => out[b].members.length - out[a].members.length);
    for (const i of order) {
      const c = out[i], n = c.members.length;
      if (n < 2 || n > SPIDER_MAX) { open.push(c); continue; }
      const shape = fan(n);
      const blocked = taken.some((t, j) => j !== i && Math.hypot(t.x - c.x, t.y - c.y) < t.r + shape.reach + 5);
      if (blocked) { open.push(c); continue; }
      taken[i] = { x: c.x, y: c.y, r: shape.reach };
      const members = c.members.map((m, k) => ({ x: c.x + shape.at[k][0], y: c.y + shape.at[k][1], r: 13, members: [m] }));
      this.spokes.push({ x: c.x, y: c.y, members, hub: mainHub(c.members), reach: shape.reach });
      open.push(...members);
    }
    this.clusters = open;
  }

  private drawMarkers(pal: GlobePalette, pills: Pill[]): void {
    const { ctx } = this;
    const singles = this.clusters.filter((c) => c.members.length === 1);
    const logos = singles.length <= 80 && this.cam.zoom >= LOGO_ZOOM;
    const boxes: [number, number, number, number][] = [];
    /* the host's controls lie over the map: no name goes under them */
    for (const r of this.reserved) boxes.push([r.x, r.y, r.w, r.h]);
    /* a marker's box includes the rings drawn round it (hover, selection, overlay), so names keep clear of those too */
    const mark = (x: number, y: number, r: number) => boxes.push([x - r - 5, y - r - 5, 2 * r + 10, 2 * r + 10]);
    const free = (x: number, y: number, bw: number, bh: number) => {
      if (boxes.some(([a, b, c, d]) => x < a + c && x + bw > a && y < b + d && y + bh > b)) return false;
      boxes.push([x, y, bw, bh]); return true;
    };
    /** Write a name beside a marker: below it if there is room, otherwise above, right or left. Places are set apart from companies by case. */
    const label = (text: string, cx: number, cy: number, r: number, kind: 'hub' | 'company' | 'picked') => {
      const hub = kind === 'hub';
      ctx.font = hub ? '600 10.5px "Geist", ui-sans-serif, system-ui, sans-serif' : `${kind === 'picked' ? 600 : 500} ${kind === 'picked' ? 12 : 11}px "Geist", ui-sans-serif, system-ui, sans-serif`;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = hub ? '0.7px' : '0px';
      const shown = hub ? text.toUpperCase() : text;
      const tw = ctx.measureText(shown).width, th = kind === 'picked' ? 15 : 14, g = r + 6;
      const spots: [number, number][] = [[cx - tw / 2, cy + g], [cx - tw / 2, cy - g - th], [cx + g + 2, cy - th / 2], [cx - g - 2 - tw, cy - th / 2]];
      const spot = spots.find(([x, y]) => x >= 2 && x + tw <= this.w - 2 && y >= 2 && y + th <= this.h - 2 && free(x - 2, y - 1, tw + 4, th + 2));
      if (spot) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
        ctx.strokeStyle = pal.panel; ctx.lineWidth = 3.5; ctx.strokeText(shown, spot[0], spot[1]);
        ctx.fillStyle = hub ? pal.ink2 : pal.ink; ctx.fillText(shown, spot[0], spot[1]);
      }
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    };

    /* opened clusters: spokes back to the true position, with the place named at the centre */
    for (const s of this.spokes) {
      ctx.strokeStyle = pal.ink3; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const m of s.members) { ctx.moveTo(s.x, s.y); ctx.lineTo(m.x, m.y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fillStyle = pal.ink; ctx.fill();
    }

    /* clusters first, largest at the back */
    for (const c of [...this.clusters].sort((a, b) => b.members.length - a.members.length)) {
      const n = c.members.length, hot = this.hover === clusterKey(c);
      if (n === 1) continue;
      /* a cluster made only of pale names (outside the shock scenario) is pale too */
      ctx.globalAlpha = c.members.every((m) => m.faded) ? 0.35 : 1;
      const tally = new Map<string, number>();
      for (const m of c.members) tally.set(m.color, (tally.get(m.color) ?? 0) + 1);
      let a0 = -Math.PI / 2;
      for (const [color, k] of [...tally].sort((x, y) => y[1] - x[1])) {
        const a1 = a0 + (k / n) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, c.r, a0, a1); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
        a0 = a1;
      }
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 0.75, 0, Math.PI * 2); ctx.strokeStyle = hot ? pal.ink : pal.panel; ctx.lineWidth = 1.5; ctx.stroke();
      const ring = c.members.find((m) => m.ring)?.ring;
      if (ring) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 3.5, 0, Math.PI * 2); ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(6, c.r - 5.5), 0, Math.PI * 2); ctx.fillStyle = pal.panel; ctx.fill();
      ctx.fillStyle = pal.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '500 10.5px "Geist Mono", ui-monospace, monospace';
      ctx.fillText(String(n), c.x, c.y + 0.5);
      ctx.globalAlpha = 1;
      mark(c.x, c.y, c.r);
    }
    const hubLabels: { text: string; x: number; y: number; r: number; n: number }[] = [];
    const minForLabel = this.cam.zoom >= SPIDER_ZOOM ? 2 : 4;
    for (const c of this.clusters) if (c.members.length >= minForLabel) hubLabels.push({ text: mainHub(c.members), x: c.x, y: c.y, r: c.r, n: c.members.length });
    for (const s of this.spokes) hubLabels.push({ text: s.hub, x: s.x, y: s.y, r: s.reach - 1, n: s.members.length });
    hubLabels.sort((a, b) => b.n - a.n);
    const named = new Set<string>();
    for (const p of pills) boxes.push([p.x - 2, p.y - 10.5, p.w + 4, 21]);

    singles.forEach((c) => {
      const p = c.members[0], hot = this.hover === clusterKey(c), picked = this.scene.selected === p.key;
      ctx.globalAlpha = p.faded && !picked ? 0.3 : 1;
      const img = logos && p.logo ? this.image(p.logo) : null;
      if (img) {
        const s = 20, x = c.x - s / 2, y = c.y - s / 2;
        ctx.beginPath(); ctx.roundRect(x - 2, y - 2, s + 4, s + 4, 5); ctx.fillStyle = p.color; ctx.fill();
        ctx.beginPath(); ctx.roundRect(x, y, s, s, 3); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, s, s, 3); ctx.clip();
        try { ctx.drawImage(img, x, y, s, s); } catch { this.images.set(p.logo as string, 'failed'); }
        ctx.restore();
        /* the relation's shape in the corner, so a logo tile still says what the company is to the focus */
        shapePath(ctx, p.shape ?? 'circle', x + s + 1, y + s + 1, 4.2); ctx.fillStyle = p.color; ctx.fill(); ctx.strokeStyle = pal.panel; ctx.lineWidth = 1.5; ctx.stroke();
        c.r = 13;
      } else if (p.hollow) {
        shapePath(ctx, p.shape ?? 'circle', c.x, c.y, c.r); ctx.fillStyle = pal.panel; ctx.fill();
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.2; ctx.stroke();
      } else {
        shapePath(ctx, p.shape ?? 'circle', c.x, c.y, c.r); ctx.fillStyle = p.color; ctx.fill();
        ctx.strokeStyle = pal.panel; ctx.lineWidth = 2; ctx.stroke();
      }
      if (hot || picked || p.ring) {
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = picked ? pal.accent : hot ? pal.ink : (p.ring as string); ctx.lineWidth = picked ? 2.5 : hot ? 1.5 : 2; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      mark(c.x, c.y, c.r);
    });
    const pickedSingle = singles.find((c) => c.members[0].key === this.scene.selected);
    if (pickedSingle) label(pickedSingle.members[0].name, pickedSingle.x, pickedSingle.y, pickedSingle.r, 'picked');
    for (const h of hubLabels) { if (named.has(h.text)) continue; named.add(h.text); label(h.text, h.x, h.y, h.r, 'hub'); }
    /* names go on last, so no label lands on a marker */
    singles.forEach((c, i) => {
      if (c === pickedSingle) return;
      const p = c.members[0], picked = this.scene.selected === p.key;
      if (picked || p.ring || this.hover === clusterKey(c) || i < 14 || this.cam.zoom >= 5) label(p.name, c.x, c.y, c.r, picked ? 'picked' : 'company');
    });
  }

  /** Step numbers of a traced path. Steps that fall in the same cluster share one pill, placed outside the ring; pills that would collide are stacked. */
  private layoutBadges(at: (lon: number, lat: number, lift?: number) => Projected): Pill[] {
    const { ctx } = this;
    if (!this.scene.badges.length) return [];
    const home = new Map<string, Cluster>();
    for (const c of this.clusters) for (const m of c.members) home.set(m.key, c);
    const groups = new Map<string, { x: number; y: number; texts: string[] }>();
    for (const b of this.scene.badges) {
      const c = b.key ? home.get(b.key) : undefined;
      let x: number, y: number, id: string;
      if (c) { const r = c.members.length === 1 ? Math.max(c.r, 13) : c.r; x = c.x + r * 0.72 + 3; y = c.y - r * 0.72 - 9; id = clusterKey(c); }
      else { const s = at(b.lon, b.lat); if (!s.visible || s.z <= 0) continue; x = s.x + 8; y = s.y - 14; id = `${Math.round(s.x / 6)}:${Math.round(s.y / 6)}`; }
      const g = groups.get(id) ?? { x, y, texts: [] };
      g.texts.push(b.text); groups.set(id, g);
    }
    ctx.font = '500 10px "Geist Mono", ui-monospace, monospace';
    const out: Pill[] = [];
    for (const g of groups.values()) {
      const text = g.texts.join(' · '), w = Math.max(17, ctx.measureText(text).width + 10);
      let y = g.y;
      for (let tries = 0; tries < 6 && out.some((p) => g.x < p.x + p.w + 2 && g.x + w + 2 > p.x && Math.abs(y - p.y) < 19); tries++) y -= 19;
      out.push({ x: Math.min(g.x, this.w - w - 2), y: Math.max(11, y), w, text });
    }
    return out;
  }

  private drawBadges(pills: Pill[], pal: GlobePalette): void {
    const { ctx } = this;
    ctx.font = '500 10px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of pills) {
      ctx.beginPath(); ctx.roundRect(p.x, p.y - 8.5, p.w, 17, 8.5); ctx.fillStyle = pal.accent; ctx.fill();
      ctx.strokeStyle = pal.panel; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = pal.panel; ctx.fillText(p.text, p.x + p.w / 2, p.y + 0.5);
    }
  }

  /* ---------- pointer and keyboard ---------- */
  private hitAt(x: number, y: number): Cluster | null {
    let best: Cluster | null = null, bd = Infinity;
    for (const c of this.clusters) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= c.r + 6 && d < bd) { best = c; bd = d; }
    }
    return best;
  }
  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  private toHit(c: Cluster): GlobeHit {
    if (c.members.length === 1) return { kind: 'point', point: c.members[0], x: c.x, y: c.y };
    const n = c.members.length;
    return { kind: 'cluster', points: c.members, x: c.x, y: c.y, lon: c.members.reduce((s, m) => s + m.lon, 0) / n, lat: c.members.reduce((s, m) => s + m.lat, 0) / n };
  }
  private degPerPx(): number { return 1 / ((this.flat ? this.flatScale : this.radius) * RAD); }

  private bind(): void {
    const el = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    const pinchSpan = () => { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

    on('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.autoRotate = false; this.fly = null; this.velocity = { lon: 0, lat: 0 };
      this.drag = { x: e.clientX, y: e.clientY, moved: 0, time: performance.now(), pinch: this.pointers.size === 2 ? pinchSpan() : 0 };
      this.cb.onHover(null, 0, 0);
    });
    on('pointermove', (e) => {
      if (this.drag && this.pointers.has(e.pointerId)) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
          const span = pinchSpan();
          if (this.drag.pinch > 0) this.cam.zoom = clamp(this.cam.zoom * (span / this.drag.pinch), this.flat ? 1 : MIN_ZOOM, MAX_ZOOM);
          this.drag.pinch = span; this.drag.moved += 10; this.dirty = true;
          return;
        }
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y, k = this.degPerPx();
        this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.cam.lon -= dx * k; this.cam.lat = clamp(this.cam.lat + dy * k, -80, 80);
        this.velocity = { lon: (-dx * k) / 16, lat: (dy * k) / 16 };
        this.dirty = true;
        if (this.drag.moved > 4) this.cb.onMove();
        return;
      }
      const [x, y] = this.local(e), hit = this.hitAt(x, y);
      const key = hit ? clusterKey(hit) : null;
      if (key !== this.hover) { this.hover = key; this.dirty = true; }
      const country = hit ? null : this.countryAt(x, y);
      if (country !== this.overCountry) { this.overCountry = country; this.dirty = true; }
      el.style.cursor = hit || country ? 'pointer' : 'grab';
      this.cb.onHover(hit ? this.toHit(hit) : null, e.clientX, e.clientY);
      this.cb.onCountry?.(country, 'hover', e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      const d = this.drag;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size > 0) { if (d) d.pinch = 0; return; }
      this.drag = null;
      if (!d) return;
      if (d.moved <= 5 && performance.now() - d.time < 600) {
        this.velocity = { lon: 0, lat: 0 };
        const [x, y] = this.local(e), hit = this.hitAt(x, y);
        if (!hit) { const country = this.countryAt(x, y); if (country) this.cb.onCountry?.(country, 'pick', e.clientX, e.clientY); return; }
        const info = this.toHit(hit);
        if (info.kind === 'point') this.cb.onPick(info.point);
        else if (info.points.length <= 6 || (this.cam.zoom >= SPIDER_ZOOM && info.points.length <= 30) || this.cam.zoom >= MAX_ZOOM * 0.6) this.cb.onClusterMenu(info.points, e.clientX, e.clientY);
        else { this.flyTo(info.lon, info.lat, this.cam.zoom * 2.6, 700); this.cb.onMove(); }
      }
    };
    on('pointerup', release);
    /* the browser took the gesture over (a vertical swipe scrolls the page): drop it without treating it as a tap */
    on('pointercancel', (e) => { this.pointers.delete(e.pointerId); if (this.pointers.size === 0) this.drag = null; else if (this.drag) this.drag.pinch = 0; });
    on('pointerleave', () => {
      if (this.hover || this.overCountry) { this.hover = null; this.overCountry = null; this.dirty = true; }
      this.cb.onHover(null, 0, 0); this.cb.onCountry?.(null, 'hover', 0, 0);
    });
    on('wheel', (e) => {
      /* a plain wheel scrolls the page the globe sits in; zooming needs Ctrl or ⌘ (which is also what a trackpad pinch sends) */
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.autoRotate = false; this.fly = null;
      this.cam.zoom = clamp(this.cam.zoom * Math.exp(-e.deltaY * 0.0016), this.flat ? 1 : MIN_ZOOM, MAX_ZOOM);
      this.dirty = true; this.cb.onMove();
    }, { passive: false });
    on('dblclick', (e) => { e.preventDefault(); this.zoomBy(2); });
    on('keydown', (e) => {
      const step = 40 * this.degPerPx();
      const moves: Record<string, () => void> = {
        ArrowLeft: () => { this.cam.lon -= step; }, ArrowRight: () => { this.cam.lon += step; },
        ArrowUp: () => { this.cam.lat = clamp(this.cam.lat + step, -80, 80); }, ArrowDown: () => { this.cam.lat = clamp(this.cam.lat - step, -80, 80); },
        '+': () => this.zoomBy(1.6), '=': () => this.zoomBy(1.6), '-': () => this.zoomBy(1 / 1.6), '0': () => this.reset(),
      };
      const move = moves[e.key];
      /* leave browser shortcuts (Ctrl + 0, Alt + arrow) alone */
      if (!move || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      this.autoRotate = false; move(); this.dirty = true; this.cb.onMove();
    });
  }
}
