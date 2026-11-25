import { useQuery } from "@tanstack/react-query";
import { fieldTitle } from "@/lib/sources/fields";
import type { PeriodFormat } from "@/lib/sources/periods";
import { sourceQueries } from "@/lib/sources/queries";
import type { SourceEntities, SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { entityBars, fillBands, fillBars, periodBars, yearBars } from "./coverage-model";
import { count } from "./dataset-model";
import { readData } from "./dataset-queries";
import { BarList } from "./ui/bar-list";
import { PANEL, QuietLine } from "./ui/primitives";

/** Shown wherever counts need the next database update (migration 0069). */
export const AWAITS_UPDATE = "Counts by period and by entity arrive with the next database update.";

/**
 * The first look of a table no profile can chart: how many records each period holds, which entities hold the most,
 * and how complete each field is. Nothing here reads a cell as a number.
 */
export function CoverageView({
  datasetId,
  snapshot,
  fills,
  columns,
  format,
  entities,
  entityNoun,
  varies,
  view,
  onPeriod,
  onEntity,
}: {
  datasetId: string;
  snapshot: SourceSnapshot;
  fills: SourceFieldFill[] | null;
  columns: number[];
  format: PeriodFormat;
  entities: SourceEntities | null | undefined;
  entityNoun: { one: string; many: string } | null;
  varies: { entity: boolean; geo: boolean; period: boolean };
  view: "chart" | "table";
  onPeriod: (period: string) => void;
  onEntity: (entity: string) => void;
}) {
  const periodFacets = useQuery({
    ...sourceQueries.facets({ datasetId, snapshotId: snapshot.id, dimension: "period", limit: 1000 }),
    enabled: varies.period,
  });
  const entityDimension = varies.entity ? "entity_id" : varies.geo ? "geo_code" : null;
  const entityFacets = useQuery({
    ...sourceQueries.facets({ datasetId, snapshotId: snapshot.id, dimension: entityDimension ?? "entity_id", limit: 1000 }),
    enabled: entityDimension !== null,
  });
  const periods = readData(periodFacets.data);
  const ents = readData(entityFacets.data);
  const many = entityNoun?.many ?? (entityDimension === "geo_code" ? "places" : "entities");

  const years = periods.data && periods.data.values.length > 60 ? yearBars(periods.data.values, format) : null;
  const perPeriod = periods.data ? (years ?? periodBars(periods.data.values, format).slice(-60)) : null;
  const clipped = !!periods.data && !years && periods.data.values.length > 60;
  const top = ents.data ? entityBars(ents.data.values, 10) : null;
  const small = snapshot.columns.length <= 16;
  const bands = fills ? fillBands(fills) : null;

  // what can be drawn: period counts and entity counts need 0069; the entity list of the last period does not
  const periodsPending = varies.period && periodFacets.isPending;
  const showPeriods = !!perPeriod;
  const showEntities = !!top || !!entities;
  const notes: string[] = [];
  if (varies.period && !perPeriod && !periodsPending) notes.push(periods.reason === "unavailable" ? AWAITS_UPDATE : "Records per period could not be counted.");
  const constant = snapshot.ingest.constants?.period;
  if (!varies.period)
    notes.push(
      typeof constant === "string"
        ? `Every record is of one period, ${constant} as the source writes it, so the records are not counted by period.`
        : "No period field: the records are not counted by period.",
    );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      {(notes.length > 0 || periodsPending) && (
        <QuietLine>{periodsPending ? "Counting records by period" : notes.join(" ")}</QuietLine>
      )}
      {showPeriods && (
        <div className={cn(PANEL, "min-w-0 px-4 py-3")} data-section="Records per period">
          <h3 className="text-[13px] font-semibold">Records per period</h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            {years ? `${perPeriod!.length} years, oldest first` : clipped ? `The last 60 of ${count(periods.data!.values.length)} periods` : `${perPeriod!.length} periods, oldest first`}
            {periods.data && !periods.data.complete ? "; more periods exist than are counted" : ""}
            {years ? "." : ". Choose one to see its records."}
          </p>
          {view === "chart" ? (
            <BarList bars={perPeriod!} label="Records per period" onSelect={years ? undefined : (b) => onPeriod(b.key)} />
          ) : (
            <CountTable rows={perPeriod!.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} head={["Period", "Records"]} />
          )}
        </div>
      )}
      <div className={cn("grid min-w-0 grid-cols-1 gap-3", showEntities && "@5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
        <div className={cn(PANEL, "min-w-0 px-4 py-3")} data-section="Filled share">
          <h3 className="text-[13px] font-semibold">How complete the fields are</h3>
          {!fills || !bands ? (
            <QuietLine className="mt-1">This version stores no counts of empty cells.</QuietLine>
          ) : small ? (
            <>
              <p className="mb-2 text-[11px] text-muted-foreground">Share of records with a value in each field, from the counts stored with this version.</p>
              {view === "chart" ? (
                <BarList bars={fillBars(fills, snapshot.columns, snapshot.columns.map((_, i) => i))} max={1} label="Filled share per field" />
              ) : (
                <CountTable rows={fillBars(fills, snapshot.columns, snapshot.columns.map((_, i) => i)).map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} head={["Field", "Filled"]} />
              )}
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 @7xl:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-[11px] text-muted-foreground">{count(snapshot.columns.length)} fields by the share of records that have a value.</p>
                {view === "chart" ? (
                  <BarList
                    bars={bands.map((b) => ({ key: b.band.id, label: b.band.label, value: b.fields, text: `${count(b.fields)} fields`, title: `${b.band.label}: ${count(b.fields)} fields` }))}
                    label="Fields by filled share"
                    labelWidth="minmax(0,13rem)"
                  />
                ) : (
                  <CountTable rows={bands.map((b) => ({ key: b.band.id, label: b.band.label, text: count(b.fields) }))} head={["Filled share", "Fields"]} />
                )}
              </div>
              <div className="min-w-0">
                <p className="mb-2 text-[11px] text-muted-foreground">The fields shown in the records table.</p>
                {view === "chart" ? (
                  <BarList bars={fillBars(fills, snapshot.columns, columns)} max={1} label="Filled share of the fields in the table" labelWidth="minmax(0,14rem)" />
                ) : (
                  <CountTable
                    rows={columns.map((p) => ({ key: String(p), label: fieldTitle(snapshot.columns[p]), text: fills[p] ? `${(fills[p].share * 100).toFixed(1)}%` : "–" }))}
                    head={["Field", "Filled"]}
                  />
                )}
              </div>
            </div>
          )}
        </div>
        {showEntities && (
          <div className={cn(PANEL, "min-w-0 px-4 py-3")} data-section="Entities">
            <h3 className="text-[13px] font-semibold first-letter:uppercase">{many}</h3>
            {top ? (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  The {Math.min(10, top.length)} with the most records{ents.data && !ents.data.complete ? " among those counted" : ""}. Choose one to see its records.
                </p>
                {view === "chart" ? (
                  <BarList bars={top} label={`${many} by records`} onSelect={(b) => onEntity(b.key)} />
                ) : (
                  <CountTable rows={top.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} head={["Name", "Records"]} />
                )}
              </>
            ) : (
              <>
                <p className="mb-2 text-[13px] leading-5">
                  <span className="num font-semibold">{entities!.complete ? count(entities!.entities.length) : `${count(entities!.entities.length)} or more`}</span>{" "}
                  {many} in {entities!.period ?? "the first rows"}
                  {entities!.periodRule === "greatest" ? ", the last period" : ""}. The first in file order:
                </p>
                <ul className="grid grid-cols-1 gap-0.5 text-[13px] leading-5">
                  {entities!.entities.slice(0, 10).map((e) => (
                    <li key={`${e.id}|${e.name}|${e.row}`} className="flex min-w-0 items-baseline gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEntity(e.id || e.name || "")}
                        className="min-w-0 truncate text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {e.name || e.id || "(blank)"}
                      </button>
                      {e.name && e.id && <span className="num shrink-0 text-[11px] text-muted-foreground">{e.id}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CountTable({ rows, head }: { rows: { key: string; label: string; sub?: string; text: string }[]; head: [string, string] }) {
  return (
    <table className="w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr className="text-[11px] text-muted-foreground">
          <th scope="col" className="h-7 border-b px-1 text-left font-normal">
            {head[0]}
          </th>
          <th scope="col" className="h-7 border-b px-1 text-right font-normal">
            {head[1]}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} style={{ height: 29 }}>
            <td className="truncate border-b px-1">
              {r.label}
              {r.sub && <span className="num ml-1.5 text-[11px] text-muted-foreground">{r.sub}</span>}
            </td>
            <td className="num border-b px-1 text-right">{r.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
