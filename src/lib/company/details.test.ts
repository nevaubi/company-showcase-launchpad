import { describe, expect, it } from "vitest";
import { aboutFields, aboutSubtitle, descriptionOrigin, needsDetails } from "./details";

const empty = { website: "", investorRelations: "", description: "", founded: 0 };
const full = { website: "https://a.example", investorRelations: "https://ir.a.example", description: "A makes things.", founded: 1976 };

describe("company details fallback", () => {
  it("asks only when a field is missing", () => {
    expect(needsDetails(full)).toBe(false);
    expect(needsDetails(empty)).toBe(true);
    expect(needsDetails({ ...full, investorRelations: "  " })).toBe(true);
  });

  it("fills each missing field from the details and keeps the profile's own", () => {
    // HCC as served (no fields) and its coverage details entry
    const hcc = aboutFields(empty, {
      website: "https://www.warriormetcoal.com",
      description: "Warrior Met Coal is a U.S.-listed metals & mining company headquartered in Brookwood, AL (SEC SIC 1220: Silver Ores).",
      origin: "sec",
    });
    expect(hcc).toEqual({
      website: "https://www.warriormetcoal.com",
      ir: null,
      founded: null,
      description: { text: expect.stringContaining("Warrior Met Coal"), origin: "sec" },
    });
    const mixed = aboutFields({ ...empty, website: "https://own.example", founded: 1985 }, { website: "https://other.example", ir: "https://ir.example", founded: 1990 });
    expect(mixed.website).toBe("https://own.example");
    expect(mixed.founded).toBe(1985);
    expect(mixed.ir).toBe("https://ir.example");
    expect(mixed.description).toBeNull();
    expect(aboutFields(full, { description: "Other text", origin: "wikipedia" }).description).toEqual({ text: "A makes things.", origin: "profile" });
    expect(aboutFields(empty, null)).toEqual({ website: null, ir: null, founded: null, description: null });
  });

  it("says Wikipedia only for a Wikipedia sentence", () => {
    const sec = "Digi International is a U.S.-listed communications equipment company headquartered in Hopkins, MN (SEC SIC 3576: Computer Communications Equipment).";
    expect(descriptionOrigin(sec, false)).toBe("sec");
    expect(descriptionOrigin("Pagaya Technologies is an Israeli-American financial technology company based in New York City.", false)).toBe("wikipedia");
    expect(descriptionOrigin(sec, true)).toBe("curated");
    expect(aboutSubtitle({ wikipedia: false, description: { text: sec, origin: "sec" } })).toBe("Summary built from SEC registration data · facts from SEC EDGAR");
    expect(aboutSubtitle({ wikipedia: false, description: { text: "x", origin: "wikipedia" } })).toMatch(/^Summary from Wikipedia/);
    expect(aboutSubtitle({ wikipedia: false, description: { text: "x", origin: "curated" } })).toBe("Facts from SEC EDGAR");
    expect(aboutSubtitle({ wikipedia: false, description: null })).toBe("Facts from SEC EDGAR");
  });
});
