/**
 * Insight tiles ("What the data says"). A tile is a spec, not a component per chart: a dataset, a measure
 * of its profile, a selection of rows, a transform with an explicit formula, a chart form and a headline
 * rule. The sentence on a tile is assembled from the figures it carries; no model writes any of it.
 */
import type { FieldMatch, IndexedDimension, PeriodFormat, SeriesAddress } from "../profiles/types";

export type TileTransform = "level" | "change-12m" | "change-1y-quarterly" | "share" | "rank";
export type TileForm = "line" | "bars" | "ranked-bars";
export type TileHeadline = "level" | "change" | "rank";

type TileBase = {
  /** Stable id, unique over all boards. Used in addresses and test names. */
  id: string;
  /** Collection id: the dataset's `sector` value as registered ("04_energy"). */
  collection: string;
  datasetId: string;
  /** MeasureSpec.field of the dataset's profile. */
  measure: string;
  /**
   * What the figure is, in the publisher's words, as it opens the headline ("Total primary energy
   * consumption"). Where the row itself names the series, `subjectCheck` pins the stored text.
   */
  subject: string;
  /** A field of the selected rows that must equal this text, else the tile refuses (the publisher renamed or redefined the series). */
  subjectCheck?: FieldMatch;
  /** The only unit the tile accepts. A row that states another unit refuses the tile. */
  unit: string;
  form: TileForm;
  /** One plain caveat from the source (cohort, basis, revision). */
  note?: string;
};

/** One series over time. */
export type SeriesTileSpec = TileBase & {
  transform: "level" | "change-12m" | "change-1y-quarterly";
  headline: "level" | "change";
  series: SeriesAddress;
  /** How many of the latest periods the chart shows. The headline always uses the latest period. */
  window: number;
};

/** One series as a share of another of the same unit, period by period: 100 x part / whole. */
export type ShareTileSpec = TileBase & {
  transform: "share";
  headline: "level";
  series: SeriesAddress;
  /** The whole. Same dataset, same measure, same unit. */
  of: SeriesAddress;
  /** What the whole is, in the publisher's words ("total net generation"). */
  ofSubject: string;
  ofSubjectCheck?: FieldMatch;
  window: number;
};

/** Entities or places ranked by the measure at one period. */
export type RankTileSpec = TileBase & {
  transform: "rank";
  headline: "rank";
  across: {
    by: IndexedDimension;
    /** "latest": the greatest period of the snapshot, as the read reports it. Otherwise the period text as stored. */
    period: "latest" | string;
    where?: readonly FieldMatch[];
    /** How many bars are drawn, from the top. */
    top: number;
  };
};

export type TileSpec = SeriesTileSpec | ShareTileSpec | RankTileSpec;

/** One mark of a tile's chart. `text` is the cell as stored; `value` is its strict reading. */
export type TilePoint = {
  /** Period text as stored (series tiles) or the key of the entity or place (rank tiles). */
  key: string;
  /** How a reader says it: "Aug 2026", "Q2 2026", or the entity's name as the source writes it. */
  label: string;
  /** ISO date of the period's end, for a time axis. Absent on rank tiles. */
  date?: string;
  /** The figure drawn. For a transform this is the derived figure; `text` then holds the cell it starts from. */
  value: number;
  text: string;
  /** Row number of the record in the snapshot. */
  row: number;
};

/** A figure that is not a stored cell: its formula in words and the stored cells it was computed from. */
export type TileDerivation = {
  formula: string;
  inputs: { label: string; text: string; period: string; row: number; field: string }[];
};

/** Cells of the selection that could not be read as a number, counted and named. Never drawn, never zero. */
export type TileGaps = { count: number; nulls: number; empties: number; markers: number; texts: number; examples: string[] };

export type TileRefs = {
  datasetId: string;
  snapshotId: string;
  /** Row numbers of the records behind the headline figure. */
  rows: number[];
  /** The measure's field label. */
  field: string;
};

export type TileResult =
  | {
      ok: true;
      /** The finding, with its date and unit, assembled from the figures. */
      headline: string;
      /** The headline figure alone, formatted ("8.292398", "+1.2%"). */
      figure: string;
      /** The latest period the tile shows, as a reader says it. */
      asOf: string;
      /** The unit as the source states it. */
      unit: string;
      /** The unit of the plotted values when a transform changes it ("%"); otherwise the same as `unit`. */
      plotUnit: string;
      periodFormat: PeriodFormat;
      points: TilePoint[];
      gaps: TileGaps;
      derivation: TileDerivation | null;
      refs: TileRefs;
    }
  | { ok: false; reason: string };

/** A board: an ordered list of tile ids under a name. */
export type BoardSpec = {
  /** "library" for the cross-collection board, otherwise the collection id. */
  id: string;
  title: string;
  tiles: readonly string[];
};
