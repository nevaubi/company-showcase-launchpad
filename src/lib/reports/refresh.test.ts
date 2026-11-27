import { expect, it } from "vitest";
import { reportRefreshDue } from "./refresh";

const now = Date.parse("2026-11-27T12:00:00Z");
const slot = { status: "failed" as const, data_version: "r6", started_at: null, updated_at: "2026-11-27T10:00:00Z", error: "Interrupted writer: lock older than 2 hours released; will be rewritten" };
it("retries interrupted and temporary failures after a cooldown and leaves provider funding and configuration pauses in place", () => {
  expect(reportRefreshDue(slot, "r6", now)).toBe(true);
  expect(reportRefreshDue({ ...slot, error: "HTTP 503" }, "r6", now)).toBe(true);
  expect(reportRefreshDue({ ...slot, updated_at: "2026-11-27T11:55:00Z" }, "r7", now)).toBe(false);
  expect(reportRefreshDue({ ...slot, error: "AI credits are exhausted for this workspace." }, "r7", now)).toBe(false);
  expect(reportRefreshDue({ ...slot, error: "Invalid model ID" }, "r7", now)).toBe(false);
});
it("reconsiders a data failure after its inputs or generator version change", () => {
  const failed = { ...slot, error: "Insufficient data" };
  expect(reportRefreshDue(failed, "r6", now)).toBe(false);
  expect(reportRefreshDue(failed, "r7", now)).toBe(true);
  expect(reportRefreshDue({ ...failed, status: "ready" }, "r6", now)).toBe(false);
});
