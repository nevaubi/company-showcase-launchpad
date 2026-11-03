import wordmark from "@/assets/brand/wordmark.png.asset.json";
import { cn } from "@/lib/utils";

/** The Filed Under mark: a document tilted onto a baseline. Drawn in currentColor. */
export function BrandMark({ className, title = "Filed Under" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 327 161" className={cn("h-6 w-auto", className)} role="img" aria-label={title} fill="none">
      <path d="M77 149 L45 52 L241 11 L268 149" stroke="currentColor" strokeWidth="15" strokeLinejoin="miter" />
      <rect x="0" y="143" width="327" height="15" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  className,
  inverted = false,
  size = "md",
}: {
  className?: string;
  inverted?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const h = size === "sm" ? "h-[18px]" : size === "lg" ? "h-8" : "h-[22px]";
  return (
    <span className={cn("inline-flex items-end gap-2.5", className)}>
      <BrandMark className={cn(h, inverted ? "text-ink-foreground" : "text-foreground")} />
      <img
        src={wordmark.url}
        alt="Filed Under"
        className={cn(h, "w-auto select-none", inverted && "brand-invert")}
        draggable={false}
      />
    </span>
  );
}
