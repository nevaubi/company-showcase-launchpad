import { describe, expect, it } from 'vitest';
import { OPENING_SETS } from './opening.fixture';
import { anchorCentre, OPEN_MAX_LAT, angleBetween, baseScale, clampCamera, deepestZoom, fitCamera, flight, lonDelta, makeView, MAX_LAT, miller, MILLER_MAX, millerInv, project, RAD, toLonLat, toVec, openingCamera, unproject, wheelFactor, wheelPixels, type Camera, type LonLat, type WeightedPlace } from './sphere';

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
    expect(wheelFactor(-100)).toBeCloseTo(1.25, 3);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1);
  });
  it('keeps every mouse notch between 1.25 and 1.3 times, so ten notches stay within fourteen times in', () => {
    /* review supply-globe-M2: notches of 120 and 150 px, as Chrome and Playwright send them */
    for (const px of [100, 120, 150, 200, 240]) {
      const f = wheelFactor(-wheelPixels(px, 0));
      expect(f).toBeGreaterThanOrEqual(1.25 - 1e-9);
      expect(f).toBeLessThanOrEqual(1.3 + 1e-9);
    }
    expect(wheelFactor(-wheelPixels(3, 1))).toBeLessThanOrEqual(1.3);
    expect(wheelFactor(-wheelPixels(1, 2))).toBeCloseTo(1.3, 6);
    expect(Math.pow(wheelFactor(-150), 10)).toBeLessThan(14);
    /* a trackpad step of 4 px is a small step, not a notch */
    expect(wheelFactor(-4)).toBeLessThan(1.01);
  });
});

describe('openingCamera', () => {
  const vp = { w: 1100, h: 580 };
  const facing = (c: Camera, [lon, lat]: LonLat) => Math.cos(angleBetween([c.lon, c.lat], [lon, lat]));
  const P = (lon: number, lat: number, w = 1, side = 'customer'): WeightedPlace => ({ lon, lat, w, side });
  /* NVIDIA as the review found it: head office in Santa Clara, customers across the United States, suppliers in Asia */
  const santaClara: LonLat = [-121.96, 37.35];
  const asia = [P(120.97, 24.8, 3, 's'), P(127.0, 37.26, 2, 's'), P(127.44, 37.27, 2, 's'), P(121.46, 25.01, 1, 's'), P(121.56, 25.03, 1, 's'), P(100.5, 13.75, 1, 's')];
  const us = [P(-122.12, 47.67, 2), P(-122.18, 37.48), P(-122.33, 47.6, 2), P(-122.08, 37.39), P(-97.68, 30.5), P(-95.4, 29.8), P(-87.9, 42.2), P(-71.1, 42.36), P(-74, 40.7), P(-73.6, 45.5), P(-80.2, 25.8), P(-84.4, 33.7)];
  /* and the far ones: Ubisoft in Paris, the Brazilian post office */
  const far = [P(2.35, 48.85), P(-47.9, -15.8)];

  it('turns NVIDIA so its Asian suppliers face the viewer, not the horizon, with the company still in view (review supply-globe-M1)', () => {
    const all = [...asia, ...us, ...far];
    const old = fitCamera([santaClara, ...all.map((p) => [p.lon, p.lat] as LonLat)], vp, false);
    /* the old framing: TSMC sat on the far horizon */
    expect(facing(old, [120.97, 24.8])).toBeLessThan(0.3);
    const cam = openingCamera(santaClara, all, vp, false);
    for (const p of asia.slice(0, 5)) expect(facing(cam, [p.lon, p.lat])).toBeGreaterThan(0.3);
    /* Fabrinet in Bangkok, the farthest west, is on the near side too */
    expect(facing(cam, [100.5, 13.75])).toBeGreaterThan(0);
    expect(facing(cam, santaClara)).toBeGreaterThanOrEqual(0.42);
    /* the centre lies over the Pacific, between the two sides */
    expect(cam.lon > 150 || cam.lon < -140).toBe(true);
    expect(cam.zoom).toBeGreaterThanOrEqual(1);
  });

  it('frames a company whose ties are all in North America as fitCamera does, zoomed in on the continent', () => {
    const cam = openingCamera(santaClara, us, vp, false);
    const fit = fitCamera([santaClara, ...us.map((p) => [p.lon, p.lat] as LonLat)], vp, false);
    expect(cam).toEqual(fit);
    expect(cam.zoom).toBeGreaterThan(1.5);
    for (const p of us) expect(facing(cam, [p.lon, p.lat])).toBeGreaterThan(0.6);
  });

  it('centres ties on both sides of the date line on the date line, not on the far side of the world', () => {
    const auckland: LonLat = [174.76, -36.85];
    const ties = [P(178.44, -18.14, 2), P(-171.77, -13.83), P(-157.86, 21.31), P(166.67, -22.27)];
    const cam = openingCamera(auckland, ties, vp, false);
    expect(Math.abs(lonDelta(180, cam.lon))).toBeLessThan(25);
    for (const p of [auckland, ...ties.map((t) => [t.lon, t.lat] as LonLat)]) expect(facing(cam, p)).toBeGreaterThan(0.6);
    expect(cam.zoom).toBeGreaterThan(1.2);
  });

  it('keeps the company inside the disc even when every tie lies on the other side of the world', () => {
    const cam = openingCamera(santaClara, [P(100.5, 13.75, 5), P(77.2, 28.6, 5), P(55.3, 25.2, 5)], vp, false);
    expect(facing(cam, santaClara)).toBeGreaterThanOrEqual(0.42);
  });

  describe('on the real placements of the preview kit (review p3-sup-L3)', () => {
    const kit = { w: 756, h: 540 }, opts = { pad: 65, minZoom: 0.8, maxZoom: 7 };
    const open = (t: string) => {
      const set = OPENING_SETS[t];
      const cam = openingCamera(set.focus, set.ties.map(([lon, lat, w, side]) => ({ lon, lat, w, side })), kit, false, opts);
      return { set, cam };
    };
    for (const t of ['NVDA', 'UTHR', 'ALGM', 'CRUS']) {
      it(`${t} opens at a latitude a reader knows, the company in view and no tie with an end behind the edge`, () => {
        const { set, cam } = open(t);
        expect(Math.abs(cam.lat)).toBeLessThanOrEqual(OPEN_MAX_LAT + 1);
        expect(facing(cam, set.focus)).toBeGreaterThanOrEqual(0.42);
        for (const [lon, lat] of set.ties) expect(facing(cam, [lon, lat])).toBeGreaterThanOrEqual(0.2);
      });
    }
    it('UTHR shows its tie in the United Kingdom and its customers in Japan, not the Arctic (it opened at 70 N)', () => {
      const { cam } = open('UTHR');
      expect(cam.lat).toBeLessThan(70);
      expect(facing(cam, [-3.28, 54.06])).toBeGreaterThan(0.2);
      expect(facing(cam, [137.32, 36.38])).toBeGreaterThan(0.2);
    });
    it('NVDA keeps Asia and the United States on the near side, centred over the North Pacific', () => {
      const { cam } = open('NVDA');
      expect(cam.lon > 150 || cam.lon < -140).toBe(true);
      expect(facing(cam, [120.97, 24.8])).toBeGreaterThan(0.3);
    });
  });

  it('frames ties across the date line from the date line (Seattle with Asian suppliers and an Australian customer)', () => {
    const seattle: LonLat = [-122.33, 47.61];
    /* real places: Hsinchu, Seoul, Tokyo, Sydney */
    const ties = [P(120.97, 24.8, 2, 's'), P(126.98, 37.57, 1, 's'), P(139.69, 35.69, 1, 's'), P(151.21, -33.87, 1, 'c')];
    const cam = openingCamera(seattle, ties, vp, false);
    expect(Math.abs(lonDelta(180, cam.lon))).toBeLessThan(40);
    expect(Math.abs(cam.lat)).toBeLessThanOrEqual(OPEN_MAX_LAT);
    for (const p of ties) expect(facing(cam, [p.lon, p.lat])).toBeGreaterThanOrEqual(0.2);
    expect(facing(cam, seattle)).toBeGreaterThanOrEqual(0.42);
  });

  it('leaves the flat map to fitCamera, which shows the whole set', () => {
    const all = [...asia, ...us];
    expect(openingCamera(santaClara, all, vp, true)).toEqual(fitCamera([santaClara, ...all.map((p) => [p.lon, p.lat] as LonLat)], vp, true));
  });
});
