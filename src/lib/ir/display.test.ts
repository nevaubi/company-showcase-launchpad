import { describe, expect, it } from "vitest";
import { countScale, fmtIr, libraryTitle, rowDecimals } from "./display";

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
  });
});
