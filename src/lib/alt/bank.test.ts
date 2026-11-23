import { describe, expect, it } from "vitest";
import { isBankPlaceholder } from "./bank";

describe("FDIC zero placeholders", () => {
  it("treats a zero CET1 ratio as not reported (380 rows, 95 banks, all 2014 quarters in production)", () => {
    expect(isBankPlaceholder({ dataset: "bank", title: "CET1 ratio", value: 0, meta: { field: "RBCT1CER", cert: 628 } })).toBe(true);
    expect(isBankPlaceholder({ dataset: "bank", title: "CET1 ratio", value: 15.7, meta: { field: "RBCT1CER" } })).toBe(false);
  });
  it("keeps zeros that are real readings", () => {
    expect(isBankPlaceholder({ dataset: "bank", title: "Net charge-off rate", value: 0, meta: { field: "NTLNLSR" } })).toBe(false);
    expect(isBankPlaceholder({ dataset: "attention", title: "CET1 ratio", value: 0 })).toBe(false);
  });
});
