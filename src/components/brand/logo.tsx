import wordmark from "@/assets/brand/wordmark.png.asset.json";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** The Filed Under mark: a document tilted onto a baseline. Drawn in currentColor. */
export function BrandMark({
  className,
  title = "Filed Under",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 327 161"
      className={cn("h-6 w-auto", className)}
      role="img"
      aria-label={title}
      fill="none"
    >
      <path
        d="M77 149 L45 52 L241 11 L268 149"
        stroke="currentColor"
        strokeWidth="15"
        strokeLinejoin="miter"
      />
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
  const text = size === "sm" ? "text-[17px]" : size === "lg" ? "text-[30px]" : "text-[21px]";
  // The wordmark image is served by the hosting platform; where it is not reachable (local builds, previews)
  // the same words are set in type so the header never shows a broken image.
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // an error that fired before hydration is not delivered to onError; check the loaded state once
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  return (
    <span className={cn("inline-flex items-end gap-2.5", className)}>
      <BrandMark className={cn(h, inverted ? "text-ink-foreground" : "text-foreground")} />
      {failed ? (
        <span
          className={cn(
            "font-medium leading-none tracking-tight select-none",
            text,
            inverted ? "text-ink-foreground" : "text-foreground",
          )}
        >
          Filed Under
        </span>
      ) : (
        <img
          ref={img}
          src={wordmark.url}
          alt="Filed Under"
          width={size === "sm" ? 115 : size === "lg" ? 204 : 140}
          height={size === "sm" ? 18 : size === "lg" ? 32 : 22}
          onError={() => setFailed(true)}
          className={cn(h, "w-auto object-contain select-none", inverted && "brand-invert")}
          draggable={false}
        />
      )}
    </span>
  );
}
