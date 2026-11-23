import { describe, expect, it } from "vitest";
import { buildPayload } from "./payload";

describe("totals whose lines never add up", () => {
  const fact = (label: string, end: string, value: number, extra: Record<string, unknown> = {}) =>
    ({ category: "kpi", metric: "volume", parent: "Commercial", label, is_total: false, period_start: null, period_end: end, months: 3, value, unit: "count", accn: "a", doc: `${end}.htm`, filed: end, locator: { t: 0, r: 0, c: 1 }, ...extra }) as never;
  it("shows them as plain lines instead of a breakdown that fails every quarter", () => {
    const ends = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const facts = ends.flatMap((e, i) => [fact("Residential", e, 9000 + i), fact("Unbilled Sales", e, 100 + i), fact("Commercial", e, 8600 + i * 3, { parent: null, is_total: true })]);
    const p = buildPayload("DUK", facts);
    expect(p.stats.unlinked).toBe(1);
    expect(p.checks.filter((c) => !c.ok)).toHaveLength(0);
  });
  it("keeps a real breakdown that misses by a little in one quarter", () => {
    const ends = ["2025-03-31", "2025-06-30", "2025-09-30"];
    const facts = ends.flatMap((e, i) => [fact("A", e, 60), fact("B", e, 40), fact("Commercial", e, i === 1 ? 103 : 100, { parent: null, is_total: true })]);
    const p = buildPayload("X", facts);
    expect(p.stats.unlinked).toBe(0);
    expect(p.checks.filter((c) => c.ok)).toHaveLength(2);
  });
});

describe("parts whose parent label is printed by several tables", () => {
  // PNC 8-K of 15 Jul 2026 (q22026financialhighlightsa.htm): the income statement splits
  // "Noninterest income" into fee and other income, and each segment table prints its own
  // "Noninterest income". The parts belong to the income statement's line, not to a segment's.
  const doc = { document_id: "dd4bf281", accn: "0001628280-26-048244", doc: null, filed: "2026-07-15", months: 3, unit: "usd", category: "segment", metric: "revenue", locator: { t: 0, r: 0, c: 1 } };
  const f = (label: string, breakdown: string, parent: string | null, is_total: boolean, end: string, value: number) => ({ ...doc, label, breakdown, parent, is_total, period_start: null, period_end: end, value }) as never;
  const ends: [string, number[]][] = [
    ["2025-06-30", [244, 2106, 1894, 212, 5661]],
    ["2026-03-31", [262, 2204, 2079, 125, 6165]],
    ["2026-06-30", [271, 2768, 2279, 489, 6875]],
  ];
  const facts = ends.flatMap(([e, [amg, nii, fee, other, rev]]) => [
    f("Noninterest income", "Asset Management Group segment results", "Asset Management Group", false, e, amg * 1e6),
    f("Noninterest income", "Consolidated Income Statement", "Revenue", true, e, nii * 1e6),
    f("Fee income (non-GAAP)", "Consolidated Income Statement", "Noninterest income", true, e, fee * 1e6),
    f("Other noninterest income", "Consolidated Income Statement", "Noninterest income", false, e, other * 1e6),
    f("Revenue", "Consolidated Income Statement", null, true, e, rev * 1e6),
  ]);
  it("nests fee and other income under the bank's own noninterest income", () => {
    const p = buildPayload("PNC", facts);
    const byLabel = (l: string, bd: string) => p.series.find((s) => s.label === l && s.bd === bd)!;
    const consolidated = byLabel("Noninterest income", "Consolidated Income Statement");
    expect(byLabel("Fee income (non-GAAP)", "Consolidated Income Statement").parent).toBe(consolidated.k);
    expect(byLabel("Other noninterest income", "Consolidated Income Statement").parent).toBe(consolidated.k);
    expect(byLabel("Noninterest income", "Asset Management Group segment results").parent).not.toBe(consolidated.k);
  });
});
