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
