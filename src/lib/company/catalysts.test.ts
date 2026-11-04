import { describe, expect, it } from "vitest";
import { buildTimeline, estimateNextEarnings } from "./catalysts";

describe("estimateNextEarnings", () => {
  it("uses the release one year earlier", () => {
    const r = estimateNextEarnings(["2025-10-30", "2026-01-29", "2026-04-30", "2026-07-30"], "2026-09-01");
    expect(r?.date).toBe("2026-10-29");
  });
  it("needs two releases", () => {
    expect(estimateNextEarnings(["2026-01-01"], "2026-02-01")).toBeNull();
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
