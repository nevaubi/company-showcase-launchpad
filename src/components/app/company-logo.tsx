import { useState } from "react";
import { LOGO_FILES, LOGO_ICON_TILES, LOGO_ICONS, LOGO_MONOGRAMS, LOGO_TILES, LOGO_WIDE } from "@/lib/logos.generated";
import { cn } from "@/lib/utils";

/**
 * Official logo for every covered company, bundled in public/logos (sources listed in
 * public/logos/sources.json). The bundled file wins over any URL in the data so every
 * surface shows the same mark. Which tickers have a file, its type and its drawn shape come from
 * src/lib/logos.generated.ts (bun scripts/logo-manifest.ts after adding a logo).
 *
 * The plate is always light, so dark brand marks stay legible in both themes. Plate rules:
 * - a mark with a transparent or white canvas sits inside a small padding; a mark that paints its
 *   own square background (a tile, listed in LOGO_TILES) fills the plate edge to edge;
 * - a wide mark (a wordmark, listed in LOGO_WIDE) cannot be read squeezed into a square. In the large
 *   plates (lg, xl) the plate widens to the mark's ratio, up to 3:1, and the file is cropped to its ink
 *   so the word fills the plate; in the small tiles (2xs to md) it is not drawn: the company's own
 *   square site icon is shown when one was collected (LOGO_ICONS), else a monogram (LOGO_MONOGRAMS): one or
 *   two letters of the company's name on a plate tinted with the dominant ink colour of its own wordmark
 *   (white letters when they reach 4.5:1 on it, else the colour as letters on the light plate, else the
 *   neutral plate). A monogram is not a logo; the header keeps the real wordmark in its wide plate.
 * Every size comes from the manifest, never from the loaded image, so nothing moves when it loads.
 */
const EXT = new Map<string, string>();
for (const [ext, tickers] of Object.entries(LOGO_FILES)) for (const t of tickers.split(" ")) if (t) EXT.set(t, ext);
const words = (s: string) => s.split(" ").filter(Boolean);
const TILES = new Set(words(LOGO_TILES));
const ICONS = new Set(words(LOGO_ICONS));
const ICON_TILES = new Set(words(LOGO_ICON_TILES));
/** Wide marks: ink ratio and ink box (left, top, right, bottom) as fractions of the file's box. */
const WIDE = new Map<string, { ratio: number; crop: [number, number, number, number] }>();
for (const entry of words(LOGO_WIDE)) {
  const [t, r, l, top, right, bottom] = entry.split(":");
  WIDE.set(t, { ratio: Number(r), crop: [Number(l) / 100, Number(top) / 100, Number(right) / 100, Number(bottom) / 100] });
}

/** Monograms for wide marks without a square icon: letters, tone (w, c or n) and brand colour. */
const MONO = new Map<string, { letters: string; tone: "w" | "c" | "n"; colour?: string }>();
for (const entry of words(LOGO_MONOGRAMS)) {
  const [t, colour, tone, letters] = entry.split(":");
  MONO.set(t, { letters, tone: tone as "w" | "c" | "n", colour: colour === "-" ? undefined : `#${colour}` });
}

export type LogoSize = "2xs" | "xs" | "sm" | "md" | "lg" | "xl";
const LARGE = new Set<LogoSize>(["lg", "xl"]);
/** Widest plate a wide mark gets, as a multiple of the plate's height. */
export const MAX_PLATE_RATIO = 3;

/** True when the ticker's bundled mark brings its own background and fills the plate. */
export const isLogoTile = (ticker: string) => TILES.has(ticker.toUpperCase());

/** True when the ticker's bundled mark is a wide wordmark (see LOGO_WIDE). */
export const isWideLogo = (ticker: string) => WIDE.has(ticker.toUpperCase());

export const logoUrl = (ticker: string) => {
  const t = ticker.toUpperCase();
  const ext = EXT.get(t);
  return ext ? `/logos/${t}.${ext}` : undefined;
};

/** The square icon from the company's own website, collected for a wide mark, if there is one. */
export const logoIconUrl = (ticker: string) => {
  const t = ticker.toUpperCase();
  return ICONS.has(t) ? `/logos/icons/${t}.png` : undefined;
};

/** What a plate of this size draws for this ticker. */
export type LogoChoice =
  /** the bundled mark (or the caller's URL for a ticker without one) in a square plate */
  | { kind: "mark"; url: string; tile: boolean }
  /** a wide mark in a plate widened to `plate` times its height, cropped to its ink box */
  | { kind: "wide"; url: string; ratio: number; plate: number; crop: [number, number, number, number] }
  /** the company's own square site icon, in a small tile, for a wide mark */
  | { kind: "icon"; url: string; tile: boolean }
  /** one or two letters of the company's name for a wide mark with no square icon: `w` white on the brand
   *  colour, `c` the brand colour on the light plate, `n` the neutral plate */
  | { kind: "monogram"; letters: string; tone: "w" | "c" | "n"; colour?: string }
  /** the ticker's letters */
  | { kind: "letters" };

export function logoChoice(ticker: string, size: LogoSize, src?: string): LogoChoice {
  const t = ticker.toUpperCase();
  const bundled = logoUrl(t);
  if (!bundled) return src ? { kind: "mark", url: src, tile: false } : { kind: "letters" };
  const wide = WIDE.get(t);
  if (!wide) return { kind: "mark", url: bundled, tile: TILES.has(t) };
  if (LARGE.has(size)) return { kind: "wide", url: bundled, ratio: wide.ratio, plate: Math.min(wide.ratio, MAX_PLATE_RATIO), crop: wide.crop };
  const icon = logoIconUrl(t);
  if (icon) return { kind: "icon", url: icon, tile: ICON_TILES.has(t) };
  const mono = MONO.get(t);
  return mono ? { kind: "monogram", ...mono } : { kind: "letters" };
}

/* plate size and corner; padding leaves the mark 12, 14, 20, 26, 34 and 46 px inside the 1 px border */
const BOX: Record<LogoSize, [string, string, number, number]> = {
  "2xs": ["size-4 rounded-[3px]", "p-px", 16, 1],
  xs: ["size-5 rounded", "p-[2px]", 20, 2],
  sm: ["size-7 rounded-md", "p-[3px]", 28, 3],
  md: ["size-9 rounded-md", "p-1", 36, 4],
  lg: ["size-12 rounded-lg", "p-1.5", 48, 6],
  xl: ["size-16 rounded-xl", "p-2", 64, 8],
};

/* monogram letter size in px for one and for two letters */
const MONO_PX: Record<LogoSize, [number, number]> = { "2xs": [9, 7], xs: [11, 9], sm: [14, 11], md: [17, 13], lg: [22, 17], xl: [28, 22] };

/** Pixel geometry of a wide plate of height `h` with padding `pad`: plate width and the ink box inside it. */
export function widePlate(h: number, pad: number, ratio: number) {
  const inner = h - 2 * pad - 2;
  const plate = Math.min(ratio, MAX_PLATE_RATIO);
  const inkW = Math.round(inner * plate);
  const inkH = Math.round(inkW / ratio);
  return { width: inkW + 2 * pad + 2, inkW, inkH };
}

export function CompanyLogo({
  ticker,
  src,
  className,
  size = "md",
  decorative = false,
}: {
  ticker: string;
  /** Fallback for tickers outside coverage */
  src?: string;
  className?: string;
  /** 2xs (16 px) sits on an 11 or 12 px line without making it taller */
  size?: LogoSize;
  /** Set when the ticker is written next to the logo: the mark is then hidden from screen readers */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const choice = logoChoice(ticker, size, src);
  const [box, pad, h, padPx] = BOX[size];
  const alt = decorative ? "" : `${ticker} logo`;
  const letters = (
    <span className={cn("num font-semibold leading-none text-logo-plate-foreground", size === "2xs" ? "text-[6px]" : size === "xs" ? "text-[7px]" : size === "sm" ? "text-[8px]" : "text-[10px]")}>{ticker.slice(0, 4)}</span>
  );
  const plate = "inline-flex shrink-0 items-center justify-center overflow-hidden border bg-logo-plate shadow-paper";
  const common = { title: decorative ? undefined : ticker, "aria-hidden": decorative || undefined };

  if (choice.kind === "monogram") {
    const two = choice.letters.length > 1;
    const fontPx = MONO_PX[size][two ? 1 : 0];
    const brand = choice.tone === "w" ? { backgroundColor: choice.colour, borderColor: choice.colour, color: "#fff" } : choice.tone === "c" ? { color: choice.colour } : undefined;
    return (
      <span className={cn(plate, box, "p-0", className)} style={brand} data-logo="monogram" data-tone={choice.tone} {...common}>
        <span className={cn("font-semibold leading-none tracking-tight", choice.tone === "n" && "text-logo-plate-foreground")} style={{ fontSize: fontPx }} aria-hidden>
          {choice.letters}
        </span>
        {decorative ? null : <span className="sr-only">{ticker}</span>}
      </span>
    );
  }

  if (choice.kind === "wide") {
    const g = widePlate(h, padPx, choice.ratio);
    const [l, t, r, b] = choice.crop;
    const fw = Math.max(0.01, r - l);
    const fh = Math.max(0.01, b - t);
    return (
      <span className={cn(plate, box, pad, className)} style={{ width: g.width, height: h }} data-logo="wide" {...common}>
        {failed ? (
          letters
        ) : (
          <span className="relative block shrink-0 overflow-hidden" style={{ width: g.inkW, height: g.inkH }}>
            <img
              src={choice.url}
              alt={alt}
              className="absolute max-w-none"
              style={{ width: `${100 / fw}%`, height: `${100 / fh}%`, left: `${(-l / fw) * 100}%`, top: `${(-t / fh) * 100}%` }}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
            />
          </span>
        )}
      </span>
    );
  }

  const url = choice.kind === "letters" || failed ? undefined : choice.url;
  const tile = choice.kind !== "letters" && choice.tile && !failed;
  return (
    <span className={cn(plate, box, tile ? "p-0" : pad, className)} data-logo={tile ? "tile" : url ? choice.kind : "letters"} {...common}>
      {url ? <img src={url} alt={alt} className={cn("h-full w-full", tile ? "object-cover" : "object-contain")} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : letters}
    </span>
  );
}
