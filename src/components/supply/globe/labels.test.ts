import { describe, expect, it } from 'vitest';
import { labelSpot, markerBox, placeLabels, type Box, type LabelAsk } from './labels';

const FRAME = { w: 400, h: 300 };
const ask = (p: Partial<LabelAsk> & { id: string }): LabelAsk => ({ w: 60, h: 13, x: 200, y: 150, r: 10, priority: 1, ...p });
const hits = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const boxOf = (p: { left: number; top: number; w: number; h: number }): Box => ({ x: p.left, y: p.top, w: p.w, h: p.h });

describe('label placement', () => {
  it('writes a name to the right of its marker when there is room, clear of the marker', () => {
    const [p] = placeLabels([ask({ id: 'a' })], [markerBox(200, 150, 10)], FRAME);
    expect(p.side).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(200 + 10 + 3);
    expect(hits(boxOf(p), markerBox(200, 150, 10))).toBe(false);
  });
  it('moves to another side rather than cover a neighbour, and leaves a name out when no side is free', () => {
    const wall: Box[] = [markerBox(200, 150, 10), { x: 214, y: 100, w: 150, h: 100 }];
    expect(placeLabels([ask({ id: 'a' })], wall, FRAME)[0].side).toBe('left');
    const boxedIn: Box[] = [{ x: 60, y: 60, w: 280, h: 180 }];
    expect(placeLabels([ask({ id: 'a' })], boxedIn, FRAME)).toHaveLength(0);
  });
  it('gives the spot to the higher priority and never lets two names overlap', () => {
    const asks = [
      ask({ id: 'low', x: 200, y: 150, priority: 1 }), ask({ id: 'high', x: 200, y: 166, priority: 9 }),
      ask({ id: 'mid', x: 215, y: 158, priority: 5 }), ask({ id: 'other', x: 190, y: 140, priority: 2 }),
    ];
    const obstacles = asks.map((a) => markerBox(a.x, a.y, a.r));
    const placed = placeLabels(asks, obstacles, FRAME);
    expect(placed[0].id).toBe('high');
    for (let i = 0; i < placed.length; i++) {
      for (const o of obstacles) expect(hits(boxOf(placed[i]), o)).toBe(false);
      for (let j = i + 1; j < placed.length; j++) expect(hits(boxOf(placed[i]), boxOf(placed[j]))).toBe(false);
    }
  });
  it('keeps names inside the frame', () => {
    const placed = placeLabels([ask({ id: 'edge', x: 392, y: 8 })], [], FRAME);
    expect(placed).toHaveLength(1);
    expect(placed[0].left + placed[0].w).toBeLessThanOrEqual(FRAME.w - 2);
    expect(placed[0].top).toBeGreaterThanOrEqual(2);
  });
  it('centres an area name and drops it when something is in the way', () => {
    const area = ask({ id: 'country', area: true, r: 0, w: 80 });
    const [p] = placeLabels([area], [], FRAME);
    expect(p.side).toBe('centre');
    expect(p.left).toBeCloseTo(160); expect(p.top).toBeCloseTo(143.5);
    expect(placeLabels([area], [markerBox(200, 150, 8)], FRAME)).toHaveLength(0);
  });
  it('keeps a name on the side it had last frame while that side is free', () => {
    const before = new Map([['a', 'below' as const]]);
    expect(placeLabels([ask({ id: 'a' })], [markerBox(200, 150, 10)], FRAME, before)[0].side).toBe('below');
    /* the old side is taken now: it moves, starting again from the usual order */
    const blocked: Box[] = [markerBox(200, 150, 10), { x: 150, y: 160, w: 100, h: 30 }];
    expect(placeLabels([ask({ id: 'a' })], blocked, FRAME, before)[0].side).toBe('right');
  });
  it('places a name on every side at the stated clearance', () => {
    expect(labelSpot('right', 100, 100, 10, 40, 12)).toEqual([114, 94]);
    expect(labelSpot('left', 100, 100, 10, 40, 12)).toEqual([46, 94]);
    expect(labelSpot('below', 100, 100, 10, 40, 12)).toEqual([80, 113]);
    expect(labelSpot('above', 100, 100, 10, 40, 12)).toEqual([80, 75]);
  });
});
