import { useMemo } from "react";
import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  className,
  tone,
  fill = true,
  strokeWidth = 1.5,
}: {
  values: number[];
  className?: string;
  tone?: "positive" | "negative" | "neutral" | "ink";
  fill?: boolean;
  strokeWidth?: number;
}) {
  const { line, area } = useMemo(() => {
    const vs = values.filter((v) => Number.isFinite(v));
    if (vs.length < 2) return { line: "", area: "" };
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const span = max - min || 1;
    const pts = vs.map((v, i) => [(i / (vs.length - 1)) * 100, 28 - ((v - min) / span) * 26 - 1] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
    return { line, area: `${line}L100,30L0,30Z` };
  }, [values]);
  const t = tone ?? (values.length > 1 && values[values.length - 1] >= values[0] ? "positive" : "negative");
  const color = { positive: "text-positive", negative: "text-negative", neutral: "text-muted-foreground", ink: "text-foreground" }[t];
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-7 w-24 overflow-visible", color, className)} aria-hidden>
      {fill && area && <path d={area} fill="currentColor" opacity={0.09} />}
      {line && <path d={line} fill="none" stroke="currentColor" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
    </svg>
  );
}
