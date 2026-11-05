import { describe, expect, it } from "vitest";
import { agreementTerms, latestByCountry, markTerms, riskTier } from "./region";

describe("riskTier", () => {
  it("uses the weakest governance estimate", () => {
    expect(riskTier({ stability: -1.2, ruleOfLaw: 1, regulatory: 1 })).toBe("high");
    expect(riskTier({ stability: 0.02, ruleOfLaw: -0.43, regulatory: -0.11 })).toBe("elevated");
    expect(riskTier({ stability: 1, ruleOfLaw: 1.4, regulatory: 1.2 })).toBe("low");
    expect(riskTier({ stability: null, ruleOfLaw: null, regulatory: null })).toBe("unrated");
  });
});

describe("latestByCountry", () => {
  it("keeps the most recent non-null year", () => {
    const body = [{}, [
      { countryiso3code: "CHN", date: "2024", value: 0.1 },
      { countryiso3code: "CHN", date: "2025", value: null },
      { countryiso3code: "CHN", date: "2023", value: 0.3 },
    ]];
    expect(latestByCountry(body).CHN).toEqual({ value: 0.1, date: "2024" });
  });
});

describe("agreementTerms", () => {
  const q = "In January 2025 we entered into a three-year capacity agreement with prepayments of $1.5 billion through fiscal 2028, representing 12% of purchases; the agreement is non-cancellable.";
  it("extracts dates, term length, amounts, percentages and clauses", () => {
    const a = agreementTerms(q);
    expect(a.dates).toEqual(expect.arrayContaining(["January 2025", "fiscal 2028"]));
    expect(a.durations[0]).toMatch(/three-year capacity agreement|three-year/);
    expect(a.amounts).toContain("$1.5 billion");
    expect(a.percents).toContain("12%");
    expect(a.clauses).toEqual(expect.arrayContaining(["Prepayment / deposit", "Non-cancellable", "Capacity reservation"]));
  });
  it("highlights the exact words and keeps the text intact", () => {
    const parts = markTerms(q, agreementTerms(q));
    expect(parts.map((p) => p.s).join("")).toBe(q);
    expect(parts.filter((p) => p.hit).map((p) => p.s)).toContain("$1.5 billion");
  });
});
