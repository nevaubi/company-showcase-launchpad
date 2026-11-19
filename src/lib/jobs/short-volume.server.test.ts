import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
import { refreshShortVolume } from "./short-volume.server";

describe("daily FINRA refresh", () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup(status = 200, upsertError: string | null = null, body = "20261116|AAPL|10|1|20\n20261116|NOTCOVERED|3|0|5") {
    const writes: { table: string; value: unknown }[] = [];
    mocks.from.mockImplementation((table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gt", "lte", "order", "limit"]) q[m] = vi.fn(() => q);
      q.maybeSingle = async () => ({ data: { cursor: 20261113 }, error: null });
      q.upsert = vi.fn((value: unknown) => { writes.push({ table, value }); return q; });
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "market_bars" ? [{ date: "2026-11-16" }] : [], error: table === "short_volume" && upsertError ? { message: upsertError } : null }).then(resolve);
      return q;
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status, ok: status === 200, text: async () => body })));
    return writes;
  }
  it("stores only covered tickers then advances from Friday to the next session Monday", async () => {
    const writes = setup();
    expect(await refreshShortVolume()).toMatchObject({ items: 1, detail: { date: "2026-11-16", prior: "2026-11-13" } });
    expect(writes[0]).toMatchObject({ table: "short_volume", value: [{ symbol: "AAPL", date: "2026-11-16", short_vol: 10, total_vol: 20 }] });
    expect(writes[1]).toMatchObject({ table: "job_state", value: { cursor: 20261116 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries the same session when its file is not published", async () => {
    const writes = setup(404);
    expect(await refreshShortVolume()).toMatchObject({ items: 0, detail: { pending: "2026-11-16" } });
    expect(writes).toEqual([]);
  });
  it("does not advance after a failed database write", async () => {
    const writes = setup(200, "write failed");
    await expect(refreshShortVolume()).rejects.toThrow("write failed");
    expect(writes.some(w => w.table === "job_state")).toBe(false);
  });
  it("rejects the wrong session instead of advancing", async () => {
    const writes = setup(200, null, "20261117|AAPL|10|1|20");
    await expect(refreshShortVolume()).rejects.toThrow("mismatched file");
    expect(writes).toEqual([]);
  });
});