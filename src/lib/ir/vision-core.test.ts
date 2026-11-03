import { describe, expect, it } from "vitest";
import { numberTokens, parseBboxHtml, parseToken, resolveValue, visionFacts, type VisionOutput } from "@/lib/ir/vision-core";

describe("parseToken", () => {
  it("reads currency suffixes, parentheses and percentages", () => {
    expect(parseToken("$12.3B")).toEqual({ v: 12.3, suffixScale: 1e9, pct: false });
    expect(parseToken("(1,234)")).toEqual({ v: -1234, suffixScale: null, pct: false });
    expect(parseToken("45.2%")).toEqual({ v: 45.2, suffixScale: null, pct: true });
    expect(parseToken("$850M")?.suffixScale).toBe(1e6);
  });
  it("rejects garbled thousands groupings and words", () => {
    expect(parseToken("12,34")).toBeNull();
    expect(parseToken("Revenue")).toBeNull();
  });
});

describe("numberTokens", () => {
  it("merges a split-off dollar sign and suffix and skips bare years", () => {
    const page = {
      page: 1,
      width: 100,
      height: 100,
      words: [
        { text: "2025", box: [0.1, 0.1, 0.15, 0.12] as [number, number, number, number] },
        { text: "$", box: [0.3, 0.5, 0.31, 0.52] as [number, number, number, number] },
        { text: "4.2", box: [0.312, 0.5, 0.34, 0.52] as [number, number, number, number] },
        { text: "B", box: [0.342, 0.5, 0.35, 0.52] as [number, number, number, number] },
      ],
    };
    const toks = numberTokens(page);
    expect(toks.map((t) => t.text)).toEqual(["$4.2B"]);
    expect(toks[0].box[0]).toBe(0.3);
    expect(toks[0].box[2]).toBe(0.35);
  });
});

describe("visionFacts", () => {
  const tokens = [
    { w: 0, text: "$4.2B", box: [0.1, 0.1, 0.2, 0.12] as [number, number, number, number] },
    { w: 1, text: "38%", box: [0.3, 0.1, 0.4, 0.12] as [number, number, number, number] },
    { w: 2, text: "1,250", box: [0.5, 0.1, 0.6, 0.12] as [number, number, number, number] },
  ];
  const out = (rows: VisionOutput["panels"][number]["rows"]): VisionOutput => ({
    page_kind: "chart",
    panels: [{ title: "Revenue by segment", periods: [{ p: 0, period_start: "2025-07-01", period_end: "2025-09-30", months: 3 }], rows }],
  });
  const base = { parent: "", breakdown: "", category: "segment" as const, metric: "revenue" as const, is_total: false };

  it("takes the value from the token, using its printed suffix over the model's scale", () => {
    const r = visionFacts(out([{ ...base, label: "Cloud", unit: "usd", scale: 1e6, values: [{ w: 0, p: 0, read: "$4.2B" }] }]), tokens, 3, "2025-10-28");
    expect(r.rows[0].value).toBe(4.2e9);
    expect(r.rows[0].locator).toMatchObject({ page: 3, text: "$4.2B" });
  });
  it("rejects a percentage token mapped to a dollar row and reused tokens", () => {
    const r = visionFacts(
      out([
        { ...base, label: "Cloud", unit: "usd", scale: 1e6, values: [{ w: 1, p: 0, read: "38%" }] },
        { ...base, label: "Units", unit: "count", scale: 1, values: [{ w: 2, p: 0, read: "1,250" }] },
        { ...base, label: "Units again", unit: "count", scale: 1, values: [{ w: 2, p: 0, read: "1,250" }] },
      ]),
      tokens,
      1,
      "2025-10-28",
    );
    expect(r.rows.map((x) => x.label)).toEqual(["Units"]);
    expect(r.rows[0].value).toBe(1250);
    expect(r.rejected).toBe(2);
  });
  it("rejects periods ending after the document date", () => {
    const o = out([{ ...base, label: "Cloud", unit: "usd", scale: 1e6, values: [{ w: 0, p: 0, read: "$4.2B" }] }]);
    o.panels[0].periods[0].period_end = "2026-09-30";
    expect(visionFacts(o, tokens, 1, "2025-10-28").rows).toHaveLength(0);
  });
});

describe("parseBboxHtml", () => {
  it("normalizes word boxes to page fractions", () => {
    const html = `<page width="720.0" height="540.0"><word xMin="72.0" yMin="54.0" xMax="144.0" yMax="108.0">$1.5</word></page>`;
    const [p] = parseBboxHtml(html);
    expect(p.words[0]).toEqual({ text: "$1.5", box: [0.1, 0.1, 0.2, 0.2] });
  });
});

describe("resolveValue", () => {
  it("restores a decimal point OCR dropped when the digits match the model's reading", () => {
    expect(resolveValue("$271", "$2.71", true)?.v).toBe(2.71);
  });
  it("trusts the PDF text layer: a disagreeing reading is rejected", () => {
    expect(resolveValue("$271", "$2.71", false)).toBeNull();
    expect(resolveValue("1,250", "1,250", false)?.v).toBe(1250);
  });
  it("rejects readings with different digits", () => {
    expect(resolveValue("$271", "$2.81", true)).toBeNull();
  });
});
