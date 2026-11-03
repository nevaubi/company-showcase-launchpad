import { cn } from "@/lib/utils";

/** Bundled marks for covered companies, so any surface can show a logo from just the ticker. */
const LOGOS: Record<string, string> = {
  AAPL: "/__l5e/assets-v1/d276f434-7367-4a90-a218-3af0fe531588/logo-AAPL.svg",
  MSFT: "/__l5e/assets-v1/f00a1107-9c23-4096-b689-e92adbbf7844/logo-MSFT.svg",
  NVDA: "/__l5e/assets-v1/24df2cf8-0ac5-428c-9dc4-2543bac7527a/logo-NVDA.svg",
  AMZN: "/__l5e/assets-v1/05f6a9ac-b948-411c-892d-442e7a0868b3/logo-AMZN.svg",
  GOOGL: "/__l5e/assets-v1/be5ee208-0fa0-4672-8641-53d0a3e0a946/logo-GOOGL.svg",
  TSLA: "/__l5e/assets-v1/37a6f5bb-05c8-4367-8d5a-71922bb1a281/logo-TSLA.svg",
  ...Object.fromEntries(
    ["META", "AVGO", "AMD", "ORCL", "BAC", "GS", "V", "MA", "MRK", "WMT", "CAT"].map((t) => [t, `/logos/${t}.svg`]),
  ),
};

export function CompanyLogo({
  ticker,
  src,
  className,
  size = "md",
}: {
  ticker: string;
  src?: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}) {
  const url = src || LOGOS[ticker];
  const dims = {
    xs: "size-5 p-0.5 rounded",
    sm: "size-7 p-1 rounded-md",
    md: "size-9 p-1.5 rounded-md",
    lg: "size-12 p-2 rounded-lg",
    xl: "size-16 p-2.5 rounded-xl",
  }[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border bg-card shadow-paper",
        dims,
        className,
      )}
    >
      {url ? (
        <img src={url} alt={`${ticker} logo`} className="h-full w-full object-contain" loading="lazy" />
      ) : (
        <span className="num text-[10px] font-semibold">{ticker.slice(0, 4)}</span>
      )}
    </span>
  );
}
