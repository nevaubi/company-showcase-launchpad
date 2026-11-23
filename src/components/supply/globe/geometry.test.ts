import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import world110 from 'world-atlas/countries-110m.json';
import { feature } from 'topojson-client';
import type { GeometryCollection } from 'topojson-specification';
import { arcImportance, DETAIL_PX, EDGE_BORDER, EDGE_COAST, EDGE_NONE, flatOf, LOD, packTopology, pickRes, polygonsByName, traceFlat, traceGlobe, traceGraticule, transferables, type PathSink } from './geometry';
import { makeView, MILLER_MAX, toVec } from './sphere';

const topo = world110 as unknown as Topology;
const geo = packTopology(topo, 110);
const byName = polygonsByName(geo);
const VP = { w: 800, h: 600 };

/** A path sink that records what was drawn. */
function recorder() {
  const ops: { op: 'M' | 'L' | 'A' | 'Z'; x: number; y: number }[] = [];
  const sink: PathSink = {
    moveTo: (x, y) => { ops.push({ op: 'M', x, y }); },
    lineTo: (x, y) => { ops.push({ op: 'L', x, y }); },
    arc: (x, y) => { ops.push({ op: 'A', x, y }); },
    closePath: () => { ops.push({ op: 'Z', x: 0, y: 0 }); },
  };
  return { ops, sink, count: (op: string) => ops.filter((o) => o.op === op).length };
}

describe('packed map', () => {
  it('keeps every ring once, without its closing point, and names the countries', () => {
    const nr = geo.ringStart.length - 1, np = geo.polyRing.length - 1;
    expect(geo.ringStart[nr]).toBe(geo.imp.length);
    expect(geo.xyz.length).toBe(geo.imp.length * 3);
    expect(geo.polyRing[np]).toBe(nr);
    expect(np).toBe(285);
    /* ring for ring and point for point what topojson-client stitches, minus each ring's repeated closing point */
    const rings = feature(topo, topo.objects.countries as GeometryCollection).features.flatMap((f) =>
      (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : []).flat());
    expect(rings).toHaveLength(nr);
    for (let r = 0; r < nr; r++) {
      const a = geo.ringStart[r], n = geo.ringStart[r + 1] - a;
      expect(n).toBe(rings[r].length - 1);
      for (const k of [0, Math.floor(n / 2), n - 1]) {
        const [lon, lat] = rings[r][k], v = toVec(lon, lat);
        for (let c = 0; c < 3; c++) expect(geo.xyz[3 * (a + k) + c]).toBeCloseTo(v[c], 6);
      }
    }
    expect(byName.get('United States of America')?.length).toBeGreaterThanOrEqual(2);
    expect(byName.has('Japan')).toBe(true);
    for (let i = 0; i < geo.xyz.length; i += 3) expect(Math.hypot(geo.xyz[i], geo.xyz[i + 1], geo.xyz[i + 2])).toBeCloseTo(1, 5);
  });
  it('draws each border once: every border edge has one ring that strokes it and one that does not', () => {
    let coast = 0, owner = 0, other = 0;
    for (const f of geo.flag) { if (f === EDGE_COAST) coast++; else if (f === EDGE_BORDER) owner++; else if (f === EDGE_NONE) other++; }
    expect(owner).toBeGreaterThan(1000);
    expect(owner).toBe(other);
    expect(coast).toBeGreaterThan(owner);
  });
  it('bounds each polygon with a cap that contains its outline', () => {
    for (const p of [0, 40, 120, 284]) {
      const r = geo.polyRing[p], cos = Math.cos(geo.polyCap[4 * p + 3]);
      for (let i = geo.ringStart[r]; i < geo.ringStart[r + 1]; i++) {
        const dot = geo.xyz[3 * i] * geo.polyCap[4 * p] + geo.xyz[3 * i + 1] * geo.polyCap[4 * p + 1] + geo.xyz[3 * i + 2] * geo.polyCap[4 * p + 2];
        expect(dot).toBeGreaterThanOrEqual(cos - 1e-6);
      }
    }
  });
  it('hands its buffers over without copying', () => {
    const bufs = transferables(geo);
    expect(bufs).toHaveLength(7);
    for (const b of bufs) expect(b).toBeInstanceOf(ArrayBuffer);
  });
});

describe('importance of a vertex', () => {
  const line = (pts: [number, number][]) => pts.flatMap(([lon, lat]) => toVec(lon, lat));
  it('is next to nothing on a straight run, the height of a spike, and never above its parent', () => {
    /* points along a great circle sit off the chord only by its sagitta: 3 degrees of arc bulge 0.00034 of a radius */
    const straight = arcImportance(line([[0, 0], [1, 0], [2, 0], [3, 0]]), 4);
    expect(straight[0]).toBe(Infinity); expect(straight[3]).toBe(Infinity);
    expect(straight[1]).toBeLessThan(4e-4); expect(straight[2]).toBeLessThan(4e-4);
    const spike = arcImportance(line([[0, 0], [1, 0.1], [2, 1], [3, 0.1], [4, 0]]), 5);
    expect(spike[2]).toBeCloseTo(Math.PI / 180, 3);
    expect(spike[1]).toBeLessThanOrEqual(spike[2]); expect(spike[3]).toBeLessThanOrEqual(spike[2]);
    expect(spike[1]).toBeGreaterThan(0);
  });
  it('keeps the joints between arcs at any scale, so neighbours drop the same points of a shared border', () => {
    /* at a coarse scale, every vertex kept on a border edge that one ring strokes is also kept by the ring across it */
    const thr = DETAIL_PX / 200, kept = new Set<string>(), key = (i: number) => `${geo.xyz[3 * i]},${geo.xyz[3 * i + 1]},${geo.xyz[3 * i + 2]}`;
    for (let i = 0; i < geo.imp.length; i++) if (geo.imp[i] >= thr && geo.flag[i] === EDGE_NONE) kept.add(key(i));
    let checked = 0;
    for (let r = 0; r < geo.ringStart.length - 1; r++) {
      /* interior vertices of a stroked border: both their edges are borders this ring draws */
      for (let i = geo.ringStart[r] + 1; i < geo.ringStart[r + 1]; i++) {
        if (geo.imp[i] < thr || geo.imp[i] === Infinity || geo.flag[i] !== EDGE_BORDER || geo.flag[i - 1] !== EDGE_BORDER) continue;
        checked++;
        expect(kept.has(key(i))).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('level of detail', () => {
  const brazil = byName.get('Brazil') as number[];
  it('keeps more points the closer the map is, and the same points whichever way the globe is turned', () => {
    const count = (cam: { lon: number; lat: number; zoom: number }) => traceGlobe(geo, makeView(cam, VP, false), { fill: recorder().sink, coast: null, border: null }, brazil);
    const far = count({ lon: -52, lat: -10, zoom: 0.5 }), mid = count({ lon: -52, lat: -10, zoom: 1.5 }), near = count({ lon: -52, lat: -10, zoom: 2.5 });
    expect(far).toBeGreaterThan(8);
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeGreaterThanOrEqual(mid);
    /* same scale, camera turned 25 degrees: the outline is made of exactly the same points */
    expect(count({ lon: -77, lat: 5, zoom: 0.5 })).toBe(far);
  });
  it('switches to the finer map before the coarser one looks coarse, and waits for it to arrive', () => {
    expect(pickRes(300, { 50: false, 10: false })).toBe(110);
    expect(pickRes(300, { 50: true, 10: true })).toBe(50);
    expect(pickRes(LOD.use10 - 1, { 50: true, 10: true })).toBe(50);
    expect(pickRes(LOD.use10, { 50: true, 10: true })).toBe(10);
    expect(pickRes(LOD.use10 + 500, { 50: true, 10: false })).toBe(50);
    /* the detailed map is fetched well before it is drawn */
    expect(LOD.fetch10).toBeLessThan(LOD.use10 / 2);
  });
});

describe('tracing onto the globe', () => {
  const australia = byName.get('Australia') as number[];
  it('draws a country that faces the viewer as closed rings with no limb arc', () => {
    const fill = recorder(), coast = recorder();
    traceGlobe(geo, makeView({ lon: 134, lat: -25, zoom: 1 }, VP, false), { fill: fill.sink, coast: coast.sink, border: null }, australia);
    expect(fill.count('A')).toBe(0);
    expect(fill.count('Z')).toBe(fill.count('M'));
    expect(fill.count('M')).toBeGreaterThanOrEqual(1);
    /* an island continent: its whole outline is shore */
    expect(coast.count('L')).toBeGreaterThan(20);
  });
  it('draws nothing for a country on the far side', () => {
    const fill = recorder(), coast = recorder();
    traceGlobe(geo, makeView({ lon: -46, lat: 25, zoom: 1 }, VP, false), { fill: fill.sink, coast: coast.sink, border: null }, australia);
    expect(fill.ops).toHaveLength(0);
    expect(coast.ops).toHaveLength(0);
  });
  it('cuts a country at the horizon and closes it along the limb, never drawing past the disc', () => {
    /* from here the west coast is 70 degrees away and the east coast is over the horizon */
    const view = makeView({ lon: 34, lat: -25, zoom: 1 }, VP, false), fill = recorder(), coast = recorder();
    traceGlobe(geo, view, { fill: fill.sink, coast: coast.sink, border: null }, australia);
    expect(fill.count('A')).toBeGreaterThanOrEqual(1);
    expect(fill.count('Z')).toBeGreaterThanOrEqual(1);
    for (const o of [...fill.ops, ...coast.ops]) if (o.op === 'M' || o.op === 'L') expect(Math.hypot(o.x - view.cx, o.y - view.cy)).toBeLessThanOrEqual(view.R + 1e-6);
    /* the shore is not drawn along the limb: far fewer shore points than with the whole country in view */
    const whole = recorder();
    traceGlobe(geo, makeView({ lon: 134, lat: -25, zoom: 1 }, VP, false), { fill: null, coast: whole.sink, border: null }, australia);
    expect(coast.count('L')).toBeLessThan(whole.count('L'));
    expect(coast.count('L')).toBeGreaterThan(0);
  });
  it('skips what the frame cannot see when zoomed in', () => {
    const all = recorder(), view = makeView({ lon: -100, lat: 40, zoom: 8 }, VP, false);
    const kept = traceGlobe(geo, view, { fill: all.sink, coast: null, border: null });
    const whole = traceGlobe(geo, makeView({ lon: -100, lat: 40, zoom: 1 }, VP, false), { fill: recorder().sink, coast: null, border: null });
    expect(kept).toBeLessThan(whole / 2);
    expect(kept).toBeGreaterThan(0);
  });
  it('draws the grid on the near side only', () => {
    const view = makeView({ lon: 10, lat: 20, zoom: 1 }, VP, false), grid = recorder();
    traceGraticule(view, 30, grid.sink);
    expect(grid.count('L')).toBeGreaterThan(100);
    for (const o of grid.ops) expect(Math.hypot(o.x - view.cx, o.y - view.cy)).toBeLessThanOrEqual(view.R + 1e-6);
  });
});

describe('tracing onto the flat map', () => {
  it('closes the ring round the South Pole along the bottom edge of the map', () => {
    const antarctica = byName.get('Antarctica') as number[], flat = flatOf(geo);
    const polar = antarctica.flatMap((p) => { const out: number[] = []; for (let r = geo.polyRing[p]; r < geo.polyRing[p + 1]; r++) if (flat.polar[r] !== 0) out.push(r); return out; });
    expect(polar).toHaveLength(1);
    expect(flat.polar[polar[0]]).toBe(-1);
    expect(flat.box[4 * polar[0] + 1] - flat.box[4 * polar[0]]).toBeCloseTo(2 * Math.PI, 5);
    const view = makeView({ lon: 0, lat: -60, zoom: 1 }, VP, true), fill = recorder(), coast = recorder();
    traceFlat(geo, view, { fill: fill.sink, coast: coast.sink, border: null }, antarctica);
    const bottom = view.cy + view.R * (view.my0 + MILLER_MAX);
    expect(Math.max(...fill.ops.filter((o) => o.op !== 'Z').map((o) => o.y))).toBeGreaterThan(bottom);
    /* the shore itself never runs along that edge */
    expect(Math.max(...coast.ops.map((o) => o.y))).toBeLessThanOrEqual(bottom);
  });
  it('draws a country that crosses the date line in one piece, wherever the map is centred', () => {
    const russia = byName.get('Russia') as number[];
    for (const lon of [0, 100, 180, -150]) {
      const view = makeView({ lon, lat: 55, zoom: 1 }, VP, true), fill = recorder();
      traceFlat(geo, view, { fill: fill.sink, coast: null, border: null }, russia);
      expect(fill.count('M')).toBeGreaterThanOrEqual(1);
      let prev: { x: number; y: number } | null = null, jump = 0;
      for (const o of fill.ops) { if (o.op === 'M') prev = o; else if (o.op === 'L' && prev) { jump = Math.max(jump, Math.abs(o.x - prev.x)); prev = o; } }
      /* no edge leaps across the map */
      expect(jump).toBeLessThan(view.R * Math.PI * 0.5);
    }
  });
  it('repeats the world sideways so the frame is always covered', () => {
    const usa = byName.get('United States of America') as number[];
    /* centred on the date line, zoomed out: the same country is in view on both sides only if a second copy is drawn */
    const wide = { w: 1600, h: 400 }, view = makeView({ lon: 60, lat: 40, zoom: 1 }, wide, true), fill = recorder();
    traceFlat(geo, view, { fill: fill.sink, coast: null, border: null }, usa);
    const xs = fill.ops.filter((o) => o.op === 'M').map((o) => o.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(view.R * Math.PI);
  });
});
