import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Segmented } from "@/components/app/segmented";
import type { SourceLibrary, SourceLibraryRow } from "@/lib/sources/read-types";
import { BarList } from "../ui/bar-list";
import { LibrarySection } from "../ui/primitives";
import { ColumnChart, ColumnChartSkeleton } from "./column-chart";
import { unpackTablePeriods } from "./wire";
import { CountPanel, CountTable, PanelNote } from "./panel";
import { countQueries } from "./queries";
import { latestYearsCaption, publishersByTables, recordsByCollection, storeRows, tablesByLatestYear } from "./store-model";
import { TableTimeline } from "./table-timeline";
import { collectionTimeline, timelineCaption } from "./timeline-model";

type Names = (id: string) => { name: string; short: string } | undefined;
const n = (v: number) => v.toLocaleString("en-US");

function useTablePeriods() {
  const query = useQuery(countQueries.periods());
  const map = useMemo(() => (query.data?.ok ? unpackTablePeriods(query.data.data) : null), [query.data]);
  const failed = query.isError || (query.data !== undefined && !query.data.ok);
  return { map, pending: query.isPending, failed };
}

function ViewToggle({ value, onChange }: { value: "chart" | "table"; onChange: (v: "chart" | "table") => void }) {
  return (
    <Segmented
      size="xs"
      label="Charts or tables"
      value={value}
      onChange={onChange}
      options={[
        { v: "chart", l: "Chart" },
        { v: "table", l: "Table" },
      ]}
    />
  );
}

/**
 * What one collection holds: a timeline of its tables (first to last period, by publisher) and its records by
 * publisher. From the catalogue rows the page already holds and the period ranges of the current snapshots.
 */
export function CollectionHolds({ rows, lib, names, onPublisher }: { rows: readonly SourceLibraryRow[]; lib: SourceLibrary; names: Names; onPublisher: (id: string) => void }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [showAll, setShowAll] = useState(false);
  const periods = useTablePeriods();
  const timeline = useMemo(() => (periods.map ? collectionTimeline(rows, periods.map, names) : null), [rows, periods.map, names]);
  const publishers = useMemo(() => publishersByTables({ ...lib, datasets: rows.map((r) => ({ ...r, hidden: false })) }, names, 12), [lib, rows, names]);
  const records = useMemo(
    () =>
      publishers
        .map((p) => {
          const mine = rows.filter((r) => r.publisherId === p.key && r.kind !== "projection" && r.kind !== "derived");
          const total = mine.reduce((s, r) => s + r.rows, 0);
          return { key: p.key, label: p.label, sub: `${p.text} ${p.value === 1 ? "table" : "tables"}`, value: total, text: n(total), title: `${p.label}: ${n(total)} records in ${p.text} tables; views are not added. Shows its tables.` };
        })
        .filter((b) => b.value > 0)
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "en")),
    [publishers, rows],
  );
  const viewsOnly = publishers.filter((p) => !records.some((r) => r.key === p.key));
  const publisherCaption =
    `${n(records.length)} ${records.length === 1 ? "publisher" : "publishers"}; records of views repeat their tables and are not added.` +
    (viewsOnly.length ? ` ${viewsOnly.map((p) => `${p.label} has only views here (${p.text} ${p.value === 1 ? "table" : "tables"})`).join("; ")}.` : "");
  if (!rows.length) return null;
  return (
    <LibrarySection name="What the collection holds" title="What the collection holds" meta="Tables and records as stored; counts, not measures" actions={<ViewToggle value={view} onChange={setView} />}>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {periods.pending ? (
          <CountPanel name="Tables over time" title="Tables over time">
            <ColumnChartSkeleton />
          </CountPanel>
        ) : !timeline ? (
          <PanelNote name="Tables over time" title="Tables over time">The period ranges of the tables could not be read.</PanelNote>
        ) : (
          <CountPanel name="Tables over time" title="Tables over time" caption={timelineCaption(timeline)}>
            {!timeline.rows.length ? null : view === "chart" ? (
              <TableTimeline timeline={timeline} showAll={showAll} onShowAll={() => setShowAll((s) => !s)} />
            ) : (
              <CountTable head={["Table", "Periods"]} rows={timeline.rows.map((r) => ({ key: r.id, label: r.title, sub: r.publisher, text: r.firstLabel === r.lastLabel ? r.firstLabel : `${r.firstLabel} to ${r.lastLabel}` }))} />
            )}
          </CountPanel>
        )}
        <CountPanel name="Records by publisher" title="Records by publisher" caption={publisherCaption}>
          {view === "chart" ? (
            <BarList bars={records} label="Records by publisher" labelWidth="minmax(0,8rem)" onSelect={(b) => onPublisher(b.key)} />
          ) : (
            <CountTable head={["Publisher", "Records"]} rows={records.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} />
          )}
        </CountPanel>
      </div>
    </LibrarySection>
  );
}

/**
 * What the whole library holds: records by collection, tables by the year of their latest period, and the publishers
 * with the most tables. A collection opens its page; a publisher filters the library to its tables.
 */
export function LibraryHolds({ lib, names, onPublisher, now = new Date() }: { lib: SourceLibrary; names: Names; onPublisher: (id: string) => void; now?: Date }) {
  const router = useRouter();
  const [view, setView] = useState<"chart" | "table">("chart");
  const periods = useTablePeriods();
  const collections = useMemo(() => recordsByCollection(lib, names), [lib, names]);
  const publishers = useMemo(() => publishersByTables(lib, names, 10), [lib, names]);
  const anchor = now.getUTCFullYear();
  const years = useMemo(() => (periods.map ? tablesByLatestYear(storeRows(lib), periods.map, anchor) : null), [lib, periods.map, anchor]);
  const yearMarks = years
    ? years.columns.map((c) => ({
        key: c.key,
        value: c.value,
        label: c.key === "earlier" ? c.label : `Latest period in ${c.label}`,
        valueText: `${n(c.value)} ${c.value === 1 ? "table" : "tables"}`,
        lines: c.tables.slice(0, 3).concat(c.tables.length > 3 ? [`and ${n(c.tables.length - 3)} more`] : []),
        title: `${c.label}: ${n(c.value)} ${c.value === 1 ? "table" : "tables"} whose latest period falls in it${c.tables.length ? `, the largest ${c.tables.slice(0, 3).join("; ")}` : ""}`,
        actionable: false,
      }))
    : [];
  return (
    <LibrarySection name="What the library holds" title="What the library holds" meta="Tables and records as stored; counts, not measures" actions={<ViewToggle value={view} onChange={setView} />}>
      <div className="grid min-w-0 grid-cols-1 gap-3">
        {periods.pending ? (
          <CountPanel name="Tables by latest period" title="Tables by the year of their latest period">
            <ColumnChartSkeleton />
          </CountPanel>
        ) : !years ? (
          <PanelNote name="Tables by latest period" title="Tables by the year of their latest period">The period ranges of the tables could not be read.</PanelNote>
        ) : (
          <CountPanel name="Tables by latest period" title="Tables by the year of their latest period" caption={latestYearsCaption(years)}>
            {view === "chart" ? (
              <ColumnChart
                columns={yearMarks}
                label="Tables by the year of their latest period"
                roomFor={44}
                ticks={(room) => {
                  const cols = years.columns;
                  const step = cols.length <= room ? 1 : Math.ceil(cols.length / room);
                  const picked = cols.map((c, index) => ({ index, label: c.key === "earlier" ? "Earlier" : c.label })).filter((t, i) => i === cols.length - 1 || (cols.length - 1 - i) % step === 0);
                  return picked;
                }}
              />
            ) : (
              <CountTable head={["Latest period", "Tables"]} rows={years.columns.map((c) => ({ key: c.key, label: c.label, text: n(c.value) }))} />
            )}
          </CountPanel>
        )}
        <div className="grid min-w-0 grid-cols-1 items-start gap-3 @4xl:grid-cols-2">
          <CountPanel name="Records by collection" title="Records by collection" caption="Records of the tables in each collection; views repeat their tables and are not added.">
            {view === "chart" ? (
              <BarList
                bars={collections}
                label="Records by collection"
                labelWidth="minmax(0,10rem)"
                onSelect={(b) => {
                  const href = collections.find((c) => c.key === b.key)?.href;
                  if (href) void router.navigate({ href });
                }}
              />
            ) : (
              <CountTable head={["Collection", "Records"]} rows={collections.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} />
            )}
          </CountPanel>
          <CountPanel name="Publishers by tables" title="Publishers with the most tables" caption={`The ${n(publishers.length)} with the most tables of ${n(new Set(storeRows(lib).map((r) => r.publisherId)).size)} publishers.`}>
            {view === "chart" ? (
              <BarList bars={publishers} label="Publishers by tables" labelWidth="minmax(0,9rem)" onSelect={(b) => onPublisher(b.key)} />
            ) : (
              <CountTable head={["Publisher", "Tables"]} rows={publishers.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} />
            )}
          </CountPanel>
        </div>
      </div>
    </LibrarySection>
  );
}
