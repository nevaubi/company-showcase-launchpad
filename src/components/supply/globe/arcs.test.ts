import { describe, expect, it } from 'vitest';
import { arcLift, arcSegments, arrowHead, bundleArcs, cutEnd, cutStart, distanceToArc, flowWidth, headSize, newArcPath, sampleArc, stubArc, trimArc, type ArcPath } from './arcs';
import { makeView, project, toVec } from './sphere';

const VP = { w: 800, h: 600 };
const SANTA_CLARA = toVec(-121.955, 37.354), TAIPEI = toVec(121.5, 25), BOSTON = toVec(-71.06, 42.36);
const line = (pts: [number, number][]): ArcPath => { const p = newArcPath(16); p.n = pts.length; pts.forEach(([x, y], i) => { p.x[i] = x; p.y[i] = y; p.k[i] = 1; }); return p; };

describe('arc shape', () => {
  it('lifts a long hop well clear of the globe and a short one hardly at all', () => {
    expect(arcLift(0.01)).toBeLessThan(0.02);
    expect(arcLift(1.6)).toBeGreaterThan(0.1);
    expect(arcLift(Math.PI)).toBeLessThanOrEqual(0.23);
    expect(arcSegments(40)).toBe(11);
    expect(arcSegments(5000)).toBe(56);
  });
  it('starts and ends on the two places and rises above the surface in between', () => {
    const view = makeView({ lon: -97, lat: 40, zoom: 2 }, VP, false), path = newArcPath();
    sampleArc(view, SANTA_CLARA, BOSTON, 0.1, 0, 24, path);
    const a = project(view, -121.955, 37.354), b = project(view, -71.06, 42.36);
    expect(path.n).toBe(25);
    expect(path.x[0]).toBeCloseTo(a.x, 6); expect(path.y[0]).toBeCloseTo(a.y, 6);
    expect(path.x[24]).toBeCloseTo(b.x, 6); expect(path.y[24]).toBeCloseTo(b.y, 6);
    /* the middle is pushed away from the centre of the disc compared with the unlifted great circle */
    const flatPath = newArcPath();
    sampleArc(view, SANTA_CLARA, BOSTON, 0, 0, 24, flatPath);
    expect(Math.hypot(path.x[12] - view.cx, path.y[12] - view.cy)).toBeGreaterThan(Math.hypot(flatPath.x[12] - view.cx, flatPath.y[12] - view.cy));
    for (let i = 0; i < path.n; i++) expect(path.k[i]).toBe(1);
  });
  it('fades toward the rim, leaves a trace beyond it and is gone behind the globe', () => {
    /* looking at the Americas: Taipei is behind the globe */
    const view = makeView({ lon: -100, lat: 35, zoom: 1 }, VP, false), path = newArcPath();
    sampleArc(view, SANTA_CLARA, TAIPEI, arcLift(1.7), 0, 40, path);
    expect(path.k[0]).toBe(1);
    expect(path.k[40]).toBe(0);
    const ks = Array.from(path.k.slice(0, 41));
    expect(ks.some((k) => k > 0 && k < 1)).toBe(true);
    /* once hidden it stays hidden: no piece reappears beyond the horizon */
    const firstGone = ks.findIndex((k) => k === 0);
    expect(ks.slice(firstGone).every((k) => k === 0)).toBe(true);
  });
  it('on the flat map joins the two markers as drawn and bows upward', () => {
    const view = makeView({ lon: -97, lat: 38, zoom: 3 }, VP, true), path = newArcPath();
    sampleArc(view, SANTA_CLARA, BOSTON, 0, 0, 20, path);
    const a = project(view, -121.955, 37.354), b = project(view, -71.06, 42.36);
    expect(path.x[0]).toBeCloseTo(a.x, 6); expect(path.x[20]).toBeCloseTo(b.x, 6);
    expect(path.y[10]).toBeLessThan(Math.min(a.y, b.y));
    /* the same curve whichever way the link runs */
    const back = newArcPath();
    sampleArc(view, BOSTON, SANTA_CLARA, 0, 0, 20, back);
    expect(back.y[10]).toBeCloseTo(path.y[10], 6);
  });
  it('runs links that share both ends side by side', () => {
    const view = makeView({ lon: -97, lat: 40, zoom: 2 }, VP, false), a = newArcPath(), b = newArcPath();
    sampleArc(view, SANTA_CLARA, BOSTON, 0.05, 5, 24, a);
    sampleArc(view, SANTA_CLARA, BOSTON, 0.05, -5, 24, b);
    expect(Math.hypot(a.x[12] - b.x[12], a.y[12] - b.y[12])).toBeCloseTo(10, 5);
    expect(a.x[0]).toBeCloseTo(b.x[0], 9); expect(a.x[24]).toBeCloseTo(b.x[24], 9);
  });
});

describe('ends and arrowheads', () => {
  it('stops at the edge of each marker', () => {
    const p = line([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0], [60, 0]]);
    expect(trimArc(p, 14, 12)).toBe(true);
    expect(p.x[0]).toBeCloseTo(14); expect(p.x[p.n - 1]).toBeCloseTo(48);
    expect(Array.from(p.x.slice(0, p.n))).toEqual([14, 20, 30, 40, 48]);
  });
  it('draws nothing between two markers that almost touch', () => {
    expect(trimArc(line([[0, 0], [10, 0], [20, 0], [30, 0]]), 14, 14)).toBe(false);
    expect(trimArc(line([[0, 0]]), 1, 1)).toBe(false);
  });
  it('makes room for the head and reports the direction of travel', () => {
    const p = line([[0, 0], [10, 0], [20, 0], [20, 10]]);
    expect(cutEnd(p, 4)).toBeCloseTo(Math.PI / 2);
    expect([p.x[p.n - 1], p.y[p.n - 1]]).toEqual([20, 6]);
    const q = line([[0, 0], [10, 0], [20, 0]]);
    expect(cutStart(q, 12)).toBeCloseTo(Math.PI);
    expect([q.x[0], q.y[0], q.n]).toEqual([12, 0, 2]);
    expect(cutEnd(line([[0, 0], [3, 0]]), 10)).toBeNull();
  });
  it('cuts a link that leaves the frame to a stub that fades out, from whichever end is in view', () => {
    const p = line([[0, 0], [30, 0], [60, 0], [90, 0], [300, 0]]);
    stubArc(p, 72, true);
    expect(Array.from(p.x.slice(0, p.n))).toEqual([0, 30, 60, 72]);
    expect(p.k[0]).toBe(1);
    expect(p.k[1]).toBeCloseTo(1 - 0.8 * (30 / 72));
    expect(p.k[p.n - 1]).toBeCloseTo(0.2);
    for (let i = 1; i < p.n; i++) expect(p.k[i]).toBeLessThan(p.k[i - 1]);
    /* from the far end: the stub is the last 72 px, faint where it starts and full where it meets the badge */
    const q = line([[0, 0], [200, 0], [270, 0], [300, 0]]);
    stubArc(q, 72, false);
    expect(Array.from(q.x.slice(0, q.n))).toEqual([228, 270, 300]);
    expect(q.k[0]).toBeCloseTo(0.2);
    expect(q.k[q.n - 1]).toBe(1);
    /* a link shorter than the stub is left whole, only faded */
    const short = line([[0, 0], [20, 0], [40, 0]]);
    stubArc(short, 72, true);
    expect(short.n).toBe(3);
    expect(short.x[2]).toBe(40);
  });
  it('sizes the head from the line width and points it along the line', () => {
    expect(headSize(1.25).len).toBeGreaterThan(7);
    expect(headSize(6).half).toBeLessThan(8);
    const [tx, ty, lx, ly, rx, ry] = arrowHead(100, 50, 0, 10, 4);
    expect([tx, ty]).toEqual([100, 50]);
    expect([lx, ly]).toEqual([90, 54]); expect([rx, ry]).toEqual([90, 46]);
  });
});

describe('width and bundles', () => {
  it('scales width by the square root of the stated figure, as the Network bands do', () => {
    expect(flowWidth(0, 100)).toBe(1.25);
    expect(flowWidth(100, 100)).toBe(6);
    expect(flowWidth(25, 100)).toBeCloseTo(1.25 + 4.75 * 0.5);
    expect(flowWidth(5, 0)).toBe(1.25);
    /* a bundle may add up past the largest single link, but not without limit */
    expect(flowWidth(1000, 100)).toBeCloseTo(1.25 + 4.75 * Math.sqrt(1.6));
  });
  it('draws links that end in the same two markers as one, keeps different kinds apart and gives them lanes', () => {
    const markOf = (k: string) => ({ focus: 'F', a: 'C1', b: 'C1', c: 'C1', d: 'D', gone: null as string | null })[k] ?? null;
    const arcs = [
      { id: '1', from: 'a', to: 'focus', style: 'supplier' }, { id: '2', from: 'b', to: 'focus', style: 'supplier' },
      { id: '3', from: 'focus', to: 'c', style: 'customer' }, { id: '4', from: 'focus', to: 'd', style: 'customer' },
      { id: '5', from: 'a', to: 'b', style: 'supplier' }, { id: '6', from: 'gone', to: 'focus', style: 'supplier' },
    ];
    const groups = bundleArcs(arcs, markOf);
    expect(groups.map((g) => [g.from, g.to, g.style, g.arcs.map((a) => a.id).join('')])).toEqual([['C1', 'F', 'supplier', '12'], ['F', 'C1', 'customer', '3'], ['F', 'D', 'customer', '4']]);
    /* the two bundles between C1 and F take opposite sides of the line between them; the lone one stays on it */
    const [s, c, lone] = groups;
    expect(lone.lane).toBe(0);
    expect(Math.abs(s.lane)).toBe(0.5);
    /* lanes are sides of the undirected line, so opposite directions get the same sign for opposite lanes */
    expect(s.lane).toBe(c.lane);
  });
  it('measures how far a point is from a link, ignoring the part behind the globe', () => {
    const p = line([[0, 0], [100, 0], [200, 0]]);
    expect(distanceToArc(p, 50, 7)).toBeCloseTo(7);
    expect(distanceToArc(p, 230, 40)).toBeCloseTo(50);
    p.k[1] = 0; p.k[2] = 0;
    expect(distanceToArc(p, 150, 3)).toBeCloseTo(Math.hypot(50, 3));
  });
});
