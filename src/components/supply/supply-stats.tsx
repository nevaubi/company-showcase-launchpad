// The stat strip at the top of the supply-chain page: six figures in one row of equal cells (three rows of two on a
// phone). Every cell has the same height whatever it holds, so nothing below it moves when the company changes.
import type { ReactNode } from "react";
import { Globe2, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { freshness } from "@/lib/supply/analytics";
import { fmtCompactUsd, fmtDate } from "@/lib/format";

export interface SupplyStatsProps {
  loading: boolean;
  /** names on the map and the filing statements behind them */
  names: number;
  statements: number;
  /** each name once: largest stated flow, or stated customer share x SEC revenue */
  exposureTotal: number;
  exposureNames: number;
  otherFigures: number;
  concentrated: number;
  topShare: number | null;
  single: number;
  dependency: number;
  hotspots: string[];
  /** hotspots come from the link sentences themselves, or only from the company's other filings and calls */
  hotspotsFromLinks: boolean;
  /** filing dates of the statements, for the freshness tally */
  filed: string[];
  today: string;
}

function Cell({ label, icon, value, hint, loading }: { label: string; icon?: ReactNode; value: ReactNode; hint: string; loading: boolean }) {
  return (
    <div className="flex h-[68px] min-w-0 flex-col justify-center bg-card px-3">
      <p className="flex items-center gap-1 truncate text-[11px] leading-4 text-muted-foreground">{icon}{label}</p>
      {/* a zero while the records are still loading reads as "none", so hold a placeholder until they arrive */}
      {loading ? <Skeleton className="my-0.5 h-5 w-16" /> : <p className="num truncate text-lg font-semibold leading-6">{value}</p>}
      <p className="truncate text-[11px] leading-4 text-muted-foreground" title={loading ? undefined : hint}>{loading ? "Loading records" : hint}</p>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SupplyStats(p: SupplyStatsProps) {
  const tally = { fresh: 0, aging: 0, stale: 0 };
  for (const f of p.filed) tally[freshness(f, p.today).status]++;
  const newest = p.filed.reduce((m, f) => (f > m ? f : m), "");
  return (
    <div data-tour="supply-stats" data-section="Supply stats" className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border shadow-paper sm:grid-cols-3 lg:grid-cols-6">
      <Cell loading={p.loading} label="Named counterparties" value={p.names} hint={`${plural(p.statements, "filing statement")}`} />
      <Cell loading={p.loading} label="Disclosed exposure" value={p.exposureNames ? fmtCompactUsd(p.exposureTotal) : "–"}
        hint={p.exposureNames ? `${plural(p.exposureNames, "name")} with a stated flow or share${p.otherFigures ? ` · ${plural(p.otherFigures, "other figure")} not added` : ""}` : p.otherFigures ? `no stated flow · ${plural(p.otherFigures, "other figure")} not added` : "no stated flow or share"} />
      <Cell loading={p.loading} label="Concentrated, 10% or more" value={p.concentrated} hint={p.topShare != null ? `largest stated share ${p.topShare}%` : "no share of 10% or more stated"} />
      <Cell loading={p.loading} label="Single source" icon={<Lock className="size-3 shrink-0" aria-hidden="true" />} value={p.single}
        hint={p.dependency ? `sole-source wording · ${plural(p.dependency, "more stated dependency", "more stated dependencies")}` : "sole-source wording in the filing"} />
      <Cell loading={p.loading} label="Hotspot regions" icon={<Globe2 className="size-3 shrink-0" aria-hidden="true" />} value={p.hotspots.length}
        hint={p.hotspots.length ? `${p.hotspots.join(", ")}${p.hotspotsFromLinks ? "" : " · named in filings and calls"}` : "none named in filings or calls"} />
      <Cell loading={p.loading} label="Newest filing read" value={newest ? fmtDate(newest) : "–"} hint={p.filed.length ? `${tally.fresh} fresh · ${tally.aging} aging · ${tally.stale} stale` : "no statements yet"} />
    </div>
  );
}
