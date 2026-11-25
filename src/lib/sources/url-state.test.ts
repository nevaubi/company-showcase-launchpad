import { describe, expect, it } from "vitest";
import { altPageSearch, selectSource, sourceFilters } from "./url-state";

describe("source explorer address state", () => {
  it("keeps a native institution, county FIPS and period intact", () => {
    expect(
      altPageSearch.parse({
        view: "sources",
        source: "fdic-sod",
        entity: "628",
        geography: "01001",
        period: "2025",
        after: "25",
      }),
    ).toEqual({
      view: "sources",
      source: "fdic-sod",
      entity: "628",
      geography: "01001",
      period: "2025",
      after: 25,
    });
  });

  it("ignores malformed controls without losing a valid legacy dataset link", () => {
    expect(
      altPageSearch.parse({
        d: "bank",
        view: "other",
        after: -20,
        q: "x".repeat(201),
        entity: { name: "bank" },
      }),
    ).toEqual({
      d: "bank",
      view: undefined,
      after: undefined,
      q: undefined,
      entity: undefined,
    });
  });

  it("selecting another source clears identity, period and page from the old source", () => {
    expect(selectSource("epa-tri")).toEqual({
      view: "sources",
      source: "epa-tri",
      snapshot: undefined,
      entity: undefined,
      geography: undefined,
      period: undefined,
      q: undefined,
      after: undefined,
    });
  });

  it("changing a record filter always starts at the first page", () => {
    expect(sourceFilters({ geography: "01001" })).toEqual({ geography: "01001", after: undefined });
    expect(sourceFilters({ entity: undefined, period: "20260930" })).toEqual({
      entity: undefined,
      period: "20260930",
      after: undefined,
    });
  });
});
