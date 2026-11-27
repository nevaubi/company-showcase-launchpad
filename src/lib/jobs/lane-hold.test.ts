import { describe, expect, it } from "vitest";
import { HOLD_LEASE_UNTIL, holdPatch, holdRowPatch, holdText, isOwnerHold, ownerHoldReason, ownerHolds, placeHold, releasePatch } from "./lane-hold";
import { laneById } from "./lanes";
import { ROUTINE_REASON_RE, pausedJobs } from "./data-freshness";

const NOW = new Date("2026-11-27T12:15:00Z");

describe("owner holds", () => {
  it("a hold is the owner's own stop, told apart from a lease tag, pacing and a real pause", () => {
    expect(isOwnerHold(ownerHoldReason("Vendor collection stopped at the owner's request", NOW))).toBe(true);
    // the IR loop tags its lease with its host under the same word
    expect(isOwnerHold("owner:srv-dbu08con74is73f1tntg-d86c84457-hk7hc:17:1795778795520")).toBe(false);
    expect(isOwnerHold("owner: srv")).toBe(false);
    expect(isOwnerHold("pacing: hourly credit budget reached")).toBe(false);
    expect(isOwnerHold("collector interrupted; resume from existing files")).toBe(false);
    expect(isOwnerHold(null)).toBe(false);
    expect(isOwnerHold(undefined)).toBe(false);
  });

  it("the stored reason carries the day and reads as one sentence", () => {
    expect(ownerHoldReason("  Vendor collection stopped\n at the owner's request. ", NOW)).toBe("owner: hold. Vendor collection stopped at the owner's request (since 2026-11-27)");
    expect(holdText("owner: hold. Vendor collection stopped at the owner's request (since 2026-11-27)")).toBe("Vendor collection stopped at the owner's request (since 2026-11-27)");
    expect(() => ownerHoldReason("  ", NOW)).toThrow("A hold needs a reason");
  });

  it("a hold takes the lease out of reach; a release gives both back", () => {
    const hold = holdPatch("Stopped while the archive is planned in", NOW);
    expect(hold.lease_until).toBe(HOLD_LEASE_UNTIL);
    expect(Date.parse(hold.lease_until)).toBeGreaterThan(NOW.getTime() + 50 * 365 * 86_400_000);
    expect(isOwnerHold(hold.paused_reason)).toBe(true);
    expect(releasePatch(NOW)).toEqual({ paused_reason: null, lease_until: null, updated_at: "2026-11-27T12:15:00.000Z" });
  });

  it("lists held lanes by job, and nothing else", () => {
    const held = ownerHolds([
      { job: "vendor-backfill", paused_reason: "owner: hold. Stopped (since 2026-11-27)" },
      { job: "ir-deep-loop", paused_reason: "owner:srv-1:17:1" },
      { job: "options-backoff", paused_reason: "blocked: Cboe refused option chains" },
      { job: "sec", paused_reason: null },
    ]);
    expect([...held]).toEqual([["vendor-backfill", "Stopped (since 2026-11-27)"]]);
  });

  it("a hold is routine, never a pause a person has to act on", () => {
    const reason = ownerHoldReason("Stopped", NOW);
    expect(ROUTINE_REASON_RE.test(reason)).toBe(true);
    expect(pausedJobs([{ job: "vendor-backfill", paused_reason: reason, updated_at: "x" }])).toEqual([]);
  });

  it("only lanes on the list can be held: each of them checks for its hold", () => {
    expect(laneById("vendor-backfill")).toBeDefined();
    // the IR loop's own lease row is not a lane: its steps are (loop:company, loop:mirror, …)
    expect(laneById("ir-deep-loop")).toBeUndefined();
  });

  it("a hold on a hold:<lane> row carries no lease and starts unseen; on a lane's own lease row it locks the lease", () => {
    expect(holdRowPatch("Stopped", NOW)).toEqual({ paused_reason: "owner: hold. Stopped (since 2026-11-27)", lease_until: null, cursor: 0, updated_at: NOW.toISOString() });
    expect(holdPatch("Stopped", NOW)).toEqual({ paused_reason: "owner: hold. Stopped (since 2026-11-27)", lease_until: HOLD_LEASE_UNTIL, updated_at: NOW.toISOString() });
    expect(placeHold("Stopped", NOW, false)).toEqual(holdRowPatch("Stopped", NOW));
    expect(placeHold("Stopped", NOW, true)).toEqual(holdPatch("Stopped", NOW));
  });

});
