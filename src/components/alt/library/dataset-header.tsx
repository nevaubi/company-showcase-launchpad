import { ArrowUpRight, Link2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Stat } from "@/components/app/page-header";
import { describeDataset, staleAgainstParent, withoutLongDashes, type CatalogEntry } from "@/lib/sources/catalog";
import { statedUnit } from "@/lib/sources/fields";
import type { PeriodFormat } from "@/lib/sources/periods";
import { safeSourceHref, sourceDescription } from "@/lib/sources/presentation";
import type { SourceEntities } from "@/lib/sources/read-types";
import type { SourceDataset, SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { datasetQueries } from "./dataset-queries";
import { collectionHref, datasetHref, libraryHref } from "@/lib/sources/links";
import { count, isLatest, periodWords, refreshState, utcDay, utcStamp, versionPosition } from "./dataset-model";
import type { Profile } from "@/lib/sources/profiles";
import type { SnapshotVersion } from "./record-read";
import { CopyButton, HrefLink, LINK, QuietLine } from "./ui/primitives";
import { AltNav } from "./alt-nav";

const BOILERPLATE = /^Complete retained source table with all original fields and records from this file\.\s*/;

/** The description as a reader needs it: the boilerplate sentence and the collection's row count left out. */
export function readerDescription(description: string): string {
  return withoutLongDashes(
    sourceDescription(description)
      .replace(BOILERPLATE, "")
      .replace(/\s*Original collection: [\d,]+ source rows and [\d,]+ columns\.$/, "")
      .trim(),
  );
}

/** Coverage keys whose values are sentences written for readers. */
const SCOPE_KEYS: { key: string; label: string }[] = [
  { key: "identity_rule", label: "Identity" },
  { key: "geography_rule", label: "Places" },
];

export function DatasetHeader({
  dataset,
  snapshot,
  entry,
  versions,
  range,
  format,
  entities,
  entitiesFailed,
  entityDimension,
  entityNoun,
  profile,
  onLatest,
  pinnedUrl,
}: {
  dataset: SourceDataset;
  snapshot: SourceSnapshot;
  entry: CatalogEntry;
  versions: SnapshotVersion[] | undefined;
  range: { first: string; last: string } | null | undefined;
  format: PeriodFormat;
  entities: SourceEntities | null | undefined;
  entitiesFailed: boolean;
  entityDimension: "entity" | "geo" | null;
  entityNoun: { one: string; many: string } | null;
  profile: Profile | null;
  onLatest: () => void;
  pinnedUrl: string;
}) {
  const official = safeSourceHref(dataset.source_url);
  const latest = isLatest(dataset, snapshot);
  const newest = versions?.find((v) => v.id === dataset.latest_snapshot_id) ?? null;
  const position = versions ? versionPosition(versions, snapshot.id) : null;
  const units = snapshot.columns.filter((c) => statedUnit(c) !== null).length;
  const refresh = refreshState(snapshot.coverage, utcDay(snapshot.retrieved_at));
  const description = readerDescription(dataset.description);
  const storedName = withoutLongDashes(dataset.name.trim());
  const showStored = storedName && storedName !== entry.title && storedName !== entry.code;
  const scope = SCOPE_KEYS.flatMap(({ key, label }) => {
    const v = snapshot.coverage?.[key];
    return typeof v === "string" && v.trim() ? [{ label, text: withoutLongDashes(v.trim()) }] : [];
  });
  const first = range ? periodWords(range.first, format, profile) : null;
  const last = range ? periodWords(range.last, format, profile) : null;

  return (
    <div data-section="Table header" className="grid min-w-0 grid-cols-1 gap-3">
      <PageHeader
        className="mb-0"
        eyebrow={
          <span className="flex flex-wrap items-center gap-1">
            <HrefLink href={libraryHref()} className={cn(LINK, "hover:text-foreground")}>
              Data library
            </HrefLink>
            <span aria-hidden>/</span>
            <HrefLink href={collectionHref(entry.collection.id)} className={cn(LINK, "hover:text-foreground")}>
              {entry.collection.name}
            </HrefLink>
          </span>
        }
        title={
          <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span>{entry.title}</span>
            {entry.code && <span className="num text-[13px] font-normal text-muted-foreground">{entry.code}</span>}
          </span>
        }
        description={
          <span className="grid grid-cols-1 gap-1">
            {showStored && <span className="block text-[11px] leading-4">Stored as {storedName}</span>}
            <span className="block text-[13px] leading-5">
              {entry.publisher.name}
              {entry.publisher.via ? ` via ${entry.publisher.via}` : ""}
              {dataset.grain ? <> · one record: {withoutLongDashes(dataset.grain)}</> : null}
            </span>
            {description && <span className="block text-[13px] leading-5">{description}</span>}
          </span>
        }
        actions={
          <>
            {official && (
              <a
                href={official}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-[13px] shadow-paper transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Official source <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            )}
            <span className="inline-flex h-8 items-center gap-1 rounded-md border bg-card pl-2.5 text-[13px] shadow-paper">
              <Link2 className="size-3.5 text-muted-foreground" aria-hidden />
              Link to this version
              <CopyButton text={pinnedUrl} label="Copy a link to this version of the table" />
            </span>
          </>
        }
      />
      <AltNav />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border shadow-paper sm:grid-cols-3 @5xl:grid-cols-6" data-section="Table facts">
        <Stat className="border-b-0 bg-card" label="Records" value={count(snapshot.loaded_rows)} sub="in this version" />
        <Stat
          className="border-b-0 bg-card"
          label="Fields"
          value={count(snapshot.columns.length)}
          sub={units ? `${count(units)} with a stated unit` : "no stated units"}
        />
        <Stat
          className="border-b-0 bg-card"
          label="Periods"
          value={
            range === undefined ? (
              <span className="inline-block h-5 w-24 animate-pulse rounded bg-muted" aria-label="Loading" />
            ) : first && last ? (
              <span title={`${range!.first} to ${range!.last}, as stored`}>{periodSpan(first.text, last.text)}</span>
            ) : (
              "–"
            )
          }
          sub={range === null ? "no period field" : range ? (first!.text === last!.text ? "one period" : `${first!.text} to ${last!.text}`) : undefined}
        />
        <EntityStat entities={entities} failed={entitiesFailed} dimension={entityDimension} noun={entityNoun} periodText={(p) => periodWords(p, format, profile)} />
        <Stat
          className="border-b-0 bg-card"
          label="File retrieved"
          value={utcDay(snapshot.retrieved_at) || "–"}
          sub={`published here ${utcStamp(snapshot.published_at)}`}
        />
        <Stat
          className="border-b-0 bg-card"
          label="Version"
          value={position ? `${position.n} of ${position.of}` : versions ? "–" : <span className="inline-block h-5 w-12 animate-pulse rounded bg-muted" aria-label="Loading" />}
          sub={refresh.words}
        />
      </div>

      <div className="grid grid-cols-1 gap-1" data-section="Version shown">
        {latest ? (
          <QuietLine>
            Snapshot <span className="num text-foreground">{snapshot.id.slice(0, 12)}</span>, published{" "}
            {utcStamp(snapshot.published_at)}: the latest.
          </QuietLine>
        ) : (
          <p className="text-[13px] leading-5" role="status">
            You are viewing an earlier version, published {utcStamp(snapshot.published_at)}.
            {newest ? ` A newer one was published ${utcStamp(newest.publishedAt)}.` : " A newer one is published."}{" "}
            <button type="button" onClick={onLatest} className={cn(LINK, "font-medium underline")}>
              Open the latest
            </button>
          </p>
        )}
        <ParentLine entry={entry} child={{ ...dataset, retrieved_at: snapshot.retrieved_at }} />
        {scope.map((s) => (
          <QuietLine key={s.label}>
            <span className="text-foreground">{s.label}.</span> {s.text}
          </QuietLine>
        ))}
        {entry.issues.map((issue) => (
          <QuietLine key={issue.id}>
            <span className="text-foreground">Known issue.</span> {issue.text}
          </QuietLine>
        ))}
      </div>
    </div>
  );
}

/** The headline of a period range: the years when it spans years, else the one period as a reader says it. */
export function periodSpan(first: string, last: string): string {
  if (first === last) return first;
  const a = /(\d{4})(?!.*\d{4})/.exec(first)?.[1];
  const b = /(\d{4})(?!.*\d{4})/.exec(last)?.[1];
  return a && b && a !== b ? `${a} to ${b}` : `${first} to ${last}`;
}

function EntityStat({
  entities,
  failed,
  dimension,
  noun,
  periodText,
}: {
  entities: SourceEntities | null | undefined;
  failed: boolean;
  dimension: "entity" | "geo" | null;
  noun: { one: string; many: string } | null;
  /** The period as a reader says it ("Q2 2026"), with the stored text kept for the title. */
  periodText: (period: string) => { text: string; title?: string };
}) {
  if (dimension === null) return <Stat className="border-b-0 bg-card" label="Entities" value="–" sub="no entity or place field" />;
  const plural = dimension === "geo" ? "Places" : noun ? noun.many[0].toUpperCase() + noun.many.slice(1) : "Entities";
  if (failed) return <Stat className="border-b-0 bg-card" label={plural} value="–" sub="could not be counted" />;
  if (!entities)
    return (
      <Stat className="border-b-0 bg-card" label="Entities" value={<span className="inline-block h-5 w-12 animate-pulse rounded bg-muted" aria-label="Loading" />} />
    );
  const n = entities.entities.length;
  const label = plural;
  const said = entities.period ? periodText(entities.period) : null;
  const where = said ? `in ${said.text}` : "in the first rows";
  return (
    <Stat
      className="border-b-0 bg-card"
      label={label}
      value={entities.complete ? count(n) : `${count(n)} or more`}
      sub={entities.periodRule === "greatest" ? `${where}, the last period` : where}
    />
  );
}

function ParentLine({ entry, child }: { entry: CatalogEntry; child: SourceDataset & { retrieved_at: string | null } }) {
  const parentId = entry.parentId;
  const brief = useQuery({ ...datasetQueries.brief(parentId ?? ""), enabled: !!parentId });
  if (!parentId || (entry.kind !== "projection" && entry.kind !== "derived")) return null;
  const parent = brief.data;
  const title = parent ? describeDataset({ ...parent, rows: null, retrieved_at: parent.retrievedAt }).title : null;
  const stale = parent ? staleAgainstParent({ ...child, rows: null }, { ...parent, rows: null, retrieved_at: parent.retrievedAt }) : false;
  return (
    <p className="text-[13px] leading-5 text-muted-foreground">
      <span className="text-foreground">{entry.kind === "projection" ? "A view of" : "Derived from"}</span>{" "}
      <HrefLink href={datasetHref(parentId)} className={cn(LINK, "underline")}>
        {title ?? <span className="break-all">{parentId}</span>}
      </HrefLink>
      .{" "}
      {stale && parent ? (
        <span className="text-foreground">
          Older than its parent: this file was retrieved {utcDay(child.retrieved_at)}, the parent's {utcDay(parent.retrievedAt)}.
        </span>
      ) : null}
    </p>
  );
}
