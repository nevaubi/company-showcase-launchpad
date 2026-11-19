import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { setTheme, usePrefs, type ThemePref } from "@/lib/prefs";

export interface PressedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Segmented control built from real toggle buttons: a labelled group, `aria-pressed` on each option, roving tab
 * stop, and arrow, Home and End keys to move between options (Enter or Space selects).
 */
export function PressedSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
  labelledBy,
  describedBy,
  className,
}: {
  value: T;
  options: PressedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name for the group, used when there is no visible label to point at */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = options.length - 1;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = i === last ? 0 : i + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = i === 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <div
      role="group"
      data-agent-noclick=""
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn("inline-flex h-7 items-stretch gap-0.5 rounded-md bg-muted p-0.5", className)}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-pressed={on}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex min-w-0 items-center justify-center rounded px-2.5 text-xs leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-muted",
              on
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const THEME_OPTIONS: PressedOption<ThemePref>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Light, Dark or System theme for the signed-in app. Reads and writes the user's theme preference. */
export function ThemeSwitch({
  className,
  labelledBy,
  describedBy,
}: {
  className?: string;
  /** Id of a visible label; without it the group is named "Theme" */
  labelledBy?: string;
  /** Space-separated ids of helper text announced with the group */
  describedBy?: string;
}) {
  const [prefs] = usePrefs();
  return (
    <PressedSegmented
      value={prefs.theme}
      options={THEME_OPTIONS}
      onChange={setTheme}
      label="Theme"
      labelledBy={labelledBy}
      describedBy={describedBy}
      className={className}
    />
  );
}
