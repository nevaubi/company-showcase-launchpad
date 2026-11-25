import { describe, expect, it } from "vitest";
import { ALT_SECTIONS, altSectionFor } from "./sections";

describe("Alt data sections", () => {
  it("names the three parts in reading order", () => {
    expect(ALT_SECTIONS.map((s) => s.label)).toEqual(["Company signals", "Data library", "Securitized credit"]);
  });

  it("keeps Company signals to the hub page itself", () => {
    expect(altSectionFor("/app/alt-data")).toBe("signals");
    expect(altSectionFor("/app/alt-data/")).toBe("signals");
    expect(altSectionFor("/app/alt-data?d=bank")).toBe("signals");
  });

  it("keeps the Data library active on collection and table pages", () => {
    expect(altSectionFor("/app/alt-data/library")).toBe("library");
    expect(altSectionFor("/app/alt-data/library/c/financials")).toBe("library");
    expect(altSectionFor("/app/alt-data/library/d/official_01_financials_x")).toBe("library");
  });

  it("gives Securitized credit its own subtree", () => {
    expect(altSectionFor("/app/alt-data/credit")).toBe("credit");
    expect(altSectionFor("/app/alt-data/credit/deal")).toBe("credit");
  });

  it("claims no address outside the section", () => {
    expect(altSectionFor("/app/alt-data-x")).toBeNull();
    expect(altSectionFor("/app/alt-data/libraryx")).toBeNull();
    expect(altSectionFor("/app/companies/JPM/alt-data")).toBeNull();
    expect(altSectionFor("/app")).toBeNull();
  });
});
