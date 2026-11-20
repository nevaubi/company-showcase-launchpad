import { describe, expect, it } from "vitest";
import { amountInQuote, amountKind, checkAmount, isFlowKind, linkNature, planRepairs, regionsInQuote, repairPatch, soleSourceInQuote, trustLink } from "./claims";
import { CLAIM_CASES } from "./claims.fixture";

describe("amountInQuote", () => {
  it("reads unit words and suffixes", () => {
    expect(amountInQuote("contract value of $1.2 billion with the Navy", 1.2e9)).toBe(true);
    expect(amountInQuote("an order worth $5M from Acme", 5e6)).toBe(true);
    expect(amountInQuote("purchases of $1.2bn from TSMC", 1.2e9)).toBe(true);
    expect(amountInQuote("net sales of $1,203.6 million and $1,062.7 million", 1_062_700_000)).toBe(true);
    expect(amountInQuote("received approximately $ 1.1 billion in cash proceeds", 1.1e9)).toBe(true);
    expect(amountInQuote("we paid US$300 million to the supplier", 3e8)).toBe(true);
    expect(amountInQuote("revenue of 250 million U.S. dollars", 2.5e8)).toBe(true);
    expect(amountInQuote("a payment of $125,000,000 to Acme", 1.25e8)).toBe(true);
  });
  it("allows rounding but not a different figure", () => {
    expect(amountInQuote("sales of $2.1 billion", 2_105_000_000)).toBe(true);
    expect(amountInQuote("sales of $2.1 billion", 2.2e9)).toBe(false);
  });
  it("gives a range the later unit", () => {
    expect(amountInQuote("expected to pay $1.0 to $1.2 billion", 1e9)).toBe(true);
    expect(amountInQuote("expected to pay $1-2 billion", 2e9)).toBe(true);
    expect(amountInQuote("between $5 and $10 million a year", 5e6)).toBe(true);
  });
  it("applies the sentence's own 'in millions' note", () => {
    expect(amountInQuote("Purchases from ELYSIS (in millions): $47 in 2025", 47e6)).toBe(true);
    expect(amountInQuote("(dollars in thousands) ELYSIS 47", 47e3)).toBe(true);
    expect(amountInQuote("Purchases from ELYSIS (in millions): $47 in 2025", 47)).toBe(false);
    expect(amountInQuote("(dollars in thousands) ELYSIS 4,700", 4.7e6)).toBe(true);
  });
  it("rejects unit slips and figures the sentence does not mark as dollars", () => {
    // stored unscaled: the filing means $1,018 million
    expect(checkAmount("we paid $1,018 in connection with our acquisition", 1018)).toMatchObject({ ok: false, why: "too-small" });
    // the scale is right in fact but the sentence never gives it
    expect(checkAmount("from EchoStar for approximately $23,000, subject to adjustments", 23e9)).toMatchObject({ ok: false, why: "unit-missing" });
    expect(checkAmount("increased to up to $ 225,000", 225_000).ok).toBe(false);
    expect(checkAmount("we shipped 3,500,000 units to Acme", 3.5e6)).toMatchObject({ ok: false, why: "bare-number" });
    expect(checkAmount("a facility totaling 20,000,000 RMB", 2e7).ok).toBe(false);
    expect(checkAmount("C$450 million owed by the province", 4.5e8)).toMatchObject({ ok: false, why: "foreign" });
    expect(checkAmount("a contract worth $50 million", -5e7)).toMatchObject({ ok: false, why: "not-positive" });
    expect(checkAmount("a contract with the Navy", 5e7)).toMatchObject({ ok: false, why: "not-in-quote" });
    expect(amountInQuote("a contract with the Navy", null)).toBe(false);
  });
  it("does not read codes or years as figures", () => {
    expect(amountInQuote("the Q3 2025 award from the Army", 2025)).toBe(false);
    expect(amountInQuote("under the F-35 programme for $35 million", 35e6)).toBe(true);
  });
});

describe("amountKind", () => {
  const k = (q: string, a: number, d = "") => amountKind(q, d, a);
  it("names flows", () => {
    expect(k("Sales to Boeing were $310 million in 2025", 3.1e8)).toBe("revenue");
    expect(k("the Company purchased from Shenghe $ 19.7 million of raw materials", 19.7e6)).toBe("purchases");
    expect(k("a $25.0 million contract task order with the U.S. Space Force", 25e6)).toBe("contract");
    expect(k("Raytheon booked $3.7 billion to provide Patriot interceptors", 3.7e9)).toBe("contract");
    expect(k("we received an upfront, non-refundable payment of $22.0 million", 22e6)).toBe("revenue");
  });
  it("keeps money that is not a trade flow out of flows", () => {
    expect(k("Omega acquired a 9.9 % equity interest in Saber for $ 92.8 million", 92.8e6)).toBe("investment");
    expect(k("$325.0 million borrowed under the CoBank term loan agreement", 325e6)).toBe("financing");
    expect(k("we guarantee $40 million of the venture's debt", 4e7)).toBe("guarantee");
    expect(k("$642 million paid to Santos following a judgment", 642e6)).toBe("settlement");
    expect(k("receivables from Acme were $12 million", 12e6)).toBe("balance");
    expect(k("we are committed to purchase $600 million of wafers through 2028", 6e8)).toBe("commitment");
    expect(k("the project was awarded a $700 million grant from the DOE", 7e8)).toBe("other");
    expect(k("eligible for up to $130 million in milestones", 1.3e8)).toBe("other");
  });
  it("lets the model's detail take a flow away but never add one", () => {
    expect(k("we recorded $58.9 million of revenue related to Maplewood", 58.9e6, "settlement of a lawsuit")).toBe("other");
    expect(k("we recorded $58.9 million of revenue related to Maplewood", 58.9e6, "tenant pays rent")).toBe("revenue");
    expect(k("the total was $58.9 million", 58.9e6, "revenue from the customer")).toBe("other");
  });
  it("flows are revenue, purchases and contract only", () => {
    expect(["revenue", "purchases", "contract"].every((x) => isFlowKind(x as never))).toBe(true);
    expect(["commitment", "investment", "financing", "guarantee", "settlement", "balance", "other", null].some((x) => isFlowKind(x as never))).toBe(false);
  });
});

describe("soleSourceInQuote", () => {
  it("finds sole, single, only and exclusive source wording", () => {
    expect(soleSourceInQuote("Patheon is the sole provider of our commercial supply of Defitelio")).toBe(true);
    expect(soleSourceInQuote("our single-source suppliers (e.g., Intel and AMD)")).toBe(true);
    expect(soleSourceInQuote("Evergen is the exclusive contract manufacturer of the Nerve Cap")).toBe(true);
    expect(soleSourceInQuote("the API is available only from Lonza")).toBe(true);
    expect(soleSourceInQuote("these components are single-sourced from Bosch")).toBe(true);
  });
  it("reads denials and weaker wording as not sole source", () => {
    expect(soleSourceInQuote("Acme is not a sole source for any of our products")).toBe(false);
    expect(soleSourceInQuote("Acme is one of several suppliers of resin")).toBe(false);
    expect(soleSourceInQuote("a non-exclusive supply agreement with Acme")).toBe(false);
    expect(soleSourceInQuote("we procure substantially all of our wafers from Kioxia")).toBe(false);
    expect(soleSourceInQuote("our key merchant silicon vendors such as Broadcom")).toBe(false);
    expect(soleSourceInQuote("an exclusive license to the Blue Cross names")).toBe(false);
  });
  it("a denial in a later clause does not undo the wording", () => {
    expect(soleSourceInQuote("Patheon is the sole provider of our supply; however, we are not required to purchase exclusively from Patheon.")).toBe(true);
  });
});

describe("regionsInQuote", () => {
  it("keeps only regions the sentence names, in stored order, once", () => {
    expect(regionsInQuote("we buy wafers in Taiwan and Japan", ["Japan", "China", "Taiwan", "Japan"])).toEqual(["Japan", "Taiwan"]);
    expect(regionsInQuote("sales to the U.S. federal government", ["United States"])).toEqual(["United States"]);
    expect(regionsInQuote("sales to the U.S. federal government", ["U.S."])).toEqual(["U.S."]);
    expect(regionsInQuote("a global collaboration with AstraZeneca", ["Worldwide"])).toEqual(["Worldwide"]);
    expect(regionsInQuote("the Busan plant", ["South Korea"])).toEqual([]);
    expect(regionsInQuote("anything", null)).toEqual([]);
  });
});

describe("linkNature", () => {
  it("tells trade from finance, deals and regulators", () => {
    expect(linkNature("Sales to Boeing accounted for 12.8% of consolidated sales", "", "customer")).toBe("trade");
    expect(linkNature("Truist Bank, as administrative agent, and the lenders party thereto amended its Credit Facility", "", "supplier")).toBe("financial");
    expect(linkNature("we completed the divestiture of our Refining Solutions business to ChemCat", "", "partner")).toBe("corporate");
    expect(linkNature("All satellite licenses issued by the FCC are subject to expiration unless extended by the FCC", "", "supplier", "Federal Communications Commission")).toBe("regulatory");
    expect(linkNature("programs were terminated subsequent to the acquisition of Merus by Genmab A/S", "", "partner")).not.toBe("corporate");
    expect(linkNature("we entered into an exclusive license agreement with Stanford", "", "partner")).toBe("trade");
  });
});

describe("trustLink", () => {
  const base = { quote: "Sales to Boeing were $310 million in 2025 and Boeing is our sole supplier of airframes in the U.S.", detail: "", relation: "customer", counterparty: "Boeing" };
  it("keeps verified claims and marks the flow", () => {
    const t = trustLink({ ...base, amount_usd: 3.1e8, single_source: true, regions: ["United States", "China"] });
    expect(t).toMatchObject({ amount_usd: 3.1e8, flow_usd: 3.1e8, amount_kind: "revenue", sole_source: true, single_source: true, dependency: false, regions: ["United States"], nature: "trade", dropped: ["regions"] });
  });
  it("removes what the sentence does not state and labels a weaker dependency", () => {
    const t = trustLink({ quote: "Acme is a key supplier of resin to our plants", detail: "", relation: "supplier", amount_usd: 9e8, single_source: true, regions: ["Germany"] });
    expect(t).toMatchObject({ amount_usd: null, flow_usd: null, amount_kind: null, sole_source: false, single_source: false, dependency: true, regions: [], dropped: ["amount_usd", "single_source", "regions"] });
  });
  it("never adds a value the stored link did not have", () => {
    const t = trustLink({ ...base, amount_usd: null, single_source: false, regions: [] });
    expect(t).toMatchObject({ amount_usd: null, flow_usd: null, sole_source: false, dependency: false, regions: [], dropped: [] });
  });
  it("a stated amount that is not a flow keeps its value but no flow", () => {
    const t = trustLink({ quote: "Omega acquired a 9.9 % equity interest in Saber for $ 92.8 million in cash", relation: "partner", amount_usd: 92.8e6 });
    expect(t).toMatchObject({ amount_usd: 92.8e6, flow_usd: null, amount_kind: "investment", nature: "corporate" });
  });
  it("keeps other fields untouched", () => {
    const t = trustLink({ ...base, id: "x1", share_pct: 12.8, amount_usd: null });
    expect(t.id).toBe("x1");
    expect(t.share_pct).toBe(12.8);
  });
});

describe("repairPatch", () => {
  it("lists only the columns that change", () => {
    expect(repairPatch({ quote: "Acme is a key supplier", relation: "supplier", amount_usd: 5e7, single_source: true, regions: ["China"] })).toEqual({ amount_usd: null, single_source: false, regions: [] });
    expect(repairPatch({ quote: "Acme, our sole supplier in China, received $50 million", relation: "supplier", amount_usd: 5e7, single_source: true, regions: ["China"] })).toEqual({});
    expect(repairPatch({ quote: "no figure", relation: "supplier", amount_usd: null, single_source: false, regions: null })).toEqual({});
  });
});

describe("adjudicated judged links", () => {
  const amounts = CLAIM_CASES.filter((c) => c.amount_usd != null);
  it("has a broad fixture", () => {
    expect(CLAIM_CASES.length).toBeGreaterThanOrEqual(80);
    expect(amounts.length).toBeGreaterThanOrEqual(40);
  });
  it.each(amounts.map((c) => [c.id, c] as const))("amount %s", (_, c) => {
    expect(amountInQuote(c.quote, c.amount_usd)).toBe(c.expect.amount_stated);
  });
  it("every amount treated as a flow is a flow", () => {
    const flows = amounts.filter((c) => trustLink(c).flow_usd != null);
    expect(flows.length).toBeGreaterThanOrEqual(8);
    for (const c of flows) expect([c.id, c.expect.flow]).toEqual([c.id, true]);
  });
  it.each(CLAIM_CASES.filter((c) => c.single_source).map((c) => [c.id, c] as const))("sole source %s", (_, c) => {
    expect(soleSourceInQuote(c.quote)).toBe(c.expect.sole_source);
  });
  it.each(CLAIM_CASES.map((c) => [c.id, c] as const))("regions and nature %s", (_, c) => {
    const kept = regionsInQuote(c.quote, c.regions);
    expect(kept).toEqual(c.expect.regions);
    expect(kept.length === c.regions.length).toBe(c.expect.regions_all_named);
    expect(linkNature(c.quote, c.detail, c.relation, c.counterparty)).toBe(c.expect.nature);
  });
  it("most links stored under the wrong relation are read as not trade", () => {
    const wrong = CLAIM_CASES.filter((c) => c.expect.relation_wrong);
    const flagged = wrong.filter((c) => linkNature(c.quote, c.detail, c.relation, c.counterparty) !== "trade");
    expect(flagged.length / wrong.length).toBeGreaterThanOrEqual(0.6);
  });
});

describe("planRepairs", () => {
  it("counts changes and groups identical writes", () => {
    const plan = planRepairs([
      { id: "a", quote: "Acme is a key supplier", relation: "supplier", amount_usd: 5e7, single_source: false, regions: [] },
      { id: "b", quote: "Beta is a key supplier", relation: "supplier", amount_usd: 9e7, single_source: false, regions: [] },
      { id: "c", quote: "Gamma, our sole supplier in China", relation: "supplier", amount_usd: null, single_source: true, regions: ["China", "Japan"] },
      { id: "d", quote: "Delta bought $5 million of chips", relation: "customer", amount_usd: 5e6, single_source: false, regions: [] },
    ]);
    expect(plan).toMatchObject({ rows: 4, changed: 3, amountsCleared: 2, soleSourceCleared: 0, regionsPruned: 1 });
    expect(plan.updates).toEqual([
      { set: { amount_usd: null }, ids: ["a", "b"] },
      { set: { regions: ["China"] }, ids: ["c"] },
    ]);
  });
});
