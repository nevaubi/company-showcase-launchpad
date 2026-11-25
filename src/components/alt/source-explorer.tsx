import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, Search } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceRecordBrowser } from "@/components/alt/source-records";
import {
  SOURCE_PANEL as PANEL,
  SOURCE_SELECT as SELECT,
  SourceError,
  SourceStatus,
} from "@/components/alt/source-ui";
import { getSourceDataset, listSources } from "@/lib/sources/functions";
import { sourceAvailability, sourceDate, sourceSectorName } from "@/lib/sources/presentation";
import type { SourceDataset, SourceDatasetList } from "@/lib/sources/schema";
import { selectSource, type AltPageSearch } from "@/lib/sources/url-state";
import { cn } from "@/lib/utils";

/** The source registry is small metadata. Row values are loaded separately, in bounded projections. */
async function sourceCatalogue(): Promise<SourceDatasetList> {
  const first = await listSources({ data: { limit: 1000 } });
  const datasets = [...first.datasets];
  let cursor = first.nextCursor;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const next = await listSources({ data: { after: cursor, limit: 1000 } });
    datasets.push(...next.datasets);
    cursor = next.nextCursor;
  }
  return { ...first, datasets };
}

export function SourceExplorer({
  state,
  onChange,
}: {
  state: AltPageSearch;
  onChange: (patch: Partial<AltPageSearch>) => void;
}) {
  const catalogue = useQuery({
    queryKey: ["source_catalogue"],
    queryFn: sourceCatalogue,
    staleTime: 60_000,
  });
  const [search, setSearch] = useState("");
  const sector = state.sector ?? "";
  const [availability, setAvailability] = useState("");
  const [page, setPage] = useState(0);
  const all = catalogue.data?.datasets ?? [];
  const scoped = sector ? all.filter((s) => s.sector === sector) : all;
  const chosen =
    state.source ??
    scoped.find((s) => sourceAvailability(s.latest_snapshot).ready)?.id ??
    scoped[0]?.id;
  const detail = useQuery({
    queryKey: ["source_dataset", chosen, state.snapshot],
    queryFn: () => getSourceDataset({ data: { id: chosen!, snapshotId: state.snapshot } }),
    enabled: !!chosen,
    staleTime: 60_000,
  });
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return all.filter(
      (s) =>
        (!sector || s.sector === sector) &&
        (!availability ||
          (availability === "ready"
            ? sourceAvailability(s.latest_snapshot).ready
            : !sourceAvailability(s.latest_snapshot).ready)) &&
        (!needle ||
          `${s.name} ${s.agency} ${sourceSectorName(s.sector)} ${s.grain} ${s.source_id ?? ""}`
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [all, search, sector, availability]);
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const ready = all.filter((s) => sourceAvailability(s.latest_snapshot).ready).length;
  const stored = all.reduce((sum, s) => sum + (s.latest_snapshot?.loaded_rows ?? 0), 0);
  useEffect(() => setPage(0), [search, sector, availability]);
  const select = (id: string) => onChange(selectSource(id));

  return (
    <div className="@container grid grid-cols-1 content-start gap-4" data-section="Source explorer">
      <Panel
        className={PANEL}
        collapse={false}
        bodyClassName="p-0"
        title={
          <span className="flex items-center gap-2">
            <Database className="size-3.5 text-muted-foreground" />
            Source catalogue
          </span>
        }
        subtitle="Official records at their original level of detail. Choose a source, then inspect its entities, geography and fields."
        actions={
          catalogue.data && (
            <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              <span>
                <span className="num font-medium text-foreground">
                  {catalogue.data.total.toLocaleString("en-US")}
                </span>{" "}
                sources
              </span>
              <span>
                <span className="num font-medium text-foreground">
                  {ready.toLocaleString("en-US")}
                </span>{" "}
                ready
              </span>
              <span>
                <span className="num font-medium text-foreground">
                  {stored.toLocaleString("en-US")}
                </span>{" "}
                records across tables
              </span>
            </div>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3 text-muted-foreground" />
            <Input
              aria-label="Search sources"
              placeholder="Search sources, agencies or record types"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-[12px]"
            />
          </div>
          <select
            aria-label="Filter sources by sector"
            value={sector}
            onChange={(e) =>
              onChange({
                sector: e.target.value || undefined,
                source: undefined,
                snapshot: undefined,
                entity: undefined,
                geography: undefined,
                period: undefined,
                q: undefined,
                after: undefined,
              })
            }
            className={cn(SELECT, "max-w-[210px]")}
          >
            <option value="">All sectors</option>
            {catalogue.data?.sectors.map((s) => (
              <option key={s} value={s}>
                {sourceSectorName(s)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter sources by availability"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            className={SELECT}
          >
            <option value="">All sources</option>
            <option value="ready">Ready to explore</option>
            <option value="pending">Awaiting data</option>
          </select>
        </div>
        {catalogue.isPending ? (
          <Skeleton className="m-3.5 h-[220px]" />
        ) : catalogue.isError && !catalogue.data ? (
          <SourceError retry={() => void catalogue.refetch()}>
            The source catalogue is unavailable right now.
          </SourceError>
        ) : !all.length ? (
          <p className="px-3.5 py-6 text-[13px] text-muted-foreground">
            No verified source snapshots are ready yet.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] table-fixed text-[12px]">
                <colgroup>
                  <col className="w-[31%]" />
                  <col className="w-[15%]" />
                  <col className="w-[22%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                    <th className="pl-3.5 font-normal">Source</th>
                    <th className="px-2 font-normal">Sector</th>
                    <th className="px-2 font-normal">One record is</th>
                    <th className="px-2 text-right font-normal">Rows on file</th>
                    <th className="px-2 font-normal">Status</th>
                    <th className="pr-3.5 text-right font-normal">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((dataset) => (
                    <SourceRow
                      key={dataset.id}
                      dataset={dataset}
                      selected={chosen === dataset.id}
                      select={() => select(dataset.id)}
                    />
                  ))}
                  {!visible.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="h-[192px] px-3.5 text-center text-muted-foreground"
                      >
                        No sources match these filters.
                      </td>
                    </tr>
                  )}
                  {!!visible.length &&
                    Array.from({ length: pageSize - visible.length }, (_, i) => (
                      <tr key={`pad${i}`} className="h-[42px]" aria-hidden>
                        <td colSpan={6} />
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="flex h-8 items-center justify-between gap-2 border-t px-3.5 text-[11px] text-muted-foreground">
              <span>
                {filtered.length.toLocaleString("en-US")} sources
                {search || sector || availability ? " match" : " registered"}
              </span>
              <div className="flex items-center gap-1">
                <span className="num mr-1">
                  {currentPage + 1} / {pages}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="size-7 p-0"
                  disabled={currentPage === 0}
                  aria-label="Previous sources"
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="size-7 p-0"
                  disabled={currentPage + 1 >= pages}
                  aria-label="Next sources"
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
      {chosen &&
        (detail.isPending ? (
          <Skeleton className="h-[430px]" />
        ) : detail.isError && !detail.data ? (
          <Panel title="Source records" className={PANEL} bodyClassName="p-0" collapse={false}>
            <SourceError retry={() => void detail.refetch()}>
              This source snapshot is unavailable right now.
            </SourceError>
          </Panel>
        ) : detail.data ? (
          <SourceRecordBrowser
            key={`${chosen}:${detail.data.snapshot?.id ?? "unloaded"}`}
            detail={detail.data}
            state={{ ...state, source: chosen }}
            onChange={onChange}
          />
        ) : null)}
    </div>
  );
}

function SourceRow({
  dataset,
  selected,
  select,
}: {
  dataset: SourceDataset;
  selected: boolean;
  select: () => void;
}) {
  const snapshot = dataset.latest_snapshot;
  return (
    <tr
      className={cn(
        "h-[42px] [&>td]:shadow-[inset_0_-1px_0_var(--border)] last:[&>td]:shadow-none",
        selected ? "bg-secondary/60" : "hover:bg-secondary/30",
      )}
    >
      <td className="py-1 pl-3.5 pr-2">
        <button
          type="button"
          onClick={select}
          aria-pressed={selected}
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="block truncate font-medium underline-offset-2 hover:underline"
            title={dataset.name}
          >
            {dataset.name}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {dataset.agency}
            {dataset.source_id ? ` · ${dataset.source_id}` : ""}
          </span>
        </button>
      </td>
      <td
        className="truncate px-2 text-[11px] text-muted-foreground"
        title={sourceSectorName(dataset.sector)}
      >
        {sourceSectorName(dataset.sector)}
      </td>
      <td className="truncate px-2 text-[11px] text-muted-foreground" title={dataset.grain}>
        {dataset.grain || "As published"}
      </td>
      <td className="num px-2 text-right">
        {snapshot ? snapshot.loaded_rows.toLocaleString("en-US") : "—"}
        {snapshot?.status === "staging" && (
          <span className="block text-[10px] text-muted-foreground">
            of {snapshot.expected_rows.toLocaleString("en-US")}
          </span>
        )}
      </td>
      <td className="px-2">
        <SourceStatus snapshot={snapshot} />
      </td>
      <td className="num pr-3.5 text-right text-[10px] text-muted-foreground">
        {sourceDate(snapshot?.retrieved_at)}
      </td>
    </tr>
  );
}
