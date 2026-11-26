/**
 * The state tile grid, pure: which square each state takes, how a figure becomes a fill, which ink a label inside a
 * fill takes, and where the arrow keys go. The component (`state-grid.tsx`) only draws what this returns.
 *
 * Colour does one job per map: magnitude (sequential, one hue from light to dark, `--chart-1`) or polarity (diverging,
 * `--chart-1` above zero and `--chart-4` below, a neutral grey at zero). A fill is the hue mixed into the muted
 * surface in OKLab, so the low end and the midpoint stay visible on the card in both themes and the high end is the
 * hue itself (dark in the light theme, light in the dark theme, as each theme's ramp runs).
 */
import { GRID_COLUMNS, GRID_PLACES, GRID_ROWS, type UsPlace } from "@/lib/sources/geo/us-states";

export type GridScale = "sequential" | "diverging";

export type GridFill = {
  /** The hue token, or null for a state without a figure (hatched). */
  hue: string | null;
  /** Share of the hue in the mix, 0 to 100. */
  percent: number;
  /** The label inside the fill takes the surface ink (light on dark) in the light theme. */
  lightInkLight: boolean;
  /** The label inside the fill takes the surface ink (dark on light) in the dark theme. */
  lightInkDark: boolean;
};

const SEQ = "var(--chart-1)";
const POS = "var(--chart-1)";
const NEG = "var(--chart-4)";
/** The low end of a sequential ramp and the midpoint of a diverging one carry this much of the hue. */
const FLOOR = 10;
const SPAN = 90;

/** OKLCH lightness of the tokens the mix runs between (`src/styles.css`), for the choice of ink. */
const L = {
  light: { muted: 0.955, "var(--chart-1)": 0.42, "var(--chart-4)": 0.6 },
  dark: { muted: 0.26, "var(--chart-1)": 0.72, "var(--chart-4)": 0.72 },
} as const;

/** Lightness of a mix in OKLab: linear in the share of the hue. */
function mixL(theme: "light" | "dark", hue: string, percent: number): number {
  const t = L[theme];
  const h = t[hue as keyof typeof t] as number;
  return t.muted + (h - t.muted) * (percent / 100);
}

/** Below this lightness a label inside a fill is light; above it, dark (both themes). */
export const INK_FLIP_L = 0.6;

/**
 * The fill of one figure. Sequential: its place between the domain's ends (a single-valued domain takes the middle).
 * Diverging: its distance from zero against the larger of the two ends, on the side of its sign.
 */
export function gridFill(value: number | null, scale: GridScale, domain: [number, number]): GridFill {
  if (value === null || !Number.isFinite(value)) return { hue: null, percent: 0, lightInkLight: false, lightInkDark: false };
  let hue: string;
  let t: number;
  if (scale === "sequential") {
    const [lo, hi] = domain;
    hue = SEQ;
    t = hi > lo ? (value - lo) / (hi - lo) : 0.5;
  } else {
    const reach = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
    hue = value < 0 ? NEG : POS;
    t = reach > 0 ? Math.abs(value) / reach : 0;
  }
  t = Math.min(1, Math.max(0, t));
  const percent = Math.round(FLOOR + t * SPAN);
  return {
    hue,
    percent,
    lightInkLight: mixL("light", hue, percent) < INK_FLIP_L,
    lightInkDark: mixL("dark", hue, percent) < INK_FLIP_L,
  };
}

/** The CSS background of a fill. */
export function fillCss(fill: GridFill): string | undefined {
  return fill.hue ? `color-mix(in oklab, ${fill.hue} ${fill.percent}%, var(--muted))` : undefined;
}

/** The CSS of a legend ramp from the domain's low end to its high end. */
export function rampCss(scale: GridScale): string {
  if (scale === "sequential")
    return `linear-gradient(to right, color-mix(in oklab, ${SEQ} ${FLOOR}%, var(--muted)), color-mix(in oklab, ${SEQ} ${FLOOR + SPAN}%, var(--muted)))`;
  return `linear-gradient(to right, color-mix(in oklab, ${NEG} ${FLOOR + SPAN}%, var(--muted)), color-mix(in oklab, ${NEG} ${FLOOR}%, var(--muted)) 50%, color-mix(in oklab, ${POS} ${FLOOR}%, var(--muted)) 50%, color-mix(in oklab, ${POS} ${FLOOR + SPAN}%, var(--muted)))`;
}

/** Hatching of a square without a figure: a 135 degree hairline texture on the muted surface. */
export const HATCH = "repeating-linear-gradient(135deg, var(--border) 0 1px, transparent 1px 5px), var(--muted)";

export type Direction = "left" | "right" | "up" | "down" | "first" | "last";

const AT = new Map(GRID_PLACES.map((p) => [`${p.grid!.row}:${p.grid!.col}`, p] as const));

/**
 * The square the arrow keys move to from a state: the next square in the row (left, right), or in the row above or
 * below, the square in the nearest column (up, down); null at an edge. Home and End go to the first and last square.
 */
export function gridNeighbor(code: string, direction: Direction): UsPlace | null {
  if (direction === "first") return GRID_PLACES[0];
  if (direction === "last") return GRID_PLACES[GRID_PLACES.length - 1];
  const from = GRID_PLACES.find((p) => p.code === code);
  if (!from?.grid) return null;
  const { row, col } = from.grid;
  if (direction === "left" || direction === "right") {
    const step = direction === "left" ? -1 : 1;
    for (let c = col + step; c >= 0 && c < GRID_COLUMNS; c += step) {
      const p = AT.get(`${row}:${c}`);
      if (p) return p;
    }
    return null;
  }
  const step = direction === "up" ? -1 : 1;
  for (let r = row + step; r >= 0 && r < GRID_ROWS; r += step) {
    let best: UsPlace | null = null;
    for (const p of GRID_PLACES) {
      if (p.grid!.row !== r) continue;
      if (!best || Math.abs(p.grid!.col - col) < Math.abs(best.grid!.col - col)) best = p;
    }
    if (best) return best;
  }
  return null;
}

/** The width that fits the grid into a height, with `gap` px between squares. */
export function gridWidthFor(height: number, gap: number): number {
  const tile = (height - gap * (GRID_ROWS - 1)) / GRID_ROWS;
  return Math.floor(tile * GRID_COLUMNS + gap * (GRID_COLUMNS - 1));
}
