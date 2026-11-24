// The map under the links (sea, land, tinted countries, shores, borders), drawn into any 2D context: the page's own
// canvas, or an OffscreenCanvas in `hi-geo.worker.ts` so that a zoom never traces the coasts on the page's thread.
// No DOM lookups and no app imports: the same call gives the same picture in both places.
import { polygonsByName, traceFlat, traceGlobe, traceGraticule, type PackedGeo } from './geometry';
import { baseScale, clamp, type View } from './sphere';

export interface MapPalette { ocean: string; land: string; border: string; coast: string; grid: string; rim: string }
export interface MapFill { name: string; color: string; alpha: number; outline?: boolean }
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const byName = new WeakMap<PackedGeo, Map<string, number[]>>();
/** The polygons of one country in a packed map, by world-atlas name. */
export const polysOf = (geo: PackedGeo, name: string): number[] | undefined => {
  let m = byName.get(geo);
  if (!m) { m = polygonsByName(geo); byName.set(geo, m); }
  return m.get(name);
};

/** How strongly the tints show at a scale: fully while several countries are in view, fading out as one fills the frame. */
export const tintEase = (view: View): number => clamp(1 - (view.R / baseScale({ w: view.w, h: view.h }, view.flat) - 1.6) / 4.4, 0, 1);

export function paintMap(ctx: Ctx2D, geo: PackedGeo, view: View, dpr: number, pal: MapPalette, fills: readonly MapFill[]): void {
  const { w, h, cx, cy, R, flat } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  /* flat sea, no glow or shading: the land and the links carry the picture */
  ctx.fillStyle = pal.ocean;
  if (flat) ctx.fillRect(0, 0, w, h); else { ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); }
  /* a quiet grid: every 30 degrees from afar, every 10 closer in, none once a country fills the frame */
  const step = R < 420 ? 30 : R < 2600 ? 10 : 0;
  if (step) { const grid = new Path2D(); traceGraticule(view, step, grid); ctx.strokeStyle = pal.grid; ctx.lineWidth = 0.5; ctx.stroke(grid); }
  const trace = flat ? traceFlat : traceGlobe;
  const land = new Path2D(), coast = new Path2D(), border = new Path2D();
  trace(geo, view, { fill: land, coast, border });
  ctx.fillStyle = pal.land; ctx.fill(land, 'evenodd');
  /* the tint says where the ties are while several countries are in view; once one country fills the frame it would
     only make that country's land read as water, so it fades out as the map closes in (a picked country keeps it) */
  const ease = tintEase(view);
  for (const f of fills) {
    if (ease <= 0 && !f.outline) continue;
    const polys = polysOf(geo, f.name);
    if (!polys) continue;
    const shape = new Path2D();
    trace(geo, view, { fill: shape, coast: null, border: null }, polys);
    ctx.globalAlpha = f.alpha * (f.outline ? Math.max(ease, 0.5) : ease);
    ctx.fillStyle = f.color; ctx.fill(shape, 'evenodd');
    if (f.outline) { ctx.globalAlpha = 0.9; ctx.strokeStyle = f.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke(shape); }
  }
  ctx.globalAlpha = 1;
  /* hairlines: exactly one device pixel wide at every zoom and pixel ratio, which is also the width browsers stroke
     fastest (a wider line with round joins took six times as long as everything else in the frame together) */
  ctx.lineJoin = 'bevel'; ctx.lineCap = 'butt';
  const hair = 0.999 / dpr;
  ctx.strokeStyle = pal.coast; ctx.lineWidth = hair; ctx.stroke(coast);
  ctx.strokeStyle = pal.border; ctx.lineWidth = hair; ctx.stroke(border);
  if (!flat) { ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = pal.rim; ctx.lineWidth = 1; ctx.stroke(); }
}
