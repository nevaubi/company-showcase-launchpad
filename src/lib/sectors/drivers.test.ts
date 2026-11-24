import { describe, expect, it } from "vitest";
import { MACRO_TILES } from "@/lib/coverage";
import { driversOf, pickDrivers } from "./drivers";

const SECTORS = ["Information Technology", "Financials", "Energy", "Health Care", "Consumer Discretionary", "Consumer Staples", "Industrials", "Utilities", "Materials", "Real Estate", "Communication Services"];

describe("macro drivers", () => {
  it("covers every sector on the overview within twelve series", () => {
    const picked = pickDrivers(MACRO_TILES, SECTORS, 12);
    expect(picked).toHaveLength(12);
    for (const s of SECTORS) expect(picked.some((d) => d.sectors?.includes(s)), s).toBe(true);
    expect(new Set(picked.map((d) => d.id)).size).toBe(12);
  });
  it("puts coverage before breadth", () => {
    const tiles = [
      { id: "wide1", title: "A", sectors: ["X", "Y"] },
      { id: "wide2", title: "B", sectors: ["X", "Y"] },
      { id: "narrow", title: "C", sectors: ["Z"] },
      { id: "untagged", title: "D" },
    ];
    expect(pickDrivers(tiles, ["X", "Y", "Z"], 2).map((d) => d.id)).toEqual(["wide1", "narrow"]);
    expect(pickDrivers(tiles, ["X", "Y", "Z"], 3).map((d) => d.id)).toEqual(["wide1", "wide2", "narrow"]);
    expect(pickDrivers(tiles, ["X", "Y", "Z"], 1).map((d) => d.id)).toEqual(["wide1", "narrow"]); // covering all three needs two
  });
  it("lists all of one sector's series on its page", () => {
    const it2 = driversOf(MACRO_TILES, "Information Technology");
    expect(it2.length).toBeGreaterThanOrEqual(2);
    expect(it2.every((d) => d.sectors!.includes("Information Technology"))).toBe(true);
    const tagged = MACRO_TILES.filter((d) => d.sectors?.length);
    for (const s of SECTORS) expect(driversOf(MACRO_TILES, s).length, s).toBe(tagged.filter((d) => d.sectors!.includes(s)).length);
    expect(driversOf(MACRO_TILES, "No Such Sector")).toEqual([]);
  });
});
