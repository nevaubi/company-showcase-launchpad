import { describe, expect, it } from "vitest";
import { GRID_PLACES } from "@/lib/sources/geo/us-states";
import type { RankCellInput, TileContext } from "@/lib/sources/boards/compute";
import { computeMapTile } from "@/lib/sources/boards/compute-forms";
import type { MapTileSpec, TileResult } from "@/lib/sources/boards/types";
import { caveatLines, notDrawnLines } from "./caveats";

const spec: MapTileSpec = {
  id: "map",
  collection: "05_utilities",
  title: "Test",
  datasetId: "gen",
  measure: "capacity",
  subject: "nameplate capacity",
  unit: "MW",
  decimals: 1,
  form: "map",
  transform: "level",
  headline: "rank",
  entities: "states",
  across: { by: "geo_code", period: "latest" },
};
const context: TileContext = { datasetId: "gen", snapshotId: "snap-gen", field: "capacity", unit: { from: "fixed", text: "MW" }, format: "year", cadence: "year", grouping: "none" };
const cells = (keys: string[]): RankCellInput[] => keys.map((key, i) => ({ row: i + 1, key, name: null, period: "2025", text: String(10 + i) }));
const ok = (r: TileResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe("the sentences under a map", () => {
  const codes = GRID_PLACES.map((p) => p.code);

  it("say a record with a blank state has no state, never printing empty parentheses", () => {
    const r = ok(computeMapTile(spec, context, cells([...codes, ""]), null));
    expect(r.shape?.kind === "map" && r.shape.others).toEqual([""]);
    const lines = caveatLines(r);
    expect(lines).toContain("1 record has no state and is not drawn.");
    expect(lines.join(" ")).not.toContain("()");
    expect(lines.join(" ")).not.toContain("not a state");
  });

  it("name keys that are not a state, up to three, apart from blank ones", () => {
    expect(notDrawnLines(["US"])).toEqual(["1 record is not a state and not drawn (US)."]);
    expect(notDrawnLines(["", " ", "US", "Midwest", "South", "West"])).toEqual([
      "2 records have no state and are not drawn.",
      "4 records are not a state and not drawn (US, Midwest, South, …).",
    ]);
    expect(notDrawnLines([])).toEqual([]);
  });

  it("count the nation's own record through the map compute", () => {
    const r = ok(computeMapTile(spec, context, cells([...codes, "US"]), null));
    expect(caveatLines(r)).toContain("1 record is not a state and not drawn (US).");
  });
});
