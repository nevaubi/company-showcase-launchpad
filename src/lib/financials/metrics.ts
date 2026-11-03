import type { Cell, Statement } from "./types";

export function rowCells(st: Statement | undefined, key: string): (Cell | null)[] {
  return st?.rows.find((r) => r.key === key)?.cells ?? [];
}

/** Value of the most recent period for a row, with its period index. */
export function latest(st: Statement | undefined, key: string): { cell: Cell; index: number } | null {
  const cells = rowCells(st, key);
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (c) return { cell: c, index: i };
  }
  return null;
}

/**
 * Trailing-twelve-month sum of the last four consecutive fiscal quarters.
 * Returns null unless all four quarters are present and contiguous.
 */
export function ttm(quarterly: Statement | undefined, key: string): number | null {
  if (!quarterly) return null;
  const cells = rowCells(quarterly, key);
  const ps = quarterly.periods;
  for (let end = cells.length - 1; end >= 3; end--) {
    if (!cells[end]) continue;
    const window = [end - 3, end - 2, end - 1, end];
    const ok = window.every((i, n) => {
      if (!cells[i]) return false;
      if (n === 0) return true;
      const prev = ps[window[n - 1]];
      const cur = ps[i];
      const expected = prev.fq === 4 ? { fy: prev.fy + 1, fq: 1 } : { fy: prev.fy, fq: (prev.fq ?? 0) + 1 };
      return cur.fy === expected.fy && cur.fq === expected.fq;
    });
    if (!ok) return null;
    return window.reduce((s, i) => s + cells[i]!.v, 0);
  }
  return null;
}

/** Year-over-year change of the latest quarter vs. the same fiscal quarter a year earlier. */
export function latestYoY(quarterly: Statement | undefined, key: string): number | null {
  if (!quarterly) return null;
  const l = latest(quarterly, key);
  if (!l) return null;
  const p = quarterly.periods[l.index];
  const j = quarterly.periods.findIndex((q) => q.fy === p.fy - 1 && q.fq === p.fq);
  const prev = j >= 0 ? rowCells(quarterly, key)[j] : null;
  if (!prev || prev.v <= 0) return null;
  return l.cell.v / prev.v - 1;
}

export function cagr(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}
