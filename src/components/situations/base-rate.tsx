import { useQuery } from "@tanstack/react-query";
import { signalsQuery, type SignalsFile } from "@/lib/technicals/data";
import { describeBaseRate, SURVIVORSHIP_NOTE, type BaseRate } from "@/lib/situations/data";
import { cn } from "@/lib/utils";

/** Base rate of one technical signal at one horizon, from the pooled history in tech/signals.json. */
export function baseRateOf(sg: SignalsFile | undefined | null, signal: string, horizon = 60): BaseRate | null {
  const s = sg?.signals?.[signal];
  const h = s?.[String(horizon)] as
    | { n?: number; excess?: number; excess_ci?: [number, number]; hit?: number }
    | undefined;
  if (!s || !h || h.excess == null) return null;
  return {
    signal,
    horizon,
    excess: h.excess,
    ci: h.excess_ci ?? null,
    n: h.n ?? null,
    hit: h.hit ?? null,
    first: s.first ?? null,
    last: s.last ?? null,
  };
}

const TONE = {
  positive: "border-positive/40 text-positive",
  negative: "border-negative/40 text-negative",
  none: "border-border text-muted-foreground",
} as const;

/**
 * "Similar setups: 60-day excess +3.0% [0.7 to 5.3], n=107k, 2008-2026". Pass `rate` when the file already carries it
 * (situations evidence); otherwise it is read from tech/signals.json by signal name.
 */
export function BaseRateBadge({
  signal,
  rate,
  horizon = 60,
  compact = false,
  className,
}: {
  signal?: string;
  rate?: BaseRate | null;
  horizon?: number;
  compact?: boolean;
  className?: string;
}) {
  const sg = useQuery({ ...signalsQuery, enabled: !rate && !!signal });
  const br = rate ?? (signal ? baseRateOf(sg.data, signal, horizon) : null);
  const d = describeBaseRate(br);
  if (!d) return null;
  const title = `${d.text}. Excess = average forward return after the signal minus the all-days average over the same horizon; the bracket is a 95% interval. Since 2008 this setup ${d.verdict}. ${SURVIVORSHIP_NOTE}`;
  return (
    <span
      title={title}
      className={cn(
        "num inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-px text-[10.5px] tabular-nums",
        TONE[d.tone],
        className,
      )}
    >
      {compact && br?.excess != null
        ? `${br.horizon}d ${br.excess >= 0 ? "+" : ""}${(br.excess * 100).toFixed(1)}% vs avg`
        : d.text}
    </span>
  );
}
