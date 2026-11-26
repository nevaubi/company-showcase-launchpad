/**
 * Insight tiles ("What the data says"). A tile is a spec, not a component per chart: a dataset, a measure
 * of its profile, a selection of rows, a transform with an explicit formula, a chart form and a headline
 * rule. The sentence on a tile is assembled from the figures it carries; no model writes any of it.
 */
import type { Cadence, FieldMatch, IndexedDimension, PeriodFormat, SeriesAddress } from "../profiles/types";
import type { ReaderFigure } from "./scale";

export type TileTransform = "level" | "change-12m" | "change-1y-quarterly" | "share" | "rank" | "records";
/**
 * The chart forms. The first three draw one series or one ranking (round 4); the rest are the forms of round 6:
 * several series of one unit (`compare`), the parts of a stated whole (`mix`), US states on a tile grid (`map`),
 * entities at one period (`distribution`), an ordered category at one period (`curve`) and a compact figure for dense
 * rows (`stat`). Record counts use `bars`, `ranked-bars` or `map` with the `records` transform.
 */
export type TileForm = "line" | "bars" | "ranked-bars" | "compare" | "mix" | "map" | "distribution" | "curve" | "stat";
/** The forms of round 4, which one series or one ranking draws. */
export type ClassicForm = "line" | "bars" | "ranked-bars";
export type TileHeadline = "level" | "change" | "rank" | "spread" | "share" | "median" | "records";

export type { Cadence };

/** A change is a relative change in percent, or a difference in the measure's own unit. */
export type ChangeAs = "percent" | "difference";

/** Where a tile sits on a board and how wide it is. Every tile form takes these. */
export type TileLayout = {
  /**
   * The heading the tile sits under on its collection board ("Rates", "The dollar"). A board shows its sections in the
   * order their first tile appears in its list, each with its tiles in list order; tiles without a section lead the
   * board under no heading. On the landing board ("library") tiles are grouped by collection instead.
   */
  section?: string;
  /** "wide" spans two columns where the board has two or more; "regular" (the default) one. */
  size?: "regular" | "wide";
};

type TileBase = TileLayout & {
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
  form: ClassicForm;
  /** One plain caveat from the source (cohort, basis, revision). */
  note?: string;
};

/** TileBase for the forms of round 6, which name their own form. */
type FormBase = Omit<TileBase, "form">;

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

/**
 * The records of one period, or of a whole small table, across entities or places: the selection a rank, map or
 * distribution tile reads. One period is read through the period index in at most five selects of 1,000 records, in
 * row order, and is complete only when it ends inside them (a longer period is refused with the count read, never
 * ranked or drawn as a part).
 */
export type CrossSpec = {
  /** The dimension that names each record's entity or place; a key appears once in the selection. */
  by: IndexedDimension;
  /**
   * "latest": the greatest period of the snapshot (one probe of the period index). "table": every record of a
   * snapshot without a period dimension (at most 5,000 records), the headline dated by the snapshot's retrieval.
   * Otherwise the period text as stored.
   */
  period: "latest" | "table" | string;
  /**
   * Field values every record must carry. On a snapshot of at most 50,000 records they filter inside the select; above
   * that they are applied after the read, to the records of the period read in its five pages.
   */
  where?: readonly FieldMatch[];
};

/** Entities or places ranked by the measure at one period. */
export type RankTileSpec = TileBase & {
  transform: "rank";
  headline: "rank";
  /** What the ranked records are, plural, as the headline counts them ("institutions in the FDIC cohort"). */
  entities: string;
  across: CrossSpec & {
    /** How many bars are drawn, from the top. */
    top: number;
    /** "highest" (the default) ranks the largest figure first; "lowest" the smallest first. */
    order?: "highest" | "lowest";
  };
};

/**
 * One series of a compare, mix or curve tile. A series of another table names its dataset and measure (a FRED file
 * holds one series, so a compare of FRED series names a dataset per line); otherwise the tile's own apply. Every
 * series is read and checked as a series tile's is: the profile of its dataset, its unit, its periods.
 */
export type TileSeriesSpec = {
  /** The dataset of this series; the tile's `datasetId` when absent. */
  datasetId?: string;
  /** MeasureSpec.field of that dataset's profile; the tile's `measure` when absent. */
  measure?: string;
  series: SeriesAddress;
  /** The series' name at its line end, in the legend and in the table, in the publisher's words ("Euro", "30-year"). */
  label: string;
  /** The series in a sentence ("the 2-year yield"); `label` when absent. */
  subject?: string;
  /** The only unit this series accepts; the tile's `unit` when absent. Another stated unit refuses the tile. */
  unit?: string;
  /** Decimal places of this series' printed figures; the tile's `decimals` when absent. */
  decimals?: number;
  /** A field of this series' rows that must equal this text, as a tile's `subjectCheck`. */
  subjectCheck?: FieldMatch;
};

/**
 * Two to six series over time on one time axis (`form: "compare"`). When every plotted unit is the same, the series
 * share one chart with a direct label at each line end (a legend row only where end labels would collide). When the
 * plotted units differ (levels of series stated in different units, the dollar against the euro and the yen), each
 * series gets its own small panel with its own axis and unit on the shared time axis: never two scales on one plot,
 * never a unit converted. The headline is on the first series (its level, or its change with `transform`), or on the
 * spread between two series of one unit: the figure of `spread.of` less the figure of `spread.less` at the latest
 * period both have a figure for, in the unit ("percentage points" for Percent), the formula stated on the tile.
 * A change transform plots every series as its change ("%", or the difference in its unit) and applies the rules of
 * a series tile's change to each.
 */
export type CompareTileSpec = FormBase & {
  form: "compare";
  transform: "level" | "change-12m" | "change-1y-quarterly";
  headline: "level" | "change" | "spread";
  /** 2 to 6 series; the first leads the headline and takes the first colour. Colours follow this order, never a rank. */
  lines: readonly TileSeriesSpec[];
  /** For a spread headline: positions in `lines` of the minuend and the subtrahend, both of one unit. */
  spread?: { of: number; less: number };
  /** How many of the latest periods the chart shows. */
  window: number;
  /** Required for a change transform; for a level headline it adds the lead series' comparison with a year earlier. */
  changeAs?: ChangeAs;
};

/**
 * The parts of a stated whole over time (`form: "mix"`): each part a series in the unit of the whole, drawn as
 * stacked areas or stacked columns, in levels or (`transform: "share"`) as a 100 percent share, 100 × part ÷ whole
 * period by period, the formula stated on the tile. The whole is the publisher's own series, never the sum of the
 * parts: in every period drawn the parts must sum to it within `tolerance` (the publisher's rounding), else the tile
 * is refused with the period and both figures; nothing is forced to fit. A period without a figure for the whole or
 * a part is a gap in every layer. The headline is the first part's share of the whole in the latest period.
 */
export type MixTileSpec = FormBase & {
  form: "mix";
  transform: "level" | "share";
  headline: "share";
  /** The publisher's total, read and checked like a part. */
  whole: TileSeriesSpec;
  /** 2 to 6 parts in a fixed order (bottom of the stack first); colours follow this order. */
  parts: readonly TileSeriesSpec[];
  draw: "areas" | "columns";
  /** Largest difference allowed between the sum of the parts and the whole, in the unit, as decimal text ("0.2"). */
  tolerance: string;
  window: number;
};

/**
 * One measure (or its change over a year) at one period across US states, on the state tile grid (`form: "map"`):
 * each state a square at its usual place, DC included, territories listed beneath the grid when present. Levels take
 * a sequential scale (one hue, light to dark); a change (`change-12m`, the same period a year earlier read as its own
 * cross-section) a diverging scale centred on zero. A legend states the value range. A state without a figure is
 * hatched and named in the caption. Records are matched to states by the indexed dimension `across.by` holding a
 * postal code, a two-digit FIPS code or the state's name; places that are not states or territories (the nation, a
 * region) are counted and named, never drawn. A period's cross-section must be complete (at most 1,000 records).
 */
export type MapTileSpec = FormBase & {
  form: "map";
  transform: "level" | "change-12m";
  headline: "rank";
  /** What the places are, plural, as the headline counts them ("states"). */
  entities: string;
  across: CrossSpec;
  /** Required for `change-12m`. */
  changeAs?: ChangeAs;
};

/**
 * One measure at one period across the entities of a table (`form: "distribution"`), as a histogram with stated bin
 * edges or a strip of dots (one dot per entity, each opening its record), the median marked. Only a complete period is
 * drawn (at most 1,000 records). The median is the middle figure of the ordered figures (with an even count, half
 * the sum of the two middle figures) and the quartiles are the medians of the lower and upper halves; their formula is
 * stated on the tile. Bins count records, each closed on the left, [edge, next edge); figures below the first edge or
 * at or above the last are counted in an end bin named so, never dropped.
 */
export type DistributionTileSpec = FormBase & {
  form: "distribution";
  transform: "level";
  headline: "median";
  /** What the entities are, plural, as the headline counts them ("institutions in the FDIC cohort"). */
  entities: string;
  across: CrossSpec;
  /** Bin edges as decimal text in the unit, ascending, at least two. */
  draw: { as: "histogram"; edges: readonly string[] } | { as: "dots" };
};

/**
 * One period's values across an ordered category (`form: "curve"`): maturities, size classes, age bands, in the
 * publisher's order. Each category is one series; the curve takes the latest period every category has a figure for
 * (or the period named), and with `yearEarlier` the same period a year earlier as a second, quieter line. The headline
 * names the two ends and the spread between them (last less first, in the unit), or (`level`) the last category's
 * level and its change from a year earlier.
 */
export type CurveTileSpec = FormBase & {
  form: "curve";
  transform: "level";
  headline: "spread" | "level";
  /** 3 to 12 categories in their natural order. */
  categories: readonly TileSeriesSpec[];
  yearEarlier?: boolean;
  /** "latest" (the default): the latest period every category has a figure for. Otherwise a period text as stored. */
  period?: "latest" | string;
};

/**
 * A compact tile for dense rows (`form: "stat"`): the latest level, its change over a year (`changeAs`) and a
 * sparkline of the latest periods (24 by default), nothing else. A daily series has no period a year earlier: leave
 * `changeAs` out and the tile shows the level and the sparkline.
 */
export type StatTileSpec = FormBase & {
  form: "stat";
  transform: "level";
  headline: "level";
  series: SeriesAddress;
  changeAs?: ChangeAs;
  /** Periods in the sparkline, 24 when absent. */
  window?: number;
};

/** How counted periods are grouped: each period as stored, or every month, quarter or year (exact counts added up). */
export type CountBucket = "period" | "month" | "quarter" | "year";

/**
 * What a count tile counts:
 * - `dimension: "period"`: records per period of the indexed period, in the declared format, grouped by `by`, the
 *   latest `window` groups drawn (all when absent); periods not of the format are counted and named, not drawn;
 * - `dimension` an entity or place dimension: the values with the most records (`top`), or every US state on the grid
 *   (form `map`);
 * - `field` (a label of the dictionary, found exactly once): records by the value of a cell, for a table whose dates
 *   or categories sit inside the record (a "dateAdded" field by month). The snapshot is read whole, at most 4,999
 *   records in five selects; a larger one is refused. With `format` the cells are dates or periods grouped by `by`;
 *   with `top` they are categories, the values with the most records drawn and the rest counted as "all other values".
 * Counts by an indexed dimension come from the store's own counts (migration 0069 facets), one call of at most 1,000
 * values; they must be exact and complete, or the tile is refused.
 */
export type RecordsPer =
  | { dimension: "period"; format: PeriodFormat; cadence?: Cadence; by?: CountBucket; window?: number }
  | { dimension: IndexedDimension; top: number }
  | { field: string; format: PeriodFormat; cadence?: Cadence; by?: CountBucket; window?: number }
  | { field: string; top: number };

/**
 * Records counted, never a measure (`transform: "records"`), so a table without a provable unit still gets a chart.
 * The counts are the store's own, by an indexed dimension (migration 0069 facet counts), exact for every value drawn;
 * a table whose counts one bounded read cannot give exactly is refused, and the refusal names it. Counts need no unit:
 * the axis and the headline say "records" and never a measure word. Any table qualifies, with or without a profile.
 */
export type RecordsTileSpec = TileLayout & {
  id: string;
  collection: string;
  datasetId: string;
  title: string;
  /** The table in a sentence, as the headline opens ("The FDA enforcement report"). */
  subject: string;
  note?: string;
  transform: "records";
  headline: "records";
  /** bars: records per period; ranked-bars: the entities or places with the most records; map: records per state. */
  form: "bars" | "ranked-bars" | "map";
  per: RecordsPer;
  /** What the counted values are, plural, in the publisher's sense ("operators", "states"), for a ranked count. */
  noun?: string;
};

export type TileSpec =
  | SeriesTileSpec
  | ShareTileSpec
  | RankTileSpec
  | CompareTileSpec
  | MixTileSpec
  | MapTileSpec
  | DistributionTileSpec
  | CurveTileSpec
  | StatTileSpec
  | RecordsTileSpec;

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
  /** The figure in the reader-scale axis unit ("4.175" on a "USD trillions" axis), when the result has a `reader`. */
  axisDisplay?: string;
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

/**
 * One bar of a count: how many records carry this period, entity, place or cell value. A count has no single record
 * behind it, so its mark opens the records table filtered to it (`filter`), where the table allows that filter.
 */
export type CountPoint = {
  /** The period, key or cell value as stored ("2026-10", "CA"); for a group of periods the group's identity ("2026"). */
  key: string;
  /** How a reader says it: "Oct 2026", "2026", or the name as stored. */
  label: string;
  /** ISO date of the period's start, on a time axis. */
  date?: string;
  /** Records, exact. */
  count: number;
  /** The count as printed ("1,234"). */
  display: string;
  /** The records table filtered to the mark, or null when no filter of the records table selects them. */
  filter: { period?: string; entity?: string; geography?: string; q?: string } | null;
};

/** One series of a compare, mix or curve result: its name, plotted unit, source and points in period order. */
export type TileLine = {
  /** "line0", "line1", ... in spec order. The colour slot follows it, never a rank. */
  key: string;
  label: string;
  /** The unit as the source states it for this series. */
  unit: string;
  /** The unit of the plotted figures ("%" for a percent change); the same as `unit` for a level. */
  plotUnit: string;
  source: { datasetId: string; snapshotId: string; field: string };
  points: TilePoint[];
  /** Reader scale of this series' axis when its unit is on the whitelist of `scale.ts` (small multiples only). */
  reader?: ReaderFigure;
};

/** A state, DC or a territory on a map result. */
export type MapPlace = {
  /** Postal code ("CA", "DC", "PR"). */
  code: string;
  /** Name as `geo/us-states.ts` writes it ("California"). */
  name: string;
  /** The key the record carries in the dimension read, as stored ("06", "CA", "California"). */
  key: string;
  /** The figure drawn (a level, a change, or a count of records); null: no figure (the state is hatched). */
  value: number | null;
  display: string;
  /** The stored cell (null for a count, or when the cell was null). */
  text: string | null;
  /** Row of the record behind the figure; null for a count or a state without a record. */
  row: number | null;
  /** For a count: the records table filtered to the place. */
  filter?: CountPoint["filter"];
};

/** One bin of a histogram: records whose figure is in [from, to); an end bin has one open side. */
export type DistributionBin = {
  /** Lower edge as decimal text, null for the bin below the first edge. */
  from: string | null;
  /** Upper edge as decimal text, null for the bin at or above the last edge. */
  to: string | null;
  /** "10 to 12", "below 6", "20 and above", in the unit. */
  label: string;
  count: number;
  /** Up to five names of the bin's entities, largest figure first, for the tooltip. */
  members: string[];
};

/**
 * The marks of a round 6 form, beside the fields every result carries. `points` of the result hold the lead series
 * (compare, stat), the whole (mix), the entities (distribution) or the latest curve, so a reader of round 4 still finds
 * the figures behind the headline there.
 */
export type TileShape =
  | { kind: "compare"; layout: "overlay" | "multiples"; lines: TileLine[] }
  | {
      kind: "mix";
      draw: "areas" | "columns";
      /** True when the layers are shares of the whole (percent), false for levels in the unit. */
      share: boolean;
      parts: TileLine[];
      whole: TileLine;
      /** The largest difference found between the sum of the parts and the whole over the periods drawn, as printed. */
      largestGap: string;
    }
  | {
      kind: "map";
      scale: "sequential" | "diverging";
      /** Every state and DC, in the order of `geo/us-states.ts`. */
      places: MapPlace[];
      /** Territories with a record, listed beneath the grid. */
      territories: MapPlace[];
      /** States and DC without a figure, named in the caption. */
      missing: { code: string; name: string }[];
      /** Keys of records that are not a state or territory (the nation, a region), counted, never drawn. */
      others: string[];
      /** Least and greatest figure drawn. */
      domain: [number, number];
    }
  | {
      kind: "distribution";
      draw: "histogram" | "dots";
      bins: DistributionBin[] | null;
      median: { value: number; display: string };
      quartiles: { lower: string; upper: string };
      /** Records with a figure. */
      count: number;
    }
  | {
      kind: "curve";
      /** The period of each curve, as a reader says it. */
      latestLabel: string;
      earlierLabel: string | null;
      /** One point per category, in category order; `label` is the category's. */
      latest: TilePoint[];
      earlier: TilePoint[] | null;
      /** The table and snapshot of each category, in category order (each may be its own table). */
      sources: { datasetId: string; snapshotId: string }[];
    }
  | {
      kind: "stat";
      /** The change over a year as printed with its sign ("+0.4"), its unit ("%", "pp" or the unit) and against what. */
      change: { display: string; unit: string; sign: -1 | 0 | 1; against: string } | null;
    }
  | {
      kind: "records";
      /** What was counted. */
      per: RecordsPer;
      counts: CountPoint[];
      /** Records counted in the table (or in the groups drawn, when `window` cuts it). */
      total: number;
      /** Records whose period or cell is not of the declared format, or not a state: counted, not drawn. */
      unplaced: number;
      /** Values counted beyond those drawn (ranked counts): their records, summed. */
      rest: number;
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
      /**
       * The headline level in reader scale ("$24.07 trillion") with the stored figure as filed beneath it and the
       * chart's axis in the same scale, when the unit is on the whitelist of `scale.ts`. Absent otherwise.
       */
      reader?: ReaderFigure;
      periodFormat: PeriodFormat;
      points: TilePoint[];
      gaps: TileGaps;
      derivation: TileDerivation | null;
      refs: TileRefs;
      /** The marks of a round 6 form (compare, mix, map, distribution, curve, stat, records); absent for the others. */
      shape?: TileShape;
      /** A sentence for the source line about how the tile reads its records ("State names from the FIPS codes ..."). */
      sourceNote?: string;
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
  /** The other tables a multi-series tile reads (compare, mix, curve), after its own. */
  also?: { datasetId: string; table: string; code?: string }[];
};

/** A computed tile as a board serves it. */
export type BoardTile = TileLayout & {
  id: string;
  title: string;
  form: TileForm;
  transform: TileTransform;
  note?: string;
  /**
   * The rows behind the chart, for the "Open records" link: the series address, the cross-section read (rank, map,
   * distribution), the series of several tables (compare, mix, curve; the first is the tile's own table), or what a
   * count counted.
   */
  selection:
    | { series: SeriesAddress }
    | { across: CrossSpec & { period: string } }
    | { lines: { datasetId: string; series: SeriesAddress }[] }
    | { records: RecordsPer };
  source: TileSource;
  result: TileResult;
};

export type Board = {
  id: string;
  title: string;
  /** Tiles that computed, in board order. */
  tiles: BoardTile[];
  /** Tiles that did not, with the reason in one sentence; the board shows each in its place as one quiet line. */
  refused: { id: string; title: string; reason: string }[];
  /**
   * Tiles of the request left for another request because this one spent its read budget (40 selects); the client
   * asks for them again, and every tile computed so far is kept per snapshot on the server.
   */
  deferred?: string[];
  /** When the server computed the board (ISO time). */
  computedAt: string;
};

/** A tile's place on a board, from the specs alone: what a board renders before any figure arrives. */
export type BoardLayoutTile = { id: string; title: string; form: TileForm; size: "regular" | "wide"; collection: string; datasetId: string };

/** A section of a board: its heading (null for the tiles that lead the board) and its tiles in board order. */
export type BoardLayoutSection = { title: string | null; tiles: BoardLayoutTile[] };

export type BoardLayout = { id: string; title: string; sections: BoardLayoutSection[] };

export type BoardRead =
  | { ok: true; data: Board }
  | { ok: false; reason: "unavailable" | "not-found" | "invalid" | "timeout" | "error"; message: string };
