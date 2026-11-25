import { Link } from "@tanstack/react-router";
import { Stat, PageHeader } from "@/components/app/page-header";
import { fmtCompact } from "@/lib/format";
import { AltNav } from "./alt-nav";
import { FactSkeleton, FactsRow } from "./library-facts";
import type { LibraryFactsModel } from "./overview";
import { utcDayRange } from "./table-rows";

const n = (v: number) => v.toLocaleString("en-US");

/** A library page's header: the breadcrumb back to the library, the title and its scope sentence, the section tabs. */
export function CollectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="min-w-0">
      <PageHeader
        className="mb-3"
        eyebrow={
          <Link to="/app/alt-data/library" className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Data library
          </Link>
        }
        title={title}
        description={description || undefined}
      />
      <AltNav />
    </div>
  );
}

/** A collection in five figures: tables, records of original tables, publishers, what refreshes, when collected. */
export function CollectionFacts({ facts, loading }: { facts: LibraryFactsModel | null; loading?: boolean }) {
  if (loading || !facts)
    return (
      <FactsRow section="Collection facts">
        {Array.from({ length: 5 }).map((_, i) => (
          <FactSkeleton key={i} />
        ))}
      </FactsRow>
    );
  return (
    <FactsRow section="Collection facts">
      <Stat className="h-[64px]" label="Tables" value={n(facts.tables)} sub={facts.views ? `${n(facts.views)} are views of others` : "each a published file"} />
      <Stat
        className="h-[64px]"
        label="Records"
        value={<span title={`${n(facts.records)} records in original tables; views repeat their parents' records and are not added`}>{fmtCompact(facts.records)}</span>}
        sub={facts.viewRecords ? `${fmtCompact(facts.viewRecords)} more in views` : "in original tables"}
      />
      <Stat className="h-[64px]" label="Publishers" value={n(facts.publishers)} sub={`${n(facts.registeredNames)} names as registered`} />
      <Stat className="h-[64px]" label="Refreshed by a job" value={n(facts.refreshed)} sub={`of ${n(facts.tables)} tables`} />
      <Stat
        className="col-span-2 h-[64px] @3xl:col-span-1"
        label="Collected"
        value={<span className="text-[15px]">{utcDayRange(facts.collected.first, facts.collected.last)}</span>}
        sub="retrieved, not revised"
      />
    </FactsRow>
  );
}
