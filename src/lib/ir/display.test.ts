import { describe, expect, it } from "vitest";
import { countScale, countScales, fmtIr, groupTitle, libraryTitle, printedUnit, rowDecimals, rowLabel, shownLabel } from "./display";

describe("IR number formatting", () => {
  it("prints negatives with a true minus sign, not parentheses", () => {
    expect(fmtIr(-1_714_000_000, "usd", "M")).toBe("−1,714");
    expect(fmtIr(-0.3, "pct", "M")).toBe("−0.3%");
  });
  it("keeps one decimal convention across a row", () => {
    // NVIDIA OEM and Other, $M: 97, 126, 111 → whole millions; a row entirely under 10 gets one decimal.
    const d = rowDecimals([97e6, 126e6, 111e6], "usd", "M");
    expect([97e6, 126e6].map((v) => fmtIr(v, "usd", "M", { decimals: d }))).toEqual(["97", "126"]);
    const small = rowDecimals([3e6, 9.8e6], "usd", "M");
    expect(fmtIr(3e6, "usd", "M", { decimals: small })).toBe("3.0");
    // PNC effective tax rate: 18.8, 19, 20.5 → one decimal each.
    expect([18.8, 19, 20.5].map((v) => fmtIr(v, "pct", "M", { decimals: rowDecimals([18.8, 19, 20.5], "pct", "M") }))).toEqual(["18.8%", "19.0%", "20.5%"]);
  });
  it("states a count table's scale once instead of suffixing every cell", () => {
    // PNC average diluted common shares: 397, 405, 403 million.
    const sc = countScale([397e6, 405e6, 403e6]);
    expect(sc.caption).toBe("count, millions");
    expect(fmtIr(403e6, "count", "M", { countDiv: sc.div })).toBe("403.0");
  });
});

describe("small figures are never printed as zero (review H1, M1)", () => {
  it("gives a dollar row one decimal when any nonzero value is under 10, and never a signed zero", () => {
    const vals = [120e6, -0.4e6, 35e6];
    const d = rowDecimals(vals, "usd", "M");
    expect(vals.map((v) => fmtIr(v, "usd", "M", { decimals: d }))).toEqual(["120.0", "−0.4", "35.0"]);
    expect(fmtIr(-0.01e6, "usd", "M", { decimals: 0 })).toBe("−0.01");
    expect(fmtIr(-0, "usd", "M", { decimals: 1 })).toBe("0.0");
    expect(fmtIr(-0.00001, "pct", "M", { decimals: 1 })).toBe("0.0%");
  });
  it("scales a count table per row: customers in millions, branches and ATMs in full", () => {
    const rows = [[5_200_000, 5_300_000], [2_300, 2_310], [41, 43]];
    const sc = countScales(rows);
    expect(sc.caption).toBe("count");
    expect(sc.divs).toEqual([1e6, 1, 1]);
    expect(sc.note).toEqual(["millions", "", ""]);
    expect(rows.map((r, i) => fmtIr(r[0], "count", "M", { countDiv: sc.divs[i] }))).toEqual(["5.2", "2,300", "41"]);
    // One scale for all rows when they share it.
    expect(countScales([[397e6, 405e6], [12e6]]).caption).toBe("count, millions");
  });
  it("never puts a scale on a row whose small figures would read as zero", () => {
    expect(countScale([5_200_000, 41]).div).toBe(1);
    expect(fmtIr(41, "count", "M", { countDiv: 1e6 })).not.toMatch(/^0\.0+$/);
  });
});

describe("units of mixed 'as printed' lines (review M5)", () => {
  it("reads the unit printed after the number", () => {
    expect(printedUnit(["DSO 51 days", "45 days"])).toBe("days");
    expect(printedUnit(["Blackwell 0.4x"])).toBe("×");
    expect(printedUnit(["42,000 GPUs"])).toBe("GPUs");
    expect(printedUnit(["$1.2 million"])).toBe("");
    expect(printedUnit(["51 days", "3 weeks"])).toBe("");
  });
});

describe("library titles", () => {
  const t = (title: string, period: string | null = null, filed: string | null = "2026-11-17") => libraryTitle({ title, period, filed }, "Earnings release");
  it("replaces file names and ids with the kind and month", () => {
    // Stored NVDA and PNC titles from ir_documents.
    expect(t("q3fy27pr", "2026-11-17")).toBe("Earnings release · Nov 2026");
    expect(t("sbeoainvidia portsrelease", "2026-08-17", "2026-08-17")).toBe("Earnings release · Aug 2026");
    expect(t("2e217538 c226 4d05 8f74 aaca89a21b33", null, null)).toBe("Earnings release");
    expect(t("a2026 115xrlsxcfoxtransi", "2026-11-05", "2026-11-05")).toBe("Earnings release · Nov 2026");
    expect(t("8-K 2026-07-15 q22026financialhighlightsa.htm (Items 2.02,9.01)", "Q2 FY26", "2026-07-15")).toBe("Earnings release · Jul 2026");
  });
  it("keeps titles that read as titles", () => {
    expect(t("NVDA F3Q25 Quarterly Presentation FINAL")).toBe("NVDA F3Q25 Quarterly Presentation FINAL");
    expect(t("Q2 2026 Earnings presentation")).toBe("Q2 2026 Earnings presentation");
    expect(t("Rev by Mkt Qtrly Trend Q326")).toBe("Rev by Mkt Qtrly Trend Q326");
    // Review L7: an exhibit number or a large figure inside a real title.
    expect(t("Exhibit 99.1 NVIDIA Announces Financial Results for Third Quarter Fiscal 2027")).toBe("Exhibit 99.1 NVIDIA Announces Financial Results for Third Quarter Fiscal 2027");
    expect(t("Record revenue of $57,006 million")).toBe("Record revenue of $57,006 million");
  });
});

// Shot review p5-shots M3: labels the page composes from a parent and a child use a colon, never an em dash.
describe("p5-ir4: composed labels carry no em dash", () => {
  it("shows a reader's 'Heading — child' name with a colon and leaves other text as stored", () => {
    expect(shownLabel("Data Center — Compute")).toBe("Data Center: Compute");
    expect(rowLabel("Data Center — Networking", "Revenue")).toBe("Data Center: Networking");
    expect(rowLabel("Vyalev — U.S.", "Neuroscience — U.S.")).toBe("Vyalev");
    expect(rowLabel("Vyalev: U.S.", "Neuroscience: U.S.")).toBe("Vyalev");
    expect(shownLabel("Revenue 2024–2025")).toBe("Revenue 2024–2025");
  });
  // irpolish: JPM's stored names ("Net revenue — Managed basis", "Markets — revenue") reached tiles and rows.
  it("reads a stored name with an em dash as the company would print it, in sentence case", () => {
    expect(shownLabel("Net revenue — Managed basis")).toBe("Net revenue: managed basis");
    expect(shownLabel("Markets — revenue")).toBe("Markets: revenue");
    expect(shownLabel("U.S. offices — Noninterest-bearing")).toBe("U.S. offices: Noninterest-bearing");
    expect(shownLabel("Net income — Consumer & Community Banking")).toBe("Net income: Consumer & Community Banking");
    expect(shownLabel("Revenue—Americas")).toBe("Revenue: Americas");
    expect(shownLabel("Net revenue\u00a0—\u00a0Managed basis")).toBe("Net revenue: managed basis");
    expect(shownLabel("Card Services — Net charge-off rate")).toBe("Card Services: Net charge-off rate");
    for (const x of ["Net revenue — Managed basis", "A — B — C", "Total —", "— Total"]) expect(shownLabel(x)).not.toContain("—");
  });
  it("titles a list of loose lines with a colon", () => {
    expect(groupTitle({ id: "x", cat: "segment", met: "revenue", unit: "usd", label: "", root: null, rows: [] })).toBe("Revenue: other segment lines");
  });
});
