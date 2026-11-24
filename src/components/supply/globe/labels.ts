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

/**
 * Shapes the base map carries beside the countries that are a territory of one (Puerto Rico, the Falklands, New
 * Caledonia, the French southern lands). They are named in the quiet style of a U.S. state, never in a country's capitals.
 * Greenland is drawn and named as a country, as the map's own data has it.
 */
export const TERRITORY_SHAPES: ReadonlySet<string> = new Set(['Puerto Rico', 'Falkland Is.', 'Fr. S. Antarctic Lands', 'New Caledonia']);
export type AreaKind = 'country' | 'region';
/** How a map shape is named: a country in spaced capitals, a state or territory as written. */
export const areaKind = (atlasName: string): AreaKind => (TERRITORY_SHAPES.has(atlasName) ? 'region' : 'country');
/** The text drawn for a label of this kind: country names and shared places (hubs) in capitals, states, territories and company names as written. */
export const labelText = (kind: string, text: string): string => (kind === 'country' || kind === 'hub' ? text.toUpperCase() : text);

const NAME_TAILS = new Set(['inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'llc', 'plc', 'sa', 'ag', 'nv', 'se', 'group', 'holdings', 'holding', 'the', 'and', '&', 'of']);
/**
 * What a logo badge shows on its plate while its logo is missing, loading or failed: the ticker when it has one (up to
 * five letters), otherwise the initials of the first two words of the name that are not a legal form ("Hon Hai Precision
 * Industry Co., Ltd." is HH), or the first two letters of a one-word name. Never empty while the name has a letter.
 */
export function badgeText(name: string, ticker?: string | null): string {
  const t = (ticker ?? '').trim().toUpperCase();
  if (t && t.length <= 5 && /^[A-Z0-9.-]+$/.test(t)) return t;
  const words = name.split(/[\s,./()-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w) && !NAME_TAILS.has(w.toLowerCase()));
  if (!words.length) return name.trim().slice(0, 2).toUpperCase();
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

/**
 * Share of a drawn logo tile's pixels that differ from its plate (RGBA rows as getImageData returns them). A logo that
 * loads but draws nothing (an SVG without a size, a white mark on a white plate) scores near zero and is treated as
 * missing, so the badge shows its letters instead of an empty plate.
 */
export function inkShare(data: ArrayLike<number>, plate: readonly [number, number, number], tolerance = 28): number {
  let ink = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    n++;
    if (Math.abs(data[i] - plate[0]) + Math.abs(data[i + 1] - plate[1]) + Math.abs(data[i + 2] - plate[2]) > tolerance) ink++;
  }
  return n ? ink / n : 0;
}
