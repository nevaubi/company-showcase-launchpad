/**
 * What a field is, decided from its dictionary entry and, when one is given, a reviewed hint.
 *
 * Production facts this is written against (25 Nov 2026): every one of 44,485 fields has
 * `type: "string"`, 4,969 have a numeric `native_type` (all FDIC), 6,195 have a `unit`, none
 * has a `scale`. So `type` is the store's type and says nothing, and a unit string is often a
 * remark ("Not explicitly specified in retrieved field metadata") and not a unit.
 *
 * The dictionary alone calls a field a quantity only when it gives a numeric native type AND
 * a unit that states a quantity. Everything else needs a hint from a profile, which names the
 * field by its key and is checked against the snapshot before it is used.
 */
import { groupNative, readNative } from "./numbers";
import type { SourceColumn, SourceDimension, SourceIngest } from "./schema";

export type FieldRole = "quantity" | "identifier" | "date" | "code" | "text" | "unknown";
export type FieldHint = { role?: FieldRole };

/** What a unit string says, read as words and never as a field name. */
export type UnitKind = "quantity" | "identifier" | "indicator" | "text" | "unstated";

const NUMERIC_TYPE = /^(number|numeric|integer|int|bigint|smallint|decimal|float|double|real)$/i;
const TEXT_TYPE = /^(string|text|varchar|char|character)$/i;
const DATE_TYPE = /^(date|datetime|timestamp|timestamptz|time)$/i;

/**
 * Written against every unit string in production (25 Nov 2026, 64 distinct): "Percent",
 * "USD thousands (monetary measures)", "MW", "short tons clean coal", "index; 2000=100" state a
 * quantity; "FDIC certificate identifier", "11-character census tract identifier" an
 * identifier; "Indicator" a flag; "Text / categorical / date; see definition" text. A string
 * that says the unit is not known, or lives elsewhere ("row-specific Physical Unit Label",
 * "Series-specific index base in unit column", "native source volume; unit not confirmed"),
 * states none: a profile has to say where the unit is.
 */
export function unitKind(unit: string | null | undefined): UnitKind {
  const text = unit?.trim();
  if (!text) return "unstated";
  if (/\bidentifier\b/i.test(text)) return "identifier";
  if (/^(indicator|flag|boolean)\b/i.test(text)) return "indicator";
  if (/^(text|categorical|category|date)\b/i.test(text)) return "text";
  if (/^(not explicitly|not specified|unspecified|unknown|mixed or ambiguous|see definition|n\/a$)/i.test(text))
    return "unstated";
  if (/\b(not confirmed|row-specific|in unit column|specific units|see source notes)\b/i.test(text))
    return "unstated";
  return "quantity";
}

/** The unit as the dictionary states it, or null when the string states no quantity. */
export function statedUnit(column: SourceColumn): string | null {
  return unitKind(column.unit) === "quantity" ? column.unit!.trim() : null;
}

function dictionaryRole(column: SourceColumn): FieldRole {
  const native = column.native_type?.trim();
  const unit = unitKind(column.unit);
  if (unit === "identifier") return "identifier";
  if (native && DATE_TYPE.test(native)) return "date";
  // Only the publisher's own type counts. `type` is the store's: "string" on every live field.
  if (native && NUMERIC_TYPE.test(native)) {
    if (unit === "quantity") return "quantity";
    if (unit === "indicator") return "code";
    // A number with no stated unit may be a date (20260630), a code (18140.0) or an amount.
    return "unknown";
  }
  if (unit === "indicator") return "code";
  if (native && TEXT_TYPE.test(native)) return unit === "quantity" ? "unknown" : "text";
  return unit === "text" ? "text" : "unknown";
}

/**
 * The role of one field. A hint wins over the dictionary, with one exception: a field the
 * dictionary calls an identifier or a date is never made a quantity.
 */
export function fieldRole(column: SourceColumn, hint?: FieldHint): FieldRole {
  const stated = dictionaryRole(column);
  if (!hint?.role) return stated;
  if (hint.role === "quantity" && (stated === "identifier" || stated === "date")) return stated;
  return hint.role;
}

const DIMENSION_ROLE: Record<SourceDimension, FieldRole> = {
  entity_id: "identifier",
  entity_name: "text",
  period: "date",
  geo_level: "code",
  geo_code: "code",
  geo_name: "text",
  source_url: "text",
};

/**
 * Roles for a whole dictionary. The fields a snapshot declares as its search dimensions get
 * the role that declaration implies (the period field is a date, the entity id an identifier),
 * hints by field key come next, the dictionary last.
 */
export function fieldRoles(
  columns: readonly SourceColumn[],
  ingest?: Pick<SourceIngest, "dimensions" | "composites"> | null,
  hints?: Readonly<Record<string, FieldHint>>,
): FieldRole[] {
  const declared = new Map<number, FieldRole>();
  for (const [dimension, position] of Object.entries(ingest?.dimensions ?? {}))
    if (typeof position === "number")
      declared.set(position, DIMENSION_ROLE[dimension as SourceDimension] ?? "unknown");
  for (const position of ingest?.composites?.period?.indices ?? []) declared.set(position, "date");
  return columns.map((column, position) => {
    const role = declared.get(position);
    if (role) return role;
    return fieldRole(column, hints?.[column.key]);
  });
}

export type FormattedCell = { text: string; align: "left" | "right"; title?: string };

/**
 * A cell for a table. Only a quantity is grouped, and only where grouping keeps every stored
 * digit; its unit is not appended, the column head carries it. Identifiers, dates, codes and
 * text are exactly as stored. Null is an en dash, the empty string stays empty with a title.
 */
export function formatCell(
  cell: string | null | undefined,
  role: FieldRole,
  column?: SourceColumn,
): FormattedCell {
  const align = role === "quantity" ? "right" : "left";
  if (cell == null) return { text: "–", align, title: "missing in the source" };
  if (cell === "") return { text: "", align, title: "empty in the source" };
  if (role !== "quantity") return { text: cell, align };
  const grouped = readNative(cell).kind === "number" ? groupNative(cell) : null;
  if (grouped === null) return { text: cell, align };
  const unit = column ? statedUnit(column) : null;
  if (unit) return { text: grouped, align, title: `${cell} ${unit}` };
  return grouped === cell ? { text: grouped, align } : { text: grouped, align, title: cell };
}

/** The native header. Manifest keys may be positional (col0001); the label keeps the header. */
export const fieldCode = (column: SourceColumn): string => column.label || column.key;

/** The words a reader sees for a field: the dictionary title where one exists, else the header. */
export const fieldTitle = (column: SourceColumn): string => column.title?.trim() || fieldCode(column);

/**
 * The two lines of a column head: the title, then the unit as stated. Without a unit the
 * second line is the field code, and only when it differs from the title.
 */
export function fieldHead(column: SourceColumn): { title: string; sub: string | null } {
  const title = fieldTitle(column);
  const code = fieldCode(column);
  return { title, sub: statedUnit(column) ?? (code !== title ? code : null) };
}

/**
 * A narrow first table without any publisher's field names: the declared dimension fields
 * (entity name, entity id, place name, place code, period), then fields a hint or the
 * dictionary calls a quantity, then the rest in file order. `lead` puts a profile's chosen
 * field keys first. Every field stays available in the field picker and the record sheet.
 */
export function defaultFields(
  columns: readonly SourceColumn[],
  ingest?: Pick<SourceIngest, "dimensions" | "composites"> | null,
  options?: { limit?: number; lead?: readonly string[]; hints?: Readonly<Record<string, FieldHint>> },
): number[] {
  const limit = Math.max(0, options?.limit ?? 8);
  const selected: number[] = [];
  const add = (position: number | undefined) => {
    if (selected.length >= limit) return;
    if (position === undefined || position < 0 || position >= columns.length) return;
    if (!selected.includes(position)) selected.push(position);
  };
  for (const key of options?.lead ?? []) add(columns.findIndex((column) => column.key === key));
  const dimensions = ingest?.dimensions ?? {};
  for (const name of ["entity_name", "entity_id", "geo_name", "geo_code", "period"] as const)
    add(dimensions[name]);
  for (const position of ingest?.composites?.period?.indices ?? []) add(position);
  const roles = fieldRoles(columns, ingest, options?.hints);
  roles.forEach((role, position) => {
    if (role === "quantity") add(position);
  });
  for (let position = 0; position < columns.length && selected.length < limit; position++)
    add(position);
  return selected;
}
