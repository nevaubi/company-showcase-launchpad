import { describe, expect, it, vi } from "vitest";

const pages = vi.hoisted(() => ({ calls: [] as [number, number][] }));
vi.mock("../../scripts/lib/supa", () => {
  const rows = Array.from({ length: 1777 }, (_, i) => ({ ticker: `T${i}`, dv20: 1e9 - i }));
  const q: Record<string, unknown> = {};
  for (const k of ["select", "not", "order"]) q[k] = () => q;
  q.range = async (a: number, b: number) => (pages.calls.push([a, b]), { data: rows.slice(a, Math.min(b + 1, a + 1000)), error: null });
  return { sb: { from: () => q } };
});

import { loadRank } from "../../scripts/lib/rank";

describe("worker rank (review F13)", () => {
  it("pages past the 1,000-row response cap, so the tail is ranked too", async () => {
    const rank = await loadRank();
    expect(rank.size).toBe(1777);
    expect(rank.get("T0")).toBeLessThan(rank.get("T1500")!);
    expect(pages.calls).toEqual([[0, 999], [1000, 1999]]);
  });
});
