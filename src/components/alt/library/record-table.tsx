import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChevronsLeft, Download } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { sourcePageCsv } from "@/lib/sources/export";
import { formatCell, type FieldRole } from "@/lib/sources/fields";
import { formatPeriod, type PeriodFormat } from "@/lib/sources/periods";
import type { SourceEntities } from "@/lib/sources/read-types";
import type { SourceDataset, SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { columnHead, columnWidth } from "./columns-model";
import { ColumnPicker } from "./column-picker";
import { count } from "./dataset-model";
import { datasetQueries } from "./dataset-queries";
import { columnsParam, filterPatch, hasRecordFilter, type DatasetSearch } from "./dataset-search";
import { RecordFilters, type FilterOffer } from "./record-filters";
import { PAGE_SIZE, type RecordDims, type RecordOrder, type RecordPage, type RecordRow } from "./record-read";
import { LibrarySection, NativeCell, PANEL } from "./ui/primitives";

const ROW_H = 29;

/** What the reader sees about the rows on screen, in words. */
export function pageWords(page: RecordPage, order: RecordOrder, filtered: boolean, total: number, format: PeriodFormat): string {
  const n = page.rows.length;
  if (page.scan) {
    const upTo = `up to row ${count(page.scan.to)} of ${count(total)}`;
    if (!n) return page.scan.complete ? `No match ${upTo}, the end of the table.` : `No match ${upTo}. This search read rows ${count(page.scan.from)} to ${count(page.scan.to)}.`;
    return `${count(n)} ${n === 1 ? "match" : "matches"} on this page, ${upTo}${page.scan.complete ? ", the end of the table" : ""}.`;
  }
  if (!n) return filtered ? "No records match these filters." : "No records here.";
  const first = page.rows[0];
  const last = page.rows[n - 1];
  if (order === "file" && !filtered) return `Rows ${count(first.row)} to ${count(last.row)} of ${count(total)}, in file order.`;
  if (order === "new") {
    const a = formatPeriod(first.period, format).text;
    const b = formatPeriod(last.period, format).text;
    const span = a === b ? a : `${a} to ${b}`;
    return `${count(n)} ${filtered ? "matching " : ""}records, ${span}, newest first.`;
  }
  return `${count(n)} matching records, rows ${count(first.row)} to ${count(last.row)}, in file order.`;
}

export function RecordsSection({
  dataset,
  snapshot,
  search,
  setSearch,
  dims,
  offer,
  order,
  newest,
  format,
  roles,
  units,
  columns,
  defaults,
  entities,
  entityNoun,
  periods,
}: {
  dataset: SourceDataset;
  snapshot: SourceSnapshot;
  search: DatasetSearch;
  setSearch: (patch: Partial<DatasetSearch>) => void;
  dims: RecordDims;
  offer: FilterOffer;
  order: RecordOrder;
  newest: boolean;
  format: PeriodFormat;
  roles: FieldRole[];
  /** Units a reviewed profile establishes for its measures, by position. */
  units: Map<number, string>;
  columns: number[];
  defaults: number[];
  entities: SourceEntities | null | undefined;
  entityNoun: string;
  periods: { first: string; last: string } | null | undefined;
}) {
  const filter = { entity: search.entity, geography: search.geography, period: search.period, q: search.q };
  const filtered = hasRecordFilter(filter);
  const query = useQuery(
    datasetQueries.records({
      snapshotId: snapshot.id,
      total: snapshot.loaded_rows,
      dims,
      order,
      filter,
      after: search.after,
      before: search.before,
      columns,
      limit: PAGE_SIZE,
    }),
  );
  const page = query.data;
  const busy = query.isFetching;
  const cursorOrder = order === "new" ? ({ order: "new" } as const) : ({ order: newest ? ("file" as const) : undefined } as const);

  const exportCsv = () => {
    if (!page?.rows.length) return;
    const csv = sourcePageCsv(
      {
        dataset_id: dataset.id,
        snapshot_id: snapshot.id,
        columns: columns.map((c) => snapshot.columns[c]),
        column_indices: columns,
        rows: page.rows.map((r) => ({
          row_number: r.row,
          values: r.cells,
          entity_id: r.entityId,
          entity_name: r.entityName,
          period: r.period,
          geo_level: r.geoLevel,
          geo_code: r.geoCode,
          geo_name: r.geoName,
          source_url: r.sourceUrl,
        })),
        nextCursor: page.next,
        hasMore: page.next !== null,
        total: snapshot.loaded_rows,
      },
      dataset.source_url,
    );
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    const rowsShown = page.rows.map((r) => r.row);
    a.download = `${dataset.id.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 100)}_${snapshot.id.slice(0, 12)}_rows_${Math.min(...rowsShown)}-${Math.max(...rowsShown)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <LibrarySection
      id="records"
      name="Records"
      title="Records"
      meta={`${count(snapshot.loaded_rows)} in this version${order === "new" ? ", newest period first" : ", in file order"}`}
      actions={
        <>
          {newest && !search.q && (
            <Segmented
              label="Order of records"
              value={order}
              onChange={(v) => setSearch(filterPatch({ order: v }))}
              options={[
                { v: "new", l: "Newest first", title: "By period, newest first; rows of one period by row number, last first" },
                { v: "file", l: "File order", title: "As the rows stand in the publisher's file" },
              ]}
            />
          )}
          <ColumnPicker
            columns={snapshot.columns}
            ingest={snapshot.ingest}
            selected={columns}
            defaults={defaults}
            onApply={(positions) => setSearch({ cols: positions.join(",") === defaults.join(",") ? undefined : columnsParam(positions) })}
          />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]" onClick={exportCsv} disabled={!page?.rows.length}>
            <Download className="size-3.5" aria-hidden />
            CSV of this page
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <RecordFilters
          offer={offer}
          search={filter}
          entities={entities}
          entityNoun={entityNoun}
          periods={periods}
          onApply={(patch) => setSearch(filterPatch(patch))}
        />
        <RecordGrid
          snapshot={snapshot}
          columns={columns}
          roles={roles}
          units={units}
          page={page}
          loading={query.isPending}
          dim={query.isPlaceholderData}
          busy={busy}
          error={query.error}
          retry={() => void query.refetch()}
          onOpen={(row) => setSearch({ row })}
          openRow={search.row}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 text-[11px] leading-4 text-muted-foreground" aria-live="polite">
            {page ? pageWords(page, order, filtered, snapshot.loaded_rows, format) : query.isPending ? "Reading records" : ""}
            {page?.scan && !page.scan.complete && page.next !== null && !page.rows.length ? " Keep searching reads the next 50,000 rows." : ""}
          </p>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-[13px]"
              disabled={search.after === undefined && search.before === undefined}
              onClick={() => setSearch({ after: undefined, before: undefined })}
            >
              <ChevronsLeft className="size-3.5" aria-hidden />
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-[13px]"
              disabled={!page || page.previous === null}
              onClick={() => page && page.previous !== null && setSearch({ before: page.previous, after: undefined, ...cursorOrder })}
            >
              <ChevronLeft className="size-3.5" aria-hidden />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-[13px]"
              disabled={!page || page.next === null}
              onClick={() => page && page.next !== null && setSearch({ after: page.next, before: undefined, ...cursorOrder })}
            >
              {page?.scan && !page.rows.length ? "Keep searching" : "Next"}
              <ChevronRight className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </LibrarySection>
  );
}

/** The records grid: a sticky head against the page, a body that scrolls sideways in its own wrapper. */
function RecordGrid({
  snapshot,
  columns,
  roles,
  units,
  page,
  loading,
  dim,
  busy,
  error,
  retry,
  onOpen,
  openRow,
}: {
  snapshot: SourceSnapshot;
  columns: number[];
  roles: FieldRole[];
  units: Map<number, string>;
  page: RecordPage | undefined;
  loading: boolean;
  dim: boolean;
  busy: boolean;
  error: unknown;
  retry: () => void;
  onOpen: (row: number) => void;
  openRow: number | undefined;
}) {
  const head = useRef<HTMLDivElement>(null);
  const names = useMemo(() => {
    const d = snapshot.ingest.dimensions ?? {};
    return new Set([d.entity_name, d.geo_name].filter((p): p is number => typeof p === "number"));
  }, [snapshot.ingest]);
  // widths from the heads and the first page of rows of this field choice, kept while paging so columns do not jump
  const key = columns.join(",");
  const [longest, setLongest] = useState<{ key: string; chars: number[] } | null>(null);
  useEffect(() => {
    if (!page?.rows.length || longest?.key === key) return;
    setLongest({ key, chars: columns.map((_, k) => Math.min(40, Math.max(0, ...page.rows.map((r) => (r.cells[k] ?? "").length)))) });
  }, [page, key, columns, longest]);
  const widths = useMemo(
    () => [
      88,
      ...columns.map((c, k) =>
        columnWidth(snapshot.columns[c], roles[c] === "quantity", names.has(c), longest?.key === key ? longest.chars[k] : 0),
      ),
    ],
    [columns, roles, snapshot.columns, names, longest, key],
  );
  const total = widths.reduce((a, b) => a + b, 0);
  const sync = (e: UIEvent<HTMLDivElement>) => {
    if (head.current) head.current.scrollLeft = e.currentTarget.scrollLeft;
  };
  const cols = (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
  const rows: (RecordRow | null)[] = page ? page.rows : loading ? Array.from({ length: PAGE_SIZE }, () => null) : [];
  return (
    <div className={cn(PANEL)} data-section="Records table" aria-busy={busy || undefined}>
      <div ref={head} className="sticky top-[var(--library-top,6.125rem)] z-[5] overflow-hidden rounded-t-md border-b bg-card">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ minWidth: total }}>
          {cols}
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] h-11 border-r bg-card px-3 text-left align-bottom text-[11px] font-normal text-muted-foreground">
                <span className="block pb-1.5">Row</span>
              </th>
              {columns.map((c) => {
                const h = columnHead(snapshot.columns[c]);
                const right = roles[c] === "quantity";
                return (
                  <th key={c} scope="col" className={cn("h-11 px-3 align-bottom font-normal", right ? "text-right" : "text-left")} title={snapshot.columns[c].description || undefined}>
                    <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{h.title}</span>
                    <span className="block truncate pb-1 text-[11px] leading-4 text-muted-foreground">{h.sub ?? " "}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
        </table>
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-3.5 py-5 text-[13px] text-muted-foreground">
          {errorWords(error)}
          <Button variant="outline" size="xs" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : (
        <div className={cn("overflow-x-auto transition-opacity duration-150 motion-reduce:transition-none", dim && "opacity-50")} onScroll={sync}>
          <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ minWidth: total }}>
            {cols}
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="h-[7.25rem] px-3.5 text-[13px] text-muted-foreground">
                    <span className="sticky left-3.5">No records on this page.</span>
                  </td>
                </tr>
              )}
              {rows.map((r, i) =>
                r ? (
                  <tr key={r.row} className={cn("group", openRow === r.row && "bg-highlight-soft/50")} style={{ height: ROW_H }}>
                    <td className={cn("sticky left-0 z-[1] border-r border-b bg-card p-0 group-hover:bg-secondary", openRow === r.row && "bg-highlight-soft")}>
                      <button
                        type="button"
                        onClick={() => onOpen(r.row)}
                        aria-label={`Open record ${r.row}`}
                        className="num flex h-7 w-full items-center px-3 text-left text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        {r.row.toLocaleString("en-US")}
                      </button>
                    </td>
                    {r.cells.map((cell, k) => {
                      const c = columns[k];
                      const f = formatCell(cell, roles[c], snapshot.columns[c]);
                      return (
                        <td key={c} className={cn("truncate border-b px-3 leading-5 group-hover:bg-secondary/60", f.align === "right" && "num text-right")}>
                          <NativeCell text={f.text} raw={cell} title={f.title ?? (cell && cell.length > 24 ? cell : undefined)} />
                        </td>
                      );
                    })}
                  </tr>
                ) : (
                  <tr key={`s${i}`} style={{ height: ROW_H }} aria-hidden>
                    <td className="sticky left-0 border-r border-b bg-card px-3">
                      <span className="block h-3 w-10 animate-pulse rounded bg-muted" />
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="border-b px-3">
                        <span className="block h-3 w-3/4 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function errorWords(error: unknown): string {
  const reason = (error as { reason?: string } | null)?.reason;
  if (reason === "timeout") return "The database took too long to read these records. Filter by an exact identifier, or try again.";
  if (reason === "not-found") return "This page of records starts at a record that is not in this version. Go to the first page.";
  return "These records could not be read.";
}
