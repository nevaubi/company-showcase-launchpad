import { describe, expect, it } from "vitest";
import { SHORT_INDUSTRY_MAX, shortIndustry } from "./short-industry";

// Every industry the sectors job writes today (sectors.json groups, 24 Nov 2026), with its sector.
const NOW: [string, string][] = [
  ["Communication Services", "Entertainment"], ["Communication Services", "Interactive Media & Services"], ["Communication Services", "Media"],
  ["Communication Services", "Telecommunication Services"], ["Consumer Discretionary", "Automobiles & Components"],
  ["Consumer Discretionary", "Consumer Discretionary Retail"], ["Consumer Discretionary", "Hotels, Restaurants & Leisure"],
  ["Consumer Discretionary", "Household Durables"], ["Consumer Discretionary", "Textiles, Apparel & Luxury Goods"],
  ["Consumer Staples", "Consumer Staples Retail"], ["Consumer Staples", "Food, Beverage & Tobacco"], ["Consumer Staples", "Household & Personal Products"],
  ["Energy", "Energy Equipment & Services"], ["Energy", "Integrated Oil & Refining"], ["Energy", "Oil & Gas Exploration & Production"],
  ["Energy", "Oil & Gas Midstream"], ["Financials", "Banks"], ["Financials", "Capital Markets"], ["Financials", "Financial Services"],
  ["Financials", "Insurance"], ["Health Care", "Biotechnology"], ["Health Care", "Health Care Equipment & Supplies"],
  ["Health Care", "Health Care Providers & Services"], ["Health Care", "Health Care Technology"], ["Health Care", "Life Sciences Tools & Services"],
  ["Health Care", "Pharmaceuticals"], ["Industrials", "Aerospace & Defense"], ["Industrials", "Building Products"],
  ["Industrials", "Commercial & Professional Services"], ["Industrials", "Construction & Engineering"], ["Industrials", "Electrical Equipment"],
  ["Industrials", "Machinery"], ["Industrials", "Trading Companies & Distributors"], ["Industrials", "Transportation"],
  ["Information Technology", "Communications Equipment"], ["Information Technology", "Electronic Equipment & Components"],
  ["Information Technology", "IT Services"], ["Information Technology", "Semiconductors & Equipment"], ["Information Technology", "Software"],
  ["Information Technology", "Technology Hardware & Storage"], ["Materials", "Chemicals"], ["Materials", "Construction Materials"],
  ["Materials", "Containers, Packaging & Paper"], ["Materials", "Metals & Mining"], ["Real Estate", "REITs"],
  ["Real Estate", "Real Estate Management & Services"], ["Utilities", "Electric Utilities"], ["Utilities", "Gas & Water Utilities"],
  ["Utilities", "Multi-Utilities"],
];

describe("shortIndustry", () => {
  it("fits every current industry in the table's industry column", () => {
    const long = NOW.map(([s, i]) => shortIndustry(i, s)).filter((x) => x.length > SHORT_INDUSTRY_MAX);
    expect(long).toEqual([]);
  });

  it("keeps the industries of one sector apart", () => {
    const by = new Map<string, string[]>();
    for (const [s, i] of NOW) by.set(s, [...(by.get(s) ?? []), shortIndustry(i, s)]);
    for (const [s, names] of by) expect(new Set(names).size, s).toBe(names.length);
  });

  it("shortens the IT industries that were cut at 1440 px", () => {
    expect(shortIndustry("Electronic Equipment & Components", "Information Technology")).toBe("Electronic Equipment");
    expect(shortIndustry("Technology Hardware & Storage", "Information Technology")).toBe("Hardware & Storage");
    expect(shortIndustry("Semiconductors & Equipment", "Information Technology")).toBe("Semiconductors");
  });

  it("drops a leading copy of the sector's words for a name it does not know", () => {
    expect(shortIndustry("Health Care Robotics", "Health Care")).toBe("Robotics");
    expect(shortIndustry("Software", "Information Technology")).toBe("Software");
    expect(shortIndustry("Utilities", "Utilities")).toBe("Utilities");
  });
});
