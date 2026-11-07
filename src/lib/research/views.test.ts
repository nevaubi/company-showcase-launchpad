import { afterEach, describe, expect, it } from "vitest";
import { canvas, orderedViews, parseViewSpec } from "./views";

describe("parseViewSpec", () => {
  it("accepts each view type", () => {
    const specs = [
      { type: "kpis", items: [{ label: "Revenue", value: 96.2e9, unit: "$", delta: 0.12 }] },
      { type: "chart", chart: "line", x: "period", series: ["NVDA"], data: [{ period: "FY24", NVDA: 60.9e9 }] },
      { type: "table", columns: ["Ticker", "P/E"], rows: [["NVDA", 48.2]] },
      { type: "note", markdown: "**Hi**" },
      { type: "code", code: "return 1", result: "1" },
      { type: "image", src: "https://example.com/a.png" },
      { type: "file", fileId: "f-1" },
    ];
    for (const s of specs) expect(parseViewSpec(s).ok, s.type).toBe(true);
  });

  it("rejects unknown types with the allowed list", () => {
    const r = parseViewSpec({ type: "pie", data: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown view type "pie"/);
  });

  it("rejects charts whose series are not in the data, and ragged tables", () => {
    const c = parseViewSpec({ type: "chart", chart: "bar", x: "period", series: ["AMD"], data: [{ period: "FY24", NVDA: 1 }] });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/AMD/);
    const t = parseViewSpec({ type: "table", columns: ["a", "b"], rows: [["x"]] });
    expect(t.ok).toBe(false);
  });

  it("rejects bad fields with a path", () => {
    const r = parseViewSpec({ type: "image", src: "not a url" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^src/);
  });
});

describe("canvas store", () => {
  afterEach(() => canvas.reset());

  it("adds, pins, reorders and removes views", () => {
    const a = canvas.addView({ type: "note", markdown: "a" });
    const b = canvas.addView({ type: "note", markdown: "b" });
    const c = canvas.addView({ type: "note", markdown: "c" });
    expect(canvas.get().open).toBe(true);
    canvas.togglePin(c.id);
    expect(orderedViews(canvas.get().views).map((v) => v.id)).toEqual([c.id, a.id, b.id]);
    canvas.moveView(b.id, -1);
    expect(canvas.get().views.map((v) => v.id)).toEqual([b.id, a.id, c.id]);
    canvas.removeView(a.id);
    expect(canvas.get().views).toHaveLength(2);
  });

  it("merges browser run updates by id", () => {
    canvas.upsertRuns([{ id: "r1", token: "t", goal: "g", status: "queued", done: false }]);
    canvas.upsertRuns([{ id: "r1", status: "running", liveUrl: "https://live.browser-use.com/x" }]);
    const r = canvas.run("r1")!;
    expect(r.token).toBe("t");
    expect(r.status).toBe("running");
    expect(r.liveUrl).toContain("live.browser-use.com");
  });
});
