import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Official logo for every covered company, bundled in public/logos (sources listed in
 * public/logos/sources.json). The bundled file wins over any URL in the data so every
 * surface shows the same mark.
 */
const RASTER = new Set(["LIN"]);
const COVERED = new Set(
  "AAPL ABBV ABT ADBE AMD AMGN AMT AMZN AVGO AXP BA BAC BKNG C CAT CMCSA COP COST CRM CSCO CVX DE DIS DUK EQIX FCX GE GOOGL GS HD HON IBM INTC ISRG JNJ JPM KO LIN LLY LMT LOW MA MCD META MRK MS MSFT MU NEE NFLX NKE NOW NVDA ORCL PEP PFE PG PLD PM QCOM RTX SBUX SCHW SLB SO SPGI T TMO TSLA TXN UNH UNP UPS V VZ WFC WMT XOM".split(" "),
);

export const logoUrl = (ticker: string) => {
  const t = ticker.toUpperCase();
  return COVERED.has(t) ? `/logos/${t}.${RASTER.has(t) ? "png" : "svg"}` : undefined;
};

export function CompanyLogo({
  ticker,
  src,
  className,
  size = "md",
}: {
  ticker: string;
  /** Fallback for tickers outside coverage */
  src?: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
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
      title={ticker}
    >
      {url && !failed ? (
        <img src={url} alt={`${ticker} logo`} className="h-full w-full object-contain" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className={cn("num font-semibold leading-none", size === "xs" ? "text-[7px]" : size === "sm" ? "text-[8px]" : "text-[10px]")}>{ticker.slice(0, 4)}</span>
      )}
    </span>
  );
}
