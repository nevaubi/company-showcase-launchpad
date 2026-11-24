import { describe, expect, it } from "vitest";
import { normParent, parseTri, plantsView, TRI_FACILITIES, TRI_PRODUCTION, TRI_RELEASES, triMatcher, triRows, triText } from "./tri";

const HEAD = '"1. YEAR","2. TRIFD","3. FRS ID","4. FACILITY NAME","6. CITY","7. COUNTY","8. ST","12. LATITUDE","13. LONGITUDE","15. PARENT CO NAME","17. STANDARD PARENT CO NAME","23. INDUSTRY SECTOR","30. PRIMARY NAICS","37. CHEMICAL","46. CARCINOGEN","48. PFAS","50. UNIT OF MEASURE","65. ON-SITE RELEASE TOTAL","88. OFF-SITE RELEASE TOTAL","107. TOTAL RELEASES","119. PRODUCTION WSTE (8.1-8.7)","121. PROD_RATIO_OR_ ACTIVITY","122. 8.9 - PRODUCTION RATIO"';
const line = (trifd: string, name: string, st: string, parent: string, chem: string, total: number, ratio: string, unit = "Pounds", kind = "PRODUCTION") =>
  `2024,${trifd},1100${trifd.length},"${name}",TOWN,HARRIS,${st},40.1,-80.2,"${parent} SUB","${parent}",Chemicals,325199,"${chem}",NO,NO,${unit},${total},0,${total},${total * 2},${kind},${ratio}`;
const csv = [
  HEAD,
  line("A1", "PLANT ONE, UNIT 2", "TX", "ACME CHEMICAL CORP", "TOLUENE", 1000, "1.10"),
  line("A1", "PLANT ONE, UNIT 2", "TX", "ACME CHEMICAL CORP", "XYLENE", 500, "1.30"),
  line("A2", "PLANT TWO", "LA", "ACME CHEMICAL CORP", "DIOXIN", 453.592, "", "Grams", ""),
  line("A3", "PLANT THREE", "TX", "ACME CHEMICAL CORP", "TOLUENE", 10, "0.80"),
  line("B1", "OTHER PLANT", "OH", "SOMEONE ELSE INC", "LEAD", 99, "1.00"),
].join("\n");

describe("parseTri", () => {
  it("reads the numbered headers, quoted names and converts grams to pounds", () => {
    const r = parseTri(csv);
    expect(r).toHaveLength(5);
    expect(r[0]).toMatchObject({ trifd: "A1", facility: "PLANT ONE, UNIT 2", state: "TX", parent: "ACME CHEMICAL CORP", releases: 1000, ratio: 1.1, ratioKind: "PRODUCTION" });
    expect(r[2].releases).toBeCloseTo(1);
    expect(r[2].ratio).toBeNull();
  });
});

describe("triMatcher", () => {
  const m = triMatcher(
    [
      { ticker: "ACME", shortName: "Acme", legal: "Acme Chemical Corporation", industry: "Chemicals" },
      { ticker: "HAL", shortName: "Halliburton", legal: "Halliburton Company", industry: "Energy Equipment & Services" },
      { ticker: "BANR", shortName: "Banner", legal: "Banner Corporation", industry: "Banks" },
      { ticker: "SABR", shortName: "Sabre", legal: "Sabre Corporation", industry: "Software" },
      { ticker: "WMB", shortName: "Williams Companies", legal: "Williams Companies, Inc.", industry: "Oil & Gas Midstream" },
      { ticker: "KALU", shortName: "Kaiser Aluminum", legal: "Kaiser Aluminum Corporation", industry: "Metals & Mining" },
      { ticker: "CRH", shortName: "CRH", legal: "CRH plc", industry: "Construction Materials" },
      { ticker: "LYB", shortName: "LyondellBasell", legal: "Lyondellbasell Industries N V", industry: "Chemicals" },
      { ticker: "FOXA", shortName: "Fox Corp", legal: "Fox Corporation", industry: "Media" },
      { ticker: "FOX", shortName: "Fox Corp", legal: "Fox Corporation", industry: "Media" },
    ],
    { "crh americas": "CRH" },
  );
  it("matches legal names exactly, after dropping a subsidiary descriptor, and by a multi-word legal prefix", () => {
    expect(m("ACME CHEMICAL CORP")).toBe("ACME");
    expect(m("HALLIBURTON ENERGY SERVICES INC")).toBe("HAL");
    expect(m("KAISER ALUMINUM FABRICATED PRODUCTS LLC")).toBe("KALU");
    expect(m("CRH AMERICAS INC")).toBe("CRH");
    expect(m("LYONDELLBASELL FINANCE CO")).toBe("LYB");
    expect(m("LYONDELLBASELL INDUSTRIES NV")).toBe("LYB");
  });
  it("refuses one-word look-alikes in plant-less industries or common words, and names two tickers share", () => {
    expect(m("BANNER INDUSTRIES LLC")).toBeNull();
    expect(m("SABRE INDUSTRIES INC")).toBeNull();
    expect(m("WILLIAMS INTERNATIONAL CO LLC")).toBeNull();
    expect(m("FOX CORP")).toBeNull();
    expect(m("ACME")).toBeNull(); // short name alone is one word and not a legal name
  });
  it("normalizes punctuation and corporate suffixes", () => {
    expect(normParent("THE SHERWIN-WILLIAMS CO")).toBe("sherwin williams");
    expect(normParent("GENERAL ELECTRIC CO (GE CO)")).toBe("general electric");
  });
});

describe("triRows", () => {
  it("rolls plants up per company with states, releases and a production index", () => {
    const match = (p: string) => (p === "ACME CHEMICAL CORP" ? "ACME" : null);
    const rows = triRows(2024, parseTri(csv), match);
    expect(rows.every((r) => r.ticker === "ACME")).toBe(true);
    const fac = rows.find((r) => r.title === TRI_FACILITIES)!;
    expect(fac.value).toBe(3);
    expect(fac.meta.states).toEqual([{ state: "TX", facilities: 2, releases: 1510 }, { state: "LA", facilities: 1, releases: 1 }]);
    const p1 = (fac.meta.facilities as { id: string; ratio: number | null; chemicals: number; url: string }[]).find((f) => f.id === "A1")!;
    expect(p1.ratio).toBeCloseTo(1.2); // median of 1.10 and 1.30
    expect(p1.chemicals).toBe(2);
    expect(p1.url).toContain("echo.epa.gov/detailed-facility-report?fid=");
    expect(rows.find((r) => r.title === TRI_RELEASES)!.value).toBeCloseTo(1511);
    const prod = rows.find((r) => r.title === TRI_PRODUCTION)!;
    // facilities with a production ratio: A1 (1.2) and A3 (0.8) → median 1.0; one up, one down
    expect(prod.value).toBeCloseTo(1);
    expect(prod.meta).toMatchObject({ facilities: 2, up: 1, down: 1 });
  });
});

describe("triText", () => {
  it("summarises plants by year, the largest plants with their EPA links and the production index", () => {
    const match = (p: string) => (p === "ACME CHEMICAL CORP" ? "ACME" : null);
    const rows = triRows(2024, parseTri(csv), match);
    const t = triText(rows, "ACME");
    expect(t).toContain("2024: 3 plants, 1.5K lb released, production 1.000");
    expect(t).toContain("STATES 2024: TX 2 (1.5K lb), LA 1 (1 lb)");
    expect(t).toMatch(/PLANT ONE, UNIT 2, TOWN TX · Chemicals · 1\.5K lb · 2 chemicals · production ratio 1\.20 <https:\/\/echo\.epa\.gov/);
  });
});

describe("plantsView: the tile never contradicts its panel (p5-shots M12)", () => {
  it("counts plants with no states or names: no 'in 0 states', one note, nothing to draw", () => {
    const v = plantsView(11, { states: [], facilities: [] }, 2024);
    expect(v.where).toBeNull();
    expect(v.states).toEqual([]);
    expect(v.note).toBe("The EPA file for 2024 counts 11 plants for this company but names none, so there is no map or plant list.");
    expect(plantsView(11, null, 2024).where).toBeNull();
  });
  it("states without plant names: the grid is drawn and the list says it has no names", () => {
    const v = plantsView(3, { states: [{ state: "TX", facilities: 2, releases: 10 }, { state: "CA", facilities: 1, releases: 5 }] }, 2024);
    expect(v.where).toBe("in 2 states");
    expect(v.note).toBe("The EPA file for 2024 lists no plant names for this company.");
  });
  it("full detail: no note, one state in the singular", () => {
    const f = { name: "A", city: "X", state: "TX", releases: 1, chemicals: 1, url: "", ratio: null };
    const v = plantsView(1, { states: [{ state: "TX", facilities: 1, releases: 1 }], facilities: [f] }, 2024);
    expect(v.where).toBe("in 1 state");
    expect(v.note).toBeNull();
    expect(v.facilities).toHaveLength(1);
  });
});
