import { describe, expect, it } from "vitest";
import { appliesTo, bankCore, dedupeRegistry, legalName, pickCfpb, pickFdic, pickFdicFuzzy, wikiTitle } from "./registry";

describe("alt-data registry", () => {
  it("expands SEC names into legal names", () => {
    expect(legalName("TARGET CORP")).toBe("Target Corporation");
    expect(legalName("ROBINHOOD MARKETS, INC.")).toBe("Robinhood Markets Inc.");
    expect(legalName("AT&T INC.")).toBe("AT&T Inc.");
  });
  it("picks the complaint-database company that is the company", () => {
    expect(pickCfpb([{ key: "ROBINHOOD MARKETS INC.", doc_count: 5263 }, { key: "ROBIN HOOD FINANCE LLC", doc_count: 3 }], "Robinhood Markets")).toBe("ROBINHOOD MARKETS INC.");
    expect(pickCfpb([{ key: "CAPITAL ONE FINANCIAL CORPORATION", doc_count: 9 }], "Capital")).toBeNull();
  });
  it("picks the largest bank owned by the holding company", () => {
    expect(pickFdic([{ NAMEHCR: "JPMORGAN CHASE&CO", ASSET: 4e9, CERT: 628 }, { NAMEHCR: "JPMORGAN CHASE&CO", ASSET: 7e4, CERT: 21761 }, { NAMEHCR: "OTHER BANCORP", ASSET: 9e9, CERT: 1 }], "JPMORGAN CHASE & CO")).toBe(628);
  });
  it("matches FDIC's abbreviated holding-company names", () => {
    expect(bankCore("US BANCORP \\DE\\")).toBe("us");
    expect(bankCore("U S BCORP")).toBe("us");
    expect(bankCore("U.S. Bank National Association")).toBe("us");
    expect(bankCore("PNC FINANCIAL SERVICES GROUP, INC.")).toBe(bankCore("PNC FINL SERVICES GROUP INC"));
    expect(bankCore("BANK OF AMERICA CORP /DE/")).toBe("america");
    expect(pickFdicFuzzy([{ NAMEHCR: "U S BCORP", NAME: "U.S. Bank National Association", ASSET: 7e8, CERT: 6548 }, { NAMEHCR: "UBS GROUP AG", NAME: "UBS Bank USA", ASSET: 1e8, CERT: 57565 }], "US BANCORP \\DE\\")).toBe(6548);
  });
  it("refuses a bank name shared by similar-sized banks under different owners", () => {
    expect(pickFdicFuzzy([{ NAMEHCR: "FIRST BANCORP", NAME: "First Bank", ASSET: 12e6, CERT: 1 }, { NAMEHCR: "FIRST BANCSHARES INC", NAME: "First Bank", ASSET: 5e6, CERT: 2 }], "FIRST BANCORP /NC/")).toBeNull();
    expect(pickFdicFuzzy([{ NAMEHCR: "CITIZENS FINANCIAL GROUP INC", NAME: "Citizens Bank, National Association", ASSET: 2.3e8, CERT: 57957 }, { NAMEHCR: "CITIZENS BANCSHARES CORP", NAME: "Citizens Bank", ASSET: 4e5, CERT: 3 }], "Citizens Financial Group Inc/RI")).toBe(57957);
  });
  it("matches a bank through its holding company, not a namesake bank", () => {
    expect(pickFdicFuzzy([{ NAMEHCR: "MIDLAND FINANCIAL CORP", NAME: "Hilltop National Bank", ASSET: 1e6, CERT: 9 }], "Hilltop Holdings Inc.")).toBeNull();
    expect(pickFdicFuzzy([{ NAMEHCR: "", NAME: "Zions Bancorporation, N.A.", ASSET: 8.9e7, CERT: 2270 }], "ZIONS BANCORPORATION, N.A.")).toBe(2270);
  });
  it("keeps Wikipedia titles URL-safe", () => {
    expect(wikiTitle("https://en.wikipedia.org/wiki/Johnson_%26_Johnson")).toBe("Johnson_%26_Johnson");
    expect(wikiTitle("https://en.wikipedia.org/wiki/Tesla,_Inc.")).toBe("Tesla,_Inc.");
  });
  it("only asks sources that can know about the company", () => {
    const bank = { ticker: "JPM", sector: "Financials", industry: "Banks" };
    expect(appliesTo("bank", bank, { fdic: 628 })).toBe(true);
    expect(appliesTo("bank", bank, {})).toBe(false);
    expect(appliesTo("trials", bank, {})).toBe(false);
    expect(appliesTo("trials", { ticker: "LLY", sector: "Health Care", industry: "Pharmaceuticals" }, {})).toBe(true);
    expect(appliesTo("regulatory", bank, undefined)).toBe(true);
  });
});

describe("dedupeRegistry", () => {
  it("drops a name two different filers matched, keeps share classes and removes known false makers", () => {
    const cik: Record<string, string> = { FBP: "1", FBNC: "2", GOOG: "3", GOOGL: "3", GE: "4" };
    const out = dedupeRegistry(
      { FBP: { cfpb: "First Bancorp North Carolina" }, FBNC: { cfpb: "First Bancorp North Carolina" }, GOOG: { wiki: "Alphabet_Inc." }, GOOGL: { wiki: "Alphabet_Inc." }, GE: { maker: "GENERAL ELECTRIC", wiki: "GE_Aerospace" } },
      (t) => cik[t],
    );
    expect(out.FBP.cfpb).toBeUndefined();
    expect(out.FBNC.cfpb).toBeUndefined();
    expect(out.GOOGL.wiki).toBe("Alphabet_Inc.");
    expect(out.GE).toEqual({ wiki: "GE_Aerospace" });
  });
});

