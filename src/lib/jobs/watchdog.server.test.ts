import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase>,
  queueEmailRecorded: vi.fn(async (): Promise<{ status: string; recorded: boolean; error?: string }> => ({ status: "sent", recorded: true })),
  adminEmails: vi.fn(async () => ["owner@example.com"]),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mocks.db.client;
  },
}));
vi.mock("@/lib/email/outbox.server", () => ({ queueEmailRecorded: mocks.queueEmailRecorded, adminEmails: mocks.adminEmails }));
import { runWatchdog } from "./watchdog.server";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueEmailRecorded.mockImplementation(async () => ({ status: "sent", recorded: true }));
  mocks.adminEmails.mockImplementation(async () => ["owner@example.com"]);
});

describe("watchdog run", () => {
  it("emails one digest when the worker heartbeat stops, and not again while the episode lasts", async () => {
    mocks.db = fakeSupabase({}, { rpc: { data_freshness: () => [{ key: "worker_heartbeat", newest: ago(45) }], job_health: () => [] } });
    const first = await runWatchdog(1500);
    expect(first.emailed).toContain("worker-heartbeat");
    expect(mocks.queueEmailRecorded).toHaveBeenCalledTimes(1);
    expect(mocks.queueEmailRecorded.mock.calls[0]).toEqual([expect.objectContaining({ template: "ops-alert", to: "owner@example.com", relatedId: "alert-digest" })]);
    expect(mocks.db.state("alert:worker-heartbeat")!.paused_reason).toMatch(/^sent: Render worker silent/);
    mocks.queueEmailRecorded.mockClear();
    const second = await runWatchdog(1500);
    expect(second.emailed).toEqual([]);
    expect(mocks.queueEmailRecorded).not.toHaveBeenCalled();
  });
  it("holds the episode when the heartbeat is back, and ends it after a clear hour", async () => {
    mocks.db = fakeSupabase(
      { job_state: [{ job: "alert:worker-heartbeat", cursor: 1, paused_reason: "sent: x", updated_at: ago(30) }] },
      { rpc: { data_freshness: () => [{ key: "worker_heartbeat", newest: ago(1) }], job_health: () => [] } },
    );
    const r = await runWatchdog(1500);
    expect(r.closed).toEqual([]);
    expect(mocks.db.state("alert:worker-heartbeat")!.paused_reason).toBe("cleared sent: x");
    mocks.db.state("alert:worker-heartbeat")!.updated_at = ago(61);
    const r2 = await runWatchdog(1500);
    expect(r2.closed).toContain("alert:worker-heartbeat");
    expect(mocks.db.state("alert:worker-heartbeat")).toBeUndefined();
  });
  // Review R5: before this, episodes were marked sent whatever the send returned.
  it.each([
    ["no admin recipients", [] as string[], { status: "sent", recorded: true }],
    ["the email_log insert failed", ["owner@example.com"], { status: "queued", recorded: false, error: "insert failed" }],
    ["the send failed", ["owner@example.com"], { status: "failed", recorded: true }],
    ["the recipient is suppressed", ["owner@example.com"], { status: "suppressed", recorded: true }],
  ])("keeps the episode open and writes no digest time when %s", async (_why, to, result) => {
    mocks.adminEmails.mockImplementation(async () => to);
    mocks.queueEmailRecorded.mockImplementation(async () => result);
    mocks.db = fakeSupabase({}, { rpc: { data_freshness: () => [{ key: "worker_heartbeat", newest: ago(45) }], job_health: () => [] } });
    const r = await runWatchdog(1500);
    expect(r.emailed).toEqual([]);
    expect(r.held).toContain("worker-heartbeat");
    expect(mocks.db.state("alert:worker-heartbeat")!.paused_reason).toMatch(/^open: /);
    expect(mocks.db.state("alert-digest")).toBeUndefined();
    // the next run tries again with the same digest
    mocks.adminEmails.mockImplementation(async () => ["owner@example.com"]);
    mocks.queueEmailRecorded.mockImplementation(async () => ({ status: "sent", recorded: true }));
    const r2 = await runWatchdog(1500);
    expect(r2.emailed).toContain("worker-heartbeat");
    expect(mocks.db.state("alert:worker-heartbeat")!.paused_reason).toMatch(/^sent: /);
  });
});

// Review R7: a database outage used to end silently (the outbox lives in the same database).
describe("database unreachable", () => {
  const send = vi.hoisted(() => vi.fn(async () => ({ sent: true })));
  vi.mock("@/lib/email-templates/send-email", () => ({ sendTemplateEmail: send }));
  const down = () => {
    mocks.db = fakeSupabase();
    mocks.db.client.from = (() => ({ select: () => ({ limit: async () => ({ data: null, error: { message: "upstream connect error 503" } }) }) })) as never;
  };
  it("sends one direct email to OPS_ALERT_EMAIL when a second read also fails, keyed once per UTC day", async () => {
    vi.stubEnv("OPS_ALERT_EMAIL", "ops@example.com");
    down();
    const { alertIfDatabaseDown } = await import("./watchdog.server");
    const r = await alertIfDatabaseDown(new Error("data_freshness: upstream connect error 503"), Date.parse("2026-11-20T10:00:00Z"));
    expect(r.direct).toBe("sent to ops@example.com");
    expect(send).toHaveBeenCalledWith("ops-alert", "ops@example.com", expect.objectContaining({ idempotencyKey: "ops-db-unreachable:2026-11-20" }));
    vi.unstubAllEnvs();
  });
  it("sends nothing for a slow read, when the database answers the probe, or without a recipient", async () => {
    const { alertIfDatabaseDown } = await import("./watchdog.server");
    send.mockClear();
    mocks.db = fakeSupabase();
    expect((await alertIfDatabaseDown(new Error("watchdog reads took over 1200 ms"))).direct).toMatch(/slow/);
    expect((await alertIfDatabaseDown(new Error("job_health: boom"))).direct).toMatch(/answered a second read/);
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    down();
    expect((await alertIfDatabaseDown(new Error("x"))).direct).toMatch(/OPS_ALERT_EMAIL is not set/);
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
