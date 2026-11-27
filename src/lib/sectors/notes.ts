// Weekly sector notes: the pipeline writes one note per sector each Monday and keeps earlier weeks (up to
// 26). A page shows the current week only: the newest week in the file. Earlier weeks are not shown. Pure.
import type { Note, Overview } from "./groups";

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

/** Current commentary is reproduced from the same verified overview read by the
 * dashboard. Each displayed denominator belongs to its own metric and quarter. */
export function releaseNotes(overview: Overview | undefined): Note[] {
  if (!overview) return [];
  const asOf = overview.sector_release?.as_of ?? overview.generated?.slice(0, 10);
  if (!asOf) return [];
  if (overview.filing_notes?.as_of === asOf) return overview.filing_notes.notes;
  return overview.groups.filter((g) => g.kind === "sector").flatMap((g) => {
    const q = g.q;
    if (!q) return [];
    const facts: Note["facts"] = {};
    const clauses: string[] = [];
    for (const [metric, label] of [["rev_growth", "Revenue growth"], ["ni_growth", "earnings growth"], ["nm", "trailing net margin"]]) {
      const point = g.latest[metric];
      if (!point || point[0] !== q || point[1] == null || point[2] <= 0) continue;
      const [period, value, count] = point;
      facts[metric] = { label: `${g.name} · ${label} · ${period} · ${count} of ${g.n} constituents`,
        value, unit: "pct", text: `${(value * 100).toFixed(2)}% (${count} of ${g.n})`, ref: { type: "agg", metric, q: period } };
      clauses.push(`${clauses.length ? label.toLowerCase() : label[0].toUpperCase() + label.slice(1)} was {{${metric}}}`);
    }
    if (!clauses.length) return [];
    return [{ slug: g.slug, sector: g.name, week: asOf, generated_at: asOf, model: "verified-sector-release",
      title: `${g.name} · Q${q.slice(-1)} ${q.slice(0, 4)} filings`,
      text: clauses.map((c) => c[0].toUpperCase() + c.slice(1) + ".").join(" "), facts }];
  });
}
