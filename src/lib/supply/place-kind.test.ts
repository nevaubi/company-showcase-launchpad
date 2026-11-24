import { describe, expect, it } from "vitest";
import { countryExposure, regionShock } from "./analytics";
import type { ProLink } from "./core";
import { countryOf, placeKind } from "./place-kind";
import { PRODUCTION_REGIONS } from "./place-kind.fixture";

const link = (regions: string[], quote: string, p: Partial<ProLink> = {}): ProLink => ({
  id: Math.random().toString(36).slice(2), ticker: "X", counterparty: "Acme Corp", counterparty_ticker: null, counterparty_domain: null,
  relation: "supplier", detail: "", share_pct: null, quote, accn: "a", doc: "d", form: "10-K", filed: "2026-01-01", regions, ...p,
});

/* The region names production links carry most often (current links, 24 Nov 2026): Texas 96, California 70, Ohio 34,
   New York 27, Arizona 26, Georgia 23, Puerto Rico 16; Europe 183, Asia 62, Middle East 49. */
describe("region kinds (supply-globe-M5)", () => {
  it("U.S. states and territories count toward the United States", () => {
    for (const s of ["Texas", "California", "Ohio", "New York", "Arizona", "Puerto Rico", "Washington", "New Mexico"]) expect(countryOf(s), s).toBe("United States");
    expect(placeKind("New Mexico")).toEqual({ kind: "state", state: "New Mexico", country: "United States" });
  });
  it("supranational regions are their own kind and never a country", () => {
    for (const r of ["Europe", "Asia", "Middle East", "the Middle East", "Asia Pacific", "EMEA", "Latin America", "Europe region"]) {
      expect(placeKind(r)?.kind, r).toBe("region");
      expect(countryOf(r), r).toBeNull();
    }
  });
  it("Georgia is the U.S. state unless the sentence points at the Caucasus", () => {
    expect(countryOf("Georgia", "our manufacturing plant in Savannah, Georgia")).toBe("United States");
    expect(countryOf("Georgia", "facilities in the state of Georgia")).toBe("United States");
    expect(countryOf("Georgia", "a pipeline through Tbilisi")).toBe("Georgia");
    expect(countryOf("Georgia", "subsidiaries in Armenia, Georgia and Azerbaijan")).toBe("Georgia");
    expect(placeKind("Georgia", "operations in Georgia")).toEqual({ kind: "state", state: "Georgia", country: "United States" });
  });
  it("countries keep their canonical names", () => {
    expect(countryOf("Taiwan")).toBe("Taiwan");
    expect(countryOf("PRC")).toBe("China");
    expect(countryOf("Israel")).toBe("Israel");
  });

  it("the register's rows hold countries only", () => {
    const rows = countryExposure([
      link(["Texas", "California"], "We operate fabs in Austin, Texas and San Jose, California."),
      link(["Georgia"], "Our plant in Atlanta, Georgia supplies us."),
      link(["Georgia"], "Our plant in Tbilisi supplies us."),
      link(["Europe", "Asia", "Middle East"], "We sell across Europe, Asia and the Middle East."),
      link(["Taiwan"], "TSMC manufactures our wafers in Taiwan."),
    ], [], {}).map((r) => r.country);
    expect(rows).toContain("United States");
    expect(rows).toContain("Taiwan");
    for (const no of ["Texas", "California", "Europe", "Asia", "Middle East"]) expect(rows, no).not.toContain(no);
    expect(rows).toContain("Georgia");
  });
  it("a United States row counts a link once even when it names two states", () => {
    const us = countryExposure([link(["Texas", "Ohio"], "Plants in Texas and Ohio.")], [], {}).find((r) => r.country === "United States");
    expect(us?.links).toBe(1);
  });
  it("a region shock on Georgia the country does not hit a company whose sentence is about the state", () => {
    const hits = regionShock("Georgia", [link(["Georgia"], "Our plant in Atlanta, Georgia supplies us.", { ticker: "AFL" })], [], {});
    expect(hits).toEqual([]);
  });
});

/* p3-sup-M1: the classifier called 329 production names (692 entries) countries that are not ("Gulf Coast", "Los Angeles",
   "E.U.", "Quebec", "Malta, New York"), and let negated names through. A name is a country only when the country table has it. */
describe("only countries are countries (p3-sup-M1, 561 production names)", () => {
  const kinds = new Map(PRODUCTION_REGIONS.map(([n]) => [n, placeKind(n)!]));
  it("the reviewer's names land where they are", () => {
    const want: [string, string, string | null][] = [
      ["Gulf Coast", "local", "United States"], ["Williston Basin", "local", "United States"], ["Los Angeles", "local", "United States"],
      ["southern U.S.", "local", "United States"], ["Western Interconnection", "local", "United States"], ["Permian Basin", "local", "United States"],
      ["Atlanta, Georgia", "local", "United States"], ["Covington, Georgia", "local", "United States"], ["Malta, New York", "local", "United States"],
      ["Cobb County", "local", "United States"], ["Seattle, WA", "local", "United States"], ["Hawai'i", "state", "United States"],
      ["Washington", "state", "United States"], ["New York State", "state", "United States"],
      ["Quebec", "local", "Canada"], ["British Columbia", "local", "Canada"], ["Alberta", "local", "Canada"], ["Victoria", "local", "Australia"],
      ["Northern Territory", "local", "Australia"], ["London", "local", "United Kingdom"], ["London, U.K.", "local", "United Kingdom"],
      ["Beijing", "local", "China"], ["Shanghai", "local", "China"],
      ["E.U.", "region", null], ["EEA", "region", null], ["European Economic Area", "region", null], ["CIS", "region", null], ["ASEAN", "region", null],
      ["Northern Africa", "region", null], ["Gulf Cooperation Council", "region", null],
      ["Outside the United States", "residual", null], ["Outside the U.S.", "residual", null], ["Worldwide excluding China", "residual", null],
      ["Asia excluding Japan", "residual", null], ["Rest of world", "residual", null], ["International markets", "residual", null],
      ["Taiwan region", "country", "Taiwan"], ["Hong Kong SAR", "country", "Hong Kong"], ["Türkiye", "country", "Turkey"], ["Brasil", "country", "Brazil"],
      ["The Netherlands", "country", "Netherlands"], ["Scotland", "country", "United Kingdom"], ["Continental United States (excluding Alaska)", "country", "United States"],
      ["Birmingham", "unknown", null], ["Richmond", "unknown", null],
    ];
    for (const [n, kind, country] of want) {
      expect(kinds.get(n)?.kind, n).toBe(kind);
      expect(countryOf(n), n).toBe(country);
    }
  });
  it("every name classed a country is a real country, and a name no table knows is never one", () => {
    const countries = [...kinds.values()].filter((k) => k.kind === "country").map((k) => (k as { country: string }).country);
    expect(new Set(countries).size).toBeLessThan(110);
    for (const c of ["Gulf Coast", "Los Angeles", "Quebec", "E.U.", "Delaware Basin", "Atlantic Seaboard", "Chicago", "Denver", "Orlando"]) expect(countries, c).not.toContain(c);
    const counts: Record<string, number> = {};
    for (const k of kinds.values()) counts[k.kind] = (counts[k.kind] ?? 0) + 1;
    expect(counts).toEqual({ country: 125, state: 57, local: 282, region: 42, residual: 44, unknown: 11 });
  });
  it("no negated name reaches the region shock's country list", () => {
    // the one exception is a country with a part left out, which is still that country
    for (const [n] of PRODUCTION_REGIONS) if (/\b(outside|exclud|except|ex-|non-)/i.test(n) && !n.startsWith("Continental")) expect(countryOf(n), n).toBeNull();
  });
});

/* p3-sup-M2: the 23 current production links that name Georgia (24 Nov 2026), each with its counterparty and sentence.
   None is the country; the old rule left 21 undecided. */
const GEORGIA_ROWS: [string, string, string][] = [
  ["ACHR", "Newton County Industrial Development Authority", "the Company entered into a lease arrangement with the Newton County Industrial Development Authority (the \"Authority\") for the Company s manufacturing facilities to be constructed in Covington, Georgia."],
  ["ADUS", "AccentCare, Inc.", "entered into a definitive equity and asset purchase agreement to acquire the personal care division of AccentCare, Inc. for an anticipated purchase price, after customary purchase price adjustments, of approximately $275.0 million."],
  ["AFL", "KPMG LLP", "KPMG LLP (PCAOB Firm ID 185 ), an independent registered public accounting firm, has issued an attestation report from the firm's location in Atlanta, Georgia on the effectiveness of internal control over the Company's financial reporting"],
  ["AZZ", "WECTEC", "In addition, the agreement included the forgiveness of AZZ's receivable from WECTEC of $ 3.7 million, which was fully reserved by AZZ."],
  ["BATRA", "Cobb County", "The Stadium Operating Agreement is terminable by Cobb County and the Cobb-Marietta Coliseum and Exhibit Hall Authority upon the occurrence of certain events of default"],
  ["BATRA", "Cobb-Marietta Coliseum and Exhibit Hall Authority", "The Stadium Operating Agreement is terminable by Cobb County and the Cobb-Marietta Coliseum and Exhibit Hall Authority upon the occurrence of certain events of default"],
  ["CC", "Mohawk Industries, Inc.", "Aladdin Manufacturing Corporation, Mohawk Industries, Inc. and Mohawk Carpet, LLC (hereinafter \"Mohawk\"), which are carpet manufacturers with operations in Georgia, sued carpet treatment chemical suppliers 3M, EID, Daikin and the Company"],
  ["CC", "Aladdin Manufacturing Corporation", "Aladdin Manufacturing Corporation, Mohawk Industries, Inc. and Mohawk Carpet, LLC (hereinafter \"Mohawk\"), which are carpet manufacturers with operations in Georgia, sued carpet treatment chemical suppliers 3M, EID, Daikin and the Company"],
  ["CC", "Mohawk Carpet, LLC", "Aladdin Manufacturing Corporation, Mohawk Industries, Inc. and Mohawk Carpet, LLC (hereinafter \"Mohawk\"), which are carpet manufacturers with operations in Georgia, sued carpet treatment chemical suppliers 3M, EID, Daikin and the Company"],
  ["CUBE", "191 IV CUBE LLC", "we acquired our partner s 80% ownership interest in 191 IV CUBE LLC (\"HVP IV\"), an unconsolidated real estate venture in which we previously owned a 20% noncontrolling interest."],
  ["EHC", "Piedmont", "began operating our new 40-bed inpatient rehabilitation hospital in Loganville, Georgia with our joint venture partner Piedmont in June;"],
  ["ELV", "Blue Cross and Blue Shield Association", "license agreements with the BCBSA that entitle us to the exclusive, and in certain areas, non-exclusive, use of the Blue Cross and Blue Shield names and marks in assigned geographic territories."],
  ["ELV", "Blue Cross and Blue Shield Association", "We are an independent licensee of the Blue Cross and Blue Shield Association (\"BCBSA\"), an association of independent health benefit plans."],
  ["MMM", "Mohawk Industries", "Mohawk Industries, a carpet manufacturer, filed a lawsuit in Whitfield County, Georgia state court against the Company and other defendants, including DuPont, and Daikin, alleging various counts of tort and contract liability"],
  ["PNFP", "Synovus Financial Corp.", "risks related to our ability to realize the anticipated benefits from our combination with Synovus, and integrating Pinnacle Financial's and Synovus's operations"],
  ["ROL", "Marathon Health", "We have continued our partnership with Marathon Health to provide an on-site medical clinic at our Rollins Support Center in Atlanta."],
  ["SO", "Dalton", "Dalton serves its requirements from self-owned generation facilities, some of which are jointly-owned with Georgia Power, and through purchases from Southern Power through a service agreement."],
  ["SO", "MEAG Power", "MEAG Power serves these requirements from self-owned generation facilities, some of which are jointly-owned with Georgia Power, and purchases from other resources."],
  ["SO", "MEAG Power", "as well as in rural areas, and at wholesale to OPC, MEAG Power, Dalton, various EMCs, and non-affiliated utilities."],
  ["SO", "OPC", "Georgia Power and OPC have a license, expiring on December 31, 2026, for the Rocky Mountain project, a pure pumped storage facility of 903,000 KW installed capacity."],
  ["SO", "OPC", "as well as in rural areas, and at wholesale to OPC, MEAG Power, Dalton, various EMCs, and non-affiliated utilities."],
  ["SO", "SNG", "Gas pipeline investments primarily consists of joint ventures in natural gas pipeline investments including a 50% interest in SNG and a 50% joint ownership interest in the Dalton Pipeline."],
  ["SO", "Dalton", "Dalton serves its requirements from self-owned generation facilities, some of which are jointly-owned with Georgia Power, and through purchases from Southern Power through a service agreement."],
];
describe("Georgia on the 23 production links (p3-sup-M2)", () => {
  it("all 23 are the U.S. state and count toward the United States", () => {
    expect(GEORGIA_ROWS).toHaveLength(23);
    for (const [t, cp, q] of GEORGIA_ROWS) {
      expect(placeKind("Georgia", q), `${t} ${cp}`).toEqual({ kind: "state", state: "Georgia", country: "United States" });
    }
    const us = countryExposure(GEORGIA_ROWS.map(([t, cp, q]) => link(["Georgia"], q, { ticker: t, counterparty: cp })), [], {}).find((r) => r.country === "United States");
    expect(us?.links).toBe(23);
  });
});
