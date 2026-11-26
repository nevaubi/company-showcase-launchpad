import { useMemo } from "react";
import { StateGrid } from "@/components/alt/library/charts/state-grid";
import type { SourceEntities, SourceFacetValue } from "@/lib/sources/read-types";
import { entityBars } from "../coverage-model";
import { BarList } from "../ui/bar-list";
import { CountPanel, CountTable, PanelNote } from "./panel";
import { placeBars, readStates, stateBars, stateCaption, stateMapPlaces } from "./places-model";
import type { AllFacets } from "./queries";

const n = (v: number) => v.toLocaleString("en-US");
const TOP = 10;

/** The one value a dimension holds, said in a line instead of a one-bar chart. */
function onlyValue(values: readonly SourceFacetValue[]): SourceFacetValue | null {
  return values.length === 1 ? values[0] : null;
}

/**
 * Records by place: the state grid when the place dimension holds US states by the app's rule (sequential shade of
 * the count, a click opens the state's records), otherwise the places with the most records as ranked bars.
 */
export function PlacePanel({
  facets,
  view,
  onGeography,
}: {
  facets: AllFacets;
  view: "chart" | "table";
  onGeography?: (value: string) => void;
}) {
  const reading = useMemo(() => (facets.complete ? readStates(facets.values) : null), [facets]);
  if (reading) {
    const territories = new Set(reading.states.filter((s) => s.place.kind === "territory").map((s) => s.place.code));
    const places = stateMapPlaces(reading, facets.complete);
    const max = Math.max(0, ...reading.states.map((s) => s.rows));
    return (
      <CountPanel name="Records by state" title="Records by state" caption={stateCaption(reading)}>
        {view === "chart" ? (
          <StateGrid
            places={places.filter((p) => !territories.has(p.code))}
            territories={places.filter((p) => territories.has(p.code))}
            scale="sequential"
            domain={[0, max]}
            rangeLabels={["0", n(max)]}
            unit="records"
            label="Records by state"
            onOpen={onGeography ? (p) => p.filter?.geography && onGeography(p.filter.geography) : undefined}
          />
        ) : (
          <CountTable head={["State", "Records"]} rows={stateBars(reading).map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} />
        )}
      </CountPanel>
    );
  }
  const one = onlyValue(facets.values);
  if (one && facets.complete)
    return (
      <PanelNote name="Records by place" title="Records by place">
        Every record is of one place, {one.label && one.label !== one.value ? `${one.label} (${one.value})` : one.value}.
      </PanelNote>
    );
  const bars = placeBars(facets.values, TOP);
  const caption = facets.complete
    ? `${n(facets.values.length)} places; the ${Math.min(TOP, bars.length)} with the most records.`
    : `The ${Math.min(TOP, bars.length)} with the most records among the first ${n(facets.values.length)} places counted, in code order.`;
  return (
    <CountPanel name="Records by place" title="Records by place" caption={caption}>
      {view === "chart" ? (
        <BarList bars={bars} label="Places by records" labelWidth="minmax(0,8rem)" valueWidth="4.75rem" onSelect={onGeography ? (b) => onGeography(b.key) : undefined} />
      ) : (
        <CountTable head={["Place", "Records"]} rows={bars.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} />
      )}
    </CountPanel>
  );
}

/** Records per entity: the entities that hold the most records, names as stored, a click opens their records. */
export function EntityPanel({
  facets,
  noun,
  total,
  view,
  onEntity,
}: {
  facets: AllFacets;
  noun: { one: string; many: string } | null;
  /** Distinct entities from the snapshot statistics, when the facets did not reach them all. */
  total: number | null;
  view: "chart" | "table";
  onEntity: (key: string) => void;
}) {
  const one = noun?.one ?? "entity";
  const many = noun?.many ?? "entities";
  const title = `Records per ${one}`;
  const name = "Records per entity";
  const single = onlyValue(facets.values);
  if (single && facets.complete)
    return (
      <PanelNote name={name} title={title}>
        Every record is of one {one}, {single.label && single.label !== single.value ? `${single.label} (${single.value})` : single.value}.
      </PanelNote>
    );
  const bars = entityBars(facets.values, TOP);
  const count = facets.complete ? facets.values.length : total;
  const caption = facets.complete
    ? `${n(facets.values.length)} ${facets.values.length === 1 ? one : many}; the ${Math.min(TOP, bars.length)} with the most records.`
    : `${count ? `${n(count)} ${many}. ` : ""}The ${Math.min(TOP, bars.length)} with the most records among the first ${n(facets.values.length)} counted, in id order.`;
  return (
    <CountPanel name={name} title={title} caption={caption}>
      {view === "chart" ? (
        <BarList bars={bars} label={`${many} by records`} labelWidth="minmax(0,8rem)" valueWidth="4.75rem" onSelect={(b) => onEntity(b.key)} />
      ) : (
        <CountTable head={["Name", "Records"]} rows={bars.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} />
      )}
    </CountPanel>
  );
}

/** Before facets: the entities of the last period in file order (the read that needs no update), names as stored. */
export function EntityListPanel({ entities, noun, onEntity }: { entities: SourceEntities; noun: { one: string; many: string } | null; onEntity: (key: string) => void }) {
  const many = noun?.many ?? "entities";
  return (
    <CountPanel
      name="Records per entity"
      title={`${many[0].toUpperCase()}${many.slice(1)}`}
      caption={`${entities.complete ? n(entities.entities.length) : `${n(entities.entities.length)} or more`} ${many} in ${entities.period ?? "the first rows"}${entities.periodRule === "greatest" ? ", the last period" : ""}. The first in file order:`}
    >
      <ul className="grid grid-cols-1 gap-0.5 text-[13px] leading-5">
        {entities.entities.slice(0, TOP).map((e) => (
          <li key={`${e.id}|${e.name}|${e.row}`} className="flex min-w-0 items-baseline gap-1.5">
            <button
              type="button"
              onClick={() => onEntity(e.id || e.name || "")}
              className="min-h-7 min-w-0 truncate text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {e.name || e.id || "(blank)"}
            </button>
            {e.name && e.id && <span className="num shrink-0 text-[11px] text-muted-foreground">{e.id}</span>}
          </li>
        ))}
      </ul>
    </CountPanel>
  );
}
