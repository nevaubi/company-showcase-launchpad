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

  it("describe the rebuilt pages as they are now", () => {
    const body = (title: string) => TOUR_STEPS.find((s) => s.title === title)?.body ?? "";
    expect(body("Statements straight from XBRL")).toContain("The line above the table says how current it is");
    expect(body("Each KPI cites its cell")).toContain("checked against it when the page opens");
    expect(body("Each KPI cites its cell")).not.toContain("SEC revenue");
    expect(body("Segment & KPI data from IR documents")).not.toContain("must agree");
    expect(body("What changed in the filing")).toContain("The verdict comes first");
  });
});
