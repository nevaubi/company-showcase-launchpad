/**
 * The rows of a table list, in reading order: a view of another table (a projection or a derived table) sits
 * under its parent when the parent is in the list, and is marked either way. Pure.
 */
import type { SourceLibraryRow } from "@/lib/sources/read-types";

/** Row heights in px, rule included: two lines on wide screens, three in the narrow layout. */
export const TABLE_ROW_H = 41;
export const TABLE_ROW_H_NARROW = 61;
/** Below this width of the list itself the narrow layout is used (no sideways scrolling, ever). */
export const TABLE_NARROW_BELOW = 880;

export type TableItem = {
  row: SourceLibraryRow;
  /** 1 when the row is listed under its parent. */
  depth: 0 | 1;
  /** The table this one is a view of, when the catalogue names one. */
  parent: { id: string; title: string } | null;
  /** The parent was collected after this view, so the view may lag it. */
  olderThanParent: boolean;
};

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * `rows` in their sorted order, with each view moved directly under its parent when both are listed.
 * `all` resolves parents that the filters left out, for the marker.
 */
export function orderWithViews(rows: readonly SourceLibraryRow[], all: ReadonlyMap<string, SourceLibraryRow>): TableItem[] {
  const listed = new Set(rows.map((r) => r.id));
  const children = new Map<string, SourceLibraryRow[]>();
  for (const r of rows)
    if (r.parentId && r.parentId !== r.id && listed.has(r.parentId)) {
      const list = children.get(r.parentId) ?? [];
      list.push(r);
      children.set(r.parentId, list);
    }
  const item = (row: SourceLibraryRow, depth: 0 | 1): TableItem => {
    const parent = row.parentId ? all.get(row.parentId) ?? null : null;
    const older = !!parent && time(parent.retrievedAt) > time(row.retrievedAt);
    return {
      row,
      depth,
      parent: row.parentId ? { id: row.parentId, title: parent?.title ?? row.parentId } : null,
      olderThanParent: older,
    };
  };
  const out: TableItem[] = [];
  const placed = new Set<string>();
  const place = (row: SourceLibraryRow, depth: 0 | 1) => {
    if (placed.has(row.id)) return;
    placed.add(row.id);
    out.push(item(row, depth));
    // one level only: a view of a view is listed under its own parent, not nested deeper
    for (const child of children.get(row.id) ?? []) if (!placed.has(child.id)) {
      placed.add(child.id);
      out.push(item(child, 1));
    }
  };
  for (const r of rows) {
    const underParent = r.parentId && r.parentId !== r.id && listed.has(r.parentId);
    if (!underParent) place(r, 0);
  }
  // views whose parent is listed but was itself placed as a child: keep them, at depth 1
  for (const r of rows) if (!placed.has(r.id)) place(r, 1);
  return out;
}

/** What a table is indexed by, from the dimensions its snapshot fills: "Entity and period", "Place", "Period". */
export function indexedBy(dimensions: readonly string[]): string {
  const d = new Set(dimensions);
  const parts: string[] = [];
  if (d.has("entity_id") || d.has("entity_name")) parts.push("entity");
  if (d.has("geo_code") || d.has("geo_name")) parts.push("place");
  if (d.has("period")) parts.push("period");
  if (!parts.length) return "";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "24 Nov 2026" in UTC, or an en dash. A snapshot's date is when the file was retrieved. */
export function utcDay(iso: string | null | undefined): string {
  if (!iso) return "–";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "–";
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** "25 Nov 2026, 12:27 UTC", or an en dash. */
export function utcMinute(iso: string | null | undefined): string {
  if (!iso) return "–";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "–";
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${utcDay(iso)}, ${hh}:${mm} UTC`;
}

/** "24 to 25 Nov 2026", "30 Oct to 2 Nov 2026", "25 Nov 2026" for a range of UTC days. */
export function utcDayRange(first: string | null, last: string | null): string {
  if (!first || !last) return utcDay(first ?? last);
  const a = new Date(first);
  const b = new Date(last);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "–";
  const [x, y] = a <= b ? [a, b] : [b, a];
  const same = (p: Date, q: Date) => p.getUTCFullYear() === q.getUTCFullYear() && p.getUTCMonth() === q.getUTCMonth() && p.getUTCDate() === q.getUTCDate();
  if (same(x, y)) return utcDay(x.toISOString());
  if (x.getUTCFullYear() !== y.getUTCFullYear()) return `${utcDay(x.toISOString())} to ${utcDay(y.toISOString())}`;
  if (x.getUTCMonth() !== y.getUTCMonth())
    return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} to ${utcDay(y.toISOString())}`;
  return `${x.getUTCDate()} to ${utcDay(y.toISOString())}`;
}
