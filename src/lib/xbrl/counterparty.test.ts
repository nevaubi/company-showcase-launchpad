import { describe, expect, it } from "vitest";
import { companyMatcher } from "./counterparty";

const m = companyMatcher([
  { ticker: "AMZN", name: "Amazon.com, Inc." },
  { ticker: "WMT", name: "Walmart Inc." },
  { ticker: "GM", name: "General Motors Company" },
  { ticker: "GE", name: "General Electric Company" },
  { ticker: "AAPL", name: "Apple Inc." },
  { ticker: "APLE", name: "Apple Hospitality REIT, Inc." },
  { ticker: "CVX", name: "Chevron Corporation" },
  { ticker: "HD", name: "The Home Depot, Inc." },
  { ticker: "DAL", name: "Delta Air Lines, Inc." },
  { ticker: "DLA", name: "Delta Apparel, Inc." },
  { ticker: "KO", name: "The Coca-Cola Company" },
  { ticker: "CMC", name: "Commercial Metals Company" },
  { ticker: "SO", name: "The Southern Company" },
  { ticker: "ALG", name: "Alamo Group Inc." },
  { ticker: "EXPE", name: "Expedia Group, Inc." },
  { ticker: "BKNG", name: "Booking Holdings Inc." },
  { ticker: "XOM", name: "Exxon Mobil Corporation" },
]);

describe("XBRL counterparty matching", () => {
  it("matches tagged names to covered companies", () => {
    expect(m("Amazon", "X")).toBe("AMZN");
    expect(m("Amazon.com, Inc.", "X")).toBe("AMZN");
    expect(m("Walmart Inc.", "X")).toBe("WMT");
    expect(m("Walmart Stores", "X")).toBe("WMT");
    expect(m("Chevron Corporation", "X")).toBe("CVX");
    expect(m("Home Depot", "X")).toBe("HD");
    expect(m("Apple Inc.", "X")).toBe("AAPL");
  });
  it("never matches anonymous or ambiguous labels", () => {
    for (const l of ["Customer A", "Customer One", "Two Customers", "Top Ten Customers", "Largest Customer", "Distributor B", "U.S. Government", "Medicare", "General"]) expect(m(l, "X")).toBeNull();
    expect(m("Apple", "X")).toBe("AAPL"); // exact name beats the longer "Apple Hospitality"
    expect(m("Delta", "X")).toBeNull(); // two covered names start with "delta"
    expect(m("Commercial", "X")).toBeNull(); // a market, not Commercial Metals
    expect(m("Coca-Cola Europacific Partners", "X")).toBeNull(); // a different company than Coca-Cola
    expect(m("Amazon Web Services", "X")).toBe("AMZN");
    expect(m("Southern Wine and Spirits", "X")).toBeNull();
    expect(m("Alamo Quarry Market and Waikele Center", "X")).toBeNull();
    expect(m("Expedia And Booking", "X")).toBeNull();
  });
  it("reads names with aliases and member suffixes", () => {
    expect(m("Walmart Inc. (“Walmart”)", "X")).toBe("WMT");
    expect(m("Exxon Mobil Corporation (“ExxonMobil”)", "X")).toBe("XOM");
    expect(m("Walmart Sams Club", "X")).toBe("WMT");
  });
  it("never matches the reporting company to itself", () => {
    expect(m("Walmart", "WMT")).toBeNull();
  });
});
