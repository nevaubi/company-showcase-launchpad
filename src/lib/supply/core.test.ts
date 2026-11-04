import { describe, expect, it } from "vitest";
import { focusGraph, inverse, quoteInText, type SupplyLink } from "./core";

const link = (p: Partial<SupplyLink>): SupplyLink => ({
  id: "x", ticker: "AAPL", counterparty: "TSMC", counterparty_ticker: null, counterparty_domain: "tsmc.com",
  relation: "supplier", detail: "", share_pct: null, quote: "", accn: "a", doc: "d", form: "10-K", filed: "2025-10-31", ...p,
});

describe("supply links", () => {
  it("rejects a quote that is not verbatim in the filing", () => {
    const text = "Substantially all of the Company’s hardware products are manufactured by outsourcing partners in Asia.";
    expect(quoteInText("hardware products are manufactured by outsourcing partners", text)).toBe(true);
    expect(quoteInText("hardware products are built by outsourcing partners", text)).toBe(false);
  });
  it("rejects quotes shorter than five words", () => {
    expect(quoteInText("outsourcing partners", "outsourcing partners")).toBe(false);
  });
  it("a supplier of A shows A as its customer", () => {
    expect(inverse("supplier")).toBe("customer");
    const g = focusGraph("NVDA", [link({ ticker: "MSFT", counterparty: "NVIDIA", counterparty_ticker: "NVDA", relation: "supplier" })], { MSFT: "Microsoft" });
    expect(g[0].ticker).toBe("MSFT");
    expect(g[0].relation).toBe("customer");
  });
});

import { linkDollars, simulateShock } from "./core";

describe("exposure and shocks", () => {
  it("customer share converts to dollars using the filer's revenue", () => {
    expect(linkDollars(link({ ticker: "NVDA", relation: "customer", share_pct: 12 }), { NVDA: 100e9 })).toBe(12e9);
    expect(linkDollars(link({ relation: "supplier", share_pct: 30 }), { AAPL: 400e9 })).toBeNull();
  });
  it("a 20% shock at a customer worth 12% of a supplier's revenue puts 2.4% of that supplier at risk", () => {
    const links = [link({ ticker: "NVDA", counterparty: "Microsoft", counterparty_ticker: "MSFT", relation: "customer", share_pct: 12 })];
    const r = simulateShock("MSFT", 0.2, links, { NVDA: "NVIDIA" }, { NVDA: 100e9 });
    expect(r[0].ticker).toBe("NVDA");
    expect(r[0].channel).toBe("lost sales");
    expect(r[0].revenuePct).toBeCloseTo(0.024);
    expect(r[0].dollars).toBeCloseTo(2.4e9);
  });
  it("single-sourced customers are high-severity supply disruptions", () => {
    const links = [{ ...link({ ticker: "AAPL", counterparty: "TSMC", counterparty_ticker: "TSM", relation: "supplier" }), single_source: true }];
    const r = simulateShock("TSM", 0.2, links, {}, {});
    expect(r[0].ticker).toBe("AAPL");
    expect(r[0].severity).toBe("high");
  });
});
