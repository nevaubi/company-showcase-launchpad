import { Stat } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LibraryFactsModel } from "./overview";
import { utcDayRange, utcMinute } from "./table-rows";

const n = (v: number) => v.toLocaleString("en-US");

/** One fact: label, value, one quiet line. Skeletons hold the final height. */
export function FactsRow({ section, children, className }: { section: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      data-section={section}
      className={cn("grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-md border bg-border shadow-paper @3xl:grid-cols-5 [&>*]:border-b-0 [&>*]:bg-card", className)}
    >
      {children}
    </div>
  );
}

export function FactSkeleton() {
  return (
    <div aria-hidden className="h-[64px] bg-card px-3 py-2">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-1.5 h-5 w-20" />
      <Skeleton className="mt-1.5 h-3 w-28" />
    </div>
  );
}

/** The library in five figures: tables, records, publishers, what refreshes, the newest publication. */
export function LibraryFacts({ facts, note, loading }: { facts: LibraryFactsModel | null; note: string | null; loading?: boolean }) {
  if (loading || !facts)
    return (
      <FactsRow section="Library facts">
        {Array.from({ length: 5 }).map((_, i) => (
          <FactSkeleton key={i} />
        ))}
      </FactsRow>
    );
  return (
    <FactsRow section="Library facts">
      <Stat
        className="h-[64px]"
        label="Tables"
        value={n(facts.tables)}
        sub={facts.views ? `${n(facts.views)} are views of others` : "each a published file"}
      />
      <Stat
        className="h-[64px]"
        label="Records"
        value={<span title={`${n(facts.records)} records in original tables; views repeat their parents' records and are not added`}>{fmtCompact(facts.records)}</span>}
        sub={facts.viewRecords ? `${fmtCompact(facts.viewRecords)} more in views` : "in original tables"}
      />
      <Stat
        className="h-[64px]"
        label="Publishers"
        value={n(facts.publishers)}
        sub={`${n(facts.registeredNames)} names as registered`}
      />
      <Stat
        className="h-[64px]"
        label="Refreshed by a job"
        value={n(facts.refreshed)}
        sub={`of ${n(facts.tables)} tables`}
      />
      <Stat
        className="col-span-2 h-[64px] @3xl:col-span-1"
        label="Last published"
        value={<span className="text-[15px]">{utcMinute(facts.newest)}</span>}
        sub={note ?? `Collected ${utcDayRange(facts.collected.first, facts.collected.last)}`}
      />
    </FactsRow>
  );
}
