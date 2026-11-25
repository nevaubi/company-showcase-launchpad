/**
 * Insight tiles ("What the data says"). A tile is a spec, not a component per chart: a dataset, a measure
 * of its profile, a selection of rows, a transform with an explicit formula, a chart form and a headline
 * rule. The sentence on a tile is assembled from the figures it carries; no model writes any of it.
 */
import type { Cadence, FieldMatch, IndexedDimension, PeriodFormat, SeriesAddress } from "../profiles/types";

export type TileTransform = "level" | "change-12m" | "change-1y-quarterly" | "share" | "rank";
export type TileForm = "line" | "bars" | "ranked-bars";
export type TileHeadline = "level" | "change" | "rank";

export type { Cadence };

/** A change is a relative change in percent, or a difference in the measure's own unit. */
export type ChangeAs = "percent" | "difference";

type TileBase = {
  /** Stable id, unique over all boards. Used in addresses and test names. */
  id: string;
  /** Collection id: the dataset's `sector` value as registered ("04_energy"). */
  collection: string;
  datasetId: string;
  /** MeasureSpec.field of the dataset's profile. */
  measure: string;
  /** The tile's title: the series as the publisher names it. */
  title: string;
  /**
   * What the figure is, as it opens the headline ("Total primary energy consumption"). Where the row itself
   * names the series, `subjectCheck` pins the stored text.
   */
  subject: string;
  /** The verb after the subject in a level sentence. */
  verb?: "was" | "were" | "had";
  /** A field of the selected rows that must equal this text, else the tile refuses (the publisher renamed or redefined the series). */
  subjectCheck?: FieldMatch;
  /** The only unit the tile accepts. A row or a dictionary that states another unit refuses the tile. */
  unit: string;
  /** Decimal places of a printed level (and of a difference), chosen to match the publisher's own writing. */
  decimals: number;
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
  /** Required for a change transform; for a level headline it adds the comparison with a year earlier. */
  changeAs?: ChangeAs;
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
  /** What the ranked records are, plural, as the headline counts them ("institutions in the FDIC cohort"). */
  entities: string;
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

/** One mark of a tile's chart. `text` is the cell as stored; `value` is the figure drawn, null for a gap. */
export type TilePoint = {
  /** Period text as stored (series tiles) or the key of the entity or place (rank tiles). */
  key: string;
  /** How a reader says it: "Aug 2026", "Q2 2026", or the entity's name as the source writes it. */
  label: string;
  /** ISO date of the period's start, for a time axis. Absent on rank tiles. */
  date?: string;
  /** The figure drawn: the reading of the cell, or for a transform the derived figure. Null: no figure (a gap). */
  value: number | null;
  /** The figure as printed in the table view ("8.29", "+1.2"), or "–" for a gap. */
  display: string;
  /** The stored cell the figure starts from, exactly as stored (null when the cell was null). */
  text: string | null;
  /** Row number of the record in the snapshot. */
  row: number;
};

/** A figure that is not a stored cell: its formula in words and the stored cells it was computed from. */
export type TileDerivation = {
  formula: string;
  inputs: { label: string; text: string; period: string; row: number; field: string }[];
};

/** Cells of the selection that could not be read as a number, counted and named. Never drawn, never zero. */
export type TileGaps = {
  count: number;
  nulls: number;
  empties: number;
  markers: number;
  texts: number;
  /** Periods of a change series without a year-earlier figure. */
  noBase: number;
  /** Records whose period is not a period of this series' format (an annual row in a monthly table). */
  otherPeriods: number;
  examples: string[];
};

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
      /** The headline figure alone, formatted with a true minus sign ("8.29", "+1.2"). */
      figure: string;
      /** What is printed right after the figure: "%" for a percent or a share, otherwise the unit as stated. */
      figureUnit: string;
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

/** Where a tile's figures come from, for its source line and its link to the records. */
export type TileSource = {
  datasetId: string;
  snapshotId: string | null;
  /** Publisher as a reader names it ("US EIA", "FRED, Federal Reserve Bank of St. Louis"). */
  publisher: string;
  /** The table's title from the catalogue, and the publisher's code when it has one. */
  table: string;
  code?: string;
  /** When the stored copy was retrieved from the publisher (ISO time), and when it was published in the store. */
  retrievedAt: string | null;
  publishedAt: string | null;
};

/** A computed tile as a board serves it. */
export type BoardTile = {
  id: string;
  title: string;
  form: TileForm;
  transform: TileTransform;
  note?: string;
  /** The rows behind the chart, for the "Open records" link: the series address or the ranked dimension. */
  selection: { series: SeriesAddress } | { across: RankTileSpec["across"] };
  source: TileSource;
  result: TileResult;
};

export type Board = {
  id: string;
  title: string;
  /** Tiles that computed, in board order. */
  tiles: BoardTile[];
  /** Tiles that did not, with the reason in one sentence; the board shows these in its footer only. */
  refused: { id: string; title: string; reason: string }[];
  /** When the server computed the board (ISO time). */
  computedAt: string;
};

export type BoardRead =
  | { ok: true; data: Board }
  | { ok: false; reason: "unavailable" | "not-found" | "invalid" | "timeout" | "error"; message: string };
