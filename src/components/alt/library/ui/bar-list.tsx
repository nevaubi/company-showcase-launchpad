/**
 * Horizontal bars from a zero baseline, one hue (`--chart-1`), value printed at the end of each bar, label at
 * the left in text ink. Bars are at most 16 px thick with a rounded data end; a bar that can open something is a
 * button with the same tooltip on hover and on keyboard focus. Used for ranked values and counts.
 */
import { cn } from "@/lib/utils";

export type Bar = {
  key: string;
  label: string;
  /** Secondary text under the label (a code, a period). */
  sub?: string;
  value: number;
  /** The value as printed at the bar's end (already formatted, unit included where it belongs). */
  text: string;
  /** Hover and focus text: value, unit as stated, period, stored string. */
  title: string;
  /** A remainder ("All other values"): drawn in the de-emphasis grey, so the named bars lead. */
  quiet?: boolean;
  /** A bar that opens nothing even when the list's bars do (a remainder). */
  inert?: boolean;
};

export function BarList({
  bars,
  max,
  onSelect,
  selectedKey,
  label,
  labelWidth = "minmax(0,16rem)",
}: {
  bars: Bar[];
  /** The scale's end; defaults to the largest value. */
  max?: number;
  onSelect?: (bar: Bar) => void;
  selectedKey?: string | null;
  /** Accessible name of the list. */
  label: string;
  labelWidth?: string;
}) {
  const top = max ?? Math.max(0, ...bars.map((b) => b.value));
  return (
    <ol className="grid grid-cols-1 gap-y-1" aria-label={label}>
      {bars.map((b) => {
        const share = top > 0 ? Math.max(0, b.value) / top : 0;
        const body = (
          <>
            <span className="min-w-0 text-left">
              <span className="block truncate text-[13px] leading-5">{b.label}</span>
              {b.sub && <span className="num block truncate text-[11px] leading-4 text-muted-foreground">{b.sub}</span>}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="relative h-4 min-w-0 flex-1" aria-hidden>
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity duration-150 group-hover:opacity-80 motion-reduce:transition-none",
                    b.quiet ? "bg-chart-5/70" : "bg-chart-1",
                  )}
                  style={{ width: `${(share * 100).toFixed(2)}%`, minWidth: b.value > 0 ? 2 : 0 }}
                />
              </span>
              <span className="num w-[6.75rem] shrink-0 text-right text-[13px] leading-5">{b.text}</span>
            </span>
          </>
        );
        // the label column gives way first (labels truncate), the bar column keeps room for its value
        const grid = { gridTemplateColumns: `${labelWidth} minmax(9rem,1fr)` };
        return (
          <li key={b.key}>
            {onSelect && !b.inert ? (
              <button
                type="button"
                onClick={() => onSelect(b)}
                title={b.title}
                aria-label={b.title}
                style={grid}
                className={cn(
                  "group grid min-h-7 w-full items-center gap-3 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  selectedKey === b.key && "bg-highlight-soft/60",
                )}
              >
                {body}
              </button>
            ) : (
              <div title={b.title} style={grid} className="group grid min-h-7 items-center gap-3 px-1 py-0.5">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
