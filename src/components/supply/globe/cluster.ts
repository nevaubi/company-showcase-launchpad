// Marker geometry for the supply-chain globe: how big a company's badge is, which badges are folded into one
// cluster at the current zoom, how a cluster that cannot be pulled apart by zooming opens into a fan, and where the
// names hidden behind the globe are pinned on its rim. Pure (no canvas), unit-tested.

export type GlobeShape = 'circle' | 'square' | 'diamond' | 'triangle';

/** One relation's share of a cluster's ring, with the shape drawn on it so relations differ without colour. */
export interface ClusterSlice { color: string; shape: GlobeShape; count: number; a0: number; a1: number }
/**
 * Ring segments of a cluster, largest first from 12 o'clock. Every segment gets at least `minAngle` so it stays visible;
 * the others give up room in proportion. The counts stay exact (the hover list repeats them).
 */
export function clusterSlices(members: { color: string; shape?: GlobeShape }[], minAngle = 0.75): ClusterSlice[] {
  const tally = new Map<string, { color: string; shape: GlobeShape; count: number }>();
  for (const m of members) {
    const shape = m.shape ?? 'circle', k = `${m.color}|${shape}`;
    const t = tally.get(k) ?? { color: m.color, shape, count: 0 };
    t.count++;
    tally.set(k, t);
  }
  const groups = [...tally.values()].sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape));
  const n = members.length, full = Math.PI * 2;
  const raw = groups.map((g) => (g.count / n) * full);
  const floor = Math.min(minAngle, full / Math.max(1, groups.length));
  const small = raw.map((a) => a < floor);
  const need = small.reduce((s, x, i) => s + (x ? floor - raw[i] : 0), 0);
  const spare = raw.reduce((s, a, i) => s + (small[i] ? 0 : a), 0);
  let a0 = -Math.PI / 2;
  return groups.map((g, i) => {
    const span = small[i] ? floor : raw[i] - (spare > 0 ? (need * raw[i]) / spare : 0);
    const out = { ...g, a0, a1: a0 + span };
    a0 += span;
    return out;
  });
}

/** Half the side of a company's badge in px. `weight` is its exposure on a 0 to 1 scale; the company the map is about is largest. */
export const badgeRadius = (weight: number, lead = false): number => (lead ? 16 : 10 + Math.round(4 * Math.min(1, Math.max(0, weight))));
/** Radius of a cluster's marker by how many names it holds. */
export const clusterRadius = (n: number): number => Math.min(23, 13.5 + 2.2 * Math.sqrt(n));

export interface Spot<T> { x: number; y: number; r: number; weight: number; lead?: boolean; item: T }
export interface Cluster<T> { x: number; y: number; r: number; members: Spot<T>[] }

/**
 * Fold badges that would cover each other into clusters. The heaviest name seeds a cluster and stays its anchor, so a
 * cluster sits on a real place (the company's own office keeps its spot) instead of drifting to an average. Clusters
 * that still overlap after their rings have grown are folded together, largest keeps its place.
 */
export function clusterSpots<T>(spots: Spot<T>[], gap = 3): Cluster<T>[] {
  const order = spots.map((s, i) => [s, i] as const).sort((a, b) => Number(!!b[0].lead) - Number(!!a[0].lead) || b[0].weight - a[0].weight || a[1] - b[1]);
  const cell = 48, grid = new Map<number, Cluster<T>[]>(), out: Cluster<T>[] = [];
  const key = (gx: number, gy: number) => gx * 73856093 + gy * 19349663;
  for (const [s] of order) {
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    let home: Cluster<T> | null = null;
    for (let i = gx - 1; i <= gx + 1 && !home; i++) for (let j = gy - 1; j <= gy + 1 && !home; j++) {
      const list = grid.get(key(i, j));
      if (!list) continue;
      for (const c of list) if (Math.hypot(c.x - s.x, c.y - s.y) < c.r + s.r + gap) { home = c; break; }
    }
    if (home) { home.members.push(s); home.r = clusterRadius(home.members.length); continue; }
    const c: Cluster<T> = { x: s.x, y: s.y, r: s.r, members: [s] };
    out.push(c);
    const k = key(gx, gy), list = grid.get(k);
    if (list) list.push(c); else grid.set(k, [c]);
  }
  for (let merged = true; merged;) {
    merged = false;
    scan: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + gap) continue;
      const aLead = a.members.some((m) => m.lead), bLead = b.members.some((m) => m.lead);
      const keepA = aLead !== bLead ? aLead : a.members.length >= b.members.length;
      const keep = keepA ? a : b, drop = keepA ? b : a;
      keep.members.push(...drop.members);
      keep.r = clusterRadius(keep.members.length);
      out.splice(out.indexOf(drop), 1);
      merged = true;
      break scan;
    }
  }
  for (const c of out) if (c.members.length > 1) c.members.sort((a, b) => Number(!!b.lead) - Number(!!a.lead) || b.weight - a.weight);
  return out;
}

/**
 * Offsets for an opened cluster of n badges of diameter d: one ring for a few, a sunflower spiral for more. No two
 * badges overlap and none sits on the centre, which keeps the dot marking the true place. Returns the radius needed.
 */
export function fanOffsets(n: number, d: number): { at: [number, number][]; reach: number } {
  const at: [number, number][] = [];
  if (n <= 0) return { at, reach: 0 };
  if (n <= 8) {
    const ring = Math.max(d * 0.95, (n * (d + 4)) / (2 * Math.PI));
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; at.push([ring * Math.cos(a), ring * Math.sin(a)]); }
    return { at, reach: ring + d / 2 };
  }
  const c = (d + 4) / 1.3;
  let reach = 0;
  for (let i = 0; i < n; i++) { const r = c * Math.sqrt(i + 1.4), a = i * 2.399963; at.push([r * Math.cos(a), r * Math.sin(a)]); reach = Math.max(reach, r); }
  return { at, reach: reach + d / 2 };
}

export interface RimGroup<T> { /** screen angle of the group on the rim, radians, clockwise from east */ angle: number; items: T[] }
/**
 * Names on the far side of the globe, grouped by the direction in which they lie beyond the rim. `vx, vy` are a
 * place's view coordinates (east and north of the centre, in globe radii). Largest group first.
 */
export function rimGroups<T>(hidden: { vx: number; vy: number; item: T }[], sector = Math.PI / 8): RimGroup<T>[] {
  const bins = new Map<number, { sx: number; sy: number; items: T[] }>();
  for (const h of hidden) {
    const len = Math.hypot(h.vx, h.vy);
    if (len < 1e-6) continue;
    const a = Math.atan2(-h.vy, h.vx), turn = Math.round(Math.PI / sector);
    let bin = Math.round(a / sector);
    if (bin === -turn) bin = turn;
    const b = bins.get(bin) ?? { sx: 0, sy: 0, items: [] };
    b.sx += Math.cos(a); b.sy += Math.sin(a); b.items.push(h.item);
    bins.set(bin, b);
  }
  return [...bins.values()].map((b) => ({ angle: Math.atan2(b.sy, b.sx), items: b.items })).sort((a, b) => b.items.length - a.items.length);
}
