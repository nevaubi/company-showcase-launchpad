// irpolish: names stored with an em dash ("Net revenue — Managed basis") reached the At a glance tiles and
// chart legends as stored. Every viz label passes through `shownLabel`, the page's one label rule.
import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadSeries } from "@/lib/ir/payload";
import { partsOf, seriesOf } from "./from-payload";

const line = (k: string, label: string, parent: string | null, v: number): PayloadSeries =>
  ({
    k,
    cat: "segment",
    met: "revenue",
    label,
    parent,
    total: parent == null,
    unit: "usd",
    q: { "2026-09-30": { v, d: 0, l: [1, 2, 1], x: String(v / 1e6), e: "2026-09-30", m: 3 } },
    y: {},
  }) as unknown as PayloadSeries;

const payload = {
  v: 2,
  ticker: "JPM",
  quarters: ["2026-09-30"],
  years: [],
  docs: [{ id: "d", accn: "a", doc: "x.htm", kind: "supplement", filed: "2026-10-13" }],
  series: [
    line("t", "Net revenue — Managed basis", null, 50_907e6),
    line("a", "Markets — revenue", "t", 30_000e6),
    line("b", "Banking — Payments and lending", "t", 20_907e6),
  ],
  groups: [{ id: "g", cat: "segment", met: "revenue", unit: "usd", label: "Revenue — by segment", root: "t", rows: [{ k: "t" }, { k: "a" }, { k: "b" }] }],
  checks: [],
} as unknown as IrPayload;

describe("irpolish: viz labels carry no em dash", () => {
  it("names a tile's line as the page does", () => {
    expect(seriesOf(payload, "JPM", payload.series[0], "q").label).toBe("Net revenue: managed basis");
    expect(seriesOf(payload, "JPM", payload.series[1], "q").label).toBe("Markets: revenue");
  });
  it("names a parts chart and its parts without an em dash", () => {
    const p = partsOf(payload, "JPM", payload.groups[0], "q");
    expect(p).not.toBeNull();
    expect(JSON.stringify([p!.label, p!.total.label, ...p!.parts.map((x) => x.label)])).not.toContain("—");
  });
});
