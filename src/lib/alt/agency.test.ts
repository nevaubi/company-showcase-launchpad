import { describe, expect, it } from "vitest";
import { shortAgency } from "./agency";

describe("shortAgency", () => {
  it("shortens long agency names wherever they stand, in any case", () => {
    expect(shortAgency("National Aeronautics and Space Administration: ORION PRODUCTION")).toBe("NASA: ORION PRODUCTION");
    expect(shortAgency("2026-10-29 · NATIONAL AERONAUTICS AND SPACE ADMINISTRATION")).toBe("2026-10-29 · NASA");
    expect(shortAgency("Department of the Navy: F-35 sustainment")).toBe("Navy: F-35 sustainment");
    expect(shortAgency("National Oceanic and Atmospheric Administration: GOES-U")).toBe("NOAA: GOES-U");
  });
  it("leaves other text alone", () => {
    expect(shortAgency("U.S. Coast Guard: ENGINE NACELLES")).toBe("U.S. Coast Guard: ENGINE NACELLES");
  });
});
