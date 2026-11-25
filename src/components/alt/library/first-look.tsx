import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FieldRole } from "@/lib/sources/fields";
import type { PeriodFormat } from "@/lib/sources/periods";
import { locateField, type Profile, type ProfileStatus } from "@/lib/sources/profiles";
import { sourceQueries } from "@/lib/sources/queries";
import type { SourceEntities, SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceDataset, SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { CoverageView } from "./coverage-view";
import { variesByRow } from "./dataset-model";
import { readData } from "./dataset-queries";
import type { LookState } from "./dataset-search";
import { chosenAddress, chosenMeasure } from "./first-look-model";
import { PlaceView } from "./place-view";
import { RankingView } from "./ranking-view";
import { SeriesView } from "./series-view";
import { LibrarySection, QuietLine } from "./ui/primitives";

const CONTROL =
  "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-card px-2.5 text-[13px] shadow-paper transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The picture before the rows. A table whose family has a reviewed profile gets its measure drawn (tier 2); every
 * other table gets the pictures that parse nothing (tier 1): records per period, entities by records, filled share.
 */
export function FirstLook({
  dataset,
  snapshot,
  profile,
  fills,
  columns,
  format,
  entities,
  entityNoun,
  look,
  setLook,
  onOpen,
  onFilter,
}: {
  dataset: SourceDataset;
  snapshot: SourceSnapshot;
  profile: ProfileStatus;
  roles: FieldRole[];
  fills: SourceFieldFill[] | null;
  columns: number[];
  range: { first: string; last: string } | null | undefined;
  format: PeriodFormat;
  entities: SourceEntities | null | undefined;
  entityNoun: { one: string; many: string } | null;
  look: LookState | undefined;
  setLook: (look: LookState | undefined) => void;
  onOpen: (row: number) => void;
  onFilter: (patch: { entity?: string; period?: string }) => void;
}) {
  const view = look?.v ?? "chart";
  const patch = (p: Partial<LookState>) => {
    const next = { ...look, ...p };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as LookState;
    setLook(Object.keys(clean).length ? clean : undefined);
  };
  const varies = {
    entity: variesByRow(snapshot.ingest, "entity"),
    geo: variesByRow(snapshot.ingest, "geo"),
    period: variesByRow(snapshot.ingest, "period"),
  };
  const toggle = (
    <Segmented
      label="First look as chart or table"
      value={view}
      onChange={(v) => patch({ v: v === "chart" ? undefined : v })}
      options={[
        { v: "chart", l: "Chart" },
        { v: "table", l: "Table" },
      ]}
    />
  );
  if (profile.state === "on")
    return (
      <LibrarySection name="First look" title="First look" meta={profileMeta(profile.profile)} actions={toggle}>
        <Measured dataset={dataset} snapshot={snapshot} profile={profile.profile} look={look} patch={patch} view={view} onOpen={onOpen} />
      </LibrarySection>
    );
  return (
    <LibrarySection name="First look" title="First look" meta="What the table holds, before any row" actions={toggle}>
      {profile.state === "off" && <QuietLine className="mb-2">{profile.reason}</QuietLine>}
      <CoverageView
        datasetId={dataset.id}
        snapshot={snapshot}
        fills={fills}
        columns={columns}
        format={format}
        entities={entities}
        entityNoun={entityNoun}
        varies={varies}
        view={view}
        onPeriod={(period) => onFilter({ period })}
        onEntity={(entity) => onFilter({ entity })}
      />
    </LibrarySection>
  );
}

function profileMeta(profile: Profile): string {
  if (profile.firstLook === "ranking") return "The last period, ranked, from a reviewed reading of this table";
  if (profile.firstLook === "places") return "The last period by place, from a reviewed reading of this table";
  return "One measure over time, from a reviewed reading of this table";
}

/** Tier 2: controls in one row above the chart (measure, series, range), then the chart. */
function Measured({
  dataset,
  snapshot,
  profile,
  look,
  patch,
  view,
  onOpen,
}: {
  dataset: SourceDataset;
  snapshot: SourceSnapshot;
  profile: Profile;
  look: LookState | undefined;
  patch: (p: Partial<LookState>) => void;
  view: "chart" | "table";
  onOpen: (row: number) => void;
}) {
  const measure = chosenMeasure(profile, look);
  const address = useMemo(() => chosenAddress(profile, dataset.id, dataset.source_id, look), [profile, dataset.id, dataset.source_id, look]);
  const range = look?.r ?? "10y";
  const top = look?.n === "40" ? 40 : 15;
  const picker = profile.firstLook === "series" && (profile.addressing.by || profile.addressing.where.length > 0);
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2" data-section="First look controls">
        {picker && <SeriesPicker dataset={dataset} snapshot={snapshot} profile={profile} value={look?.s} current={address} onPick={(s) => patch({ s })} />}
        {profile.measures.length > 1 && (
          <Segmented
            label="Measure"
            value={measure.field}
            onChange={(m) => patch({ m: m === profile.measures[0].field ? undefined : m })}
            options={profile.measures.map((m) => ({ v: m.field, l: m.label }))}
          />
        )}
        {profile.firstLook === "series" && (
          <Segmented
            label="Time range"
            value={range}
            onChange={(r) => patch({ r: r === "10y" ? undefined : r })}
            options={[
              { v: "5y", l: "5 years" },
              { v: "10y", l: "10 years" },
              { v: "all", l: "All" },
            ]}
          />
        )}
      </div>
      {profile.firstLook === "ranking" ? (
        <RankingView
          datasetId={dataset.id}
          collection={dataset.sector}
          snapshot={snapshot}
          profile={profile}
          measure={measure}
          top={top}
          setTop={(n) => patch({ n: n === 40 ? "40" : undefined })}
          view={view}
          onOpen={onOpen}
        />
      ) : profile.firstLook === "places" ? (
        <PlaceView
          datasetId={dataset.id}
          collection={dataset.sector}
          snapshot={snapshot}
          profile={profile}
          measure={measure}
          top={top}
          setTop={(n) => patch({ n: n === 40 ? "40" : undefined })}
          view={view}
          onOpen={onOpen}
        />
      ) : address ? (
        <SeriesView
          datasetId={dataset.id}
          collection={dataset.sector}
          snapshot={snapshot}
          profile={profile}
          measure={measure}
          address={address}
          range={range}
          view={view}
          onOpen={onOpen}
        />
      ) : (
        <QuietLine>Choose a series to draw. This table holds many, and none is the natural first.</QuietLine>
      )}
    </div>
  );
}

type Option = { key: string; label: string; sub?: string };

/** The series of a profile: the entities or places of the last period, or the values of its series field there. */
function SeriesPicker({
  dataset,
  snapshot,
  profile,
  value,
  current,
  onPick,
}: {
  dataset: SourceDataset;
  snapshot: SourceSnapshot;
  profile: Profile;
  value: string | undefined;
  current: ReturnType<typeof chosenAddress>;
  onPick: (key: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const by = profile.addressing.by;
  const whereField = profile.addressing.where[0];
  const fieldAt = !by && whereField ? locateField(snapshot.columns, whereField) : null;
  const entities = useQuery({
    ...sourceQueries.entities({ datasetId: dataset.id, snapshotId: snapshot.id, dimension: by === "geo_code" || by === "geo_name" ? "geo" : "entity" }),
    enabled: !!by,
  });
  const cross = useQuery({
    ...sourceQueries.crossSection({ datasetId: dataset.id, snapshotId: snapshot.id, field: fieldAt?.ok ? fieldAt.index : 0 }),
    enabled: !!fieldAt?.ok,
  });
  const options: Option[] = useMemo(() => {
    if (by) {
      const list = readData(entities.data).data?.entities ?? [];
      const idFirst = by === "entity_id" || by === "geo_code";
      return list.flatMap((e) => {
        const key = idFirst ? e.id : e.name;
        if (!key) return [];
        return [{ key, label: e.name || key, sub: idFirst && e.name && e.name !== key ? key : undefined }];
      });
    }
    const rows = readData(cross.data).data?.rows ?? [];
    return [...new Set(rows.map((r) => r.text).filter((t): t is string => !!t))].map((t) => ({ key: t, label: t }));
  }, [by, entities.data, cross.data]);
  const shownKey = value ?? (current && "by" in current ? current.key : current && "where" in current && current.where[0] ? current.where[0].value : undefined);
  const shown = options.find((o) => o.key === shownKey);
  const noun = by?.startsWith("geo") ? "Place" : by ? (profile.entityNoun ? profile.entityNoun.one[0].toUpperCase() + profile.entityNoun.one.slice(1) : "Entity") : (whereField ?? "Series");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(CONTROL, "max-w-[22rem]")} aria-label={`Choose the ${noun.toLowerCase()} to draw`}>
          <span className="truncate">{shown ? shown.label : (shownKey ?? `Choose a ${noun.toLowerCase()}`)}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[24rem] max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder={`Find a ${noun.toLowerCase()}`} className="h-9 text-[13px]" />
          <CommandList>
            <CommandEmpty className="px-3 py-3 text-[13px] text-muted-foreground">
              {entities.isPending && cross.isPending ? "Reading the last period" : "Nothing in the last period matches"}
            </CommandEmpty>
            {options.length > 0 && (
              <CommandGroup heading={`${options.length.toLocaleString("en-US")} in the last period`}>
                {options.map((o) => (
                  <CommandItem
                    key={o.key}
                    value={`${o.label} ${o.key}`}
                    onSelect={() => {
                      onPick(o.key);
                      setOpen(false);
                    }}
                    className="text-[13px]"
                  >
                    <Check className={cn("mr-1.5 size-3.5", shownKey === o.key ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.sub && <span className="num ml-2 shrink-0 text-[11px] text-muted-foreground">{o.sub}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
