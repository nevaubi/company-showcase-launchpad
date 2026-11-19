import { describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ uploads: [] as string[], state: [] as unknown[], cursor: 0 }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    storage: { from: () => ({ upload: async (p: string) => { store.uploads.push(p); return { error: null }; } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { cursor: store.cursor }, error: null }) }) }), upsert: async (v: unknown) => { store.state.push(v); return { error: null }; } }),
  },
}));
import { mirrorPaths, runPartnerMirror } from "./partner-mirror.server";

describe("scheduled partner mirror", () => {
  process.env.PARTNER_DATA_KEY = "k";
  it("covers universe plus company and price files for every ticker", () => {
    expect(mirrorPaths(["A", "BRK.B"])).toEqual(["universe.json", "companies/A.json", "prices/A.json", "companies/BRK.B.json", "prices/BRK.B.json"]);
  });
  it("copies one file per call and advances the cursor", async () => {
    store.uploads = []; store.state = []; store.cursor = 0;
    const r = await runPartnerMirror(1000, (async () => new Response("{}")) as typeof fetch);
    expect(store.uploads).toEqual(["universe.json"]);
    expect(r.items).toBe(1);
    expect(store.state[0]).toMatchObject({ job: "partner-mirror", cursor: 1, paused_reason: null });
  });
  it("keeps the cursor and records why when the partner is unreachable, never overwriting the copy", async () => {
    store.uploads = []; store.state = []; store.cursor = 5;
    const r = await runPartnerMirror(1000, (async () => { throw new Error("fetch failed"); }) as typeof fetch);
    expect(r.ok).toBe(false);
    expect(store.uploads).toEqual([]);
    expect(store.state[0]).toMatchObject({ cursor: 5, paused_reason: expect.stringContaining("partner unreachable") });
  });
  it("does not store a broken file", async () => {
    store.uploads = []; store.cursor = 0;
    await runPartnerMirror(1000, (async () => new Response("<html>")) as typeof fetch);
    expect(store.uploads).toEqual([]);
  });
});
