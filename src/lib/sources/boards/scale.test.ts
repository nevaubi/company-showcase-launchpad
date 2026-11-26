import { describe, expect, it } from "vitest";
import { parseDecimal, type Decimal } from "./decimal";
import { SCALE_UNITS, axisLabel, readerFigure, scaleUnitOf } from "./scale";
import { isClassicSpec } from "./compute";
import { TILES } from "./specs";

const d = (text: string): Decimal => {
  const value = parseDecimal(text);
  if (!value) throw new Error(text);
  return value;
};
const read = (unit: string, stored: string) => {
  const r = readerFigure(unit, d(stored), `<${stored}>`);
  if (!r) throw new Error(`${unit} is not on the whitelist`);
  return r;
};
const FDIC = "USD thousands (monetary measures)";

/** Every expected text below was also computed with Python's Decimal (ROUND_HALF_UP is half away from zero). */
describe("whitelist entries on the figures the tiles print", () => {
  it("USD thousands (monetary measures): FDIC industry and bank figures in dollars", () => {
    expect(read(FDIC, "24067204474")).toEqual({
      figure: "$24.07 trillion",
      unit: "",
      filed: `<24067204474> ${FDIC} as filed`,
      axis: { title: "USD trillions", shift: 9, divisor: 1e9, decimals: 2 },
    });
    expect(read(FDIC, "282555198")).toMatchObject({ figure: "$282.6 billion", axis: { title: "USD billions", shift: 6, decimals: 1 } });
    const leader = read(FDIC, "4174631000");
    expect(leader).toMatchObject({ figure: "$4.175 trillion", axis: { title: "USD trillions", decimals: 3 } });
    // every bar of the ranking is written with the leader's places, in trillions
    expect(["2657391000", "2018870000", "430132000"].map((v) => axisLabel(d(v), leader.axis))).toEqual(["2.657", "2.019", "0.430"]);
    expect(read(FDIC, "2901316000").figure).toBe("$2.901 trillion");
  });

  it("Millions of Dollars: FRED copies of Census sales and orders", () => {
    expect(read("Millions of Dollars", "748220")).toMatchObject({
      figure: "$748.2 billion",
      unit: "",
      axis: { title: "Billions of Dollars", shift: 3, divisor: 1000, decimals: 1 },
    });
    expect(read("Millions of Dollars", "345672").figure).toBe("$345.7 billion");
  });

  it("Thousands of Units: housing starts", () => {
    expect(read("Thousands of Units", "1309")).toMatchObject({
      figure: "1.309 million",
      unit: "units",
      axis: { title: "Millions of Units", shift: 3, divisor: 1000, decimals: 3 },
    });
  });

  it("Thousand Barrels per Day: crude oil production", () => {
    const r = read("Thousand Barrels per Day", "13761");
    expect(r).toMatchObject({ figure: "13.76 million", unit: "barrels per day", axis: { title: "Million Barrels per Day", decimals: 2 } });
    expect(r.filed).toBe("<13761> Thousand Barrels per Day as filed");
  });

  it("Thousands of Persons: manufacturing employment", () => {
    expect(read("Thousands of Persons", "12681")).toMatchObject({
      figure: "12.68 million",
      unit: "persons",
      axis: { title: "Millions of Persons", decimals: 2 },
    });
  });

  it("holds only units that a level or a ranking tile uses", () => {
    const used = new Set(TILES.flatMap((t) => (isClassicSpec(t) && (t.transform === "level" || t.transform === "rank") ? [t.unit] : [])));
    for (const entry of SCALE_UNITS) expect(used.has(entry.unit), entry.unit).toBe(true);
  });
});

describe("rounding at the edges", () => {
  it("rounds the fourth significant figure half away from zero, both signs", () => {
    expect(read(FDIC, "1234500").figure).toBe("$1.235 billion");
    expect(read(FDIC, "1234499").figure).toBe("$1.234 billion");
    expect(read(FDIC, "-1234500").figure).toBe("−$1.235 billion");
    expect(read("Thousands of Units", "-1309").figure).toBe("−1.309 million");
  });

  it("keeps four figures when a carry adds a digit", () => {
    expect(read("Thousand Barrels per Day", "9999.5").figure).toBe("10.00 million");
    expect(read("Thousand Barrels per Day", "99995").figure).toBe("100.0 million");
  });

  it("moves one scale up when the rounding reaches a thousand of the scale", () => {
    expect(read(FDIC, "999950")).toMatchObject({ figure: "$1.000 billion", axis: { title: "USD billions", decimals: 3 } });
    expect(read(FDIC, "999949")).toMatchObject({ figure: "$999.9 million", axis: { title: "USD millions", decimals: 1 } });
    // there is no scale above trillions: four figures, all before the point
    expect(read(FDIC, "999999500000").figure).toBe("$1,000 trillion");
  });

  it("starts a scale at exactly one of it, and writes a figure under a million in full", () => {
    expect(read("Thousands of Units", "1000").figure).toBe("1.000 million");
    const under = read("Thousands of Units", "999");
    expect(under).toMatchObject({ figure: "999,000", unit: "units", axis: { title: "Units", shift: -3, decimals: 0 } });
    expect(axisLabel(d("950"), under.axis)).toBe("950,000");
    expect(read("Thousand Barrels per Day", "999.9996").figure).toBe("999,999.6");
    expect(read(FDIC, "0").figure).toBe("$0");
  });

  it("writes a negative bar on a reader-scale axis with a true minus sign", () => {
    const income = read(FDIC, "282555198");
    expect(axisLabel(d("-11619811"), income.axis)).toBe("−11.6");
  });
});

describe("units off the whitelist stay as filed", () => {
  it("matches the stored unit exactly", () => {
    for (const unit of ["Millions of Units", "Billion Kilowatthours", "Quadrillion Btu", "Percent", "Number", "Dollars", "USD thousands", "usd thousands (monetary measures)"])
      expect(readerFigure(unit, d("13761"), "13,761")).toBeNull();
    expect(scaleUnitOf(FDIC)?.exponent).toBe(3);
  });
});
