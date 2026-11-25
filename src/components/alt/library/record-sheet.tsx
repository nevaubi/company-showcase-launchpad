import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCell, statedUnit, type FieldRole } from "@/lib/sources/fields";
import { formatPeriod, type PeriodFormat } from "@/lib/sources/periods";
import { safeSourceHref } from "@/lib/sources/presentation";
import type { SourceDataset, SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { columnHead, matchField, searchWords } from "./columns-model";
import { count, utcStamp } from "./dataset-model";
import { datasetQueries } from "./dataset-queries";
import type { WholeRecord } from "./record-read";
import { CopyButton, NativeCell, QuietLine, ShortHash } from "./ui/primitives";

const ROW = 48;
const OVERSCAN = 10;

/** The title of a record: its entity name, else its entity id, else its first two shown values; never a place alone. */
export function recordTitle(record: Pick<WholeRecord, "entityName" | "entityId" | "values" | "row">, shown: readonly number[]): string {
  if (record.entityName?.trim()) return record.entityName.trim();
  if (record.entityId?.trim()) return record.entityId.trim();
  const parts = shown
    .map((p) => record.values[p])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .slice(0, 2);
  return parts.length ? parts.join(" · ") : `Record ${record.row.toLocaleString("en-US")}`;
}

export function RecordSheet({
  dataset,
  snapshot,
  row,
  shown,
  roles,
  format,
  entityNoun,
  onClose,
  onFilter,
  recordUrl,
}: {
  dataset: SourceDataset;
  snapshot: SourceSnapshot;
  row: number | undefined;
  shown: number[];
  roles: FieldRole[];
  format: PeriodFormat;
  entityNoun: string;
  onClose: () => void;
  onFilter: (patch: { entity?: string; geography?: string }) => void;
  recordUrl: (row: number) => string;
}) {
  const open = row !== undefined;
  const query = useQuery({ ...datasetQueries.record(snapshot.id, row ?? 0), enabled: open });
  const record = query.data;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[47.5rem]" data-section="Record" onInteractOutside={(e) => e.preventDefault()}>
        {open && (
          <>
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle className="pr-8 text-sm font-semibold leading-5">
                {record ? recordTitle(record, shown) : query.isPending ? `Record ${row!.toLocaleString("en-US")}` : "Record not found"}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="grid gap-1 text-[11px] leading-4">
                  {record && <RecordFacts record={record} total={snapshot.loaded_rows} noun={entityNoun} format={format} />}
                  {!record && !query.isPending && (
                    <span>
                      Record {row!.toLocaleString("en-US")} is not in this version ({count(snapshot.loaded_rows)} records).
                    </span>
                  )}
                </div>
              </SheetDescription>
              {record && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(record.entityId || record.entityName) && (
                    <Button variant="outline" size="xs" className="text-[13px]" onClick={() => onFilter({ entity: record.entityId || record.entityName || undefined })}>
                      All records of this {entityNoun.toLowerCase()}
                    </Button>
                  )}
                  {(record.geoCode || record.geoName) && (
                    <Button variant="outline" size="xs" className="text-[13px]" onClick={() => onFilter({ geography: record.geoCode || record.geoName || undefined })}>
                      All records of this place
                    </Button>
                  )}
                  {safeSourceHref(record.sourceUrl ?? dataset.source_url) && (
                    <a
                      href={safeSourceHref(record.sourceUrl ?? dataset.source_url)!}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded border px-2 text-[13px] hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      At the publisher <ArrowUpRight className="size-3.5" aria-hidden />
                    </a>
                  )}
                  <span className="inline-flex h-7 items-center rounded border pl-2 text-[13px]">
                    Link to this record
                    <CopyButton text={recordUrl(record.row)} label="Copy a link to this record" />
                  </span>
                </div>
              )}
            </SheetHeader>
            {query.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-5 text-[13px] text-muted-foreground">
                This record could not be read.
                <Button variant="outline" size="xs" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              </div>
            ) : (
              <RecordFields record={record} loading={query.isPending} snapshot={snapshot} shown={shown} roles={roles} />
            )}
            <div className="border-t px-4 py-2.5 text-[11px] leading-4 text-muted-foreground">
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                Version published {utcStamp(snapshot.published_at)}, file
                <ShortHash value={snapshot.file_sha256} label="file SHA-256" />
              </span>
              <span className="block">Values are shown as published, in each field's own unit.</span>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RecordFacts({ record, total, noun, format }: { record: WholeRecord; total: number; noun: string; format: PeriodFormat }) {
  const facts: string[] = [];
  if (record.entityId) facts.push(`${noun} ${record.entityId}`);
  if (record.entityName && record.entityId && record.entityName !== record.entityId) facts.push(record.entityName);
  if (record.geoCode || record.geoName) {
    const level = record.geoLevel ? record.geoLevel[0].toUpperCase() + record.geoLevel.slice(1) : "Place";
    facts.push(`${level} ${[record.geoCode, record.geoName].filter(Boolean).join(", ")}`);
  }
  if (record.period !== null) {
    const p = formatPeriod(record.period, format);
    facts.push(`Period ${p.text}${p.title && p.title !== p.text ? ` (${p.title})` : ""}`);
  }
  facts.push(`Record ${count(record.row)} of ${count(total)}`);
  return <span>{facts.join(" · ")}</span>;
}

function RecordFields({
  record,
  loading,
  snapshot,
  shown,
  roles,
}: {
  record: WholeRecord | null | undefined;
  loading: boolean;
  snapshot: SourceSnapshot;
  shown: number[];
  roles: FieldRole[];
}) {
  const [find, setFind] = useState("");
  const order = useMemo(() => {
    const first = shown.filter((p) => p < snapshot.columns.length);
    const rest = snapshot.columns.map((_, p) => p).filter((p) => !first.includes(p));
    return [...first, ...rest];
  }, [shown, snapshot.columns]);
  const words = searchWords(find);
  const list = useMemo(
    () =>
      order.filter((p) => {
        if (!words.length) return true;
        const value = record?.values[p];
        return matchField(snapshot.columns[p], words) || (typeof value === "string" && words.every((w) => value.toLowerCase().includes(w)));
      }),
    [order, words, record, snapshot.columns],
  );
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 30]);
  useEffect(() => {
    if (!scroller) return;
    const calc = () => {
      const first = Math.max(0, Math.floor(scroller.scrollTop / ROW) - OVERSCAN);
      const last = Math.min(list.length, Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW) + OVERSCAN);
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    calc();
    scroller.addEventListener("scroll", calc, { passive: true });
    const ro = new ResizeObserver(calc);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", calc);
      ro.disconnect();
    };
  }, [scroller, list.length]);
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder={`Search ${count(snapshot.columns.length)} fields and their values`}
            aria-label="Search the fields of this record"
            className="h-8 pl-7 text-[13px]"
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {words.length ? `${count(list.length)} of ${count(order.length)}` : `${count(order.length)} fields`}
        </span>
      </div>
      <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Fields of this record">
        {loading ? (
          <div className="grid gap-2 px-4 py-3" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="block h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : !record ? (
          <QuietLine className="px-4 py-4">No record to show.</QuietLine>
        ) : list.length === 0 ? (
          <QuietLine className="px-4 py-4">No field or value matches "{find}".</QuietLine>
        ) : (
          <div style={{ height: list.length * ROW, position: "relative" }}>
            {list.slice(range[0], range[1]).map((p, i) => {
              const column = snapshot.columns[p];
              const head = columnHead(column);
              const cell = record.values[p] ?? null;
              const f = formatCell(cell, roles[p], column);
              const unit = statedUnit(column);
              const inTable = shown.includes(p);
              return (
                <div
                  key={p}
                  role="listitem"
                  style={{ top: (range[0] + i) * ROW, height: ROW }}
                  className={cn("absolute inset-x-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b px-4", inTable && "bg-secondary/40")}
                >
                  <div className="min-w-0">
                    <span className="block truncate text-[13px] leading-5" title={column.description || head.title}>
                      {head.title}
                    </span>
                    <span className="num block truncate text-[11px] leading-4 text-muted-foreground">
                      {head.code}
                      {inTable ? " · in the table" : ""}
                    </span>
                  </div>
                  <div className={cn("min-w-0", f.align === "right" && "text-right")}>
                    <span className={cn("block truncate text-[13px] leading-5", f.align === "right" && "num")}>
                      <NativeCell text={f.text} raw={cell} title={f.title ?? (cell && cell.length > 30 ? cell : undefined)} />
                    </span>
                    {unit && <span className="block truncate text-[11px] leading-4 text-muted-foreground">{unit}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
