import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface SegOption<T extends string> {
  v: T;
  l: string;
  title?: string;
}

/** Compact segmented control used for table and chart options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "sm",
  className,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name for the group */
  label: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-md border bg-secondary/50 p-0.5", className)}>
      {options.map((o) => {
        const btn = (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={cn(
              "rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
              value === o.v ? "bg-card font-medium text-foreground shadow-paper" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.l}
          </button>
        );
        return o.title ? (
          <Tooltip key={o.v} delayDuration={400}>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {o.title}
            </TooltipContent>
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}
