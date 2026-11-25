/**
 * Field lists of the table page, pure: search over a dictionary of up to 2,379 fields, grouping for the column
 * picker, and the head of a records column. Nothing here reads a cell.
 */
import { fieldCode, fieldTitle, statedUnit } from "@/lib/sources/fields";
import type { SourceColumn, SourceDimension, SourceIngest } from "@/lib/sources/schema";

export type FieldItem = { position: number; column: SourceColumn };
export type FieldGroup = { id: string; label: string; items: FieldItem[] };

const DIMENSION_WORDS: Record<SourceDimension, string> = {
  entity_id: "entity identifier",
  entity_name: "entity name",
  period: "period",
  geo_level: "place level",
  geo_code: "place code",
  geo_name: "place name",
  source_url: "source address",
};

/** What a field stands for in the snapshot's index ("period", "entity identifier"), if anything. */
export function dimensionOf(ingest: Pick<SourceIngest, "dimensions" | "composites"> | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  for (const [name, position] of Object.entries(ingest?.dimensions ?? {}))
    if (typeof position === "number") out.set(position, DIMENSION_WORDS[name as SourceDimension] ?? name);
  for (const position of ingest?.composites?.period?.indices ?? []) out.set(position, "part of the period");
  return out;
}

/** Every word must occur in the field's code, title, label, unit or description (case-insensitive). */
export function matchField(column: SourceColumn, words: readonly string[]): boolean {
  if (!words.length) return true;
  const hay = `${column.key} ${column.label} ${column.title ?? ""} ${column.unit ?? ""} ${column.description ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const searchWords = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);

/**
 * Groups for the column picker: the fields in the table first (in their order), then the declared dimensions,
 * then one group per stated unit (largest first), then the fields that state no unit, each in file order.
 */
export function fieldGroups(
  columns: readonly SourceColumn[],
  ingest: Pick<SourceIngest, "dimensions" | "composites"> | null | undefined,
  selected: readonly number[],
  search: string,
): FieldGroup[] {
  const words = searchWords(search);
  const dims = dimensionOf(ingest);
  const chosen = new Set(selected);
  const shown: FieldItem[] = selected
    .filter((p) => p >= 0 && p < columns.length && matchField(columns[p], words))
    .map((p) => ({ position: p, column: columns[p] }));
  const dimensions: FieldItem[] = [];
  const byUnit = new Map<string, FieldItem[]>();
  const none: FieldItem[] = [];
  columns.forEach((column, position) => {
    if (chosen.has(position) || !matchField(column, words)) return;
    const item = { position, column };
    if (dims.has(position)) return void dimensions.push(item);
    const unit = statedUnit(column);
    if (unit) {
      const list = byUnit.get(unit) ?? [];
      list.push(item);
      byUnit.set(unit, list);
    } else none.push(item);
  });
  const groups: FieldGroup[] = [];
  if (shown.length) groups.push({ id: "shown", label: "In the table", items: shown });
  if (dimensions.length) groups.push({ id: "dimensions", label: "Index fields", items: dimensions });
  [...byUnit.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .forEach(([unit, items]) => groups.push({ id: `unit:${unit}`, label: unit, items }));
  if (none.length) groups.push({ id: "none", label: byUnit.size ? "No stated unit" : "Fields", items: none });
  return groups;
}

/** Flat rows for a windowed list: a group head takes one row, then its items. */
export type PickerRow = { kind: "head"; group: FieldGroup } | { kind: "item"; item: FieldItem; group: string };
export function pickerRows(groups: readonly FieldGroup[]): PickerRow[] {
  const rows: PickerRow[] = [];
  for (const group of groups) {
    rows.push({ kind: "head", group });
    for (const item of group.items) rows.push({ kind: "item", item, group: group.id });
  }
  return rows;
}

/** The two lines of a column head: the title, then the unit as stated, else the code where it differs. */
export function columnHead(column: SourceColumn): { title: string; sub: string | null; code: string } {
  const title = fieldTitle(column);
  const code = fieldCode(column);
  return { title, sub: statedUnit(column) ?? (code !== title ? code : null), code };
}

/** A starting width for a column, from its head and its role; the table is laid out fixed from these. */
export function columnWidth(column: SourceColumn, quantity: boolean): number {
  const head = columnHead(column);
  const chars = Math.max(head.title.length, (head.sub ?? "").length * 0.85);
  const fromHead = Math.round(chars * 7.2 + 28);
  const min = quantity ? 112 : 96;
  return Math.max(min, Math.min(quantity ? 200 : 280, fromHead));
}

/** Toggles a position in a selection of at most `max`, keeping the order of the earlier choices. */
export function toggle(selected: readonly number[], position: number, max: number): number[] {
  if (selected.includes(position)) return selected.filter((p) => p !== position);
  return selected.length >= max ? [...selected] : [...selected, position];
}
