import { describe, expect, it } from "vitest";
import { buildDetail, dedupeSegmentRows, memberLabel } from "./detail";
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

describe("banks and lenders", () => {
  const ye = (y: number) => `<xbrli:instant>${y}-12-31</xbrli:instant>`;
  const yr = (y: number) => `<xbrli:startDate>${y}-01-01</xbrli:startDate><xbrli:endDate>${y}-12-31</xbrli:endDate>`;
  const P = "us-gaap:FinancingReceivablePortfolioSegmentAxis";
  const K = "us-gaap:FinancingReceivableRecordedInvestmentByClassOfFinancingReceivableAxis";
  const IND = "us-gaap:EquitySecuritiesByIndustryAxis";
  const FICO = "us-gaap:CreditScoreFicoAxis";
  const M = "us-gaap:RiskWeightedAssetsCalculationMethodologyAxis";
  const LOANS = "us-gaap:FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss";
  const bank = [
    `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>`,
    ctx("i25", ye(2025)),
    ctx("i24", ye(2024)),
    ctx("d25", yr(2025)),
    ctx("cons", ye(2025), [[P, "us-gaap:ConsumerPortfolioSegmentMember"]]),
    ctx("whl", ye(2025), [[P, "x:WholesaleMember"]]),
    ctx("card", ye(2025), [[P, "us-gaap:ConsumerPortfolioSegmentMember"], [K, "us-gaap:CreditCardReceivablesMember"]]),
    ctx("mort", ye(2025), [[P, "us-gaap:ConsumerPortfolioSegmentMember"], [K, "us-gaap:ResidentialMortgageMember"]]),
    ctx("re", ye(2025), [[IND, "x:RealEstateMember"], [P, "x:WholesaleMember"]]),
    ctx("tech", ye(2025), [[IND, "x:TechnologyMember"], [P, "x:WholesaleMember"]]),
    ctx("hi", ye(2025), [[P, "us-gaap:ConsumerPortfolioSegmentMember"], [FICO, "x:Above660Member"]]),
    ctx("lo", ye(2025), [[P, "us-gaap:ConsumerPortfolioSegmentMember"], [FICO, "x:Below660Member"]]),
    ctx("ncoC", yr(2025), [[P, "us-gaap:ConsumerPortfolioSegmentMember"]]),
    ctx("ncoW", yr(2025), [[P, "x:WholesaleMember"]]),
    ctx("std", ye(2025), [[M, "x:StandardizedMember"]]),
    ctx("adv", ye(2025), [[M, "x:AdvancedMember"]]),
    fact(LOANS, "i25", "1,400"),
    fact(LOANS, "cons", "600"),
    fact(LOANS, "whl", "800"),
    fact(LOANS, "card", "230"),
    fact(LOANS, "mort", "370"),
    fact(LOANS, "re", "150"),
    fact(LOANS, "tech", "90"),
    fact(LOANS, "hi", "500"),
    fact(LOANS, "lo", "100"),
    fact("us-gaap:FinancingReceivableExcludingAccruedInterestYearOneOriginatedCurrentFiscalYear", "card", "50"),
    fact("us-gaap:FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoffAfterRecovery", "ncoC", "9"),
    fact("us-gaap:FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoffAfterRecovery", "ncoW", "1"),
    fact("us-gaap:InterestBearingDepositLiabilitiesDomestic", "i25", "1,500"),
    fact("us-gaap:NoninterestBearingDepositLiabilitiesDomestic", "i25", "500"),
    fact("us-gaap:Deposits", "i25", "2,100"),
    fact("us-gaap:Deposits", "i24", "2,000"),
    fact("us-gaap:Deposits", "d25", "9"),
    fact("us-gaap:CapitalToRiskWeightedAssets", "std", "15"),
    fact("us-gaap:CapitalToRiskWeightedAssets", "adv", "16"),
  ].join("\n");
  const d = buildDetail({ ticker: "B", accn: "b", form: "10-K", filed: "2026-02-15", reportDate: "2025-12-31", doc: "b.htm", facts: parseInlineFacts(bank), contexts: parseContexts(bank), labels: new Map() });
  const lending = d.tables.filter((t) => t.family === "lending");

  it("builds the loan book by portfolio with classes nested and the consolidated total", () => {
    const t = lending.find((x) => x.axis === "us-gaap:FinancingReceivablePortfolioSegmentAxis" && x.concept === "us-gaap:FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss")!;
    expect(t.title).toBe("Loans by loan portfolio and loan class");
    expect(t.rows.map((r) => [r.label, r.values[t.periods[0]]?.v])).toEqual([["Wholesale", 8e8], ["Consumer Portfolio Segment", 6e8]]);
    expect(t.rows[1].sub?.map((s) => s.label)).toEqual(["Residential Mortgage", "Credit Card Receivables"]);
    expect(t.total?.I2025_12_31 ?? Object.values(t.total ?? {})[0]).toMatchObject({ v: 1.4e9 });
  });

  it("shows wholesale loans by industry", () => {
    const t = lending.find((x) => x.axis === IND)!;
    expect(t.rows.map((r) => r.label)).toEqual(["Real Estate", "Technology"]);
    expect(t.title).toContain("— Wholesale");
    // the firm-wide loan total is not the wholesale slice's total
    expect(t.total).toBeUndefined();
  });

  it("keeps net charge-offs by portfolio and leaves vintage and credit-score cuts out", () => {
    expect(lending.find((x) => /Net charge-offs/.test(x.title))?.rows).toHaveLength(2);
    expect(d.tables.some((x) => x.axis === FICO || /Originated/.test(x.concept))).toBe(false);
  });

  it("lists deposit types as overlapping lines with the total among them", () => {
    const t = lending.find((x) => x.title === "Deposits by type")!;
    expect(t.overlap).toBe(true);
    expect(t.total).toBeUndefined();
    expect(t.rows[0]).toMatchObject({ label: "Total deposits" });
    expect(t.periods).toHaveLength(2);
  });

  it("files capital ratios under regulatory capital", () => {
    const t = d.tables.find((x) => x.family === "capital")!;
    expect(t.rows.map((r) => r.label)).toEqual(["Advanced", "Standardized"]);
  });
});

describe("twin members", () => {
  it("merges one item tagged under two members, never two items that differ", async () => {
    const { mergeTwins } = await import("./detail");
    const row = (member: string, vals: Record<string, number>) => ({ member, label: member, values: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { v }])) });
    const out = mergeTwins([row("card", { a: 211, b: 232 }), row("cardSeg", { y: 190, a: 211, b: 232 }), row("auto", { a: 211, b: 99 })]);
    expect(out.map((r) => r.member)).toEqual(["cardSeg", "auto"]);
    expect(Object.keys(out[0].values).sort()).toEqual(["a", "b", "y"]);
    // A single shared period is not enough evidence.
    expect(mergeTwins([row("x", { a: 5 }), row("y", { a: 5 })])).toHaveLength(2);
  });
});

describe("annual balance columns", () => {
  it("keeps fiscal year-ends and drops an acquisition-date balance", () => {
    const at = (d: string) => `<xbrli:instant>${d}</xbrli:instant>`;
    const doc3 = [
      `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>`,
      ctx("a", at("2025-12-31")),
      ctx("b", at("2024-12-31")),
      ctx("acq", at("2025-05-18")),
      fact("us-gaap:Deposits", "a", "300"),
      fact("us-gaap:Deposits", "b", "250"),
      fact("us-gaap:Deposits", "acq", "100"),
      fact("us-gaap:TimeDeposits", "a", "40"),
    ].join("\n");
    const d = buildDetail({ ticker: "C", accn: "c", form: "10-K", filed: "2026-02-20", reportDate: "2025-12-31", doc: "c.htm", facts: parseInlineFacts(doc3), contexts: parseContexts(doc3), labels: new Map() });
    const t = d.tables.find((x) => x.title === "Deposits by type")!;
    expect(t.periods.map((k) => d.periods[k].end)).toEqual(["2024-12-31", "2025-12-31"]);
  });
});

describe("insurers", () => {
  const P = "srt:ProductOrServiceAxis";
  const ins = [
    `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>`,
    ctx("c26", fy(2026)),
    ctx("bi", fy(2026), [[SEG, "x:BusinessMember"]]),
    ctx("pi", fy(2026), [[SEG, "x:PersonalMember"]]),
    ctx("oth", fy(2026), [[SEG, "x:OtherMember"]]),
    ctx("auto", fy(2026), [[P, "x:AutoMember"]]),
    ctx("home", fy(2026), [[P, "x:HomeMember"]]),
    ctx("ay", fy(2026), [[P, "x:AutoMember"], ["us-gaap:ShortdurationInsuranceContractsAccidentYearAxis", "x:Y2024Member"]]),
    fact("us-gaap:PremiumsEarnedNet", "c26", "40,000"),
    fact("us-gaap:PremiumsEarnedNet", "bi", "22,000", ' id="pe1"'),
    fact("us-gaap:PremiumsEarnedNet", "pi", "18,000"),
    // Schedule III repeats the same figures and lists an empty segment
    fact("us-gaap:SupplementaryInsuranceInformationPremiumRevenue", "bi", "22,000"),
    fact("us-gaap:SupplementaryInsuranceInformationPremiumRevenue", "pi", "18,000"),
    fact("us-gaap:SupplementaryInsuranceInformationPremiumRevenue", "oth", "0"),
    fact("us-gaap:PolicyholderBenefitsAndClaimsIncurredNet", "bi", "14,300", ' id="ls1"'),
    fact("us-gaap:PolicyholderBenefitsAndClaimsIncurredNet", "pi", "11,700"),
    fact("us-gaap:UnderwritingIncomeLoss", "bi", "1,900"),
    fact("us-gaap:UnderwritingIncomeLoss", "pi", "900"),
    fact("us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense", "auto", "(1,880)", ' sign="-"'),
    fact("us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense", "home", "128"),
    fact("us-gaap:ShortdurationInsuranceContractsIncurredClaimsAndAllocatedClaimAdjustmentExpenseNet", "ay", "9,000"),
  ].join("\n");
  const d = buildDetail({ ticker: "TRV", accn: "a", form: "10-K", filed: "2026-11-01", reportDate: "2026-09-27", doc: "d.htm", facts: parseInlineFacts(ins, parseUnits(ins)), contexts: parseContexts(ins), labels: new Map() });
  const t = (title: string) => d.tables.find((x) => x.family === "insurance" && x.title === title);

  it("reads premiums, losses and prior-year development by segment and line into Premiums & claims", () => {
    expect(t("Net premiums earned by segment")?.rows.map((r) => Object.values(r.values)[0].v)).toEqual([22e9, 18e9]);
    expect(Object.values(t("Losses and benefits incurred by segment")!.rows[0].values)[0].id).toBe("ls1");
    const dev = t("Prior-year reserve development (+ = adverse) by product / service")!;
    expect(dev.rows.map((r) => Object.values(r.values)[0].v)).toEqual([-1.88e9, 128e6]);
  });

  it("keeps one copy of the Schedule III repeat and drops its empty segment", () => {
    expect(d.tables.filter((x) => x.family === "insurance" && /premium/i.test(x.title) && x.axis === SEG)).toHaveLength(1);
  });

  it("leaves claim-development triangles out", () => {
    expect(d.tables.some((x) => /Shortduration/i.test(x.concept))).toBe(false);
  });

  it("gives the segment P&L premiums as revenue, losses as cost and underwriting income as profit", () => {
    const kinds = Object.fromEntries(d.segments!.rows.map((r) => [r.concept, r.kind]));
    expect(kinds["us-gaap:PremiumsEarnedNet"]).toBe("revenue");
    expect(kinds["us-gaap:PolicyholderBenefitsAndClaimsIncurredNet"]).toBe("cost");
    expect(kinds["us-gaap:UnderwritingIncomeLoss"]).toBe("profit");
  });

  it("keeps consolidated premiums for cross-insurer comparisons", () => {
    expect(Object.values(d.consolidated?.["us-gaap:PremiumsEarnedNet"] ?? {})[0]?.v).toBe(40e9);
  });
});

describe("dedupeSegmentRows", () => {
  const v = (n: number) => ({ v: n, src: {} as never });
  it("drops a Schedule III copy of a segment line and keeps the segment-note concept", () => {
    const rows = [
      { concept: "us-gaap:SupplementaryInsuranceInformationPremiumRevenue", values: { A: { FY25: v(22412) }, B: { FY25: v(17395) }, O: { FY25: v(0) } } },
      { concept: "us-gaap:PremiumsEarnedNet", values: { A: { FY25: v(22412) }, B: { FY25: v(17395) } } },
      { concept: "us-gaap:PolicyholderBenefitsAndClaimsIncurredNet", values: { A: { FY25: v(14154) }, B: { FY25: v(11303) } } },
    ];
    expect(dedupeSegmentRows(rows).map((r) => r.concept)).toEqual(["us-gaap:PremiumsEarnedNet", "us-gaap:PolicyholderBenefitsAndClaimsIncurredNet"]);
  });
  it("keeps the row with more reported segments and never merges lines that differ", () => {
    const rows = [
      { concept: "us-gaap:GeneralAndAdministrativeExpense", values: { A: { FY25: v(3482) }, B: { FY25: v(1746) } } },
      { concept: "us-gaap:OtherCostAndExpenseOperating", values: { A: { FY25: v(3482) }, B: { FY25: v(1746) }, O: { FY25: v(474) } } },
      { concept: "us-gaap:DepreciationAndAmortization", values: { A: { FY25: v(3482) }, B: { FY25: v(182) } } },
    ];
    expect(dedupeSegmentRows(rows).map((r) => r.concept)).toEqual(["us-gaap:OtherCostAndExpenseOperating", "us-gaap:DepreciationAndAmortization"]);
  });
});

