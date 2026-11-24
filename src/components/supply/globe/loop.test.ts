import { describe, expect, it } from 'vitest';
import { afterFrame } from './loop';

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
