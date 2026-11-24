import { describe, expect, it } from 'vitest';
import { afterFrame, reuseBase } from './loop';

describe('afterFrame', () => {
  it('publishes the view while a selected link keeps the loop running for its dots', () => {
    /* the round 3 defect: with a link selected the loop never came to rest, so data-view froze after a drag */
    expect(afterFrame({ showing: true, animating: false, flowing: true })).toEqual({ again: true, settle: false, publish: true });
  });
  it('holds the view back while the camera is still on its way', () => {
    expect(afterFrame({ showing: true, animating: true, flowing: true })).toEqual({ again: true, settle: false, publish: false });
    expect(afterFrame({ showing: true, animating: true, flowing: false })).toEqual({ again: true, settle: false, publish: false });
  });
  it('stops and publishes when nothing moves', () => {
    expect(afterFrame({ showing: true, animating: false, flowing: false })).toEqual({ again: false, settle: false, publish: true });
  });
  it('ends a motion at once when the map is out of view, instead of leaving it at its first step', () => {
    expect(afterFrame({ showing: false, animating: true, flowing: false })).toEqual({ again: false, settle: true, publish: true });
    expect(afterFrame({ showing: false, animating: false, flowing: false })).toEqual({ again: false, settle: false, publish: true });
  });
});

describe('reuseBase', () => {
  const zooming = { zooming: true, stale: false, whole: false };
  it('scales the last map while a zoom gesture is within 1.15 times of it, and traces past that', () => {
    expect(reuseBase({ ...zooming, ratio: 1 })).toBe(true);
    expect(reuseBase({ ...zooming, ratio: 1.14 })).toBe(true);
    expect(reuseBase({ ...zooming, ratio: 1.15 })).toBe(false);
    expect(reuseBase({ ...zooming, ratio: 1.6 })).toBe(false);
  });
  it('always traces once the gesture rests, so the map is sharp again on the next frame', () => {
    expect(reuseBase({ ...zooming, zooming: false, ratio: 1.01 })).toBe(false);
  });
  it('traces when the theme, tints or map data changed, whatever the zoom', () => {
    expect(reuseBase({ ...zooming, stale: true, ratio: 1.01 })).toBe(false);
  });
  it('zooming out reuses only a whole picture, so no empty band appears at the edge', () => {
    expect(reuseBase({ ...zooming, ratio: 0.92 })).toBe(false);
    expect(reuseBase({ ...zooming, whole: true, ratio: 0.92 })).toBe(true);
    expect(reuseBase({ ...zooming, whole: true, ratio: 0.85 })).toBe(false);
  });
  it('never reuses a picture of no size', () => {
    expect(reuseBase({ ...zooming, ratio: 0 })).toBe(false);
    expect(reuseBase({ ...zooming, ratio: Number.NaN })).toBe(false);
  });
});
