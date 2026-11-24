/**
 * The overview's view state (level, column set, sort, window, tail), remembered for the tab's lifetime so the
 * "Sectors" breadcrumb on a sector or industry page returns to the board as it was left, not to its defaults.
 * Only the keys the overview's address accepts are kept; the legacy `sector` key is dropped.
 */
const KEYS = ["level", "cols", "sort", "dir", "span", "tail"] as const;
export type OverviewState = Partial<Record<(typeof KEYS)[number], string>>;

let last: OverviewState = {};

export function rememberOverview(search: Record<string, unknown>): void {
  const next: OverviewState = {};
  for (const k of KEYS) {
    const v = search[k];
    if (typeof v === "string" && v) next[k] = v;
  }
  last = next;
}

export function overviewState(): OverviewState {
  return { ...last };
}
