import { describe, expect, it } from "vitest";
import { countryExposure, regionShock } from "./analytics";
import type { ProLink } from "./core";
import { countryOf, placeKind } from "./place-kind";

const link = (regions: string[], quote: string, p: Partial<ProLink> = {}): ProLink => ({
  id: Math.random().toString(36).slice(2), ticker: "X", counterparty: "Acme Corp", counterparty_ticker: null, counterparty_domain: null,
  relation: "supplier", detail: "", share_pct: null, quote, accn: "a", doc: "d", form: "10-K", filed: "2026-01-01", regions, ...p,
});

/* The region names production links carry most often (current links, 24 Nov 2026): Texas 96, California 70, Ohio 34,
   New York 27, Arizona 26, Georgia 23, Puerto Rico 16; Europe 183, Asia 62, Middle East 49. */
describe("region kinds (supply-globe-M5)", () => {
  it("U.S. states and territories count toward the United States", () => {
    for (const s of ["Texas", "California", "Ohio", "New York", "Arizona", "Puerto Rico", "Washington", "New Mexico"]) expect(countryOf(s), s).toBe("United States");
    expect(placeKind("New Mexico")).toEqual({ kind: "state", state: "New Mexico", country: "United States" });
  });
  it("supranational regions are their own kind and never a country", () => {
    for (const r of ["Europe", "Asia", "Middle East", "the Middle East", "Asia Pacific", "EMEA", "Latin America", "Europe region"]) {
      expect(placeKind(r)?.kind, r).toBe("region");
      expect(countryOf(r), r).toBeNull();
    }
  });
  it("Georgia is decided from the row's sentence, and is not a country when the sentence cannot tell", () => {
    expect(countryOf("Georgia", "our manufacturing plant in Savannah, Georgia")).toBe("United States");
    expect(countryOf("Georgia", "facilities in the state of Georgia")).toBe("United States");
    expect(countryOf("Georgia", "a pipeline through Tbilisi")).toBe("Georgia");
    expect(placeKind("Georgia", "operations in Georgia")?.kind).toBe("unknown");
    expect(countryOf("Georgia", "operations in Georgia")).toBeNull();
  });
  it("countries keep their canonical names", () => {
    expect(countryOf("Taiwan")).toBe("Taiwan");
    expect(countryOf("PRC")).toBe("China");
    expect(countryOf("Israel")).toBe("Israel");
  });

  it("the register's rows hold countries only", () => {
    const rows = countryExposure([
      link(["Texas", "California"], "We operate fabs in Austin, Texas and San Jose, California."),
      link(["Georgia"], "Our plant in Atlanta, Georgia supplies us."),
      link(["Georgia"], "We have operations in Georgia."),
      link(["Europe", "Asia", "Middle East"], "We sell across Europe, Asia and the Middle East."),
      link(["Taiwan"], "TSMC manufactures our wafers in Taiwan."),
    ], [], {}).map((r) => r.country);
    expect(rows).toContain("United States");
    expect(rows).toContain("Taiwan");
    for (const no of ["Texas", "California", "Georgia", "Europe", "Asia", "Middle East"]) expect(rows, no).not.toContain(no);
  });
  it("a United States row counts a link once even when it names two states", () => {
    const us = countryExposure([link(["Texas", "Ohio"], "Plants in Texas and Ohio.")], [], {}).find((r) => r.country === "United States");
    expect(us?.links).toBe(1);
  });
  it("a region shock on Georgia the country does not hit a company whose sentence is about the state", () => {
    const hits = regionShock("Georgia", [link(["Georgia"], "Our plant in Atlanta, Georgia supplies us.", { ticker: "AFL" })], [], {});
    expect(hits).toEqual([]);
  });
});
