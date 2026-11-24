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

// Real VSAT rows (ir_kpi_facts, SQL 2026-11-24, category segment, 3-month "Total revenue(s)" since 2025):
// the segment table's total (one segment, about 460M) and the consolidated total (about 1,160M) were one line.
describe("p3-ir C4: a segment table's total is not folded into the consolidated total of the same name", () => {
  const rows: [string, string, string, string, number][] = [
    ["bea91f83", "Revenue by segment", "Total Revenue", "2025-03-31", 454_300_000],
    ["119e1659", "Revenue by business line", "Total revenues", "2025-06-30", 1_171_054_000],
    ["5bfe090d", "Revenue by segment", "Total revenue", "2025-12-31", 459_700_000],
    ["bea91f83", "Revenue by segment", "Total Revenue", "2026-03-31", 465_200_000],
    ["119e1659", "Revenue by business line", "Total revenues", "2026-06-30", 1_156_543_000],
  ];
  const facts = rows.map(([d, bd, label, e, v], i) => ({ id: `f${i}`, document_id: d, document_kind: "press-release", category: "segment", metric: "revenue", breakdown: bd, parent: null, label, unit: "usd", is_total: true, period_start: null, period_end: e, months: 3, value: v, accn: null, doc: null, filed: e, method: "table", locator: { t: 0, r: i, c: 1 } }) as never);
  it("keeps the two levels in two lines", () => {
    const p = buildPayload("VSAT", facts);
    const lines = p.series.filter((s) => /total revenue/i.test(s.label));
    const levels = lines.map((s) => Object.values(s.q).map((c) => c.v).sort((a, b) => a - b));
    expect(levels).toHaveLength(2);
    expect(levels).toContainEqual([454_300_000, 459_700_000, 465_200_000]);
    expect(levels).toContainEqual([1_156_543_000, 1_171_054_000]);
  });
  it("still joins one line printed by two tables at one level", () => {
    const same = rows.map((r, i) => (r[1] === "Revenue by segment" ? ([r[0], r[1], r[2], r[3], [1_120_000_000, 0, 1_150_000_000, 1_160_000_000][i]] as typeof r) : r));
    const p = buildPayload("VSAT", same.map(([d, bd, label, e, v], i) => ({ ...(facts[i] as object), document_id: d, breakdown: bd, label, period_end: e, value: v }) as never));
    expect(p.series.filter((s) => /total revenue/i.test(s.label))).toHaveLength(1);
  });
});
