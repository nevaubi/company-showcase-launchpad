import { describe, expect, it } from "vitest";
import { absSearch, closeDeal, familyOf, openDeal, selectFamily, selectQuery, selectSort } from "./url-state";

describe("address state", () => {
  it("reads invalid values as absent, so a hand-edited address never breaks the page", () => {
    expect(absSearch.parse({ family: "rmbs", deal: "12", sort: "x;drop", q: "a".repeat(81) })).toEqual({
      family: undefined,
      deal: undefined,
      sort: undefined,
      q: undefined,
    });
    expect(familyOf(absSearch.parse({}))).toBe("auto_loan");
  });
  it("accepts an issuer-keyed and a depositor-keyed deal id", () => {
    expect(absSearch.parse({ deal: "0002140699" }).deal).toBe("0002140699");
    expect(absSearch.parse({ deal: "0001234567:333-12345-01" }).deal).toBe("0001234567:333-12345-01");
  });
  it("drops the open deal and the sort on a family change, keeps the name filter", () => {
    expect(selectFamily("cmbs")).toEqual({ family: "cmbs", deal: undefined, sort: undefined });
    expect(selectFamily("auto_loan").family).toBeUndefined();
    expect(openDeal("0002140699", "auto_loan")).toEqual({ deal: "0002140699", family: undefined });
    expect(closeDeal()).toEqual({ deal: undefined });
    expect(selectSort("due60:desc", true)).toEqual({ sort: undefined });
    expect(selectQuery("  ")).toEqual({ q: undefined });
  });
});
