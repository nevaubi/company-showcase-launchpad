import { describe, expect, it } from "vitest";
import { soleBankCertificate, sourceCollectionForSector } from "./links";

describe("source explorer context links", () => {
  it("links a company bank view only through one explicit stored institution certificate", () => {
    expect(
      soleBankCertificate([
        { dataset: "bank", meta: { cert: 628 } },
        { dataset: "bank", meta: { cert: 628 } },
      ]),
    ).toBe("628");
    expect(
      soleBankCertificate([
        { dataset: "bank", meta: { cert: 628 } },
        { dataset: "bank", meta: { cert: 3510 } },
      ]),
    ).toBeNull();
    expect(soleBankCertificate([{ dataset: "deposits", meta: { cert: 628 } }])).toBeNull();
    expect(
      soleBankCertificate([{ dataset: "bank", meta: { cert: "628 OR CERT:3510" } }]),
    ).toBeNull();
  });

  it("maps known sector scopes without guessing an industry or company relationship", () => {
    expect(sourceCollectionForSector("Financials")).toBe("01_financials");
    expect(sourceCollectionForSector("Information Technology")).toBe("02_technology");
    expect(sourceCollectionForSector("Communication Services")).toBe("10_communications");
    expect(sourceCollectionForSector("Regional Banks")).toBeNull();
  });
});
