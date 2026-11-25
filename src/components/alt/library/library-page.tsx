import { useDeferredValue, useMemo } from "react";
import { PageHeader } from "@/components/app/page-header";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { Button } from "@/components/ui/button";
import { SHAPE_LABEL } from "@/lib/sources/shape";
import { AltNav } from "./alt-nav";
import { BoardSlot } from "./board-slot";
import { ChangesFeed } from "./changes-feed";
import { CollectionCard, CollectionCardSkeleton } from "./collection-card";
import { failureHint, useLibrary } from "./library-data";
import { LibraryFacts } from "./library-facts";
import { LibrarySearchRow, type PublisherOption } from "./library-search";
import {
  changeForKey,
  changeGroupLabel,
  changeLines,
  changeMembers,
  collectionCards,
  libraryFacts,
  newestChangeNote,
  publisherLabel,
  publisherNames,
  publisherRows,
} from "./overview";
import { PublisherList } from "./publisher-list";
import { effectiveSort, filterTables, isFiltering, resultsCaption, shapeOfParam, sortTables, type LibrarySearch } from "./search";
import { ShapeLegend } from "./shape-bar";
import { TableList } from "./table-list";
import { orderWithViews } from "./table-rows";

export const LIBRARY_DESCRIPTION =
  "Official tables from public agencies, stored as published. Every figure opens the record behind it.";

/**
 * The Data library (`/app/alt-data/library`): what the official tables say, which collections and publishers
 * the library holds, what changed; while a search or filter is set, the matching tables in its place.
 */
export function LibraryPage({ search, onSearch }: { search: LibrarySearch; onSearch: (patch: Partial<LibrarySearch>) => void }) {
  const { lib, loading, failure, retry } = useLibrary();
  const names = useMemo(() => (lib ? publisherNames(lib) : () => undefined), [lib]);
  const publishers = useMemo(() => (lib ? publisherRows(lib, names) : []), [lib, names]);
  const options: PublisherOption[] = publishers.map((p) => ({ id: p.id, label: p.short, tables: p.tables }));
  const filtering = isFiltering(search);
  // Typing never waits for the list: the list follows the field a frame later and dims meanwhile.
  const deferred = useDeferredValue(search);
  const group = lib ? changeForKey(lib, deferred.chg) : null;
  const results = useMemo(() => {
    if (!lib || !isFiltering(deferred)) return null;
    const sort = deferred.view === "changes" && !deferred.sort ? "new" : effectiveSort(deferred.sort, deferred.q, "new");
    // a group from What changed lists exactly its tables; the other filters still narrow it
    const base = deferred.chg ? (group ? changeMembers(lib, group) : []) : lib.datasets;
    const hits = filterTables(base, { q: deferred.q, shape: shapeOfParam(deferred.shape), pub: deferred.pub }, names);
    const byId = new Map(lib.datasets.map((r) => [r.id, r]));
    return orderWithViews(sortTables(hits, sort), byId);
  }, [lib, deferred, names, group]);

  return (
    <div className="@container grid grid-cols-1 content-start gap-5">
      <div className="min-w-0">
        <PageHeader className="mb-3" eyebrow="Filings and data" title="Alternative data" description={LIBRARY_DESCRIPTION} />
        <AltNav />
      </div>
      <LibrarySearchRow value={search} onChange={onSearch} publishers={options} sortDefault="new" />
      {failure ? (
        <DataUnavailable
          title="The Data library could not be read"
          hint={failureHint(failure)}
          onRetry={retry}
        />
      ) : filtering ? (
        <TableList
          section="Library tables"
          storeKey="fu:library:focus"
          loading={loading || !results}
          dim={deferred !== search}
          items={results ?? []}
          publisherLabel={(item) => publisherLabel(item.row, names)}
          heading={
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3.5 py-2">
              <h2 className="text-[14px] font-semibold tracking-tight" aria-live="polite">
                {results
                  ? resultsCaption({
                      count: results.length,
                      q: deferred.q,
                      publisher: deferred.pub ? (names(deferred.pub)?.short ?? deferred.pub) : undefined,
                      shape: deferred.shape ? SHAPE_LABEL[shapeOfParam(deferred.shape)!] : undefined,
                      changes: deferred.view === "changes",
                      group: group ? changeGroupLabel(group, names) : undefined,
                    })
                  : "Tables"}
              </h2>
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                onClick={() => onSearch({ q: undefined, shape: undefined, pub: undefined, sort: undefined, view: undefined, chg: undefined })}
              >
                Back to the overview
              </Button>
            </div>
          }
          empty={
            <div className="px-3.5 py-6 text-[13px]">
              <p>
                {deferred.chg && !group
                  ? "This group of publications is no longer listed"
                  : deferred.q?.trim()
                    ? `No table matches “${deferred.q.trim()}”`
                    : "No table matches these filters"}
                {!deferred.chg && (deferred.pub || deferred.shape) ? " with the filters set" : ""}.
              </p>
              <p className="mt-1 text-muted-foreground">
                Try a publisher (FDIC, EIA, FHFA), a series code (CCSA) or a form number (EIA-923).
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {deferred.q?.trim() && (
                  <Button size="sm" variant="outline" onClick={() => onSearch({ q: undefined, sort: undefined })}>
                    Clear search
                  </Button>
                )}
                {(deferred.pub || deferred.shape) && (
                  <Button size="sm" variant="outline" onClick={() => onSearch({ pub: undefined, shape: undefined })}>
                    Clear filters
                  </Button>
                )}
                {deferred.chg && !group && (
                  <Button size="sm" variant="outline" onClick={() => onSearch({ chg: undefined, view: "changes" })}>
                    Every table by its latest publication
                  </Button>
                )}
              </div>
            </div>
          }
        />
      ) : (
        <>
          <LibraryFacts facts={lib ? libraryFacts(lib) : null} note={lib ? newestChangeNote(lib.changes[0] ?? null, names) : null} loading={loading} />
          <BoardSlot section="What the data says" title="What the data says" />
          <section data-section="Collections" className="min-w-0">
            <header className="mb-2 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[14px] font-semibold tracking-tight">Collections</h2>
              <p className="text-[11px] text-muted-foreground">Tables grouped by what they cover; the bar shows each collection's tables by shape</p>
              <ShapeLegend className="@3xl:ml-auto" />
            </header>
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3 @5xl:grid-cols-4">
              {lib
                ? collectionCards(lib, names).map((card) => <CollectionCard key={card.id} card={card} />)
                : Array.from({ length: 14 }).map((_, i) => <CollectionCardSkeleton key={i} />)}
            </div>
          </section>
          <ChangesFeed lines={lib ? changeLines(lib, names) : []} loading={loading} />
          <PublisherList rows={publishers} loading={loading} />
        </>
      )}
    </div>
  );
}
