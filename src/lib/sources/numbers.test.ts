import { describe, expect, it } from "vitest";
import { groupNative, readNative, snapshotMarkers, summarizeReadings } from "./numbers";

describe("readNative", () => {
  it("reads a plain decimal and keeps the cell as stored", () => {
    expect(readNative("18767000.0")).toEqual({
      kind: "number",
      value: 18767000,
      text: "18767000.0",
      decimals: 1,
    });
    expect(readNative("4091315000")).toEqual({
      kind: "number",
      value: 4091315000,
      text: "4091315000",
      decimals: 0,
    });
    // FDIC ROA of CERT 628 for 20260630, as stored.
    expect(readNative("1.5851712753913223")).toMatchObject({ kind: "number", decimals: 16 });
    expect(readNative("-0.50")).toMatchObject({ value: -0.5, decimals: 2, text: "-0.50" });
    expect(readNative("+3")).toMatchObject({ value: 3, decimals: 0 });
  });

  it("keeps null, empty, marker and text apart", () => {
    expect(readNative(null)).toEqual({ kind: "null" });
    expect(readNative("")).toEqual({ kind: "empty" });
    expect(readNative("NM", { markers: ["NM"] })).toEqual({ kind: "marker", text: "NM" });
    expect(readNative("NM")).toEqual({ kind: "text", text: "NM" });
    expect(readNative("0")).toMatchObject({ kind: "number", value: 0 });
  });

  it("reads a number right-aligned with spaces only when the field declares it", () => {
    expect(readNative("   1234.5")).toEqual({ kind: "text", text: "   1234.5" });
    expect(readNative("   1234.5", { padding: "leading-spaces" })).toEqual({ kind: "number", value: 1234.5, text: "   1234.5", decimals: 1 });
    expect(readNative("  -0.25", { padding: "leading-spaces" })).toMatchObject({ kind: "number", value: -0.25, decimals: 2 });
    expect(readNative("  1,234,567", { padding: "leading-spaces", grouping: "," })).toMatchObject({ kind: "number", value: 1234567 });
    expect(readNative("\t12", { padding: "leading-spaces" })).toEqual({ kind: "text", text: "\t12" });
    expect(readNative("12 ", { padding: "leading-spaces" })).toEqual({ kind: "text", text: "12 " });
    expect(readNative("   ", { padding: "leading-spaces" })).toEqual({ kind: "text", text: "   " });
    expect(readNative("", { padding: "leading-spaces" })).toEqual({ kind: "empty" });
  });

  it("lets a declared marker win over a numeric reading", () => {
    expect(readNative("-999", { markers: ["-999"] })).toEqual({ kind: "marker", text: "-999" });
    expect(readNative("-999")).toMatchObject({ kind: "number", value: -999 });
  });

  it("refuses everything that is not a plain decimal", () => {
    for (const cell of [
      "(1,234)",
      "5%",
      "$5",
      " 12",
      "12 ",
      ".5",
      "5.",
      "0x1F",
      "NaN",
      "Infinity",
      "1e999",
      "1,234",
      "12-31",
      "--",
      "-",
      "1.2.3",
      "１２",
    ])
      expect(readNative(cell), cell).toEqual({ kind: "text", text: cell });
  });

  it("reads an exponent and states the decimal places of the plain number", () => {
    expect(readNative("1.5e-3")).toMatchObject({ kind: "number", value: 0.0015, decimals: 4 });
    expect(readNative("1.5E6")).toMatchObject({ kind: "number", value: 1500000, decimals: 0 });
  });

  it("reads comma groups only when asked and only when the groups are complete", () => {
    expect(readNative("1,234,567.8", { grouping: "," })).toEqual({
      kind: "number",
      value: 1234567.8,
      text: "1,234,567.8",
      decimals: 1,
    });
    expect(readNative("-12,000", { grouping: "," })).toMatchObject({ value: -12000 });
    expect(readNative("1234.5", { grouping: "," })).toMatchObject({ value: 1234.5 });
    for (const cell of ["12,34", "1,234,56", ",123", "1,,234", "1,234e3", "0,123", "01,234"])
      expect(readNative(cell, { grouping: "," }), cell).toEqual({ kind: "text", text: cell });
    expect(readNative("1,234", { grouping: "none" })).toEqual({ kind: "text", text: "1,234" });
  });

  it("refuses a value a double cannot hold instead of reading it as infinity or zero", () => {
    expect(readNative("1e999")).toEqual({ kind: "text", text: "1e999" });
    expect(readNative("1e-999")).toEqual({ kind: "text", text: "1e-999" });
    expect(readNative("0e5")).toMatchObject({ kind: "number", value: 0 });
    expect(readNative("0.000")).toMatchObject({ kind: "number", value: 0, decimals: 3 });
    // More digits than a double holds: the value is the nearest double, the text is the cell.
    expect(readNative("9007199254740993")).toMatchObject({ kind: "number", text: "9007199254740993" });
  });

  it("does not hand back a negative zero", () => {
    const reading = readNative("-0.0");
    expect(reading.kind === "number" && Object.is(reading.value, 0)).toBe(true);
  });
});

describe("summarizeReadings", () => {
  it("counts each kind and names what could not be read, once each", () => {
    const summary = summarizeReadings(
      ["1", "2.5", null, "", "NM", "NM", "n/a", "W", "3", "see note", "x1", "x2", "x3"],
      { markers: ["NM", "W"] },
    );
    expect(summary).toEqual({
      numbers: 3,
      nulls: 1,
      empties: 1,
      markers: 3,
      texts: 5,
      examples: ["NM", "n/a", "W", "see note", "x1"],
    });
  });

  it("honours the example limit and an empty run", () => {
    expect(summarizeReadings(["a", "b", "c"], { maxExamples: 2 }).examples).toEqual(["a", "b"]);
    expect(summarizeReadings([])).toEqual({
      numbers: 0,
      nulls: 0,
      empties: 0,
      markers: 0,
      texts: 0,
      examples: [],
    });
  });
});

describe("groupNative", () => {
  it("groups the stored digits and keeps every decimal", () => {
    expect(groupNative("4091315000")).toBe("4,091,315,000");
    expect(groupNative("18767000.0")).toBe("18,767,000.0");
    expect(groupNative("1.5851712753913223")).toBe("1.5851712753913223");
    expect(groupNative("0.5")).toBe("0.5");
    expect(groupNative("999")).toBe("999");
    expect(groupNative("+1000")).toBe("+1,000");
  });

  it("writes a true minus sign", () => {
    expect(groupNative("-1234.50")).toBe("−1,234.50");
  });

  it("returns null where grouping would change what the cell says", () => {
    for (const cell of ["1e5", "007", "01001", "NM", "", "1,234", "20260630x"])
      expect(groupNative(cell), cell).toBeNull();
  });
});

describe("snapshotMarkers", () => {
  it("lists the markers a snapshot counted", () => {
    expect(snapshotMarkers({ source_lexical_marker_counts: { NM: 21709 } })).toEqual(["NM"]);
    expect(snapshotMarkers({ source_lexical_marker_counts: {} })).toEqual([]);
    expect(snapshotMarkers({})).toEqual([]);
    expect(snapshotMarkers(null)).toEqual([]);
    expect(snapshotMarkers({ source_lexical_marker_counts: ["NM"] })).toEqual([]);
  });
});
