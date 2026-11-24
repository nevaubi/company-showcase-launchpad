// The stat strip at the top of the supply-chain page: six figures in one row of equal cells (three rows of two on a
// phone). Every cell has the same height whatever it holds (a label line, the figure, two lines of sentence), so nothing below
// it moves when the company changes.
import type { ReactNode } from "react";
import { Globe2, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { freshness } from "@/lib/supply/analytics";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import type { StripCell } from "@/lib/supply/strip";

export interface SupplyStatsProps {
  loading: boolean;
  /** names on the map and the filing statements behind them */
  names: number;
  statements: number;
  /** each name once: largest stated flow, or stated customer share x SEC revenue */
  exposureTotal: number;
  exposureNames: number;
  otherFigures: number;
  /** whether the exposure is stated, estimated from shares, or both (`exposureWords`, strip.ts) */
  exposureWords: { label: string; note: string | null; title: string };
  /** the dependency cells, each naming its direction and party (`src/lib/supply/strip.ts`) */
  shares: StripCell;
  single: StripCell;
  hotspots: StripCell;
  /** filing dates of the statements, for the freshness tally */
  filed: string[];
  today: string;
}

function Cell({ label, icon, value, hint, title, loading }: { label: string; icon?: ReactNode; value: ReactNode; hint: string; title?: string; loading: boolean }) {
  return (
    <div className="flex h-[84px] min-w-0 flex-col justify-start bg-card px-3 py-2">
      <p className="flex items-center gap-1 truncate text-[11px] leading-4 text-muted-foreground">{icon}{label}</p>
      {/* a zero while the records are still loading reads as "none", so hold a placeholder until they arrive */}
      {loading ? <Skeleton className="my-0.5 h-5 w-16" /> : <p className="num truncate text-lg font-semibold leading-6">{value}</p>}
      {/* the sentence wraps to a second line: the words that say whose figure it is never live only in the tooltip */}
      <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground" title={loading ? undefined : title ?? hint}>{loading ? "Loading records" : hint}</p>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The line under each figure is short enough to read whole in a cell; the longer account is its tooltip. */
export function SupplyStats(p: SupplyStatsProps) {
  const tally = { fresh: 0, aging: 0, stale: 0 };
  for (const f of p.filed) tally[freshness(f, p.today).status]++;
  const newest = p.filed.reduce((m, f) => (f > m ? f : m), "");
  const others = p.otherFigures ? `${plural(p.otherFigures, "other stated figure")} (guarantees, investments, financing) ${p.otherFigures === 1 ? "is" : "are"} listed in the Exposure tab and never added.` : "";
  return (
    <div data-tour="supply-stats" data-section="Supply stats" className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border shadow-paper sm:grid-cols-3 lg:grid-cols-6">
      <Cell loading={p.loading} label="Named counterparties" value={p.names} hint={`${plural(p.statements, "filing statement")}`} />
      <Cell loading={p.loading} label={p.exposureWords.label} value={p.exposureNames ? fmtCompactUsd(p.exposureTotal) : "–"}
        hint={p.exposureNames ? `from ${plural(p.exposureNames, "name")}${p.exposureWords.note ? ` · ${p.exposureWords.note}` : ""}${p.otherFigures ? ` · ${p.otherFigures} not added` : ""}` : p.otherFigures ? `no stated flow · ${p.otherFigures} not added` : "no stated flow or share"}
        title={`${p.exposureWords.title} ${others}`.trim()} />
      <Cell loading={p.loading} label={p.shares.label} value={p.shares.value} hint={p.shares.hint} title={p.shares.title} />
      <Cell loading={p.loading} label={p.single.label} icon={<Lock className="size-3 shrink-0" aria-hidden="true" />} value={p.single.value} hint={p.single.hint} title={p.single.title} />
      <Cell loading={p.loading} label={p.hotspots.label} icon={<Globe2 className="size-3 shrink-0" aria-hidden="true" />} value={p.hotspots.value} hint={p.hotspots.hint} title={p.hotspots.title} />
      <Cell loading={p.loading} label="Newest filing read" value={newest ? fmtDate(newest) : "–"} hint={p.filed.length ? `${tally.fresh} fresh · ${tally.aging} aging · ${tally.stale} stale` : "no statements yet"}
        title="Age of the filing behind each statement: fresh up to 200 days, aging up to 400, stale after." />
    </div>
  );
}
