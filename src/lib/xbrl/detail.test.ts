import { describe, expect, it } from "vitest";
import { buildDetail, memberLabel } from "./detail";
import { factValue, parseContexts, parseInlineFacts, parseLabels, parseUnits } from "./inline";

const ctx = (id: string, period: string, dims: [string, string][] = []) =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${dims.length ? `<xbrli:segment>${dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join("")}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context>`;
const fy = (y: number) => `<xbrli:startDate>${y - 1}-09-29</xbrli:startDate><xbrli:endDate>${y}-09-27</xbrli:endDate>`;
const fact = (name: string, c: string, text: string, extra = "") => `<ix:nonFraction name="${name}" contextRef="${c}" unitRef="${/Percentage/.test(name) ? "pure" : "usd"}" decimals="-6" scale="${/Percentage/.test(name) ? -2 : 6}"${extra}>${text}</ix:nonFraction>`;

const SEG = "us-gaap:StatementBusinessSegmentsAxis";
const doc = [
  `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>`,
  ctx("c26", fy(2026)),
  ctx("c25", fy(2025)),
  ctx("hand26", fy(2026), [[SEG, "x:HandsetsMember"]]),
  ctx("auto26", fy(2026), [[SEG, "x:AutoMember"]]),
  ctx("hand25", fy(2025), [[SEG, "x:HandsetsMember"]]),
  ctx("cn26", fy(2026), [["srt:StatementGeographicalAxis", "country:CN"]]),
  ctx("us26", fy(2026), [["srt:StatementGeographicalAxis", "country:US"]]),
  ctx("tx26", fy(2026), [["srt:StatementGeographicalAxis", "stpr:TX"]]),
  ctx("custX26", fy(2026), [["us-gaap:ConcentrationRiskByTypeAxis", "us-gaap:CustomerConcentrationRiskMember"], ["us-gaap:ConcentrationRiskByBenchmarkAxis", "us-gaap:SalesRevenueNetMember"], ["srt:MajorCustomersAxis", "x:CustomerXMember"]]),
  ctx("inv", `<xbrli:instant>2026-09-27</xbrli:instant>`),
  fact("us-gaap:Revenues", "c26", "44,284", ' id="f1"'),
  fact("us-gaap:Revenues", "hand26", "28,000", ' id="f2"'),
  fact("us-gaap:Revenues", "auto26", "4,000"),
  fact("us-gaap:Revenues", "hand25", "27,000"),
  fact("us-gaap:CostOfRevenue", "hand26", "12,000"),
  fact("us-gaap:CostOfRevenue", "auto26", "2,500"),
  fact("us-gaap:Revenues", "cn26", "18,600"),
  fact("us-gaap:Revenues", "us26", "9,000"),
  fact("us-gaap:Revenues", "tx26", "1,000"),
  fact("us-gaap:ConcentrationRiskPercentage1", "custX26", "22", ' id="conc"'),
  fact("us-gaap:InventoryRawMaterials", "inv", "1,200"),
  fact("us-gaap:InventoryFinishedGoods", "inv", "—", ' format="ixt:fixed-zero"'),
].join("\n");
const lab = `<link:labelLink><link:loc xlink:href="x.xsd#x_CustomerXMember" xlink:label="loc1"/><link:label xlink:label="lab1" xlink:role="http://www.xbrl.org/2003/role/label">Customer X [Member]</link:label><link:labelArc xlink:from="loc1" xlink:to="lab1"/></link:labelLink>`;

describe("inline XBRL parsing", () => {
  it("reads scale, sign and SEC zero formats", () => {
    expect(factValue({ scale: "6" }, "1,234")).toBe(1_234_000_000);
    expect(factValue({ scale: "6", sign: "-" }, "5")).toBe(-5_000_000);
    expect(factValue({ format: "ixt:fixed-zero" }, "—")).toBe(0);
    expect(factValue({ scale: "-2" }, "22")).toBeCloseTo(0.22);
  });

  it("parses contexts with dimensions, units and labels", () => {
    const c = parseContexts(doc);
    expect(c.get("hand26")?.dims).toEqual([[SEG, "x:HandsetsMember"]]);
    expect(parseUnits(doc).get("usd")).toBe("USD");
    expect(parseLabels(lab).get("x:CustomerXMember")).toBe("Customer X");
    expect(parseInlineFacts(doc).find((f) => f.id === "f2")?.value).toBe(28_000_000_000);
  });
});

describe("filing detail", () => {
  const d = buildDetail({ ticker: "X", accn: "a", form: "10-K", filed: "2026-11-04", reportDate: "2026-09-27", doc: "x.htm", facts: parseInlineFacts(doc), contexts: parseContexts(doc), labels: parseLabels(lab) });

  it("groups revenue by segment with the consolidated total and both years", () => {
    const t = d.tables.find((x) => x.family === "revenue" && x.axis === SEG)!;
    expect(t.rows.map((r) => r.label)).toEqual(["Handsets", "Auto"]);
    expect(t.periods).toHaveLength(2);
    expect(Object.values(t.total ?? {}).map((v) => v.v)).toContain(44_284_000_000);
  });

  it("names countries and states and files them under geography", () => {
    const t = d.tables.find((x) => x.family === "geography")!;
    expect(t.rows.map((r) => r.label)).toEqual(["China", "United States", "Texas"]);
  });

  it("builds the segment P&L from every line tagged per segment", () => {
    expect(d.segments?.segments.map((s) => s.label)).toEqual(["Handsets", "Auto"]);
    expect(d.segments?.rows.map((r) => [r.concept, r.kind])).toEqual([
      ["us-gaap:Revenues", "revenue"],
      ["us-gaap:CostOfRevenue", "cost"],
    ]);
  });

  it("reads customer concentration as a share of revenue", () => {
    const c = d.concentration[0];
    expect([c.kind, c.benchmark, c.label]).toEqual(["customer", "revenue", "Customer X"]);
    expect(Object.values(c.values)[0].v).toBeCloseTo(0.22);
    expect(Object.values(c.values)[0].id).toBe("conc");
  });

  it("lists undimensioned inventory components", () => {
    const t = d.tables.find((x) => x.family === "inventory")!;
    expect(t.rows.map((r) => r.member).sort()).toEqual(["us-gaap:InventoryFinishedGoods", "us-gaap:InventoryRawMaterials"]);
  });

  it("spells out unknown members", () => {
    expect(memberLabel("x:AmericasSegmentMember", new Map())).toBe("Americas Segment");
  });
});

describe("maturity ladders", () => {
  const inst = `<xbrli:instant>2026-09-27</xbrli:instant>`;
  const D = "us-gaap:UnrecordedUnconditionalPurchaseObligationByCategoryOfItemPurchasedAxis";
  const ladderDoc = [
    `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>`,
    ctx("i", inst),
    ctx("fuel", inst, [[D, "x:FuelMember"]]),
    ctx("air", inst, [[D, "x:AircraftMember"]]),
    fact("us-gaap:UnrecordedUnconditionalPurchaseObligationToBePaidYearOne", "fuel", "500"),
    fact("us-gaap:UnrecordedUnconditionalPurchaseObligationToBePaidYearTwo", "fuel", "400"),
    fact("us-gaap:UnrecordedUnconditionalPurchaseObligationToBePaidYearOne", "air", "3,000"),
    fact("us-gaap:UnrecordedUnconditionalPurchaseObligationToBePaidYearTwo", "air", "2,500"),
    fact("us-gaap:PurchaseObligationDueInNextTwelveMonths", "i", "900"),
    fact("us-gaap:PurchaseObligationDueInSecondYear", "i", "800"),
    fact("us-gaap:PurchaseObligationDueAfterFifthYear", "i", "100"),
  ].join("\n");
  const d = buildDetail({ ticker: "X", accn: "a", form: "10-K", filed: "2026-11-04", reportDate: "2026-09-27", doc: "x.htm", facts: parseInlineFacts(ladderDoc), contexts: parseContexts(ladderDoc), labels: new Map() });

  it("merges one table per year into one ladder per obligation", () => {
    const t = d.tables.find((x) => x.axis === D)!;
    expect(t.periods.map((k) => d.periods[k].label)).toEqual(["Year 1", "Year 2"]);
    expect(t.rows.map((r) => [r.label, r.values.B1.v])).toEqual([["Aircraft", 3e9], ["Fuel", 5e8]]);
    expect(d.tables.filter((x) => x.axis === D)).toHaveLength(1);
  });

  it("turns undimensioned due-by-year lines into one row", () => {
    const t = d.tables.find((x) => x.title === "Obligations by year due")!;
    expect(t.rows).toHaveLength(1);
    expect(t.periods).toEqual(["B1", "B2", "B6"]);
  });
});

describe("detail helpers", () => {
  it("labels periods and units", async () => {
    const { detailPeriodLabel, detailUnit } = await import("./detail");
    expect(detailPeriodLabel({ key: "a", start: "2025-09-29", end: "2026-09-27", months: 12 })).toBe("FY2026");
    expect(detailPeriodLabel({ key: "b", start: "2026-04-01", end: "2026-06-30", months: 3 })).toBe("Jun 2026 qtr");
    expect(detailPeriodLabel({ key: "B1", end: "2026-09-27", months: 0, label: "Year 1" })).toBe("Year 1");
    expect([detailUnit("USD"), detailUnit("pure"), detailUnit("Aircraft")]).toEqual(["usd", "pct", "count"]);
  });

  it("measures how much of the total the listed items explain", async () => {
    const { coverageOf } = await import("./detail");
    const t = { periods: ["p"], rows: [{ member: "a", label: "A", values: { p: { v: 60 } } }, { member: "b", label: "B", values: { p: { v: 30 } } }], total: { p: { v: 100 } } } as never;
    expect(coverageOf(t)).toBeCloseTo(0.9);
  });
});

describe("table cleanup", () => {
  const inst = `<xbrli:instant>2026-09-27</xbrli:instant>`;
  const A = "x:AircraftTypeAxis";
  const C = "us-gaap:UnrecordedUnconditionalPurchaseObligationByCategoryOfItemPurchasedAxis";
  const doc2 = [
    `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>`,
    ctx("i", inst),
    ctx("a1", inst, [[A, "x:B737Member"], [C, "x:AircraftMember"]]),
    ctx("a2", inst, [[A, "x:A321Member"], [C, "x:AircraftMember"]]),
    ctx("c1", inst, [[C, "x:AircraftMember"]]),
    ctx("c2", inst, [[C, "x:CarrierMember"]]),
    fact("us-gaap:UnrecordedUnconditionalPurchaseObligationMinimumQuantityRequired", "a1", "100"),
    fact("us-gaap:UnrecordedUnconditionalPurchaseObligationMinimumQuantityRequired", "a2", "68"),
    fact("x:LeasesNotYetCommenced", "c1", "15,400"),
    fact("x:LeasesNotYetCommenced", "c2", "6,030"),
    fact("x:LeasesNotYetCommenced", "i", "122"),
  ].join("\n");
  const d = buildDetail({ ticker: "X", accn: "a", form: "10-K", filed: "2026-11-04", reportDate: "2026-09-27", doc: "x.htm", facts: parseInlineFacts(doc2), contexts: parseContexts(doc2), labels: new Map() });

  it("flattens a nested axis that has a single member", () => {
    const t = d.tables.find((x) => x.axis === A)!;
    expect(t.rows.map((r) => [r.member, r.sub, Object.values(r.values)[0].v])).toEqual([["x:B737Member", undefined, 1e8], ["x:A321Member", undefined, 6.8e7]]);
  });

  it("drops a consolidated figure the items cannot add up to", () => {
    const t = d.tables.find((x) => x.concept === "x:LeasesNotYetCommenced" && x.axis === C);
    expect(t?.total).toBeUndefined();
  });
});

describe("assistant text", () => {
  it("renders a section with its citation", async () => {
    const { detailText } = await import("./text");
    const d = buildDetail({ ticker: "X", accn: "0000-26-1", form: "10-K", filed: "2026-11-04", reportDate: "2026-09-27", doc: "x.htm", facts: parseInlineFacts(doc), contexts: parseContexts(doc), labels: parseLabels(lab) });
    const t = detailText({ ticker: "X", builtAt: "", format: 3, annual: d, quarterly: null }, { section: "concentration" });
    expect(t).toContain("filing:X:0000-26-1:x.htm");
    expect(t).toContain("customer · share of revenue · Customer X: FY2026 22.0%");
    expect(t).not.toContain("Segment P&L");
  });
});
