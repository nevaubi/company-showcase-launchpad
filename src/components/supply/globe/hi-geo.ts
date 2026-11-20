// The 1:10m borders and coastlines for the zoomed-in globe, prepared into flat typed arrays so the work
// (parsing about 3 MB of TopoJSON, stitching arcs, measuring bounding caps) can run in a worker and the
// result can cross to the page without copying. No React and no app imports.
import { geoDistance } from 'd3';
import type { Polygon, Position } from 'geojson';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

const RAD = Math.PI / 180;

/** Polygons and line runs as typed arrays. caps: [lon, lat, radius in radians] per shape. */
export interface HiPacked {
  polys: { caps: Float64Array; rings: Int32Array; ringStart: Int32Array; coords: Float64Array };
  borders: { caps: Float64Array; start: Int32Array; coords: Float64Array };
  coast: { caps: Float64Array; start: Int32Array; coords: Float64Array };
}

/** A spherical cap that contains a run of points: lets the renderer skip everything outside the view. */
export function capOf(pts: Position[]): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (const [lon, lat] of pts) { const cp = Math.cos(lat * RAD); x += cp * Math.cos(lon * RAD); y += cp * Math.sin(lon * RAD); z += Math.sin(lat * RAD); }
  const c: [number, number] = [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
  let r = 0;
  for (const p of pts) r = Math.max(r, geoDistance(c, p as [number, number]));
  return [c[0], c[1], r + 0.002];
}

/** Long lines are cut into short runs so a coastline is not drawn whole when only a bay is in view. */
function packLines(lines: Position[][], size = 48): HiPacked['borders'] {
  const caps: number[] = [], start: number[] = [0], coords: number[] = [];
  for (const line of lines) for (let i = 0; i < line.length - 1; i += size) {
    const run = line.slice(i, i + size + 1);
    caps.push(...capOf(run));
    for (const [lon, lat] of run) coords.push(lon, lat);
    start.push(coords.length / 2);
  }
  return { caps: Float64Array.from(caps), start: Int32Array.from(start), coords: Float64Array.from(coords) };
}

export function packHi(topo: Topology): HiPacked {
  const obj = topo.objects.countries as GeometryCollection;
  const caps: number[] = [], rings: number[] = [0], ringStart: number[] = [0], coords: number[] = [];
  for (const f of feature(topo, obj).features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
      caps.push(...capOf(poly[0]));
      for (const ring of poly) {
        for (const [lon, lat] of ring) coords.push(lon, lat);
        ringStart.push(coords.length / 2);
      }
      rings.push(ringStart.length - 1);
    }
  }
  return {
    polys: { caps: Float64Array.from(caps), rings: Int32Array.from(rings), ringStart: Int32Array.from(ringStart), coords: Float64Array.from(coords) },
    borders: packLines(mesh(topo, obj, (a, b) => a !== b).coordinates),
    coast: packLines(mesh(topo, obj, (a, b) => a === b).coordinates),
  };
}

/** The buffers a packed set holds, for a zero-copy postMessage. */
export const transferables = (p: HiPacked): ArrayBuffer[] =>
  [p.polys.caps, p.polys.rings, p.polys.ringStart, p.polys.coords, p.borders.caps, p.borders.start, p.borders.coords, p.coast.caps, p.coast.start, p.coast.coords].map((a) => a.buffer as ArrayBuffer);

const points = (coords: Float64Array, from: number, to: number): Position[] => {
  const out: Position[] = new Array(to - from);
  for (let i = from; i < to; i++) out[i - from] = [coords[2 * i], coords[2 * i + 1]];
  return out;
};

/** Read access to a packed set; GeoJSON objects are built only for shapes that come into view, then kept. */
export class HiGeo {
  private polyCache: (Polygon | undefined)[];
  private lineCache: { borders: (Position[] | undefined)[]; coast: (Position[] | undefined)[] };
  readonly polyCount: number;
  constructor(readonly p: HiPacked) {
    this.polyCount = p.polys.caps.length / 3;
    this.polyCache = new Array(this.polyCount);
    this.lineCache = { borders: new Array(p.borders.caps.length / 3), coast: new Array(p.coast.caps.length / 3) };
  }
  lineCount(set: 'borders' | 'coast'): number { return this.p[set].caps.length / 3; }
  /** True when shape i's cap can reach the view (centre and reach in radians). */
  near(kind: 'polys' | 'borders' | 'coast', i: number, centre: [number, number], reach: number): boolean {
    const c = this.p[kind].caps;
    return geoDistance([c[3 * i], c[3 * i + 1]], centre) <= reach + c[3 * i + 2];
  }
  poly(i: number): Polygon {
    const got = this.polyCache[i];
    if (got) return got;
    const { rings, ringStart, coords } = this.p.polys;
    const coordinates: Position[][] = [];
    for (let r = rings[i]; r < rings[i + 1]; r++) coordinates.push(points(coords, ringStart[r], ringStart[r + 1]));
    return (this.polyCache[i] = { type: 'Polygon', coordinates });
  }
  line(set: 'borders' | 'coast', i: number): Position[] {
    const cache = this.lineCache[set], got = cache[i];
    if (got) return got;
    const { start, coords } = this.p[set];
    return (cache[i] = points(coords, start[i], start[i + 1]));
  }
}
