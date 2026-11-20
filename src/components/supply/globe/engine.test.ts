import { describe, expect, it } from 'vitest';
import { clusterSlices } from './engine';

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
  it('keeps a lone member of another relation wide enough to carry its shape', () => {
    const members = [...Array.from({ length: 40 }, () => ({ color: 'c1', shape: 'circle' as const })), { color: 'c4', shape: 'triangle' as const }];
    const [, small] = clusterSlices(members, 0.62);
    expect(small.shape).toBe('triangle');
    expect(small.a1 - small.a0).toBeCloseTo(0.62);
  });
});
