import { describe, expect, it } from "vitest";
import { GRID_COLUMNS, GRID_PLACES, GRID_ROWS, TERRITORIES, US_PLACES, isNationalKey, placeByKey, placeOf, stateKeyKind } from "./us-states";

describe("US places", () => {
  it("hold the 50 states and DC on the grid, five territories off it, every code, FIPS code and square once", () => {
    expect(GRID_PLACES).toHaveLength(51);
    expect(GRID_PLACES.filter((p) => p.kind === "state")).toHaveLength(50);
    expect(GRID_PLACES.find((p) => p.code === "DC")?.kind).toBe("district");
    expect(TERRITORIES.map((p) => p.code)).toEqual(["PR", "GU", "VI", "AS", "MP"]);
    expect(new Set(US_PLACES.map((p) => p.code)).size).toBe(US_PLACES.length);
    expect(new Set(US_PLACES.map((p) => p.fips)).size).toBe(US_PLACES.length);
    const squares = GRID_PLACES.map((p) => `${p.grid!.row}:${p.grid!.col}`);
    expect(new Set(squares).size).toBe(51);
    for (const p of GRID_PLACES) {
      expect(p.grid!.row).toBeGreaterThanOrEqual(0);
      expect(p.grid!.row).toBeLessThan(GRID_ROWS);
      expect(p.grid!.col).toBeGreaterThanOrEqual(0);
      expect(p.grid!.col).toBeLessThan(GRID_COLUMNS);
    }
  });

  it("carry the Census Bureau's FIPS state codes", () => {
    const fips = Object.fromEntries(US_PLACES.map((p) => [p.code, p.fips]));
    expect(fips).toMatchObject({ AL: "01", AK: "02", AZ: "04", CA: "06", CT: "09", DC: "11", FL: "12", HI: "15", NY: "36", TX: "48", WY: "56", PR: "72", GU: "66", VI: "78", AS: "60", MP: "69" });
  });

  it("match a key only by a whole postal code, two-digit FIPS code or name", () => {
    expect(placeByKey("CA", "postal")?.name).toBe("California");
    expect(placeByKey("ca", "postal")).toBeNull();
    expect(placeByKey("06", "fips")?.code).toBe("CA");
    expect(placeByKey("6", "fips")).toBeNull();
    expect(placeByKey(" new york ", "name")?.code).toBe("NY");
    expect(placeByKey("New York City", "name")).toBeNull();
    expect(placeOf("District of Columbia")?.code).toBe("DC");
    expect(placeOf("Calif.")).toBeNull();
    expect(placeOf(null)).toBeNull();
  });

  it("know the national totals, which are not a state", () => {
    for (const k of ["US", "USA", "United States", "00", "u.s."]) expect(isNationalKey(k)).toBe(true);
    expect(isNationalKey("CA")).toBe(false);
    expect(placeOf("US")).toBeNull();
  });
});

describe("a dimension read as states", () => {
  const codes = GRID_PLACES.map((p) => p.code);
  it("needs one rule for every key but the national total", () => {
    expect(stateKeyKind([...codes, "US"])).toBe("postal");
    expect(stateKeyKind(GRID_PLACES.map((p) => p.fips))).toBe("fips");
    expect(stateKeyKind([...GRID_PLACES.map((p) => p.name.toUpperCase()), "United States"])).toBe("name");
    expect(stateKeyKind([...codes, "PR", "GU"])).toBe("postal");
  });

  it("refuses mixed rules, other places, repeats and short lists", () => {
    expect(stateKeyKind([...codes.slice(0, 20), "06"])).toBeNull();
    expect(stateKeyKind([...codes, "Northeast"])).toBeNull();
    // census divisions numbered 01 to 09: 03 and 07 are no state's code
    expect(stateKeyKind(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"])).toBeNull();
    expect(stateKeyKind(["CA", "TX", "NY"])).toBeNull();
    expect(stateKeyKind(["CA", "California", "TX", "NY", "FL", "WA", "OR", "NV", "AZ", "UT", "ID"])).toBeNull();
    // two spellings of one state's name are one state twice
    expect(stateKeyKind([...GRID_PLACES.slice(0, 12).map((p) => p.name), "NEW YORK", "New York"])).toBeNull();
  });
});
