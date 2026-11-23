import type { ReactNode } from "react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { cn } from "@/lib/utils";

const figButton =
  "num rounded-sm px-1 py-0.5 tabular-nums transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

/** A printed figure that opens its source: the filed number, or the formula with every filed number behind it. */
export function FigButton({ target, children, className, title }: { target: SourceTarget; children: ReactNode; className?: string; title?: string }) {
  const { open } = useSource();
  return (
    <button type="button" data-figure={target.label} onClick={() => open(target)} title={title ?? `${target.label}${target.periodLabel ? `, ${target.periodLabel}` : ""}: open the source`} className={cn(figButton, className)}>
      {children}
    </button>
  );
}

/** Signed text for a change: a plus for a rise, a true minus for a fall. */
export const signed = (text: string, v: number) => (v > 0 ? `+${text}` : text);
