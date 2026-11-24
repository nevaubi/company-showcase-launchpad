import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface SegOption<T extends string> {
  v: T;
  l: string;
  title?: string;
  /** skipped by the arrow keys and not clickable */
  disabled?: boolean;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Where an arrow, Home or End key moves in a radio group of `n` options from `from`, skipping disabled ones and
 * wrapping around; null for any other key or when no other option can take the focus.
 */
export function radioKeyTarget(key: string, from: number, disabled: boolean[]): number | null {
  const n = disabled.length;
  if (!n) return null;
  const free = (i: number) => !disabled[i];
  if (key === "Home" || key === "End") {
    const dir = key === "Home" ? 1 : -1;
    for (let k = 0, i = key === "Home" ? 0 : n - 1; k < n; k++, i += dir) if (free(i)) return i;
    return null;
  }
  const step = STEP[key];
  if (!step) return null;
  for (let k = 1, i = from; k <= n; k++) {
    i = (i + step + n) % n;
    if (free(i)) return i === from ? null : i;
  }
  return null;
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = options.map((o) => !!o.disabled);
  // one tab stop: the checked option, or the first one that can be chosen when none is checked
  const checked = options.findIndex((o) => o.v === value && !o.disabled);
  const stop = checked >= 0 ? checked : disabled.indexOf(false);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = radioKeyTarget(e.key, i, disabled);
    if (to == null) return;
    e.preventDefault();
    refs.current[to]?.focus();
    onChange(options[to].v);
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex min-w-0 max-w-full flex-wrap rounded-md border bg-secondary/50 p-0.5", className)}>
      {options.map((o, i) => {
        const btn = (
          <Button variant="ghost" size="xs"
            key={o.v}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            tabIndex={i === stop ? 0 : -1}
            disabled={o.disabled}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => onChange(o.v)}
            className={cn(
              "h-auto min-h-7 shrink-0 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
              value === o.v ? "bg-card font-medium text-foreground shadow-paper" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.l}
          </Button>
        );
        return o.title ? (
          <Tooltip key={o.v} delayDuration={400}>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs text-pretty">
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
