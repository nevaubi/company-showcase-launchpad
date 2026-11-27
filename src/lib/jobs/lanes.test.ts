import { describe, expect, it } from "vitest";
import { holdRowPatch, ownerHolds } from "./lane-hold";
import { HOLD_SEEN_WITHIN_MIN, LANES, LANE_GROUPS, holdKey, laneBoard, laneById, laneOfHoldKey, loopLane, markKey, runNote, type LaneRunRow, type LaneStateRow } from "./lanes";
import { DATA_CADENCE } from "./data-freshness";

const NOW = Date.parse("2026-11-27T15:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const run = (job: string, minAgo: number, over: Partial<LaneRunRow> = {}): LaneRunRow => ({ job, started_at: iso(minAgo + 2), finished_at: iso(minAgo), ok: true, items: 3, detail: null, runs_24h: 10, failed_24h: 0, ...over });
const view = (states: LaneStateRow[], runs: LaneRunRow[], id: string) => laneBoard(states, runs, NOW).find((l) => l.id === id)!;

describe("the lane list", () => {
  it("names every lane once, in a known group", () => {
    expect(new Set(LANES.map((l) => l.id)).size).toBe(LANES.length);
    expect(LANES.every((l) => LANE_GROUPS.includes(l.group))).toBe(true);
    expect(LANES.every((l) => l.label && l.what.endsWith(".") && l.every)).toBe(true);
  });
  it("keeps a lane's hold on hold:<lane>, and the vendor collector's on its own lease row", () => {
    expect(holdKey("loop:company")).toBe("hold:loop:company");
    expect(holdKey("vendor-backfill")).toBe("vendor-backfill");
    expect(laneOfHoldKey("hold:loop:company")).toBe("loop:company");
    expect(laneOfHoldKey("vendor-backfill")).toBe("vendor-backfill");
    expect(laneOfHoldKey("ir-deep-loop")).toBeNull();
    expect(markKey("abs-bulk-runner")).toBe("lane:abs-bulk-runner");
    expect(loopLane("mirror")).toBe("loop:mirror");
  });
  it("every lane a dataset names as its feeder is on the list", () => {
    const named = DATA_CADENCE.flatMap((c) => (c.heldBy == null ? [] : typeof c.heldBy === "string" ? [c.heldBy] : [...c.heldBy]));
    expect(named.length).toBeGreaterThan(5);
    for (const lane of named) expect(laneById(lane), lane).toBeDefined();
  });
});

describe("laneBoard", () => {
  it("waiting: no run in progress; the newest run is what it did last", () => {
    const v = view([], [run("loop:filing-steps", 12, { items: 4 })], "loop:filing-steps");
    expect(v).toMatchObject({ state: "waiting", late: false, hold: null, runs24h: 10, failed24h: 0 });
    expect(v.last).toEqual({ at: iso(12), ok: true, items: 4, ms: 120_000, note: null });
  });
  it("running: the lane's marker is in force", () => {
    const v = view([{ job: "lane:loop:canon", cursor: 0, paused_reason: null, lease_until: iso(-2), updated_at: iso(40) }], [], "loop:canon");
    expect(v).toMatchObject({ state: "running", runningSince: iso(40), late: false });
    // a marker that ran out (the process died) is not running
    expect(view([{ job: "lane:loop:canon", cursor: 0, paused_reason: null, lease_until: iso(1), updated_at: iso(400) }], [], "loop:canon").state).toBe("waiting");
  });
  it("late: no run for longer than the lane's rhythm, or never; a lane without a rhythm is never late", () => {
    expect(view([], [run("loop:filing-steps", 181)], "loop:filing-steps").late).toBe(true);
    expect(view([], [run("loop:filing-steps", 179)], "loop:filing-steps").late).toBe(false);
    expect(view([], [], "loop:filing-steps").late).toBe(true);
    expect(view([], [], "loop:company").late).toBe(false);
    // a weekly lane with no record is not called late: its last run may be older than the records
    expect(view([], [], "loop:sod").late).toBe(false);
    // its marker remembers when it last started, after the run rows are gone
    const mark = (minAgo: number): LaneStateRow => ({ job: "lane:loop:sod", cursor: 0, paused_reason: null, lease_until: null, updated_at: iso(minAgo) });
    expect(view([mark(20 * 24 * 60)], [], "loop:sod").late).toBe(false);
    expect(view([mark(22 * 24 * 60)], [], "loop:sod").late).toBe(true);
  });
  it("held: the owner's reason and day; seen once the lane stamped it", () => {
    const placed = { job: "hold:loop:canon", ...holdRowPatch("Saving credit this week.", new Date(NOW - 3 * 60_000)), updated_at: iso(3) } as LaneStateRow;
    const fresh = view([placed], [run("loop:canon", 300)], "loop:canon");
    expect(fresh).toMatchObject({ state: "held", late: false, runningSince: null });
    expect(fresh.hold).toEqual({ why: "Saving credit this week", since: "2026-11-27", seenAt: null, unseen: false, ranSince: false });
    const seen = view([{ ...placed, cursor: Math.floor((NOW - 60_000) / 1000) }], [], "loop:canon");
    expect(seen.hold).toMatchObject({ seenAt: new Date(Math.floor((NOW - 60_000) / 1000) * 1000).toISOString(), unseen: false });
  });
  it("held but not seen in time, or a run recorded after the hold: the board says so", () => {
    const old = { job: "hold:loop:canon", ...holdRowPatch("x y z", new Date(NOW - (HOLD_SEEN_WITHIN_MIN + 1) * 60_000)), updated_at: iso(HOLD_SEEN_WITHIN_MIN + 1) } as LaneStateRow;
    expect(view([old], [], "loop:canon").hold).toMatchObject({ unseen: true, ranSince: false });
    expect(view([old], [run("loop:canon", 2)], "loop:canon").hold).toMatchObject({ unseen: true, ranSince: true });
  });
  it("a hold wins over a marker left running, and the vendor collector's own-row hold needs no stamp", () => {
    const v = view(
      [
        { job: "vendor-backfill", cursor: 300, paused_reason: "owner: hold. Vendor collection stopped at the owner's request (since 2026-11-27)", lease_until: "2099-12-31T00:00:00Z", updated_at: iso(600) },
        { job: "lane:vendor-backfill", cursor: 0, paused_reason: null, lease_until: iso(-1), updated_at: iso(700) },
      ],
      [],
      "vendor-backfill",
    );
    expect(v.state).toBe("held");
    expect(v.hold).toMatchObject({ why: "Vendor collection stopped at the owner's request", since: "2026-11-27", unseen: false });
  });
  it("lists every lane in the list's order", () => {
    expect(laneBoard([], [], NOW).map((l) => l.id)).toEqual(LANES.map((l) => l.id));
  });
});

describe("runNote", () => {
  it("picks the line a person wants", () => {
    expect(runNote({ error: "HTTP 500 from the source" })).toBe("HTTP 500 from the source");
    expect(runNote({ code: 124, ms: 5, timedOut: true })).toBe("stopped at its time limit");
    expect(runNote({ code: 1, ms: 5 })).toBe("ended with code 1");
    expect(runNote({ code: 75, stopped: "stopped by the owner's hold" })).toBe("stopped by the owner's hold");
    expect(runNote({ idle: true })).toBe("nothing to do");
    expect(runNote({ code: 0, ms: 5 })).toBeNull();
    expect(runNote(null)).toBeNull();
  });
});

describe("ownerHolds", () => {
  it("lists a hold:<lane> row under its lane, so a dataset's feeder name finds it", () => {
    const holds = ownerHolds([
      { job: "hold:loop:options-night", paused_reason: "owner: hold. Testing (since 2026-11-27)" },
      { job: "vendor-backfill", paused_reason: "owner: hold. Stopped (since 2026-11-27)" },
      { job: "hold:loop:canon", paused_reason: null },
      { job: "ir-deep-loop", paused_reason: "owner:srv-1:22:1" },
    ]);
    expect([...holds.keys()].sort()).toEqual(["loop:options-night", "vendor-backfill"]);
  });
});
