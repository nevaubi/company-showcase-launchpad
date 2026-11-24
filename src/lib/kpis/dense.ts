/**
 * Keeping the KPI matrix dense with what applies.
 *
 * KPIs are industry-specific: a bank reports net interest margin and CET1, an insurer a combined ratio, a payment
 * network payments volume. A whole sector shown under one set of columns is mostly empty cells (Financials with
 * eight KPIs: 1,504 of 1,988 cells). Two rules keep it readable:
 *
 * 1. Industry groups: within a sector the matrix shows one industry group at a time (the largest by default), so
 *    its columns are the KPIs that group reports. The whole sector stays one press away.
 * 2. Empty lines left out: a chosen column with no value in any row shown is hidden, and so is a company with no
 *    value in any chosen column. The caption counts both, and one press shows them.
 *
 * Pure: the page passes the rows it built; nothing here reads the network or the DOM.
 */

export interface ScopedRow {
  sec: string;
  ind: string;
}

export interface GroupOption {
  /** Industry name as the data carries it. */
  ind: string;
  /** Companies in the sector whose rows carry this industry. */
  n: number;
}

/** Groups smaller than this are folded into the whole-sector view rather than offered on their own. */
export const MIN_GROUP = 3;

/** Value of the group choice meaning "the whole sector, every group". */
export const WHOLE_SECTOR = "*";

/**
 * Industry groups of a sector, largest first (ties by name), counting each company once. Groups under `min`
 * companies are not offered; `small` counts the companies they hold.
 */
export function sectorGroups(
  kpis: Record<string, Record<string, ScopedRow>>,
  sec: string,
  min = MIN_GROUP,
): { groups: GroupOption[]; small: number } {
  const indOf = new Map<string, string>();
  for (const per of Object.values(kpis))
    for (const [t, r] of Object.entries(per)) if (r.sec === sec && !indOf.has(t)) indOf.set(t, r.ind);
  const count = new Map<string, number>();
  for (const ind of indOf.values()) count.set(ind, (count.get(ind) ?? 0) + 1);
  const all = [...count].map(([ind, n]) => ({ ind, n })).sort((a, b) => b.n - a.n || a.ind.localeCompare(b.ind));
  const groups = all.filter((g) => g.n >= min);
  return { groups, small: all.filter((g) => g.n < min).reduce((s, g) => s + g.n, 0) };
}

/**
 * The group the matrix shows: a stored choice that is still offered, the whole sector when asked for or when the
 * sector has a single group, otherwise the largest group. `null` means the whole sector.
 */
export function resolveGroup(groups: GroupOption[], chosen: string | null | undefined): string | null {
  if (chosen === WHOLE_SECTOR || groups.length < 2) return null;
  if (chosen && groups.some((g) => g.ind === chosen)) return chosen;
  return groups[0]?.ind ?? null;
}

export interface DenseResult<R> {
  /** Column ids to draw, in the order given. */
  cols: string[];
  rows: R[];
  /** Chosen columns left out because no row shown has a value in them. */
  hiddenCols: string[];
  /** Companies left out because they have no value in any chosen column. */
  hiddenRows: number;
}

/**
 * Leave out what has nothing in it. A row is kept when it has a value in at least one chosen column; a column is
 * kept when at least one kept row has a value in it. With `showAll` nothing is left out (the counts still say what
 * would be).
 */
export function densify<R extends { cells: Record<string, unknown> }>(
  rows: R[],
  colIds: string[],
  showAll = false,
): DenseResult<R> {
  const has = (r: R, c: string) => r.cells[c] != null;
  const kept = rows.filter((r) => colIds.some((c) => has(r, c)));
  const hiddenCols = colIds.filter((c) => !kept.some((r) => has(r, c)));
  const hiddenRows = rows.length - kept.length;
  if (showAll) return { cols: colIds, rows, hiddenCols, hiddenRows };
  return { cols: colIds.filter((c) => !hiddenCols.includes(c)), rows: kept, hiddenCols, hiddenRows };
}

/** Empty and total cells of a drawn matrix (the measure the review used). */
export function emptyCells<R extends { cells: Record<string, unknown> }>(rows: R[], colIds: string[]) {
  let empty = 0;
  for (const r of rows) for (const c of colIds) if (r.cells[c] == null) empty++;
  return { empty, total: rows.length * colIds.length };
}

/** Caption for what was left out, or null when nothing was. Names columns up to three, then counts. */
export function leftOutNote(
  d: Pick<DenseResult<unknown>, "hiddenCols" | "hiddenRows">,
  nameOf: (id: string) => string,
  where: string,
): string | null {
  const parts: string[] = [];
  if (d.hiddenRows)
    parts.push(`${d.hiddenRows} ${d.hiddenRows === 1 ? "company reports" : "companies report"} none of these KPIs`);
  if (d.hiddenCols.length) {
    const names = d.hiddenCols.map(nameOf);
    const list = names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
    parts.push(`${list} ${names.length === 1 ? "has" : "have"} no value for ${where}`);
  }
  return parts.length ? `Left out: ${parts.join("; ")}.` : null;
}

/**
 * KPI ids ranked by how many companies the filter keeps report them (most first, ties by id), without the ones
 * nobody reports. The page's default columns are the first eight of this list.
 */
export function rankByReporters<T extends ScopedRow>(
  kpis: Record<string, Record<string, T>>,
  keep: (r: T) => boolean,
): { id: string; n: number }[] {
  return Object.entries(kpis)
    .map(([id, per]) => ({ id, n: Object.values(per).filter(keep).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
}

/** A default column must be reported by at least this share of the companies the most reported KPI has. */
export const DEFAULT_SHARE = 0.5;
/** Most default columns drawn. */
export const DEFAULT_COLS = 8;

/**
 * The matrix's default columns for a scope (p5-shots M13). `ranked` is in catalogue order with each KPI's count
 * of companies in scope that have a value; the result is ranked by that count (ties keep catalogue order) and
 * keeps only KPIs reported by at least `share` of the companies the leader has, so a group's default view is its
 * own measures and mostly filled. Banks with ROTCE at 64 companies keep CET1 61, NIM 55 and efficiency 55 and
 * drop dividends paid at 18. Nothing reported: no columns.
 */
export function defaultColumns<T extends { n: number }>(ranked: T[], max = DEFAULT_COLS, share = DEFAULT_SHARE): T[] {
  const sorted = ranked.filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const top = sorted[0]?.n ?? 0;
  return sorted.filter((x) => x.n >= top * share).slice(0, max);
}
