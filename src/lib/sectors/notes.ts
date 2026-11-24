// Weekly sector notes: the pipeline writes one note per sector each Monday and keeps earlier weeks (up to
// 26). A page shows the current week only: the newest week in the file. Earlier weeks are not shown. Pure.
import type { Note } from "./groups";

export interface NoteWeek {
  /** Monday of the current week (the newest in the file); null when the file has no dated note. */
  week: string | null;
  /** The current week's notes for this selection, one per sector, by sector name. */
  notes: Note[];
}

/**
 * The current week's notes. The week is the newest one in the whole file, so a sector whose note is
 * missing that week shows nothing rather than an older note under a current-week heading. `only` keeps
 * one sector's note (a sector page, or an industry page showing its sector's note).
 */
export function noteWeek(all: readonly Note[] | null | undefined, opts: { only?: string } = {}): NoteWeek {
  const dated = (all ?? []).filter((n) => n.week);
  const week = dated.reduce<string | null>((m, n) => (m == null || n.week > m ? n.week : m), null);
  if (!week) return { week: null, notes: [] };
  // One note per sector: should a file carry two for the week, the one generated last stands.
  const bySlug = new Map<string, Note>();
  for (const n of dated) {
    if (n.week !== week || (opts.only && n.slug !== opts.only)) continue;
    const had = bySlug.get(n.slug);
    if (!had || (n.generated_at ?? "") > (had.generated_at ?? "")) bySlug.set(n.slug, n);
  }
  return { week, notes: [...bySlug.values()].sort((a, b) => a.sector.localeCompare(b.sector)) };
}
