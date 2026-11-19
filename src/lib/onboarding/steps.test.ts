import { describe, expect, it } from "vitest";
import { SIDEBAR_HUBS } from "@/lib/nav";
import { TOUR_STEPS } from "./steps";

describe("tour steps", () => {
  it("point hub targets at rows that exist in the sidebar", () => {
    const ids = new Set(SIDEBAR_HUBS.map((h) => `[data-tour='hub-${h.id}']`));
    const hubSteps = TOUR_STEPS.filter((s) => s.target?.includes("hub-"));
    expect(hubSteps.length).toBeGreaterThan(0);
    for (const s of hubSteps) expect(ids.has(s.target!)).toBe(true);
  });
});
