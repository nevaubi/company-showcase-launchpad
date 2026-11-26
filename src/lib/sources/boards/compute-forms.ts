/**
 * The forms of round 6, pure: from the cells the reads return to the figures a tile draws. The rules of `compute.ts`
 * hold for every one: a cell is a number only through `readNative`; gaps are counted and named, never zero; periods
 * are placed only by the declared format; figures are exact decimals rounded once for print; every derived figure
 * states its formula and the stored cells behind it; the headline is assembled from the figures the tile carries.
 *
 * Multi-series forms (compare, mix, curve) read each series as a series tile does (`computeSeriesTile`: its unit, its
 * subject check, its periods), so a series that would be refused alone refuses the tile that holds it.
 */
import { readNative } from "../numbers";
import { parsePeriod, type ParsedPeriod, type PeriodFormat } from "../periods";
import { GRID_PLACES, MIN_STATE_KEYS, TERRITORIES, type UsPlace } from "../geo/us-states";
import {
  absDecimal,
  addDecimal,
  compareDecimal,
  formatDecimal,
  halfDecimal,
  parseDecimal,
  ratioDecimal,
  roundDecimal,
  signOf,
  subtractDecimal,
  sumDecimals,
  toNumber,
  type Decimal,
} from "./decimal";
import {
  SPAN,
  at,
  changeText,
  computeChange,
  computeSeriesTile,
  crossValues,
  emptyGaps,
  figureUnitOf,
  named,
  periodId,
  periodLabel,
  refuse,
  unitWords,
  yearEarlierId,
  type CellInput,
  type RankCellInput,
  type TileContext,
  type WholeTable,
} from "./compute";
import { axisLabel } from "./scale";
import { RULE_WORDS, namedFromCodes, placeName, stateRule } from "./places";
import type {
  Cadence,
  CompareTileSpec,
  CountPoint,
  CurveTileSpec,
  DistributionBin,
  DistributionTileSpec,
  MapPlace,
  MapTileSpec,
  MixTileSpec,
  RecordsTileSpec,
  SeriesTileSpec,
  StatTileSpec,
  TileGaps,
  TileLine,
  TilePoint,
  TileResult,
  TileSeriesSpec,
} from "./types";

const EN_DASH = "–";
const ALL = 100_000;

/** One series read for a multi-series tile: what the caller established about it, and its cells. */
export type LineInput = { context: TileContext; cells: readonly CellInput[] };

type Ok = Extract<TileResult, { ok: true }>;

const capital = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const lower = (text: string) => (text && !/^[A-Z]{2}/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);
const integer = (n: number) => n.toLocaleString("en-US");

/** The cell of a point as an exact decimal, through the same reading the compute used. */
function decimalOf(text: string | null, context: TileContext): Decimal | null {
  const reading = readNative(text, { markers: context.markers, grouping: context.grouping });
  return reading.kind === "number" ? parseDecimal(reading.text.replace(/,/g, "")) : null;
}

/** A series of a multi-series tile as a series tile, so it is read and checked as one. */
function lineSpec(
  tile: CompareTileSpec | MixTileSpec | CurveTileSpec,
  line: TileSeriesSpec,
  key: string,
  options: Pick<SeriesTileSpec, "transform" | "headline" | "changeAs" | "window"> & { subject?: string },
): SeriesTileSpec {
  return {
    id: `${tile.id}:${key}`,
    collection: tile.collection,
    datasetId: line.datasetId ?? tile.datasetId,
    measure: line.measure ?? tile.measure,
    title: line.label,
    subject: options.subject ?? capital(line.subject ?? line.label),
    verb: tile.verb,
    subjectCheck: line.subjectCheck,
    unit: line.unit ?? tile.unit,
    decimals: line.decimals ?? tile.decimals,
    form: "line",
    transform: options.transform,
    headline: options.headline,
    series: line.series,
    window: options.window,
    ...(options.changeAs ? { changeAs: options.changeAs } : {}),
  };
}

function addGaps(into: TileGaps, from: TileGaps, label: string) {
  into.count += from.count;
  into.nulls += from.nulls;
  into.empties += from.empties;
  into.markers += from.markers;
  into.texts += from.texts;
  into.noBase += from.noBase;
  into.otherPeriods += from.otherPeriods;
  for (const e of from.examples) if (into.examples.length < 3) into.examples.push(`${label}: ${e}`);
}

function toLine(key: string, label: string, result: Ok, context: TileContext, points: TilePoint[] = result.points): TileLine {
  return {
    key,
    label,
    unit: result.unit,
    plotUnit: result.plotUnit,
    source: { datasetId: context.datasetId, snapshotId: context.snapshotId, field: context.field },
    points,
    ...(result.reader ? { reader: result.reader } : {}),
  };
}

const pointId = (p: TilePoint, cadence: Cadence) => (p.date ? periodId(p.date, cadence) : p.key);

/**
 * A series of a multi-series tile ends at its latest figure: records after it whose cell is not a number (a holiday, a
 * month not yet published for one part) are left out of its read and counted as gaps of the tile, so one series that
 * lags does not refuse the others. The period each series ends on is named where it leads a sentence.
 */
function trimTrailing(input: LineInput): { input: LineInput; dropped: TileGaps } {
  const dropped = emptyGaps();
  const placed = input.cells
    .map((cell) => ({ cell, parsed: cell.period == null ? null : parsePeriod(cell.period, input.context.format) }))
    .filter((x): x is { cell: CellInput; parsed: ParsedPeriod } => x.parsed !== null)
    .sort((a, b) => a.parsed.order - b.parsed.order);
  const drop = new Set<CellInput>();
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const reading = readNative(placed[i].cell.text, { markers: input.context.markers, grouping: input.context.grouping });
    if (reading.kind === "number") break;
    drop.add(placed[i].cell);
    dropped.count += 1;
    if (reading.kind === "null") dropped.nulls += 1;
    else if (reading.kind === "empty") dropped.empties += 1;
    else if (reading.kind === "marker") dropped.markers += 1;
    else dropped.texts += 1;
    if (dropped.examples.length < 3) dropped.examples.push(`${periodLabel(placed[i].parsed, input.context.cadence)}: no figure`);
  }
  return drop.size ? { input: { context: input.context, cells: input.cells.filter((c) => !drop.has(c)) }, dropped } : { input, dropped };
}

// ---------------------------------------------------------------- compare

/** Two to six series on one time axis: one chart when their plotted units agree, small multiples when they differ. */
export function computeCompareTile(spec: CompareTileSpec, read: readonly LineInput[]): TileResult {
  let lines = read;
  if (spec.lines.length < 2 || spec.lines.length > 6) return refuse("A compare tile draws two to six series.");
  if (lines.length !== spec.lines.length) return refuse("Every series of the tile must be read.");
  const isChange = spec.transform !== "level";
  const headline = spec.headline === "spread" ? "level" : spec.headline;
  if (spec.headline === "spread" && isChange) return refuse("A spread is taken between levels, not between changes.");
  const trimmed = lines.map(trimTrailing);
  lines = trimmed.map((t) => t.input);
  const results: Ok[] = [];
  for (const [i, line] of spec.lines.entries()) {
    const lead = i === 0;
    const r = computeSeriesTile(
      lineSpec(spec, line, `line${i}`, {
        transform: spec.transform,
        headline: isChange ? "change" : headline,
        changeAs: isChange || (lead && spec.headline === "level") ? spec.changeAs : undefined,
        window: spec.window,
        ...(lead ? { subject: spec.subject } : {}),
      }),
      lines[i].context,
      lines[i].cells,
    );
    if (!r.ok) return refuse(`${line.label}: ${r.reason}`);
    results.push(r);
  }
  const layout = results.every((r) => r.plotUnit === results[0].plotUnit) ? "overlay" : "multiples";
  const lead = results[0];
  const gaps = emptyGaps();
  results.forEach((r, i) => addGaps(gaps, r.gaps, spec.lines[i].label));
  trimmed.forEach((t, i) => addGaps(gaps, t.dropped, spec.lines[i].label));
  // One chart in a reader scale: every line on the lead's axis, labelled in its unit.
  const axis = layout === "overlay" && !isChange && lead.reader && results.every((r) => r.unit === lead.unit) ? lead.reader.axis : null;
  const tileLines = results.map((r, i) => {
    const points = axis
      ? r.points.map((p) => {
          const d = p.value === null ? null : decimalOf(p.text, lines[i].context);
          return d ? { ...p, axisDisplay: axisLabel(d, axis) } : p;
        })
      : r.points;
    return toLine(`line${i}`, spec.lines[i].label, r, lines[i].context, points);
  });
  const base: Ok = { ...lead, gaps, shape: { kind: "compare", layout, lines: tileLines } };
  if (spec.headline !== "spread") return base;

  const spread = spec.spread;
  if (!spread || spread.of === spread.less || !spec.lines[spread.of] || !spec.lines[spread.less])
    return refuse("A spread headline names two different series of the tile.");
  const of = results[spread.of];
  const less = results[spread.less];
  const ofContext = lines[spread.of].context;
  const lessContext = lines[spread.less].context;
  if (of.unit !== less.unit) return refuse(`A spread needs one unit; ${spec.lines[spread.of].label} is in ${of.unit} and ${spec.lines[spread.less].label} in ${less.unit}.`);
  if (ofContext.cadence !== lessContext.cadence) return refuse("A spread needs two series of one frequency.");
  const lessById = new Map(less.points.map((p) => [pointId(p, lessContext.cadence), p] as const));
  let pair: { a: TilePoint; b: TilePoint; da: Decimal; db: Decimal } | null = null;
  for (let i = of.points.length - 1; i >= 0 && !pair; i -= 1) {
    const a = of.points[i];
    const b = lessById.get(pointId(a, ofContext.cadence));
    if (a.value === null || !b || b.value === null) continue;
    const da = decimalOf(a.text, ofContext);
    const db = decimalOf(b.text, lessContext);
    if (da && db) pair = { a, b, da, db };
  }
  if (!pair) return refuse(`No period has a figure for both ${spec.lines[spread.of].label} and ${spec.lines[spread.less].label}.`);
  const decimals = Math.max(spec.lines[spread.of].decimals ?? spec.decimals, spec.lines[spread.less].decimals ?? spec.decimals);
  const diff = roundDecimal(subtractDecimal(pair.da, pair.db), decimals);
  const sign = signOf(diff);
  const ofSubject = capital(spec.lines[spread.of].subject ?? spec.lines[spread.of].label);
  const lessSubject = lower(spec.lines[spread.less].subject ?? spec.lines[spread.less].label);
  const label = pair.a.label;
  const latestOf = [...of.points].reverse().find((p) => p.value !== null);
  const tail = latestOf && latestOf.label !== label ? ` ${spec.lines[spread.less].label} has no figure for ${latestOf.label}.` : "";
  const { reader: _reader, ...unscaled } = base;
  return {
    ...unscaled,
    headline:
      (sign === 0
        ? `${ofSubject} was level with ${lessSubject} ${at(ofContext.cadence, label)}.`
        : `${ofSubject} was ${changeText(absDecimal(diff), "difference", of.unit, decimals)} ${sign > 0 ? "above" : "below"} ${lessSubject} ${at(ofContext.cadence, label)}.`) + tail,
    figure: formatDecimal(diff, { decimals, plus: true }),
    figureUnit: of.unit === "Percent" ? "pp" : figureUnitOf(of.unit),
    asOf: label,
    derivation: {
      formula: `figure of ${spec.lines[spread.of].label} for ${label} − figure of ${spec.lines[spread.less].label} for ${label}`,
      inputs: [
        { label: `${spec.lines[spread.of].label}, ${label}`, text: pair.a.text ?? "", period: pair.a.key, row: pair.a.row, field: ofContext.field },
        { label: `${spec.lines[spread.less].label}, ${label}`, text: pair.b.text ?? "", period: pair.b.key, row: pair.b.row, field: lessContext.field },
      ],
    },
    refs: { datasetId: ofContext.datasetId, snapshotId: ofContext.snapshotId, rows: [pair.a.row], field: ofContext.field },
  };
}

// ---------------------------------------------------------------- mix

/** The parts of a stated whole, period by period, refused where they do not sum to it within the tolerance. */
export function computeMixTile(spec: MixTileSpec, wholeRead: LineInput, partsRead: readonly LineInput[]): TileResult {
  let whole = wholeRead;
  let parts = partsRead;
  if (spec.parts.length < 2 || spec.parts.length > 6) return refuse("A mix tile draws two to six parts.");
  if (parts.length !== spec.parts.length) return refuse("Every part of the tile must be read.");
  const tolerance = parseDecimal(spec.tolerance);
  if (!tolerance || signOf(tolerance) < 0) return refuse(`The tolerance "${spec.tolerance}" is not a decimal of zero or more.`);
  const level = { transform: "level" as const, headline: "level" as const, window: ALL };
  const wholeTrim = trimTrailing(whole);
  const partTrim = parts.map(trimTrailing);
  whole = wholeTrim.input;
  parts = partTrim.map((t) => t.input);
  const wholeResult = computeSeriesTile(lineSpec(spec, spec.whole, "whole", level), whole.context, whole.cells);
  if (!wholeResult.ok) return refuse(`${spec.whole.label}: ${wholeResult.reason}`);
  const partResults: Ok[] = [];
  for (const [i, part] of spec.parts.entries()) {
    const r = computeSeriesTile(lineSpec(spec, part, `part${i}`, level), parts[i].context, parts[i].cells);
    if (!r.ok) return refuse(`${part.label}: ${r.reason}`);
    if (r.unit !== wholeResult.unit) return refuse(`${part.label} is in ${r.unit}; the whole is in ${wholeResult.unit}.`);
    partResults.push(r);
  }
  const cadence = whole.context.cadence;
  if (parts.some((p) => p.context.cadence !== cadence)) return refuse("The parts and the whole are not of one frequency.");
  const unit = wholeResult.unit;
  const share = spec.transform === "share";
  const partById = partResults.map((r) => new Map(r.points.map((p) => [pointId(p, cadence), p] as const)));
  const window = wholeResult.points.slice(-Math.max(1, spec.window));
  const gaps = emptyGaps();
  addGaps(gaps, wholeResult.gaps, spec.whole.label);
  addGaps(gaps, wholeTrim.dropped, spec.whole.label);
  partResults.forEach((r, i) => addGaps(gaps, r.gaps, spec.parts[i].label));
  partTrim.forEach((t, i) => addGaps(gaps, t.dropped, spec.parts[i].label));

  const layers: TilePoint[][] = spec.parts.map(() => []);
  let largest: Decimal = { int: 0n, scale: 0 };
  let lead: { period: TilePoint; parts: TilePoint[]; shares: Decimal[] } | null = null;
  for (const w of window) {
    const id = pointId(w, cadence);
    const ps = partById.map((m) => m.get(id) ?? null);
    const W = w.value === null ? null : decimalOf(w.text, whole.context);
    const P = ps.map((p, i) => (p && p.value !== null ? decimalOf(p.text, parts[i].context) : null));
    const complete = W !== null && P.every((d) => d !== null);
    const base = (p: TilePoint | null, fallback: TilePoint) => ({
      key: p?.key ?? fallback.key,
      label: fallback.label,
      date: fallback.date,
      text: p?.text ?? null,
      row: p?.row ?? fallback.row,
    });
    if (!complete) {
      ps.forEach((p, i) => layers[i].push({ ...base(p, w), value: null, display: EN_DASH }));
      continue;
    }
    const sum = sumDecimals(P as Decimal[]);
    const gap = absDecimal(subtractDecimal(sum, W!));
    if (compareDecimal(gap, tolerance) > 0)
      return refuse(
        `In ${w.label} the parts sum to ${formatDecimal(sum)}${unitWords(unit)}; the publisher's total is ${w.text}${unitWords(unit)}, ${formatDecimal(gap)} apart, beyond the tolerance of ${spec.tolerance}.`,
      );
    if (compareDecimal(gap, largest) > 0) largest = gap;
    const shares = (P as Decimal[]).map((d) => ratioDecimal(d, W!, 100, 1));
    if (shares.some((s) => s === null)) {
      ps.forEach((p, i) => layers[i].push({ ...base(p, w), value: null, display: EN_DASH }));
      continue;
    }
    ps.forEach((p, i) => {
      const d = (P as Decimal[])[i];
      const s = shares[i] as Decimal;
      layers[i].push({
        ...base(p, w),
        value: toNumber(share ? s : d),
        display: share ? formatDecimal(s, { decimals: 1 }) : formatDecimal(d, { decimals: spec.parts[i].decimals ?? spec.decimals }),
        ...(!share && wholeResult.reader ? { axisDisplay: axisLabel(d, wholeResult.reader.axis) } : {}),
      });
    });
    lead = { period: w, parts: ps as TilePoint[], shares: shares as Decimal[] };
  }
  if (!lead) return refuse(`No period of the ${spec.window} drawn has a figure for the whole and every part.`);
  const latest = window[window.length - 1];
  const tail = lead.period !== latest ? ` No share for ${latest.label}: the whole or a part has no figure.` : "";
  const figure = formatDecimal(lead.shares[0], { decimals: 1 });
  const wholeSubject = lower(spec.whole.subject ?? spec.whole.label);
  const wholePoints = window.map((p) => {
    if (!wholeResult.reader || p.value === null || share) return p;
    const d = decimalOf(p.text, whole.context);
    return d ? { ...p, axisDisplay: axisLabel(d, wholeResult.reader.axis) } : p;
  });
  return {
    ok: true,
    headline: `${spec.subject} ${spec.verb ?? "was"} ${figure}% of ${wholeSubject} ${at(cadence, lead.period.label)}.${tail}`,
    figure,
    figureUnit: "%",
    asOf: lead.period.label,
    unit,
    plotUnit: share ? "%" : unit,
    ...(!share && wholeResult.reader ? { reader: wholeResult.reader } : {}),
    periodFormat: whole.context.format,
    points: wholePoints,
    gaps,
    derivation: {
      formula: `100 × ${spec.parts[0].label} ÷ ${spec.whole.label}, ${lead.period.label}, rounded to one decimal; in every period drawn the ${spec.parts.length} parts sum to the publisher's total within ${spec.tolerance}${unitWords(unit)}`,
      inputs: [
        { label: `${spec.parts[0].label}, ${lead.period.label}`, text: lead.parts[0].text ?? "", period: lead.parts[0].key, row: lead.parts[0].row, field: parts[0].context.field },
        { label: `${spec.whole.label}, ${lead.period.label}`, text: lead.period.text ?? "", period: lead.period.key, row: lead.period.row, field: whole.context.field },
      ],
    },
    refs: { datasetId: whole.context.datasetId, snapshotId: whole.context.snapshotId, rows: [lead.period.row], field: whole.context.field },
    shape: {
      kind: "mix",
      draw: spec.draw,
      share,
      parts: partResults.map((r, i) => ({ ...toLine(`line${i}`, spec.parts[i].label, r, parts[i].context, layers[i]), plotUnit: share ? "%" : r.unit })),
      whole: toLine("whole", spec.whole.label, wholeResult, whole.context, wholePoints),
      largestGap: formatDecimal(largest),
    },
  };
}

// ---------------------------------------------------------------- places

/**
 * The text of the same period a year earlier, as the publisher writes it: the leading year less one ("2026-10" to
 * "2025-10", "20260930" to "20250930", "2026Q3" to "2025Q3"). Null when the text has no leading year, or the result
 * is not the period a year earlier in the declared format (29 February, a weekly or daily cadence).
 */
export function yearEarlierText(text: string, format: PeriodFormat, cadence: Cadence): string | null {
  if (cadence === "week" || cadence === "day") return null;
  const m = /^(\d{4})(.*)$/.exec(text);
  if (!m) return null;
  const candidate = `${Number(m[1]) - 1}${m[2]}`;
  const now = parsePeriod(text, format);
  const then = parsePeriod(candidate, format);
  if (!now || !then) return null;
  return yearEarlierId(now.start, cadence) === periodId(then.start, cadence) ? candidate : null;
}

/** One measure, or its change over a year, at one period across US states. */
export function computeMapTile(
  spec: MapTileSpec,
  context: TileContext,
  latest: readonly RankCellInput[],
  earlier: readonly RankCellInput[] | null,
  table?: WholeTable,
): TileResult {
  const isChange = spec.transform === "change-12m";
  if (isChange && !spec.changeAs) return refuse("A change map must say whether the change is a percent or a difference.");
  if (isChange && spec.changeAs === "percent" && spec.unit === "Percent")
    return refuse("A rate stated in percent changes by a difference in percentage points; a percent change of it is not shown.");
  if (isChange && table) return refuse("A whole table without periods has no year earlier to compare with.");
  const read = crossValues(latest, context, spec.unit, spec.subjectCheck, table);
  if (!read.ok) return refuse(read.reason);
  const { label, when, valued, gaps } = read.values;
  const rule = stateRule(latest.map((c) => c.key));
  if (!rule) return refuse(`The places of this table are not US states by one rule (postal code, FIPS code or name): fewer than ${MIN_STATE_KEYS} match.`);

  let prior: Map<string, { cell: RankCellInput; value: Decimal }> | null = null;
  let priorLabel: string | null = null;
  if (isChange) {
    if (!earlier || earlier.length === 0) return refuse(`No records for the period a year before ${label}.`);
    const before = crossValues(earlier, context, spec.unit, spec.subjectCheck);
    if (!before.ok) return refuse(`A year earlier: ${before.reason}`);
    priorLabel = before.values.label;
    prior = new Map(before.values.valued.map((v) => [v.cell.key, v] as const));
  }
  const as = spec.changeAs ?? "percent";
  const changeDecimals = as === "percent" ? 1 : spec.decimals;
  const figures = new Map<string, { cell: RankCellInput; value: Decimal; base?: { cell: RankCellInput; value: Decimal } }>();
  for (const v of valued) {
    if (!rule.places.has(v.cell.key)) continue;
    if (!prior) {
      figures.set(v.cell.key, v);
      continue;
    }
    const base = prior.get(v.cell.key);
    const change = base ? computeChange(v.value, base.value, as, changeDecimals) : null;
    if (!base || !change) {
      gaps.noBase += 1;
      continue;
    }
    figures.set(v.cell.key, { cell: v.cell, value: change, base });
  }
  const decimals = isChange ? changeDecimals : spec.decimals;
  let fromCode = false;
  const placeFor = (p: UsPlace): MapPlace => {
    const key = [...rule.places.entries()].find(([, q]) => q.code === p.code)?.[0];
    const f = key ? figures.get(key) : undefined;
    if (key && f) {
      fromCode ||= placeName(f.cell, rule).fromCode;
      return { code: p.code, name: p.name, key, value: toNumber(f.value), display: formatDecimal(f.value, { decimals, plus: isChange }), text: f.cell.text, row: f.cell.row };
    }
    const cell = key ? latest.find((c) => c.key === key) : undefined;
    return { code: p.code, name: p.name, key: key ?? p.code, value: null, display: EN_DASH, text: cell?.text ?? null, row: cell?.row ?? null };
  };
  const places = GRID_PLACES.map(placeFor);
  const territories = TERRITORIES.map(placeFor).filter((t) => [...rule.places.values()].some((q) => q.code === t.code));
  const drawn = [...places, ...territories].filter((p) => p.value !== null);
  if (drawn.length === 0) return refuse(`No state has a figure ${when}.`);
  const sorted = [...drawn].sort((a, b) => (b.value as number) - (a.value as number) || a.code.localeCompare(b.code));
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const values = places.flatMap((p) => (p.value === null ? [] : [p.value]));
  const domain: [number, number] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
  const unitText = isChange ? (as === "percent" ? "%" : unitWords(spec.unit)) : unitWords(spec.unit);
  const n = drawn.length;
  const headline = isChange
    ? `${top.name} had the largest change in ${spec.subject} of ${n} ${spec.entities} over the ${SPAN[context.cadence]} to ${label}, ${top.display}${unitText}; ${bottom.name} the smallest, ${bottom.display}${unitText}.`
    : `${top.name} had the highest ${spec.subject} of ${n} ${spec.entities} ${when}, ${top.display}${unitText}; ${bottom.name} the lowest, ${bottom.display}${unitText}.`;
  const topFigure = figures.get(top.key)!;
  const points: TilePoint[] = sorted.map((p) => ({ key: p.key, label: p.name, value: p.value, display: p.display, text: p.text, row: p.row as number }));
  return {
    ok: true,
    headline,
    figure: top.display,
    figureUnit: isChange ? (as === "percent" ? "%" : spec.unit === "Percent" ? "pp" : figureUnitOf(spec.unit)) : figureUnitOf(spec.unit),
    asOf: table ? `Retrieved ${table.retrieved}` : label,
    unit: spec.unit,
    plotUnit: isChange ? (as === "percent" ? "%" : spec.unit === "Percent" ? "percentage points" : spec.unit) : spec.unit,
    periodFormat: context.format,
    points,
    gaps,
    derivation: isChange
      ? {
          formula:
            as === "percent"
              ? `for each state, 100 × (figure for ${label} ÷ figure for ${priorLabel} − 1), rounded to one decimal`
              : `for each state, figure for ${label} − figure for ${priorLabel}`,
          inputs: [
            { label: `${top.name}, ${label}`, text: topFigure.cell.text ?? "", period: topFigure.cell.period ?? "", row: topFigure.cell.row, field: context.field },
            { label: `${top.name}, ${priorLabel}`, text: topFigure.base!.cell.text ?? "", period: topFigure.base!.cell.period ?? "", row: topFigure.base!.cell.row, field: context.field },
          ],
        }
      : {
          formula: `${n} records of ${label} with a figure, matched to states by their ${RULE_WORDS[rule.kind]}`,
          inputs: [{ label: top.name, text: topFigure.cell.text ?? "", period: topFigure.cell.period ?? "", row: topFigure.cell.row, field: context.field }],
        },
    refs: { datasetId: context.datasetId, snapshotId: context.snapshotId, rows: [top.row as number, bottom.row as number], field: context.field },
    ...(fromCode ? { sourceNote: namedFromCodes(rule.kind) } : {}),
    shape: {
      kind: "map",
      scale: isChange ? "diverging" : "sequential",
      places,
      territories,
      missing: places.filter((p) => p.value === null).map((p) => ({ code: p.code, name: p.name })),
      others: rule.others,
      domain,
    },
  };
}

// ---------------------------------------------------------------- distribution

function middle(sorted: readonly Decimal[]): Decimal {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : halfDecimal(addDecimal(sorted[n / 2 - 1], sorted[n / 2]));
}

/** One measure at one period across the entities of a table: bins or dots, the median and quartiles. */
export function computeDistributionTile(spec: DistributionTileSpec, context: TileContext, cells: readonly RankCellInput[], table?: WholeTable): TileResult {
  const read = crossValues(cells, context, spec.unit, spec.subjectCheck, table);
  if (!read.ok) return refuse(read.reason);
  const { label, when, valued, gaps } = read.values;
  if (valued.length < 4) return refuse(`A distribution needs at least four figures; ${label} has ${valued.length}.`);
  const sorted = [...valued].sort((a, b) => compareDecimal(a.value, b.value) || a.cell.row - b.cell.row);
  const values = sorted.map((v) => v.value);
  const n = values.length;
  const median = middle(values);
  const lowerHalf = values.slice(0, Math.floor(n / 2));
  const upperHalf = values.slice(Math.ceil(n / 2));
  const q1 = middle(lowerHalf);
  const q3 = middle(upperHalf);
  const print = (d: Decimal) => formatDecimal(d, { decimals: spec.decimals });
  let bins: DistributionBin[] | null = null;
  if (spec.draw.as === "histogram") {
    const edges = spec.draw.edges.map((e) => parseDecimal(e));
    if (edges.length < 2 || edges.some((e) => e === null)) return refuse("A histogram needs at least two bin edges written as decimals.");
    for (let i = 1; i < edges.length; i += 1)
      if (compareDecimal(edges[i - 1]!, edges[i]!) >= 0) return refuse("The bin edges must rise.");
    const e = edges as Decimal[];
    const texts = spec.draw.edges;
    const buckets: { from: string | null; to: string | null; label: string; members: { name: string; value: Decimal }[] }[] = [
      { from: null, to: texts[0], label: `below ${texts[0]}`, members: [] },
      ...texts.slice(0, -1).map((t, i) => ({ from: t, to: texts[i + 1], label: `${t} to ${texts[i + 1]}`, members: [] as { name: string; value: Decimal }[] })),
      { from: texts[texts.length - 1], to: null, label: `${texts[texts.length - 1]} and above`, members: [] },
    ];
    for (const v of sorted) {
      let at = 0;
      if (compareDecimal(v.value, e[0]) < 0) at = 0;
      else if (compareDecimal(v.value, e[e.length - 1]) >= 0) at = buckets.length - 1;
      else for (let i = 0; i < e.length - 1; i += 1) if (compareDecimal(v.value, e[i]) >= 0 && compareDecimal(v.value, e[i + 1]) < 0) at = i + 1;
      buckets[at].members.push({ name: v.cell.name ?? v.cell.key, value: v.value });
    }
    bins = buckets
      .filter((b, i) => b.members.length > 0 || (i > 0 && i < buckets.length - 1))
      .map((b) => ({
        from: b.from,
        to: b.to,
        label: b.label,
        count: b.members.length,
        members: [...b.members].sort((x, y) => compareDecimal(y.value, x.value)).slice(0, 5).map((m) => m.name),
      }));
  }
  const medianCells = n % 2 === 1 ? [sorted[(n - 1) / 2]] : [sorted[n / 2 - 1], sorted[n / 2]];
  const points: TilePoint[] = [...sorted].reverse().map(({ cell, value }) => ({
    key: cell.key,
    label: cell.name ?? cell.key,
    value: toNumber(value),
    display: print(value),
    text: cell.text,
    row: cell.row,
  }));
  const words = unitWords(spec.unit);
  return {
    ok: true,
    headline: `The median ${spec.subject} of ${n} ${spec.entities} was ${print(median)}${words} ${when}; the middle half were between ${print(q1)} and ${print(q3)}${words.trim() === "%" ? "%" : ""}.`,
    figure: print(median),
    figureUnit: figureUnitOf(spec.unit),
    asOf: table ? `Retrieved ${table.retrieved}` : label,
    unit: spec.unit,
    plotUnit: spec.unit,
    periodFormat: context.format,
    points,
    gaps,
    derivation: {
      formula: `the middle of the ${n} figures of ${label} in order${n % 2 === 0 ? " (half the sum of the two middle figures)" : ""}, rounded to ${spec.decimals} decimals for print; the quartiles are the middles of the lower and upper halves`,
      inputs: medianCells.map(({ cell }) => ({ label: cell.name ?? cell.key, text: cell.text ?? "", period: cell.period ?? "", row: cell.row, field: context.field })),
    },
    refs: { datasetId: context.datasetId, snapshotId: context.snapshotId, rows: medianCells.map((m) => m.cell.row), field: context.field },
    shape: {
      kind: "distribution",
      draw: spec.draw.as,
      bins,
      median: { value: toNumber(median), display: print(median) },
      quartiles: { lower: print(q1), upper: print(q3) },
      count: n,
    },
  };
}

// ---------------------------------------------------------------- curve

/** One period's values across an ordered category, with the same period a year earlier when asked. */
export function computeCurveTile(spec: CurveTileSpec, read: readonly LineInput[]): TileResult {
  if (spec.categories.length < 3 || spec.categories.length > 12) return refuse("A curve tile draws three to twelve categories.");
  if (read.length !== spec.categories.length) return refuse("Every category of the tile must be read.");
  const level = { transform: "level" as const, headline: "level" as const, window: ALL };
  const trimmed = read.map(trimTrailing);
  const categories = trimmed.map((t) => t.input);
  const results: Ok[] = [];
  for (const [i, c] of spec.categories.entries()) {
    const r = computeSeriesTile(lineSpec(spec, c, `cat${i}`, level), categories[i].context, categories[i].cells);
    if (!r.ok) return refuse(`${c.label}: ${r.reason}`);
    if (r.unit !== results[0]?.unit && i > 0) return refuse(`${c.label} is in ${r.unit}; ${spec.categories[0].label} in ${results[0].unit}.`);
    results.push(r);
  }
  const cadence = categories[0].context.cadence;
  if (categories.some((c) => c.context.cadence !== cadence)) return refuse("The categories are not of one frequency.");
  const maps = results.map((r) => new Map(r.points.map((p) => [pointId(p, cadence), p] as const)));
  const has = (id: string) => maps.every((m) => (m.get(id)?.value ?? null) !== null);
  let target: string | null = null;
  if (spec.period && spec.period !== "latest") {
    const parsed = parsePeriod(spec.period, categories[0].context.format);
    target = parsed ? periodId(parsed.start, cadence) : null;
    if (!target || !has(target)) return refuse(`Not every category has a figure for ${spec.period}.`);
  } else {
    const ids = [...maps[0].keys()].reverse();
    target = ids.find(has) ?? null;
    if (!target) return refuse("No period has a figure for every category.");
  }
  const curveAt = (id: string): TilePoint[] =>
    maps.map((m, i) => {
      const p = m.get(id)!;
      return { key: `cat${i}`, label: spec.categories[i].label, value: p.value, display: p.display, text: p.text, row: p.row, date: p.date };
    });
  const latest = curveAt(target);
  const latestLabel = maps[0].get(target)!.label;
  const gaps = emptyGaps();
  results.forEach((r, i) => addGaps(gaps, r.gaps, spec.categories[i].label));
  trimmed.forEach((t, i) => addGaps(gaps, t.dropped, spec.categories[i].label));
  let earlier: TilePoint[] | null = null;
  let earlierLabel: string | null = null;
  if (spec.yearEarlier) {
    const start = maps[0].get(target)!.date;
    const id = start ? yearEarlierId(start, cadence) : null;
    if (id && has(id)) {
      earlier = curveAt(id);
      earlierLabel = maps[0].get(id)!.label;
    } else gaps.noBase += spec.categories.length;
  }
  const decimals = spec.decimals;
  const firstD = decimalOf(latest[0].text, categories[0].context)!;
  const last = latest[latest.length - 1];
  const lastD = decimalOf(last.text, categories[categories.length - 1].context)!;
  const lastCat = spec.categories[spec.categories.length - 1];
  const firstCat = spec.categories[0];
  const lastSubject = capital(lastCat.subject ?? lastCat.label);
  const unit = results[0].unit;
  const words = unitWords(unit);
  const lastText = formatDecimal(lastD, { decimals: lastCat.decimals ?? decimals });
  let headline: string;
  let figure: string;
  let figureUnit: string;
  let formula: string;
  const inputs = [
    { label: `${lastCat.label}, ${latestLabel}`, text: last.text ?? "", period: maps[maps.length - 1].get(target)!.key, row: last.row, field: categories[categories.length - 1].context.field },
  ];
  if (spec.headline === "spread") {
    const diff = roundDecimal(subtractDecimal(lastD, firstD), decimals);
    const sign = signOf(diff);
    headline =
      sign === 0
        ? `${lastSubject} was ${lastText}${words} ${at(cadence, latestLabel)}, level with ${lower(firstCat.subject ?? firstCat.label)}.`
        : `${lastSubject} was ${lastText}${words} ${at(cadence, latestLabel)}, ${changeText(absDecimal(diff), "difference", unit, decimals)} ${sign > 0 ? "above" : "below"} ${lower(firstCat.subject ?? firstCat.label)}.`;
    figure = formatDecimal(diff, { decimals, plus: true });
    figureUnit = unit === "Percent" ? "pp" : figureUnitOf(unit);
    formula = `figure of ${lastCat.label} for ${latestLabel} − figure of ${firstCat.label} for ${latestLabel}`;
    inputs.push({ label: `${firstCat.label}, ${latestLabel}`, text: latest[0].text ?? "", period: maps[0].get(target)!.key, row: latest[0].row, field: categories[0].context.field });
  } else {
    figure = lastText;
    figureUnit = figureUnitOf(unit);
    let comparison = "";
    formula = `figure of ${lastCat.label} for ${latestLabel}`;
    if (earlier && earlierLabel) {
      const before = decimalOf(earlier[earlier.length - 1].text, categories[categories.length - 1].context)!;
      const diff = roundDecimal(subtractDecimal(lastD, before), decimals);
      const sign = signOf(diff);
      comparison = sign === 0 ? `, unchanged from ${named(cadence, earlierLabel)}` : `, ${changeText(absDecimal(diff), "difference", unit, decimals)} ${sign > 0 ? "above" : "below"} ${named(cadence, earlierLabel)}`;
      formula = `figure of ${lastCat.label} for ${latestLabel} − figure for ${earlierLabel}`;
      inputs.push({ label: `${lastCat.label}, ${earlierLabel}`, text: earlier[earlier.length - 1].text ?? "", period: "", row: earlier[earlier.length - 1].row, field: categories[categories.length - 1].context.field });
    }
    headline = `${lastSubject} was ${lastText}${words} ${at(cadence, latestLabel)}${comparison}.`;
  }
  const lastContext = categories[categories.length - 1].context;
  return {
    ok: true,
    headline,
    figure,
    figureUnit,
    asOf: latestLabel,
    unit,
    plotUnit: unit,
    periodFormat: categories[0].context.format,
    points: latest,
    gaps,
    derivation: { formula, inputs },
    refs: { datasetId: lastContext.datasetId, snapshotId: lastContext.snapshotId, rows: [last.row], field: lastContext.field },
    shape: { kind: "curve", latestLabel, earlierLabel, latest, earlier },
  };
}

// ---------------------------------------------------------------- stat

/** The latest level, its change over a year and a sparkline of the latest periods. */
export function computeStatTile(spec: StatTileSpec, context: TileContext, cells: readonly CellInput[]): TileResult {
  const series: SeriesTileSpec = {
    id: spec.id,
    collection: spec.collection,
    datasetId: spec.datasetId,
    measure: spec.measure,
    title: spec.title,
    subject: spec.subject,
    verb: spec.verb,
    subjectCheck: spec.subjectCheck,
    unit: spec.unit,
    decimals: spec.decimals,
    note: spec.note,
    form: "line",
    transform: "level",
    headline: "level",
    series: spec.series,
    window: spec.window ?? 24,
    ...(spec.changeAs ? { changeAs: spec.changeAs } : {}),
  };
  const r = computeSeriesTile(series, context, cells);
  if (!r.ok) return r;
  let change: { display: string; unit: string; sign: -1 | 0 | 1; against: string } | null = null;
  const inputs = r.derivation?.inputs;
  if (spec.changeAs && inputs && inputs.length === 2) {
    const a = decimalOf(inputs[0].text, context);
    const b = decimalOf(inputs[1].text, context);
    const as = spec.changeAs;
    const d = a && b ? computeChange(a, b, as, as === "percent" ? 1 : spec.decimals) : null;
    if (d)
      change = {
        display: formatDecimal(d, { decimals: as === "percent" ? 1 : spec.decimals, plus: true }),
        unit: as === "percent" ? "%" : spec.unit === "Percent" ? "pp" : figureUnitOf(spec.unit),
        sign: signOf(d),
        against: named(context.cadence, inputs[1].label),
      };
  }
  return { ...r, shape: { kind: "stat", change } };
}

// ---------------------------------------------------------------- records

/** The counts a count tile reads: the store's facet counts of an indexed dimension, or the cells of a whole snapshot. */
export type CountInput =
  | { from: "facets"; values: readonly { value: string; label: string | null; rows: number; exact: boolean }[]; complete: boolean }
  | { from: "cells"; cells: readonly (string | null)[] };

type Group = { key: string; label: string; date: string; count: number; texts: Set<string> };

function cadenceOfFormat(format: PeriodFormat): Cadence {
  if (format === "yyyymm" || format === "yyyy-mm" || format === "roc-yyymm") return "month";
  if (format === "quarter") return "quarter";
  if (format === "year") return "year";
  return "day";
}

function group(parsed: ParsedPeriod, by: NonNullable<Extract<RecordsTileSpec["per"], { format: PeriodFormat }>["by"]>, cadence: Cadence) {
  const y = parsed.start.slice(0, 4);
  const m = Number(parsed.start.slice(5, 7));
  if (by === "year") return { key: y, label: y, date: `${y}-01-01`, cadence: "year" as Cadence };
  if (by === "quarter") {
    const q = Math.floor((m - 1) / 3) + 1;
    return { key: `${y}Q${q}`, label: `Q${q} ${y}`, date: `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, cadence: "quarter" as Cadence };
  }
  if (by === "month") {
    const key = parsed.start.slice(0, 7);
    return { key, label: periodLabel({ ...parsed, start: `${key}-01` }, "month"), date: `${key}-01`, cadence: "month" as Cadence };
  }
  return { key: periodId(parsed.start, cadence), label: periodLabel(parsed, cadence), date: parsed.start, cadence };
}

/** Records counted per period or per value; exact counts, never a measure. */
export function computeRecordsTile(
  spec: RecordsTileSpec,
  input: CountInput,
  about: { datasetId: string; snapshotId: string; retrieved: string | null },
): TileResult {
  if (input.from === "facets") {
    if (!input.complete)
      return refuse("The store's counts of this table do not fit one read (more than 1,000 values or 250,000 records); counts this large need a precomputed summary.");
    const inexact = input.values.find((v) => !v.exact);
    if (inexact) return refuse(`The count of ${inexact.value} is a floor, not exact; counts this large need a precomputed summary.`);
  }
  // value -> records, in the order first met
  const counts = new Map<string, { rows: number; label: string | null }>();
  let blank = 0;
  if (input.from === "facets") for (const v of input.values) counts.set(v.value, { rows: v.rows, label: v.label });
  else
    for (const cell of input.cells) {
      if (cell === null || cell.trim() === "") {
        blank += 1;
        continue;
      }
      const prior = counts.get(cell);
      counts.set(cell, { rows: (prior?.rows ?? 0) + 1, label: null });
    }
  const per = spec.per;
  const retrieved = about.retrieved ? `as retrieved on ${about.retrieved}` : "in the stored copy";
  const filterOf = (key: string): CountPoint["filter"] => {
    if ("field" in per) return null;
    if (per.dimension === "period") return { period: key };
    if (per.dimension === "entity_id" || per.dimension === "entity_name") return { entity: key };
    return { geography: key };
  };
  const all = [...counts.values()].reduce((s, c) => s + c.rows, 0) + blank;
  const refs = { datasetId: about.datasetId, snapshotId: about.snapshotId, rows: [] as number[], field: "field" in per ? per.field : per.dimension };
  const base = {
    ok: true as const,
    figureUnit: "records",
    unit: "records",
    plotUnit: "records",
    gaps: emptyGaps(),
    refs,
  };

  if ("format" in per) {
    const cadence = per.cadence ?? cadenceOfFormat(per.format);
    const by = per.by ?? "period";
    const groups = new Map<string, Group>();
    let unplaced = blank;
    const examples: string[] = [];
    for (const [value, c] of counts) {
      const parsed = parsePeriod(value, per.format);
      if (!parsed) {
        unplaced += c.rows;
        if (examples.length < 3) examples.push(`"${value.slice(0, 40)}"`);
        continue;
      }
      const g = group(parsed, by, cadence);
      const prior = groups.get(g.key) ?? { key: g.key, label: g.label, date: g.date, count: 0, texts: new Set<string>() };
      prior.count += c.rows;
      prior.texts.add(value);
      groups.set(g.key, prior);
    }
    const ordered = [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (ordered.length === 0) return refuse(`No record has a period of the declared format (${per.format}).`);
    const placed = ordered.reduce((s, g) => s + g.count, 0);
    const shown = per.window ? ordered.slice(-per.window) : ordered;
    const max = ordered.reduce((m, g) => (g.count > m.count ? g : m), ordered[0]);
    const groupCadence: Cadence = by === "period" ? cadence : by;
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const points: CountPoint[] = shown.map((g) => ({
      key: g.key,
      label: g.label,
      date: g.date,
      count: g.count,
      display: integer(g.count),
      filter: g.texts.size === 1 && !("field" in per) ? filterOf([...g.texts][0]) : null,
    }));
    const span = first === last ? at(groupCadence, first.label) : `from ${first.label} to ${last.label}`;
    const tail = unplaced > 0 ? ` ${integer(unplaced)} ${unplaced === 1 ? "record has" : "records have"} no period of the declared format${examples.length ? ` (${examples.join(", ")})` : ""}.` : "";
    return {
      ...base,
      headline: `${spec.subject} holds ${integer(all)} records ${span}; the most, ${integer(max.count)}, ${at(groupCadence, max.label)}.${tail}`,
      figure: integer(all),
      asOf: last.label,
      periodFormat: per.format,
      points: [],
      derivation: {
        formula: "field" in per ? `records of the stored copy counted by ${per.field}, by ${by === "period" ? "period" : by}` : `records counted by the store's period index, by ${by === "period" ? "period" : by}`,
        inputs: [],
      },
      shape: { kind: "records", per, counts: points, total: placed, unplaced, rest: 0 },
    };
  }

  const top = Math.max(1, per.top);
  const entries = [...counts.entries()].map(([key, c]) => ({ key, label: c.label, rows: c.rows }));
  if (entries.length === 0) return refuse("The table has no records to count.");
  if (spec.form === "map") {
    const rule = stateRule(entries.map((e) => e.key));
    if (!rule) return refuse(`The places of this table are not US states by one rule (postal code, FIPS code or name): fewer than ${MIN_STATE_KEYS} match.`);
    const byCode = new Map<string, { key: string; rows: number }>();
    for (const e of entries) {
      const place = rule.places.get(e.key);
      if (place) byCode.set(place.code, { key: e.key, rows: e.rows });
    }
    const placeFor = (p: UsPlace): MapPlace => {
      const c = byCode.get(p.code);
      return c
        ? { code: p.code, name: p.name, key: c.key, value: c.rows, display: integer(c.rows), text: null, row: null, filter: filterOf(c.key) }
        : { code: p.code, name: p.name, key: p.code, value: null, display: EN_DASH, text: null, row: null };
    };
    const places = GRID_PLACES.map(placeFor);
    const territories = TERRITORIES.map(placeFor).filter((t) => t.value !== null);
    const drawn = [...places, ...territories].filter((p) => p.value !== null).sort((a, b) => (b.value as number) - (a.value as number) || a.code.localeCompare(b.code));
    const values = places.flatMap((p) => (p.value === null ? [] : [p.value]));
    const inStates = drawn.reduce((s, p) => s + (p.value as number), 0);
    const leader = drawn[0];
    return {
      ...base,
      headline: `${spec.subject} holds ${integer(all)} records ${retrieved}; ${leader.name} has the most, ${integer(leader.value as number)}, of ${drawn.length} ${spec.noun ?? "states and territories"}.`,
      figure: integer(all),
      asOf: about.retrieved ? `Retrieved ${about.retrieved}` : "Stored copy",
      periodFormat: "text",
      points: drawn.map((p) => ({ key: p.key, label: p.name, value: p.value, display: p.display, text: null, row: -1 })),
      derivation: { formula: `records counted by the store's ${"dimension" in per ? per.dimension.replace("_", " ") : per.field} index, matched to states by their ${RULE_WORDS[rule.kind]}`, inputs: [] },
      shape: {
        kind: "map",
        scale: "sequential",
        places,
        territories,
        missing: places.filter((p) => p.value === null).map((p) => ({ code: p.code, name: p.name })),
        others: rule.others,
        domain: values.length ? [Math.min(...values), Math.max(...values)] : [0, 0],
      },
      ...(rule.kind !== "name" && inStates > 0 ? { sourceNote: namedFromCodes(rule.kind) } : {}),
    };
  }
  const rule = !("field" in per) && (per.dimension === "geo_code" || per.dimension === "entity_id") ? stateRule(entries.map((e) => e.key)) : null;
  let fromCode = false;
  const ranked = [...entries].sort((a, b) => b.rows - a.rows || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const shown = ranked.slice(0, top);
  const rest = ranked.slice(top).reduce((s, e) => s + e.rows, 0);
  const points: CountPoint[] = shown.map((e) => {
    const named = placeName({ key: e.key, name: e.label }, rule);
    fromCode ||= named.fromCode;
    return { key: e.key, label: named.name, count: e.rows, display: integer(e.rows), filter: filterOf(e.key) };
  });
  const noun = spec.noun ?? ("field" in per ? `values of ${per.field}` : per.dimension.startsWith("geo") ? "places" : "entities");
  return {
    ...base,
    headline: `${spec.subject} holds ${integer(all)} records ${retrieved}; ${points[0].label} has the most, ${integer(points[0].count)}, of ${integer(entries.length)} ${noun}.`,
    figure: integer(all),
    asOf: about.retrieved ? `Retrieved ${about.retrieved}` : "Stored copy",
    periodFormat: "text",
    points: [],
    derivation: {
      formula: "field" in per ? `records of the stored copy counted by ${per.field}, most first` : `records counted by the store's ${per.dimension.replace("_", " ")} index, most first`,
      inputs: [],
    },
    ...(fromCode && rule ? { sourceNote: namedFromCodes(rule.kind) } : {}),
    shape: { kind: "records", per, counts: points, total: all - rest, unplaced: blank, rest },
  };
}
