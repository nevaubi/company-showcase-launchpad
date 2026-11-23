import { describe, expect, it } from "vitest";
import { coverageOrder, jobStatus, openAlerts, providerStatus, stalledCursors, unfinishedRate } from "./status";

const NOW = Date.parse("2026-11-20T04:40:00Z"); // options night
const s = (job: string, cursor: number, paused_reason: string | null, updated_at: string) => ({ job, cursor, paused_reason, updated_at });

describe("pipeline status", () => {
  it("lists every provider, open first, with class, streak and next probe", () => {
    const rows = [s("provider:openai-paid", Math.floor(NOW / 1000) + 3600, "quota: OpenAI 429 credit_balance_exhausted [n=4]", "2026-11-20T04:00:00Z")];
    const p = providerStatus(rows, NOW);
    expect(p).toHaveLength(12);
    expect(p[0]).toMatchObject({ id: "openai-paid", state: "open", cls: "quota", failures: 4, retryAt: "2026-11-20T05:40:00.000Z" });
    expect(p.slice(1).every((x) => x.state === "closed")).toBe(true);
  });
  it("open alerts read their episode start and whether they were emailed", () => {
    const a = openAlerts([s("alert:worker-heartbeat", Math.floor(NOW / 1000) - 600, "sent: Render worker silent", "x"), s("sec", 1, null, "x")]);
    expect(a).toEqual([{ key: "worker-heartbeat", title: "Render worker silent", sent: true, since: new Date(NOW - 600_000).toISOString() }]);
  });
  it("jobs: failing, cut off and silent first", () => {
    const base = { failed: 0, last_ok: "2026-11-20T04:39:00Z", last_run: "2026-11-20T04:39:00Z", fail_streak: 0 };
    const j = jobStatus(
      [
        { job: "emails", runs: 10, unfinished: 0, ...base },
        { job: "sec-discover", runs: 100, unfinished: 40, ...base },
        { job: "macro", runs: 30, unfinished: 0, ...base, fail_streak: 5 },
        { job: "alt-data", runs: 30, unfinished: 0, ...base, last_run: "2026-11-20T04:20:00Z" },
        { job: "freshness", runs: 6, unfinished: 0, ...base, fail_streak: 6 },
      ],
      NOW,
    );
    expect(j.map((x) => [x.job, x.problem])).toEqual([
      ["macro", "failing"],
      ["sec-discover", "unfinished"],
      ["alt-data", "silent"],
      ["emails", null],
      ["freshness", null],
    ]);
    expect(unfinishedRate(j)).toMatchObject({ runs: 170, unfinished: 40 });
  });
  it("stalled rotation cursors, with the slice's tries; prices only count in market hours", () => {
    const rows = [s("options", 804, null, "2026-11-20T03:50:00Z"), s("options-slice", 8042, null, "x"), s("macro", 12, null, "2026-11-20T04:35:00Z"), s("prices", 1, null, "2026-11-19T22:54:00Z")];
    expect(stalledCursors(rows, NOW)).toEqual([{ job: "options", label: "Options (Cboe)", cursor: 804, movedAt: "2026-11-20T03:50:00Z", limitMin: 30, attempts: 2 }]);
  });
  it("coverage: least covered of the top 1,000 first, numbers parsed", () => {
    const c = coverageOrder([
      { dataset: "market_bars", top100: 100, top500: 500, top1000: 1000, median_age_hours: 32.6, p90_age_hours: 32.6 },
      { dataset: "analyst_estimates", top100: "74" as unknown as number, top500: 179, top1000: 212, median_age_hours: "5.9" as unknown as number, p90_age_hours: null },
    ]);
    expect(c.map((x) => x.dataset)).toEqual(["analyst_estimates", "market_bars"]);
    expect(c[0].median_age_hours).toBe(5.9);
    expect(c[0].top100).toBe(74);
  });
  it("weekend nights are not options stalls; weekday nights are (review R13)", () => {
    const rows = [s("options", 804, null, "2026-11-20T03:50:00Z")];
    expect(stalledCursors(rows, Date.parse("2026-11-21T23:00:00Z"))).toEqual([]); // Saturday night
    expect(stalledCursors(rows, Date.parse("2026-11-23T02:00:00Z"))).toEqual([]); // early Monday
    expect(stalledCursors(rows, Date.parse("2026-11-24T02:00:00Z")).map((x) => x.job)).toEqual(["options"]); // early Tuesday
  });
  it("cleared episodes waiting out their recovery hold are not open alerts", () => {
    expect(openAlerts([s("alert:stale:macro", 1, "cleared sent: x", "y"), s("alert:worker-heartbeat", 2, "sent: y", "z")]).map((a) => a.key)).toEqual(["worker-heartbeat"]);
  });
});
