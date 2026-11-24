import { describe, expect, it } from "vitest";
import { shortCompany } from "./short-name";

describe("short company names", () => {
  it("drops SEC state tags and legal forms", () => {
    expect(shortCompany("Columbia Financial, Inc./MD/")).toBe("Columbia Financial");
    expect(shortCompany("Horace Mann Educators Corp /De/")).toBe("Horace Mann Educators");
    expect(shortCompany("Dime Commercial Bancshares, Inc. /NY/")).toBe("Dime Comm. Bancsh.");
  });
  it("abbreviates long words only while the name is too long, in a fixed order", () => {
    expect(shortCompany("Western Alliance Bancorporation")).toBe("Western Alliance Bancorp");
    expect(shortCompany("Fidelity National Information Services")).toBe("Fidelity National Info. Svcs.");
    expect(shortCompany("Artisan Partners Asset Management")).toBe("Artisan Partners Asset Mgmt.");
    expect(shortCompany("Skyward Specialty Insurance Group")).toBe("Skyward Specialty Ins.");
    expect(shortCompany("Stewart Information Services")).toBe("Stewart Info. Svcs.");
    // Short names are left alone.
    expect(shortCompany("JPMorgan Chase")).toBe("JPMorgan Chase");
    expect(shortCompany("Enterprise Financial Services")).toBe("Enterprise Fin. Svcs.");
  });
  it("never returns an empty name", () => {
    expect(shortCompany("Inc.")).toBe("Inc.");
    expect(shortCompany("  ")).toBe("");
  });
});
