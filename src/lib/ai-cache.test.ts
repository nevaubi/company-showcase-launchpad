import { describe, expect, it, vi } from "vitest";
const row = vi.hoisted(() => ({ value: null as null | { payload: unknown; created_at: string } }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row.value }) }) }), upsert: async () => ({}) }) },
}));
import { cached } from "./ai.server";

describe("AI cache stale fallback", () => {
  it("serves the last stored value marked stale with its as-of time when recompute fails", async () => {
    row.value = { payload: { text: "last good" }, created_at: "2026-11-01T00:00:00Z" };
    const r = await cached<{ text: string }>("k", 1000, async () => { throw new Error("AI credits are exhausted (402)"); });
    expect(r).toMatchObject({ text: "last good", cachedAt: "2026-11-01T00:00:00Z", stale: true });
    expect(r.staleReason).toContain("402");
  });
  it("still throws when nothing was ever stored", async () => {
    row.value = null;
    await expect(cached("k", 1000, async () => { throw new Error("402"); })).rejects.toThrow("402");
  });
  it("fresh values are not marked stale", async () => {
    row.value = null;
    const r = await cached("k", 1000, async () => ({ text: "new" }));
    expect(r.stale).toBeUndefined();
  });
});
