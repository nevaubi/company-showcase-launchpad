"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right;
 *            the 650ms cycle is shorter than the sweep, so
 *            two fronts are always in flight
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 *
 * Paired with a shimmering label and a live elapsed timer
 * in mono tabular figures. Reduced motion freezes the grid
 * to its dim state; the timer still ticks.
 * ───────────────────────────────────────────────────────── */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3),
    c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

export type LoadingVariant = "Drive" | "Dots" | "Orbit";

const PATTERNS: Record<LoadingVariant, { delays: (number | null)[]; dur: number; round: boolean }> =
  {
    Drive: { delays: chevron, dur: 650, round: false },
    Dots: { delays: chevron, dur: 650, round: true },
    Orbit: { delays: orbit, dur: 950, round: false },
  };

/** Elapsed time since mount (or since `since`, epoch ms), ticking every 100 ms. */
export function useElapsed(since?: number) {
  const [now, setNow] = useState(() => Date.now());
  const [start] = useState(() => since ?? Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  return formatElapsed(Math.max(0, now - (since ?? start)));
}

export function formatElapsed(ms: number) {
  const total = Math.floor(ms / 100) / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/** The 3x3 pixel grid on its own, for inline use (tool rows, buttons). */
export function PixelGrid({
  variant = "Drive",
  className,
}: {
  variant?: LoadingVariant;
  className?: string;
}) {
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive;
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]", className)}
    >
      {delays.map((d, i) => (
        <span
          key={i}
          className={cn(
            "loader-pixel size-[4px] bg-foreground",
            round ? "rounded-full" : "rounded-[1px]",
          )}
          style={{
            opacity: d === null ? 0.07 : 0.15,
            animation: d === null ? "none" : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export default function LoadingState({
  label = "Churning",
  variant = "Drive",
  since,
  showTimer = true,
  className,
}: {
  label?: string;
  variant?: LoadingVariant;
  /** Epoch ms the work started, so the timer survives re-mounts. */
  since?: number;
  showTimer?: boolean;
  className?: string;
}) {
  const elapsed = useElapsed(since);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex w-fit items-center gap-2.5", className)}
    >
      <PixelGrid variant={variant} />
      <span
        className="loader-label bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
          backgroundSize: "200% 100%",
          animation: "loader-shimmer 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      {showTimer && (
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{elapsed}</span>
      )}
    </div>
  );
}
