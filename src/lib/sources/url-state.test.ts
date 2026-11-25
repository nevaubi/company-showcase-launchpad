import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { altPageSearch, nativeSearchText, selectSource, sourceFilters } from "./url-state";

/** What a route's validator receives for an address typed by hand or by the assistant. */
const typed = (search: string) => altPageSearch.parse(defaultParseSearch(search));

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

  it("keeps a plainly typed numeric identifier through the router's own parser (rev-app M2, P2)", () => {
    expect(typed("?view=sources&source=fdic&entity=628&geography=48201&period=20260630&q=2026")).toEqual({
      view: "sources",
      source: "fdic",
      entity: "628",
      geography: "48201",
      period: "20260630",
      q: "2026",
    });
    expect(typed("?entity=%22628%22&geography=01001")).toMatchObject({ entity: "628", geography: "01001" });
  });

  it("refuses what the parser already changed instead of passing on a different value", () => {
    expect(typed("?period=1.50").period).toBeUndefined();
    expect(typed("?entity=12345678901234567890").entity).toBeUndefined();
    expect(typed("?entity=-0").entity).toBeUndefined();
    expect(typed("?entity=true").entity).toBeUndefined();
    expect(typed("?entity=-5").entity).toBe("-5");
  });

  it("round-trips the filters the app writes", () => {
    const search = { view: "sources" as const, source: "fdic", entity: "628", geography: "01001", period: "2025", after: 25 };
    expect(typed(defaultStringifySearch(search))).toEqual(search);
    expect(nativeSearchText(3).parse(1234)).toBeUndefined();
  });
});
