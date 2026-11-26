import type { ReactNode } from "react";
import type { ReaderFigure } from "@/lib/sources/boards/scale";
import { dayLabel, showCell, unitLabel } from "@/lib/sources/company/present";
import type { FigureRef, OfficialCell, OfficialSource } from "@/lib/sources/company/types";
import { DatasetLink, RecordLink } from "./record-link";

/**
 * A chart's headline figure: in reader scale when its unit is on the whitelist (boards/scale.ts), with the stored
 * figure and unit as filed directly beneath, otherwise the stored figure with its unit. The figure opens its record,
 * and the period is named beside it.
 */
export function FigureHead({ title, reader, cell, unit, period, at }: { title: ReactNode; reader: ReaderFigure | null; cell: OfficialCell | null; unit: string; period: string | null; at: FigureRef | null }) {
  const shown = showCell(cell, unit);
  const figure = reader ? reader.figure : shown.text || "–";
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{title}</p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        {at ? (
          <RecordLink at={at} className="text-[18px] font-semibold leading-tight text-foreground" title={shown.title}>
            {figure}
          </RecordLink>
        ) : (
          <span className="text-[18px] font-semibold leading-tight">{figure}</span>
        )}
        {!reader && cell?.kind === "number" && <span className="text-[11px] text-muted-foreground">{unitLabel(unit)}</span>}
        {reader?.unit && <span className="text-[11px] text-muted-foreground">{reader.unit}</span>}
        {period && <span className="ml-auto text-[11px] text-muted-foreground">{dayLabel(period)}</span>}
      </p>
      {reader && <p className="truncate text-[11px] leading-snug text-muted-foreground" title={reader.filed}>{reader.filed}</p>}
    </div>
  );
}

const retrievedOn = (s: OfficialSource | null | undefined) => (s?.retrievedAt ? dayLabel(s.retrievedAt.slice(0, 10)) : null);

/** The source line under a chart: publisher and table, the period, when the copy was retrieved, and the table's page. */
export function SourceLine({ children, source, extra, table = "Open table" }: { children: ReactNode; source: OfficialSource | null; extra?: ReactNode; table?: string }) {
  const retrieved = retrievedOn(source);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-snug text-muted-foreground">
      <span className="min-w-0">
        {children}
        {retrieved ? `, retrieved ${retrieved}` : ""}.
        {extra}
      </span>
      {source && (
        <DatasetLink dataset={source.dataset} snapshot={source.snapshot} className="ml-auto font-medium text-foreground">
          {table}
        </DatasetLink>
      )}
    </p>
  );
}
