import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Segmented } from "@/components/app/segmented";
import { datasetHref, recordHref, type DatasetSearch } from "@/lib/sources/links";
import type { BoardTile, CountPoint, TileLine, TilePoint, TileResult, TileShape } from "@/lib/sources/boards/types";
import { CompareChart } from "../charts/compare-chart";
import { CurveChart } from "../charts/curve-chart";
import { DistributionChart } from "../charts/distribution-chart";
import { Sparkline } from "../charts/sparkline";
import { StackedChart } from "../charts/stacked-chart";
import { StateGrid } from "../charts/state-grid";
import { TileChart } from "./tile-chart";

/**
 * Height of a board tile's chart: ten ranked bars with their names above them need 20px a row, so every chart
 * of a board is this tall and the charts of a row still end on one line.
 */
export const BOARD_CHART_HEIGHT = 200;
/** A chart with a legend row above it gives the legend this much of the chart's height. */
const LEGEND = 18;

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
  const selection = tile.selection;
  if ("across" in selection) {
    const period = tile.result.ok ? tile.result.derivation?.inputs[0]?.period : undefined;
    if (period && selection.across.period !== "table") search.period = period;
    return search;
  }
  if ("records" in selection) return search;
  const series = "lines" in selection ? selection.lines[0]?.series : selection.series;
  if (!series) return search;
  if ("by" in series) {
    if (series.by === "geo_code" || series.by === "geo_name") search.geography = series.key;
    else search.entity = series.key;
  } else if ("where" in series && series.where.length === 1) {
    search.q = series.where[0].value;
  }
  return search;
}

/** A count's mark as a chart point: its index stands for the row, so a click finds the count and opens its filter. */
const countPoints = (counts: CountPoint[]): TilePoint[] =>
  counts.map((c, i) => ({ key: c.key, label: c.label, date: c.date, value: c.count, display: c.display, text: null, row: i }));

/** The address a count opens: the records table filtered to it, or the table itself where no filter selects it. */
const countHref = (tile: BoardTile, c: CountPoint | undefined) =>
  datasetHref(tile.source.datasetId, { snapshot: tile.source.snapshotId ?? undefined, ...(c?.filter ?? {}) });

const lineHref = (line: TileLine, row: number) => recordHref(line.source.datasetId, line.source.snapshotId, row);

/** The axis title line above a chart: the unit drawn, in the reader scale where there is one. */
function axisTitleOf(tile: BoardTile, result: Extract<TileResult, { ok: true }>): string | null {
  const shape = result.shape;
  if (shape?.kind === "map" || shape?.kind === "distribution") return null;
  if (shape?.kind === "compare" && shape.layout === "multiples") return null;
  if (shape?.kind === "records") return "Records";
  return result.reader?.axis.title ?? result.plotUnit;
}

/** The chart of a tile, by its form. */
function Figure({ tile, result, open }: { tile: BoardTile; result: Extract<TileResult, { ok: true }>; open: (href: string) => void }) {
  const snapshot = tile.source.snapshotId ?? "";
  const rowHref = (row: number) => recordHref(tile.source.datasetId, snapshot, row);
  const shape: TileShape | undefined = result.shape;
  const span = `${result.points[0]?.label ?? ""} to ${result.points[result.points.length - 1]?.label ?? ""}`;
  const name = (what: string) => `${tile.title}, ${what}`;
  if (!shape) {
    const isRank = tile.form === "ranked-bars";
    return (
      <TileChart
        form={tile.form === "bars" || tile.form === "ranked-bars" ? tile.form : "line"}
        points={result.points}
        unit={result.plotUnit}
        label={name(`${isRank ? result.asOf : span}, ${result.reader?.axis.title ?? result.plotUnit}`)}
        recordHref={rowHref}
        onOpen={open}
        height={BOARD_CHART_HEIGHT}
        axis={result.reader?.axis}
      />
    );
  }
  if (shape.kind === "compare")
    return (
      <CompareChart
        lines={shape.lines}
        layout={shape.layout}
        label={name(`${span}, ${shape.lines.map((l) => l.label).join(", ")}`)}
        recordHref={lineHref}
        onOpen={open}
        height={shape.layout === "overlay" ? BOARD_CHART_HEIGHT - LEGEND : BOARD_CHART_HEIGHT + 16}
        axis={shape.layout === "overlay" ? result.reader?.axis : undefined}
      />
    );
  if (shape.kind === "mix")
    return (
      <StackedChart
        parts={shape.parts}
        whole={shape.whole}
        draw={shape.draw}
        share={shape.share}
        label={name(`${span}, ${shape.share ? "share of the whole" : result.plotUnit}`)}
        recordHref={lineHref}
        onOpen={open}
        height={BOARD_CHART_HEIGHT - LEGEND}
        axis={shape.share ? undefined : result.reader?.axis}
      />
    );
  if (shape.kind === "map") {
    const isCount = tile.transform === "records";
    return (
      <StateGrid
        places={shape.places}
        territories={shape.territories}
        scale={shape.scale}
        domain={shape.domain}
        rangeLabels={rangeLabels(shape)}
        unit={isCount ? "records" : result.plotUnit}
        period={result.asOf}
        label={name(`${result.asOf}, by state`)}
        height={BOARD_CHART_HEIGHT + 14}
        onOpen={(p) => open(p.row !== null ? rowHref(p.row) : datasetHref(tile.source.datasetId, { snapshot, ...(p.filter ?? {}) }))}
      />
    );
  }
  if (shape.kind === "distribution")
    return (
      <DistributionChart
        draw={shape.draw}
        bins={shape.bins}
        points={result.points}
        median={shape.median}
        unit={result.plotUnit}
        label={name(`${result.asOf}, ${shape.count} figures`)}
        recordHref={rowHref}
        periodHref={datasetHref(tile.source.datasetId, recordsSearch(tile))}
        onOpen={open}
        height={BOARD_CHART_HEIGHT}
      />
    );
  if (shape.kind === "curve") {
    return (
      <CurveChart
        latest={shape.latest}
        earlier={shape.earlier}
        latestLabel={shape.latestLabel}
        earlierLabel={shape.earlierLabel}
        unit={result.plotUnit}
        label={name(`${shape.latestLabel}, ${result.plotUnit}`)}
        recordHref={(i, row) => recordHref(shape.sources[i]?.datasetId ?? tile.source.datasetId, shape.sources[i]?.snapshotId ?? snapshot, row)}
        onOpen={open}
        height={shape.earlier ? BOARD_CHART_HEIGHT - LEGEND : BOARD_CHART_HEIGHT}
      />
    );
  }
  if (shape.kind === "records") {
    const points = countPoints(shape.counts);
    return (
      <TileChart
        form={"dimension" in shape.per && shape.per.dimension === "period" ? "bars" : "format" in shape.per ? "bars" : "ranked-bars"}
        points={points}
        unit="records"
        label={name("records")}
        recordHref={(i) => countHref(tile, shape.counts[i])}
        onOpen={open}
        height={BOARD_CHART_HEIGHT}
      />
    );
  }
  return null;
}

function rangeLabels(shape: Extract<TileShape, { kind: "map" }>): [string, string] {
  const drawn = shape.places.filter((p) => p.value !== null);
  if (!drawn.length) return ["–", "–"];
  const lo = drawn.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a));
  const hi = drawn.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
  if (shape.scale === "diverging") {
    const reach = Math.abs(lo.value as number) > Math.abs(hi.value as number) ? lo : hi;
    const text = reach.display.replace(/^[+−-]/, "");
    return [`−${text}`, `+${text}`];
  }
  return [lo.display, hi.display];
}

/**
 * One insight tile: the figure and its sentence, the chart (or its table), the caveat and the source line. A stat tile
 * is the compact form: the figure, its change over a year and a sparkline, nothing else.
 */
export function Tile({ tile, className, focusable }: { tile: BoardTile; className?: string; focusable?: boolean }) {
  const navigate = useNavigate();
  const [view, setView] = useState<"chart" | "table">("chart");
  const result = tile.result;
  if (!result.ok) return null;
  const open = (href: string) => navigate({ href });
  if (result.shape?.kind === "stat") return <StatTile tile={tile} result={result} change={result.shape.change} open={open} className={className} />;
  const recordsAt = datasetHref(tile.source.datasetId, recordsSearch(tile));
  const collected = collectedOn(tile.source.retrievedAt);
  const percent = result.figureUnit === "%";
  const reader = result.reader;
  const axisTitle = axisTitleOf(tile, result);
  const also = tile.source.also ?? [];

  return (
    <article
      data-section={tile.title}
      tabIndex={focusable ? -1 : undefined}
      className={`row-span-4 grid min-w-0 grid-cols-1 grid-rows-subgrid gap-y-0 rounded-md border bg-card shadow-paper outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
    >
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
        {/* A level in a scale unit reads in reader scale, the stored figure as filed directly beneath (scale.ts). */}
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          {reader ? (
            <>
              <span className="text-[18px] font-semibold leading-tight">{reader.figure}</span>
              {reader.unit && <span className="text-[11px] text-muted-foreground">{reader.unit}</span>}
            </>
          ) : (
            <>
              <span className="text-[18px] font-semibold leading-tight">
                {result.figure}
                {percent ? "%" : ""}
              </span>
              {!percent && result.figureUnit && <span className="text-[11px] text-muted-foreground">{result.figureUnit}</span>}
            </>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">{result.asOf}</span>
        </p>
        {reader && <p className="text-[11px] leading-snug text-muted-foreground">{reader.filed}</p>}
        <p className="mt-1 text-[13px] leading-snug">{result.headline}</p>
      </div>
      <div className="min-w-0 px-3.5 pt-2">
        {view === "chart" ? (
          <>
            {axisTitle && <p className="mb-1 text-[11px] text-muted-foreground">{axisTitle}</p>}
            <Figure tile={tile} result={result} open={open} />
          </>
        ) : (
          <TileTable tile={tile} result={result} />
        )}
      </div>
      <footer className="mt-2 space-y-1 self-end border-t px-3.5 py-2 text-[11px] leading-snug text-muted-foreground">
        {tile.note && <p>{tile.note}</p>}
        <Caveats result={result} />
        {result.sourceNote && <p>{result.sourceNote}</p>}
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0">
            {tile.source.publisher}, {tile.source.table}
            {tile.source.code && tile.source.code !== tile.source.table ? ` (${tile.source.code})` : ""}
            {also.length ? ` and ${also.length} more ${also.length === 1 ? "table" : "tables"} (${also.map((a) => a.code ?? a.table).join(", ")})` : ""}, {result.asOf}
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

/** Gaps, missing states, places that are not states and counts without a period, each in one plain sentence. */
function Caveats({ result }: { result: Extract<TileResult, { ok: true }> }) {
  const lines: string[] = [];
  const g = result.gaps;
  if (g.count > 0) lines.push(`${g.count} ${g.count === 1 ? "period has" : "periods have"} no figure in the source and ${g.count === 1 ? "is" : "are"} left out.`);
  if (g.noBase > 0) lines.push(`${g.noBase} ${g.noBase === 1 ? "figure has" : "figures have"} no figure a year earlier.`);
  const shape = result.shape;
  if (shape?.kind === "map") {
    if (shape.missing.length) lines.push(`No figure: ${shape.missing.map((m) => m.name).join(", ")}.`);
    if (shape.others.length) lines.push(`${shape.others.length} ${shape.others.length === 1 ? "record is" : "records are"} not a state and not drawn (${shape.others.slice(0, 3).join(", ")}${shape.others.length > 3 ? ", …" : ""}).`);
    if (shape.territories.length) lines.push(`Territories: ${shape.territories.map((t) => `${t.name} ${t.display}`).join(", ")}.`);
  }
  if (shape?.kind === "mix") lines.push(`Parts and the publisher's total agree within ${shape.largestGap} in every period drawn.`);
  if (shape?.kind === "records" && shape.rest > 0) lines.push(`${shape.rest.toLocaleString("en-US")} records of other values are not drawn.`);
  if (!lines.length) return null;
  return (
    <>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </>
  );
}

/** The compact tile: figure, its change over a year, a sparkline; the figure opens its record. */
function StatTile({
  tile,
  result,
  change,
  open,
  className,
}: {
  tile: BoardTile;
  result: Extract<TileResult, { ok: true }>;
  change: Extract<TileShape, { kind: "stat" }>["change"];
  open: (href: string) => void;
  className?: string;
}) {
  const latest = result.refs.rows[0];
  const href = recordHref(tile.source.datasetId, tile.source.snapshotId ?? "", latest);
  const percent = result.figureUnit === "%";
  const value = result.reader ? result.reader.figure : `${result.figure}${percent ? "%" : ""}`;
  return (
    <article data-section={tile.title} className={`flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2.5 shadow-paper ${className ?? ""}`}>
      <h3 className="truncate text-[11px] font-medium text-muted-foreground" title={tile.title}>
        {tile.title}
      </h3>
      <div className="flex min-w-0 items-end gap-2">
        <a
          href={href}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            open(href);
          }}
          className="shrink-0 rounded-sm text-[18px] font-semibold leading-tight underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={result.headline}
        >
          {value}
        </a>
        <div className="min-w-0 flex-1">
          <Sparkline points={result.points} label={`${tile.title}, ${result.points[0]?.label ?? ""} to ${result.asOf}`} />
        </div>
      </div>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground">
        {!result.reader && !percent && result.figureUnit && <span className="truncate">{result.figureUnit}</span>}
        {change ? (
          <span>
            {/* the sign is printed; no colour, since a rise is good for one series and bad for another */}
            <span className="num text-foreground">
              {change.display}
              {change.unit === "%" ? "%" : ` ${change.unit}`}
            </span>{" "}
            on {change.against}
          </span>
        ) : (
          <span>No change over a year</span>
        )}
        <span className="ml-auto">{result.asOf}</span>
      </p>
    </article>
  );
}

/** Every mark of the chart as a table: the figure as printed, the cell as stored, a link to its record. */
function TileTable({ tile, result }: { tile: BoardTile; result: Extract<TileResult, { ok: true }> }) {
  const snapshot = tile.source.snapshotId ?? "";
  const shape = result.shape;
  const link = (href: string, text: ReactNode) => (
    <a href={href} className="num underline-offset-2 hover:underline">
      {text}
    </a>
  );
  let head: string[];
  let rows: { key: string; cells: ReactNode[] }[];
  if (shape?.kind === "compare" || shape?.kind === "mix") {
    const lines = shape.kind === "compare" ? shape.lines : [...shape.parts, shape.whole];
    const periods = new Map<string, { label: string; date: string }>();
    for (const l of lines) for (const p of l.points) if (p.date) periods.set(p.date, { label: p.label, date: p.date });
    const ordered = [...periods.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    head = ["Period", ...lines.map((l) => l.label)];
    rows = ordered.map((p) => ({
      key: p.date,
      cells: [
        p.label,
        ...lines.map((l) => {
          const point = l.points.find((q) => q.date === p.date);
          return point ? link(recordHref(l.source.datasetId, l.source.snapshotId, point.row), point.display) : "–";
        }),
      ],
    }));
  } else if (shape?.kind === "curve") {
    head = ["Category", shape.latestLabel, ...(shape.earlier && shape.earlierLabel ? [shape.earlierLabel] : [])];
    rows = shape.latest.map((p, i) => ({ key: p.key, cells: [p.label, p.display, ...(shape.earlier ? [shape.earlier[i]?.display ?? "–"] : [])] }));
  } else if (shape?.kind === "records") {
    head = ["What", "Records"];
    rows = shape.counts.map((c) => ({ key: c.key, cells: [c.filter ? link(countHref(tile, c), c.label) : c.label, c.display] }));
  } else {
    const isRank = tile.form === "ranked-bars" || shape?.kind === "map" || shape?.kind === "distribution";
    const points = isRank ? result.points : [...result.points].reverse();
    head = [isRank ? "Name" : "Period", result.plotUnit, "Stored cell", "Record"];
    rows = points.map((p) => ({
      key: `${p.key}-${p.row}`,
      cells: [p.label, p.display, p.text === null ? "null" : p.text === "" ? "empty" : p.text, p.row >= 0 ? link(recordHref(tile.source.datasetId, snapshot, p.row), p.row) : "–"],
    }));
  }
  return (
    <div className="min-w-0 overflow-x-auto" style={{ minHeight: BOARD_CHART_HEIGHT + 18 }}>
      <table className="w-full text-[11px]">
        <caption className="sr-only">
          {tile.title}, {result.plotUnit}
        </caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {head.map((h, i) => (
              <th key={h + i} className={`py-1 pr-2 font-medium ${i ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60 last:border-0">
              {r.cells.map((c, i) => (
                <td key={i} className={`py-1 pr-2 ${i ? "num text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

