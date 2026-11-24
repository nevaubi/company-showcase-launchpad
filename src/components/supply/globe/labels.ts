// Label placement for the supply-chain globe: which names are written, and where, so that none lands on a marker,
// on a control laid over the map or on another name. Pure geometry (no canvas), unit-tested.
//
// Names are asked for with a priority; the highest goes first and takes the first free spot next to its marker
// (right, left, below, above, then the four corners). A name that finds no free spot is left out: the hover card and
// the jump list still give it. A name keeps the side it had in the previous frame when that side is still free, so
// names do not hop from side to side while the map moves.

export interface Box { x: number; y: number; w: number; h: number }
export type LabelSide = 'right' | 'left' | 'below' | 'above' | 'ne' | 'se' | 'sw' | 'nw' | 'centre' | 'up1' | 'down1' | 'up2' | 'down2';

export interface LabelAsk {
  id: string;
  /** text size in px, as measured by the caller */
  w: number; h: number;
  /** the marker the name belongs to, or the middle of the area it names */
  x: number; y: number;
  /** clearance from the anchor: the marker's radius including its rings. For an area name: how far (px) the name may sit above or below the middle of the area, 0 to keep it there */
  r: number;
  /** higher goes first */
  priority: number;
  /** a marker's name goes beside it; an area's name is centred on it */
  area?: boolean;
}
export interface PlacedLabel { id: string; left: number; top: number; w: number; h: number; side: LabelSide }

const SIDES: LabelSide[] = ['right', 'left', 'below', 'above', 'se', 'ne', 'sw', 'nw'];
/** An area's name: on its middle, else one or two lines above or below it (`r` is how far it may stray, 0 keeps it on the middle). */
const AREA_SIDES: LabelSide[] = ['centre', 'up1', 'down1', 'up2', 'down2'];
const AREA_SHIFT: Partial<Record<LabelSide, number>> = { centre: 0, up1: -1, down1: 1, up2: -2, down2: 2 };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Top-left corner of a name of size w x h on one side of a marker of radius r at (x, y). */
export function labelSpot(side: LabelSide, x: number, y: number, r: number, w: number, h: number, gap = 4): [number, number] {
  const d = r + gap, k = r * 0.71 + gap * 0.6;
  switch (side) {
    case 'right': return [x + d, y - h / 2];
    case 'left': return [x - d - w, y - h / 2];
    case 'below': return [x - w / 2, y + d - 1];
    case 'above': return [x - w / 2, y - d - h + 1];
    case 'se': return [x + k, y + k - 2];
    case 'ne': return [x + k, y - k - h + 2];
    case 'sw': return [x - k - w, y + k - 2];
    case 'nw': return [x - k - w, y - k - h + 2];
    default: return [x - w / 2, y - h / 2 + (AREA_SHIFT[side] ?? 0) * (h + 5)];
  }
}

/**
 * Place as many names as fit. `obstacles` are boxes no name may touch (markers with their rings, controls over the map);
 * `frame` is the drawing area; `previous` maps a label id to the side it had last time. Returns the placed names in
 * priority order.
 */
export function placeLabels(asks: LabelAsk[], obstacles: Box[], frame: { w: number; h: number }, previous?: ReadonlyMap<string, LabelSide>, pad = 2): PlacedLabel[] {
  const taken: Box[] = obstacles.slice(), out: PlacedLabel[] = [];
  const order = asks.map((a, i) => [a, i] as const).sort((p, q) => q[0].priority - p[0].priority || p[1] - q[1]);
  for (const [a] of order) {
    /* an area name strays from the middle only as far as the area reaches */
    const sides: LabelSide[] = a.area ? AREA_SIDES.filter((s) => Math.abs(AREA_SHIFT[s] ?? 0) * (a.h + 5) <= a.r) : SIDES;
    const before = previous?.get(a.id);
    const tries = before && sides.includes(before) ? [before, ...sides.filter((s) => s !== before)] : sides;
    for (const side of tries) {
      const [left, top] = labelSpot(side, a.x, a.y, a.r, a.w, a.h);
      if (left < 2 || top < 2 || left + a.w > frame.w - 2 || top + a.h > frame.h - 2) continue;
      const box: Box = { x: left - pad, y: top - pad, w: a.w + 2 * pad, h: a.h + 2 * pad };
      let free = true;
      for (let i = 0; i < taken.length; i++) if (overlaps(box, taken[i])) { free = false; break; }
      if (!free) continue;
      taken.push(box);
      out.push({ id: a.id, left, top, w: a.w, h: a.h, side });
      break;
    }
  }
  return out;
}

/** The box a round marker takes. Give `r` with the marker's rings included: a name asked for with the same `r` clears it on every side. */
export const markerBox = (x: number, y: number, r: number): Box => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
