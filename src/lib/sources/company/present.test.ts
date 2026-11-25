import { describe, expect, it } from "vitest";
import { absSentence, assetsTie, dayLabel, historySeries, niceDomain, quarterLabel, showCell, tickText, unitLabel, usdShort } from "./present";
import type { BankHistory, OfficialCell } from "./types";

const num = (text: string): OfficialCell => ({ text, value: Number(text), kind: "number" });

describe("showCell", () => {
  it("groups amounts as stored and keeps the stored string one hover away", () => {
    expect(showCell(num("4174631000"), "USD thousands (monetary measures)")).toEqual({ text: "4,174,631,000", title: "As stored: 4174631000", empty: false });
    expect(showCell(num("4836.0"), "USD thousands (monetary measures)").text).toBe("4,836");
    expect(showCell(num("-113293.0"), "USD thousands (monetary measures)").text).toBe("−113,293");
  });
  it("rounds the FDIC's long percentages to two decimals, keeps FR Y-9C ratios as filed", () => {
    expect(showCell(num("2.8979666531354686"), "Percent")).toMatchObject({ text: "2.90", title: "As stored: 2.8979666531354686" });
    expect(showCell(num("-0.04730322351758596"), "Percent").text).toBe("−0.05");
    expect(showCell(num("13.9676"), "Percent", { decimals: "stored" }).text).toBe("13.9676");
  });
  it("tells a blank from a missing value, and shows a field without an established unit exactly as filed", () => {
    expect(showCell({ text: "", value: null, kind: "empty" }, "Percent")).toEqual({ text: "", title: "Empty in the filed report", empty: true });
    expect(showCell({ text: null, value: null, kind: "null" }, "Percent")).toEqual({ text: "–", title: "No value stored", empty: true });
    expect(showCell(num("5.4656"), null).text).toBe("5.4656");
    expect(showCell({ text: "NM", value: null, kind: "text" }, "Percent").text).toBe("NM");
  });
  it("names units briefly", () => {
    expect([unitLabel("Percent"), unitLabel("USD thousands (monetary measures)"), unitLabel("USD thousands"), unitLabel(null)]).toEqual(["%", "USD thousands", "USD thousands", "as filed"]);
  });
});

describe("historySeries", () => {
  const h: BankHistory = {
    cert: "1768",
    measures: [{ field: "ASSET", label: "Total assets", unit: "USD thousands (monetary measures)" }, { field: "RBCT1CER", label: "Common equity tier 1 ratio", unit: "Percent" }],
    sources: [{ dataset: "hist", snapshot: "a".repeat(64), retrievedAt: null, publishedAt: null, fileSha256: "", newerSnapshot: null }, { dataset: "cur", snapshot: "b".repeat(64), retrievedAt: null, publishedAt: null, fileSha256: "", newerSnapshot: null }],
    points: [
      { period: "2013-12-31", source: 0, row: 19213, cells: [num("3371419"), { text: "", value: null, kind: "empty" }] },
      { period: "2014-03-31", source: 0, row: 19214, cells: [num("3359907"), num("0.0")] },
      { period: "2015-03-31", source: 0, row: 29135, cells: [num("3346067"), num("17.24")] },
      { period: "2026-09-30", source: 1, row: 31, cells: [num("20957440"), num("15.81")] },
    ],
  };
  it("draws a CET1 ratio stored as zero as a gap: the quarter before it was reported", () => {
    const s = historySeries(h, "RBCT1CER");
    expect(s.points.map(p => [p.value, p.gap])).toEqual([[null, "empty"], [null, "not-reported"], [17.24, null], [15.81, null]]);
    expect(s.notReported).toBe(1);
  });
  it("points every value at its own record, the latest quarter at the current-quarter table", () => {
    const s = historySeries(h, "ASSET");
    expect(s.points[0].ref).toEqual({ dataset: "hist", snapshot: "a".repeat(64), row: 19213, field: "ASSET" });
    expect(s.points[3].ref).toEqual({ dataset: "cur", snapshot: "b".repeat(64), row: 31, field: "ASSET" });
    expect(historySeries(h, "NOPE").points).toEqual([]);
  });
});

describe("axis", () => {
  it("includes zero for amounts and spans the data in clean steps", () => {
    expect(niceDomain([1507103, 21245166], true)).toMatchObject({ min: 0, max: 25000000 });
    expect(niceDomain([10.06, 20.08], false)).toMatchObject({ min: 10, max: 22.5 });
    const net = niceDomain([-113293, 272643], false);
    expect(net.min).toBeLessThanOrEqual(-113293);
    expect(net.ticks).toContain(0);
  });
  it("writes ticks compactly only past 10,000", () => {
    expect([tickText(4_000_000_000, "USD thousands (monetary measures)"), tickText(2500, "USD thousands (monetary measures)"), tickText(-2.5, "Percent"), tickText(15, "Percent")]).toEqual(["4B", "2,500", "−2.5", "15"]);
  });
});

describe("assetsTie", () => {
  const q = (reportDate: string, text: string) => ({ reportDate, totalAssets: { ...num(text), unit: "USD thousands" } });
  it("compares the latest date both state, in dollars, and states a difference as one", () => {
    const quarters = [q("2026-06-30", "21233189"), q("2026-09-30", "20946950")];
    expect(assetsTie(quarters, d => (d === "2026-06-30" ? 21_231_189_000 : null))).toEqual({ kind: "differs", date: "2026-06-30", y9cUsd: 21_233_189_000, statementUsd: 21_231_189_000, difference: -2_000_000 });
    expect(assetsTie(quarters, () => 20_946_950_000)).toEqual({ kind: "equal", date: "2026-09-30", y9cUsd: 20_946_950_000, statementUsd: 20_946_950_000 });
    expect(assetsTie(quarters, () => null)).toEqual({ kind: "none" });
  });
});

describe("words", () => {
  it("says only what the deal header states", () => {
    expect(absSentence({ sponsorCik: "835271", sponsorName: "JPMorgan Chase Bank, N.A.", cert: "628", deals: 3, assetClass: "commercial mortgage" })).toBe("The filing header of 3 asset-backed deals names JPMorgan Chase Bank, N.A. as sponsor.");
    expect(absSentence({ sponsorCik: "35528", sponsorName: "FIFTH THIRD BANK, NATIONAL ASSOCIATION", cert: "6672", deals: 1, assetClass: "auto loan" })).toBe("The filing header of 1 asset-backed deal names FIFTH THIRD BANK, NATIONAL ASSOCIATION as sponsor.");
  });
  it("labels quarters, days and dollar differences", () => {
    expect([quarterLabel("2026-09-30"), quarterLabel("2000-03-31"), dayLabel("2026-06-30"), dayLabel(null)]).toEqual(["Q3 2026", "Q1 2000", "30 Jun 2026", "–"]);
    expect([usdShort(-2_000_000), usdShort(64_000_000), usdShort(1_500_000_000)]).toEqual(["−$2.0M", "$64.0M", "$1.5B"]);
  });
});

describe("statementTotalAssets", () => {
  it("reads the quarterly balance sheet first, then the annual one, with the cell's SEC source", async () => {
    const { statementTotalAssets } = await import("./present");
    const src = { accn: "0001628280-26-054343", concept: "us-gaap:Assets", end: "2026-06-30", value: 4_552_482_000_000 };
    const ds = { statements: { quarterly: { balance: { periods: [{ end: "2026-03-31" }, { end: "2026-06-30" }], rows: [{ key: "totalAssets", cells: [null, { v: 4_552_482_000_000, src }] }] } }, annual: { balance: { periods: [{ end: "2025-12-31" }], rows: [{ key: "totalAssets", cells: [{ v: 4_000_000_000_000 }] }] } } } };
    expect(statementTotalAssets(ds, "2026-06-30")).toEqual({ value: 4_552_482_000_000, src });
    expect(statementTotalAssets(ds, "2025-12-31")).toEqual({ value: 4_000_000_000_000, src: undefined });
    expect(statementTotalAssets(ds, "2026-03-31")).toBeNull();
    expect(statementTotalAssets(null, "2026-06-30")).toBeNull();
  });
});
