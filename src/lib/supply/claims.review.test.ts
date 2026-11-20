// The independent review's adversarial sentences (review_supply.md, C1-C14, at fc2ca41), each with the counterparty the
// link would carry, plus the stored production rows it named. Each case failed before U1d; these pin the fixed reading.
import { describe, expect, it } from "vitest";
import { amountInQuote, amountKind, auditClaims, checkAmount, checkPartyAmount, contextScale, linkNature, maskOrgNames, namesParty, regionsInQuote, soleSourceInQuote, trustLink } from "./claims";

const flowOf = (quote: string, counterparty: string, amount: number, relation = "customer") => {
  const t = trustLink({ quote, relation, counterparty, amount_usd: amount });
  return t.flow_usd != null ? `flow:${t.amount_kind}` : t.amount_usd != null ? `kept:${t.amount_kind}` : "dropped";
};

describe("C1: a figure counts only when the sentence ties it to the counterparty", () => {
  it("drops the filer's own total and a percentage's base", () => {
    expect(checkPartyAmount("Bosch accounted for 12% of our $2.5 billion revenue.", 2.5e9, "Robert Bosch GmbH")).toMatchObject({ ok: false, why: "base" });
    expect(checkPartyAmount("Bosch accounted for $2.5 billion, or 12%, of our $20.8 billion revenue.", 20.8e9, "Bosch")).toMatchObject({ ok: false, why: "base" });
    expect(checkPartyAmount("Bosch, our largest customer, accounted for 18% of our revenue of $4.1 billion.", 4.1e9, "Bosch")).toMatchObject({ ok: false, why: "base" });
    expect(checkPartyAmount("Our total revenue was $20 billion, of which Apple accounted for 12%.", 20e9, "Apple Inc.")).toMatchObject({ ok: false, why: "base" });
  });
  it("keeps the party's own figure in the same sentences", () => {
    expect(checkPartyAmount("Bosch accounted for $2.5 billion, or 12%, of our $20.8 billion revenue.", 2.5e9, "Bosch").ok).toBe(true);
    expect(checkPartyAmount("Sales to AT&T were $500.7 million, or 10.5% of total revenue, in fiscal 2025", 500.7e6, "AT&T").ok).toBe(true);
    expect(checkPartyAmount("In December 2025, CEPI agreed to invest up to $54.3 million to support a pivotal Phase 3 clinical trial", 54.3e6, "Coalition for Epidemic Preparedness Innovations").ok).toBe(true);
  });
  it("drops another named party's figure", () => {
    expect(checkPartyAmount("Sales to Home Depot were $2.1 billion; receivables from Lowe's were $300 million.", 2.1e9, "Lowe's Companies")).toMatchObject({ ok: false, why: "other-party" });
    expect(checkPartyAmount("Sales to Home Depot were $2.1 billion; receivables from Lowe's were $300 million.", 3e8, "Lowe's Companies").ok).toBe(true);
  });
  it("in a list, keeps only the figure in the party's place, or the latest year's", () => {
    const q = "Sales to Apple, Dell and HP were $195 million, $170 million and $121 million, respectively.";
    expect(checkPartyAmount(q, 170e6, "Dell Technologies").ok).toBe(true);
    expect(checkPartyAmount(q, 195e6, "Dell Technologies")).toMatchObject({ ok: false, why: "list-position" });
    const y = "Revenue from Bosch was $195 million, $170 million and $121 million in 2025, 2024 and 2023, respectively.";
    expect(checkPartyAmount(y, 195e6, "Bosch").ok).toBe(true);
    expect(checkPartyAmount(y, 121e6, "Bosch")).toMatchObject({ ok: false, why: "list-position" });
    // stored row CHDN-Miami Valley Gaming: the 2025 figure, not an older year's
    const mvg = "The Company received distributions from MVG of $ 47.5 million in 2025, $ 46.5 million in 2024 and $ 44.0 million in 2023.";
    expect(checkPartyAmount(mvg, 47.5e6, "Miami Valley Gaming").ok).toBe(true);
    expect(checkPartyAmount(mvg, 46.5e6, "Miami Valley Gaming").ok).toBe(false);
  });
  it("drops a figure the sentence does not tie to anyone, keeps one it points back to", () => {
    expect(checkPartyAmount("Revenue was $2.5 billion in 2025.", 2.5e9, "Bosch")).toMatchObject({ ok: false, why: "not-tied" });
    expect(checkPartyAmount("The panel set the total royalties at $ 1.05 billion for the eight-year patent license.", 1.05e9, "Samsung Electronics Co. Ltd.").ok).toBe(true);
  });
  it("names a party by a distinctive word, its initials, or as written", () => {
    expect(namesParty("Sales to AT&T were", "AT&T Inc.")).toBe(true);
    expect(namesParty("the U.S. DOE's GRIP program", "United States Department of Energy")).toBe(true);
    expect(namesParty("sales to Walmart", "Rimrock Energy Partners, LLC")).toBe(false);
  });
});

describe("C2: buying assets or a business, or lending, is never a flow", () => {
  it("reads deals and loans as investment or financing (stored WMB row first)", () => {
    expect(flowOf("On January 31, 2025, Williams purchased a group of natural gas gathering and processing assets from Rimrock Energy Partners, LLC (Rimrock) for approximately $325 million", "Rimrock Energy Partners, LLC", 325e6, "supplier")).toBe("kept:investment");
    expect(flowOf("We purchased the Baytown plant from ExxonMobil for $3.2 billion.", "Exxon Mobil", 3.2e9, "supplier")).toBe("kept:investment");
    expect(flowOf("We bought the Mobile refinery from Shell for $1.2 billion.", "Shell plc", 1.2e9, "supplier")).toBe("kept:investment");
    expect(flowOf("We purchased the remaining 50% of the joint venture from Shell for $1.2 billion.", "Shell plc", 1.2e9, "partner")).toBe("kept:investment");
    expect(flowOf("We lent $3.2 billion to Apple to fund purchases of our products.", "Apple", 3.2e9)).toBe("kept:financing");
    expect(linkNature("Williams purchased a group of natural gas gathering and processing assets from Rimrock Energy Partners, LLC (Rimrock) for approximately $325 million", "", "supplier")).toBe("corporate");
  });
  it("a seller's power purchase agreement is its revenue", () => {
    expect(flowOf("We sold power to PG&E for $100 million under a power purchase agreement.", "PG&E", 1e8)).toBe("flow:revenue");
  });
  it("keeps ordinary purchases as flows", () => {
    expect(flowOf("Purchases from Intel, net of price protection credits, were $100 million.", "Intel", 1e8, "supplier")).toBe("flow:purchases");
    expect(flowOf("We spent $100 million with Accenture on outsourced services.", "Accenture", 1e8, "supplier")).toBe("flow:purchases");
  });
});

describe("C3: other currencies", () => {
  it.each([
    "Revenue from Bosch was $50 million CAD.",
    "Revenue from Bosch was $50 million (Canadian).",
    "Revenue from Bosch was $50 million Australian dollars.",
    "Revenue from Bosch was AU $50 million.",
    "Revenue from Bosch was A $50 million.",
    "Revenue from Bosch was Cdn$50 million.",
    "(Canadian dollars in millions) Revenue from Bosch was $50.",
    "(in millions of Canadian dollars) Revenue from Bosch was $50.",
    "(C$ in millions) Revenue from Bosch was 50.",
  ])("drops %s", (q) => {
    expect(checkAmount(q, 50e6)).toMatchObject({ ok: false, why: "foreign" });
  });
  it("still reads the article and U.S. dollars", () => {
    expect(amountInQuote("A $50 million contract was signed with Bosch.", 50e6)).toBe(true);
    expect(amountInQuote("We signed a $50 million contract with Bosch.", 50e6)).toBe(true);
    expect(amountInQuote("(in millions of Canadian dollars) Bosch paid US$5 million.", 5e6)).toBe(true);
  });
});

describe("C4: only a table note scales unmarked figures", () => {
  it("ignores prose and unit notes", () => {
    expect(contextScale("Our products are in millions of homes, and sales to Walmart were $2,100.")).toBeNull();
    expect(contextScale("Shipments (units in millions): Apple 12, at an average price of $350.")).toBeNull();
    expect(amountInQuote("Our products are in millions of homes, and sales to Walmart were $2,100.", 2.1e9)).toBe(false);
    expect(amountInQuote("We were paid $1,500 per unit by Apple (in thousands of units, 200).", 1.5e6)).toBe(false);
  });
  it("reads the note forms filings use", () => {
    expect(contextScale("(in millions) Revenue")).toMatchObject({ scale: 1e6, foreign: false });
    expect(contextScale("(dollars in thousands) Revenue")).toMatchObject({ scale: 1e3, dollars: true });
    expect(contextScale("(in millions, except per share data) Revenue")).toMatchObject({ scale: 1e6 });
    expect(contextScale("$ in millions: Apple 12")).toMatchObject({ scale: 1e6, dollars: true });
    expect(contextScale("(in millions of euros) Revenue")).toMatchObject({ foreign: true });
  });
  it("never reads a year as a figure", () => {
    expect(amountInQuote("(dollars in millions) In 2024, sales to Bosch were 1,018.", 2024e6)).toBe(false);
    expect(amountInQuote("(dollars in millions) In 2024, sales to Bosch were 1,018.", 1018e6)).toBe(true);
  });
});

describe("C5: abbreviations do not cut the clause; subsidiaries are not subsidies", () => {
  it.each([
    ["Sales to the U.S. Government were $3.2 billion in 2025.", "U.S. Government", 3.2e9, "customer", "flow:revenue"],
    ["Net sales to Walmart Inc. were $3.2 billion in 2025.", "Walmart Inc.", 3.2e9, "customer", "flow:revenue"],
    // stored HRL row
    ["Sales to Walmart Inc. and its subsidiaries (Walmart) represented 15.6 % or $ 2.0 billion", "Walmart Inc.", 2e9, "customer", "flow:revenue"],
    ["Purchases from Taiwan Semiconductor Manufacturing Co. Ltd. were $3.2 billion.", "Taiwan Semiconductor Manufacturing Company", 3.2e9, "supplier", "flow:purchases"],
    ["Sales to Home Depot were $2.1 billion; receivables from Home Depot were $300 million.", "The Home Depot", 2.1e9, "customer", "flow:revenue"],
  ] as const)("%s", (q, cp, amount, relation, want) => {
    expect(flowOf(q, cp, amount, relation)).toBe(want);
  });
  it("keeps the acquisition wording before an abbreviation (stored KEYS row)", () => {
    expect(amountKind("On October 17, 2025 , we acquired PowerArtist from Ansys, Inc. for $ 26 million, expanding our design engineering software portfolio", "", 26e6, "Ansys")).toBe("investment");
  });
});

describe("C6: sole source", () => {
  const sole = (q: string, cp = "TSMC") => soleSourceInQuote(q, cp);
  it("reads denials, other clauses and the filer as the source as not sole source", () => {
    expect(sole("We do not rely on TSMC as a sole source.")).toBe(false);
    expect(sole("We have no sole source suppliers; TSMC supplies wafers.")).toBe(false);
    expect(sole("None of our suppliers, including TSMC, is a sole source.")).toBe(false);
    expect(sole("Although TSMC was previously our sole supplier, we have qualified a second source.")).toBe(false);
    expect(sole("We rely on a limited number of suppliers, including TSMC, and in some cases a single supplier.")).toBe(false);
    expect(sole("Some components are single-sourced, and we purchase memory from Micron.", "Micron")).toBe(false);
    expect(sole("We are the sole supplier of displays to Apple.", "Apple")).toBe(false);
    expect(sole("We are Apple's sole source of displays.", "Apple")).toBe(false);
    expect(sole("Under the agreement we are the exclusive manufacturer of Apple's chargers.", "Apple")).toBe(false);
    expect(sole("Single Source Inc. supplies us.", "Single Source Inc.")).toBe(false);
    expect(sole("TSMC is not a sole source, though Samsung is our single source for DRAM.")).toBe(false);
  });
  it("keeps real sole-source wording", () => {
    expect(sole("We are qualifying alternative suppliers, but TSMC is currently our sole supplier of advanced wafers for these products today.")).toBe(true);
    expect(sole("TSMC is our sole supplier; we are qualifying alternative suppliers.")).toBe(true);
    expect(sole("TSMC is not a sole source, though Samsung is our single source for DRAM.", "Samsung")).toBe(true);
    expect(sole("TSMC, our sole-source foundry, manufactures our chips.")).toBe(true);
  });
  it("trustLink never calls a customer a sole source", () => {
    expect(trustLink({ quote: "We are the sole supplier of displays to Apple.", relation: "customer", counterparty: "Apple", single_source: true })).toMatchObject({ sole_source: false, dependency: true });
    expect(trustLink({ quote: "We depend on Apple for all of our revenue.", relation: "customer", counterparty: "Apple", single_source: true })).toMatchObject({ sole_source: false, dependency: true });
  });
});

describe("C13: places inside organisation names", () => {
  it("are not stated regions", () => {
    expect(regionsInQuote("We buy from Bank of China Ltd.", ["China"])).toEqual([]);
    expect(regionsInQuote("Sales to Air China were $1 billion.", ["China"])).toEqual([]);
    expect(regionsInQuote("We sell to China Mobile.", ["China"])).toEqual([]);
    expect(regionsInQuote("We sell to Bank of America.", ["America"])).toEqual([]);
    expect(regionsInQuote("We buy from Japan Tobacco.", ["Japan"])).toEqual([]);
    expect(regionsInQuote("Our supplier Taiwan Glass ships from Taiwan.", ["Taiwan"], "Taiwan Glass")).toEqual(["Taiwan"]);
  });
  it("a utility's service area and a government's own name stay stated", () => {
    expect(maskOrgNames("Sunrise LLC accounted for 100% of Indiana Electric's coal purchases.")).toContain("Indiana");
    expect(regionsInQuote("$0.6 billion to provide Patriot systems for the Netherlands,", ["Netherlands"], "Netherlands")).toEqual(["Netherlands"]);
    expect(regionsInQuote("The U.S. federal government represented 81% of our revenues", ["United States"], "U.S. federal government")).toEqual(["United States"]);
  });
});

describe("C14: parser", () => {
  it("reads a figure written without a leading zero", () => {
    expect(amountInQuote("Bosch paid us $.5 billion.", 5e8)).toBe(true);
    expect(amountInQuote("Bosch paid us $.5 billion.", 5e9)).toBe(false);
  });
});

describe("linkNature on clear wording only (U1c open items, stored rows)", () => {
  it("a manufacturer approved by regulators is a supplier, not a regulator (UTHR-Simtra)", () => {
    expect(linkNature("Simtra BioPharma Solutions (formerly known as Baxter Pharmaceutical Solutions, LLC) is approved by the FDA, the EMA, and various other international regulatory agencies to manufacture Remodulin for us.", "", "supplier", "Simtra BioPharma Solutions")).toBe("trade");
  });
  it("investing in building a product is not a financing tie (HPE-NVIDIA)", () => {
    expect(linkNature("we have invested in building turn-key integrated systems co-engineered with Nvidia that integrate HPE AI hardware and software technologies with Nvidia technologies", "", "partner", "NVIDIA")).toBe("trade");
    expect(linkNature("we invested in the preferred stock of Acme", "", "partner", "Acme")).toBe("financial");
    expect(linkNature("On March 2, 2026, NVIDIA made a $2 billion investment in the Company through the purchase of shares of the Company's Common Stock.", "", "partner", "NVIDIA Corporation")).toBe("financial");
  });
  it("a regulator is still read when the counterparty is one", () => {
    expect(linkNature("All satellite licenses issued by the FCC are subject to expiration unless extended by the FCC", "", "supplier", "Federal Communications Commission")).toBe("regulatory");
  });
});

describe("C7: auditClaims reports and writes nothing", () => {
  it("counts what read-time checks keep and leaves the rows as stored", () => {
    const rows = [
      { id: "a", quote: "Acme is a key supplier", relation: "supplier", counterparty: "Acme", amount_usd: 5e7, single_source: true, regions: ["China"] },
      { id: "b", quote: "Purchases from Gamma, our sole supplier in China, were $50 million", relation: "supplier", counterparty: "Gamma", amount_usd: 5e7, single_source: true, regions: ["China", "Japan"] },
      { id: "c", quote: "Delta accounted for 12% of our $2.5 billion revenue", relation: "customer", counterparty: "Delta", amount_usd: 2.5e9, single_source: false, regions: [] },
    ];
    const before = JSON.stringify(rows);
    const a = auditClaims(rows);
    expect(JSON.stringify(rows)).toBe(before);
    expect(a.amounts).toMatchObject({ stored: 3, kept: 1, flows: 1, dropped: { "not-in-quote": 1, base: 1 } });
    expect(a.soleSource).toEqual({ flagged: 2, kept: 1, dependency: 1 });
    expect(a.regions).toEqual({ links: 2, pruned: 2, entriesStored: 3, entriesKept: 1 });
  });
});
