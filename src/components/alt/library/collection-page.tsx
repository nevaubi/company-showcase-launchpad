import { useDeferredValue, useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { Button } from "@/components/ui/button";
import type { Collection } from "@/lib/sources/catalog";
import { SHAPE_LABEL } from "@/lib/sources/shape";
import { collectionForSegment } from "./addresses";
import { boardSpec, collectionBoardId } from "@/lib/sources/boards/specs";
import { CollectionBoard } from "./boards";
import { CollectionCard, CollectionCardSkeleton } from "./collection-card";
import { CollectionFacts, CollectionHeader } from "./collection-header";
import { HrefLink } from "./href-link";
import { failureHint, useLibrary } from "./library-data";
import { LibrarySearchRow, type PublisherOption } from "./library-search";
import { collectionCards, libraryFacts, publisherLabel, publisherNames, publisherRows } from "./overview";
import { OVERLAP_NOTE, relatedPages } from "./related";
import { effectiveSort, filterTables, queryWords, resultsCaption, shapeOfParam, sortTables, type CollectionSearch } from "./search";
import { TableList } from "./table-list";
import { orderWithViews } from "./table-rows";

/** One collection (`/app/alt-data/library/c/$collection`): its facts, its board, the app's related pages, its tables. */
export function CollectionPage({
  segment,
  search,
  onSearch,
}: {
  segment: string;
  search: CollectionSearch;
  onSearch: (patch: Partial<CollectionSearch>) => void;
}) {
  const collection = collectionForSegment(segment);
  if (!collection) return <UnknownCollection segment={segment} />;
  return <KnownCollection collection={collection} search={search} onSearch={onSearch} />;
}

function KnownCollection({ collection, search, onSearch }: { collection: Collection; search: CollectionSearch; onSearch: (patch: Partial<CollectionSearch>) => void }) {
  const { lib, loading, failure, retry } = useLibrary();
  const names = useMemo(() => (lib ? publisherNames(lib) : () => undefined), [lib]);
  // the internal specification tables are hidden everywhere else; on their own page they are the point
  const includeHidden = !!collection.internal;
  const mine = useMemo(
    () => (lib ? lib.datasets.filter((r) => r.collectionId === collection.id && (includeHidden || !r.hidden)) : []),
    [lib, collection.id, includeHidden],
  );
  const facts = useMemo(() => (lib ? libraryFacts(lib, mine) : null), [lib, mine]);
  const publishers: PublisherOption[] = useMemo(() => {
    if (!lib) return [];
    const scoped = { ...lib, datasets: mine.map((r) => ({ ...r, hidden: false })) };
    return publisherRows(scoped, names).map((p) => ({ id: p.id, label: p.short, tables: p.tables }));
  }, [lib, mine, names]);
  const deferred = useDeferredValue(search);
  const items = useMemo(() => {
    if (!lib) return null;
    const sort = effectiveSort(deferred.sort, deferred.q, "size");
    const hits = filterTables(mine, { q: deferred.q, shape: shapeOfParam(deferred.shape), pub: deferred.pub, includeHidden }, names);
    return orderWithViews(sortTables(hits, sort), new Map(lib.datasets.map((r) => [r.id, r])));
  }, [lib, mine, deferred, names, includeHidden]);
  const related = relatedPages(collection.id);
  // a collection without a proven board shows none: its tables come straight after the links
  const boardId = collectionBoardId(collection.id);
  const hasBoard = !!(boardId && boardSpec(boardId));
  const filtered = !!(queryWords(deferred.q).length || deferred.shape || deferred.pub);

  return (
    <div className="@container grid grid-cols-1 content-start gap-5">
      <CollectionHeader title={collection.name} description={collection.blurb} />
      {failure ? (
        <DataUnavailable
          title="This collection could not be read"
          hint={failureHint(failure)}
          onRetry={retry}
        />
      ) : (
        <>
          <CollectionFacts facts={facts} loading={loading} />
          {hasBoard && (
            <div className="min-w-0">
              <h2 className="mb-2 text-[14px] font-semibold tracking-tight">What the data says</h2>
              <CollectionBoard collection={collection.id} />
            </div>
          )}
          {related.length > 0 && (
            <section data-section="Related pages" className="min-w-0 rounded-md border bg-card px-3.5 py-2.5 shadow-paper">
              <h2 className="text-[13px] font-semibold tracking-tight">In the app</h2>
              <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {related.map((p) => (
                  <li key={p.href} className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                    <HrefLink href={p.href} className="inline-flex min-h-7 items-center gap-1 rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {p.label}
                      <ArrowUpRight aria-hidden className="size-3 text-muted-foreground" />
                    </HrefLink>
                    <span className="truncate text-[11px] text-muted-foreground">{p.note}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{OVERLAP_NOTE}</p>
            </section>
          )}
          {collection.internal && (
            <p className="text-[13px] text-muted-foreground">
              These are the specifications this library was assembled from. They are kept apart from publisher data and are not counted in the library's figures.
            </p>
          )}
          <TableList
            section="Collection tables"
            storeKey={`fu:library:${collection.id}:focus`}
            loading={loading || !items}
            dim={deferred !== search}
            items={items ?? []}
            publisherLabel={(item) => publisherLabel(item.row, names)}
            heading={
              <div className="grid min-w-0 gap-2 border-b px-3.5 py-2.5">
                <h2 className="text-[14px] font-semibold tracking-tight" aria-live="polite">
                  {items
                    ? filtered
                      ? resultsCaption({
                          count: items.length,
                          q: deferred.q,
                          publisher: deferred.pub ? (names(deferred.pub)?.short ?? deferred.pub) : undefined,
                          shape: deferred.shape ? SHAPE_LABEL[shapeOfParam(deferred.shape)!] : undefined,
                        })
                      : `Tables (${items.length.toLocaleString("en-US")})`
                    : "Tables"}
                </h2>
                <LibrarySearchRow
                  section="Collection search"
                  label={`Search tables in ${collection.name}`}
                  placeholder={`Search in ${collection.name}`}
                  value={search}
                  onChange={onSearch}
                  publishers={publishers}
                  sortDefault="size"
                />
              </div>
            }
            empty={
              <div className="px-3.5 py-6 text-[13px]">
                <p>{deferred.q?.trim() ? `No table in ${collection.name} matches “${deferred.q.trim()}”.` : `No table in ${collection.name} matches these filters.`}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onSearch({ q: undefined, pub: undefined, shape: undefined, sort: undefined })}>
                    Show every table here
                  </Button>
                </div>
              </div>
            }
          />
        </>
      )}
    </div>
  );
}

/** A wrong address is not a dead end: it says so and offers every collection. */
function UnknownCollection({ segment }: { segment: string }) {
  const { lib, failure, retry } = useLibrary();
  let shown = segment;
  try {
    shown = decodeURIComponent(segment);
  } catch {
    /* Keep the address as written. */
  }
  return (
    <div className="@container grid grid-cols-1 content-start gap-5">
      <CollectionHeader title="No such collection" description={`“${shown.slice(0, 80)}” is not one of the library's collections. Choose one of these, or search the whole library.`} />
      {failure ? (
        <DataUnavailable title="The Data library could not be read" hint={failureHint(failure)} onRetry={retry} />
      ) : (
        <section data-section="Collections" className="min-w-0">
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3 @5xl:grid-cols-4">
            {lib
              ? collectionCards(lib).map((card) => <CollectionCard key={card.id} card={card} />)
              : Array.from({ length: 14 }).map((_, i) => <CollectionCardSkeleton key={i} />)}
          </div>
        </section>
      )}
    </div>
  );
}
