import { describe, expect, it } from "vitest";
import { VALID_SPECS } from "./fixtures/views";
import { checkView, coerceNumber, parseOrRepair, parseViewSpec, repairViewSpec, tableOf, viewLabel, type LeafSpec } from "./view-spec";

describe("view spec validation", () => {
  it("accepts one spec of every type, dashboards included", () => {
    for (const [k, s] of Object.entries(VALID_SPECS)) {
      const r = parseViewSpec(s);
      expect(r.ok, `${k}: ${r.ok ? "" : r.error}`).toBe(true);
    }
  });

  it("rejects unknown types listing the allowed ones", () => {
    const r = parseViewSpec({ type: "radar" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown view type "radar".*candles/);
  });

  it.each([
    [{ type: "chart", chart: "combo", x: "q", series: ["a", "b"], data: [{ q: "Q1", a: 1, b: 2 }] }, /lineSeries/],
    [{ type: "chart", chart: "line", x: "q", series: ["a"], data: [{ q: "Q1", a: "n/a" }] }, /no numeric/],
    [{ type: "heatmap", rows: ["a", "b"], cols: ["x"], values: [[1]] }, /values has 1 rows/],
    [{ type: "heatmap", rows: ["a"], cols: ["x", "y"], values: [[1]] }, /2 numbers/],
    [{ type: "candles", bars: [{ t: "2026-01-01", o: 1, h: 0.5, l: 0.4, c: 1 }, { t: "2026-01-02", o: 1, h: 2, l: 0, c: 1 }] }, /high\/low/],
    [{ type: "candles", bars: [{ t: "2026-01-01", o: 1, h: 2, l: 0, c: 1 }, { t: "2026-01-02", o: 1, h: 2, l: 0, c: 1 }], overlays: [{ name: "SMA", values: [1] }] }, /overlay SMA/],
    [{ type: "graph", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "c" }] }, /unknown node/],
    [{ type: "dashboard", sections: [{ columns: 2, items: [{ type: "note", markdown: "x", span: 3 }] }] }, /spans 3 columns in a 2-column/],
    [{ type: "dashboard" }, /sections or tabs/],
    [{ type: "donut", parts: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ label: `p${i}`, value: i })) }, /parts/],
  ])("rejects semantically invalid spec %#", (spec, msg) => {
    const r = parseViewSpec(spec);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(`${r.error} ${r.hint ?? ""}`).toMatch(msg);
  });

  it("gives a fix hint for known types", () => {
    const r = parseViewSpec({ type: "waterfall", steps: [{ label: "a" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/steps/);
  });
});

describe("automatic repair", () => {
  it("coerces money, percent and suffixed strings", () => {
    expect(coerceNumber("$1.2B")).toBe(1.2e9);
    expect(coerceNumber("12.5%")).toBeCloseTo(0.125);
    expect(coerceNumber("(3.4)")).toBe(-3.4);
    expect(coerceNumber("1,234")).toBe(1234);
    expect(coerceNumber("n/a")).toBeUndefined();
  });

  it("fixes numeric strings, missing x and series, and aliases", () => {
    const r = parseOrRepair({ type: "column", data: [{ period: "FY24", NVDA: "$60.9B" }, { period: "FY25", NVDA: "$130.5B" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.type).toBe("chart");
      expect(r.spec.type === "chart" && r.spec.chart).toBe("bar");
      expect(r.spec.type === "chart" && r.spec.series).toEqual(["NVDA"]);
      expect(r.repaired?.join(" ")).toMatch(/numeric strings/);
    }
  });

  it("turns a pie with too many slices into ranked bars", () => {
    const r = parseOrRepair({ type: "pie", parts: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ label: `p${i}`, value: i })) });
    expect(r.ok && r.spec.type).toBe("hbar");
  });

  it("converts table row objects and pads ragged rows", () => {
    const a = parseOrRepair({ type: "table", columns: ["t", "pe"], rows: [{ t: "NVDA", pe: 48 }] });
    expect(a.ok && a.spec.type === "table" && a.spec.rows).toEqual([["NVDA", 48]]);
    const b = parseOrRepair({ type: "table", columns: ["t", "pe"], rows: [["NVDA"]] });
    expect(b.ok && b.spec.type === "table" && b.spec.rows).toEqual([["NVDA", null]]);
  });

  it("leaves unfixable specs rejected and reports nothing to repair", () => {
    expect(repairViewSpec({ type: "note" })).toBeNull();
    expect(parseOrRepair({ type: "note" }).ok).toBe(false);
  });
});

describe("self-check and data tables", () => {
  it("flags empty series, string values and long labels", () => {
    const r = parseViewSpec({ type: "chart", chart: "line", x: "p", series: ["a", "b"], data: [{ p: "a very long period label indeed", a: 1, b: null }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p = checkView(r.spec).join(" | ");
      expect(p).toMatch(/series b has no numeric values/);
      expect(p).toMatch(/x labels longer/);
    }
  });

  it("checks nested dashboard items", () => {
    const r = parseViewSpec({ type: "dashboard", sections: [{ columns: 1, items: [{ type: "sparktable", title: "Peers", columns: [{ key: "s", label: "1Y", kind: "spark" }], rows: [{ s: [1] }] }] }] });
    expect(r.ok && checkView(r.spec).join()).toMatch(/Peers: sparkline column 1Y/);
  });

  it("passes clean specs", () => {
    for (const k of ["line", "hbar", "scatter", "heatmap", "candles"]) {
      const r = parseViewSpec(VALID_SPECS[k]);
      expect(r.ok && checkView(r.spec), k).toEqual([]);
    }
  });

  it("derives the data table behind charts", () => {
    const r = parseViewSpec(VALID_SPECS.line);
    expect(r.ok && tableOf(r.spec as LeafSpec)).toEqual({ columns: ["period", "NVDA", "AMD"], rows: [["FY24", 60.9e9, 22.7e9], ["FY25", 130.5e9, 25.8e9]] });
    const w = parseViewSpec(VALID_SPECS.waterfall);
    expect(w.ok && tableOf(w.spec as LeafSpec)?.rows[0]).toEqual(["FY25", 100, "yes"]);
  });

  it("labels views for the timeline", () => {
    expect(viewLabel(JSON.stringify(VALID_SPECS.combo))).toEqual({ type: "combo", title: "" });
    expect(viewLabel(JSON.stringify(VALID_SPECS.line))).toEqual({ type: "line", title: "Revenue" });
    expect(viewLabel("{not json")).toEqual({ type: "view", title: "" });
  });
});
