import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb } from "../../read.fake";
import { resetReadState } from "../../read.server";
import { readTiles, resetBoardCache } from "../board.server";
import { boardFixtureTables, facetsAnswer } from "../fixtures";
import type { Board, TileSpec } from "../types";
import { SPECS } from "./industry";

/** The industry tiles computed through the real read layer on production rows (`industry.fixtures.json`). */

function db(): FakeSourceDb {
  const tables = boardFixtureTables();
  const fake = new FakeSourceDb(tables);
  fake.rpcAnswer = facetsAnswer(tables);
  return fake;
}

async function all(specs: readonly TileSpec[]): Promise<Board> {
  const now = Date.UTC(2026, 10, 26, 6);
  const out: Board = { id: "tiles", title: "", tiles: [], refused: [], computedAt: "" };
  let left = [...specs];
  const fake = db();
  for (let round = 0; round < 12 && left.length; round += 1) {
    const b = await readTiles(fake, left, now);
    out.tiles.push(...b.tiles);
    out.refused.push(...b.refused);
    left = specs.filter((s) => b.deferred?.includes(s.id));
  }
  return out;
}

beforeEach(() => {
  resetBoardCache();
  resetReadState();
});

/**
 * Figure, unit, period and snapshot of every industry tile, computed on production rows (26 Nov 2026) and equal to the
 * figures the unit's report lists from its own SQL on production and the publishers' files.
 */
const EXPECTED: Record<string, { figure: string; unit: string; asOf: string; snapshot: string }> = {
  "copper-production": { figure: "874,000", unit: "metric tons (t) copper content", asOf: "2020", snapshot: "09591238" },
  "lithium-world-production": { figure: "107,000", unit: "metric tons (t) lithium content", asOf: "2021", snapshot: "7c63bbbe" },
  "rare-earths-us": { figure: "39,000", unit: "metric tons (t) rare-earth oxide equivalent", asOf: "2020", snapshot: "0d3d8b45" },
  "gold-unit-value": { figure: "57,900,000", unit: "$/t", asOf: "2022", snapshot: "f68a5bd9" },
  "aluminum-production": { figure: "889,000", unit: "metric tons (t) aluminum content", asOf: "2021", snapshot: "481e276b" },
  "iron-ore-production": { figure: "47,500,000", unit: "metric tons (t) gross weight", asOf: "2021", snapshot: "4734116c" },
  "raw-steel-production": { figure: "85,800,000", unit: "metric tons (t)", asOf: "2021", snapshot: "32a36e1d" },
  "cement-production": { figure: "91,000,000", unit: "metric tons (t) gross weight", asOf: "2021", snapshot: "c0328de9" },
  "crushed-stone-sand-gravel-production": { figure: "1,550,000,000", unit: "metric tons (t) gross weight", asOf: "2022", snapshot: "e3bbcd67" },
  "helium-production": { figure: "11,100", unit: "metric tons (t) helium content", asOf: "2022", snapshot: "9122dcfa" },
  "active-surface-mines-map": { figure: "585", unit: "mine register records", asOf: "Retrieved 24 Nov 2026", snapshot: "fd028ec4" },
  "mines-on-register-map": { figure: "12,391", unit: "records", asOf: "Retrieved 24 Nov 2026", snapshot: "d7875fa7" },
  "mines-ever-registered": { figure: "92,129", unit: "records", asOf: "Retrieved 24 Nov 2026", snapshot: "7839cda8" },
  "pit-hours-map": { figure: "22,636,180", unit: "employee-hours", asOf: "2025", snapshot: "4509b721" },
  "mill-employees-map": { figure: "5,094", unit: "average employees", asOf: "2025", snapshot: "4509b721" },
  "recall-campaigns-by-year": { figure: "821", unit: "recall campaigns", asOf: "2026", snapshot: "0c2d9cb4" },
  "recall-campaigns-detroit": { figure: "89", unit: "recall campaigns", asOf: "2026", snapshot: "2f9f33ec" },
  "recall-campaigns-imports": { figure: "16", unit: "recall campaigns", asOf: "2026", snapshot: "2f9f33ec" },
  "food-at-home-vs-away": { figure: "2.3", unit: "%", asOf: "2025", snapshot: "c4a37688" },
  "eggs-cpi-annual": { figure: "21.9", unit: "%", asOf: "2025", snapshot: "c4a37688" },
  "beef-cpi-annual": { figure: "11.6", unit: "%", asOf: "2025", snapshot: "c4a37688" },
  "cattle-and-beef-ppi": { figure: "20.9", unit: "%", asOf: "2025", snapshot: "7cfee944" },
  "all-food-forecast-2026": { figure: "2.8", unit: "%", asOf: "Oct 2026", snapshot: "a78b0673" },
  "food-at-home-forecast-2026": { figure: "2.3", unit: "%", asOf: "Oct 2026", snapshot: "a78b0673" },
  "copper-aluminum-real-value": { figure: "3,980", unit: "98$/t", asOf: "2020", snapshot: "09591238" },
  "pit-hours-change-map": { figure: "+768,353", unit: "employee-hours", asOf: "2025", snapshot: "4509b721" },
  "recall-campaigns-other-makers": { figure: "30", unit: "recall campaigns", asOf: "2026", snapshot: "2f9f33ec" },
  "recall-campaigns-rv-makers": { figure: "31", unit: "recall campaigns", asOf: "2026", snapshot: "2f9f33ec" },
  "recall-campaigns-truck-makers": { figure: "22", unit: "recall campaigns", asOf: "2026", snapshot: "2f9f33ec" },
  "sugar-cpi-annual": { figure: "5.1", unit: "%", asOf: "2025", snapshot: "c4a37688" },
  "beverages-cpi-annual": { figure: "3.8", unit: "%", asOf: "2025", snapshot: "c4a37688" },
  "eggs-farm-and-retail": { figure: "31.6", unit: "%", asOf: "2025", snapshot: "7cfee944" },
  "wheat-farm-to-retail": { figure: "\u221210.9", unit: "%", asOf: "2025", snapshot: "7cfee944" },
};

describe("industry tiles on production rows", () => {
  it("computes every tile, none refused, each figure equal to the figure checked on production", async () => {
    const b = await all(SPECS.tiles);
    expect(b.refused).toEqual([]);
    expect(new Set(b.tiles.map((t) => t.id))).toEqual(new Set(SPECS.tiles.map((t) => t.id)));
    expect(Object.keys(EXPECTED).sort()).toEqual(SPECS.tiles.map((t) => t.id).sort());
    for (const t of b.tiles) {
      const want = EXPECTED[t.id];
      expect(t.result.ok, t.id).toBe(true);
      if (!t.result.ok) continue;
      expect({ figure: t.result.figure, unit: t.result.figureUnit, asOf: t.result.asOf, snapshot: (t.source.snapshotId ?? "").slice(0, 8) }, t.id).toEqual(want);
      expect(t.result.headline, t.id).not.toMatch(/\u2014/);
    }
  });

  it("says each headline in the tile's own figures", async () => {
    const b = await all(SPECS.tiles);
    const said = (id: string) => {
      const t = b.tiles.find((x) => x.id === id);
      return t && t.result.ok ? t.result.headline : "";
    };
    expect(said("copper-production")).toBe("U.S. primary copper production was 874,000 metric tons (t) copper content in 2020, 11.3% below 2019.");
    expect(said("gold-unit-value")).toBe("The unit value of gold was 57,900,000 $/t in 2022, unchanged from 2021.");
    expect(said("pit-hours-map")).toContain("Texas had the highest employee hours at strip, quarry and open-pit operations of 55 states and territories in 2025, 22,636,180 employee-hours");
    expect(said("mines-on-register-map")).toContain("12,391 records as retrieved on 24 Nov 2026; Texas has the most, 918");
    expect(said("mines-ever-registered")).toContain("92,129 records as retrieved on 24 Nov 2026; Kentucky has the most, 14,084");
    expect(said("eggs-cpi-annual")).toBe("The annual change in the CPI for eggs was 21.9% in 2025, 13.4 percentage points above 2024.");
    expect(said("all-food-forecast-2026")).toBe("The midpoint of ERS's forecast for all food in 2026 was 2.8% in Oct 2026.");
    expect(said("copper-aluminum-real-value")).toBe("The unit value of copper in constant 1998 dollars was 3,980 98$/t in 2020, 1.3% above 2019.");
    expect(said("pit-hours-change-map")).toContain("Alaska had the largest change in employee hours at strip, quarry and open-pit operations of 54 states and territories over the year to 2025, +768,353 employee-hours; Nevada");
    expect(said("eggs-farm-and-retail")).toBe("The annual change in the PPI for farm-level eggs was 31.6% in 2025, 11.5 percentage points below 2024.");
  });
});
