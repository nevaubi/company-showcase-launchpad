import { describe, expect, it } from "vitest";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { columnsOf, datasetSearch, filterPatch, parseColumns, snapshotPatch } from "./dataset-search";

const HASH = "85dc5e2736d78fd89e96d884138fd63afef0263c94ddd073e57f40adff268915";
const viaRouter = (query: string) => datasetSearch.parse(defaultParseSearch(query));

describe("table page address", () => {
  it("keeps a numeric native identifier written plainly, as the router parses it (rev-app M2)", () => {
    expect(viaRouter("?entity=628&geography=48201&period=20260630")).toMatchObject({
      entity: "628",
      geography: "48201",
      period: "20260630",
    });
    expect(viaRouter('?entity=%22628%22')).toMatchObject({ entity: "628" });
    // a code with a leading zero is not JSON and stays as written
    expect(viaRouter("?geography=01001")).toMatchObject({ geography: "01001" });
  });

  it("refuses rather than alters values the router turned into something else", () => {
    // "1.50" parses to 1.5: the stored text cannot be recovered, so the filter is dropped
    expect(viaRouter("?period=1.50").period).toBeUndefined();
    expect(viaRouter("?entity=true").entity).toBeUndefined();
    expect(viaRouter("?entity=123456789012345678901").entity).toBeUndefined();
  });

  it("drops one bad key without losing the others", () => {
    const s = viaRouter(`?snapshot=nothex&entity=628&row=-3&after=x&order=up&cols=1,1&q=${"y".repeat(201)}`);
    expect(s).toEqual({
      snapshot: undefined,
      entity: "628",
      geography: undefined,
      period: undefined,
      q: undefined,
      order: undefined,
      after: undefined,
      before: undefined,
      cols: undefined,
      row: undefined,
      look: undefined,
    });
  });

  it("round-trips everything the page writes", () => {
    const written = {
      snapshot: HASH,
      entity: "628",
      order: "new" as const,
      after: 51200,
      cols: "0,3,17",
      row: 48517,
      look: { m: "ASSET", s: "628", v: "table" as const, r: "10y" as const },
    };
    const back = viaRouter(defaultStringifySearch(written));
    expect(back).toMatchObject(written);
    expect(columnsOf(back)).toEqual([0, 3, 17]);
  });

  it("reads field positions as a string, a single number or an array, and refuses repeats and long lists", () => {
    expect(parseColumns("0,3,17")).toEqual([0, 3, 17]);
    expect(parseColumns(5)).toEqual([5]);
    expect(parseColumns([2, 4])).toEqual([2, 4]);
    expect(parseColumns("1,1")).toBeUndefined();
    expect(parseColumns(Array.from({ length: 25 }, (_, i) => i))).toBeUndefined();
    expect(parseColumns("1,a")).toBeUndefined();
    expect(viaRouter("?cols=5").cols).toBe("5");
  });

  it("a filter starts at the first page; another snapshot drops rows, record and field choice", () => {
    expect(filterPatch({ period: "20260630" })).toEqual({ period: "20260630", after: undefined, before: undefined });
    expect(snapshotPatch(HASH)).toEqual({ snapshot: HASH, after: undefined, before: undefined, row: undefined, cols: undefined, look: undefined });
  });
});
