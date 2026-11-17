import { describe, expect, it } from "vitest";
import { allowedRuns, runOptions } from "./limits";

describe("browser run limits", () => {
  it("caps a single request at 4 browsers", () => expect(allowedRuns(6, 0)).toBe(4));
  it("stops at 40 runs per day", () => {
    expect(allowedRuns(3, 38)).toBe(2);
    expect(allowedRuns(1, 40)).toBe(0);
  });
  it("defaults to US proxy with recording off", () => {
    expect(runOptions().browserSettings).toEqual({ proxyCountryCode: "us", record: false });
  });
  it("uses bu-4.0 for thorough runs", () => expect(runOptions("thorough").model).toBe("bu-4.0"));
});
