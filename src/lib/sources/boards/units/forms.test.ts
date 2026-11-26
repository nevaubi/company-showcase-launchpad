import { describe, expect, it } from "vitest";
import { FakeSourceDb } from "../../read.fake";
import { resetReadState } from "../../read.server";
import { readTiles, resetBoardCache } from "../board.server";
import { boardFixtureTables } from "../fixtures";
import { BOARDS, CORE_TILES } from "../specs";
import { SPECS } from "./forms";

/**
 * The forms tiles on the production rows of their fixture (latest snapshots of 26 Nov 2026, checksum-verified copy):
 * each headline as the board prints it. Every figure was also worked out by hand from the stored cells (forms report).
 */
const HEADLINES: [string, string, string][] = [
    ["dollar-major-currencies", "The euro was 1.0981 U.S. Dollars to One Euro on Nov 20, 2026.", "Nov 20, 2026"],
    ["dollar-broad-index", "The nominal broad U.S. dollar index was 123.5978 (Index Jan 2006=100) on Nov 20, 2026.", "Nov 20, 2026"],
    ["fed-funds-daily", "The effective federal funds rate was 3.88% on Nov 24, 2026.", "Nov 24, 2026"],
    ["treasury-curve", "The 30-year yield was 5.47% in Oct 2026, 1.42 percentage points above the 3-month bill rate.", "Oct 2026"],
    ["treasury-10y-2y", "The 10-year yield was 0.39 percentage points above the 2-year yield in Oct 2026.", "Oct 2026"],
    ["fed-total-assets", "The Federal Reserve's total assets were 6,741,452 Millions of U.S. Dollars on Nov 18, 2026.", "Nov 18, 2026"],
    ["financial-conditions", "The Chicago Fed National Financial Conditions Index was \u22120.444 (Index) in the week ending Nov 20, 2026.", "Nov 20, 2026"],
    ["continued-claims", "Continued claims for unemployment insurance were 1,697,000 in the week ending Nov 14, 2026, 12.7% below the week ending Nov 15, 2025.", "Nov 14, 2026"],
    ["cpi-headline-core", "The consumer price index for all items rose 3.7% over the 12 months to Sep 2026. No change for Oct 2026: Oct 2025 has no figure (empty in the source).", "Sep 2026"],
    ["industrial-production-capacity", "Industrial production was 102.2421 (Index 2022=100) in Oct 2026, 1.7% above Oct 2025.", "Oct 2026"],
    ["durable-industries-12m", "Fabricated metal production rose 1.8% over the 12 months to Oct 2026.", "Oct 2026"],
    ["capital-goods-orders", "New orders for nondefense capital goods excluding aircraft were 89,383 Millions of Dollars in Oct 2026, 14.7% above Oct 2025.", "Oct 2026"],
    ["shipments-inventories", "Manufacturers' shipments were 668,454 Millions of Dollars in Sep 2026, 10.2% above Sep 2025.", "Sep 2026"],
    ["rail-carloads", "Rail freight carloads were 990,805 Carloads in Aug 2026, 2.3% above Aug 2025.", "Aug 2026"],
    ["truck-tonnage", "The truck tonnage index was 112.8 (Index 2015=100) in Aug 2026, 1.6% below Aug 2025.", "Aug 2026"],
    ["vehicle-sales-mix", "Autos and light trucks were 96.8% of total vehicle sales in Oct 2026.", "Oct 2026"],
    ["retail-categories-12m", "Sales of motor vehicle and parts dealers rose 2.1% over the 12 months to Sep 2026.", "Sep 2026"],
    ["real-retail-sales-12m", "Real retail and food services sales rose 2.7% over the 12 months to Sep 2026. No change for Oct 2026: Oct 2025 has no figure (empty in the source).", "Sep 2026"],
    ["ecommerce-sales-4q", "E-commerce retail sales rose 10.4% over the four quarters to Q3 2026.", "Q3 2026"],
    ["pce-by-type", "Services were 68.8% of personal consumption expenditures in Oct 2026.", "Oct 2026"],
    ["leisure-hospitality-jobs", "Leisure and hospitality employment was 16,964 Thousands of Persons in Oct 2026, 0.1% above Oct 2025.", "Oct 2026"],
    ["food-at-home-away-12m", "The consumer price index for food at home rose 1.8% over the 12 months to Sep 2026. No change for Oct 2026: Oct 2025 has no figure (empty in the source).", "Sep 2026"],
    ["farm-food-prices-12m", "The producer price index for farm products rose 2.6% over the 12 months to Oct 2026.", "Oct 2026"],
    ["grocery-store-sales-12m", "Sales of food and beverage stores rose 1.2% over the 12 months to Sep 2026.", "Sep 2026"],
    ["food-beverage-production", "Food, beverage and tobacco production was 97.2870 (Index 2022=100) in Oct 2026, 0.4% below Oct 2025.", "Oct 2026"],
    ["food-manufacturing-jobs", "Food manufacturing employment was 1,771.0 Thousands of Persons in Oct 2026, 0.8% below Oct 2025.", "Oct 2026"],
    ["mortgage-30y-15y", "The 30-year fixed rate was 0.67 percentage points above the 15-year fixed rate in the week ending Nov 25, 2026.", "Nov 25, 2026"],
    ["housing-starts-permits", "Housing units authorized by building permits were 1,297 Thousands of Units in Oct 2026, 8.5% below Oct 2025.", "Oct 2026"],
    ["construction-spending-mix", "Nonresidential construction was 60.6% of total construction spending in Sep 2026.", "Sep 2026"],
    ["new-home-sales", "New one-family houses sold were 701 Thousands in Oct 2026, 7.5% above Oct 2025.", "Oct 2026"],
    ["vacancy-rates", "The rental vacancy rate was 7.6% in Q3 2026, 0.5 percentage points above Q3 2025.", "Q3 2026"],
    // production snapshot 5161b586, period 20260930: median (6,115,842 + 6,115,843) / 2 and the quartiles equal SQL on production
    [
      "fdic-cohort-assets",
      "The median total assets of 496 institutions in the FDIC cohort was 6,115,843 USD thousands (monetary measures) on Sep 30, 2026; the middle half were between 3,564,855 and 15,901,271.",
      "Sep 30, 2026",
    ],
];

describe("the forms tiles on production rows", () => {
  it("print the headline and period computed on production", async () => {
    resetBoardCache();
    resetReadState();
    const tables = boardFixtureTables();
    const b = await readTiles(new FakeSourceDb(tables), SPECS.tiles, Date.UTC(2026, 10, 26, 6), 1000);
    expect(b.refused).toEqual([]);
    const got = new Map(b.tiles.map((t) => [t.id, t] as const));
    for (const [id, headline, asOf] of HEADLINES) {
      const t = got.get(id);
      expect(t?.result.ok && t.result.headline, id).toBe(headline);
      expect(t?.result.ok && t.result.asOf, id).toBe(asOf);
    }
    expect(HEADLINES).toHaveLength(SPECS.tiles.length);
  });

  it("draw the FDIC cohort in the bins counted on production", async () => {
    resetBoardCache();
    resetReadState();
    const spec = SPECS.tiles.find((t) => t.id === "fdic-cohort-assets")!;
    const b = await readTiles(new FakeSourceDb(boardFixtureTables()), [spec], Date.UTC(2026, 10, 26, 6), 1000);
    const r = b.tiles[0]?.result;
    if (!r?.ok || r.shape?.kind !== "distribution") throw new Error("no distribution");
    expect(r.shape.bins?.map((x) => [x.label, x.count])).toEqual([
      ["1,000,000 to 3,000,000", 57],
      ["3,000,000 to 10,000,000", 278],
      ["10,000,000 to 30,000,000", 90],
      ["30,000,000 to 100,000,000", 38],
      ["100,000,000 to 300,000,000", 19],
      ["300,000,000 and above", 14],
    ]);
  });

  it("fill the landing board with the core tiles and seven of forms, across six collections, no series twice", () => {
    const landing = BOARDS.find((x) => x.id === "library")!;
    const own = SPECS.boardTiles.library;
    expect(own).toHaveLength(7);
    const coreAndOwn = landing.tiles.filter((t) => !SPECS.tiles.some((s) => s.id === t) || own.includes(t));
    expect(coreAndOwn.length).toBeGreaterThanOrEqual(16);
    const specs = coreAndOwn.map((id) => SPECS.tiles.find((s) => s.id === id) ?? CORE_TILES.find((s) => s.id === id)!);
    expect(new Set(specs.map((s) => s.collection)).size).toBeGreaterThanOrEqual(6);
    // the core's 30-year mortgage line is there, so the 30- and 15-year comparison is not
    expect(landing.tiles).toContain("mortgage-rate-30y");
    expect(landing.tiles).not.toContain("mortgage-30y-15y");
  });

  it("hold at least 30 tiles, each on a board, no collection board over 18 tiles", () => {
    expect(SPECS.tiles.length).toBeGreaterThanOrEqual(30);
    const listed = new Set(Object.values(SPECS.boardTiles).flat());
    for (const t of SPECS.tiles) expect(listed.has(t.id), t.id).toBe(true);
    for (const b of BOARDS.filter((x) => x.id !== "library")) expect(b.tiles.length, b.id).toBeLessThanOrEqual(18);
  });
});
