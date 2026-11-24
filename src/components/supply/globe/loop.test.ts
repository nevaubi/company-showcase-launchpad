import { describe, expect, it } from 'vitest';
import { adoptPicture, afterFrame, BEYOND, covers, pictureZoom, reuseBase } from './loop';

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

describe('worker pictures for a zoom', () => {
  it('a picture fills the frame when scaled up or when it holds the whole disc', () => {
    expect(covers(400, 500, false)).toBe(true);
    expect(covers(400, 400, false)).toBe(true);
    expect(covers(400, 300, false)).toBe(false);
    expect(covers(400, 300, true)).toBe(true);
  });
  it('takes a new picture that fills the frame, and keeps a sharper one that does until the camera reaches the new one', () => {
    /* zoom in: the target picture (R 800) waits while the camera is at 500; at 800 it is taken */
    expect(adoptPicture({ R: 400, whole: false }, { R: 800, whole: false }, 500)).toBe(false);
    expect(adoptPicture({ R: 400, whole: false }, { R: 800, whole: false }, 800)).toBe(true);
    /* zoom out: the shown picture leaves a band; a picture beyond the target fills it */
    expect(adoptPicture({ R: 800, whole: false }, { R: 300, whole: false }, 500)).toBe(true);
    /* nothing fills the frame: the newer, closer one is still better than a band */
    expect(adoptPicture({ R: 800, whole: false }, { R: 600, whole: false }, 500)).toBe(true);
  });
  it('asks for the target of a zoom in and for a picture beyond the target of a zoom out', () => {
    expect(pictureZoom(2, 3, 0.8)).toBe(3);
    expect(pictureZoom(3, 2, 0.8)).toBeCloseTo(2 / BEYOND);
    expect(pictureZoom(1, 0.9, 0.8)).toBe(0.8);
    expect(pictureZoom(2, null, 0.8)).toBe(2);
  });
});
