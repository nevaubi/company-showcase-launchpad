import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Segmented } from "@/components/app/segmented";
import { datasetHref, recordHref, type DatasetSearch } from "@/lib/sources/links";
import type { BoardTile } from "@/lib/sources/boards/types";
import { TileChart } from "./tile-chart";

/**
 * Height of a board tile's chart: ten ranked bars with their names above them need 20px a row, so every chart
 * of a board is this tall and the charts of a row still end on one line.
 */
export const BOARD_CHART_HEIGHT = 200;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-24T09:58:23Z" as "24 Nov 2026" (UTC), the day the stored copy was retrieved. */
export function collectedOn(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** The records behind a tile: its snapshot pinned and, where the address allows, the series filter set. */
export function recordsSearch(tile: BoardTile): DatasetSearch {
  const search: DatasetSearch = { snapshot: tile.source.snapshotId ?? undefined };
  if ("across" in tile.selection) {
    const period = tile.result.ok ? tile.result.derivation?.inputs[0]?.period : undefined;
    if (period) search.period = period;
    return search;
  }
  const series = tile.selection.series;
  if ("by" in series) {
    if (series.by === "geo_code" || series.by === "geo_name") search.geography = series.key;
    else search.entity = series.key;
  } else if ("where" in series && series.where.length === 1) {
    search.q = series.where[0].value;
  }
  return search;
}

/** One insight tile: the figure and its sentence, the chart (or its table), the caveat and the source line. */
export function Tile({ tile }: { tile: BoardTile }) {
  const navigate = useNavigate();
  const [view, setView] = useState<"chart" | "table">("chart");
  const result = tile.result;
  if (!result.ok) return null;
  const snapshot = tile.source.snapshotId ?? "";
  const rowHref = (row: number) => recordHref(tile.source.datasetId, snapshot, row);
  const open = (href: string) => navigate({ href });
  const recordsAt = datasetHref(tile.source.datasetId, recordsSearch(tile));
  const collected = collectedOn(tile.source.retrievedAt);
  const percent = result.figureUnit === "%";
  const isRank = tile.form === "ranked-bars";

  return (
    <article data-section={tile.title} className="row-span-4 grid min-w-0 grid-cols-1 grid-rows-subgrid gap-y-0 rounded-md border bg-card shadow-paper">
      <header className="flex items-start gap-2 px-3.5 pb-1 pt-3">
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold leading-snug tracking-tight">{tile.title}</h3>
        <Segmented
          size="xs"
          label={`${tile.title}: chart or table`}
          value={view}
          onChange={setView}
          options={[
            { v: "chart", l: "Chart" },
            { v: "table", l: "Table" },
          ]}
        />
      </header>
      <div className="px-3.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="text-[18px] font-semibold leading-tight">
            {result.figure}
            {percent ? "%" : ""}
          </span>
          {!percent && result.figureUnit && <span className="text-[11px] text-muted-foreground">{result.figureUnit}</span>}
          <span className="ml-auto text-[11px] text-muted-foreground">{result.asOf}</span>
        </p>
        <p className="mt-1 text-[13px] leading-snug">{result.headline}</p>
      </div>
      <div className="px-3.5 pt-2">
        {view === "chart" ? (
          <>
            <p className="mb-1 text-[11px] text-muted-foreground">{result.plotUnit}</p>
            <TileChart
              form={tile.form}
              points={result.points}
              unit={result.plotUnit}
              label={`${tile.title}, ${isRank ? result.asOf : `${result.points[0]?.label ?? ""} to ${result.points[result.points.length - 1]?.label ?? ""}`}, ${result.plotUnit}`}
              recordHref={rowHref}
              onOpen={open}
              height={BOARD_CHART_HEIGHT}
            />
          </>
        ) : (
          <TileTable tile={tile} rowHref={rowHref} />
        )}
      </div>
      <footer className="mt-2 space-y-1 self-end border-t px-3.5 py-2 text-[11px] leading-snug text-muted-foreground">
        {tile.note && <p>{tile.note}</p>}
        {result.gaps.count + result.gaps.noBase > 0 && (
          <p>
            {result.gaps.count > 0 && `${result.gaps.count} ${result.gaps.count === 1 ? "period has" : "periods have"} no figure in the source and ${result.gaps.count === 1 ? "is" : "are"} left out. `}
            {result.gaps.noBase > 0 && `${result.gaps.noBase} ${result.gaps.noBase === 1 ? "period has" : "periods have"} no figure a year earlier.`}
          </p>
        )}
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0">
            {tile.source.publisher}, {tile.source.table}
            {tile.source.code && tile.source.code !== tile.source.table ? ` (${tile.source.code})` : ""}, {result.asOf}
            {collected ? `, collected ${collected}` : ""}
          </span>
          <a
            href={recordsAt}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              open(recordsAt);
            }}
            className="ml-auto font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
          >
            Open records
          </a>
        </p>
      </footer>
    </article>
  );
}

/** Every point of the chart as a table: the figure as printed, the cell as stored, a link to its record. */
function TileTable({ tile, rowHref }: { tile: BoardTile; rowHref: (row: number) => string }) {
  if (!tile.result.ok) return null;
  const r = tile.result;
  const isRank = tile.form === "ranked-bars";
  const rows = isRank ? r.points : [...r.points].reverse();
  return (
    <div className="min-w-0 overflow-x-auto" style={{ minHeight: BOARD_CHART_HEIGHT + 18 }}>
      <table className="w-full text-[11px]">
        <caption className="sr-only">
          {tile.title}, {r.plotUnit}
        </caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">{isRank ? "Name" : "Period"}</th>
            <th className="py-1 pr-2 text-right font-medium">{r.plotUnit}</th>
            <th className="py-1 pr-2 text-right font-medium">Stored cell</th>
            <th className="py-1 text-right font-medium">Record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.key}-${p.row}`} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2">{p.label}</td>
              <td className="num py-1 pr-2 text-right">{p.display}</td>
              <td className="num py-1 pr-2 text-right text-muted-foreground">{p.text === null ? "null" : p.text === "" ? "empty" : p.text}</td>
              <td className="py-1 text-right">
                <a href={rowHref(p.row)} className="num underline-offset-2 hover:underline">
                  {p.row}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
