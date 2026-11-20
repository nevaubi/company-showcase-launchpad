import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase>,
  queueEmail: vi.fn(async () => "sent"),
  adminEmails: vi.fn(async () => ["owner@example.com"]),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mocks.db.client;
  },
}));
vi.mock("@/lib/email/outbox.server", () => ({ queueEmail: mocks.queueEmail, adminEmails: mocks.adminEmails }));
import { runWatchdog } from "./watchdog.server";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("watchdog run", () => {
  it("emails one digest when the worker heartbeat stops, and not again while the episode lasts", async () => {
    mocks.db = fakeSupabase({}, { rpc: { data_freshness: () => [{ key: "worker_heartbeat", newest: ago(45) }], job_health: () => [] } });
    const first = await runWatchdog(1500);
    expect(first.emailed).toContain("worker-heartbeat");
    expect(mocks.queueEmail).toHaveBeenCalledTimes(1);
    expect(mocks.queueEmail.mock.calls[0]).toEqual([expect.objectContaining({ template: "ops-alert", to: "owner@example.com", relatedId: "alert-digest" })]);
    expect(mocks.db.state("alert:worker-heartbeat")!.paused_reason).toMatch(/^sent: Render worker silent/);
    mocks.queueEmail.mockClear();
    const second = await runWatchdog(1500);
    expect(second.emailed).toEqual([]);
    expect(mocks.queueEmail).not.toHaveBeenCalled();
  });
  it("closes the episode once the heartbeat is back", async () => {
    mocks.db = fakeSupabase(
      { job_state: [{ job: "alert:worker-heartbeat", cursor: 1, paused_reason: "sent: x", updated_at: ago(30) }] },
      { rpc: { data_freshness: () => [{ key: "worker_heartbeat", newest: ago(1) }], job_health: () => [] } },
    );
    const r = await runWatchdog(1500);
    expect(r.closed).toContain("alert:worker-heartbeat");
    expect(mocks.db.state("alert:worker-heartbeat")).toBeUndefined();
  });
});
