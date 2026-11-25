import { useMemo, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { SectionNav } from "@/components/company/section-nav";
import { Button } from "@/components/ui/button";
import { describeDataset } from "@/lib/sources/catalog";
import { fieldRoles } from "@/lib/sources/fields";
import { profileStatus } from "@/lib/sources/profiles";
import { sourceQueries, sourceReadFailure } from "@/lib/sources/queries";
import { fieldCompleteness } from "@/lib/sources/read-types";
import type { SourceDatasetDetail } from "@/lib/sources/schema";
import { DatasetHeader } from "./dataset-header";
import { datasetHref, libraryHref, recordHref } from "@/lib/sources/links";
import { canOrderNewest, effectiveOrder, profileFields, rangeFormat, recordDims, variesByRow } from "./dataset-model";
import { datasetQueries, readData } from "./dataset-queries";
import { openingFields } from "./columns-model";
import { columnsOf, filterPatch, MAX_COLUMNS, snapshotPatch, type DatasetSearch } from "./dataset-search";
import { FieldsSection } from "./field-table";
import { FirstLook } from "./first-look";
import { canSearchNames } from "./record-read";
import { RecordSheet } from "./record-sheet";
import { RecordsSection } from "./record-table";
import { VersionsSection } from "./versions";
import { HrefLink } from "./ui/primitives";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "records", label: "Records" },
  { id: "fields", label: "Fields" },
  { id: "versions", label: "Versions and provenance" },
];

/** Sticky elements inside the page sit under the app header and the section nav (41 px: 28 px chips, padding, rule). */
const PAGE_STYLE = { "--library-top": "calc(var(--sticky-top, 3.5rem) + 41px)" } as CSSProperties;

export function DatasetPage({
  datasetId,
  search,
  setSearch,
}: {
  datasetId: string;
  search: DatasetSearch;
  setSearch: (patch: Partial<DatasetSearch>) => void;
}) {
  const detail = useQuery(sourceQueries.dataset(datasetId, search.snapshot));
  if (detail.isPending) return <PageSkeleton />;
  if (detail.isError || !detail.data) {
    const failure = sourceReadFailure(detail.error);
    return (
      <Missing
        datasetId={datasetId}
        snapshot={search.snapshot}
        failure={failure}
        onLatest={() => setSearch(snapshotPatch(undefined))}
        retry={() => void detail.refetch()}
      />
    );
  }
  if (!detail.data.snapshot)
    return (
      <div className="grid grid-cols-1 gap-4">
        <PageHeader eyebrow="Data library" title={describeDataset({ ...detail.data.dataset, rows: null }).title} />
        <DataUnavailable title="This table is registered but not published yet" hint="Its records appear here once a version of the file is published." />
      </div>
    );
  return <DatasetBody detail={detail.data as SourceDatasetDetail & { snapshot: NonNullable<SourceDatasetDetail["snapshot"]> }} search={search} setSearch={setSearch} />;
}

function DatasetBody({
  detail,
  search,
  setSearch,
}: {
  detail: SourceDatasetDetail & { snapshot: NonNullable<SourceDatasetDetail["snapshot"]> };
  search: DatasetSearch;
  setSearch: (patch: Partial<DatasetSearch>) => void;
}) {
  const { dataset, snapshot, file } = detail;
  const entry = useMemo(
    () =>
      describeDataset({
        id: dataset.id,
        name: dataset.name,
        sector: dataset.sector,
        agency: dataset.agency,
        source_id: dataset.source_id,
        source_url: dataset.source_url,
        grain: dataset.grain,
        rows: snapshot.loaded_rows,
        retrieved_at: snapshot.retrieved_at,
      }),
    [dataset, snapshot.loaded_rows, snapshot.retrieved_at],
  );
  const profile = useMemo(() => profileStatus(dataset, snapshot.columns), [dataset, snapshot.columns]);
  const dims = useMemo(() => recordDims(snapshot.ingest), [snapshot.ingest]);
  const varies = {
    entity: variesByRow(snapshot.ingest, "entity"),
    geo: variesByRow(snapshot.ingest, "geo"),
    period: variesByRow(snapshot.ingest, "period"),
  };
  const constantPeriod = snapshot.ingest.constants?.period;
  const rangeQuery = useQuery({ ...sourceQueries.periodRange(dataset.id, snapshot.id), enabled: varies.period });
  const rangeRead = readData(rangeQuery.data);
  const range: { first: string; last: string } | null | undefined = varies.period
    ? rangeRead.data
      ? rangeRead.data.range
        ? { first: rangeRead.data.range.first.period, last: rangeRead.data.range.last.period }
        : null
      : rangeQuery.isError || rangeRead.reason
        ? null
        : undefined
    : typeof constantPeriod === "string"
      ? { first: constantPeriod, last: constantPeriod }
      : null;
  const format = rangeFormat(range ?? null);
  const newest = canOrderNewest(varies.period, format);
  const order = effectiveOrder(search, newest);
  const entityDimension = varies.entity ? "entity" : varies.geo ? "geo" : null;
  const entitiesQuery = useQuery({
    ...sourceQueries.entities({ datasetId: dataset.id, snapshotId: snapshot.id, dimension: entityDimension ?? "entity" }),
    enabled: entityDimension !== null,
  });
  const entitiesRead = readData(entitiesQuery.data);
  const entities = entityDimension === null ? null : (entitiesRead.data ?? undefined);
  const entitiesFailed = entityDimension !== null && (entitiesQuery.isError || !!entitiesRead.reason);
  const versions = useQuery(datasetQueries.versions(dataset.id));
  const reviewed = useMemo(() => profileFields(profile.state === "on" ? profile.profile : null, snapshot.columns), [profile, snapshot.columns]);
  const roles = useMemo(() => fieldRoles(snapshot.columns, snapshot.ingest, reviewed.hints), [snapshot.columns, snapshot.ingest, reviewed]);
  const fills = useMemo(() => fieldCompleteness(snapshot), [snapshot]);
  const defaults = useMemo(
    () => openingFields(snapshot.columns, snapshot.ingest, profile.state === "on" ? profile.profile.measures.map((m) => m.field) : []),
    [snapshot.columns, snapshot.ingest, profile],
  );
  const asked = columnsOf(search);
  const columns = asked && asked.every((p) => p < snapshot.columns.length) ? asked : defaults;
  const noun = profile.state === "on" && profile.profile.entityNoun ? profile.profile.entityNoun : nounFrom(snapshot.coverage?.entity_type);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const pinnedUrl = `${origin}${datasetHref(dataset.id, { snapshot: snapshot.id })}`;

  return (
    <div className="@container grid min-w-0 grid-cols-1 content-start gap-6" style={PAGE_STYLE}>
      <div id="overview" className="grid min-w-0 scroll-mt-28 grid-cols-1 gap-6">
        <DatasetHeader
          dataset={dataset}
          snapshot={snapshot}
          entry={entry}
          versions={versions.data}
          range={range}
          format={format}
          entities={entities}
          entitiesFailed={entitiesFailed}
          entityDimension={entityDimension}
          entityNoun={noun}
          profile={profile.state === "on" ? profile.profile : null}
          onLatest={() => setSearch(snapshotPatch(undefined))}
          pinnedUrl={pinnedUrl}
        />
      </div>
      <SectionNav sections={SECTIONS} />
      <FirstLook
        dataset={dataset}
        snapshot={snapshot}
        profile={profile}
        roles={roles}
        fills={fills}
        columns={columns}
        range={range}
        format={format}
        entities={entities}
        entityNoun={noun}
        look={search.look}
        setLook={(look) => setSearch({ look })}
        onOpen={(row) => setSearch({ row })}
        onFilter={(patch) => setSearch({ ...filterPatch(patch), row: undefined })}
      />
      <RecordsSection
        dataset={dataset}
        snapshot={snapshot}
        search={search}
        setSearch={setSearch}
        dims={dims}
        offer={{ entity: varies.entity, geography: varies.geo, period: varies.period, search: canSearchNames(dims) && (varies.entity || varies.geo) }}
        order={order}
        newest={newest}
        format={format}
        roles={roles}
        units={reviewed.units}
        columns={columns}
        defaults={defaults}
        entities={entityDimension === "entity" ? entities : null}
        entityNoun={noun ? cap(noun.one) : "Entity"}
        periods={range}
      />
      <FieldsSection
        snapshot={snapshot}
        roles={roles}
        fills={fills}
        shown={columns}
        onAdd={(p) => setSearch({ cols: columns.includes(p) || columns.length >= MAX_COLUMNS ? search.cols : [...columns, p].join(",") })}
      />
      <VersionsSection
        dataset={dataset}
        snapshot={snapshot}
        file={file}
        versions={versions.data}
        versionsError={versions.isError}
        onView={(id) => setSearch(snapshotPatch(id))}
        retry={() => void versions.refetch()}
      />
      <RecordSheet
        dataset={dataset}
        snapshot={snapshot}
        row={search.row}
        shown={columns}
        roles={roles}
        units={reviewed.units}
        format={format}
        entityNoun={noun ? cap(noun.one) : "Entity"}
        onClose={() => setSearch({ row: undefined })}
        onFilter={(patch) => setSearch({ ...patch, row: undefined, after: undefined, before: undefined })}
        recordUrl={(row) => `${origin}${recordHref(dataset.id, snapshot.id, row)}`}
      />
    </div>
  );
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The noun for one entity from the snapshot's own declaration ("FDIC_certificate" is "FDIC certificate"). */
export function nounFrom(entityType: unknown): { one: string; many: string } | null {
  if (typeof entityType !== "string" || !entityType.trim() || entityType === "source_native_entity") return null;
  const one = entityType.replace(/_/g, " ").trim();
  const many = /(s|x|ch|sh)$/i.test(one) ? `${one}es` : /[^aeiou]y$/i.test(one) ? `${one.slice(0, -1)}ies` : `${one}s`;
  return { one, many };
}

function Missing({
  datasetId,
  snapshot,
  failure,
  onLatest,
  retry,
}: {
  datasetId: string;
  snapshot: string | undefined;
  failure: string;
  onLatest: () => void;
  retry: () => void;
}) {
  const notFound = failure === "not-found";
  return (
    <div className="grid grid-cols-1 gap-4" data-section="Table not found">
      <PageHeader
        eyebrow={
          <HrefLink href={libraryHref()} className="underline-offset-4 hover:underline">
            Data library
          </HrefLink>
        }
        title={notFound ? (snapshot ? "This version is not published" : "No published table at this address") : "This table could not be read"}
        description={
          notFound ? (
            snapshot ? (
              <>
                The address asks for version <span className="num">{snapshot.slice(0, 12)}</span> of{" "}
                <span className="num break-all">{datasetId}</span>, which has no published version with that ID.
              </>
            ) : (
              <>
                The address names <span className="num break-all">{datasetId}</span>, which is not a published table.
              </>
            )
          ) : failure === "timeout" ? (
            "The database took too long to answer."
          ) : (
            "The read failed. Trying again may help."
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        {notFound && snapshot && (
          <Button size="sm" className="h-8 text-[13px]" onClick={onLatest}>
            Open the latest version
          </Button>
        )}
        {!notFound && (
          <Button size="sm" variant="outline" className="h-8 text-[13px]" onClick={retry}>
            Retry
          </Button>
        )}
        <Button asChild size="sm" variant="outline" className="h-8 text-[13px]">
          <HrefLink href={libraryHref()}>Back to the Data library</HrefLink>
        </Button>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6" aria-busy="true" aria-label="Loading the table">
      <div className="grid grid-cols-1 gap-2">
        <span className="block h-3 w-40 animate-pulse rounded bg-muted" />
        <span className="block h-7 w-2/3 animate-pulse rounded bg-muted" />
        <span className="block h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid h-[4.5rem] grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3 @5xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="block bg-card" />
        ))}
      </div>
      <span className="block h-[22rem] animate-pulse rounded-md bg-muted/60" />
      <span className="block h-[30rem] animate-pulse rounded-md bg-muted/40" />
    </div>
  );
}
