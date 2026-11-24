import { describe, expect, it } from "vitest";
import { rankCompanies } from "./company-picker";

const companies = [
  { ticker: "NVDA", name: "NVIDIA" },
  { ticker: "AMD", name: "Advanced Micro Devices" },
  { ticker: "MU", name: "Micron" },
  { ticker: "MCHP", name: "Microchip Technology" },
  { ticker: "SMCI", name: "Supermicro" },
  { ticker: "AMAT", name: "Applied Materials" },
  { ticker: "A", name: "Agilent" },
];
const links = { NVDA: 56, AMD: 12, MU: 4, MCHP: 9, SMCI: 3 };
const tickers = (q: string, limit?: number) => rankCompanies(companies, q, links, limit).map((c) => c.ticker);

describe("rankCompanies", () => {
  it("lists the most linked companies first when nothing is typed, unlinked ones by ticker after them", () => {
    expect(tickers("")).toEqual(["NVDA", "AMD", "MCHP", "MU", "SMCI", "A", "AMAT"]);
  });
  it("puts an exact ticker first, then tickers that start with it, then names", () => {
    expect(tickers("a")).toEqual(["A", "AMD", "AMAT", "NVDA"]);
    expect(tickers("am").slice(0, 2)).toEqual(["AMD", "AMAT"]);
    expect(tickers("mu")[0]).toBe("MU");
  });
  it("matches the start of a name before a match inside it, and breaks ties by links", () => {
    expect(tickers("micro")).toEqual(["MCHP", "MU", "AMD", "SMCI"]);
  });
  it("ignores case and surrounding spaces, returns nothing for no match, and respects the limit", () => {
    expect(tickers("  NVIDIA ")).toEqual(["NVDA"]);
    expect(tickers("zzz")).toEqual([]);
    expect(tickers("", 2)).toEqual(["NVDA", "AMD"]);
  });
});
