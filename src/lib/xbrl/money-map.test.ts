import { describe, expect, it } from "vitest";
import type { FilingDetail } from "./detail";
import { layoutMoneyMap, moneyMap } from "./money-map";

const P = "D2025-09-29_2026-09-27";
const v = (x: number, id?: string) => ({ v: x * 1e9, ...(id ? { id } : {}) });
const base = (over: Partial<FilingDetail> = {}): FilingDetail => ({
  format: 3,
  ticker: "X",
  accn: "a",
  form: "10-K",
  filed: "2026-11-04",
  reportDate: "2026-09-27",
  doc: "x.htm",
  periods: { [P]: { key: P, start: "2025-09-29", end: "2026-09-27", months: 12 } },
  tables: [
    {
      id: "r1",
      family: "revenue",
      title: "Revenue by product / service",
      concept: "us-gaap:Revenues",
      conceptLabel: "Revenue",
      axis: "srt:ProductOrServiceAxis",
      axisLabel: "Product / service",
      unit: "USD",
      periods: [P],
      rows: [
        { member: "x:PhonesMember", label: "Phones", values: { [P]: v(60, "p") } },
        { member: "x:CarsMember", label: "Cars", values: { [P]: v(30) } },
      ],
      total: { [P]: v(100, "tot") },
    },
  ],
  segments: {
    periods: [P],
    segments: [
      { member: "x:ASegMember", label: "A" },
      { member: "x:BSegMember", label: "B" },
      { member: "us-gaap:OperatingSegmentsAndCorporateNonSegmentMember", label: "All segments" },
    ],
    rows: [
      { concept: "us-gaap:Revenues", label: "Revenue", kind: "revenue", values: { "x:ASegMember": { [P]: v(70) }, "x:BSegMember": { [P]: v(30) }, "us-gaap:OperatingSegmentsAndCorporateNonSegmentMember": { [P]: v(100) } } },
      { concept: "us-gaap:CostOfRevenue", label: "Cost of revenue", kind: "cost", values: { "x:ASegMember": { [P]: v(40) }, "x:BSegMember": { [P]: v(20) } } },
      { concept: "us-gaap:DepreciationDepletionAndAmortization", label: "Depreciation", kind: "cost", values: { "x:ASegMember": { [P]: v(5) } } },
      { concept: "us-gaap:OperatingIncomeLoss", label: "Operating income", kind: "profit", values: { "x:ASegMember": { [P]: v(30) }, "x:BSegMember": { [P]: v(4) } } },
    ],
  },
  concentration: [],
  counts: { facts: 0, dimensional: 0 },
  ...over,
});

const inOut = (m: NonNullable<ReturnType<typeof moneyMap>>, id: string) => [m.links.filter((l) => l.to === id).reduce((s, l) => s + l.value, 0), m.links.filter((l) => l.from === id).reduce((s, l) => s + l.value, 0)];

describe("money map", () => {
  const m = moneyMap(base())!;

  it("balances every middle node: what flows in flows out", () => {
    for (const id of ["rev", "seg:x:ASegMember", "seg:x:BSegMember"]) {
      const [i, o] = inOut(m, id);
      expect(o).toBeCloseTo(i, -3);
    }
  });

  it("adds the untagged remainder as a derived flow naming its parts", () => {
    const other = m.links.find((l) => l.from === "src:other")!;
    expect(other.value).toBeCloseTo(10e9, -3);
    expect(other.derived?.parts.map((p) => [p.label, p.sign])).toEqual([["Revenue", 1], ["Phones", -1], ["Cars", -1]]);
    const bCosts = m.links.find((l) => l.from === "seg:x:BSegMember" && l.to === "cost:other")!;
    expect(bCosts.value).toBeCloseTo(6e9, -3);
  });

  it("leaves out an all-segments column and depreciation that sits inside other costs", () => {
    expect(m.nodes.some((n) => n.label === "All segments")).toBe(false);
    expect(m.nodes.some((n) => n.label === "Depreciation")).toBe(false);
    expect(m.links.find((l) => l.from === "seg:x:ASegMember" && l.to === "cost:us-gaap:CostOfRevenue")?.ref?.v).toBe(40e9);
  });

  it("shows sales between segments when segments add up to more than revenue", () => {
    const d = base();
    d.segments!.rows[0].values["x:ASegMember"][P] = v(80);
    const mm = moneyMap(d)!;
    expect(mm.nodes.find((n) => n.id === "src:interseg")?.value).toBeCloseTo(10e9, -3);
    expect(mm.total).toBeCloseTo(110e9, -3);
  });

  it("lays nodes out inside the box without overlap", () => {
    const L = layoutMoneyMap(m, 800, 400);
    for (const c of [0, 1, 2, 3]) {
      const ns = L.nodes.filter((n) => n.col === c).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ns.length; i++) expect(ns[i].y).toBeGreaterThanOrEqual(ns[i - 1].y + ns[i - 1].h);
      for (const n of ns) expect(n.y + n.h).toBeLessThanOrEqual(400.5);
    }
  });
});

describe("products sold across segments", () => {
  it("sums each product over segments and keeps segment sales before eliminations", () => {
    const d = base();
    d.segments!.rows[0].values["x:ASegMember"][P] = v(80);
    d.tables.push({
      id: "r2",
      family: "revenue",
      title: "Revenue by segment and product / service",
      concept: "us-gaap:Revenues",
      conceptLabel: "Revenue",
      axis: "us-gaap:StatementBusinessSegmentsAxis",
      axisLabel: "Segment",
      unit: "USD",
      periods: [P],
      rows: [
        { member: "x:ASegMember", label: "A", values: {}, sub: [{ member: "x:PharmMember", label: "Pharmacy", values: { [P]: v(50) } }, { member: "x:StoreMember", label: "Store", values: { [P]: v(30) } }] },
        { member: "x:BSegMember", label: "B", values: {}, sub: [{ member: "x:PharmMember", label: "Pharmacy", values: { [P]: v(30) } }] },
        { member: "x:EliminationsMember", label: "Eliminations", values: {}, sub: [{ member: "x:PharmMember", label: "Pharmacy", values: { [P]: v(-10) } }] },
      ],
    });
    const mm = moneyMap(d)!;
    const pharm = mm.links.find((l) => l.from === "src:x:PharmMember")!;
    expect(pharm.value).toBeCloseTo(80e9, -3);
    expect(pharm.derived?.parts).toHaveLength(2);
    expect(mm.nodes.some((n) => n.id === "src:interseg")).toBe(false);
    expect(mm.notes[0]).toMatch(/before eliminating \$10\.0B/);
  });
});
