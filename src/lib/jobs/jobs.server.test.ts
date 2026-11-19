import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), fetchYahoo: vi.fn(), pool: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/market-data.server", () => ({
  fetchYahoo: mocks.fetchYahoo, pool: mocks.pool, toBars: () => [],
  fetchCboeDaily: vi.fn(), fetchFred: vi.fn(), fetchNasdaqDaily: vi.fn(), fetchTreasury: vi.fn(),
  isCboeIndex: () => false, isTreasurySeries: () => false,
}));
import { runJob } from "./jobs.server";

describe("scheduled job ledger retention", () => {
  beforeEach(() => vi.clearAllMocks());
  it("never deletes job_runs when the prices cursor wraps", async () => {
    const deletes: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ["insert", "select", "eq", "update", "upsert", "lt"]) q[method] = vi.fn(() => q);
      q.delete = vi.fn(() => { deletes.push(table); return q; });
      q.single = async () => ({ data: { id: 1 } });
      q.maybeSingle = async () => ({ data: { cursor: 1860 } });
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return q;
    });
    mocks.pool.mockImplementation(async (batch: unknown[]) => batch.map(() => ({ status: "fulfilled", value: 0 })));
    expect((await runJob("prices")).ok).toBe(true);
    expect(deletes).toEqual(["market_bars"]);
    expect(deletes).not.toContain("job_runs");
  });
});