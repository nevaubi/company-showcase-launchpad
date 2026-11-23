import { cn } from "@/lib/utils";

export interface SparkPoint {
  /** what the point is, for the hover text ("FY2023", "Q3 FY26") */
  label: string;
  value: number | null;
  /** the value as it is printed elsewhere on the page ("44.1%") */
  text?: string;
}

/**
 * A trend mark for a table row or a tile: a quiet line through the earlier points and the latest one as a dot in
 * the accent, so the eye lands on where the figure is now. Gaps break the line. Each point answers a hover with
 * its label and value; the same numbers are printed beside the mark, so nothing is carried by the drawing alone.
 */
export function Spark({ points, width = 64, height = 20, className, name }: { points: SparkPoint[]; width?: number; height?: number; className?: string; name: string }) {
  const have = points.map((p, i) => ({ ...p, i })).filter((p): p is SparkPoint & { i: number; value: number } => p.value != null && Number.isFinite(p.value));
  if (have.length < 2) return null;
  const pad = 3;
  const min = Math.min(...have.map((p) => p.value));
  const max = Math.max(...have.map((p) => p.value));
  const step = points.length > 1 ? (width - 2 * pad) / (points.length - 1) : 0;
  const x = (i: number) => pad + i * step;
  const y = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) / (max - min)) * (height - 2 * pad));
  // one path per unbroken run of points
  const runs: (typeof have)[] = [];
  for (const p of have) {
    const run = runs.at(-1);
    if (run && run.at(-1)!.i === p.i - 1) run.push(p);
    else runs.push([p]);
  }
  const last = have[have.length - 1];
  const first = have[0];
  const say = (p: SparkPoint) => `${p.label}: ${p.text ?? p.value}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${name}, ${first.label} to ${last.label}: ${first.text ?? first.value} to ${last.text ?? last.value}`}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {runs.map((run) =>
        run.length > 1 ? (
          <path key={run[0].i} d={run.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join("")} fill="none" className="stroke-muted-foreground/70" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
        ) : (
          <circle key={run[0].i} cx={x(run[0].i)} cy={y(run[0].value)} r="1.25" className="fill-muted-foreground/70" />
        ),
      )}
      <circle cx={x(last.i)} cy={y(last.value)} r="2.5" className="fill-chart-1 stroke-card" strokeWidth="1" />
      {have.map((p) => (
        <rect key={p.i} x={x(p.i) - step / 2} y={0} width={Math.max(step, 6)} height={height} fill="transparent">
          <title>{say(p)}</title>
        </rect>
      ))}
    </svg>
  );
}
