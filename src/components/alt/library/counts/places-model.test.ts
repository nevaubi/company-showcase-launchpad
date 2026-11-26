import { describe, expect, it } from "vitest";
import type { SourceFacetValue } from "@/lib/sources/read-types";
import { placeBars, readStates, stateBars, stateCaption, type StateLookup } from "./places-model";

// a part of the postal table, enough for the rule (the app's table is the forms unit's)
const TABLE: [string, string][] = [
  ["AK", "Alaska"], ["AL", "Alabama"], ["AR", "Arkansas"], ["AZ", "Arizona"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["FL", "Florida"], ["GA", "Georgia"], ["GU", "Guam"], ["PR", "Puerto Rico"],
  ["TX", "Texas"], ["WY", "Wyoming"],
];
const lookup: StateLookup = (value) => {
  const hit = TABLE.find(([code, name]) => code === value || name.toLowerCase() === value.toLowerCase());
  return hit ? { code: hit[0], name: hit[1] } : null;
};
const v = (value: string, rows: number, label: string | null = null, exact = true): SourceFacetValue => ({ value, label, rows, exact });

describe("readStates", () => {
  it("reads postal codes, territories included, most records first", () => {
    const facets = TABLE.map(([code], i) => v(code, 10 + i));
    const reading = readStates(facets, lookup)!;
    expect(reading.states).toHaveLength(14);
    expect(reading.states[0]).toEqual({ code: "WY", name: "Wyoming", value: "WY", rows: 23, exact: true });
    expect(reading.others).toEqual([]);
  });

  it("reads names whatever their case, and a code's stored name when the code is not a state", () => {
    const names = TABLE.map(([, name], i) => v(name.toUpperCase(), i + 1));
    expect(readStates(names, lookup)!.states.map((s) => s.code)).toContain("PR");
    const labelled = TABLE.map(([, name], i) => v(String(i + 1).padStart(2, "0"), 5, name));
    expect(readStates(labelled, lookup)!.states[0]).toMatchObject({ value: "01", name: "Alaska" });
  });

  it("allows a few places that are not states and lists them", () => {
    const facets = [...TABLE.map(([code]) => v(code, 5)), v("US", 70)];
    const reading = readStates(facets, lookup)!;
    expect(reading.others).toEqual([{ value: "US", label: "US", rows: 70, exact: true }]);
    expect(stateCaption(reading)).toBe("70 records in 14 states and territories; most in Alaska, 5. 1 other place holds 70 records.");
  });

  it("refuses fewer than 10 states, a share under 90% and two values for one state", () => {
    expect(readStates(TABLE.slice(0, 9).map(([code]) => v(code, 5)), lookup)).toBeNull();
    const countries = [...TABLE.map(([code]) => v(code, 5)), v("MX", 5), v("FR", 5)];
    expect(readStates(countries, lookup)).toBeNull();
    expect(readStates([...TABLE.map(([code]) => v(code, 5)), v("Texas", 1)], lookup)).toBeNull();
    expect(readStates([], lookup)).toBeNull();
  });
});

describe("place bars", () => {
  it("ranks places by records and keeps the stored value as the filter key", () => {
    const bars = placeBars([v("06001", 4, "Alameda County"), v("06003", 9, null, false), v("", 2)], 2);
    expect(bars).toEqual([
      { key: "06003", label: "06003", value: 9, text: "9 or more", title: "06003: at least 9 records. Opens its records.", sub: undefined },
      { key: "06001", label: "Alameda County", sub: "06001", value: 4, text: "4", title: "Alameda County: 4 records. Opens its records." },
    ]);
    expect(placeBars([v("", 2)], 5)[0].label).toBe("(empty)");
  });

  it("names a state by its name with the stored code beside it", () => {
    const reading = readStates(TABLE.map(([code]) => v(code, 3)), lookup)!;
    expect(stateBars(reading)[0]).toEqual({ key: "AK", label: "Alaska", sub: "AK", value: 3, text: "3", title: "Alaska: 3 records. Opens its records." });
  });
});
