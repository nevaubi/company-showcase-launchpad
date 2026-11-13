import { describe, expect, it } from "vitest";
import { needsVisionEscalation } from "./vision-quality";

describe("Gemini to Luna vision escalation", () => {
  const complete = { rejected: 0, missingAfter: 0 };
  it("escalates every OCR dashboard", () => {
    expect(needsVisionEscalation(complete, true)).toBe(true);
  });
  it("escalates rejected figures", () => {
    expect(needsVisionEscalation({ ...complete, rejected: 1 }, false)).toBe(true);
  });
  it("escalates missing tokens", () => {
    expect(needsVisionEscalation({ ...complete, missingAfter: 1 }, false)).toBe(true);
  });
  it("escalates failed answers", () => {
    expect(needsVisionEscalation({ ...complete, failed: "incomplete" }, false)).toBe(true);
  });
  it("keeps complete text-layer pages with Gemini", () => {
    expect(needsVisionEscalation(complete, false)).toBe(false);
  });
});