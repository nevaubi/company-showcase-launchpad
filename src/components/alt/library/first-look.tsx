import { Segmented } from "@/components/app/segmented";
import type { FieldRole } from "@/lib/sources/fields";
import type { PeriodFormat } from "@/lib/sources/periods";
import type { ProfileStatus } from "@/lib/sources/profiles";
import type { SourceEntities, SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceDataset, SourceSnapshot } from "@/lib/sources/schema";
import { CoverageView } from "./coverage-view";
import { variesByRow } from "./dataset-model";
import type { LookState } from "./dataset-search";
import { LibrarySection, QuietLine } from "./ui/primitives";

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
  const varies = {
    entity: variesByRow(snapshot.ingest, "entity"),
    geo: variesByRow(snapshot.ingest, "geo"),
    period: variesByRow(snapshot.ingest, "period"),
  };
  return (
    <LibrarySection
      name="First look"
      title="First look"
      meta={profile.state === "on" ? null : "What the table holds, before any row"}
      actions={
        <Segmented
          label="First look as chart or table"
          value={view}
          onChange={(v) => setLook({ ...look, v: v === "chart" ? undefined : v })}
          options={[
            { v: "chart", l: "Chart" },
            { v: "table", l: "Table" },
          ]}
        />
      }
    >
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
