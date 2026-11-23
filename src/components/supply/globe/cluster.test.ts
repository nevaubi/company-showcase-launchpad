import { describe, expect, it } from 'vitest';
import { badgeRadius, clusterRadius, clusterSlices, clusterSpots, fanOffsets, rimGroups, type Spot } from './cluster';

const spot = (key: string, x: number, y: number, weight = 0, lead = false): Spot<string> => ({ x, y, r: badgeRadius(weight, lead), weight, lead, item: key });

describe('clusterSlices', () => {
  it('gives each relation in a cluster its own slice and shape, largest first, filling the circle', () => {
    const members = [
      ...Array.from({ length: 9 }, () => ({ color: 'c1', shape: 'circle' as const })),
      { color: 'c2', shape: 'square' as const },
      { color: 'c3', shape: 'diamond' as const },
    ];
    const s = clusterSlices(members);
    expect(s.map((x) => [x.shape, x.count])).toEqual([['circle', 9], ['diamond', 1], ['square', 1]]);
    expect(s[0].a0).toBeCloseTo(-Math.PI / 2);
    expect(s[s.length - 1].a1).toBeCloseTo(-Math.PI / 2 + Math.PI * 2);
    for (let i = 1; i < s.length; i++) expect(s[i].a0).toBeCloseTo(s[i - 1].a1);
  });
  it('keeps a lone member of another relation wide enough to be seen', () => {
    const members = [...Array.from({ length: 40 }, () => ({ color: 'c1', shape: 'circle' as const })), { color: 'c4', shape: 'triangle' as const }];
    const [, small] = clusterSlices(members, 0.62);
    expect(small.shape).toBe('triangle');
    expect(small.a1 - small.a0).toBeCloseTo(0.62);
  });
});

describe('badge sizes', () => {
  it('grow with exposure in whole pixels, and the company the map is about is largest', () => {
    expect(badgeRadius(0)).toBe(10);
    expect(badgeRadius(0.5)).toBe(12);
    expect(badgeRadius(1)).toBe(14);
    expect(badgeRadius(7)).toBe(14);
    expect(badgeRadius(0.2, true)).toBe(16);
    expect(clusterRadius(2)).toBeGreaterThan(badgeRadius(1));
    expect(clusterRadius(400)).toBe(23);
  });
});

describe('clusterSpots', () => {
  it('leaves badges that do not touch alone and folds the ones that would cover each other', () => {
    const out = clusterSpots([spot('a', 100, 100), spot('b', 105, 104), spot('c', 300, 100), spot('d', 300, 140)]);
    expect(out.map((c) => c.members.map((m) => m.item).sort())).toEqual([['a', 'b'], ['c'], ['d']]);
    /* no two markers overlap afterwards */
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y)).toBeGreaterThanOrEqual(out[i].r + out[j].r);
  });
  it('anchors a cluster on its heaviest name, and on the company when it is there', () => {
    const [byWeight] = clusterSpots([spot('light', 100, 100, 0.1), spot('heavy', 110, 100, 0.9)]);
    expect([byWeight.x, byWeight.y]).toEqual([110, 100]);
    expect(byWeight.members[0].item).toBe('heavy');
    const [withLead] = clusterSpots([spot('heavy', 110, 100, 0.9), spot('focus', 100, 100, 0.2, true), spot('x', 104, 108, 0.5)]);
    expect([withLead.x, withLead.y]).toEqual([100, 100]);
    expect(withLead.members.map((m) => m.item)).toEqual(['focus', 'heavy', 'x']);
  });
  it('folds clusters whose rings grow into each other, and separates everything it returns', () => {
    const pts: Spot<string>[] = [];
    for (let i = 0; i < 60; i++) pts.push(spot(`p${i}`, 200 + (i % 10) * 9, 200 + Math.floor(i / 10) * 9, (i % 7) / 7));
    pts.push(spot('far', 600, 400));
    const out = clusterSpots(pts);
    expect(out.reduce((s, c) => s + c.members.length, 0)).toBe(61);
    expect(out.some((c) => c.members.length === 1 && c.members[0].item === 'far')).toBe(true);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y)).toBeGreaterThanOrEqual(out[i].r + out[j].r);
  });
});

describe('fanOffsets', () => {
  it('opens a cluster so that no two badges overlap and none sits on the true place', () => {
    for (const n of [2, 3, 5, 8, 9, 16, 28]) {
      const d = 23, { at, reach } = fanOffsets(n, d);
      expect(at).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(Math.hypot(at[i][0], at[i][1])).toBeGreaterThanOrEqual(d * 0.9);
        expect(Math.hypot(at[i][0], at[i][1]) + d / 2).toBeLessThanOrEqual(reach + 1e-9);
        for (let j = i + 1; j < n; j++) expect(Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1])).toBeGreaterThanOrEqual(d + 1);
      }
    }
    expect(fanOffsets(0, 23)).toEqual({ at: [], reach: 0 });
  });
});

describe('rimGroups', () => {
  it('pins names behind the globe on the rim in the direction they lie, largest group first', () => {
    const groups = rimGroups([
      { vx: 0.6, vy: 0.05, item: 'east-1' }, { vx: 0.5, vy: -0.02, item: 'east-2' }, { vx: 0.9, vy: 0.1, item: 'east-3' },
      { vx: 0, vy: 0.7, item: 'north' }, { vx: 0, vy: 0, item: 'antipode' },
    ]);
    expect(groups.map((g) => g.items)).toEqual([['east-1', 'east-2', 'east-3'], ['north']]);
    expect(Math.abs(groups[0].angle)).toBeLessThan(0.2);
    /* north is up on screen: a negative screen angle */
    expect(groups[1].angle).toBeCloseTo(-Math.PI / 2);
  });
  it('keeps the two sides of due west together', () => {
    const groups = rimGroups([{ vx: -0.8, vy: 0.01, item: 'a' }, { vx: -0.8, vy: -0.01, item: 'b' }]);
    expect(groups).toHaveLength(1);
    expect(Math.abs(groups[0].angle)).toBeCloseTo(Math.PI, 1);
  });
});
