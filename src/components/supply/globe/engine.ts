// Canvas renderer for the supply-chain globe and its flat map: camera, drawing, clustering and pointer handling.
// No React and no app imports, so it can be driven by any scene. Browser-only: it is loaded lazily by
// supply-globe.tsx and never runs during server rendering. The rules it draws by are pure and unit-tested next to it:
// sphere.ts (projection, zoom that holds the pointed-at place, framing, flights), geometry.ts (packed maps, level of
// detail, tracing), cluster.ts (badges, clusters, fans, rim groups), arcs.ts (link paths, bundles, widths) and
// labels.ts (name placement).
//
// Two canvases: the map (sea, land, tints, borders) is redrawn only when the camera, the theme, the tints or the map
// data change; links, badges and names sit on a second canvas above it, so a hover repaints only that one. Nothing is
// drawn while nothing changes, and the frame loop stops when the picture is at rest.
import { geoArea, geoCentroid, geoContains } from 'd3';
import type { Feature, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world110 from 'world-atlas/countries-110m.json';
import { arcLift, arcSegments, arrowHead, bundleArcs, cutEnd, cutStart, distanceToArc, flowWidth, headSize, newArcPath, sampleArc, stubArc, trimArc, type ArcGroup, type ArcPath } from './arcs';
import { LogoAtlas } from './atlas';
import { badgeRadius, clusterSlices, clusterSpots, fanOffsets, rimGroups, type GlobeShape, type Spot } from './cluster';
import { LOD, packTopology, pickRes, polygonsByName, traceFlat, traceGlobe, traceGraticule, type MapRes, type PackedGeo } from './geometry';
import { markerBox, placeLabels, type Box, type LabelAsk, type LabelSide } from './labels';
import { afterFrame } from './loop';
import { anchorCentre, angleBetween, baseScale, clamp, clampCamera, deepestZoom, fitCamera, flight, lonDelta, makeView, project, RAD, slerp, toLonLat, toVec, unproject, wheelFactor, wheelPixels, type Camera, type LonLat, type Vec3, type View } from './sphere';

export type { GlobeShape } from './cluster';
export { clusterSlices } from './cluster';

/* ---------- public types ---------- */
export interface GlobePoint {
  key: string; name: string; hub: string;
  lon: number; lat: number;
  color: string;
  /** how much the name matters, 0 to 1 (its stated exposure on a square-root scale): badge size and the order names are written in */
  weight: number;
  /** logo image address; a plain marker is drawn until it loads or when it fails */
  logo?: string;
  /** the logo is known to be the company's own mark (not a favicon looked up by domain): only such a logo stands for a whole cluster */
  logoTrusted?: boolean;
  /** the place is only known to country or state level: drawn with a broken ring */
  approx?: boolean;
  /** the company the scene is about: largest badge, never folded into another name's cluster */
  lead?: boolean;
  /** drawn pale but still clickable: outside the current scenario */
  faded?: boolean;
  /** outside the isolated picture: a faint speck, not clickable, not named */
  dim?: boolean;
  /** colour of a ring that flags the name (risk overlay) */
  ring?: string;
  /** marker shape: the host gives each relation its own, so relations differ without colour */
  shape?: GlobeShape;
  /** short figure written after the name: "16%" */
  note?: string;
}
export interface GlobeArc {
  id: string;
  /** keys of the points it joins, in the direction goods and services move */
  from: string; to: string;
  /** key of the counterparty the link belongs to: hovering or clicking the link acts on that name */
  node: string;
  color: string; dash: number[];
  twoWay: boolean;
  /** no direction marks: a tie that is not a flow of goods */
  plain?: boolean;
  /** line width in px for this link alone */
  width: number;
  /** the stated figure behind the width (dollars or share), so a bundle can add its links up on the same scale */
  value?: number;
  /** a hairline: second-order links and ties that are not flows */
  thin?: boolean;
  /** outside the isolated picture: a faint trace, not clickable */
  dim?: boolean;
  /** outside the current scenario: pale */
  faded?: boolean;
}
export interface GlobeScene { points: GlobePoint[]; arcs: GlobeArc[]; selected: string | null; /** the largest single `value` among the links: the top of the width scale */ maxValue?: number }
/** A country to tint, by its world-atlas name (see countryPlaces). */
export interface GlobeFill { name: string; color: string; alpha: number; /** outline it: the country is selected */ outline?: boolean }
/** A region to name when there is room: a U.S. state, for example. `size` is its rough width in radians. */
export interface GlobeRegionLabel { name: string; short?: string; lon: number; lat: number; size: number }
/** A screen rectangle (CSS px, relative to the canvas) that labels must keep clear of: controls laid over the map. */
export interface GlobeBox { x: number; y: number; w: number; h: number }
export interface GlobePalette { ocean: string; land: string; border: string; coast: string; ink: string; ink2: string; ink3: string; grid: string; panel: string; accent: string; /** hairline round the globe's disc */ rim: string; /** plate behind logos */ plate: string }
export type GlobeHit =
  | { kind: 'point'; point: GlobePoint; x: number; y: number }
  | { kind: 'cluster'; points: GlobePoint[]; x: number; y: number }
  /** a link or a bundle of links: the counterparties it belongs to */
  | { kind: 'arc'; points: GlobePoint[]; x: number; y: number }
  /** names on the far side of the globe, pinned on its rim */
  | { kind: 'rim'; points: GlobePoint[]; x: number; y: number };
export interface GlobeCallbacks {
  onHover: (hit: GlobeHit | null, clientX: number, clientY: number) => void;
  onPick: (point: GlobePoint) => void;
  /** names that cannot be pulled apart by zooming (or the links of a bundle): the host lists them */
  onClusterMenu: (points: GlobePoint[], clientX: number, clientY: number) => void;
  /** the camera moved because of the user */
  onMove: () => void;
  /** the pointer is over, or clicked, a tinted country (world-atlas name); null when it left */
  onCountry?: (name: string | null, kind: 'hover' | 'pick', clientX: number, clientY: number) => void;
  /** the map took hold of the wheel (after a press on it) or let go of it (the pointer left, a press elsewhere) */
  onEngage?: (engaged: boolean) => void;
  /** a plain wheel passed over the map and scrolled the page instead: the host may say how to zoom */
  onWheelPassed?: () => void;
}

/* ---------- map data: the small map is bundled, the detailed ones arrive from a worker ---------- */
const TOPO110 = world110 as unknown as Topology;
const maps: { 110: PackedGeo | null; 50: PackedGeo | null; 10: PackedGeo | null } = { 110: null, 50: null, 10: null };
const mapState: Record<50 | 10, 'idle' | 'loading' | 'ready' | 'failed'> = { 50: 'idle', 10: 'idle' };
const mapWaiters = new Set<() => void>();
/** How each detailed map was prepared, for diagnostics: 'worker', 'main' (fallback) or empty while it has not arrived. */
export const mapLoadedBy: Record<50 | 10, '' | 'worker' | 'main'> = { 50: '', 10: '' };
const map110 = (): PackedGeo => (maps[110] ??= packTopology(TOPO110, 110));
const mapDone = (res: 50 | 10, packed: PackedGeo | null, by: 'worker' | 'main') => {
  if (packed) { maps[res] = packed; mapState[res] = 'ready'; mapLoadedBy[res] = by; } else mapState[res] = 'failed';
  mapWaiters.forEach((f) => f());
};
/** Prepare a map on the page's own thread: only when a worker cannot start. */
const loadHere = (res: 50 | 10) => {
  (res === 10 ? import('world-atlas/countries-10m.json?url') : import('world-atlas/countries-50m.json?url'))
    .then((m) => fetch(m.default))
    .then((r) => r.json())
    .then((t) => mapDone(res, packTopology(t as Topology, res), 'main'))
    .catch(() => mapDone(res, null, 'main'));
};
let mapWorker: Worker | null = null, workerBroken = false;
const loadMap = (res: 50 | 10): void => {
  if (mapState[res] !== 'idle') return;
  mapState[res] = 'loading';
  if (typeof Worker === 'undefined' || workerBroken) { loadHere(res); return; }
  try {
    if (!mapWorker) {
      mapWorker = new Worker(new URL('./hi-geo.worker.ts', import.meta.url), { type: 'module' });
      mapWorker.onmessage = (e: MessageEvent<{ ok: boolean; res: 50 | 10; packed?: PackedGeo }>) => {
        if (e.data.ok && e.data.packed) mapDone(e.data.res, e.data.packed, 'worker'); else loadHere(e.data.res);
      };
      mapWorker.onerror = (e) => {
        e.preventDefault(); workerBroken = true; mapWorker?.terminate(); mapWorker = null;
        for (const r of [50, 10] as const) if (mapState[r] === 'loading') loadHere(r);
      };
    }
    mapWorker.postMessage({ res });
  } catch {
    workerBroken = true;
    loadHere(res);
  }
};
const byName = new WeakMap<PackedGeo, Map<string, number[]>>();
const polysOf = (geo: PackedGeo, name: string): number[] | undefined => {
  let m = byName.get(geo);
  if (!m) { m = polygonsByName(geo); byName.set(geo, m); }
  return m.get(name);
};

/* ---------- country names and shapes for hit testing, from the small map ---------- */
interface CountryLabel { name: string; /** name as spelled in the base map */ atlas: string; at: LonLat; size: number }
let labelCache: CountryLabel[] | null = null, shapeCache: Map<string, Feature> | null = null;
const countryFeatures = () => feature(TOPO110, TOPO110.objects.countries as GeometryCollection).features;
/** One label per country, placed on its largest landmass so overseas territories do not drag it out to sea. */
const countryLabels = (): CountryLabel[] => {
  if (labelCache) return labelCache;
  const out: CountryLabel[] = [];
  for (const f of countryFeatures()) {
    const name = (f.properties as { name?: string } | null)?.name, g = f.geometry;
    if (!name || name === 'Antarctica' || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const parts: Polygon[] = g.type === 'Polygon' ? [g] : g.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
    let best = parts[0], area = 0;
    for (const part of parts) { const a = geoArea(part); if (a > area) { area = a; best = part; } }
    out.push({ name: name === 'United States of America' ? 'United States' : name, atlas: name, at: geoCentroid(best) as LonLat, size: Math.sqrt(area) });
  }
  return (labelCache = out.sort((a, b) => b.size - a.size));
};
const countryShapes = (): Map<string, Feature> => {
  if (shapeCache) return shapeCache;
  const out = new Map<string, Feature>();
  for (const f of countryFeatures()) { const name = (f.properties as { name?: string } | null)?.name; if (name) out.set(name, f as Feature); }
  return (shapeCache = out);
};
/** Every country in the base map with the centre of its largest landmass: the host matches its own country names against these. */
export const countryPlaces = (): { name: string; at: [number, number] }[] => countryLabels().map((l) => ({ name: l.atlas, at: l.at }));

/* ---------- drawing helpers ---------- */
const SANS = '"Geist", ui-sans-serif, system-ui, sans-serif', MONO = '"Geist Mono", ui-monospace, monospace';
const FONT = { name: `500 11px ${SANS}`, picked: `600 12px ${SANS}`, hub: `600 10px ${SANS}`, country: `600 10px ${SANS}`, region: `500 9.5px ${SANS}`, count: `600 10px ${MONO}`, note: `500 10px ${MONO}` } as const;
type FontKind = keyof typeof FONT;
const SPACING: Record<FontKind, number> = { name: 0, picked: 0, hub: 0.6, country: 1, region: 0.7, count: 0, note: 0 };
const LINE: Record<FontKind, number> = { name: 13, picked: 15, hub: 12, country: 12, region: 11, count: 12, note: 12 };
type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

/** Trace a marker of the given shape, centred on (x, y), about as large as a circle of radius r. */
function shapePath(ctx: CanvasRenderingContext2D, shape: GlobeShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (shape === 'square') { const h = r * 0.88; ctx.rect(x - h, y - h, 2 * h, 2 * h); }
  else if (shape === 'diamond') { const h = r * 1.2; ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); }
  else if (shape === 'triangle') { const h = r * 1.2; ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.95, y + h * 0.7); ctx.lineTo(x - h * 0.95, y + h * 0.7); ctx.closePath(); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** What stands at one spot of the frame: a single name, a cluster, or a stand-in for names that are not in view. */
interface Mark {
  id: string; x: number; y: number; r: number;
  members: GlobePoint[];
  /** the place links to this mark start and end at */
  place: Vec3;
  kind: 'single' | 'cluster' | 'rim' | 'off' | 'dim';
  /** an opened cluster's member: where it is drawn relative to its true place */
  shift?: [number, number];
  /** opened cluster: the true place and the radius the fan takes */
  hub?: { x: number; y: number; reach: number; label: string };
}
interface DrawnArc { group: ArcGroup<GlobeArc>; path: ArcPath; width: number; points: GlobePoint[]; hot: boolean }
interface Gesture { id: number; x: number; y: number; moved: number; time: number; place: LonLat | null; touch: boolean; active: boolean }

const MIN_ZOOM_GLOBE = 0.9, MIN_ZOOM_FLAT = 1;
/** Badge diameter an opened cluster is laid out for, and how far apart (px, at the deepest zoom) names must end up to count as separable by zooming. */
const FAN_D = 2 * badgeRadius(0.5) + 3, STUCK_PX = 44;
/** More links than this leaving the frame are drawn as stubs of this length (px). */
const STUB_OVER = 12, STUB_PX = 72;
const styleOf = (a: GlobeArc) => `${a.color}|${a.dash.join(',')}|${a.twoWay ? 1 : 0}|${a.plain ? 1 : 0}|${a.thin ? 1 : 0}|${a.faded ? 1 : 0}`;
/** The place most of a cluster's members share, or null when they are spread over several. */
const sharedHub = (members: GlobePoint[]): string | null => (members.every((m) => m.hub === members[0].hub) ? members[0].hub : null);

/** Canvas renderer for the globe and the flat map: camera, drawing, clustering and pointer handling. No React. */
export class GlobeEngine {
  private bctx: CanvasRenderingContext2D;
  private ctx: Ctx;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam: Camera = { lon: -98, lat: 39, zoom: 1 };
  private flat = false;
  private maxZoom = 40;
  private scene: GlobeScene = { points: [], arcs: [], selected: null };
  /** the scene's links with the key that says which of them may share a bundle */
  private styled: (GlobeArc & { style: string })[] = [];
  private pointByKey = new Map<string, GlobePoint>();
  private vecByKey = new Map<string, Vec3>();
  private palette: GlobePalette | null = null;
  private atlas: LogoAtlas;
  private fills: GlobeFill[] = [];
  private regions: GlobeRegionLabel[] = [];
  private homePlaces: LonLat[] = [];
  private homeZoom = 7;
  private reserved: GlobeBox[] = [];
  private overCountry: string | null = null;
  /* what the last frame drew, for hit testing */
  private marks: Mark[] = [];
  private markOfKey = new Map<string, Mark>();
  private drawn: DrawnArc[] = [];
  private paths: ArcPath[] = [];
  private labelSides = new Map<string, LabelSide>();
  private widths = new Map<string, number>();
  private hover: string | null = null;
  private hoverKeys = new Set<string>();
  /* frame loop */
  private raf = 0;
  private dirtyBase = true;
  private dirtyTop = true;
  private last = 0;
  private lastTop = 0;
  private clock = 0;
  private reduced: boolean;
  private onScreen = true;
  /* camera motion */
  private fly: { at: (t: number) => Camera; ms: number; start: number } | null = null;
  private zoomAnim: { target: number; place: LonLat | null; px: number; py: number } | null = null;
  private spin: { lon: number; lat: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private pinch: { span: number; zoom: number; place: LonLat | null } | null = null;
  private trail: { t: number; lon: number; lat: number }[] = [];
  private lastTap = { t: 0, x: 0, y: 0 };
  private engaged = false;
  private touchEngaged = false;
  private cleanup: (() => void)[] = [];
  private destroyed = false;

  constructor(private canvas: HTMLCanvasElement, private base: HTMLCanvasElement, private cb: GlobeCallbacks) {
    const ctx = canvas.getContext('2d'), bctx = base.getContext('2d', { alpha: true });
    if (!ctx || !bctx) throw new Error('2D canvas is not available');
    this.ctx = ctx; this.bctx = bctx;
    this.atlas = new LogoAtlas(() => this.invalidate());
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = motion.matches;
    const onMotion = () => { this.reduced = motion.matches; this.invalidate(); };
    motion.addEventListener('change', onMotion);
    this.cleanup.push(() => motion.removeEventListener('change', onMotion));
    /* nothing is drawn while the globe is scrolled out of view or the tab is in the background */
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => { const e = entries[entries.length - 1]; if (!e) return; this.onScreen = e.isIntersecting; if (this.onScreen) this.invalidate(true); });
      io.observe(canvas);
      this.cleanup.push(() => io.disconnect());
    }
    const onShow = () => { if (!document.hidden) this.invalidate(true); };
    document.addEventListener('visibilitychange', onShow);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onShow));
    const onMap = () => this.invalidate(true);
    mapWaiters.add(onMap);
    this.cleanup.push(() => mapWaiters.delete(onMap));
    this.bind();
    this.resize();
  }

  /* ---------- host API ---------- */
  setScene(scene: GlobeScene): void {
    this.scene = scene;
    this.pointByKey = new Map(scene.points.map((p) => [p.key, p]));
    this.vecByKey = new Map(scene.points.map((p) => [p.key, toVec(p.lon, p.lat)]));
    this.styled = scene.arcs.map((a) => ({ ...a, style: a.dim ? 'dim' : styleOf(a) }));
    this.limitZoom();
    this.invalidate();
  }
  /** How far in the map may go for the places it holds (isolation does not change it). A view deeper than a new limit eases back to it. */
  private limitZoom(): void {
    this.maxZoom = deepestZoom(this.scene.points.map((p) => [p.lon, p.lat] as LonLat), { w: this.w, h: this.h }, this.flat);
    if (this.cam.zoom > this.maxZoom * 1.001 && !this.fly) this.flyTo({ ...this.cam, zoom: this.maxZoom }, 260);
  }
  setPalette(p: GlobePalette): void { this.palette = p; this.atlas.setPlate(p.plate); this.invalidate(true); }
  /** Countries to tint under the borders, by world-atlas name. */
  setFills(fills: GlobeFill[]): void { this.fills = fills; this.invalidate(true); }
  /** Regions to name once the map is close enough to hold their names. */
  setRegions(regions: GlobeRegionLabel[]): void { this.regions = regions; this.invalidate(); }
  /** Screen areas covered by the host's controls: names are not written under them. */
  setReserved(boxes: GlobeBox[]): void { this.reserved = boxes; this.invalidate(); }
  /** The places reset() frames (the company and its direct links, or the isolated names), and how close it may go for them. */
  setHome(places: LonLat[], maxZoom = 7): void { this.homePlaces = places; this.homeZoom = maxZoom; }
  setFlat(flat: boolean): void {
    if (flat === this.flat) return;
    /* keep the same part of the world in the middle and about the same amount of it in view */
    const before = baseScale({ w: this.w, h: this.h }, this.flat) * this.cam.zoom;
    this.flat = flat; this.fly = null; this.zoomAnim = null; this.spin = null;
    this.maxZoom = deepestZoom(this.scene.points.map((p) => [p.lon, p.lat] as LonLat), { w: this.w, h: this.h }, flat);
    this.cam = this.clamped({ ...this.cam, zoom: before / baseScale({ w: this.w, h: this.h }, flat) });
    this.invalidate(true);
  }
  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    /* two device pixels per CSS pixel is as sharp as the eye resolves here; more only costs fill time */
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.canvas, this.base]) { c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr); }
    this.maxZoom = deepestZoom(this.scene.points.map((p) => [p.lon, p.lat] as LonLat), { w: this.w, h: this.h }, this.flat);
    this.cam = this.clamped(this.cam);
    this.invalidate(true);
  }
  /** Fly to a view. `ms` 0 jumps. */
  flyTo(to: Camera, ms?: number): void {
    this.spin = null; this.zoomAnim = null;
    const target = this.clamped(to);
    if (this.reduced || ms === 0 || this.w <= 1) { this.fly = null; this.cam = target; this.invalidate(true); return; }
    const f = flight(this.cam, target, this.flat);
    this.fly = { at: f.at, ms: ms ?? f.ms, start: performance.now() };
    this.schedule();
  }
  /** Fly to the view that takes in these places. */
  fit(places: LonLat[], opts: { pad?: number; maxZoom?: number; ms?: number } = {}): void {
    if (!places.length) return;
    this.flyTo(fitCamera(places, { w: this.w, h: this.h }, this.flat, { pad: opts.pad ?? this.pad(), minZoom: this.minZoom, maxZoom: Math.min(opts.maxZoom ?? 22, this.maxZoom), single: 5 }), opts.ms);
  }
  zoomBy(factor: number): void { this.zoomTo(this.cam.zoom * factor, null); }
  /**
   * Fly to a name so that it can be seen on its own. Its link to `anchorKey` (the company, or the name it hangs off) is
   * framed when the name stands clear at that zoom; a name in a crowd is approached until the crowd comes apart or opens.
   */
  reveal(key: string, anchorKey?: string): void {
    const p = this.pointByKey.get(key), a = anchorKey ? this.pointByKey.get(anchorKey) : undefined;
    if (!p) return;
    const vp = { w: this.w, h: this.h }, at: LonLat = [p.lon, p.lat], from: LonLat | null = a ? [a.lon, a.lat] : null;
    const link = fitCamera(from ? [from, at] : [at], vp, this.flat, { pad: this.pad(), minZoom: this.minZoom, maxZoom: Math.min(12, this.maxZoom), single: 5 });
    const need = Math.min(this.separateZoom(p), this.maxZoom);
    if (need <= link.zoom * 1.15) { this.flyTo(link); return; }
    /* keep the other end in the picture when it is still close by at that zoom */
    const near = from != null && angleBetween(from, at) * this.scaleAt(need) < Math.min(this.w, this.h) * 0.32;
    const [lon, lat] = near && from ? toLonLat(slerp(toVec(from[0], from[1]), toVec(at[0], at[1]), 0.5)) : at;
    this.flyTo({ lon, lat, zoom: need });
  }
  /** The zoom at which a name (with any others at its exact spot, opened into a fan) stands clear of every other place. */
  private separateZoom(p: GlobePoint): number {
    let same = 0, lead = false, nearest = Infinity;
    for (const q of this.scene.points) {
      if (q.dim) continue;
      const d = angleBetween([p.lon, p.lat], [q.lon, q.lat]);
      if (d < 2e-5) { same++; lead ||= !!q.lead; } else if (d < nearest) nearest = d;
    }
    if (!Number.isFinite(nearest)) return this.minZoom;
    const reach = same > 1 ? fanOffsets(lead ? same - 1 : same, FAN_D, lead ? badgeRadius(1, true) + 3 : 0).reach : badgeRadius(p.weight, p.lead);
    return (reach + 30) / nearest / baseScale({ w: this.w, h: this.h }, this.flat);
  }
  /** Back to the home view (see setHome). */
  reset(ms?: number): void { if (this.homePlaces.length) this.fit(this.homePlaces, { maxZoom: this.homeZoom, ms }); else this.flyTo({ ...this.cam, zoom: 1 }, ms); }
  /** Let go of the wheel and of one-finger panning (Escape, or the host's own reasons). */
  release(): void { this.setEngaged(false); }
  get zoom(): number { return this.cam.zoom; }
  get isFlat(): boolean { return this.flat; }
  destroy(): void { this.destroyed = true; cancelAnimationFrame(this.raf); this.raf = 0; this.cleanup.forEach((f) => f()); this.cleanup = []; }

  /* ---------- camera ---------- */
  private get minZoom(): number { return this.flat ? MIN_ZOOM_FLAT : MIN_ZOOM_GLOBE; }
  private pad(): number { return Math.min(72, Math.max(36, Math.min(this.w, this.h) * 0.12)); }
  private clamped(c: Camera, deepest = this.maxZoom): Camera { return clampCamera(c, { w: this.w, h: this.h }, this.flat, this.minZoom, Math.max(this.minZoom, deepest)); }
  private view(): View { return makeView(this.cam, { w: this.w, h: this.h }, this.flat); }
  private scaleAt(zoom: number): number { return baseScale({ w: this.w, h: this.h }, this.flat) * zoom; }
  /** Zoom to a level, holding the place under (px, py) where it is; without a point the middle of the frame holds. */
  private zoomTo(zoom: number, at: { x: number; y: number } | null): void {
    const target = Math.log(clamp(zoom, this.minZoom, this.maxZoom));
    this.fly = null; this.spin = null;
    const place = at ? unproject(this.view(), at.x, at.y) : null;
    this.zoomAnim = { target, place, px: at?.x ?? this.w / 2, py: at?.y ?? this.h / 2 };
    if (this.reduced) this.stepZoom(1e6);
    this.schedule();
  }
  private stepZoom(dt: number): void {
    const z = this.zoomAnim;
    if (!z) return;
    const now = Math.log(this.cam.zoom);
    let next = now + (z.target - now) * (1 - Math.exp(-dt / 80));
    if (Math.abs(z.target - next) < 0.003) { next = z.target; this.zoomAnim = null; }
    this.applyZoom(Math.exp(next), z.place, z.px, z.py);
  }
  private applyZoom(zoom: number, place: LonLat | null, px: number, py: number): void {
    const centre = place ? anchorCentre(place, px - this.w / 2, py - this.h / 2, this.scaleAt(zoom), this.flat, this.cam.lon) : null;
    this.cam = this.clamped({ lon: centre?.lon ?? this.cam.lon, lat: centre?.lat ?? this.cam.lat, zoom });
    this.dirtyBase = this.dirtyTop = true;
  }

  /* ---------- frame loop ---------- */
  private schedule(): void { if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.tick); }
  private invalidate(base = false): void { if (base) this.dirtyBase = true; this.dirtyTop = true; this.schedule(); }
  private tick = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(64, now - (this.last || now));
    this.last = now;
    if (this.fly) {
      const t = clamp((now - this.fly.start) / this.fly.ms, 0, 1);
      /* a flight that starts deeper than the limit (the limit has just dropped) comes back to it smoothly */
      this.cam = this.clamped(this.fly.at(t), Math.max(this.maxZoom, this.cam.zoom));
      if (t >= 1) this.fly = null;
      this.dirtyBase = this.dirtyTop = true;
    } else if (this.zoomAnim) {
      this.stepZoom(dt);
    } else if (this.spin && !this.gesture) {
      this.cam = this.clamped({ lon: this.cam.lon + this.spin.lon * dt, lat: this.cam.lat + this.spin.lat * dt, zoom: this.cam.zoom });
      const k = Math.exp(-dt / 280);
      this.spin.lon *= k; this.spin.lat *= k;
      /* stop once the coast is slower than a pixel every few frames */
      if (Math.hypot(this.spin.lon, this.spin.lat) * RAD * this.scaleAt(this.cam.zoom) < 0.012) this.spin = null;
      this.dirtyBase = this.dirtyTop = true;
    }
    const showing = this.onScreen && !document.hidden;
    /* dots travel only along the selected link, at about 30 frames a second; with no selection the picture is still */
    const flowing = showing && !this.reduced && this.drawn.some((d) => d.hot);
    if (flowing) { this.clock += dt; if (now - this.lastTop >= 32) this.dirtyTop = true; }
    try {
      if (showing && this.palette && this.w > 1) {
        if (this.dirtyBase) { this.dirtyBase = false; this.drawBase(); }
        if (this.dirtyTop) { this.dirtyTop = false; this.lastTop = now; this.draw(); }
      }
    } finally {
      /* a frame that failed to draw must not strand a flight halfway: the loop goes on whatever happened above */
      const next = afterFrame({ showing, animating: !!(this.fly || this.zoomAnim || (this.spin && !this.gesture)), flowing });
      if (next.settle) this.settle();
      if (next.publish) this.publish();
      if (next.again) this.schedule(); else this.last = 0;
    }
  };
  /** End any camera motion where it was going (the map is out of view: nobody would see the steps). */
  private settle(): void {
    if (this.fly) { this.cam = this.clamped(this.fly.at(1), Math.max(this.maxZoom, this.cam.zoom)); this.fly = null; }
    if (this.zoomAnim) this.stepZoom(1e6);
    this.spin = null;
    this.dirtyBase = this.dirtyTop = true;
  }
  /** The view at rest, as an attribute on the canvas ("lon,lat,zoom,globe|flat"): tests and the page's assistant can read where the map is without reading pixels. */
  private publish(): void {
    const view = `${this.cam.lon.toFixed(3)},${this.cam.lat.toFixed(3)},${this.cam.zoom.toFixed(3)},${this.flat ? 'flat' : 'globe'}`;
    if (this.canvas.dataset.view !== view) this.canvas.dataset.view = view;
  }

  /* ---------- the map ---------- */
  private mapFor(R: number): PackedGeo {
    if (mapState[50] === 'idle') loadMap(50);
    if (R >= LOD.fetch10 && mapState[10] === 'idle') loadMap(10);
    const res: MapRes = pickRes(R, { 50: maps[50] != null, 10: maps[10] != null });
    return (res === 110 ? map110() : maps[res]) ?? map110();
  }
  /** Sea, land, tinted countries, shores and borders: everything under the links. */
  private tintEase(R: number): number { return clamp(1 - (R / baseScale({ w: this.w, h: this.h }, this.flat) - 1.6) / 4.4, 0, 1); }

  /* the tinted country under the pointer, if any: only those answer a moving pointer */
  private tintOf(name: string | null): GlobeFill | undefined { return name ? this.fills.find((f) => f.name === name) : undefined; }

  private drawBase(): void {
    const ctx = this.bctx, pal = this.palette as GlobePalette, { w, h } = this, view = this.view(), { cx, cy, R } = view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    /* flat sea, no glow or shading: the land and the links carry the picture */
    ctx.fillStyle = pal.ocean;
    if (this.flat) ctx.fillRect(0, 0, w, h); else { ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); }
    /* a quiet grid: every 30 degrees from afar, every 10 closer in, none once a country fills the frame */
    const step = R < 420 ? 30 : R < 2600 ? 10 : 0;
    if (step) { const grid = new Path2D(); traceGraticule(view, step, grid); ctx.strokeStyle = pal.grid; ctx.lineWidth = 0.5; ctx.stroke(grid); }
    const geo = this.mapFor(R), trace = this.flat ? traceFlat : traceGlobe;
    const land = new Path2D(), coast = new Path2D(), border = new Path2D();
    trace(geo, view, { fill: land, coast, border });
    ctx.fillStyle = pal.land; ctx.fill(land, 'evenodd');
    /* the tint says where the ties are while several countries are in view; once one country fills the frame it would
       only make that country's land read as water, so it fades out as the map closes in (a picked country keeps it) */
    const ease = this.tintEase(R);
    for (const f of this.fills) {
      if (ease <= 0 && !f.outline) continue;
      const polys = polysOf(geo, f.name);
      if (!polys) continue;
      const shape = new Path2D();
      trace(geo, view, { fill: shape, coast: null, border: null }, polys);
      ctx.globalAlpha = f.alpha * (f.outline ? Math.max(ease, 0.5) : ease);
      ctx.fillStyle = f.color; ctx.fill(shape, 'evenodd');
      if (f.outline) { ctx.globalAlpha = 0.9; ctx.strokeStyle = f.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke(shape); }
    }
    ctx.globalAlpha = 1;
    /* hairlines: exactly one device pixel wide at every zoom and pixel ratio, which is also the width browsers stroke
       fastest (a wider line with round joins took six times as long as everything else in the frame together) */
    ctx.lineJoin = 'bevel'; ctx.lineCap = 'butt';
    const hair = 0.999 / this.dpr;
    ctx.strokeStyle = pal.coast; ctx.lineWidth = hair; ctx.stroke(coast);
    ctx.strokeStyle = pal.border; ctx.lineWidth = hair; ctx.stroke(border);
    if (!this.flat) { ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = pal.rim; ctx.lineWidth = 1; ctx.stroke(); }
  }

  /** The tinted country under a screen position, if any. */
  private countryAt(x: number, y: number): string | null {
    if (!this.fills.length) return null;
    const at = unproject(this.view(), x, y);
    if (!at) return null;
    const shapes = countryShapes();
    for (const f of this.fills) { const shape = shapes.get(f.name); if (shape && geoContains(shape, at)) return f.name; }
    return null;
  }

  /* ---------- links, badges and names ---------- */
  private textWidth(kind: FontKind, text: string): number {
    const k = `${kind}|${text}`, got = this.widths.get(k);
    if (got != null) return got;
    const ctx = this.ctx;
    ctx.font = FONT[kind];
    const spaced = 'letterSpacing' in ctx;
    if (spaced) ctx.letterSpacing = `${SPACING[kind]}px`;
    const w = ctx.measureText(text).width + (spaced ? 0 : SPACING[kind] * text.length);
    if (spaced) ctx.letterSpacing = '0px';
    if (this.widths.size > 4000) this.widths.clear();
    this.widths.set(k, w);
    return w;
  }

  /** Work out what stands where in this frame: badges, clusters, opened clusters, and stand-ins for names out of view. */
  private layout(view: View): { specks: [number, number][]; rim: Mark[] } {
    const { w, h, cx, cy, R } = view, flat = this.flat, pr = { x: 0, y: 0, z: 0 };
    const spots: Spot<GlobePoint>[] = [], specks: [number, number][] = [], hidden: { vx: number; vy: number; item: GlobePoint }[] = [];
    const marks: Mark[] = [], of = new Map<string, Mark>(), stands = new Map<string, Mark>();
    /* names that are not drawn as a badge still end their links somewhere: one stand-in per patch of the frame */
    const stand = (id: string, kind: Mark['kind'], x: number, y: number, p: GlobePoint): void => {
      let m = stands.get(id);
      if (!m) { m = { id, x, y, r: 0, members: [], place: this.vecByKey.get(p.key) as Vec3, kind }; stands.set(id, m); marks.push(m); }
      m.members.push(p); of.set(p.key, m);
    };
    for (const p of this.scene.points) {
      project(view, p.lon, p.lat, 0, pr);
      const inFrame = pr.x > -24 && pr.y > -24 && pr.x < w + 24 && pr.y < h + 24, front = flat || pr.z > 0.03;
      if (p.dim) {
        if (front && inFrame) specks.push([pr.x, pr.y]);
        /* links to dimmed names are traced faintly, bundled by where they end */
        if (front) stand(`d:${Math.round(pr.x / 56)}:${Math.round(pr.y / 56)}`, 'dim', pr.x, pr.y, p);
        continue;
      }
      if (!front) { hidden.push({ vx: (pr.x - cx) / R, vy: -(pr.y - cy) / R, item: p }); continue; }
      if (!inFrame) { stand(`o:${Math.round(pr.x / 90)}:${Math.round(pr.y / 90)}`, 'off', pr.x, pr.y, p); continue; }
      spots.push({ x: pr.x, y: pr.y, r: badgeRadius(p.weight, p.lead), weight: p.weight, lead: p.lead, item: p });
    }
    const rim: Mark[] = [];
    if (!flat && hidden.length) {
      rimGroups(hidden).forEach((g, i) => {
        const m: Mark = { id: `r:${i}`, x: cx + R * Math.cos(g.angle), y: cy + R * Math.sin(g.angle), r: 9, members: g.items, place: this.vecByKey.get(g.items[0].key) as Vec3, kind: 'rim' };
        marks.push(m); rim.push(m);
        for (const p of g.items) of.set(p.key, m);
      });
    }
    const clusters = clusterSpots(spots);
    /* a cluster that zooming cannot pull apart (its names share a spot, or stand closer than the deepest zoom separates)
       opens into a fan once the map is close, and at any zoom when it holds the selected name, so that name is always seen */
    const taken = clusters.map((c) => ({ x: c.x, y: c.y, r: c.r }));
    const local = R >= 900, deepest = baseScale({ w, h }, flat) * this.maxZoom, selected = this.scene.selected;
    clusters.forEach((c, ci) => {
      const members = c.members.map((s) => s.item), lead = members[0];
      if (members.length === 1) { const m: Mark = { id: `p:${lead.key}`, x: c.x, y: c.y, r: c.r, members, place: this.vecByKey.get(lead.key) as Vec3, kind: 'single' }; marks.push(m); of.set(lead.key, m); return; }
      const wanted = local || (selected != null && members.some((m) => m.key === selected));
      const stuck = wanted && members.length <= 28 && members.every((m) => angleBetween([m.lon, m.lat], [lead.lon, lead.lat]) * deepest < STUCK_PX);
      if (stuck) {
        const fan = fanOffsets(lead.lead ? members.length - 1 : members.length, FAN_D, lead.lead ? badgeRadius(1, true) + 3 : 0);
        const fits = c.x - fan.reach > 4 && c.y - fan.reach > 4 && c.x + fan.reach < w - 4 && c.y + fan.reach < h - 4;
        const clear = !taken.some((t, j) => j !== ci && Math.hypot(t.x - c.x, t.y - c.y) < t.r + fan.reach + 4);
        if (fits && clear) {
          taken[ci].r = fan.reach;
          const hub = { x: c.x, y: c.y, reach: fan.reach, label: lead.hub };
          let k = 0;
          for (const p of members) {
            /* the company the map is about keeps the true spot; the others stand round it */
            const off: [number, number] = p.lead ? [0, 0] : fan.at[k++];
            const m: Mark = { id: `p:${p.key}`, x: c.x + off[0], y: c.y + off[1], r: badgeRadius(p.weight, p.lead), members: [p], place: this.vecByKey.get(p.key) as Vec3, kind: 'single', shift: off, hub };
            marks.push(m); of.set(p.key, m);
          }
          return;
        }
      }
      const m: Mark = { id: `c:${lead.key}:${members.length}`, x: c.x, y: c.y, r: c.r, members, place: this.vecByKey.get(lead.key) as Vec3, kind: 'cluster' };
      marks.push(m);
      for (const p of members) of.set(p.key, m);
    });
    this.marks = marks; this.markOfKey = of;
    return { specks, rim };
  }

  private draw(): void {
    const ctx = this.ctx, pal = this.palette as GlobePalette, view = this.view(), { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    /* the tinted country under the pointer is lifted here, on the overlay, so a moving pointer never repaints the map */
    const over = this.tintOf(this.overCountry);
    if (over) {
      const geo = this.mapFor(view.R), polys = polysOf(geo, over.name), ease = this.tintEase(view.R), lift = 0.1 * (over.outline ? Math.max(ease, 0.5) : ease);
      if (polys && lift > 0) {
        const shape = new Path2D();
        (this.flat ? traceFlat : traceGlobe)(geo, view, { fill: shape, coast: null, border: null }, polys);
        ctx.globalAlpha = lift; ctx.fillStyle = over.color; ctx.fill(shape, 'evenodd'); ctx.globalAlpha = 1;
      }
    }
    const { specks, rim } = this.layout(view);
    const marks = this.marks, selected = this.scene.selected;
    const real = marks.filter((m) => m.kind === 'single' || m.kind === 'cluster');

    /* ---- names: one pass decides which fit, so no name lands on a badge, a control or another name ---- */
    const obstacles: Box[] = this.reserved.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    /* a badge's box takes in the rings drawn round it (hover, selection, overlay), so names keep clear of those too */
    const ringed = (m: Mark) => m.r + (m.members.some((p) => p.ring) ? 7 : 4);
    for (const m of real) obstacles.push(markerBox(m.x, m.y, ringed(m)));
    for (const m of rim) obstacles.push(markerBox(m.x, m.y, m.r + 2));
    const asks: LabelAsk[] = [], texts = new Map<string, { kind: FontKind; text: string; note?: string }>();
    const ask = (id: string, kind: FontKind, text: string, x: number, y: number, r: number, priority: number, area = false, note?: string) => {
      const shown = kind === 'hub' || kind === 'country' || kind === 'region' ? text.toUpperCase() : text;
      const width = this.textWidth(kind, shown) + (note ? 5 + this.textWidth('note', note) : 0);
      texts.set(id, { kind, text: shown, note });
      asks.push({ id, w: width, h: LINE[kind], x, y, r, priority, area });
    };
    const hubs = new Set<Mark['hub']>();
    for (const m of real) {
      const lead = m.members[0], picked = m.members.some((p) => p.key === selected), hot = this.hover === m.id;
      if (m.hub && !hubs.has(m.hub)) { hubs.add(m.hub); ask(`h:${m.hub.label}:${Math.round(m.hub.x)}`, 'hub', m.hub.label, m.hub.x, m.hub.y, m.hub.reach + 1, 60_000, false); }
      if (m.kind === 'cluster') {
        /* a cluster is named after the company the map is about when it holds it, after its place when all its names share one, and not at all otherwise: the hover list names them */
        const hub = sharedHub(m.members);
        if (lead.lead) ask(`c:${lead.key}`, 'name', lead.name, m.x, m.y, ringed(m), 800_000);
        else if (hub) ask(`c:${lead.key}`, 'hub', hub, m.x, m.y, ringed(m), (picked ? 900_000 : hot ? 850_000 : 50_000) + m.members.length * 10);
        continue;
      }
      if (lead.faded && !picked && !hot) continue;
      const pri = picked ? 1_000_000 : hot ? 900_000 : lead.lead ? 800_000 : (lead.ring ? 40_000 : 1_000) + lead.weight * 1_000;
      ask(`n:${lead.key}`, picked ? 'picked' : 'name', lead.name, m.x, m.y, ringed(m), pri, false, lead.note);
    }
    const pr = { x: 0, y: 0, z: 0 }, R = view.R, tinted = new Set(this.fills.map((f) => f.name));
    for (const l of countryLabels()) {
      const span = l.size * R;
      if (span > 2.4 * Math.max(w, h)) continue;
      const tw = this.textWidth('country', l.name.toUpperCase());
      if (span < tw * 0.85) continue;
      project(view, l.at[0], l.at[1], 0, pr);
      if (pr.z < 0.25 || pr.x < 0 || pr.y < 0 || pr.x > w || pr.y > h) continue;
      /* a country's name may sit a line or two off its middle when a badge stands there, within about a third of the country's size */
      ask(`a:${l.atlas}`, 'country', l.name, pr.x, pr.y, span * 0.3, (tinted.has(l.atlas) ? 500 : 120) + Math.min(100, l.size * 100), true);
    }
    for (const g of this.regions) {
      const span = g.size * R;
      if (span < 34 || span > 2.4 * Math.max(w, h)) continue;
      project(view, g.lon, g.lat, 0, pr);
      if (pr.z < 0.25 || pr.x < 0 || pr.y < 0 || pr.x > w || pr.y > h) continue;
      const full = this.textWidth('region', g.name.toUpperCase());
      const text = span >= full * 1.15 ? g.name : g.short && span >= 44 ? g.short : null;
      if (text) ask(`g:${g.name}`, 'region', text, pr.x, pr.y, span * 0.25, 60 + Math.min(40, g.size * 100), true);
    }
    const placed = placeLabels(asks, obstacles, { w, h }, this.labelSides);
    this.labelSides = new Map(placed.map((p) => [p.id, p.side]));
    const write = (id: string, left: number, top: number) => {
      const t = texts.get(id);
      if (!t) return;
      const area = t.kind === 'country' || t.kind === 'region';
      ctx.font = FONT[t.kind];
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${SPACING[t.kind]}px`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const y = top + LINE[t.kind] / 2 + 0.5;
      ctx.strokeStyle = area ? pal.land : pal.panel; ctx.lineWidth = area ? 2.5 : 3; ctx.globalAlpha = area ? 0.85 : 0.95;
      ctx.strokeText(t.text, left, y);
      ctx.globalAlpha = 1;
      ctx.fillStyle = area ? pal.ink3 : t.kind === 'hub' ? pal.ink2 : pal.ink;
      ctx.fillText(t.text, left, y);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      if (t.note) {
        const x = left + this.textWidth(t.kind, t.text) + 5;
        ctx.font = FONT.note; ctx.strokeStyle = pal.panel; ctx.lineWidth = 3; ctx.strokeText(t.note, x, y);
        ctx.fillStyle = pal.ink2; ctx.fillText(t.note, x, y);
      }
    };
    /* country and region names go under the links */
    for (const p of placed) if (p.id.startsWith('a:') || p.id.startsWith('g:')) write(p.id, p.left, p.top);

    /* ---- names outside the isolated picture: specks ---- */
    if (specks.length) {
      ctx.fillStyle = pal.ink3; ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (const [x, y] of specks) { ctx.moveTo(x + 1.6, y); ctx.arc(x, y, 1.6, 0, Math.PI * 2); }
      ctx.fill(); ctx.globalAlpha = 1;
    }

    this.drawArcs(view);

    /* ---- names behind the globe: a count pinned on the rim, in the direction they lie ---- */
    for (const m of rim) {
      if (m.x < 10 || m.y < 10 || m.x > w - 10 || m.y > h - 10) continue;
      const hot = this.hover === m.id, text = String(m.members.length);
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fillStyle = pal.panel; ctx.fill();
      ctx.strokeStyle = hot ? pal.ink : pal.ink3; ctx.lineWidth = hot ? 1.5 : 1; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = FONT.count; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = pal.ink2; ctx.fillText(text, m.x, m.y + 0.5);
    }

    /* ---- opened clusters: hairlines back to the true place ---- */
    const spokes = new Path2D();
    for (const m of real) if (m.hub && m.shift && (m.shift[0] || m.shift[1])) { spokes.moveTo(m.hub.x, m.hub.y); spokes.lineTo(m.x, m.y); }
    ctx.strokeStyle = pal.ink3; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.75; ctx.stroke(spokes); ctx.globalAlpha = 1;

    /* ---- badges: clusters at the back, single names over them, the company on top ---- */
    const order = [...real].sort((a, b) => Number(a.kind === 'single') - Number(b.kind === 'single') || Number(!!a.members[0].lead) - Number(!!b.members[0].lead) || a.members[0].weight - b.members[0].weight);
    for (const m of order) { if (m.kind === 'cluster') this.drawCluster(m, pal); else this.drawBadge(m, pal); }

    for (const p of placed) if (!p.id.startsWith('a:') && !p.id.startsWith('g:')) write(p.id, p.left, p.top);
    this.drawFlow(pal);
  }

  /** Links: bundled by the markers they join, widest at the back, the selected and the hovered ones last. */
  private drawArcs(view: View): void {
    const ctx = this.ctx, selected = this.scene.selected, flat = this.flat;
    const markId = (key: string) => this.markOfKey.get(key)?.id ?? null;
    const byId = new Map(this.marks.map((m) => [m.id, m]));
    const maxValue = this.scene.maxValue ?? Math.max(0, ...this.scene.arcs.map((a) => a.value ?? 0));
    const groups: ArcGroup<GlobeArc>[] = bundleArcs(this.styled, markId);
    const isHot = (g: ArcGroup<GlobeArc>) => g.arcs.some((a) => a.node === selected);
    const isOver = (g: ArcGroup<GlobeArc>) => this.hover === `a:${g.key}` || g.arcs.some((a) => this.hoverKeys.has(a.node));
    groups.sort((a, b) => Number(isHot(a) || isOver(a)) - Number(isHot(b) || isOver(b)) || b.arcs.length - a.arcs.length);
    const inView = (m: Mark | undefined) => !!m && (m.kind === 'single' || m.kind === 'cluster');
    const off = (m: Mark | undefined) => !!m && m.kind === 'off';
    /* when many links run out of the frame (the map is close in on a busy region), each is cut to a short stub at its
       badge instead of crossing the picture; the selected and the hovered ones are still drawn whole, and so is a link
       that goes over the horizon */
    let leaving = 0;
    for (const g of groups) if (g.style !== 'dim' && off(byId.get(g.from)) !== off(byId.get(g.to))) leaving++;
    const stubs = leaving > STUB_OVER;
    const drawn: DrawnArc[] = [];
    let pi = 0;
    for (const g of groups) {
      const A = byId.get(g.from), B = byId.get(g.to);
      if (!A || !B) continue;
      const first = g.arcs[0], dim = g.style === 'dim';
      const whole = !stubs || dim || isHot(g) || isOver(g) || (!off(A) && !off(B));
      /* a link with no end in view only crosses the picture */
      if (!whole && !inView(A) && !inView(B)) continue;
      const turn = Math.acos(clamp(A.place[0] * B.place[0] + A.place[1] * B.place[1] + A.place[2] * B.place[2], -1, 1));
      const length = flat ? Math.hypot(A.x - B.x, A.y - B.y) : turn * view.R;
      const path = (this.paths[pi] ??= newArcPath(64));
      const values = g.arcs.reduce((s, a) => s + (a.value ?? 0), 0);
      const width = dim ? 0.75 : first.thin ? 1 : g.arcs.length === 1 ? first.width : values > 0 ? Math.min(8, flowWidth(values, maxValue)) : Math.min(8, Math.max(...g.arcs.map((a) => a.width)) + 0.6 * Math.log2(g.arcs.length));
      sampleArc(view, A.place, B.place, flat ? 0 : arcLift(turn), g.lane * (width + 4), dim ? Math.min(20, arcSegments(length)) : arcSegments(length), path);
      /* an opened cluster's member stands beside its true place: ease the link over to its badge along its length */
      for (const [m, end] of [[A, 0], [B, 1]] as const) {
        if (!m.shift || (!m.shift[0] && !m.shift[1])) continue;
        for (let i = 0; i < path.n; i++) { const t = end ? i / (path.n - 1) : 1 - i / (path.n - 1), e = t * t * (3 - 2 * t); path.x[i] += m.shift[0] * e; path.y[i] += m.shift[1] * e; }
      }
      const realA = inView(A), realB = inView(B);
      if (!trimArc(path, realA ? A.r + 3.5 : 0, realB ? B.r + 3.5 : 0)) continue;
      const stub = !whole && realA !== realB;
      if (stub) stubArc(path, STUB_PX, realA);
      let seen = false;
      for (let i = 0; i < path.n; i++) if (path.k[i] > 0) { seen = true; break; }
      if (!seen) continue;
      pi++;
      if (dim) { this.strokeArc(path, first.color, 0.75, [], 0.14); continue; }
      const hot = isHot(g), over = isOver(g);
      const alpha = (first.faded ? 0.3 : 1) * (hot || over ? 1 : selected != null ? 0.38 : 0.9);
      const w = width + (hot ? 0.9 : over ? 0.5 : 0);
      const points = [...new Set(g.arcs.map((a) => a.node))].map((k) => this.pointByKey.get(k)).filter((p): p is GlobePoint => !!p);
      drawn.push({ group: g, path, width: w, points, hot });
      if (first.plain || first.thin || first.dash.length) {
        const heads = !first.plain;
        const endDir = heads && path.k[path.n - 1] > 0.5 && (!stub || realB) ? cutEnd(path, headSize(w).len * 0.8) : null;
        const startDir = heads && first.twoWay && path.k[0] > 0.5 && (!stub || realA) ? cutStart(path, headSize(w).len * 0.8) : null;
        this.strokeArc(path, first.color, w, first.dash, alpha);
        ctx.fillStyle = first.color; ctx.globalAlpha = alpha;
        const hs = headSize(w), len = hs.len * 0.8, half = hs.half * 0.8;
        if (endDir != null) this.head(path.x[path.n - 1] + Math.cos(endDir) * len, path.y[path.n - 1] + Math.sin(endDir) * len, endDir, len, half);
        if (startDir != null) this.head(path.x[0] + Math.cos(startDir) * len, path.y[0] + Math.sin(startDir) * len, startDir, len, half);
        ctx.globalAlpha = 1;
        continue;
      }
      const hs = headSize(w), dir = path.k[path.n - 1] > 0.5 && (!stub || realB) ? cutEnd(path, hs.len) : null;
      this.ribbon(path, first.color, w, alpha);
      if (dir != null) { ctx.fillStyle = first.color; ctx.globalAlpha = alpha; this.head(path.x[path.n - 1] + Math.cos(dir) * hs.len, path.y[path.n - 1] + Math.sin(dir) * hs.len, dir, hs.len, hs.half); ctx.globalAlpha = 1; }
    }
    this.drawn = drawn;
  }
  private head(x: number, y: number, angle: number, len: number, half: number): void {
    const [x0, y0, x1, y1, x2, y2] = arrowHead(x, y, angle, len, half), ctx = this.ctx;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
  }
  /** A line of constant width, drawn in runs of equal visibility so it thins out toward the rim instead of stopping dead. */
  private strokeArc(p: ArcPath, color: string, width: number, dash: number[], alpha: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = dash.length ? 'butt' : 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash);
    const level = (i: number) => { const k = Math.min(p.k[i], p.k[i + 1]); return k <= 0 ? 0 : k >= 0.95 ? 4 : k >= 0.7 ? 3 : k >= 0.45 ? 2 : 1; };
    let i = 0;
    while (i < p.n - 1) {
      const lv = level(i);
      let j = i;
      while (j < p.n - 1 && level(j) === lv) j++;
      if (lv > 0) {
        ctx.globalAlpha = alpha * (lv === 4 ? 1 : lv === 3 ? 0.75 : lv === 2 ? 0.5 : 0.28);
        ctx.beginPath(); ctx.moveTo(p.x[i], p.y[i]);
        for (let k = i + 1; k <= j; k++) ctx.lineTo(p.x[k], p.y[k]);
        ctx.stroke();
      }
      i = j;
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  /** A flow: a band that starts at full width and narrows toward its arrowhead, so the direction reads before the head is seen. */
  private ribbon(p: ArcPath, color: string, width: number, alpha: number): void {
    const ctx = this.ctx, n = p.n;
    if (n < 2) return;
    if (width <= 1.6) { this.strokeArc(p, color, width, [], alpha); return; }
    const level = (i: number) => { const k = Math.min(p.k[i], p.k[i + 1]); return k <= 0 ? 0 : k >= 0.95 ? 4 : k >= 0.7 ? 3 : k >= 0.45 ? 2 : 1; };
    const halfAt = (i: number) => (width * (1 - 0.5 * (i / (n - 1)))) / 2;
    ctx.fillStyle = color;
    let i = 0;
    while (i < n - 1) {
      const lv = level(i);
      let j = i;
      while (j < n - 1 && level(j) === lv) j++;
      if (lv > 0) {
        ctx.globalAlpha = alpha * (lv === 4 ? 1 : lv === 3 ? 0.75 : lv === 2 ? 0.5 : 0.28);
        ctx.beginPath();
        for (let pass = 0; pass < 2; pass++) {
          for (let s = 0; s <= j - i; s++) {
            const k = pass === 0 ? i + s : j - s, a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
            const dx = p.x[b] - p.x[a], dy = p.y[b] - p.y[a], len = Math.hypot(dx, dy) || 1, hw = halfAt(k) * (pass === 0 ? 1 : -1);
            const x = p.x[k] - (dy / len) * hw, y = p.y[k] + (dx / len) * hw;
            if (pass === 0 && s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
        }
        ctx.closePath(); ctx.fill();
      }
      i = j;
    }
    ctx.globalAlpha = 1;
  }
  /** Dots travelling along the selected links, in the direction of the flow. Only while motion is allowed. */
  private drawFlow(pal: GlobePalette): void {
    if (this.reduced) return;
    const ctx = this.ctx, phase = (this.clock / 2600) % 1;
    for (const d of this.drawn) {
      if (!d.hot || d.group.arcs[0].plain) continue;
      const p = d.path, n = p.n;
      for (const off of [0, 1 / 3, 2 / 3]) {
        for (const back of d.group.arcs[0].twoWay ? [false, true] : [false]) {
          const t = (phase + off) % 1, f = (back ? 1 - t : t) * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
          const k = Math.min(p.k[i], p.k[i + 1]);
          if (k <= 0) continue;
          const x = p.x[i] + (p.x[i + 1] - p.x[i]) * u, y = p.y[i] + (p.y[i + 1] - p.y[i]) * u;
          ctx.globalAlpha = k;
          ctx.beginPath(); ctx.arc(x, y, Math.max(2.2, d.width * 0.5 + 0.8), 0, Math.PI * 2); ctx.fillStyle = pal.panel; ctx.fill();
          ctx.strokeStyle = d.group.arcs[0].color; ctx.lineWidth = 1.25; ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** One company: its logo on a plate ringed in the relation's colour, with the relation's shape on the corner; a plain marker when there is no logo. */
  private drawBadge(m: Mark, pal: GlobePalette): void {
    const ctx = this.ctx, p = m.members[0], picked = this.scene.selected === p.key, hot = this.hover === m.id, r = m.r, dpr = this.dpr;
    ctx.globalAlpha = p.faded && !picked && !hot ? 0.35 : 1;
    const size = Math.round(2 * r * dpr), tile = p.logo ? this.atlas.tile(p.logo, size) : null;
    const corner = Math.max(2, r * 0.34);
    if (tile) {
      /* whole device pixels, so the logo is copied, not resampled */
      const x = Math.round((m.x - r) * dpr) / dpr, y = Math.round((m.y - r) * dpr) / dpr, s = size / dpr;
      ctx.beginPath(); ctx.roundRect(x - 2.5, y - 2.5, s + 5, s + 5, corner + 2.5); ctx.fillStyle = pal.panel; ctx.fill();
      ctx.drawImage(tile.sheet, tile.sx, tile.sy, tile.size, tile.size, x, y, s, s);
      ctx.beginPath(); ctx.roundRect(x - 0.75, y - 0.75, s + 1.5, s + 1.5, corner + 0.75);
      ctx.strokeStyle = p.lead ? pal.ink : p.color; ctx.lineWidth = p.lead ? 2 : 1.5;
      if (p.approx) ctx.setLineDash([3, 2]);
      ctx.stroke(); ctx.setLineDash([]);
      if (!p.lead) {
        /* the relation's shape on the corner, so a logo still says what the company is to the focus */
        const gx = x + s - 0.5, gy = y + s - 0.5;
        shapePath(ctx, p.shape ?? 'circle', gx, gy, 3.4); ctx.fillStyle = p.color; ctx.fill(); ctx.strokeStyle = pal.panel; ctx.lineWidth = 1.5; ctx.stroke();
      }
    } else {
      const q = p.lead ? r * 0.8 : r * 0.62;
      shapePath(ctx, p.shape ?? 'circle', m.x, m.y, q + 2); ctx.fillStyle = pal.panel; ctx.fill();
      shapePath(ctx, p.shape ?? 'circle', m.x, m.y, q);
      if (p.approx) { ctx.fillStyle = pal.panel; ctx.fill(); ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke(); } else { ctx.fillStyle = p.color; ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (p.ring) { ctx.beginPath(); ctx.arc(m.x, m.y, r * 1.2 + 4, 0, Math.PI * 2); ctx.strokeStyle = p.ring; ctx.lineWidth = 1.75; ctx.stroke(); }
    if (picked || hot) { ctx.beginPath(); ctx.arc(m.x, m.y, r * 1.2 + (p.ring ? 7 : 4), 0, Math.PI * 2); ctx.strokeStyle = picked ? pal.accent : pal.ink2; ctx.lineWidth = picked ? 2 : 1.25; ctx.stroke(); }
  }

  /** Several names at one spot: a ring split by relation, the heaviest name's logo inside with how many more there are, or the count alone when that name has no mark of its own. */
  private drawCluster(m: Mark, pal: GlobePalette): void {
    const ctx = this.ctx, n = m.members.length, lead = m.members[0], hot = this.hover === m.id, r = m.r, dpr = this.dpr;
    const picked = m.members.some((p) => p.key === this.scene.selected), flagged = m.members.find((p) => p.ring)?.ring;
    ctx.globalAlpha = m.members.every((p) => p.faded) && !picked && !hot ? 0.35 : 1;
    ctx.beginPath(); ctx.arc(m.x, m.y, r + 2, 0, Math.PI * 2); ctx.fillStyle = pal.panel; ctx.fill();
    /* the ring: each relation's share, with a surface-coloured gap between segments */
    const slices = clusterSlices(m.members, 0.5), band = 3;
    ctx.lineWidth = band; ctx.lineCap = 'butt';
    for (const sl of slices) {
      const gap = slices.length > 1 ? 0.07 : 0;
      ctx.beginPath(); ctx.arc(m.x, m.y, r - band / 2, sl.a0 + gap, sl.a1 - gap); ctx.strokeStyle = sl.color; ctx.stroke();
    }
    /* the face is cut to a few sizes (steps of four device pixels) so the logo sheets stay few */
    const inner = r - band - 1.5, size = 4 * Math.round((inner * 1.5 * dpr) / 4), tile = lead.logo && lead.logoTrusted ? this.atlas.tile(lead.logo, size) : null;
    ctx.fillStyle = pal.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (tile) {
      const s = size / dpr, x = Math.round((m.x - s / 2) * dpr) / dpr, y = Math.round((m.y - s / 2) * dpr) / dpr;
      ctx.save(); ctx.beginPath(); ctx.arc(m.x, m.y, inner, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(tile.sheet, tile.sx, tile.sy, tile.size, tile.size, x, y, s, s);
      ctx.restore();
      /* how many more names stand here, on the ring's shoulder */
      const text = `+${n - 1}`;
      ctx.font = FONT.count;
      const tw = Math.max(15, ctx.measureText(text).width + 7), bx = m.x + r * 0.62, by = m.y - r * 0.62;
      ctx.beginPath(); ctx.roundRect(bx - tw / 2, by - 7.5, tw, 15, 7.5); ctx.fillStyle = pal.ink; ctx.fill(); ctx.strokeStyle = pal.panel; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = pal.panel; ctx.fillText(text, bx, by + 0.5);
    } else {
      ctx.font = FONT.count; ctx.fillText(String(n), m.x, m.y + 0.5);
    }
    ctx.globalAlpha = 1;
    if (flagged) { ctx.beginPath(); ctx.arc(m.x, m.y, r + 4.5, 0, Math.PI * 2); ctx.strokeStyle = flagged; ctx.lineWidth = 1.75; ctx.stroke(); }
    if (picked || hot) { ctx.beginPath(); ctx.arc(m.x, m.y, r + (flagged ? 7.5 : 4.5), 0, Math.PI * 2); ctx.strokeStyle = picked ? pal.accent : pal.ink2; ctx.lineWidth = picked ? 2 : 1.25; ctx.stroke(); }
  }

  /* ---------- pointer and keyboard ---------- */
  /** What is under a point of the frame: a badge or cluster first (with room to spare round small ones), then a rim count, then a link. */
  private hitAt(x: number, y: number): { id: string; hit: GlobeHit; mark?: Mark } | null {
    let best: Mark | null = null, bd = Infinity;
    for (const m of this.marks) {
      if (m.kind !== 'single' && m.kind !== 'cluster' && m.kind !== 'rim') continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= Math.max(m.r + 4, 13) && d - (m.kind === 'single' ? 2 : 0) < bd) { best = m; bd = d - (m.kind === 'single' ? 2 : 0); }
    }
    if (best) {
      const hit: GlobeHit = best.kind === 'rim' ? { kind: 'rim', points: best.members, x: best.x, y: best.y } : best.members.length === 1 ? { kind: 'point', point: best.members[0], x: best.x, y: best.y } : { kind: 'cluster', points: best.members, x: best.x, y: best.y };
      return { id: best.id, hit, mark: best };
    }
    let arc: DrawnArc | null = null, ad = Infinity;
    for (const d of this.drawn) { const dist = distanceToArc(d.path, x, y) - d.width / 2; if (dist <= 5 && dist < ad) { arc = d; ad = dist; } }
    if (arc && arc.points.length) return { id: `a:${arc.group.key}`, hit: arc.points.length === 1 ? { kind: 'point', point: arc.points[0], x, y } : { kind: 'arc', points: arc.points, x, y } };
    return null;
  }
  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  private setEngaged(on: boolean): void {
    if (!on) this.touchEngaged = false;
    /* an engaged map takes every touch; an idle one leaves one-finger panning to the page (and keeps pinches for itself) */
    this.canvas.style.touchAction = this.touchEngaged ? 'none' : 'pan-x pan-y';
    if (this.engaged === on) return;
    this.engaged = on;
    this.cb.onEngage?.(on);
  }
  private setHover(id: string | null, keys: string[]): void {
    if (id === this.hover) return;
    this.hover = id; this.hoverKeys = new Set(keys);
    this.invalidate();
  }
  /** A press that did not travel: pick what is under it. */
  private click(e: PointerEvent): void {
    const [x, y] = this.local(e), got = this.hitAt(x, y);
    if (!got) { const country = this.countryAt(x, y); if (country) this.cb.onCountry?.(country, 'pick', e.clientX, e.clientY); return; }
    const hit = got.hit;
    if (hit.kind === 'point') { this.cb.onPick(hit.point); return; }
    const places = hit.points.map((p) => [p.lon, p.lat] as LonLat);
    if (hit.kind === 'rim') { this.fit(places, { maxZoom: 6 }); this.cb.onMove(); return; }
    if (hit.kind === 'arc') { this.cb.onClusterMenu(hit.points, e.clientX, e.clientY); return; }
    /* a cluster: zoom in while that pulls it apart, list its names once it cannot */
    let spread = 0;
    for (let i = 1; i < places.length; i++) spread = Math.max(spread, angleBetween(places[0], places[i]));
    const target = fitCamera(places, { w: this.w, h: this.h }, this.flat, { pad: Math.min(this.w, this.h) * 0.28, minZoom: this.minZoom, maxZoom: this.maxZoom, single: this.cam.zoom });
    if (spread > 3e-5 && target.zoom > this.cam.zoom * 1.35) { this.flyTo(target); this.cb.onMove(); } else this.cb.onClusterMenu(hit.points, e.clientX, e.clientY);
  }

  private bind(): void {
    const el = this.canvas, wrap = el.parentElement ?? el;
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Document, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    const span = () => { const [a, b] = [...this.pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    el.style.touchAction = 'pan-x pan-y';

    on(el, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const touch = e.pointerType !== 'mouse';
      /* focus without letting the browser scroll the map into view */
      if (!touch) { e.preventDefault(); el.focus({ preventScroll: true }); }
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      const [x, y] = this.local(e);
      this.pointers.set(e.pointerId, { x, y });
      this.fly = null; this.spin = null; this.zoomAnim = null;
      this.cb.onHover(null, 0, 0);
      if (this.pointers.size === 2) {
        /* two fingers always zoom the map, holding the place between them */
        const s = span();
        this.pinch = { span: s.d, zoom: this.cam.zoom, place: unproject(this.view(), s.x, s.y) };
        if (this.gesture) this.gesture.moved = 99;
        return;
      }
      /* a mouse press takes hold of the wheel; a finger moves the map only once a tap has engaged it */
      const active = !touch || this.touchEngaged;
      this.gesture = { id: e.pointerId, x, y, moved: 0, time: performance.now(), place: active ? unproject(this.view(), x, y) : null, touch, active };
      this.trail = [{ t: performance.now(), lon: this.cam.lon, lat: this.cam.lat }];
      if (!touch) { this.setEngaged(true); el.style.cursor = 'grabbing'; }
    });
    on(el, 'pointermove', (e) => {
      const [x, y] = this.local(e);
      if (this.pointers.has(e.pointerId)) {
        this.pointers.set(e.pointerId, { x, y });
        if (this.pinch && this.pointers.size === 2) {
          const s = span();
          if (this.pinch.span > 0) this.applyZoom(clamp(this.pinch.zoom * (s.d / this.pinch.span), this.minZoom, this.maxZoom), this.pinch.place, s.x, s.y);
          this.schedule(); this.cb.onMove();
          return;
        }
        const g = this.gesture;
        if (!g || g.id !== e.pointerId) return;
        const dx = x - g.x, dy = y - g.y;
        g.moved += Math.abs(dx) + Math.abs(dy); g.x = x; g.y = y;
        if (!g.active || g.moved <= 4) return;
        /* the place that was grabbed stays under the pointer; where north-up makes that impossible, turn by the pointer's travel and grab anew */
        const R = this.scaleAt(this.cam.zoom), held = g.place ? anchorCentre(g.place, x - this.w / 2, y - this.h / 2, R, this.flat, this.cam.lon) : null;
        const want = held ?? { lon: this.cam.lon - (dx / R / RAD) / Math.max(0.25, Math.cos(this.cam.lat * RAD)), lat: this.cam.lat + dy / R / RAD };
        this.cam = this.clamped({ ...want, zoom: this.cam.zoom });
        if (!held || Math.abs(this.cam.lat - want.lat) > 1e-6) g.place = unproject(this.view(), x, y);
        const now = performance.now();
        this.trail.push({ t: now, lon: this.cam.lon, lat: this.cam.lat });
        while (this.trail.length > 2 && now - this.trail[0].t > 120) this.trail.shift();
        this.dirtyBase = this.dirtyTop = true; this.schedule(); this.cb.onMove();
        return;
      }
      if (e.pointerType !== 'mouse') return;
      const got = this.hitAt(x, y);
      this.setHover(got?.id ?? null, got ? (got.hit.kind === 'point' ? [got.hit.point.key] : got.hit.points.map((p) => p.key)) : []);
      const country = got ? null : this.countryAt(x, y);
      if (country !== this.overCountry) { const redraw = !!(this.tintOf(country) || this.tintOf(this.overCountry)); this.overCountry = country; if (redraw) this.invalidate(); }
      el.style.cursor = got || country ? 'pointer' : 'grab';
      this.cb.onHover(got?.hit ?? null, e.clientX, e.clientY);
      this.cb.onCountry?.(country, 'hover', e.clientX, e.clientY);
    });
    const release = (e: PointerEvent, cancelled: boolean) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; if (this.pointers.size === 0) this.gesture = null; return; }
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.gesture = null;
      el.style.cursor = 'grab';
      if (cancelled) return;
      if (g.moved <= 6 && performance.now() - g.time < 700) {
        /* a tap engages the map for one-finger panning until a press lands outside it */
        if (g.touch && !this.touchEngaged) { this.touchEngaged = true; this.setEngaged(true); }
        /* the second press of a double click belongs to the zoom: it does not pick (or un-pick) again */
        const now = performance.now(), again = !g.touch && now - this.lastTap.t < 400 && Math.hypot(g.x - this.lastTap.x, g.y - this.lastTap.y) < 6;
        this.lastTap = { t: now, x: g.x, y: g.y };
        if (!again) this.click(e);
        return;
      }
      if (!g.active || this.reduced) return;
      /* let go while moving: the map coasts on, slowing down */
      const now = performance.now(), first = this.trail[0], lastT = this.trail[this.trail.length - 1];
      const span2 = lastT.t - first.t;
      if (now - lastT.t < 60 && span2 > 16) {
        const v = { lon: lonDelta(first.lon, lastT.lon) / span2, lat: (lastT.lat - first.lat) / span2 };
        if (Math.hypot(v.lon, v.lat) * RAD * this.scaleAt(this.cam.zoom) > 0.08) { this.spin = v; this.schedule(); }
      }
    };
    on(el, 'pointerup', (e) => release(e, false));
    /* the browser took the gesture over (a swipe scrolls the page): drop it without treating it as a tap */
    on(el, 'pointercancel', (e) => release(e, true));
    const unhover = () => {
      if (this.hover || this.overCountry) { this.hover = null; this.hoverKeys = new Set(); this.overCountry = null; this.invalidate(); }
      this.cb.onHover(null, 0, 0); this.cb.onCountry?.(null, 'hover', 0, 0);
    };
    /* onto a control laid over the map: nothing on the map is under the pointer any more */
    on(el, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.gesture) unhover(); });
    on(wrap as HTMLElement, 'pointerleave', (e) => {
      unhover();
      /* moving the mouse away hands the wheel back to the page */
      if (e.pointerType === 'mouse' && !this.gesture) this.setEngaged(false);
    });
    /* a press anywhere else lets go of the map */
    on(document, 'pointerdown', (e) => { if (this.engaged && !(wrap as HTMLElement).contains(e.target as Node)) this.setEngaged(false); }, { capture: true });
    /* an engaged map, and any two-finger gesture, keeps the page from scrolling under it */
    on(el, 'touchmove', (e) => { if ((this.touchEngaged || e.touches.length > 1) && e.cancelable) e.preventDefault(); }, { passive: false });
    /* on the whole frame, the controls laid over the map included, so the wheel behaves the same wherever it is turned inside it */
    on(wrap as HTMLElement, 'wheel', (e) => {
      /* Ctrl or ⌘ + wheel (which is also what a trackpad pinch sends) always zooms; a plain wheel zooms only after a press on the map, and otherwise scrolls the page */
      const key = e.ctrlKey || e.metaKey;
      if (!key && !this.engaged) { this.cb.onWheelPassed?.(); return; }
      /* at a zoom limit the wheel is still ours: it never falls through to the page */
      e.preventDefault();
      const [x, y] = this.local(e), pinch = e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaY) < 40;
      const factor = pinch ? Math.exp(-e.deltaY * 0.011) : wheelFactor(wheelPixels(e.deltaY, e.deltaMode));
      const from = this.zoomAnim ? Math.exp(this.zoomAnim.target) : this.cam.zoom;
      this.zoomTo(from * factor, { x, y });
      this.cb.onMove();
    }, { passive: false });
    on(el, 'dblclick', (e) => { e.preventDefault(); const [x, y] = this.local(e); this.zoomTo(this.cam.zoom * (e.shiftKey ? 0.5 : 2), { x, y }); this.cb.onMove(); });
    on(el, 'keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const step = 64 / this.scaleAt(this.cam.zoom) / RAD, c = this.cam, cos = Math.max(0.25, Math.cos(c.lat * RAD));
      const moves: Record<string, () => void> = {
        ArrowLeft: () => this.flyTo({ ...c, lon: c.lon - step / cos }, 140), ArrowRight: () => this.flyTo({ ...c, lon: c.lon + step / cos }, 140),
        ArrowUp: () => this.flyTo({ ...c, lat: c.lat + step }, 140), ArrowDown: () => this.flyTo({ ...c, lat: c.lat - step }, 140),
        '+': () => this.zoomBy(1.6), '=': () => this.zoomBy(1.6), '-': () => this.zoomBy(1 / 1.6), _: () => this.zoomBy(1 / 1.6), '0': () => this.reset(), Home: () => this.reset(),
      };
      const move = moves[e.key];
      if (!move) return;
      e.preventDefault(); e.stopPropagation();
      move(); this.cb.onMove();
    });
  }
}
