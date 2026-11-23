/**
 * The label canon walks the whole coverage, 40 companies a day (pure). The walk order is fixed for a
 * lap: ranked by dv20 once when the lap starts and stored (`ops/ir-canon-lap.json`), so the daily
 * cursor indexes the same list all lap long. Re-sorting by each day's rank made the same index point
 * at a different company every day, skipping some companies and repeating others (review F7).
 */
export interface CanonLap {
  order: string[];
  startedAt: string;
}

/**
 * The lap to walk now and where to start in it. A missing or finished lap (cursor at or past its
 * end) starts a new one in today's order. Companies that left coverage are dropped (the cursor moves
 * back by the ones dropped before it); companies added since the lap started go at its end.
 */
export function canonLap(stored: CanonLap | null, cursor: number, current: readonly string[], nowMs: number): { lap: CanonLap; start: number; fresh: boolean } {
  const fresh = () => ({ lap: { order: [...current], startedAt: new Date(nowMs).toISOString() }, start: 0, fresh: true });
  if (!stored || !Array.isArray(stored.order) || !stored.order.length) return fresh();
  const at = Math.max(0, Math.floor(cursor || 0));
  if (at >= stored.order.length) return fresh();
  const live = new Set(current);
  const kept = stored.order.filter((t) => live.has(t));
  const dropped = stored.order.slice(0, at).filter((t) => !live.has(t)).length;
  const inLap = new Set(kept);
  const order = [...kept, ...current.filter((t) => !inLap.has(t))];
  const start = at - dropped;
  if (start >= order.length) return fresh();
  return { lap: { order, startedAt: stored.startedAt }, start, fresh: false };
}

/** ir_label_map keys to delete after the new map was upserted (insert first, then delete: a kill between them keeps a map, review F20). */
export function staleLabelKeys(existing: readonly string[], next: readonly string[]): string[] {
  const keep = new Set(next);
  return existing.filter((k) => !keep.has(k));
}
