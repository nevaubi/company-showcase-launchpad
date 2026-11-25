import { describe, expect, it } from "vitest";
import { computeRankTile } from "@/lib/sources/boards/compute";
import { fdicCrossSection } from "@/lib/sources/boards/fixtures";
import { tileSpec } from "@/lib/sources/boards/specs";
import type { RankTileSpec } from "@/lib/sources/boards/types";
import { RANK_STACKED_ROW, estimateTextWidth, rankLayout } from "./ranked-layout";

const spec = tileSpec("largest-banks-assets") as RankTileSpec;
const result = computeRankTile(
  spec,
  {
    datasetId: spec.datasetId,
    snapshotId: "snapshot",
    field: spec.measure,
    unit: { from: "fixed", text: spec.unit },
    format: "yyyymmdd",
    cadence: "day",
    grouping: "none",
  },
  fdicCrossSection("ASSET"),
);
if (!result.ok) throw new Error(result.reason);
const names = result.points.map((p) => p.label);
const widest = (texts: string[], size: number) => Math.max(...texts.map((t) => estimateTextWidth(t, size)));
const labelWidth = widest(names, 11);
/** Values as a reader-scale axis prints them ("4.175"), and as stored ("4,174,631,000"). */
const short = widest(["4.175", "2.657", "0.430"], 10);
const stored = widest(result.points.map((p) => p.display), 10);

// A board tile's chart is its tile less 2 x 14px of padding.
const chartOf = (tile: number) => tile - 28;

describe("ranked bars: names beside the bars or above them", () => {
  it("puts the bank names above their bars at the landing's tile width and at 400 px", () => {
    expect(names).toContain("CAPITAL ONE NATIONAL ASSN");
    for (const tile of [380, 400]) {
      const layout = rankLayout({ width: chartOf(tile), labelWidth, valueWidth: short, count: names.length, height: 200 });
      expect(layout.kind).toBe("stacked");
      // the bar spans the whole chart and every row keeps room for a name line and its bar
      expect(layout.track).toBe(chartOf(tile));
      expect(layout.rowHeight).toBeGreaterThanOrEqual(RANK_STACKED_ROW);
      expect(layout.height).toBe(200);
    }
  });

  it("keeps a left column where every name fits whole and the bars keep half the width", () => {
    // two tiles in a row on a 1,152px board: about 570px a tile
    const layout = rankLayout({ width: chartOf(570), labelWidth, valueWidth: short, count: names.length, height: 200 });
    expect(layout.kind).toBe("column");
    if (layout.kind !== "column") return;
    expect(layout.labelWidth).toBe(Math.ceil(labelWidth));
    expect(layout.track).toBeGreaterThanOrEqual(chartOf(570) / 2);
    expect(layout.rowHeight).toBe(20);
  });

  it("drops the names above the bars when long values leave the bars less than half the width", () => {
    // at 440px the names fit in 40% of the width; short values leave the bars half of it, values in full do not
    expect(rankLayout({ width: 440, labelWidth, valueWidth: short, count: names.length, height: 200 }).kind).toBe("column");
    expect(rankLayout({ width: 440, labelWidth, valueWidth: stored, count: names.length, height: 200 }).kind).toBe("stacked");
  });

  it("keeps short names in a column even in a narrow tile", () => {
    const codes = widest(["TX", "CA", "NY", "FL", "IL"], 11);
    expect(rankLayout({ width: chartOf(380), labelWidth: codes, valueWidth: short, count: 5, height: 200 }).kind).toBe("column");
  });

  it("grows a stacked list taller than the chart rather than squeezing its rows", () => {
    const layout = rankLayout({ width: 300, labelWidth, valueWidth: short, count: 12, height: 200 });
    expect(layout).toMatchObject({ kind: "stacked", rowHeight: RANK_STACKED_ROW, height: 12 * RANK_STACKED_ROW });
  });

  it("estimates capitals wider than small letters", () => {
    expect(estimateTextWidth("ABC", 10)).toBeGreaterThan(estimateTextWidth("abc", 10));
    expect(estimateTextWidth("", 11)).toBe(0);
  });
});
