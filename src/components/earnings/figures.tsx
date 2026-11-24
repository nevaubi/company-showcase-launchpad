// Small presentational pieces for sourced figures: a number that opens its source, a signed change,
// and a stat tile. Colour only encodes direction (positive / negative tokens).
import type { ReactNode } from "react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import type { Figure } from "@/lib/earnings/quarters";
import { fmtCompactUsd, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export type FigUnit = "usd" | "usdPerShare" | "pct";

export function fmtFig(v: number | null | undefined, unit: FigUnit): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (unit === "usd") return fmtCompactUsd(v, 1);
  if (unit === "usdPerShare") return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  return fmtPct(v, 1);
}

/** Signed percentage with a true minus: +16.4%, −1.6%. */
export const signedPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "–" : Math.abs(v) * 10 ** (digits + 2) < 0.5 ? `${(0).toFixed(digits)}%` : fmtPct(v, digits, true);
/** Difference of two ratios in percentage points: +0.4 pts. */
export const signedPts = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "–" : Math.abs(v * 100) < 0.05 ? "0.0 pts" : `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pts`;

export const toneText = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || Math.abs(v) < 0.0005 ? "" : v > 0 ? "text-positive" : "text-negative");

export function figTarget(ticker: string, f: Figure, label: string, periodLabel: string, unit: FigUnit): SourceTarget {
  return {
    ticker,
    label,
    periodLabel,
    unit: unit === "pct" ? "pct" : unit,
    value: f.v,
    src: f.cell?.src,
    alts: f.cell?.alts,
    derived: f.cell?.derived ?? f.derived,
    approx: f.cell?.approx,
  };
}

/** A figure that opens its filing (or its formula) in the source panel. */
export function SourceNum({
  ticker,
  f,
  label,
  period,
  unit,
  text,
  className,
}: {
  ticker: string;
  f: Figure | null | undefined;
  label: string;
  period: string;
  unit: FigUnit;
  /** Display text when it differs from the default format (a signed change). */
  text?: string;
  className?: string;
}) {
  const { open } = useSource();
  if (!f) return <span className={cn("num text-muted-foreground", className)}>–</span>;
  const hasSource = !!(f.cell?.src || f.cell?.derived || f.derived);
  const shown = text ?? fmtFig(f.v, unit);
  if (!hasSource) return <span className={cn("num", className)}>{shown}</span>;
  return (
    <button
      type="button"
      onClick={() => open(figTarget(ticker, f, label, period, unit))}
      title={`${label}, ${period}: open the source${f.derived || f.cell?.derived ? " and formula" : ""}`}
      className={cn(
        "num rounded-sm tabular-nums decoration-dotted underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        (f.derived || f.cell?.derived) && "underline decoration-muted-foreground/50",
        className,
      )}
    >
      {shown}
    </button>
  );
}

export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 bg-card px-4 py-2.5", className)}>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-[18px] font-semibold leading-6 tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * Visible mark beside any text or grade a language model wrote (earnings-H3, M6): what wrote it and a
 * link to the source it was written from, so it is never read as the company's words or a computed figure.
 */
export function MachineWritten({ by, href, sourceLabel = "Source" }: { by: string; href?: string; sourceLabel?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
      <span className="rounded-sm border px-1 py-px font-mono text-[10px] tracking-wide uppercase">Machine-written</span>
      <span>{by}</span>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
          {sourceLabel}
        </a>
      )}
    </span>
  );
}
