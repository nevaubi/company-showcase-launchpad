/**
 * From stored cells to a tile: strict readings only, gaps counted and named, every transform's formula
 * explicit, the headline assembled from the figures. Pure: the caller reads the rows (bounded reads) and
 * resolves the unit; this module decides whether the rows carry the figure the tile claims.
 *
 * Rules:
 * - a cell is a number only through `readNative` (a plain decimal); a marker, an empty cell, a null and any
 *   other text are gaps, never zeros;
 * - a period is placed only by the declared format; a record whose period is not of that format (an annual
 *   total in a monthly table) is left out and counted;
 * - a change over a year needs the period a year earlier present with a number, otherwise there is no figure;
 * - figures are computed from the stored digits (exact decimals) and rounded once for print;
 * - the latest period must carry a number: a tile never shows an older figure as if it were current;
 * - a level in a whitelisted scale unit also carries its reader scale (`scale.ts`); the headline keeps the
 *   stored figure and unit.
 */
import { readNative, type NativeReading } from "../numbers";
import { parsePeriod, type ParsedPeriod, type PeriodFormat } from "../periods";
import {
  absDecimal,
  formatDecimal,
  parseDecimal,
  percentChange,
  ratioDecimal,
  roundDecimal,
  signOf,
  subtractDecimal,
  toNumber,
  type Decimal,
} from "./decimal";
import { axisLabel, readerFigure, type ReaderFigure } from "./scale";
import { namedFromCodes, placeName, stateRule } from "./places";
import type {
  Cadence,
  RankTileSpec,
  SeriesTileSpec,
  ShareTileSpec,
  TileDerivation,
  TileGaps,
  TilePoint,
  TileResult,
  TileSpec,
} from "./types";

/** A tile of round 4 (one series, a share of two, a ranking), drawn with a line, columns or ranked bars. */
export function isClassicSpec(spec: TileSpec): spec is SeriesTileSpec | ShareTileSpec | RankTileSpec {
  return spec.transform !== "records" && (spec.form === "line" || spec.form === "bars" || spec.form === "ranked-bars");
}

/** A tile of one series over time: its level or its change over a year. */
export function isSeriesSpec(spec: TileSpec): spec is SeriesTileSpec {
  return isClassicSpec(spec) && spec.transform !== "share" && spec.transform !== "rank";
}

/** A tile ranking entities or places at one period. */
export function isRankSpec(spec: TileSpec): spec is RankTileSpec {
  return spec.transform === "rank";
}

/** One stored record of a series, as the reads return it and the caller shapes it. */
export type CellInput = {
  row: number;
  /** The period as stored (the period dimension, a period field, or the composed text of several fields). */
  period: string | null;
  /** The measure's cell, exactly as stored. */
  text: string | null;
  /** The unit cell of the same record, when the unit comes from a column. */
  unit?: string | null;
  /** The cell of the tile's `subjectCheck` field, when it has one. */
  check?: string | null;
};

/** One record of a cross-section: an entity or a place at one period. */
export type RankCellInput = CellInput & { key: string; name: string | null };

/** What the caller established about the rows before computing. */
export type TileContext = {
  datasetId: string;
  snapshotId: string;
  /** The measure's field label. */
  field: string;
  /** fixed: the unit stated once (a dictionary entry or the publisher's documentation); column: read per record. */
  unit: { from: "fixed"; text: string } | { from: "column" };
  format: PeriodFormat;
  cadence: Cadence;
  markers?: readonly string[];
  grouping?: "," | "none";
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DASH = "–";

type Placed = {
  cell: CellInput;
  parsed: ParsedPeriod;
  id: string;
  label: string;
  reading: NativeReading;
  value: Decimal | null;
};

export const refuse = (reason: string): TileResult => ({ ok: false, reason });

const year = (iso: string) => Number(iso.slice(0, 4));
const month = (iso: string) => Number(iso.slice(5, 7));
const quarterOf = (iso: string) => Math.floor((month(iso) - 1) / 3) + 1;

function minusDays(iso: string, days: number): string {
  const t = Date.UTC(year(iso), month(iso) - 1, Number(iso.slice(8, 10))) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The identity of a period under a cadence: two records with one identity are the same period. */
export function periodId(start: string, cadence: Cadence): string {
  if (cadence === "month") return start.slice(0, 7);
  if (cadence === "quarter") return `${year(start)}Q${quarterOf(start)}`;
  if (cadence === "year") return start.slice(0, 4);
  return start;
}

/** The identity of the period a year earlier: same month, quarter or year less one; 52 weeks for a weekly series. */
export function yearEarlierId(start: string, cadence: Cadence): string | null {
  if (cadence === "month") return `${year(start) - 1}-${start.slice(5, 7)}`;
  if (cadence === "quarter") return `${year(start) - 1}Q${quarterOf(start)}`;
  if (cadence === "year") return String(year(start) - 1);
  if (cadence === "week") return minusDays(start, 364);
  return null;
}

/** How a reader says a period of this cadence. */
export function periodLabel(parsed: ParsedPeriod, cadence: Cadence): string {
  if (cadence === "month") return `${MONTHS[month(parsed.start) - 1]} ${year(parsed.start)}`;
  if (cadence === "quarter") return `Q${quarterOf(parsed.start)} ${year(parsed.start)}`;
  if (cadence === "year") return String(year(parsed.start));
  return parsed.label;
}

export const at = (cadence: Cadence, label: string) =>
  cadence === "week" ? `in the week ending ${label}` : cadence === "day" ? `on ${label}` : `in ${label}`;
/** A period named as the object of a comparison ("above Oct 2025", "above the week ending Nov 20, 2025"). */
export const named = (cadence: Cadence, label: string) => (cadence === "week" ? `the week ending ${label}` : label);

export const SPAN: Record<Cadence, string> = {
  day: "day",
  week: "52 weeks",
  month: "12 months",
  quarter: "four quarters",
  year: "year",
};

export function describeReading(reading: NativeReading): string {
  if (reading.kind === "null") return "missing in the source";
  if (reading.kind === "empty") return "empty in the source";
  if (reading.kind === "marker") return `marked "${reading.text}"`;
  if (reading.kind === "text") return `written "${reading.text.slice(0, 24)}"`;
  return reading.text;
}

export function emptyGaps(): TileGaps {
  return { count: 0, nulls: 0, empties: 0, markers: 0, texts: 0, noBase: 0, otherPeriods: 0, examples: [] };
}

function noteGap(gaps: TileGaps, example: string) {
  if (gaps.examples.length < 3) gaps.examples.push(example);
}

export function countReading(gaps: TileGaps, reading: NativeReading, label: string) {
  if (reading.kind === "number") return;
  gaps.count += 1;
  if (reading.kind === "null") gaps.nulls += 1;
  else if (reading.kind === "empty") gaps.empties += 1;
  else if (reading.kind === "marker") gaps.markers += 1;
  else gaps.texts += 1;
  noteGap(gaps, `${label}: ${describeReading(reading)}`);
}

/** The unit and subject checks every record of a selection must pass. Null when they pass. */
export function checkRecords(
  cells: readonly CellInput[],
  context: TileContext,
  unit: string,
  check: { field: string; value: string } | undefined,
): string | null {
  if (context.unit.from === "fixed" && context.unit.text !== unit)
    return `The source states the unit "${context.unit.text}" for ${context.field}; the tile expects "${unit}".`;
  for (const cell of cells) {
    if (context.unit.from === "column" && cell.unit !== unit) {
      const stated = cell.unit == null || cell.unit === "" ? "no unit" : `the unit "${cell.unit}"`;
      return `Row ${cell.row} (${cell.period ?? "no period"}) states ${stated}; the tile expects "${unit}".`;
    }
    if (check && cell.check !== check.value)
      return `Row ${cell.row} has ${check.field} "${cell.check ?? ""}"; the tile expects "${check.value}".`;
  }
  return null;
}

/** Places the records of one series on its periods, in period order. */
function place(
  cells: readonly CellInput[],
  context: TileContext,
  gaps: TileGaps,
): { ok: true; placed: Placed[] } | { ok: false; reason: string } {
  const byId = new Map<string, Placed>();
  for (const cell of cells) {
    const parsed = cell.period == null ? null : parsePeriod(cell.period, context.format);
    if (!parsed) {
      gaps.otherPeriods += 1;
      continue;
    }
    const id = periodId(parsed.start, context.cadence);
    const label = periodLabel(parsed, context.cadence);
    const prior = byId.get(id);
    if (prior)
      return { ok: false, reason: `Two records for ${label} (rows ${prior.cell.row} and ${cell.row}): the selection is not one series.` };
    const reading = readNative(cell.text, { markers: context.markers, grouping: context.grouping });
    const value = reading.kind === "number" ? parseDecimal(reading.text.replace(/,/g, "")) : null;
    byId.set(id, { cell, parsed, id, label, reading, value });
  }
  const placed = [...byId.values()].sort((a, b) => a.parsed.order - b.parsed.order);
  return { ok: true, placed };
}

/** What is printed right after a big figure: "%" for Percent, nothing for a count, else the unit as stated. */
export function figureUnitOf(unit: string): string {
  return unit === "Percent" ? "%" : unit === "Number" ? "" : unit;
}

/**
 * The unit as it follows a figure in a sentence, as the source states it: "Percent" is written "%", a count
 * stated as "Number" needs no word, an index base goes in brackets ("134.4 (Index 2000=100)").
 */
export function unitWords(unit: string): string {
  if (unit === "Percent") return "%";
  if (unit === "Number") return "";
  if (/^Index\b/.test(unit)) return ` (${unit})`;
  return ` ${unit}`;
}

export function changeText(change: Decimal, as: "percent" | "difference", unit: string, decimals: number): string {
  const size = formatDecimal(absDecimal(change), { decimals });
  if (as === "percent") return `${size}%`;
  if (unit === "Percent") return `${size} percentage ${size === "1" ? "point" : "points"}`;
  return `${size}${unitWords(unit)}`.trim();
}

export function computeChange(latest: Decimal, base: Decimal, as: "percent" | "difference", decimals: number): Decimal | null {
  return as === "percent" ? percentChange(latest, base, 1) : roundDecimal(subtractDecimal(latest, base), decimals);
}

function input(p: Placed, field: string) {
  return { label: p.label, text: p.cell.text ?? "", period: p.cell.period ?? "", row: p.cell.row, field };
}

/** A tile over one series: its level, or its change over a year. */
export function computeSeriesTile(spec: SeriesTileSpec, context: TileContext, cells: readonly CellInput[]): TileResult {
  const failed = checkRecords(cells, context, spec.unit, spec.subjectCheck);
  if (failed) return refuse(failed);
  const isChange = spec.transform !== "level";
  if (spec.transform === "change-1y-quarterly" && context.cadence !== "quarter")
    return refuse(`The tile asks for a change over four quarters; the series is ${context.cadence}ly.`);
  if ((isChange || spec.changeAs) && context.cadence === "day")
    return refuse("A daily series has no period a year earlier to compare with.");
  if (isChange && !spec.changeAs) return refuse("A change tile must say whether the change is a percent or a difference.");
  // a rate going from 4.0 to 4.4 rose 0.4 percentage points, not "10.0%" (review int-code N5)
  if ((spec.changeAs ?? "percent") === "percent" && (isChange || spec.changeAs) && spec.unit === "Percent")
    return refuse("A rate stated in percent changes by a difference in percentage points; a percent change of it is not shown.");

  const gaps = emptyGaps();
  const placedResult = place(cells, context, gaps);
  if (!placedResult.ok) return refuse(placedResult.reason);
  const placed = placedResult.placed;
  if (placed.length === 0) return refuse(`No record of the selection has a period of the declared format (${context.format}).`);
  for (const p of placed) countReading(gaps, p.reading, p.label);

  const latest = placed[placed.length - 1];
  if (!latest.value)
    return refuse(`The latest period, ${latest.label}, has no figure (${describeReading(latest.reading)}).`);
  const byId = new Map(placed.map((p) => [p.id, p] as const));
  const baseOf = (p: Placed) => {
    const id = yearEarlierId(p.parsed.start, context.cadence);
    if (!id) return null;
    if (context.cadence !== "week") return byId.get(id) ?? null;
    // A weekly publisher moves a week's date for a holiday (FRED's mortgage survey on 18 Jun 2025, a
    // Wednesday). The week 52 weeks earlier is the observation closest to the date 364 days before, within
    // three days.
    for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
      const found = byId.get(minusDays(id, offset));
      if (found) return found;
    }
    return null;
  };

  const window = placed.slice(-Math.max(1, spec.window));
  const as = spec.changeAs ?? "percent";
  const changeDecimals = as === "percent" ? 1 : spec.decimals;
  // A level tile's figure is always the latest level; a change tile prints a percent or a difference.
  const reader = isChange ? null : readerFigure(spec.unit, latest.value, formatDecimal(latest.value, { decimals: spec.decimals }));
  const points: TilePoint[] = window.map((p) => {
    const base = { key: p.cell.period ?? "", label: p.label, date: p.parsed.start, text: p.cell.text, row: p.cell.row };
    if (!isChange) {
      return p.value
        ? {
            ...base,
            value: toNumber(p.value),
            display: formatDecimal(p.value, { decimals: spec.decimals }),
            ...(reader ? { axisDisplay: axisLabel(p.value, reader.axis) } : {}),
          }
        : { ...base, value: null, display: EN_DASH };
    }
    const prior = baseOf(p);
    const change = p.value && prior?.value ? computeChange(p.value, prior.value, as, changeDecimals) : null;
    if (!change) {
      if (p.value && !prior) gaps.noBase += 1;
      return { ...base, value: null, display: EN_DASH };
    }
    return { ...base, value: toNumber(change), display: formatDecimal(change, { decimals: changeDecimals, plus: true }) };
  });

  const level = formatDecimal(latest.value, { decimals: spec.decimals });
  const verb = spec.verb ?? "was";
  let headline: string;
  let figure: string;
  let figureUnit: string;
  let derivation: TileDerivation | null = null;
  const rows = [latest.cell.row];

  if (isChange || spec.changeAs) {
    const pairOf = (p: Placed) => {
      const prior = baseOf(p);
      const change = p.value && prior?.value ? computeChange(p.value, prior.value, as, changeDecimals) : null;
      return prior && change ? { prior, change } : null;
    };
    const missing = (p: Placed) => {
      const prior = baseOf(p);
      if (!prior) return `there is no record for the period a year before ${p.label}`;
      if (!prior.value) return `${prior.label} has no figure (${describeReading(prior.reading)})`;
      return `the figure for ${prior.label} is zero`;
    };
    const latestPair = pairOf(latest);
    // The latest period always leads. When it has no year-earlier figure, a level tile says so in a second
    // sentence; a change tile names the most recent period that has one and says why the latest has none.
    let lead = latest;
    let pair = latestPair;
    let tail = "";
    if (!latestPair) {
      if (!isChange) {
        figure = level;
        figureUnit = figureUnitOf(spec.unit);
        headline = `${spec.subject} ${verb} ${level}${unitWords(spec.unit)} ${at(context.cadence, latest.label)}. No comparison with a year earlier: ${missing(latest)}.`;
        return result(spec, context, latest, points, gaps, null, rows, headline, figure, figureUnit, isChange, as, reader);
      }
      const earlier = [...placed].reverse().find((p) => p !== latest && pairOf(p));
      if (!earlier) return refuse(`No period of the selection has a figure a year earlier: ${missing(latest)}.`);
      lead = earlier;
      pair = pairOf(earlier);
      tail = ` No change for ${latest.label}: ${missing(latest)}.`;
    }
    if (!pair || !lead.value) return refuse(`No change can be computed for ${latest.label}: ${missing(latest)}.`);
    const { prior, change } = pair;
    rows.length = 0;
    rows.push(lead.cell.row, prior.cell.row);
    derivation = {
      formula:
        as === "percent"
          ? `100 × (figure for ${lead.label} ÷ figure for ${prior.label} − 1), rounded to one decimal`
          : `figure for ${lead.label} − figure for ${prior.label}`,
      inputs: [input(lead, context.field), input(prior, context.field)],
    };
    const sign = signOf(change);
    const leadLevel = formatDecimal(lead.value, { decimals: spec.decimals });
    if (isChange && as === "percent") {
      figure = formatDecimal(change, { decimals: 1, plus: true });
      figureUnit = "%";
      headline =
        (sign === 0
          ? `${spec.subject} was unchanged over the ${SPAN[context.cadence]} to ${lead.label}.`
          : `${spec.subject} ${sign > 0 ? "rose" : "fell"} ${changeText(change, "percent", spec.unit, 1)} over the ${SPAN[context.cadence]} to ${lead.label}.`) + tail;
    } else {
      figure = isChange ? formatDecimal(change, { decimals: changeDecimals, plus: true }) : leadLevel;
      figureUnit = isChange ? (as === "percent" ? "%" : spec.unit === "Percent" ? "pp" : spec.unit) : figureUnitOf(spec.unit);
      const comparison =
        sign === 0
          ? `unchanged from ${named(context.cadence, prior.label)}`
          : `${changeText(change, as, spec.unit, changeDecimals)} ${sign > 0 ? "above" : "below"} ${named(context.cadence, prior.label)}`;
      headline = `${spec.subject} ${verb} ${leadLevel}${unitWords(spec.unit)} ${at(context.cadence, lead.label)}, ${comparison}.` + tail;
    }
    return result(spec, context, lead, points, gaps, derivation, rows, headline, figure, figureUnit, isChange, as, reader);
  } else {
    figure = level;
    figureUnit = figureUnitOf(spec.unit);
    headline = `${spec.subject} ${verb} ${level}${unitWords(spec.unit)} ${at(context.cadence, latest.label)}.`;
  }

  return result(spec, context, latest, points, gaps, derivation, rows, headline, figure, figureUnit, isChange, as, reader);
}

function result(
  spec: SeriesTileSpec,
  context: TileContext,
  lead: Placed,
  points: TilePoint[],
  gaps: TileGaps,
  derivation: TileDerivation | null,
  rows: number[],
  headline: string,
  figure: string,
  figureUnit: string,
  isChange: boolean,
  as: "percent" | "difference",
  reader: ReaderFigure | null,
): TileResult {
  return {
    ok: true,
    headline,
    figure,
    figureUnit,
    asOf: lead.label,
    unit: spec.unit,
    plotUnit: isChange ? (as === "percent" ? "%" : spec.unit === "Percent" ? "percentage points" : spec.unit) : spec.unit,
    ...(reader ? { reader } : {}),
    periodFormat: context.format,
    points,
    gaps,
    derivation,
    refs: { datasetId: context.datasetId, snapshotId: context.snapshotId, rows: [...rows], field: context.field },
  };
}

/** A tile of one series as a share of another, period by period. */
export function computeShareTile(
  spec: ShareTileSpec,
  context: TileContext,
  partCells: readonly CellInput[],
  wholeCells: readonly CellInput[],
): TileResult {
  const failed =
    checkRecords(partCells, context, spec.unit, spec.subjectCheck) ?? checkRecords(wholeCells, context, spec.unit, spec.ofSubjectCheck);
  if (failed) return refuse(failed);
  const gaps = emptyGaps();
  const part = place(partCells, context, gaps);
  if (!part.ok) return refuse(part.reason);
  const whole = place(wholeCells, context, gaps);
  if (!whole.ok) return refuse(whole.reason);
  if (part.placed.length === 0) return refuse(`No record of the selection has a period of the declared format (${context.format}).`);
  const wholeById = new Map(whole.placed.map((p) => [p.id, p] as const));
  for (const p of part.placed) countReading(gaps, p.reading, p.label);
  for (const p of whole.placed) countReading(gaps, p.reading, `${p.label} (${spec.ofSubject})`);

  const shareAt = (p: Placed): { share: Decimal; whole: Placed } | null => {
    const w = wholeById.get(p.id);
    if (!p.value || !w?.value) return null;
    const share = ratioDecimal(p.value, w.value, 100, 1);
    return share ? { share, whole: w } : null;
  };

  const latest = part.placed[part.placed.length - 1];
  const latestShare = shareAt(latest);
  if (!latestShare) return refuse(`The latest period, ${latest.label}, has no figure for both ${spec.subject} and ${spec.ofSubject}.`);

  const points: TilePoint[] = part.placed.slice(-Math.max(1, spec.window)).map((p) => {
    const s = shareAt(p);
    const base = { key: p.cell.period ?? "", label: p.label, date: p.parsed.start, text: p.cell.text, row: p.cell.row };
    return s ? { ...base, value: toNumber(s.share), display: formatDecimal(s.share, { decimals: 1 }) } : { ...base, value: null, display: EN_DASH };
  });
  const figure = formatDecimal(latestShare.share, { decimals: 1 });
  return {
    ok: true,
    headline: `${spec.subject} ${spec.verb ?? "was"} ${figure}% of ${spec.ofSubject} ${at(context.cadence, latest.label)}.`,
    figure,
    figureUnit: "%",
    asOf: latest.label,
    unit: spec.unit,
    plotUnit: "%",
    periodFormat: context.format,
    points,
    gaps,
    derivation: {
      formula: `100 × ${spec.subject} ÷ ${spec.ofSubject}, ${latest.label}, rounded to one decimal`,
      inputs: [input(latest, context.field), input(latestShare.whole, context.field)],
    },
    refs: { datasetId: context.datasetId, snapshotId: context.snapshotId, rows: [latest.cell.row, latestShare.whole.cell.row], field: context.field },
  };
}

/**
 * A whole small table without a period dimension, read in place of one period: its records are dated by the day the
 * store's copy was retrieved ("24 Nov 2026").
 */
export type WholeTable = { retrieved: string };

/** The figures of one period's cross-section (or of a whole small table), checked: one period, each key once. */
export type CrossValues = {
  /** How a reader says the period ("Q3 2026"), or "the copy retrieved 24 Nov 2026" for a whole table. */
  label: string;
  /** The period in a sentence: "in Q3 2026", "on Sep 30, 2026", "in the copy retrieved 24 Nov 2026". */
  when: string;
  /** The period as stored, or null for a whole table. */
  period: string | null;
  /** Records with a figure, in row order. */
  valued: { cell: RankCellInput; value: Decimal }[];
  /** Records read, with or without a figure. */
  records: number;
  gaps: TileGaps;
};

/** Reads the figures of a cross-section: one period of the declared format (or a whole table), each key once. */
export function crossValues(
  cells: readonly RankCellInput[],
  context: TileContext,
  unit: string,
  check: { field: string; value: string } | undefined,
  table?: WholeTable,
): { ok: true; values: CrossValues } | { ok: false; reason: string } {
  const failed = checkRecords(cells, context, unit, check);
  if (failed) return { ok: false, reason: failed };
  if (cells.length === 0) return { ok: false, reason: table ? "The table has no records." : "The cross-section has no records." };
  let label: string;
  let when: string;
  let period: string | null = null;
  if (table) {
    if (cells.some((c) => c.period != null)) return { ok: false, reason: "The table has periods; a whole table is read only when it has none." };
    label = `the copy retrieved ${table.retrieved}`;
    when = `in ${label}`;
  } else {
    const periods = new Set(cells.map((c) => c.period));
    if (periods.size !== 1) return { ok: false, reason: `The cross-section spans ${periods.size} periods; a ranking needs one.` };
    period = cells[0].period;
    const parsed = period == null ? null : parsePeriod(period, context.format);
    if (!parsed) return { ok: false, reason: `The period "${period ?? ""}" is not of the declared format (${context.format}).` };
    label = periodLabel(parsed, context.cadence);
    when = at(context.cadence, label);
  }
  const gaps = emptyGaps();
  const keys = new Set<string>();
  const valued: { cell: RankCellInput; value: Decimal }[] = [];
  for (const cell of cells) {
    if (keys.has(cell.key)) return { ok: false, reason: `${cell.key} appears twice in the ${table ? "table" : "cross-section"} (row ${cell.row}).` };
    keys.add(cell.key);
    const reading = readNative(cell.text, { markers: context.markers, grouping: context.grouping });
    countReading(gaps, reading, cell.name ?? cell.key);
    if (reading.kind !== "number") continue;
    const value = parseDecimal(reading.text.replace(/,/g, ""));
    if (value) valued.push({ cell, value });
  }
  if (valued.length === 0) return { ok: false, reason: `No record of ${label} has a figure for ${context.field}.` };
  return { ok: true, values: { label, when, period, valued, records: cells.length, gaps } };
}

/** A tile ranking the entities or places of one period (or of a whole small table) by the measure. */
export function computeRankTile(
  spec: RankTileSpec,
  context: TileContext,
  cells: readonly RankCellInput[],
  table?: WholeTable,
): TileResult {
  const read = crossValues(cells, context, spec.unit, spec.subjectCheck, table);
  if (!read.ok) return refuse(read.reason);
  const { label, when, valued: ranked, gaps } = read.values;
  const lowest = spec.across.order === "lowest";
  ranked.sort((a, b) => {
    const order = (lowest ? 1 : -1) * compareValues(a.value, b.value);
    return order !== 0 ? order : a.cell.row - b.cell.row;
  });
  const top = ranked.slice(0, Math.max(1, spec.across.top));
  // A place stored by its state code alone is named from the code (the source line says so).
  const states = cells.some((c) => !c.name) ? stateRule(cells.map((c) => c.key)) : null;
  const nameOf = (cell: RankCellInput) => placeName(cell, states).name;
  const namedFrom = states && top.some(({ cell }) => placeName(cell, states).fromCode) ? namedFromCodes(states.kind) : null;
  const leader = top[0];
  const figure = formatDecimal(leader.value, { decimals: spec.decimals });
  const reader = readerFigure(spec.unit, leader.value, figure);
  const points: TilePoint[] = top.map(({ cell, value }) => ({
    key: cell.key,
    label: nameOf(cell),
    value: toNumber(value),
    display: formatDecimal(value, { decimals: spec.decimals }),
    text: cell.text,
    row: cell.row,
    ...(reader ? { axisDisplay: axisLabel(value, reader.axis) } : {}),
  }));
  return {
    ok: true,
    headline: `${nameOf(leader.cell)} ${spec.verb ?? "had"} the ${lowest ? "smallest" : "largest"} ${spec.subject} of ${ranked.length} ${spec.entities} ${when}.`,
    figure,
    figureUnit: figureUnitOf(spec.unit),
    asOf: table ? `Retrieved ${table.retrieved}` : label,
    unit: spec.unit,
    plotUnit: spec.unit,
    ...(reader ? { reader } : {}),
    periodFormat: context.format,
    points,
    gaps,
    derivation: {
      formula: `${ranked.length} records of ${label} with a figure, ordered by ${context.field}, ${lowest ? "smallest" : "largest"} first`,
      inputs: top.slice(0, 1).map(({ cell }) => ({ label: nameOf(cell), text: cell.text ?? "", period: cell.period ?? "", row: cell.row, field: context.field })),
    },
    refs: { datasetId: context.datasetId, snapshotId: context.snapshotId, rows: top.map((t) => t.cell.row), field: context.field },
    ...(namedFrom ? { sourceNote: namedFrom } : {}),
  };
}

export function compareValues(a: Decimal, b: Decimal): number {
  const d = subtractDecimal(a, b);
  return signOf(d);
}
