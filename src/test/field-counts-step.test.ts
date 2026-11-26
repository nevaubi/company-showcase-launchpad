// The worker's field counts step (scripts/lib/field-counts-step.ts): off unless FIELD_COUNTS_ENABLED=1, a quiet no-op
// while migration 0070 is not applied, a bounded child when due, again at once while snapshots are left, a skip of a
// day for a snapshot that failed or stopped a child, a back-off for a child that ended badly, and never the lane's
// failure. With a fake child and clock.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIELD_COUNTS_IDLE_MS, FIELD_COUNTS_MAX_BYTES, FIELD_COUNTS_MAX_SNAPSHOTS, FIELD_COUNTS_RECHECK_MS, FIELD_COUNTS_RUN_SECONDS, FIELD_COUNTS_SKIP_MS,
  fieldCountsArgs, fieldCountsEnabled, fieldCountsStep, type ChildEnd,
} from "../../scripts/lib/field-counts-step";
import { RESOURCE_WAIT_EXIT } from "../../scripts/lib/official-worker-plan";

const H = (n: number) => n.toString(16).padStart(64, "0");
type PgError = { code?: string; message?: string } | null;

function harness(probeErrors: PgError[] = []) {
  let clock = 1_000_000_000;
  const lines: string[] = [];
  const probes: number[] = [];
  const runs: string[][] = [];
  let answer: ChildEnd = { code: 0, told: { items: 1, left: 0, failed: [] } };
  const step = fieldCountsStep({
    probe: async () => {
      probes.push(clock);
      return { error: probeErrors.length ? probeErrors.shift()! : null };
    },
    log: (line) => lines.push(line),
    now: () => clock,
  });
  return {
    step,
    lines,
    probes,
    runs,
    tick: (ms: number) => (clock += ms),
    answer: (a: ChildEnd) => (answer = a),
    pass: () => step.pass(async (args) => (runs.push(args), answer)),
  };
}

describe("field counts step", () => {
  it("is off unless FIELD_COUNTS_ENABLED is 1 or true", () => {
    expect(fieldCountsEnabled(undefined)).toBe(false);
    expect(fieldCountsEnabled("")).toBe(false);
    expect(fieldCountsEnabled("0")).toBe(false);
    expect(fieldCountsEnabled("yes")).toBe(false);
    expect(fieldCountsEnabled("1")).toBe(true);
    expect(fieldCountsEnabled("TRUE")).toBe(true);
    // the worker reads the flag through it, and runs the step only in the lane's idle branch
    const worker = readFileSync("scripts/official-source-worker.ts", "utf8");
    expect(worker).toContain("fieldCountsEnabled(process.env.FIELD_COUNTS_ENABLED)");
    expect(worker.indexOf("await fieldCountsPass(held)")).toBeGreaterThan(worker.indexOf("const row = statsOnlyRow(await statsPass(held));"));
  });

  it("gives the child its bounds and the snapshots to skip", () => {
    expect(fieldCountsArgs([])).toEqual(["--all", `--max-snapshots=${FIELD_COUNTS_MAX_SNAPSHOTS}`, `--max-bytes=${FIELD_COUNTS_MAX_BYTES}`, `--max-runtime-seconds=${FIELD_COUNTS_RUN_SECONDS}`]);
    expect(fieldCountsArgs([H(1), H(2)]).at(-1)).toBe(`--skip=${H(1)},${H(2)}`);
    expect(fieldCountsArgs(Array.from({ length: 150 }, (_, i) => H(i))).at(-1)!.split(",")).toHaveLength(100);
    // the child stops before the lane would stop it
    expect(FIELD_COUNTS_RUN_SECONDS * 1000).toBeLessThan(480_000);
  });

  it("starts no child while the table is missing, says so once, and looks again hourly", async () => {
    const h = harness([{ code: "PGRST205", message: "Could not find the table" }, { code: "42P01" }]);
    expect(await h.pass()).toEqual({ status: "not_installed" });
    expect(await h.pass()).toEqual({ status: "not_installed" });
    expect(h.probes).toHaveLength(1);
    h.tick(FIELD_COUNTS_RECHECK_MS);
    expect(await h.pass()).toEqual({ status: "not_installed" });
    expect(h.probes).toHaveLength(2);
    expect(h.lines.filter((l) => /not installed/.test(l))).toHaveLength(1);
    expect(h.runs).toHaveLength(0);
    h.tick(FIELD_COUNTS_RECHECK_MS);
    expect(await h.pass()).toMatchObject({ status: "ran", items: 1 });
    expect(h.runs).toHaveLength(1);
    expect(h.lines.at(-1)).toMatch(/found/);
  });

  it("runs again at once while snapshots are left, then waits half an hour, or less after a publication", async () => {
    const h = harness();
    h.answer({ code: 0, told: { items: 25, left: 40, failed: [] } });
    await h.pass();
    await h.pass();
    expect(h.runs).toHaveLength(2);
    h.answer({ code: 0, told: { items: 3, left: 0, failed: [] } });
    await h.pass();
    expect(await h.pass()).toMatchObject({ status: "waiting" });
    h.tick(FIELD_COUNTS_IDLE_MS - 1);
    expect(await h.pass()).toMatchObject({ status: "waiting" });
    h.step.wake();
    expect(await h.pass()).toMatchObject({ status: "ran" });
    h.tick(FIELD_COUNTS_IDLE_MS);
    expect(await h.pass()).toMatchObject({ status: "ran" });
    expect(h.runs).toHaveLength(5);
  });

  it("skips for a day a snapshot that failed, that no run could count, or that a stopped child was counting", async () => {
    const h = harness();
    h.answer({ code: 0, told: { items: 1, left: 5, failed: [{ snapshot: H(1), error: "Source count differs" }], too_long: [H(2)] } });
    await h.pass();
    await h.pass();
    expect(h.runs[1].at(-1)).toBe(`--skip=${H(1)},${H(2)}`);
    h.answer({ code: 124, told: { items: 0, current: H(3) } });
    await h.pass();
    expect(h.step.skipping()).toEqual([H(1), H(2), H(3)]);
    h.tick(FIELD_COUNTS_SKIP_MS + 3_600_000);
    h.answer({ code: 0, told: { items: 1, left: 0, failed: [] } });
    await h.pass();
    expect(h.runs.at(-1)!.some((a) => a.startsWith("--skip="))).toBe(false);
  });

  it("backs off from a minute to an hour after a child that ended badly, and waits a minute for memory", async () => {
    const h = harness();
    h.answer({ code: 1, told: null });
    await h.pass();
    expect(await h.pass()).toMatchObject({ status: "waiting" });
    h.tick(60_000);
    await h.pass();
    h.tick(60_000);
    expect(await h.pass()).toMatchObject({ status: "waiting" });
    h.tick(60_000);
    await h.pass();
    expect(h.runs).toHaveLength(3);
    // a run that could not list its queue is a failure of the step too
    const listing = harness();
    listing.answer({ code: 0, told: { items: 0, left: 0, failed: [], error: "list of snapshots without field counts: timeout" } });
    await listing.pass();
    expect(await listing.pass()).toMatchObject({ status: "waiting" });
    // no memory headroom: the lane did not start the child
    const memory = harness();
    memory.answer({ code: RESOURCE_WAIT_EXIT, told: null });
    expect(await memory.pass()).toMatchObject({ status: "ran", code: RESOURCE_WAIT_EXIT });
    expect(await memory.pass()).toMatchObject({ status: "waiting" });
    memory.tick(60_000);
    await memory.pass();
    expect(memory.runs).toHaveLength(2);
  });

  it("treats a child that found no table, or a failed probe, as not installed or a back-off", async () => {
    const h = harness();
    h.answer({ code: 0, told: { items: 0, not_installed: true } });
    expect(await h.pass()).toEqual({ status: "not_installed" });
    expect(await h.pass()).toEqual({ status: "not_installed" });
    const p = harness([{ code: "57014", message: "canceling statement due to statement timeout" }]);
    expect(await p.pass()).toMatchObject({ status: "probe_failed", error: expect.stringMatching(/statement timeout/) });
    expect(await p.pass()).toMatchObject({ status: "waiting" });
    expect(p.runs).toHaveLength(0);
  });
});
