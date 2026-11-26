import { describe, expect, it } from "vitest";
import { classifyIrDocument, leadingText } from "./classify";

// Leading text of real exhibits (sec.gov, read 26 Nov 2026), as leadingText returns it.
const C_SUPPLEMENT = "CITIGROUP—QUARTERLY FINANCIAL DATA SUPPLEMENT 3Q26 Page Citigroup Financial Summary 1 Consolidated Statement of Income 2";
const C_RELEASE = "For Immediate Release Citigroup Inc. (NYSE: C) OCTOBER 13, 2026 THIRD QUARTER 2026 RESULTS AND KEY METRICS CHAIR AND CEO COMMENTARY";
const WFC_SUPPLEMENT = "3Q26 Quarterly Supplement Wells Fargo & Company and Subsidiaries QUARTERLY FINANCIAL DATA TABLE OF CONTENTS Page";
const WFC_RELEASE = "News Release | October 13, 2026 Wells Fargo Reports Third Quarter 2026 Net Income of $6.0 billion";
const KEY_SUPPLEMENT = "Consolidated Balance Sheets (dollars in millions) 9/30/2026 6/30/2026 9/30/2025 Assets Loans $ 112,993";
const SNOW_RELEASE = "Snowflake Reports Financial Results for the Second Quarter of Fiscal 2027 Product revenue of $1.49 billion Financial Highlights: • Revenue";

const kind = (p: Parameters<typeof classifyIrDocument>[0]) => classifyIrDocument(p).kind;

describe("classifyIrDocument: supplements and releases by their names and their own first lines", () => {
  it("C EX-99.2 c-ex99d2.htm, Quarterly Financial Data Supplement, is a supplement", () => {
    expect(kind({ exhibit: "EX-99.2", description: "EX-99.2", name: "c-ex99d2.htm", ext: "htm" })).toBe("other");
    expect(kind({ exhibit: "EX-99.2", description: "EX-99.2", name: "c-ex99d2.htm", ext: "htm", heading: C_SUPPLEMENT })).toBe("supplement");
  });
  it("C EX-99.1, whose first lines are a release, stays a press release", () => {
    expect(kind({ exhibit: "EX-99.1", description: "EX-99.1", name: "c-ex99d1.htm", ext: "htm", heading: C_RELEASE })).toBe("press-release");
  });
  it("WFC wfc3qer10-13x26ex992xsuppl.htm is a supplement by its name alone", () => {
    expect(kind({ exhibit: "EX-99.2", description: "EXHIBIT 99.2", name: "wfc3qer10-13x26ex992xsuppl.htm", ext: "htm" })).toBe("supplement");
    expect(kind({ exhibit: "EX-99.2", description: "EXHIBIT 99.2", name: "wfc3qer10-13x26ex992xsuppl.htm", ext: "htm", heading: WFC_SUPPLEMENT })).toBe("supplement");
    expect(kind({ exhibit: "EX-99.1", description: "EXHIBIT 99.1", name: "wfc3qer10-13x26ex991xrelea.htm", ext: "htm", heading: WFC_RELEASE })).toBe("press-release");
  });
  it("WFC ex993-wellsfargo3q26pres.htm is a presentation, a press release file name is not", () => {
    expect(kind({ exhibit: "EX-99.3", description: "EXHIBIT 99.3", name: "ex993-wellsfargo3q26pres.htm", ext: "htm" })).toBe("presentation");
    expect(kind({ exhibit: "EX-99.1", name: "ex991_pressreleasex033126.htm", ext: "htm" })).toBe("press-release");
  });
  it("PNC q32026financialhighlightsa.htm is a supplement, q32026financialsupplement.htm too", () => {
    expect(kind({ name: "q32026financialhighlightsa.htm", ext: "htm" })).toBe("supplement");
    expect(kind({ name: "q32026financialsupplement.htm", ext: "htm" })).toBe("supplement");
  });
  it("KEY a3q26erex993.htm, which opens on its balance sheet, is a supplement", () => {
    expect(kind({ exhibit: "EX-99.3", description: "EX-99.3", name: "a3q26erex993.htm", ext: "htm", heading: KEY_SUPPLEMENT })).toBe("supplement");
  });
  it("NTRS Trend Report is a supplement", () => {
    expect(kind({ exhibit: "EX-99.3", description: "Trend Report", name: "ntrs-20261022xex993.htm", ext: "htm" })).toBe("supplement");
  });
  it("SNOW fy2027q2earnings.htm is a press release; its Financial Highlights line does not make it a supplement", () => {
    expect(kind({ exhibit: "EX-99.1", description: "EX-99.1", name: "fy2027q2earnings.htm", ext: "htm", heading: SNOW_RELEASE })).toBe("press-release");
    expect(kind({ exhibit: "EX-99.1", description: "EX-99.1", name: "exhibit991.htm", ext: "htm", heading: SNOW_RELEASE })).toBe("press-release");
  });
  it("first lines never override a kind the name or description gives", () => {
    expect(kind({ exhibit: "EX-99.2", description: "Investor presentation", name: "a3q26slides.htm", ext: "htm", heading: C_SUPPLEMENT })).toBe("presentation");
    expect(kind({ exhibit: "EX-99.1", name: "x.htm", ext: "htm", heading: "Announcement of a conference call" })).toBe("press-release");
    expect(kind({ exhibit: "EX-99.4", name: "x.htm", ext: "htm", heading: "Letter to shareholders" })).toBe("other");
  });
});

describe("leadingText", () => {
  it("reads the text after the exhibit marker, without tags, entities or zero-width spaces", () => {
    const html = `<html><head><title>Document</title><style>p{}</style></head><body><p>EX-99.2 3 c-ex99d2.htm EX-99.2</p><p>Exhibit 99.2</p><p>&#8203;</p><p>CITIGROUP&#8212;QUARTERLY FINANCIAL DATA SUPPLEMENT</p><table><tr><td>3Q26</td></tr></table></body></html>`;
    expect(leadingText(html)).toBe("CITIGROUP—QUARTERLY FINANCIAL DATA SUPPLEMENT 3Q26");
  });
  it("keeps the start of a file without a marker and cuts at the limit", () => {
    expect(leadingText("<p>Consolidated Balance Sheets</p><p>(dollars in millions)</p>", 30)).toBe("Consolidated Balance Sheets (d");
  });
});
