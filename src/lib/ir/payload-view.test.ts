import { describe, expect, it } from "vitest";
import { IR_PAYLOAD_VIEW_MAX, oversizeOf } from "@/lib/ir/payload-view";

describe("IR payload size the page fetches", () => {
  it("fetches payloads up to the limit", () => {
    expect(oversizeOf(19_211_671)).toBe(0);
    expect(oversizeOf(IR_PAYLOAD_VIEW_MAX)).toBe(0);
    expect(oversizeOf(null)).toBe(0);
    expect(oversizeOf(undefined)).toBe(0);
  });
  it("reports the size of a payload beyond the limit", () => {
    expect(oversizeOf(47_233_739)).toBe(47_233_739);
    expect(oversizeOf(IR_PAYLOAD_VIEW_MAX + 1)).toBe(IR_PAYLOAD_VIEW_MAX + 1);
  });
  it("treats an unreadable size as loadable", () => {
    expect(oversizeOf(Number.NaN)).toBe(0);
  });
});
