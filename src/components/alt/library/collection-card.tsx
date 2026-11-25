import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact } from "@/lib/format";
import { collectionSlug } from "./addresses";
import type { CollectionCardModel } from "./overview";
import { ShapeBar } from "./shape-bar";
import { utcDayRange } from "./table-rows";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** One collection: what it holds, who publishes it, its tables by shape and when they were collected. */
export function CollectionCard({ card }: { card: CollectionCardModel }) {
  const publishers = card.publishers.join(", ") + (card.morePublishers ? ` and ${card.morePublishers} more` : "");
  return (
    <Link
      to="/app/alt-data/library/c/$collection"
      params={{ collection: collectionSlug(card.id) }}
      title={card.blurb}
      className="group flex h-[118px] min-w-0 flex-col rounded-md border bg-card px-3 py-2.5 shadow-paper transition-shadow duration-150 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight group-hover:underline">{card.name}</h3>
        <span className="num shrink-0 text-[13px]">{plural(card.tables, "table", "tables")}</span>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{publishers}</p>
      <ShapeBar counts={card.shapes} className="mt-auto" />
      <div className="mt-2 flex min-w-0 items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="num truncate" title={`${card.records.toLocaleString("en-US")} records in original tables${card.views ? `; ${plural(card.views, "view", "views")} of them not added` : ""}`}>
          <span className="text-[13px] text-foreground">{fmtCompact(card.records)}</span> records
        </span>
        <span className="shrink-0">Collected {utcDayRange(card.collected.first, card.collected.last)}</span>
      </div>
    </Link>
  );
}

/** A card's place while the library loads: same size, so nothing moves when it arrives. */
export function CollectionCardSkeleton() {
  return (
    <div aria-hidden className="flex h-[118px] flex-col rounded-md border bg-card px-3 py-2.5">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <Skeleton className="mt-auto h-2 w-full rounded-full" />
      <Skeleton className="mt-2 h-3 w-3/4" />
    </div>
  );
}
