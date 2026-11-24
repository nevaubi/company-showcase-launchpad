import { describe, expect, it } from "vitest";
import { sicDescription } from "./sic";

describe("sicDescription", () => {
  it("uses SEC's code list where its company data is wrong for the code", () => {
    // data.sec.gov submissions for CIK 1691303 (Warrior Met Coal): sic 1220, sicDescription "Silver Ores"
    expect(sicDescription("1220", "Silver Ores")).toBe("Bituminous Coal & Lignite Mining");
    expect(sicDescription(1220, "Silver Ores")).toBe("Bituminous Coal & Lignite Mining");
    expect(sicDescription("5051", "Wholesale-Metals Service Centers & of fices")).toBe("Wholesale-Metals Service Centers & Offices");
  });

  it("keeps the company data for every other code, and an empty text for none", () => {
    // Peabody (CIK 1064728): 1221 is right in the company data
    expect(sicDescription("1221", "Bituminous Coal & Lignite Surface Mining")).toBe("Bituminous Coal & Lignite Surface Mining");
    expect(sicDescription("3571", "Electronic Computers")).toBe("Electronic Computers");
    expect(sicDescription(null, null)).toBe("");
    expect(sicDescription("", undefined)).toBe("");
  });
});
