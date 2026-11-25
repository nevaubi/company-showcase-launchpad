/**
 * Profiles: what may be drawn from a family of official tables, stated in code and proven on stored rows.
 *
 * The dictionaries cannot switch a measure chart on by themselves: every field in production is typed
 * "string", and every field key is positional ("col0001", "col0002", ...; 44,485 of 44,485 on 25 Nov 2026).
 * So a profile names a field by its label, which is the publisher's own header as the snapshot's
 * dictionary keeps it, and the label is resolved to a position at run time and checked: exactly one field
 * of the snapshot must carry it. A profile whose labels are not all there turns itself off.
 *
 * Nothing in a profile rescales a value or converts a unit. A unit is printed as the source states it.
 */

import type { PeriodFormat } from "../periods";

export type { PeriodFormat };

/** The dimensions of a record that have their own index and can address a series directly. */
export type IndexedDimension = "entity_id" | "entity_name" | "geo_code" | "geo_name";

/** A field (by label) that must equal a value, compared as stored text. */
export type FieldMatch = { field: string; value: string };

/**
 * How one series is picked out of a table.
 * - by and key: every record whose indexed dimension equals the key, read through that dimension's index;
 *   field matches beside it narrow those records after the read (the key bounds what is scanned);
 * - where alone: every record whose fields equal the values, a filter on cells that the reads allow only on
 *   a snapshot of at most 50,000 rows;
 * - whole: the snapshot is one series (a FRED series file), read in row order.
 */
export type SeriesAddress =
  | { by: IndexedDimension; key: string; where?: readonly FieldMatch[] }
  | { where: readonly FieldMatch[] }
  | { whole: true };

/**
 * Where the unit of a measure is established.
 * - dictionary: the dictionary entry of the measure's own field states exactly this text; if the entry
 *   states anything else, the measure is not drawn;
 * - column: the unit is the cell of another field of the same record (a long table of many series);
 * - constant: the publisher states it for the whole table at the address given as evidence.
 */
export type UnitSource =
  | { from: "dictionary"; text: string }
  | { from: "column"; column: string }
  | { from: "constant"; text: string; evidence: string };

export type MeasureSpec = {
  /** The field's label in the snapshot's dictionary (the publisher's header). Never a position. */
  field: string;
  /** What the measure is, in the publisher's words. */
  label: string;
  unit: UnitSource;
  /** "," when the publisher writes thousands separators in this field; "none" (the default) refuses them. */
  grouping?: "," | "none";
  /** Disclosure or missing-value markers the publisher documents for this field. They are gaps, never zeros. */
  markers?: readonly string[];
};

/**
 * Where the period of a record is read.
 * - dimension: the record's indexed period holds it;
 * - field: one field of the record holds it (the index holds something coarser, or nothing);
 * - fields: several fields together (a year and a month or quarter); compose turns their cells, in the
 *   order of `fields`, into one text in a declared format, or null when they do not form a period.
 */
export type PeriodSpec =
  | { from: "dimension"; format: PeriodFormat }
  | { from: "field"; field: string; format: PeriodFormat }
  | {
      from: "fields";
      fields: readonly string[];
      /** The format of the default series. A series of another frequency states its own through compose. */
      format: PeriodFormat;
      compose(cells: readonly (string | null)[]): { text: string; format: PeriodFormat } | null;
    };

/** How a series is reached with the series read, and whether that stays inside its scan limit. */
export type SeriesAddressing = {
  /** The indexed dimension that holds one key per series; null when the whole table is one series. */
  by: IndexedDimension | null;
  /** Fields (by label) that must also be fixed to reach one series. */
  where: readonly string[];
  /** key: the rows of one key are read through that dimension's index; table: the table is read from its first row. */
  scan: "key" | "table";
  /** The most rows one series read has to scan, as counted on the proven snapshot. */
  rowsScanned: number;
  /** One sentence for the report and the next engineer. */
  note: string;
};

export type FirstLook = "series" | "ranking" | "places" | "none";

/**
 * How the periods of a series follow each other: it decides how a period is said ("Oct 2026", "Q3 2026",
 * "Nov 19, 2026") and which period is a year earlier. Without it a period's cadence follows its format
 * (a month for yyyymm and yyyy-mm, a quarter, a year, a day for a full date).
 */
export type Cadence = "day" | "week" | "month" | "quarter" | "year";

/** What a profile is matched on. `source_id` and `id` come from the dataset as registered. */
export type ProfileDataset = { id: string; source_id: string | null };

/** A dictionary entry as far as a profile needs it. A SourceColumn satisfies this. */
export type ProfileField = { key: string; label: string };

/** Where and when the profile was proven. */
export type ProfileProof = {
  /** The production snapshot whose dictionary and rows were read. */
  snapshotId: string;
  /** The dataset that snapshot belongs to. */
  datasetId: string;
  /** Date of the check, YYYY-MM-DD (UTC). */
  checked: string;
  /** The publisher's documentation the unit or the field meaning rests on. */
  documentation: readonly string[];
};

export type Profile = {
  /** Family id. Matches CatalogEntry.family where the catalogue knows the family. */
  family: string;
  /**
   * True when the dataset belongs to the family and the snapshot's fields carry every label the profile
   * reads, each exactly once. False turns the profile off (a publisher changed a header).
   */
  applies(dataset: ProfileDataset, fields: readonly ProfileField[]): boolean;
  /** Every label the profile reads. */
  requires: readonly string[];
  /** The noun for one entity of the table, in the publisher's sense ("insured institution"). */
  entityNoun?: { one: string; many: string };
  period: PeriodSpec;
  /** Set where a full date stands for a longer period (a FRED monthly series dates each month by its first day). */
  cadence?: Cadence;
  /**
   * Field values every series drawn under this profile must carry, because the unit holds only for them (the
   * FHFA master file mixes index families with different base periods). An address that does not fix them
   * is refused.
   */
  fixed?: readonly FieldMatch[];
  /** At least one. The first is the default measure. */
  measures: readonly MeasureSpec[];
  addressing: SeriesAddressing;
  /** The series a first look opens on, or null when the table has no natural default. */
  defaultSeries?(dataset: ProfileDataset): SeriesAddress | null;
  firstLook: FirstLook;
  proof: ProfileProof;
};

/** One family in the registry. `claims` looks at the dataset alone; `profile` is concrete for that dataset. */
export type ProfileEntry = {
  family: string;
  claims(dataset: ProfileDataset): boolean;
  profile(dataset: ProfileDataset): Profile;
};

export type ProfileStatus =
  /** No family claims the dataset: it gets no measure chart. */
  | { state: "none" }
  | { state: "on"; profile: Profile }
  /** A family claims the dataset but the snapshot's fields do not match. The reason is a plain sentence. */
  | { state: "off"; family: string; reason: string };

export type FieldLocation =
  | { ok: true; index: number; key: string }
  | { ok: false; reason: "missing" | "repeated" };
