import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { COVERAGE } from "@/lib/coverage";

const mocks = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase>,
  fetchSec: vi.fn(),
  syncCompany: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mocks.db.client;
  },
}));
vi.mock("@/lib/sec.server", () => ({ fetchSec: mocks.fetchSec }));
vi.mock("@/lib/jobs/jobs.server", () => ({ syncCompany: mocks.syncCompany }));
import { runDiscovery } from "./sec-discover.server";

const day = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
const code = Number(day.replace(/-/g, ""));
const companies = COVERAGE.slice(0, 6);
const index = companies.map((c, i) => `${Number(c.cik)}|${c.shortName}|10-Q|${day.replace(/-/g, "")}|edgar/data/${Number(c.cik)}/0000000000-26-00000${i}.txt`).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSec.mockResolvedValue({ text: async () => index });
  mocks.syncCompany.mockResolvedValue({ filings: 1, trades: 0, errors: [], failed: false });
});

describe("sec-discover day pass", () => {
  it("resolves every missing company the budget allows (not two) and completes the day", async () => {
    mocks.db = fakeSupabase({ job_state: [{ job: "sec-discover", cursor: 2, paused_reason: null, updated_at: "x" }, { job: "sec-discover-day", cursor: code, paused_reason: null, updated_at: "x" }] });
    const r = await runDiscovery(() => true);
    expect(mocks.syncCompany).toHaveBeenCalledTimes(6);
    expect((r.detail as Record<string, unknown>).complete).toBe(true);
    expect(mocks.db.state("sec-discover-day")!.paused_reason).toBeNull();
    expect(mocks.db.state("sec-discover-day")!.cursor).toBeGreaterThan(code);
  });
  it("a run cut short by the budget stays on the day without counting a try", async () => {
    mocks.db = fakeSupabase({ job_state: [{ job: "sec-discover", cursor: 2, paused_reason: null, updated_at: "x" }, { job: "sec-discover-day", cursor: code, paused_reason: `tries 0 on ${day} (9 left, run 3)`, updated_at: "x" }] });
    let n = 0;
    const r = await runDiscovery(() => n++ < 2);
    expect(mocks.syncCompany).toHaveBeenCalledTimes(2);
    expect((r.detail as Record<string, unknown>).tries).toBe(0);
    expect(mocks.db.state("sec-discover-day")!.paused_reason).toBe(`tries 0 on ${day} (6 left, run 4)`);
  });
  it("an idle day run repairs missing earnings events from stored 2.02 8-Ks", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const filed = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
    mocks.db = fakeSupabase({
      job_state: [{ job: "sec-discover", cursor: 2, paused_reason: null, updated_at: "x" }, { job: "sec-discover-day", cursor: Number(today.replace(/-/g, "")), paused_reason: null, updated_at: "x" }],
      sec_filings: [
        { accn: "0000858877-26-000170", ticker: "CSCO", form: "8-K", filed, items: "2.02,9.01" },
        { accn: "a-2", ticker: "KO", form: "8-K", filed, items: "2.02" },
      ],
      earnings_events: [{ ticker: "KO", accn: "a-2", filed, source: "sec-8k-2.02" }],
    });
    const r = await runDiscovery(() => true);
    expect((r.detail.repair as { repaired: string[] }).repaired).toEqual(["CSCO 0000858877-26-000170"]);
    expect(mocks.db.tables.earnings_events).toHaveLength(2);
    expect(mocks.db.state("earnings-repair")!.cursor).toBe(1);
  });
});
