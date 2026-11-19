// Text colour for spreadsheet cells that have a fill but no font colour of their own. Cells are document content,
// so the ink follows the fill (as it does in Excel), not the app theme: dark text on light fills, light on dark.

/** Ink used on light fills (the light theme's foreground). */
export const DARK_INK = "#111419";
/** Ink used on dark fills (the dark theme's foreground). */
export const LIGHT_INK = "#f1eee9";

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() into 0..255 channels, or null when the colour isn't one of those. */
export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1].slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fn = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+[\d.]+%?)?\s*\)$/);
  if (fn) {
    const ch = [fn[1], fn[2], fn[3]].map((x) => Math.min(255, Math.max(0, Number(x))));
    return ch.every(Number.isFinite) ? (ch as [number, number, number]) : null;
  }
  return null;
}

/** WCAG relative luminance (0 black .. 1 white) of 0..255 channels. */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The ink with the better contrast on this fill. Colours that can't be parsed get dark ink, the spreadsheet default.
 */
export function inkOnFill(fill: string): string {
  const rgb = parseColor(fill);
  if (!rgb) return DARK_INK;
  const l = luminance(rgb);
  const dark = luminance(parseColor(DARK_INK)!);
  const light = luminance(parseColor(LIGHT_INK)!);
  return contrast(l, dark) >= contrast(l, light) ? DARK_INK : LIGHT_INK;
}
