import { describe, expect, it } from "vitest";
import type { SourceIngest } from "./schema";
import { declaredDims, SHAPE_LABEL, shapeOf } from "./shape";

const dims = (entity: boolean, geography: boolean, period: boolean) => ({ entity, geography, period });

describe("shapeOf", () => {
  it("calls a table with entities a panel, places without entities by place, a period alone a series", () => {
    // FDIC bank-quarter panel: certificate and report date.
    expect(shapeOf({ dims: dims(true, true, true), rows: 51_453, entities: 500, periods: 106 })).toBe("panel");
    // EIA plants by state: entity and place, no period.
    expect(shapeOf({ dims: dims(true, true, false), rows: 12_000 })).toBe("panel");
    // FHFA house prices by state and quarter.
    expect(shapeOf({ dims: dims(false, true, true), rows: 9_000, geographies: 51 })).toBe("places");
    // A FRED series: observation date only.
    expect(shapeOf({ dims: dims(false, false, true), rows: 3_000, periods: 3_000 })).toBe("series");
    // Source atlas lists: nothing declared.
    expect(shapeOf({ dims: dims(false, false, false), rows: 40 })).toBe("table");
  });

  it("does not count a dimension that a count shows holds one value", () => {
    expect(shapeOf({ dims: dims(true, false, true), rows: 106, entities: 1, periods: 106 })).toBe("series");
    expect(shapeOf({ dims: dims(true, true, true), rows: 1, entities: 1, geographies: 1, periods: 1 })).toBe("table");
    expect(shapeOf({ dims: dims(false, true, false), rows: 50, geographies: 50 })).toBe("places");
  });

  it("treats an uncounted dimension as varying: absent or null is not zero", () => {
    expect(shapeOf({ dims: dims(true, false, false), rows: 10, entities: null })).toBe("panel");
    expect(shapeOf({ dims: dims(false, false, true), rows: 10 })).toBe("series");
  });

  it("calls an empty snapshot a table whatever it declares", () => {
    expect(shapeOf({ dims: dims(true, true, true), rows: 0 })).toBe("table");
    expect(shapeOf({ dims: dims(true, true, true), rows: Number.NaN })).toBe("table");
  });
});

describe("declaredDims", () => {
  it("reads the dimensions a snapshot fills from its own fields", () => {
    expect(declaredDims({ dimensions: { entity_id: 0, period: 1, entity_name: 4, geo_code: 5 } })).toEqual(dims(true, true, true));
    expect(declaredDims({ dimensions: { geo_name: 2 } })).toEqual(dims(false, true, false));
    expect(declaredDims({ dimensions: {}, composites: { period: { indices: [0, 1], separator: "-", format: "year_month" } } })).toEqual(dims(false, false, true));
  });

  it("does not count a position of zero as missing, nor a constant as a dimension", () => {
    expect(declaredDims({ dimensions: { period: 0 } }).period).toBe(true);
    const constant: SourceIngest = {
      format: "csv",
      encoding: "utf-8",
      delimiter: ",",
      header_rows: 1,
      dimensions: {},
      constants: { period: "2026", source_url: "https://www.eia.gov/" },
    };
    expect(declaredDims(constant)).toEqual(dims(false, false, false));
    expect(declaredDims(null)).toEqual(dims(false, false, false));
    expect(declaredDims(undefined)).toEqual(dims(false, false, false));
  });
});

describe("SHAPE_LABEL", () => {
  it("names each shape as the library's shape filter does", () => {
    expect(SHAPE_LABEL).toEqual({ series: "Series", panel: "Panels", places: "By place", table: "Reference" });
  });
});
