// Weekly sector notes: the pipeline writes one note per sector each Monday and keeps earlier weeks (up to
// 26). A page shows one week at a time, the newest by default, and can step back. Pure.
import type { Note } from "./groups";

export interface NoteWeek {
  /** Monday of the week shown; null when there is no note. */
  week: string | null;
  /** Every week on file for this selection, newest first. */
  weeks: string[];
  /** The notes of `week`, one per sector, by sector name. */
  notes: Note[];
  /** Neighbouring weeks to step to. */
  earlier: string | null;
  later: string | null;
}

/**
 * The notes of one week. `only` keeps one group's notes (its weeks may differ from the file's newest);
 * `want` asks for a week and falls back to the newest when that week has no note.
 */
export function noteWeek(all: readonly Note[] | null | undefined, opts: { only?: string; want?: string | null } = {}): NoteWeek {
  const mine = (all ?? []).filter((n) => n.week && (!opts.only || n.slug === opts.only));
  const weeks = [...new Set(mine.map((n) => n.week))].sort().reverse();
  if (!weeks.length) return { week: null, weeks, notes: [], earlier: null, later: null };
  const i = Math.max(0, opts.want ? weeks.indexOf(opts.want) : 0);
  const week = weeks[i];
  // One note per sector and week: should a file carry two, the one generated last stands.
  const bySlug = new Map<string, Note>();
  for (const n of mine) {
    if (n.week !== week) continue;
    const had = bySlug.get(n.slug);
    if (!had || (n.generated_at ?? "") > (had.generated_at ?? "")) bySlug.set(n.slug, n);
  }
  return {
    week,
    weeks,
    notes: [...bySlug.values()].sort((a, b) => a.sector.localeCompare(b.sector)),
    earlier: weeks[i + 1] ?? null,
    later: i > 0 ? weeks[i - 1] : null,
  };
}
