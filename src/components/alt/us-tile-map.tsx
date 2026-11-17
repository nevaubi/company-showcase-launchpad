import { cn } from "@/lib/utils";

/** Equal-size tile grid of the US (row, column), so small states stay readable. */
const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [0, 10],
  VT: [1, 9], NH: [1, 10],
  WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 8], RI: [2, 9], MA: [2, 10],
  OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9],
  CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
  AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
  OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
  HI: [7, 0], TX: [7, 3], FL: [7, 7], PR: [7, 10],
};

/**
 * Shades each state by `value` (0–1, relative to the largest); `label` prints under the code.
 * Colors come from the foreground token so the map follows the theme.
 */
export function UsTileMap({ values, label, title, selected, onSelect, className, scale = "sqrt" }: { values: Record<string, number>; label?: (st: string) => string | null; title?: (st: string) => string; selected?: string | null; onSelect?: (st: string) => void; className?: string; /** sqrt spreads small shares apart; linear (between the smallest and largest value) suits values that are all large */ scale?: "sqrt" | "linear" }) {
  const vals = Object.values(values).filter((x) => x > 0);
  const max = Math.max(0, ...vals);
  const min = Math.min(max, ...vals);
  return (
    <div className={cn("grid w-full max-w-[560px] grid-cols-11 gap-[3px]", className)} role="list" aria-label="Map of US states">
      {Object.entries(TILES).map(([st, [r, c]]) => {
        const v = values[st] ?? 0;
        const t = max <= 0 || v <= 0 ? 0 : scale === "linear" ? (max > min ? 0.1 + (0.9 * (v - min)) / (max - min) : 1) : Math.sqrt(v / max);
        const text = label?.(st);
        const Tag = onSelect ? "button" : "div";
        return (
          <Tag
            key={st}
            role="listitem"
            type={onSelect ? "button" : undefined}
            title={title?.(st)}
            onClick={onSelect ? () => onSelect(st) : undefined}
            style={{ gridRow: r + 1, gridColumn: c + 1, background: v > 0 ? `color-mix(in oklab, var(--foreground) ${Math.round(8 + t * 72)}%, var(--card))` : undefined }}
            className={cn(
              "flex aspect-square min-w-0 flex-col items-center justify-center rounded-[3px] border text-center leading-none",
              v > 0 ? "border-transparent" : "border-border bg-card text-muted-foreground/60",
              t > 0.45 ? "text-background" : "text-foreground",
              selected === st && "ring-2 ring-ring ring-offset-1 ring-offset-background",
              onSelect && "hover:opacity-80",
            )}
          >
            <span className="text-[9px] font-semibold sm:text-[10px]">{st}</span>
            {text && <span className="num mt-0.5 hidden text-[8px] sm:block">{text}</span>}
          </Tag>
        );
      })}
    </div>
  );
}
