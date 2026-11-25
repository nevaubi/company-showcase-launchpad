// The admin freshness page lists job_state pause reasons (review rev-workers M2): on 25 Nov 2026 it
// showed 196 paused jobs, 185 of them the official-source refresh's own bookkeeping rows. Key shapes
// and reasons below are copied from production job_state of that day.
import { describe, expect, it } from "vitest";
import { BOOKKEEPING_JOB_RE, groupPaused, pausedJobs } from "@/lib/jobs/data-freshness";

const at = "2026-11-25T19:05:00.000Z";
const row = (job: string, paused_reason: string) => ({ job, paused_reason, updated_at: at });

describe("official-source worker rows on the freshness page", () => {
  it("does not count refresh state, locks, the probe time or lane leases as paused jobs", () => {
    const bookkeeping = [
      row("source-refresh-state:official_00_universal_raw_fred_ccsa_1f53c3efc9",
        '{"last_attempt_at":"2026-11-25T06:04:45.463Z","last_checked_at":"2026-11-25T06:04:45.463Z","failures":0}'),
      row("source-refresh-state:official_08_consumer_discretionary_raw_fred_rrsfs_7b5e0e2f13",
        '{"last_attempt_at":"2026-11-25T19:04:10.890Z","failures":1,"last_error":"FRED download deadline exceeded"}'),
      row("source-refresh-lock:official_08_consumer_discretionary_raw_fred_totalsa_b2b7f5ec9c", "refresh:0e918558-8fff-4e9b-8eb0-76989629d811"),
      row("source-refresh-probe:fred", "2026-11-25T19:00Z app_user_agent 200 0.4s"),
      row("abs-bulk-runner", "official:srv-dbu08con74is73f1tntg-85cd4b5fb8-br224:618bfe9a-0c1d-4f7e-9a2b-3c4d5e6f7a8b"),
      row("official-source-refresh", "official:srv-dbu08con74is73f1tntg-85cd4b5fb8-br224:2f1e0d9c-8b7a-4c6d-9e8f-7a6b5c4d3e2f"),
      row("official-sources-runner", "official:srv-dbu08con74is73f1tntg-85cd4b5fb8-br224:5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d"),
    ];
    for (const r of bookkeeping) expect(BOOKKEEPING_JOB_RE.test(r.job), r.job).toBe(true);
    expect(pausedJobs(bookkeeping)).toEqual([]);
  });

  it("still shows real pauses, an open refresh family circuit among them", () => {
    const real = [
      row("source-refresh-family:fred", "transient: FRED download deadline exceeded [n=2]"),
      row("ir-canon", "quota: provider openai-paid closed until 2026-11-25 17:39 UTC"),
      row("options-backoff", "blocked: Cboe refused option chains (403 x4, 429 x0) [n=22]"),
    ];
    expect(pausedJobs(real).map((r) => r.job)).toEqual(["source-refresh-family:fred", "ir-canon", "options-backoff"]);
    expect(groupPaused(pausedJobs(real)).find((g) => g.job === "source-refresh-family:fred")).toMatchObject({ count: 1,
      reason: "transient: FRED download deadline exceeded [n=2]" });
  });

  it("matches the lane names exactly, not jobs that only start like them", () => {
    for (const job of ["abs-bulk-runner-old", "official-source-refresh:x", "source-refresh-states:x", "my-source-refresh-lock:x"])
      expect(BOOKKEEPING_JOB_RE.test(job), job).toBe(false);
  });
});
