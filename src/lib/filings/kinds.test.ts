import { describe, expect, it } from "vitest";
import { describeFiling, familyOf, formChip, formName, informativeDesc, itemsInWords } from "./kinds";

describe("form families", () => {
  it("places the forms seen in sec_filings", () => {
    const cases: [string, string][] = [
      ["10-K", "periodic"], ["10-Q/A", "periodic"], ["8-K", "current"], ["8-K/A", "current"],
      ["4", "ownership"], ["4/A", "ownership"], ["3", "ownership"], ["144", "ownership"], ["144/A", "ownership"],
      ["SCHEDULE 13G/A", "ownership"], ["SC 13D", "ownership"], ["13F-HR", "ownership"],
      ["DEF 14A", "proxy"], ["DEFA14A", "proxy"], ["DFAN14A", "proxy"], ["PREM14A", "proxy"], ["ARS", "proxy"],
      ["S-8", "offerings"], ["S-8 POS", "offerings"], ["424B5", "offerings"], ["425", "offerings"], ["8-A12B", "offerings"], ["25-NSE", "offerings"], ["EFFECT", "offerings"],
      ["CORRESP", "correspondence"], ["UPLOAD", "correspondence"],
      ["SD", "other"], ["11-K", "other"], ["IRANNOTICE", "other"],
    ];
    for (const [form, fam] of cases) expect([form, familyOf(form)]).toEqual([form, fam]);
  });

  it("names forms plainly, amendments included", () => {
    expect(formName("10-K/A")).toBe("Annual report (amended)");
    expect(formName("SCHEDULE 13G")).toBe("Passive stake over 5%");
    expect(formName("424B3")).toBe("Prospectus");
    expect(formName("XYZ")).toBe("XYZ");
    expect(formChip("SCHEDULE 13G/A")).toBe("13G/A");
  });
});

describe("8-K items in plain words", () => {
  it("drops the exhibits item unless it is alone", () => {
    expect(itemsInWords("2.02,9.01")).toEqual(["Results of operations"]);
    expect(itemsInWords("9.01")).toEqual(["Financial statements and exhibits"]);
    expect(itemsInWords("1.01,2.03,5.03,5.07,9.01")).toEqual(["Material agreement", "New debt or obligation", "Bylaws or charter amended", "Shareholder vote results"]);
    expect(itemsInWords("")).toEqual([]);
    expect(itemsInWords("7.09")).toEqual(["Item 7.09"]);
  });

  it("titles an earnings 8-K as an earnings release and lists the rest", () => {
    // IESC 8-K filed 2026-11-20 (sec_filings): items 2.02,5.02,7.01,9.01
    expect(describeFiling({ form: "8-K", items: "2.02,5.02,7.01,9.01", desc: "8-K" })).toEqual({ title: "Earnings release", detail: "Director or officer change · Regulation FD disclosure" });
    expect(describeFiling({ form: "8-K/A", items: "5.02", desc: "8-K/A" })).toEqual({ title: "Director or officer change (amended)", detail: null });
    expect(describeFiling({ form: "10-K", desc: "10-K" })).toEqual({ title: "Annual report", detail: null });
  });
});

describe("EDGAR descriptions", () => {
  it("keeps only what adds to the form name", () => {
    // real descriptions from sec_filings, 2026-11-20 and 2026-11-23
    expect(informativeDesc("8-K 11.20.26 SEYMOUR RETIREMENT", "8-K")).toBe("Seymour retirement");
    expect(informativeDesc("8-K - JKHY - 2026.11.19 - ANNOUNCING 2026 VOTING RESULTS", "8-K")).toBe("Announcing 2026 voting results");
    for (const [d, f] of [["PRIMARY DOCUMENT", "4"], ["FORM 4", "4"], ["8-K", "8-K"], ["FORM 8-K", "8-K"], ["CURRENT REPORT", "8-K"], ["STATEMENT OF CHANGES IN BENEFICIAL OWNERSHIP OF SECURITIES", "4"], ["OWNERSHIP DOCUMENT", "3"], ["FORM S-8", "S-8"], ["10-K", "10-K"], ["", "8-K"]])
      expect([d, informativeDesc(d, f)]).toEqual([d, null]);
    expect(informativeDesc("THE BUCKLE, INC. 8-K", "8-K")).toBe("The buckle, inc.");
  });
});
