import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

type Seed = Parameters<typeof fakeSupabase>[0];
import { healthFromRuns, missingFunction, runClass, type RunRow } from "./job-health";
import { KNOWN_JOBS, readJobHealth, readFromRuns } from "./job-health.server";
import { alerts, planAlerts, type StateRow } from "./watchdog";

const NOW = Date.parse("2026-11-24T06:15:00Z");
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
const run = (job: string, min: number, ok: boolean | null, finished = true, detail?: Record<string, unknown>): RunRow & { detail?: Record<string, unknown> } => ({
  job,
  started_at: at(min),
  finished_at: finished ? at(min - 0.1) : null,
  ok: finished ? ok : null,
  ...(detail ? { detail } : {}),
});

/**
 * Fixture rows with the values job_health(24) (migration 0066) gives for them, worked by hand from
 * the function's SQL: window started_at > now() - 24 h, vendor-backfill excluded; runs = count(*);
 * unfinished = finished_at IS NULL; failed = ok = false; last_ok = max(started_at) where ok; last_run =
 * max(started_at); fail_streak = (smallest finished-only row number with ok) - 1, else the number of
 * finished rows.
 */
const FIXTURE: RunRow[] = [
  // a: newest first: failed, unfinished (skipped by the streak), failed, ok, failed -> streak 2
  run("a", 1, false),
  run("a", 2, null, false),
  run("a", 3, false),
  run("a", 4, true),
  run("a", 5, false),
  // b: never ok -> streak = finished rows (2), last_ok null; one unfinished row
  run("b", 10, false),
  run("b", 20, false),
  run("b", 30, null, false),
  // c: newest ok -> streak 0; a row older than 24 h is outside the window
  run("c", 6, true),
  run("c", 7, false),
  run("c", 24 * 60 + 1, false),
  // vendor-backfill is excluded by the function
  run("vendor-backfill", 1, false),
];
const FUNCTION_ROWS = [
  { job: "a", runs: 5, unfinished: 1, failed: 3, last_ok: at(4), last_run: at(1), fail_streak: 2 },
  { job: "b", runs: 3, unfinished: 1, failed: 2, last_ok: null, last_run: at(10), fail_streak: 2 },
  { job: "c", runs: 2, unfinished: 0, failed: 1, last_ok: at(6), last_run: at(6), fail_streak: 0 },
];

describe("job health from job_runs (job_health() missing in production)", () => {
  it("gives the function's rows on the same runs", () => {
    expect(healthFromRuns(FIXTURE, NOW, 24, { classes: false })).toEqual(FUNCTION_ROWS);
    // with classes on and no provider answers among the failures, the rows are the same
    expect(healthFromRuns(FIXTURE, NOW, 24)).toEqual(FUNCTION_ROWS);
  });
  it("knows PostgREST's and Postgres's missing-function answers", () => {
    expect(missingFunction({ code: "PGRST202", message: "Could not find the function public.job_health(_hours) in the schema cache" })).toBe(true);
    expect(missingFunction({ code: "42883", message: "function public.job_health(integer) does not exist" })).toBe(true);
    expect(missingFunction({ message: "permission denied for function job_health" })).toBe(false);
    expect(missingFunction(null)).toBe(false);
  });
  it("reads job_runs when the function is missing, and the function when it exists", async () => {
    const db = fakeSupabase({ job_runs: FIXTURE.map((r) => ({ ...r })) });
    const r = await readJobHealth(db.client as never, { nowMs: NOW });
    expect(r.source).toBe("job_runs");
    expect(r.unread).toEqual([]);
    // a, b, c are not named jobs: the catch-all read finds them; vendor-backfill comes as its own row
    expect(r.rows.filter((x) => x.job !== "vendor-backfill")).toEqual(FUNCTION_ROWS);
    expect(r.rows.find((x) => x.job === "vendor-backfill")).toMatchObject({ runs: 1, failed: 1 });
    const withFn = fakeSupabase({}, { rpc: { job_health: () => [{ job: "x", runs: "4", unfinished: "0", failed: "1", last_ok: at(1), last_run: at(1), fail_streak: 0 }] } });
    const f = await readJobHealth(withFn.client as never, { nowMs: NOW });
    expect(f).toMatchObject({ source: "function", rows: [{ job: "x", runs: 4, failed: 1 }] });
  });
  it("keeps vendor-backfill's volume from crowding out other jobs, and marks a job read only in part", async () => {
    const rows: RunRow[] = [];
    for (let i = 0; i < 1500; i++) rows.push(run("vendor-backfill", i * 0.5, i % 3 !== 0));
    for (let i = 0; i < 1200; i++) rows.push(run("setups", i, true));
    rows.push(run("prices", 3, true), run("sec", 4, false));
    const db = fakeSupabase({ job_runs: rows } as unknown as Seed);
    const r = await readFromRuns(db.client as never, { nowMs: NOW });
    const by = new Map(r.rows.map((x) => [x.job, x]));
    expect(by.get("prices")).toMatchObject({ runs: 1, last_run: at(3) });
    expect(by.get("sec")).toMatchObject({ runs: 1, failed: 1, fail_streak: 1 });
    expect(by.get("setups")).toMatchObject({ runs: 1000, partial: true, last_run: at(0) });
    // vendor-backfill comes as its own row (newest 1,000 runs, marked partial), never in the others' reads
    expect(by.get("vendor-backfill")).toMatchObject({ runs: 1000, partial: true });
  });
  it("never calls a job silent whose runs were not read", async () => {
    const db = fakeSupabase({ job_runs: [run("prices", 3, true)] } as unknown as Seed);
    const from = db.client.from;
    // the sec-discover read fails; every other read answers
    db.client.from = ((t: string) => {
      const q = from(t) as unknown as { eq: (c: string, v: unknown) => unknown };
      const eq = q.eq;
      q.eq = (c: string, v: unknown) => (v === "sec-discover" ? Promise.resolve({ data: null, error: { message: "statement timeout" } }) : eq(c, v));
      return q;
    }) as never;
    const r = await readFromRuns(db.client as never, { nowMs: NOW });
    expect(r.unread).toEqual(["sec-discover"]);
    const keys = alerts({ freshness: [], jobs: r.rows, states: [], unread: r.unread }, NOW).map((a) => a.key);
    expect(keys).not.toContain("job-silent:sec-discover");
    // a job that was read and has no run is still silent
    expect(keys).toContain("job-silent:macro");
    expect(KNOWN_JOBS).toContain("sec-discover");
  });
  // Production 23-24 Nov: ir-docs failed on every run (ir_release_scan check constraint) and nobody was told.
  it("a job failing on every run for hours produces one digest", () => {
    const rows: RunRow[] = [];
    for (let m = 5; m < 11 * 60; m += 5) rows.push({ ...run("ir-docs", m, false), error: 'new row for relation "ir_release_scan" violates check constraint "ir_release_scan_status_check"' });
    const jobs = healthFromRuns(rows, NOW);
    expect(jobs[0]).toMatchObject({ job: "ir-docs", failed: rows.length, fail_streak: rows.length });
    let states: StateRow[] = [];
    let emails = 0;
    for (let t = NOW; t < NOW + 3 * 3600_000; t += 10 * 60_000) {
      const active = alerts({ freshness: [], jobs, states }, t).filter((a) => a.key.startsWith("job-failing"));
      const plan = planAlerts(active, states, t);
      if (plan.send.length) emails++;
      const by = new Map(states.map((s) => [s.job, s]));
      for (const u of plan.upsert) by.set(u.job, u);
      states = [...by.values()];
    }
    expect(emails).toBe(1);
    expect(states.find((s) => s.job === "alert:job-failing:ir-docs")?.paused_reason).toMatch(/^sent: ir-docs failed \d+ runs in a row/);
  });
});

// Production 24 Nov: vendor-backfill recorded 2,464 of 11,341 runs as failed, most of them the vendor saying it has no data.
describe("run classes", () => {
  const vendor = (error: string): RunRow => ({ ...run("vendor-backfill", 1, false), error });
  it("tells a provider with no data and a budget cut from a failed run", () => {
    expect(runClass(vendor('{"code": "not_found", "status": 404, "message": "Fiscal.ai does not have this data for this company yet."}'))).toBe("empty");
    expect(runClass(vendor('{"code": "not_found", "status": 404, "message": "No matching company was found."}'))).toBe("empty");
    expect(runClass(vendor("No website, domain or LinkedIn page to match on"))).toBe("empty");
    expect(runClass(vendor("ENOSPC: no space left on device, open '/var/data/vendor-backfill/ab41e6f5776869b2afe3d1963'"))).toBe("failed");
    expect(runClass({ ...run("sec-discover", 1, false), error: "SEC EDGAR responded with an error (no answer in 3417 ms) (run budget spent) for https://www.sec.gov/cgi-bin/browse-edgar" })).toBe("cut");
    expect(runClass({ ...run("sec-discover", 1, false), error: "daily index 2026-11-22: HTTP 503" })).toBe("failed");
    expect(runClass(run("x", 1, true))).toBe("ok");
    expect(runClass(run("x", 1, null, false))).toBe("running");
  });
  it("counts answers apart from failures, and an answer ends a failure streak", () => {
    const rows = [
      { ...run("sec-discover", 1, false), error: "SEC EDGAR responded with an error (run budget spent) for https://data.sec.gov/submissions/CIK0000008670.json" },
      { ...run("sec-discover", 2, false), error: "SEC EDGAR responded 503 for https://data.sec.gov/x" },
      { ...run("sec-discover", 3, false), error: "SEC EDGAR responded 503 for https://data.sec.gov/x" },
    ];
    expect(healthFromRuns(rows, NOW)[0]).toMatchObject({ runs: 3, failed: 2, cut: 1, fail_streak: 0 });
    expect(healthFromRuns(rows, NOW, 24, { classes: false })[0]).toMatchObject({ failed: 3, fail_streak: 3 });
  });
  it("adds the vendor collector's row, which job_health() leaves out, with its no-data answers apart", async () => {
    const vend = (min: number, error: string) => ({ ...run("vendor-backfill", min, false), detail: { error, provider: "fiscal-ai" } });
    const rows = [
      vend(1, '{"code": "not_found", "status": 404, "message": "Fiscal.ai does not have this data for this company yet."}'),
      vend(2, "ENOSPC: no space left on device, open '/var/data/vendor-backfill/ab41e6f5'"),
      vend(3, "No website, domain or LinkedIn page to match on"),
      { ...run("vendor-backfill", 4, true) },
    ];
    const db = fakeSupabase({ job_runs: rows } as unknown as Seed, { rpc: { job_health: () => FUNCTION_ROWS } });
    const r = await readJobHealth(db.client as never, { nowMs: NOW });
    expect(r.source).toBe("function");
    expect(r.rows.find((x) => x.job === "vendor-backfill")).toEqual({ job: "vendor-backfill", runs: 4, unfinished: 0, failed: 1, empty: 2, cut: 0, last_ok: at(4), last_run: at(1), fail_streak: 0 });
    expect(r.rows.filter((x) => x.job !== "vendor-backfill")).toEqual(FUNCTION_ROWS);
  });
  it("reads the error out of detail without reading the whole detail", async () => {
    const db = fakeSupabase({ job_runs: [run("sec-discover", 1, false, true, { error: "SEC EDGAR responded with an error (run budget spent) for https://data.sec.gov/x", big: "x".repeat(1000) })] } as unknown as Seed);
    const r = await readFromRuns(db.client as never, { nowMs: NOW });
    expect(r.rows.find((x) => x.job === "sec-discover")).toMatchObject({ failed: 0, cut: 1 });
  });
});
