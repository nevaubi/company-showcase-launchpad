// Writes src/lib/logos.generated.ts from the files in public/logos, so the logo component can resolve
// every bundled mark without a request or a directory listing at run time, and knows which marks bring
// their own background (a "tile") and should fill the plate instead of sitting inside its padding.
// Run from the repo root after adding or replacing a logo: bun scripts/logo-manifest.ts
// `--check` exits 1 when the written file no longer matches the folder (used by the unit test's message).
// The drawn shape of each mark comes from public/logos/aspect.json (sha256, the file's own width/height,
// and its ink box), measured by rasterising every file (SVG through rsvg-convert at 256 px height,
// raster files as they are) and trimming transparent and near-white margins. After adding or replacing
// a file, measure it again the same way (`python3 -I scripts/logo-measure.py public/logos public/logos/aspect.json`,
// needs Pillow and rsvg-convert); a file whose bytes no longer match its measurement is treated
// as square and named in a warning, and the unit test fails until it is measured.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const DIR = "public/logos";
const OUT = "src/lib/logos.generated.ts";
/** Preferred first when a ticker has more than one file. */
const EXTS = ["svg", "png", "jpg", "jpeg", "webp"] as const;

export function logoManifest(files: string[]): Record<string, string[]> {
  const byTicker = new Map<string, string>();
  for (const ext of [...EXTS].reverse()) {
    for (const f of files) {
      const dot = f.lastIndexOf(".");
      if (dot <= 0 || f.slice(dot + 1).toLowerCase() !== ext) continue;
      byTicker.set(f.slice(0, dot), f.slice(dot + 1));
    }
  }
  const out: Record<string, string[]> = {};
  for (const [ticker, ext] of byTicker) (out[ext] ??= []).push(ticker);
  for (const list of Object.values(out)) list.sort();
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/* ---------- tiles: marks that paint their own square background ---------- */

type Rgba = [number, number, number, number];

/**
 * Size and the four corner pixels of a PNG, or null for anything this reader does not cover (another
 * format under a .png name, an interlaced file, a damaged stream). Only what the tile rule needs:
 * the image data is inflated and unfiltered row by row, keeping the first and the last row.
 */
export function pngCorners(buf: Uint8Array): { width: number; height: number; corners: Rgba[] } | null {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 45 || SIG.some((b, i) => buf[i] !== b)) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let pos = 8; pos + 12 <= buf.length; ) {
    const len = view.getUint32(pos);
    const name = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    if (pos + 12 + len > buf.length) return null;
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = buf[pos + 16];
      type = buf[pos + 17];
      interlace = buf[pos + 20];
    } else if (name === "PLTE") palette = data;
    else if (name === "tRNS") trns = data;
    else if (name === "IDAT") idat.push(data);
    else if (name === "IEND") break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || !width || !height || width > 8192 || height > 8192 || interlace !== 0 || !idat.length) return null;
  if (![1, 2, 4, 8, 16].includes(depth) || (depth < 8 && channels !== 1) || (type === 3 && (!palette || depth === 16))) return null;
  const bits = channels * depth;
  const bpp = Math.max(1, bits >> 3);
  const stride = Math.ceil((width * bits) / 8);
  let raw: Uint8Array;
  try {
    const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of idat) {
      all.set(c, at);
      at += c.length;
    }
    raw = inflateSync(all);
  } catch {
    return null;
  }
  if (raw.length < (stride + 1) * height) return null;
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let first: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    const filter = raw[off];
    if (filter > 4) return null;
    for (let i = 0; i < stride; i++) {
      const x = raw[off + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    if (y === 0) first = cur.slice();
    [prev, cur] = [cur, prev];
  }
  const last = prev;
  const max = (1 << Math.min(depth, 8)) - 1;
  const pixel = (row: Uint8Array, x: number): Rgba => {
    /** sample k of the pixel, as stored (not scaled) for depths up to 8 and as its high byte for 16 */
    const s = (k: number) => {
      if (depth === 16) return row[(x * channels + k) * 2];
      if (depth === 8) return row[x * channels + k];
      const bit = x * depth;
      return (row[bit >> 3] >> (8 - depth - (bit & 7))) & max;
    };
    const scale = (v: number) => (depth >= 8 ? v : Math.round((v * 255) / max));
    if (type === 3) {
      const i = s(0);
      return [palette![i * 3] ?? 0, palette![i * 3 + 1] ?? 0, palette![i * 3 + 2] ?? 0, trns && i < trns.length ? trns[i] : 255];
    }
    if (type === 0) {
      const g = s(0);
      const keyed = !!trns && trns.length >= 2 && (depth === 16 ? trns[0] === g : trns[1] === g);
      return [scale(g), scale(g), scale(g), keyed ? 0 : 255];
    }
    if (type === 4) return [s(0), s(0), s(0), s(1)];
    const [r, g, b] = [s(0), s(1), s(2)];
    if (type === 6) return [r, g, b, s(3)];
    const k = depth === 16 ? 0 : 1;
    const keyed = !!trns && trns.length >= 6 && trns[k] === r && trns[2 + k] === g && trns[4 + k] === b;
    return [r, g, b, keyed ? 0 : 255];
  };
  return { width, height, corners: [pixel(first!, 0), pixel(first!, width - 1), pixel(last, 0), pixel(last, width - 1)] };
}

/**
 * A tile: a (near) square image whose four corners are opaque and one colour that is not white, so the
 * file paints its own background edge to edge. A white canvas is not a tile: it disappears into the plate.
 */
export function isTile(info: { width: number; height: number; corners: Rgba[] } | null): boolean {
  if (!info) return false;
  const { width, height, corners } = info;
  if (Math.max(width, height) / Math.min(width, height) >= 1.15) return false;
  if (corners.some((c) => c[3] < 251)) return false;
  const [r, g, b] = corners[0];
  if (corners.some((c) => Math.max(Math.abs(c[0] - r), Math.abs(c[1] - g), Math.abs(c[2] - b)) >= 12)) return false;
  return Math.min(r, g, b) < 249;
}

/** Tickers whose bundled mark is a PNG tile, sorted. `read` returns a file's bytes (injected for tests). */
export function logoTiles(manifest: Record<string, string[]>, read: (file: string) => Uint8Array): string[] {
  return (manifest.png ?? []).filter((t) => isTile(pngCorners(read(`${t}.png`)))).sort();
}

/* ---------- shapes: how wide each mark is drawn ---------- */

/**
 * A mark at least this many times wider than tall (measured on its ink, see public/logos/aspect.json) is a
 * wide mark. Chosen from a contact sheet of the marks between 2.0 and 3.6 drawn in the app's 28 and 20 px
 * tiles: below about 2.6 a short wordmark (ABM, aes, affirm, SIMON) still reads as a word in a 28 px
 * tile; from about 2.6 the letters fall under 8 px and blur into a grey bar (Yelp, AGCO, Rocket Lab,
 * Intuitive Machines, American Water, Lockheed Martin).
 */
export const WIDE_RATIO = 2.6;

/** One measured file: sha256 of its bytes, the file's own width/height, and the ink box as fractions (left, top, right, bottom). */
export type Measured = { sha256: string; box: number; crop: [number, number, number, number] };

/** Width/height of what is drawn: the ink box of the file, in the file's own proportions. */
export const inkRatio = (m: Measured) => (m.box * (m.crop[2] - m.crop[0])) / Math.max(1e-6, m.crop[3] - m.crop[1]);

/**
 * Wide marks as "TICKER:ratio:left:top:right:bottom" (ratio to two decimals, ink box in whole percent of the
 * file's box, rounded outwards so no ink is cut), sorted. `aspect` maps a file name to its measurement.
 */
export function logoWide(manifest: Record<string, string[]>, aspect: Record<string, Measured>): string[] {
  const out: string[] = [];
  for (const [ext, list] of Object.entries(manifest))
    for (const t of list) {
      const m = aspect[`${t}.${ext}`];
      if (!m) continue;
      const r = inkRatio(m);
      if (r < WIDE_RATIO) continue;
      const [l, top, right, bottom] = m.crop;
      out.push([t, r.toFixed(2), Math.floor(l * 100), Math.floor(top * 100), Math.ceil(right * 100), Math.ceil(bottom * 100)].join(":"));
    }
  return out.sort();
}

/** Tickers with a square icon in public/logos/icons (the company's own site icon, for small tiles), sorted. */
export function logoIcons(files: string[]): string[] {
  return files.filter((f) => /^[A-Z0-9.-]+\.png$/.test(f)).map((f) => f.slice(0, -4)).sort();
}

export function render(
  manifest: Record<string, string[]>,
  tiles: string[] = [],
  wide: string[] = [],
  icons: string[] = [],
  iconTiles: string[] = [],
): string {
  const total = Object.values(manifest).reduce((n, l) => n + l.length, 0);
  const lines = Object.entries(manifest).map(([ext, list]) => `  ${JSON.stringify(ext)}:\n    ${JSON.stringify(list.join(" "))},`);
  return [
    "// Generated by scripts/logo-manifest.ts from public/logos. Do not edit by hand: rerun the script.",
    `// ${total} marks. Tickers are grouped by file extension, space separated.`,
    "export const LOGO_FILES: Record<string, string> = {",
    ...lines,
    "};",
    "",
    `// ${tiles.length} marks that paint their own square background: they fill the logo plate instead of sitting inside its padding.`,
    `export const LOGO_TILES =\n  ${JSON.stringify(tiles.join(" "))};`,
    "",
    `// ${wide.length} wide marks (ink at least ${WIDE_RATIO} times wider than tall), as TICKER:ratio:left:top:right:bottom,`,
    "// the ink box in percent of the file's own box. Large plates widen to the ratio; small tiles do not draw them.",
    `export const LOGO_WIDE =\n  ${JSON.stringify(wide.join(" "))};`,
    "",
    `// ${icons.length} square icons from the companies' own websites (public/logos/icons), drawn in small tiles for wide marks.`,
    `export const LOGO_ICONS =\n  ${JSON.stringify(icons.join(" "))};`,
    "",
    `// ${iconTiles.length} of those icons paint their own square background.`,
    `export const LOGO_ICON_TILES =\n  ${JSON.stringify(iconTiles.join(" "))};`,
    "",
  ].join("\n");
}

/** Files whose measurement in aspect.json is missing or was taken from other bytes. */
export function staleMeasurements(manifest: Record<string, string[]>, aspect: Record<string, Measured>, sha: (file: string) => string): string[] {
  const out: string[] = [];
  for (const [ext, list] of Object.entries(manifest))
    for (const t of list) {
      const f = `${t}.${ext}`;
      if (aspect[f]?.sha256 !== sha(f)) out.push(f);
    }
  return out.sort();
}

/** Everything the generated file holds, from the folder on disk. */
export function build(dir = DIR): string {
  const manifest = logoManifest(readdirSync(dir));
  const read = (f: string) => readFileSync(`${dir}/${f}`);
  const aspect = JSON.parse(readFileSync(`${dir}/aspect.json`, "utf8")) as Record<string, Measured>;
  const stale = staleMeasurements(manifest, aspect, (f) => createHash("sha256").update(read(f)).digest("hex"));
  if (stale.length)
    console.warn(`not measured or changed since measured (drawn as square until remeasured): ${stale.join(" ")}`);
  const fresh = Object.fromEntries(Object.entries(aspect).filter(([f]) => !stale.includes(f)));
  let iconFiles: string[] = [];
  try {
    iconFiles = readdirSync(`${dir}/icons`);
  } catch {
    iconFiles = [];
  }
  const icons = logoIcons(iconFiles);
  const iconTiles = icons.filter((t) => isTile(pngCorners(read(`icons/${t}.png`))));
  return render(manifest, logoTiles(manifest, read), logoWide(manifest, fresh), icons, iconTiles);
}

if (import.meta.main) {
  const text = build();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OUT, "utf8");
    } catch {
      current = "";
    }
    if (current !== text) {
      console.error(`${OUT} is out of date with ${DIR}: run bun scripts/logo-manifest.ts`);
      process.exit(1);
    }
    console.log(`${OUT} matches ${DIR}`);
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
