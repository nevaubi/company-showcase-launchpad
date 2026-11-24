import { describe, expect, it } from "vitest";
import { describeFiling, familyOf, filedByIssuer, formChip, formName, informativeDesc, itemsInWords } from "./kinds";

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
    expect(describeFiling({ form: "8-K", items: "2.02,5.02,7.01,9.01", desc: "8-K" })).toEqual({ title: "Earnings release", detail: "Director or officer change · Regulation FD disclosure", alert: false });
    expect(describeFiling({ form: "8-K/A", items: "5.02", desc: "8-K/A" })).toEqual({ title: "Director or officer change (amended)", detail: null, alert: false });
    expect(describeFiling({ form: "10-K", desc: "10-K" })).toEqual({ title: "Annual report", detail: null, alert: false });
  });

  it("leads with non-reliance on prior financial statements, even over earnings", () => {
    const d = describeFiling({ form: "8-K", items: "2.02,4.02,9.01" });
    expect(d).toEqual({ title: "Non-reliance on previously issued financial statements", detail: "Earnings release (Item 2.02)", alert: true });
    expect(describeFiling({ form: "8-K", items: "5.02,2.02" }).title).toBe("Earnings release");
    expect(describeFiling({ form: "8-K", items: "8.01,9.01" }).title).toBe("Other events");
  });

  it("tells the company's own Schedule 13 filings from stakes in it", () => {
    // JPM 0000019617-26-000402 is filed by JPMorgan (CIK 19617) about Korsana Biosciences
    expect(filedByIssuer("0000019617-26-000402", "19617")).toBe(true);
    expect(filedByIssuer("0000950103-26-000402", "19617")).toBe(false);
    expect(describeFiling({ form: "SCHEDULE 13G", selfFiled: true }).title).toBe("Company's own holdings filing (stake in another issuer)");
    expect(describeFiling({ form: "SCHEDULE 13G/A", selfFiled: false }).title).toBe("Passive stake over 5% (amended)");
  });
});

describe("EDGAR descriptions", () => {
  it("keeps only what adds to the form name", () => {
    // real descriptions from sec_filings, 2026-11-20 and 2026-11-23
    expect(informativeDesc("8-K 11.20.26 SEYMOUR RETIREMENT", "8-K")).toBe("Seymour Retirement");
    expect(informativeDesc("8-K - JKHY - 2026.11.19 - ANNOUNCING 2026 VOTING RESULTS", "8-K")).toBe("Announcing 2026 Voting Results");
    for (const [d, f] of [["PRIMARY DOCUMENT", "4"], ["FORM 4", "4"], ["8-K", "8-K"], ["FORM 8-K", "8-K"], ["CURRENT REPORT", "8-K"], ["STATEMENT OF CHANGES IN BENEFICIAL OWNERSHIP OF SECURITIES", "4"], ["OWNERSHIP DOCUMENT", "3"], ["FORM S-8", "S-8"], ["10-K", "10-K"], ["", "8-K"]])
      expect([d, informativeDesc(d, f)]).toEqual([d, null]);
    expect(informativeDesc("THE BUCKLE, INC. 8-K", "8-K", "The Buckle, Inc.")).toBeNull();
    expect(informativeDesc("8-K - JAMES MORTON RETIREMENT", "8-K")).toBe("James Morton Retirement");
    expect(informativeDesc("TMUS FORM 10-Q", "10-Q")).toBeNull();
    expect(informativeDesc("8-K - JKHY - 2026.09.30 - Q1 FY27 PRESS RELEASE", "8-K")).toBe("Q1 FY27 Press Release");
    expect(informativeDesc("FORM- DEF 14A", "DEF 14A")).toBeNull();
    expect(informativeDesc("10-Q (Q3 2026)", "10-Q")).toBe("Q3 2026");
    expect(informativeDesc("SEABOARD CORPORATION 8-K DATED NOVEMBER 3, 2026", "8-K", "Seaboard Corp")).toBeNull();
    expect(informativeDesc("8-K, CHCO DIV 10 2026", "8-K")).toBe("CHCO Div 10 2026");
  });
});

describe("every form in production sec_filings has a family and a name", () => {
  // the 77 forms in sec_filings on 23 Nov 2026 that the review found unclassified or unnamed
  const cases: [string, string][] = [
    ["PRER14A", "proxy"], ["PX14A6G", "proxy"], ["DEFN14A", "proxy"], ["PRE 14A", "proxy"], ["PRE 14C", "proxy"], ["PREC14A", "proxy"], ["DEFC14A", "proxy"], ["DEF 14C", "proxy"], ["DEFA14C", "proxy"], ["PRRN14A", "proxy"],
    ["SC TO-C", "offerings"], ["8-K12B", "current"], ["S-11", "offerings"], ["S-11MEF", "offerings"], ["DRS", "offerings"], ["15-12G", "offerings"], ["RW", "offerings"],
    ["NT 20-F", "periodic"], ["NT 11-K", "periodic"], ["10-QT", "periodic"],
  ];
  it.each(cases)("%s is %s and has a plain name", (form, family) => {
    expect(familyOf(form)).toBe(family);
    expect(formName(form)).not.toBe(form);
  });
  it("names the rest and fixes Form SD", () => {
    for (const f of ["N-PX", "305B2", "ABS-15G", "CT ORDER"]) expect(formName(f)).not.toBe(f);
    expect(formName("SD")).toBe("Specialized disclosure (Form SD)");
    expect(formName("144")).toBe("Notice of proposed sale (Rule 144)");
  });
});
