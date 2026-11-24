import { useState } from "react";
import { LOGO_FILES } from "@/lib/logos.generated";
import { cn } from "@/lib/utils";

/**
 * Official logo for every covered company, bundled in public/logos (sources listed in
 * public/logos/sources.json). The bundled file wins over any URL in the data so every
 * surface shows the same mark. Which tickers have a file, and its type, comes from
 * src/lib/logos.generated.ts (bun scripts/logo-manifest.ts after adding a logo).
 */
const EXT = new Map<string, string>();
for (const [ext, tickers] of Object.entries(LOGO_FILES)) for (const t of tickers.split(" ")) if (t) EXT.set(t, ext);

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
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Set when the ticker is written next to the logo: the mark is then hidden from screen readers */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = logoUrl(ticker) ?? src;
  const dims = {
    xs: "size-5 p-[3px] rounded",
    sm: "size-7 p-1 rounded-md",
    md: "size-9 p-1.5 rounded-md",
    lg: "size-12 p-2 rounded-lg",
    xl: "size-16 p-2.5 rounded-xl",
  }[size];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden border bg-logo-plate shadow-paper", dims, className)}
      title={decorative ? undefined : ticker}
      aria-hidden={decorative || undefined}
    >
      {url && !failed ? (
        <img src={url} alt={decorative ? "" : `${ticker} logo`} className="h-full w-full object-contain" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className={cn("num font-semibold leading-none text-logo-plate-foreground", size === "xs" ? "text-[7px]" : size === "sm" ? "text-[8px]" : "text-[10px]")}>{ticker.slice(0, 4)}</span>
      )}
    </span>
  );
}
