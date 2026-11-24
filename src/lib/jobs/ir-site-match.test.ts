import { describe, expect, it } from "vitest";
import { citesTicker, judgeHit, namesCompany, networkFolder, onHost, type CompanyEvidence, type SiteHit } from "@/lib/jobs/ir-site-match";

// The rule irSiteCandidates used before (kept here only to show each refused case used to pass).
const oldRule = (hit: SiteHit, ticker: string, shortName: string) => {
  const named = `${hit.title} ${hit.url}`.toLowerCase();
  return named.includes(ticker.toLowerCase()) || named.includes(shortName.toLowerCase().split(/[ .']/)[0]);
};

const co = (ticker: string, shortName: string, ownHosts: string[] = [], knownFolders: string[] = []): CompanyEvidence => ({ ticker, shortName, ownHosts, knownFolders });

// Short names as the coverage list holds them (24 Nov 2026).
const ON = co("ON", "ON Semiconductor", ["investor.onsemi.com", "onsemi.com"]);
const FOXA = co("FOXA", "Fox", ["investor.foxcorporation.com", "foxcorporation.com"]);
const NBTB = co("NBTB", "NBT Bank", ["nbtbancorp.com"]);
const WABC = co("WABC", "Westamerica Bank", ["westamerica.com"]);
const TFSL = co("TFSL", "TFS Financial", ["thirdfederal.com"]);
const COKE = co("COKE", "Coca-Cola Consolidated", ["investor.cokeconsolidated.com", "cokeconsolidated.com"]);

describe("irSiteCandidates hit rule: other companies' files are refused", () => {
  // Hits on content networks shaped like the stored wrong files (p3-irsrc, p4-src3 title samples).
  const cases: [CompanyEvidence, SiteHit, boolean][] = [
    // "on" is a substring of "presentation": the old rule took any deck for onsemi
    [ON, { url: "https://s21.q4cdn.com/123456789/files/doc_presentations/2026/Investor-Presentation.pdf", title: "Q3 2026 Investor Presentation" }, true],
    // "fox" is in Fox Factory's name
    [FOXA, { url: "https://s28.q4cdn.com/555000111/files/doc_financials/2025/q4/FOXF-Q4-2025-Presentation.pdf", title: "Fox Factory Holding Corp. Q4 2025 Investor Presentation" }, true],
    // The Bancorp's q4 folder, guarded under NBTB on 24 Nov 2026
    [NBTB, { url: "https://s27.q4cdn.com/928525813/files/doc_news/The-Bancorp-Reports-3Q-2026-EPS.pdf", title: "NBT shareholders: The Bancorp Reports 3Q 2026 EPS of $1.53" }, true],
    // Western Alliance's q4 folder, guarded under WABC
    [WABC, { url: "https://s21.q4cdn.com/328636679/files/doc_news/Western-Alliance-Bancorporation-to-Host-2026-Investor-Day.pdf", title: "Western Alliance Bancorporation to Host 2026 Investor Day (WAL)" }, false],
    // Toyota Financial Services: "tfs" in the address, "financial" in the title
    [TFSL, { url: "https://s1.q4cdn.com/700700700/files/TFS-Fixed-Income-Q2-FY2026.pdf", title: "Toyota Financial Services fixed income update" }, true],
    // The Coca-Cola Company, not Coca-Cola Consolidated
    [COKE, { url: "https://s2.q4cdn.com/900900900/files/doc_financials/2026/q2/Coca-Cola-Q2-2026-Earnings-Release.pdf", title: "Coca-Cola Reports Second Quarter 2026 Results" }, true],
  ];
  it.each(cases.map(([c, h, o]) => [c.ticker, c, h, o] as const))("%s", (_t, c, hit, oldAccepted) => {
    expect(oldRule(hit, c.ticker, c.shortName)).toBe(oldAccepted);
    expect(judgeHit(hit, c).own).toBe(false);
  });

  it("a host is the company's only on a label boundary (ridefox.com is not fox.com)", () => {
    expect(onHost("investor.ridefox.com", "fox.com")).toBe(false);
    expect(onHost("ir.fox.com", "fox.com")).toBe(true);
    expect(judgeHit({ url: "https://investor.ridefox.com/static-files/abc.pdf", title: "Fox Factory Q3" }, co("FOXA", "Fox", ["fox.com"])).own).toBe(false);
    expect(judgeHit({ url: "https://sonal.co.in/wp-content/uploads/Results.pdf", title: "Audited Results" }, ON).own).toBe(false);
  });
});

describe("irSiteCandidates hit rule: the company's own decks pass", () => {
  it("AAPL by the q4 folder its stored files already use (s2.q4cdn.com/470004039, 18 files)", () => {
    const aapl = co("AAPL", "Apple", ["investor.apple.com", "apple.com"], ["q4cdn/470004039"]);
    const hit = { url: "https://s2.q4cdn.com/470004039/files/doc_earnings/2026/q4/filing/_10-K-Q4-2026-As-Filed.pdf", title: "10-K Q4 2026" };
    expect(judgeHit(hit, aapl)).toEqual({ own: true, why: "known folder" });
    // without the folder, "Apple" alone is a common word; with its legal form it names the company
    const bare = co("AAPL", "Apple", ["apple.com"]);
    expect(judgeHit({ ...hit, url: "https://s2.q4cdn.com/999/files/x.pdf", title: "Apple Hospitality REIT Q3 deck" }, bare).own).toBe(false);
    expect(judgeHit({ ...hit, url: "https://s2.q4cdn.com/999/files/x.pdf", title: "Apple Inc. Q4 FY26 Financial Statements" }, bare)).toEqual({ own: true, why: "name" });
  });

  it("NVDA by folder (s201.q4cdn.com/141608511, 76 files) and by its distinctive name", () => {
    const nvda = co("NVDA", "NVIDIA", ["investor.nvidia.com", "nvidia.com"], ["q4cdn/141608511"]);
    expect(judgeHit({ url: "https://s201.q4cdn.com/141608511/files/content_files/Fall-2026-NDR_Final.pdf", title: "Fall 2026 NDR" }, nvda).own).toBe(true);
    const noFolder = { ...nvda, knownFolders: [] };
    expect(judgeHit({ url: "https://s201.q4cdn.com/141608511/files/doc_financials/2027/Q3FY27/Rev_by_Mkt_Qtrly_Trend_Q327.pdf", title: "NVIDIA Q3 FY27 revenue by market" }, noFolder)).toEqual({ own: true, why: "name" });
    expect(judgeHit({ url: "https://s201.q4cdn.com/1/files/x.pdf", title: "Q3 FY27 CFO Commentary (NASDAQ: NVDA)" }, noFolder)).toEqual({ own: true, why: "ticker" });
  });

  it("JPM by its name on a content network, and on its own host", () => {
    const jpm = co("JPM", "JPMorgan Chase", ["jpmorganchase.com"]);
    expect(judgeHit({ url: "https://s1.q4cdn.com/777/files/3Q26-earnings-presentation.pdf", title: "JPMorgan Chase & Co. 3Q26 Earnings Presentation" }, jpm).own).toBe(true);
    expect(judgeHit({ url: "https://www.jpmorganchase.com/content/dam/jpmc/jpmorgan-chase-and-co/investor-relations/documents/quarterly-earnings/2026/3rd-quarter/x.pdf", title: "Earnings" }, jpm)).toEqual({ own: true, why: "own host" });
  });

  it("Coca-Cola Consolidated's own release names it in full", () => {
    expect(judgeHit({ url: "https://s3.q4cdn.com/111/files/q3.pdf", title: "Coca-Cola Consolidated Reports Third Quarter 2026 Results" }, COKE).own).toBe(true);
  });
});

describe("pieces", () => {
  it("networkFolder keys a q4 site by its id on any sNN host and a gcs-web site by its subdomain", () => {
    expect(networkFolder("https://s21.q4cdn.com/328636679/files/x.pdf")).toBe("q4cdn/328636679");
    expect(networkFolder("https://s5.q4cdn.com/328636679/files/y.pdf")).toBe("q4cdn/328636679");
    expect(networkFolder("https://hubbell.gcs-web.com/static-files/abc")).toBe("hubbell.gcs-web.com");
    expect(networkFolder("https://investor.apple.com/x.pdf")).toBeNull();
    expect(networkFolder("not a url")).toBeNull();
  });
  it("names need whole words in order; tickers need capitals and three letters", () => {
    expect(namesCompany("Westamerica Bancorporation Q3", "Westamerica Bank")).toBe(false);
    expect(namesCompany("Westamerica Bank 3Q results", "Westamerica Bank")).toBe(true);
    expect(namesCompany("onsemi presentation", "ON Semiconductor")).toBe(false);
    expect(namesCompany("Fox Corporation fiscal 2026 results", "Fox")).toBe(true);
    expect(namesCompany("Fox Factory Holding Corp. results", "Fox")).toBe(false);
    expect(citesTicker("Board meeting ON 12 June", "ON")).toBe(false);
    expect(citesTicker("The cost of capital", "COST")).toBe(false);
    expect(citesTicker("nvda deck", "NVDA")).toBe(false);
    expect(citesTicker("(NYSE: WABC)", "WABC")).toBe(true);
  });
});
