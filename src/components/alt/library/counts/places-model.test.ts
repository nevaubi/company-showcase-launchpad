import { describe, expect, it } from "vitest";
import { US_PLACES } from "@/lib/sources/geo/us-states";
import type { SourceFacetValue } from "@/lib/sources/read-types";
import { placeBars, readStates, stateBars, stateCaption, stateMapPlaces } from "./places-model";

const v = (value: string, rows: number, label: string | null = null, exact = true): SourceFacetValue => ({ value, label, rows, exact });
const STATES = US_PLACES.filter((p) => p.kind === "state");

describe("readStates", () => {
  it("reads the postal codes of an MSHA-like place field, territories included, most records first", () => {
    const facets = US_PLACES.map((p, i) => v(p.code, 10 + i));
    const reading = readStates(facets)!;
    expect(reading.kind).toBe("postal");
    expect(reading.states).toHaveLength(US_PLACES.length);
    expect(reading.states[0].rows).toBe(9 + US_PLACES.length);
    expect(stateCaption(reading)).toMatch(/^[\d,]+ records in \d+ states and territories; most in .+, [\d,]+\.$/);
  });

  it("reads names whatever their case, and a code's stored name when the codes are not states", () => {
    const names = STATES.slice(0, 12).map((p, i) => v(p.name.toUpperCase(), i + 1));
    expect(readStates(names)!.kind).toBe("name");
    const labelled = STATES.slice(0, 12).map((p, i) => v(`R${i}`, 5, p.name));
    const reading = readStates(labelled)!;
    expect(reading.by).toBe("label");
    expect(reading.states.map((s) => s.value)).toContain("R0");
  });

  it("leaves national totals aside and says how many records they hold", () => {
    const facets = [...STATES.slice(0, 10).map((p) => v(p.code, 5)), v("US", 70)];
    const reading = readStates(facets)!;
    expect(reading.national).toEqual([{ value: "US", label: "US", rows: 70, exact: true }]);
    expect(stateCaption(reading)).toBe("50 records in 10 states; 10 hold the most, 5 each. 70 more records are national totals.");
  });

  it("refuses fewer than 10 states, any key that is not a state, and two keys for one state", () => {
    expect(readStates(STATES.slice(0, 9).map((p) => v(p.code, 5)))).toBeNull();
    expect(readStates([...STATES.slice(0, 20).map((p) => v(p.code, 5)), v("Unknown", 1)])).toBeNull();
    expect(readStates([...STATES.slice(0, 12).map((p) => v(p.code, 5)), v(STATES[0].name, 1)])).toBeNull();
    // census divisions numbered 01 to 09 are not FIPS states
    expect(readStates(Array.from({ length: 9 }, (_, i) => v(`0${i + 1}`, 3)))).toBeNull();
    expect(readStates([])).toBeNull();
  });
});

describe("place marks", () => {
  it("gives the grid one place per state with the stored value as its filter", () => {
    const reading = readStates(STATES.slice(0, 10).map((p, i) => v(p.code, i + 1, null, i !== 0)))!;
    const places = stateMapPlaces(reading);
    expect(places[0]).toEqual({ code: STATES[9].code, name: STATES[9].name, key: STATES[9].code, value: 10, display: "10", text: null, row: null, filter: { geography: STATES[9].code } });
    expect(places.find((p) => p.code === STATES[0].code)!.display).toBe("at least 1");
    expect(places).toHaveLength(10);
    // every value was read: a state of the grid without a record is 0, and opens nothing
    const all = stateMapPlaces(reading, true);
    expect(all).toHaveLength(51);
    expect(all.find((p) => p.code === "DC")).toEqual({ code: "DC", name: "District of Columbia", key: "DC", value: 0, display: "0", text: null, row: null });
    expect(stateBars(reading)[0]).toMatchObject({ key: STATES[9].code, label: STATES[9].name, sub: STATES[9].code, text: "10" });
  });

  it("ranks other places by records and keeps the stored value as the filter key", () => {
    const bars = placeBars([v("06001", 4, "Alameda County"), v("06003", 9, null, false), v("", 2)], 2);
    expect(bars).toEqual([
      { key: "06003", label: "06003", value: 9, text: "9 or more", title: "06003: at least 9 records. Opens its records.", sub: undefined },
      { key: "06001", label: "Alameda County", sub: "06001", value: 4, text: "4", title: "Alameda County: 4 records. Opens its records." },
    ]);
    expect(placeBars([v("", 2)], 5)[0].label).toBe("(empty)");
  });
});
