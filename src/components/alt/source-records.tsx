import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  FileSearch,
  Filter,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SOURCE_PANEL, SOURCE_SELECT, SourceError, SourceLink, SourceStatus } from "./source-ui";
import { querySourceRecords } from "@/lib/sources/functions";
import { sourcePageCsv } from "@/lib/sources/export";
import {
  defaultSourceColumns,
  filterSourceColumns,
  formatNativeValue,
  nativeColumnCode,
  nativeUnit,
  numericColumn,
  sourceAvailability,
  sourceDate,
  sourceDescription,
  sourcePeriods,
} from "@/lib/sources/presentation";
import type {
  SourceColumn,
  SourceDatasetDetail,
  SourceRecord,
  SourceRecordPage,
  SourceSnapshot,
} from "@/lib/sources/schema";
import { sourceFilters, type AltPageSearch, type SourceFilterPatch } from "@/lib/sources/url-state";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const subject = (r: SourceRecord) =>
  r.entity_name ||
  r.geo_name ||
  r.entity_id ||
  r.geo_code ||
  `Source row ${r.row_number.toLocaleString("en-US")}`;
const columnTitle = (c: SourceColumn) => c.title || c.label || c.key;

export function SourceRecordBrowser({
  detail,
  state,
  onChange,
}: {
  detail: SourceDatasetDetail;
  state: AltPageSearch;
  onChange: (patch: Partial<AltPageSearch>) => void;
}) {
  const { dataset, snapshot } = detail;
  const [customColumns, setCustomColumns] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<{ row: SourceRecord; columns: SourceColumn[] } | null>(
    null,
  );
  const [cursors, setCursors] = useState<(number | undefined)[]>([]);
  const indices = customColumns ?? defaultSourceColumns(snapshot?.columns ?? []);
  const query = {
    datasetId: dataset.id,
    snapshotId: snapshot?.id,
    entity: state.entity,
    geography: state.geography,
    period: state.period,
    q: state.q,
    after: state.after,
    limit: PAGE_SIZE,
    columns: indices,
  };
  const records = useQuery({
    queryKey: ["source_records", query],
    queryFn: () => querySourceRecords({ data: query }),
    enabled: sourceAvailability(snapshot).ready && indices.length > 0,
    staleTime: 5 * 60_000,
  });
  const filterKey = JSON.stringify([
    dataset.id,
    snapshot?.id,
    state.entity,
    state.geography,
    state.period,
    state.q,
  ]);
  useEffect(() => {
    setCursors([]);
    setSelected(null);
  }, [filterKey]);
  const filter = (patch: SourceFilterPatch) => onChange(sourceFilters(patch));
  const clear = () =>
    filter({ entity: undefined, geography: undefined, period: undefined, q: undefined });
  const hasFilters = !!(state.entity || state.geography || state.period || state.q);
  const page = records.data;
  const next = () => {
    if (!page?.hasMore || page.nextCursor == null) return;
    setCursors((prior) => [...prior, state.after]);
    onChange({ after: page.nextCursor });
  };
  const previous = () => {
    onChange({ after: cursors[cursors.length - 1] });
    setCursors((prior) => prior.slice(0, -1));
  };
  const exportPage = () => {
    if (!page?.rows.length) return;
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", sourcePageCsv(page, dataset.source_url)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${dataset.id.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 100)}_rows_${page.rows[0].row_number}-${page.rows[page.rows.length - 1].row_number}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Panel
      className={SOURCE_PANEL}
      collapse={false}
      bodyClassName="p-0"
      title={dataset.name}
      subtitle={`${dataset.agency}${dataset.source_id ? ` · ${dataset.source_id}` : ""}`}
      actions={
        <>
          <SourceStatus snapshot={snapshot ?? dataset.latest_snapshot} />
          <SourceLink url={dataset.source_url} />
        </>
      }
    >
      <div data-section="Source records" className="min-w-0">
        <div className="border-b px-3.5 py-2.5">
          {dataset.description && (
            <p className="max-w-4xl text-[12px] leading-relaxed text-muted-foreground">
              {sourceDescription(dataset.description)}
            </p>
          )}
          <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-2 text-[11px] sm:grid-cols-2 @3xl:grid-cols-4">
            <Metadata label="Record grain" value={dataset.grain || "As published"} />
            <Metadata label="Native units" value={dataset.units || "See each source field"} />
            <Metadata
              label="Records / fields"
              value={
                snapshot
                  ? `${snapshot.loaded_rows.toLocaleString("en-US")} / ${snapshot.columns.length.toLocaleString("en-US")}`
                  : "Not collected"
              }
            />
            <Metadata label="Source collected" value={sourceDate(snapshot?.retrieved_at)} />
          </dl>
        </div>
        {snapshot?.status === "ready" ? (
          <>
            <RecordFilters state={state} snapshot={snapshot} onFilter={filter} />
            <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b px-3.5 py-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {state.entity && (
                  <FilterChip
                    label={`Entity: ${state.entity}`}
                    onClear={() => filter({ entity: undefined })}
                  />
                )}
                {state.geography && (
                  <FilterChip
                    label={`Geography: ${state.geography}`}
                    onClear={() => filter({ geography: undefined })}
                  />
                )}
                {state.period && (
                  <FilterChip
                    label={`Period: ${state.period}`}
                    onClear={() => filter({ period: undefined })}
                  />
                )}
                {state.q && (
                  <FilterChip
                    label={`Search: ${state.q}`}
                    onClear={() => filter({ q: undefined })}
                  />
                )}
                {!hasFilters && (
                  <span>Open any record to inspect every native field and its provenance.</span>
                )}
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-[11px] text-muted-foreground"
                    onClick={clear}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <ColumnPicker
                  columns={snapshot.columns}
                  selected={indices}
                  onChange={setCustomColumns}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-[11px] text-muted-foreground"
                  disabled={!page?.rows.length}
                  onClick={exportPage}
                  title="Exports only this page and its selected columns. Import CSV columns as text to preserve native identifier formatting."
                >
                  <Download className="size-3" />
                  Export this page{page?.rows.length ? ` (${page.rows.length})` : ""}
                </Button>
              </div>
            </div>
            {records.isPending ? (
              <Skeleton className="m-3.5 h-[360px]" />
            ) : records.isError && !records.data ? (
              <SourceError retry={() => void records.refetch()}>
                Records could not be read. The source metadata above is still available.
              </SourceError>
            ) : page ? (
              <>
                <RecordTable
                  page={page}
                  selected={selected?.row.row_number}
                  onSelect={(row) => setSelected({ row, columns: page.columns })}
                />
                <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3.5 py-1 text-[11px] text-muted-foreground">
                  <span aria-live="polite">
                    {page.rows.length.toLocaleString("en-US")} records on this page{" "}
                    <span className="mx-1">·</span> {page.total.toLocaleString("en-US")} in this
                    snapshot{hasFilters ? " before filters" : ""}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!state.after}
                      onClick={() => {
                        setCursors([]);
                        onChange({ after: undefined });
                      }}
                    >
                      First
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="size-7 p-0"
                      disabled={!state.after}
                      aria-label="Previous records"
                      onClick={previous}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="size-7 p-0"
                      disabled={!page.hasMore}
                      aria-label="Next records"
                      onClick={next}
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div className="flex gap-3 px-3.5 py-7 text-[13px] text-muted-foreground">
            <FileSearch className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium text-foreground">
                {snapshot?.status === "failed"
                  ? "This snapshot needs attention"
                  : snapshot
                    ? "Records are being loaded"
                    : "Source registered; records not yet available"}
              </p>
              <p className="mt-1">
                {snapshot
                  ? `${snapshot.loaded_rows.toLocaleString("en-US")} of ${snapshot.expected_rows.toLocaleString("en-US")} records are stored. The explorer opens a snapshot after its collection and validation finish.`
                  : "The official source and its scope are listed here. Its native records have not been published to the explorer yet."}
              </p>
            </div>
          </div>
        )}
        <details className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          <summary className="w-fit cursor-pointer select-none font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Coverage and provenance
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-2 pb-1">
            <p>
              Values retain the source's units and period basis. A zero remains a reported zero;{" "}
              <span className="num">—</span> denotes null and{" "}
              <span className="num">&quot;&quot;</span> an empty cell. Entity and geography filters
              use native identifiers or exact names. CSV exports contain the current page and
              selected columns only; import columns as text in spreadsheet apps to retain native
              identifier formatting.
            </p>
            {dataset.notes && (
              <p className="whitespace-pre-wrap leading-relaxed">{dataset.notes}</p>
            )}
            {snapshot && (
              <>
                <CoverageMetadata coverage={snapshot.coverage} />
                <p className="break-all">
                  <span className="font-medium">Snapshot SHA-256:</span>{" "}
                  <span className="font-mono text-[10px]">{snapshot.file_sha256}</span>
                </p>
                <p>
                  <span className="font-medium">Source file:</span>{" "}
                  {snapshot.source_path.split("/").pop()} ·{" "}
                  <span className="font-medium">Collected:</span>{" "}
                  {sourceDate(snapshot.retrieved_at)}
                </p>
              </>
            )}
          </div>
        </details>
        {selected && snapshot && (
          <RecordSheet
            key={`${snapshot.id}:${selected.row.row_number}`}
            row={selected.row}
            selectedColumns={selected.columns}
            snapshot={snapshot}
            dataset={dataset}
            onClose={() => setSelected(null)}
            onFilter={(patch) => {
              setSelected(null);
              filter(patch);
            }}
          />
        )}
      </div>
    </Panel>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}

function CoverageMetadata({ coverage }: { coverage: Record<string, unknown> }) {
  const entries = Object.entries(coverage)
    .filter(
      ([key, value]) =>
        key !== "periods" &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
    )
    .slice(0, 12);
  return entries.length ? (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-2">
          <dt>{key.replace(/_/g, " ")}:</dt>
          <dd className="min-w-0 break-words text-foreground">
            {typeof value === "number" ? value.toLocaleString("en-US") : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  ) : null;
}

function RecordFilters({
  state,
  snapshot,
  onFilter,
}: {
  state: AltPageSearch;
  snapshot: SourceSnapshot;
  onFilter: (patch: SourceFilterPatch) => void;
}) {
  const [values, setValues] = useState({
    q: state.q ?? "",
    entity: state.entity ?? "",
    geography: state.geography ?? "",
    period: state.period ?? "",
  });
  useEffect(
    () =>
      setValues({
        q: state.q ?? "",
        entity: state.entity ?? "",
        geography: state.geography ?? "",
        period: state.period ?? "",
      }),
    [state.q, state.entity, state.geography, state.period],
  );
  const set = (key: keyof typeof values, value: string) =>
    setValues((prior) => ({ ...prior, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onFilter({
      q: values.q.trim() || undefined,
      entity: values.entity.trim() || undefined,
      geography: values.geography.trim() || undefined,
      period: values.period.trim() || undefined,
    });
  };
  const periods = sourcePeriods(snapshot.coverage);
  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 items-end gap-2 border-b px-3.5 py-2.5 sm:grid-cols-2 @4xl:grid-cols-[minmax(160px,1.4fr)_minmax(130px,1fr)_minmax(130px,1fr)_minmax(110px,.8fr)_auto]"
    >
      <label className="min-w-0">
        <span className="mb-1 block text-[10px] text-muted-foreground">
          Find an entity or place
        </span>
        <Input
          value={values.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search record names"
          maxLength={200}
          className="h-8 text-[12px]"
        />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-[10px] text-muted-foreground">
          Entity ID or exact name
        </span>
        <Input
          value={values.entity}
          onChange={(e) => set("entity", e.target.value)}
          placeholder="All entities"
          maxLength={180}
          className="h-8 text-[12px]"
        />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-[10px] text-muted-foreground">
          Geography code or exact name
        </span>
        <Input
          value={values.geography}
          onChange={(e) => set("geography", e.target.value)}
          placeholder="All geographies"
          maxLength={180}
          className="h-8 text-[12px]"
        />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-[10px] text-muted-foreground">Source period</span>
        {periods.length ? (
          <select
            value={values.period}
            onChange={(e) => set("period", e.target.value)}
            className={cn(SOURCE_SELECT, "w-full")}
          >
            <option value="">All periods</option>
            {values.period && !periods.includes(values.period) && (
              <option value={values.period}>{values.period}</option>
            )}
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={values.period}
            onChange={(e) => set("period", e.target.value)}
            placeholder="All periods"
            maxLength={100}
            className="h-8 text-[12px]"
          />
        )}
      </label>
      <Button type="submit" variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]">
        <Filter className="size-3" />
        Apply
      </Button>
    </form>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear ${label}`}
      className="inline-flex max-w-[220px] items-center gap-1 rounded border bg-secondary/30 px-1.5 py-0.5 text-[10px] hover:bg-secondary"
    >
      <span className="truncate">{label}</span>
      <X className="size-2.5 shrink-0" />
    </button>
  );
}

function ColumnPicker({
  columns,
  selected,
  onChange,
}: {
  columns: SourceColumn[];
  selected: number[];
  onChange: (indices: number[]) => void;
}) {
  const [search, setSearch] = useState("");
  const matches = filterSourceColumns(columns, search);
  const toggle = (index: number) =>
    onChange(selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="text-[11px] text-muted-foreground">
          <Columns3 className="size-3" />
          Columns{" "}
          <span className="num">
            {selected.length}/{columns.length.toLocaleString("en-US")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b p-2.5">
          <p className="text-[12px] font-medium">Table fields</p>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Choose up to 12. Every field is available in record details.
          </p>
          <Input
            aria-label="Find a table field"
            placeholder="Search field names or definitions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-[12px]"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1.5">
          {matches.slice(0, 150).map(({ column, index }) => (
            <label
              key={`${column.key}:${index}`}
              className="flex min-h-8 cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-secondary/40"
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--foreground)]"
                checked={selected.includes(index)}
                disabled={selected.includes(index) ? selected.length === 1 : selected.length >= 12}
                onChange={() => toggle(index)}
              />
              <span className="min-w-0">
                <span className="block truncate" title={column.description || columnTitle(column)}>
                  {columnTitle(column)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {nativeColumnCode(column)}
                </span>
              </span>
            </label>
          ))}
          {!matches.length && (
            <p className="p-3 text-[12px] text-muted-foreground">No matching fields.</p>
          )}
          {matches.length > 150 && (
            <p className="p-2 text-[10px] text-muted-foreground">
              Showing 150 of {matches.length.toLocaleString("en-US")}. Refine your field search.
            </p>
          )}
        </div>
        <div className="border-t px-2 py-1">
          <Button
            variant="ghost"
            size="xs"
            className="text-[11px]"
            onClick={() => onChange(defaultSourceColumns(columns))}
          >
            Reset columns
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RecordTable({
  page,
  selected,
  onSelect,
}: {
  page: SourceRecordPage;
  selected?: number;
  onSelect: (row: SourceRecord) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full table-fixed text-[12px]"
        style={{ minWidth: Math.max(720, page.columns.length * 138 + 40) }}
      >
        <colgroup>
          <col className="w-10" />
          {page.columns.map((column, i) => (
            <col key={`${column.key}:${i}`} style={{ width: i === 0 ? 210 : 138 }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b bg-secondary/20 text-left text-[10px] text-muted-foreground">
            <th className="h-10 pl-2 font-normal">
              <span className="sr-only">Inspect record</span>
            </th>
            {page.columns.map((column, i) => (
              <th
                key={`${column.key}:${i}`}
                className={cn("px-2 py-1.5 font-normal", numericColumn(column) && "text-right")}
                title={[
                  nativeColumnCode(column),
                  column.description,
                  column.unit,
                  column.period_basis ?? column.basis,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <span className="block truncate font-medium text-foreground">
                  {columnTitle(column)}
                </span>
                <span className="block truncate font-normal">
                  {column.unit || nativeColumnCode(column)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <tr
              key={row.row_number}
              className={cn(
                "h-8 border-b last:border-0 hover:bg-secondary/35",
                selected === row.row_number && "bg-secondary/60",
              )}
            >
              <td className="pl-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  className="size-7 p-0 text-muted-foreground"
                  aria-label={`Inspect ${subject(row)}`}
                  title={`Inspect ${subject(row)}`}
                  onClick={() => onSelect(row)}
                >
                  <FileSearch className="size-3.5" />
                </Button>
              </td>
              {page.columns.map((column, i) => (
                <td
                  key={`${column.key}:${i}`}
                  className={cn(
                    "truncate px-2",
                    numericColumn(column) && "num text-right",
                    row.values[i] == null && "text-muted-foreground",
                  )}
                  title={
                    row.values[i] == null
                      ? "No value (null)"
                      : row.values[i] === ""
                        ? "Empty source cell"
                        : row.values[i]!
                  }
                >
                  {i === 0 ? (
                    <button
                      type="button"
                      onClick={() => onSelect(row)}
                      className="max-w-full truncate text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {formatNativeValue(row.values[i], column)}
                    </button>
                  ) : (
                    formatNativeValue(row.values[i], column)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {!page.rows.length && (
            <tr>
              <td
                colSpan={page.columns.length + 1}
                className="h-44 px-4 text-center text-[13px] text-muted-foreground"
              >
                No stored records match these filters. Try a native identifier, exact geography name
                or another period.
              </td>
            </tr>
          )}
          {!!page.rows.length &&
            page.rows.length < PAGE_SIZE &&
            Array.from({ length: PAGE_SIZE - page.rows.length }, (_, i) => (
              <tr key={`pad${i}`} className="h-8" aria-hidden>
                <td colSpan={page.columns.length + 1} />
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordSheet({
  row,
  selectedColumns,
  snapshot,
  dataset,
  onClose,
  onFilter,
}: {
  row: SourceRecord;
  selectedColumns: SourceColumn[];
  snapshot: SourceSnapshot;
  dataset: SourceDatasetDetail["dataset"];
  onClose: () => void;
  onFilter: (patch: SourceFilterPatch) => void;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const fields = useMemo(
    () => filterSourceColumns(snapshot.columns, deferredSearch),
    [snapshot.columns, deferredSearch],
  );
  const size = 48;
  const pages = Math.max(1, Math.ceil(fields.length / size));
  const current = Math.min(page, pages - 1);
  const shown = fields.slice(current * size, (current + 1) * size);
  const indices = shown.map((f) => f.index);
  useEffect(() => setPage(0), [deferredSearch]);
  const details = useQuery({
    queryKey: ["source_record_detail", dataset.id, snapshot.id, row.row_number, indices],
    queryFn: () =>
      querySourceRecords({
        data: {
          datasetId: dataset.id,
          snapshotId: snapshot.id,
          after: row.row_number - 1,
          limit: 1,
          columns: indices,
        },
      }),
    enabled: indices.length > 0,
    staleTime: 30 * 60_000,
  });
  // A keyset response is accepted only for the selected source row, never for its next neighbour.
  const record = details.data?.rows.find((r) => r.row_number === row.row_number);
  const isCounty = row.geo_level?.toLowerCase() === "county";
  const entityColumn =
    snapshot.ingest.dimensions.entity_id == null
      ? undefined
      : snapshot.columns[snapshot.ingest.dimensions.entity_id];
  const certificate =
    entityColumn != null && nativeColumnCode(entityColumn).toUpperCase() === "CERT";
  const periodColumn =
    snapshot.ingest.dimensions.period == null
      ? undefined
      : snapshot.columns[snapshot.ingest.dimensions.period];
  const institutionReport =
    dataset.source_id === "FDIC_FINANCIALS" &&
    certificate &&
    periodColumn != null &&
    nativeColumnCode(periodColumn).toUpperCase() === "REPDTE";
  const highlights = (institutionReport ? selectedColumns : [])
    .map((column, index) => ({ column, value: row.values[index] }))
    .filter(
      ({ column, value }) =>
        value != null && value !== "" && !!column.unit && numericColumn(column),
    )
    .slice(0, 3);
  return (
    <Sheet
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[760px]">
        <SheetHeader className="shrink-0 border-b px-5 pb-3 pt-5 text-left">
          <p className="eyebrow flex items-center gap-1.5">
            <FileSearch className="size-3" />
            Native source record
          </p>
          <SheetTitle className="pr-7 text-lg leading-snug">{subject(row)}</SheetTitle>
          <SheetDescription className="text-[11px] leading-relaxed">
            {dataset.name}
            {row.period ? ` · ${row.period}` : ""} · source row{" "}
            {row.row_number.toLocaleString("en-US")}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!!highlights.length && (
            <div className="grid grid-cols-1 border-b sm:grid-cols-3">
              {highlights.map(({ column, value }) => (
                <div
                  key={column.key}
                  className="min-w-0 border-b px-5 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
                >
                  <p
                    className="truncate text-[10px] text-muted-foreground"
                    title={columnTitle(column)}
                  >
                    {columnTitle(column)}
                  </p>
                  <p className="num mt-1 break-words text-[17px] font-semibold leading-tight">
                    {formatNativeValue(value, column)}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{nativeUnit(column)}</p>
                </div>
              ))}
            </div>
          )}
          <div className="border-b px-5 py-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              {row.entity_id && (
                <Metadata
                  label={certificate ? "FDIC certificate" : "Native entity ID"}
                  value={row.entity_id}
                />
              )}
              {row.entity_name && <Metadata label="Entity name" value={row.entity_name} />}
              {(row.geo_code || row.geo_name) && (
                <Metadata
                  label={`${row.geo_level || "Geography"}${row.geo_code ? ` · ${row.geo_code}` : ""}`}
                  value={row.geo_name || row.geo_code!}
                />
              )}
              {row.period && <Metadata label="Source period" value={row.period} />}
            </dl>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(row.entity_id || row.entity_name) && (
                <Button
                  variant="outline"
                  size="xs"
                  className="text-[11px]"
                  onClick={() =>
                    onFilter({ entity: row.entity_id || row.entity_name!, q: undefined })
                  }
                >
                  All records for this {certificate ? "institution" : "entity"}
                </Button>
              )}
              {(row.geo_code || row.geo_name) && (
                <Button
                  variant="outline"
                  size="xs"
                  className="text-[11px]"
                  onClick={() =>
                    onFilter({
                      geography: row.geo_code || row.geo_name!,
                      entity: undefined,
                      q: undefined,
                    })
                  }
                >
                  <MapPin className="size-3" />
                  Explore this {isCounty ? "county" : "geography"}
                </Button>
              )}
              <SourceLink url={row.source_url || dataset.source_url} className="ml-auto">
                Open original source
              </SourceLink>
            </div>
          </div>
          <div className="sticky top-0 z-10 border-b bg-background px-5 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold">Every native field</h3>
              <span className="num text-[10px] text-muted-foreground">
                {fields.length.toLocaleString("en-US")} of{" "}
                {snapshot.columns.length.toLocaleString("en-US")}
              </span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3 text-muted-foreground" />
              <Input
                aria-label="Search record fields"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a field code, name or unit"
                className="h-8 pl-7 text-[12px]"
              />
            </div>
          </div>
          {!fields.length ? (
            <p className="px-5 py-8 text-[13px] text-muted-foreground">
              No fields match this search.
            </p>
          ) : details.isPending ? (
            <Skeleton className="m-5 h-64" />
          ) : details.isError && !details.data ? (
            <SourceError retry={() => void details.refetch()}>
              The record fields could not be read.
            </SourceError>
          ) : !record ? (
            <p role="alert" className="px-5 py-6 text-[13px] text-muted-foreground">
              This source row is not available in the selected snapshot.
            </p>
          ) : (
            <div className="px-5">
              <table className="w-full table-fixed text-[12px]">
                <colgroup>
                  <col className="w-[52%]" />
                  <col className="w-[48%]" />
                </colgroup>
                <thead>
                  <tr className="h-8 border-b text-left text-[10px] text-muted-foreground">
                    <th className="font-normal">Field and source definition</th>
                    <th className="pl-4 text-right font-normal">Native value</th>
                  </tr>
                </thead>
                <tbody>
                  {details.data?.columns.map((column, i) => (
                    <tr key={`${column.key}:${i}`} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-2 text-left font-normal">
                        <span className="block text-[11px] font-medium">{columnTitle(column)}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {nativeColumnCode(column)}
                        </span>
                        {column.description && (
                          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                            {column.description}
                          </p>
                        )}
                      </th>
                      <td className="py-2 pl-4 text-right align-top">
                        <span
                          className={cn(
                            "block break-words",
                            numericColumn(column) && "num",
                            record.values[i] == null && "text-muted-foreground",
                          )}
                        >
                          {formatNativeValue(record.values[i], column)}
                        </span>
                        {nativeUnit(column) && (
                          <span
                            className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground"
                            title={
                              column.scale != null
                                ? `Source scale: ${column.scale}. Displayed without conversion.`
                                : undefined
                            }
                          >
                            {nativeUnit(column)}
                          </span>
                        )}
                        {column.unit_evidence && (
                          <span className="sr-only">Unit evidence: {column.unit_evidence}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex min-h-11 items-center justify-between border-t px-5 text-[11px] text-muted-foreground">
            <span className="num">
              Field page {current + 1} / {pages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="xs"
                aria-label="Previous record fields"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                aria-label="Next record fields"
                disabled={current + 1 >= pages}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="border-t bg-secondary/20 px-5 py-3 text-[10px] leading-relaxed text-muted-foreground">
            <p>
              Values remain as published, in each field's native unit. Monetary scale, percentage
              basis and reporting period come from source metadata. No company relationship is
              inferred from a similar name.
            </p>
            <p className="mt-1.5 break-all">
              <span className="font-medium">Snapshot fingerprint:</span>{" "}
              <span className="font-mono">{snapshot.file_sha256}</span>
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
