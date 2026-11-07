import { describe, expect, it } from "vitest";
import { buildCitation, secArchiveUrl } from "./citation";

describe("buildCitation", () => {
  it("cites an XBRL fact with value, filing and URL", () => {
    const c = buildCitation(
      {
        ticker: "AAPL",
        label: "Revenue",
        periodLabel: "Q3 FY26",
        unit: "usd",
        value: 94036000000,
        src: {
          accn: "0000320193-26-000070",
          concept: "us-gaap:Revenues",
          end: "2026-06-27",
          value: 94036000000,
        },
      },
      { company: "Apple Inc.", cik: "320193", filing: { form: "10-Q", filed: "2026-08-01" } },
    );
    expect(c).toContain("Apple Inc. (AAPL): Revenue, Q3 FY26");
    expect(c).toContain("Value: $94,036,000,000");
    expect(c).toContain("Form 10-Q, filed Aug 1, 2026, accession 0000320193-26-000070");
    expect(c).toContain("https://www.sec.gov/Archives/edgar/data/320193/000032019326000070/");
  });
  it("cites an external record with its quote and no value line", () => {
    const c = buildCitation(
      {
        ticker: "NVDA",
        label: "Short interest",
        unit: "shares",
        value: 1,
        external: { url: "https://finra.org/x", date: "2026-10-15", quote: "301,622,687 shares" },
      },
      {},
    );
    expect(c).not.toContain("Value:");
    expect(c).toContain("Source: https://finra.org/x");
    expect(c).toContain('Quote: "301,622,687 shares"');
  });
  it("builds archive urls", () => {
    expect(secArchiveUrl("0001045810", "0001045810-26-000075", "a.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/a.htm",
    );
  });
});
