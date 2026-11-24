// Macro drivers: the official series the macro store tags with the sectors whose revenue or costs they
// lead. A sector page lists all of its own; the overview shows a short selection in which every sector
// has at least one. Pure.

export interface Driver {
  id: string;
  title: string;
  sectors?: string[];
}

/** Every series tagged with the sector, most widely shared first, then by title. */
export function driversOf<T extends Driver>(tiles: readonly T[], sector: string): T[] {
  return tiles.filter((d) => d.sectors?.includes(sector)).sort(byReach);
}

const byReach = (a: Driver, b: Driver) => (b.sectors?.length ?? 0) - (a.sectors?.length ?? 0) || a.title.localeCompare(b.title);

/**
 * About `max` tagged series in which every sector in `sectors` has at least one where the tags allow it
 * (covering every sector comes first, so the result can exceed `max` only when that needs more). For each
 * sector not yet covered, in the order given, the series naming the most sectors is taken; the remaining
 * places go to the most widely shared series. Returned most widely shared first.
 */
export function pickDrivers<T extends Driver>(tiles: readonly T[], sectors: readonly string[], max = 12): T[] {
  const tagged = tiles.filter((d) => d.sectors?.length).sort(byReach);
  const chosen: T[] = [];
  const covered = new Set<string>();
  const take = (d: T) => {
    chosen.push(d);
    for (const s of d.sectors ?? []) covered.add(s);
  };
  for (const s of sectors) {
    if (covered.has(s)) continue;
    const d = tagged.find((x) => !chosen.includes(x) && x.sectors!.includes(s));
    if (d) take(d);
  }
  for (const d of tagged) {
    if (chosen.length >= Math.max(max, 0)) break;
    if (!chosen.includes(d)) take(d);
  }
  return chosen.sort(byReach);
}
