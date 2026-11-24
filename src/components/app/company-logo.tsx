import { useState } from "react";
import { LOGO_FILES, LOGO_TILES } from "@/lib/logos.generated";
import { cn } from "@/lib/utils";

/**
 * Official logo for every covered company, bundled in public/logos (sources listed in
 * public/logos/sources.json). The bundled file wins over any URL in the data so every
 * surface shows the same mark. Which tickers have a file, and its type, comes from
 * src/lib/logos.generated.ts (bun scripts/logo-manifest.ts after adding a logo).
 *
 * The plate is always light, so dark brand marks stay legible in both themes. Two plate rules:
 * a mark with a transparent or white canvas sits inside a small padding; a mark that paints its
 * own square background (a tile, listed in LOGO_TILES) fills the plate edge to edge, so it is not
 * framed twice and reads about a third larger.
 */
const EXT = new Map<string, string>();
for (const [ext, tickers] of Object.entries(LOGO_FILES)) for (const t of tickers.split(" ")) if (t) EXT.set(t, ext);
const TILES = new Set(LOGO_TILES.split(" ").filter(Boolean));

/** True when the ticker's bundled mark brings its own background and fills the plate. */
export const isLogoTile = (ticker: string) => TILES.has(ticker.toUpperCase());

export const logoUrl = (ticker: string) => {
  const t = ticker.toUpperCase();
  const ext = EXT.get(t);
  return ext ? `/logos/${t}.${ext}` : undefined;
};

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
  size?: "2xs" | "xs" | "sm" | "md" | "lg" | "xl";
  /** Set when the ticker is written next to the logo: the mark is then hidden from screen readers */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const bundled = logoUrl(ticker);
  const url = bundled ?? src;
  const tile = !!bundled && isLogoTile(ticker);
  /* plate size and corner; padding leaves the mark 12, 14, 20, 26, 34 and 46 px inside the 1 px border */
  const [box, pad] = {
    "2xs": ["size-4 rounded-[3px]", "p-px"],
    xs: ["size-5 rounded", "p-[2px]"],
    sm: ["size-7 rounded-md", "p-[3px]"],
    md: ["size-9 rounded-md", "p-1"],
    lg: ["size-12 rounded-lg", "p-1.5"],
    xl: ["size-16 rounded-xl", "p-2"],
  }[size];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden border bg-logo-plate shadow-paper", box, tile && !failed ? "p-0" : pad, className)}
      title={decorative ? undefined : ticker}
      aria-hidden={decorative || undefined}
      data-logo={tile ? "tile" : undefined}
    >
      {url && !failed ? (
        <img src={url} alt={decorative ? "" : `${ticker} logo`} className={cn("h-full w-full", tile ? "object-cover" : "object-contain")} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className={cn("num font-semibold leading-none text-logo-plate-foreground", size === "2xs" ? "text-[6px]" : size === "xs" ? "text-[7px]" : size === "sm" ? "text-[8px]" : "text-[10px]")}>{ticker.slice(0, 4)}</span>
      )}
    </span>
  );
}
