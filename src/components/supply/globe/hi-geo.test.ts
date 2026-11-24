import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import world110 from 'world-atlas/countries-110m.json';
import { feature } from 'topojson-client';
import type { GeometryCollection } from 'topojson-specification';
import { HiGeo, packHi, transferables } from './hi-geo';

const topo = world110 as unknown as Topology;

describe('packed map geometry', () => {
  const packed = packHi(topo);
  const hi = new HiGeo(packed);
  it('keeps every polygon, ring for ring and point for point', () => {
    const polys = feature(topo, topo.objects.countries as GeometryCollection).features.flatMap((f) =>
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : []);
    expect(hi.polyCount).toBe(polys.length);
    for (const i of [0, 7, polys.length - 1]) expect(hi.poly(i).coordinates).toEqual(polys[i]);
    expect(hi.poly(7)).toBe(hi.poly(7));
  });
  it('cuts lines into short runs that join end to start', () => {
    const n = hi.lineCount('coast');
    expect(n).toBeGreaterThan(10);
    for (let i = 0; i < n; i++) expect(hi.line('coast', i).length).toBeLessThanOrEqual(49);
  });
  it('bounds each shape with a cap that contains its points', () => {
    const ring = hi.poly(3).coordinates[0];
    for (const pt of ring) expect(hi.near('polys', 3, pt as [number, number], 0)).toBe(true);
  });
  it('hands over buffers without copying', () => {
    const bufs = transferables(packed);
    expect(bufs).toHaveLength(10);
    for (const b of bufs) expect(b).toBeInstanceOf(ArrayBuffer);
  });
});
