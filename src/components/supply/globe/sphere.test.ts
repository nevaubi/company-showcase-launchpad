import { describe, expect, it } from 'vitest';
import { anchorCentre, angleBetween, baseScale, clampCamera, deepestZoom, fitCamera, flight, makeView, MAX_LAT, miller, MILLER_MAX, millerInv, project, RAD, toLonLat, toVec, unproject, wheelFactor, wheelPixels, type Camera, type LonLat } from './sphere';

const VP = { w: 774, h: 580 };
const SANTA_CLARA: LonLat = [-121.955, 37.354], TAIPEI: LonLat = [121.5, 25.0], BOSTON: LonLat = [-71.06, 42.36];

describe('projection', () => {
  it('puts the camera centre in the middle of the frame, east to the right and north up', () => {
    const view = makeView({ lon: -100, lat: 40, zoom: 1 }, VP, false);
    const c = project(view, -100, 40);
    expect(c.x).toBeCloseTo(387); expect(c.y).toBeCloseTo(290); expect(c.z).toBeCloseTo(1);
    expect(project(view, -90, 40).x).toBeGreaterThan(c.x);
    expect(project(view, -100, 50).y).toBeLessThan(c.y);
    expect(project(view, 80, -40).z).toBeCloseTo(-1);
  });
  it('goes back from a pixel to the place, on the globe and on the flat map', () => {
    for (const flat of [false, true]) {
      const view = makeView({ lon: -95, lat: 35, zoom: 2.4 }, VP, flat);
      for (const place of [SANTA_CLARA, BOSTON, [-99.1, 19.4] as LonLat]) {
        const p = project(view, place[0], place[1]), back = unproject(view, p.x, p.y) as LonLat;
        expect(back[0]).toBeCloseTo(place[0], 6); expect(back[1]).toBeCloseTo(place[1], 6);
      }
    }
    expect(unproject(makeView({ lon: 0, lat: 0, zoom: 1 }, VP, false), 2, 2)).toBeNull();
  });
  it('Miller map: inverse matches, the world is twice MILLER_MAX tall and zoom 1 covers the frame', () => {
    for (const lat of [-80, -33, 0, 37.4, 64]) expect(millerInv(miller(lat * RAD)) / RAD).toBeCloseTo(lat, 9);
    expect(MILLER_MAX).toBeCloseTo(2.3034, 3);
    const s = baseScale(VP, true);
    expect(s * 2 * Math.PI).toBeGreaterThanOrEqual(VP.w - 1e-9);
    expect(s * 2 * MILLER_MAX).toBeGreaterThanOrEqual(VP.h - 1e-9);
  });
  it('vector helpers agree with great-circle distances', () => {
    expect(angleBetween([0, 0], [90, 0])).toBeCloseTo(Math.PI / 2);
    expect(angleBetween(SANTA_CLARA, TAIPEI) * 6371).toBeGreaterThan(10_300);
    expect(angleBetween(SANTA_CLARA, TAIPEI) * 6371).toBeLessThan(10_500);
    const back = toLonLat(toVec(BOSTON[0], BOSTON[1]));
    expect(back[0]).toBeCloseTo(BOSTON[0]); expect(back[1]).toBeCloseTo(BOSTON[1]);
  });
});

describe('zoom and drag hold the place under the pointer', () => {
  it('finds the camera that puts a place at a given offset from the middle', () => {
    for (const [cam, place] of [[{ lon: -100, lat: 30, zoom: 3 }, SANTA_CLARA], [{ lon: 110, lat: 10, zoom: 1.4 }, TAIPEI], [{ lon: -60, lat: 55, zoom: 5 }, BOSTON]] as [Camera, LonLat][]) {
      const view = makeView(cam, VP, false), p = project(view, place[0], place[1]);
      const c = anchorCentre(place, p.x - view.cx, p.y - view.cy, view.R, false, cam.lon);
      expect(c).not.toBeNull();
      expect(c!.lon).toBeCloseTo(cam.lon, 6); expect(c!.lat).toBeCloseTo(cam.lat, 6);
    }
  });
  it('keeps the pointed-at place fixed on screen while zooming in toward it', () => {
    const cam: Camera = { lon: -100, lat: 38, zoom: 1.2 }, pointer = { x: 180, y: 240 };
    const place = unproject(makeView(cam, VP, false), pointer.x, pointer.y) as LonLat;
    for (const zoom of [1.5, 2.6, 6, 14]) {
      const R = baseScale(VP, false) * zoom;
      const c = anchorCentre(place, pointer.x - VP.w / 2, pointer.y - VP.h / 2, R, false, cam.lon)!;
      const at = project(makeView({ ...c, zoom }, VP, false), place[0], place[1]);
      expect(at.x).toBeCloseTo(pointer.x, 4); expect(at.y).toBeCloseTo(pointer.y, 4);
    }
  });
  it('does the same on the flat map', () => {
    const cam: Camera = { lon: -40, lat: 20, zoom: 1.5 }, pointer = { x: 610, y: 150 };
    const place = unproject(makeView(cam, VP, true), pointer.x, pointer.y) as LonLat;
    const R = baseScale(VP, true) * 4, c = anchorCentre(place, pointer.x - VP.w / 2, pointer.y - VP.h / 2, R, true)!;
    const at = project(makeView({ ...c, zoom: 4 }, VP, true), place[0], place[1]);
    expect(at.x).toBeCloseTo(pointer.x, 4); expect(at.y).toBeCloseTo(pointer.y, 4);
  });
  it('says so when north-up makes the offset impossible, instead of jumping', () => {
    /* a place at 80 degrees north cannot be dragged far sideways: its parallel is a small circle */
    expect(anchorCentre([0, 80], 200, 0, 261, false, 0)).toBeNull();
    /* beyond the rim of the disc */
    expect(anchorCentre(SANTA_CLARA, 300, 0, 261, false, -100)).toBeNull();
  });
});

describe('camera limits', () => {
  it('keeps the globe off the poles and the flat map inside its top and bottom edges', () => {
    expect(clampCamera({ lon: 200, lat: 89, zoom: 500 }, VP, false, 0.9, 60)).toEqual({ lon: -160, lat: MAX_LAT, zoom: 60 });
    const c = clampCamera({ lon: 0, lat: 85, zoom: 2 }, VP, true, 1, 60), view = makeView(c, VP, true);
    /* the top edge of the frame is not above the top of the world */
    expect(unproject(view, VP.w / 2, 0)).not.toBeNull();
    expect(unproject(view, VP.w / 2, -3)).toBeNull();
  });
  it('offers a deeper zoom only as far as the closest pair of places needs', () => {
    /* Santa Clara, Palo Alto and Fremont: the closest two are 18 km apart and end up 96 px apart */
    const valley: LonLat[] = [[-121.955, 37.354], [-122.14, 37.44], [-121.99, 37.55]];
    const z = deepestZoom(valley, VP, false);
    expect(angleBetween(valley[1], valley[2]) * baseScale(VP, false) * z).toBeCloseTo(96, 3);
    expect(z).toBeGreaterThan(100); expect(z).toBeLessThan(160);
    /* two offices a few hundred metres apart would need more than any map here can carry: capped */
    expect(deepestZoom([[-121.955, 37.354], [-121.953, 37.355]], VP, false)).toBe(400);
    expect(deepestZoom([SANTA_CLARA, TAIPEI], VP, false)).toBe(14);
    expect(deepestZoom([SANTA_CLARA, SANTA_CLARA], VP, false)).toBe(14);
  });
});

describe('framing', () => {
  it('takes in every place with room to spare, on both projections', () => {
    const places: LonLat[] = [SANTA_CLARA, BOSTON, [-95.4, 30.1], [-87.9, 42.2]];
    for (const flat of [false, true]) {
      const cam = fitCamera(places, VP, flat, { pad: 56 }), view = makeView(cam, VP, flat);
      for (const p of places) {
        const s = project(view, p[0], p[1]);
        expect(s.z).toBeGreaterThan(0);
        expect(s.x).toBeGreaterThanOrEqual(55.9); expect(s.x).toBeLessThanOrEqual(VP.w - 55.9);
        expect(s.y).toBeGreaterThanOrEqual(55.9); expect(s.y).toBeLessThanOrEqual(VP.h - 55.9);
      }
      expect(cam.zoom).toBeGreaterThan(1.5);
    }
  });
  it('shows the whole disc, centred on the company, when the places span more than a hemisphere', () => {
    const cam = fitCamera([SANTA_CLARA, TAIPEI, [8.5, 47.4], [-46.6, -23.5], [151.2, -33.9]], VP, false);
    expect(cam.zoom).toBe(1);
  });
  it('frames a single place at a modest close-up rather than the deepest zoom', () => {
    expect(fitCamera([SANTA_CLARA], VP, false, { single: 5 }).zoom).toBe(5);
    expect(fitCamera([SANTA_CLARA, SANTA_CLARA], VP, true, { single: 5 }).zoom).toBe(5);
    expect(fitCamera([], VP, false).zoom).toBe(1);
  });
  it('takes the flat map the short way round the Pacific', () => {
    const cam = fitCamera([SANTA_CLARA, TAIPEI], VP, true);
    /* centred near the date line, not on the Atlantic */
    expect(Math.abs(cam.lon)).toBeGreaterThan(150);
  });
});

describe('flights and wheel', () => {
  it('starts and ends exactly on the two views and pulls back on a long hop between close-ups', () => {
    const from: Camera = { lon: -121.9, lat: 37.3, zoom: 12 }, to: Camera = { lon: 121.5, lat: 25, zoom: 12 };
    const f = flight(from, to, false);
    expect(f.at(0)).toEqual(expect.objectContaining({ zoom: expect.closeTo(12, 6) }));
    expect(f.at(1).lon).toBeCloseTo(121.5, 6); expect(f.at(1).lat).toBeCloseTo(25, 6);
    expect(f.at(0.5).zoom).toBeLessThan(2);
    expect(f.ms).toBeGreaterThan(800); expect(f.ms).toBeLessThanOrEqual(1300);
    /* a short hop does not pull back */
    const near = flight({ lon: -121.9, lat: 37.3, zoom: 12 }, { lon: -122.1, lat: 37.4, zoom: 12 }, false);
    expect(near.at(0.5).zoom).toBeCloseTo(12, 1);
    expect(near.ms).toBeLessThan(500);
  });
  it('turns the short way across the date line', () => {
    const f = flight({ lon: 170, lat: 0, zoom: 2 }, { lon: -170, lat: 0, zoom: 2 }, true);
    const mid = f.at(0.5).lon;
    expect(Math.abs(mid)).toBeCloseTo(180, 4);
  });
  it('reads wheel travel the same in pixels, lines and pages, and caps one notch', () => {
    expect(wheelPixels(100, 0)).toBe(100);
    expect(wheelPixels(3, 1)).toBe(54);
    expect(wheelPixels(1, 2)).toBe(240);
    expect(wheelPixels(-4000, 0)).toBe(-240);
    expect(wheelFactor(-100)).toBeCloseTo(1.197, 2);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1);
  });
});
