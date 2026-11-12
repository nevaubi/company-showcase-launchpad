import { describe, expect, it } from "vitest";
import { buildTimeline, estimateNextEarnings, nextEarnings } from "./catalysts";

describe("estimateNextEarnings", () => {
  it("uses the release one year earlier", () => {
    const r = estimateNextEarnings(["2025-10-30", "2026-01-29", "2026-04-30", "2026-07-30"], "2026-09-01");
    expect(r?.date).toBe("2026-10-29");
  });
  it("needs two releases", () => {
    expect(estimateNextEarnings(["2026-01-01"], "2026-02-01")).toBeNull();
  });
});

describe("nextEarnings", () => {
  const releases = ["2025-08-27", "2025-11-19", "2026-02-25", "2026-05-20", "2026-08-26"];
  it("prefers the calendar date over a projection from last year's release", () => {
    // The projection alone says Nov 18; the company has announced Nov 17.
    expect(estimateNextEarnings(releases, "2026-11-12")?.date).toBe("2026-11-18");
    expect(nextEarnings("2026-11-17", releases, "2026-11-12")).toEqual({ date: "2026-11-17", basis: "the earnings calendar", estimated: false });
  });
  it("falls back to the projection when the calendar date is missing or already past", () => {
    expect(nextEarnings(null, releases, "2026-11-12")).toMatchObject({ date: "2026-11-18", estimated: true });
    expect(nextEarnings("2026-08-26", releases, "2026-11-12")).toMatchObject({ date: "2026-11-18", estimated: true });
  });
  it("is null with neither", () => {
    expect(nextEarnings(null, ["2026-01-01"], "2026-02-01")).toBeNull();
  });
});

describe("buildTimeline", () => {
  it("drops 8-Ks that are the earnings release and sorts newest first", () => {
    const t = buildTimeline([
      { date: "2026-01-01", kind: "8k", title: "8-K", accn: "A" },
      { date: "2026-01-01", kind: "earnings", title: "E", accn: "A" },
      { date: "2026-03-01", kind: "8k", title: "Other", accn: "B" },
    ]);
    expect(t.map((e) => e.title)).toEqual(["Other", "E"]);
  });
});
