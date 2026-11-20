import { describe, expect, it } from "vitest";
import { awardTie, companyKeys, contractRowBelongs, ignoredFilter, isCompanyName, legalForm, nameCore, pickParents, screenContractRows, tickerKeys, type ParentFamily } from "./contracts";
import { COMPANY_NAMES, CONTRACT_ROWS } from "./contracts.fixture";

const keysOf = (t: string) => (COMPANY_NAMES[t] ? tickerKeys(t, COMPANY_NAMES[t].short, COMPANY_NAMES[t].sec) : null);
const asRow = (r: (typeof CONTRACT_ROWS)[number]) => ({
  ticker: r.ticker,
  dataset: "contracts",
  kind: r.kind,
  meta: r.kind === "series" ? { recipients: r.recipient.split(";") } : { award_id: r.award, recipient: r.recipient },
});
const belongs = (r: (typeof CONTRACT_ROWS)[number]) => contractRowBelongs(asRow(r), keysOf(r.ticker)!);
const pick = (ticker: string, award: string) => CONTRACT_ROWS.filter((r) => r.ticker === ticker && r.award === award);

// Responses recorded from api.usaspending.gov on 2026-11-20 (trimmed to the fields used).
const HONEYWELL_SEARCH = [
  { id: "a281345d-2343-2f48-369a-746f3ec8888f-P", uei: "JXSUJ4ALFHB4", name: "HONEYWELL INTERNATIONAL INC.", recipient_level: "P", amount: 3694521081.21 },
  { id: "9e9725ba-e023-684e-6d7f-f9de4201578f-C", uei: "DMEGBYTVBQS5", name: "HONEYWELL FEDERAL MANUFACTURING & TECHNOLOGIES, LLC", recipient_level: "C", amount: 2551656707.33 },
  { id: "9e9725ba-e023-684e-6d7f-f9de4201578f-P", uei: "DMEGBYTVBQS5", name: "HONEYWELL FEDERAL MANUFACTURING & TECHNOLOGIES, LLC", recipient_level: "P", amount: 703884063.2 },
  { id: "8b9353d3-556e-0888-6768-ad48b66a5f22-C", uei: "EL21GMJNB1E5", name: "HONEYWELL BUILDING SOLUTIONS SES CORP", recipient_level: "C", amount: 20918646.23 },
];
const HONEYWELL_FAMILY: ParentFamily = {
  parent: HONEYWELL_SEARCH[0],
  children: [
    { recipient_id: "5fed3bc7-8243-88c2-d281-5ee1e08a992f-C", uei: "MMA7H4NEMCT9", name: "CAES SYSTEMS LLC" },
    { recipient_id: "b52d549e-73f7-a818-8c63-4a75904c9df5-C", uei: "LUJEPCRRT377", name: "NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC" },
    { recipient_id: "f624bb0c-c85e-d8e7-ce74-b8080a10bce6-C", uei: "YSYZHPCG4XB3", name: "MISSION SUPPORT & TEST SERVICES LLC" },
  ],
};
const AWARD_MESSAGES = [
  "For searches, time period start and end dates are currently limited to an earliest date of 2007-10-01.  For data going back to 2000-10-01, use either the Custom Award Download feature on the website or one of our download or bulk_download API endpoints as listed on https://api.usaspending.gov/docs/endpoints. ",
  "The following filters from the request were not used: {'recipient_id'}. See https://api.usaspending.gov/docs/endpoints for a list of appropriate filters",
];

describe("contract recipient names", () => {
  it("reduces names to their core and legal form", () => {
    expect(nameCore("THE BOEING COMPANY")).toBe("boeing");
    expect(nameCore("DANAHER CORP /DE/")).toBe("danaher");
    expect(nameCore("MEDTRONIC PUBLIC LIMITED COMPANY")).toBe("medtronic");
    expect(legalForm("BALL PAVILION, THE")).toBe("");
    expect(legalForm("BALL Corp")).toBe("corp");
    expect(legalForm("Ball Corporation")).toBe("corp");
    expect(legalForm("CRANE & CO., INC.")).toBe("inc");
  });

  it("accepts the company itself under its registry spellings", () => {
    const k = keysOf("LMT")!;
    expect(isCompanyName("LOCKHEED MARTIN CORP", k)).toBe(true);
    expect(isCompanyName("LOCKHEED MARTIN CORPORATION", k)).toBe(true);
    expect(isCompanyName("LOCKHEED MARTIN SERVICES, LLC", k)).toBe(false);
    expect(isCompanyName("THE BOEING COMPANY", keysOf("BA")!)).toBe(true);
    expect(isCompanyName("DANAHER CORPORATION", keysOf("DHR")!)).toBe(true);
  });

  it("refuses prefix look-alikes and people that share a one-word name", () => {
    expect(isCompanyName("ROGERS, WICKER, RYKMAN AND SPEDALE LLC", keysOf("ROG")!)).toBe(false);
    expect(isCompanyName("ROGERS HELICOPTERS INC", keysOf("ROG")!)).toBe(false);
    expect(isCompanyName("KIRBY, BETTY", keysOf("KEX")!)).toBe(false);
    expect(isCompanyName("KIRBY - SMITH MACHINERY, INC.", keysOf("KEX")!)).toBe(false);
    expect(isCompanyName("KIRBY CORP", keysOf("KEX")!)).toBe(true);
    expect(isCompanyName("TREX ENTERPRISES CORPORATION", keysOf("TREX")!)).toBe(false);
    expect(isCompanyName("SABRE SYSTEMS, LLC", keysOf("SABR")!)).toBe(false);
  });

  it("asks a one-word name for the company's own legal form", () => {
    const k = keysOf("CR")!;
    expect(isCompanyName("CRANE CO.", k)).toBe(true);
    expect(isCompanyName("CRANE & CO., INC.", k)).toBe(false);
    const short = companyKeys(["Ball"], []);
    expect(isCompanyName("BALL CORPORATION", short)).toBe(false);
    expect(isCompanyName("BALL CORPORATION", keysOf("BALL")!)).toBe(true);
    expect(isCompanyName("BALL INC", keysOf("BALL")!)).toBe(false);
  });
});

describe("stored contract rows (production sample)", () => {
  it("drops government-wide awards copied onto unrelated companies", () => {
    for (const t of ["AAPL", "ABT", "PFE"]) for (const r of pick(t, "DEAC0576RL01830")) expect(belongs(r)).toBe(false);
    for (const t of ["AAPL", "ABT", "BA", "PFE"]) for (const r of pick(t, "DEAC0494AL85000")) expect(belongs(r)).toBe(false);
    expect(pick("LMT", "NAS1510000").map(belongs)).toEqual([false]);
  });

  it("keeps the same award under the company that received it", () => {
    expect(pick("LMT", "DEAC0494AL85000").map(belongs)).toEqual([true]);
    expect(pick("BA", "NAS1510000").map(belongs)).toEqual([true]);
    expect(pick("PFE", "W15QKN21C0012").map(belongs)).toEqual([true]);
  });

  it("hides subsidiaries the stored row cannot tie to the parent", () => {
    for (const a of ["DENA0003525", "DENA0002839"]) expect(pick("HON", a).map(belongs)).toEqual([false]);
    expect(pick("FLR", "DEAC0908SR22470").map(belongs)).toEqual([false]);
  });

  it("shows a subsidiary once the collector recorded the source's tie", () => {
    const row = { ticker: "HON", dataset: "contracts", kind: "event", meta: { recipient: "NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC", tie: "child", parent: "HONEYWELL INTERNATIONAL INC." } };
    expect(contractRowBelongs(row, keysOf("HON")!)).toBe(true);
    expect(contractRowBelongs({ ...row, meta: { ...row.meta, parent: "HONEYWELL FEDERAL MANUFACTURING & TECHNOLOGIES, LLC" } }, keysOf("HON")!)).toBe(false);
  });

  it("drops yearly totals that summed look-alike recipients", () => {
    const series = (t: string) => CONTRACT_ROWS.filter((r) => r.ticker === t && r.kind === "series").map(belongs);
    expect(series("ROG")).toEqual([false]);
    expect(series("KEX")).toEqual([false]);
    expect(series("BALL")).toEqual([false]);
    expect(series("ORCL")).toEqual([false]);
    expect(series("LMT")).toEqual([true]);
  });

  it("screens a mixed list and counts what is left", () => {
    const rows = CONTRACT_ROWS.map(asRow);
    const kept = screenContractRows(rows, keysOf);
    expect(rows.length).toBe(41);
    expect(kept.map((r) => `${r.ticker} ${r.meta.recipient ?? "series"}`)).toEqual([
      "BA THE BOEING COMPANY",
      "LMT LOCKHEED MARTIN CORP",
      "LMT series",
      "PFE PFIZER INC",
    ]);
    expect(screenContractRows([{ ticker: "ZZZZ", dataset: "contracts", kind: "event", meta: { recipient: "X" } }], keysOf)).toEqual([]);
    expect(screenContractRows([{ ticker: "ZZZZ", dataset: "fda", kind: "event", meta: {} }], keysOf)).toHaveLength(1);
  });
});

describe("collector checks on the source's own fields", () => {
  it("takes only parent-level recipients that are the company", () => {
    expect(pickParents(HONEYWELL_SEARCH, keysOf("HON")!).map((p) => p.id)).toEqual(["a281345d-2343-2f48-369a-746f3ec8888f-P"]);
  });

  it("notices when the award search ignored the company filter", () => {
    expect(ignoredFilter(AWARD_MESSAGES, "recipient_id")).toBe(true);
    expect(ignoredFilter(AWARD_MESSAGES.slice(0, 1), "recipient_id")).toBe(false);
    expect(ignoredFilter(AWARD_MESSAGES, "recipient_search_text")).toBe(false);
    expect(ignoredFilter(undefined, "recipient_id")).toBe(false);
  });

  it("ties an award to the company by name or by the source's child list, otherwise refuses it", () => {
    const k = keysOf("HON")!;
    expect(awardTie({ recipient: "HONEYWELL INTERNATIONAL INC", recipientId: "x", uei: "XLV3GRCKDDG6" }, [HONEYWELL_FAMILY], k)?.tie).toBe("name");
    const sandia = awardTie({ recipient: "NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC", recipientId: "b52d549e-73f7-a818-8c63-4a75904c9df5-C", uei: "LUJEPCRRT377" }, [HONEYWELL_FAMILY], k);
    expect(sandia?.tie).toBe("child");
    expect(sandia?.parent?.name).toBe("HONEYWELL INTERNATIONAL INC.");
    // the top government-wide award the ignored filter returned
    expect(awardTie({ recipient: "HUMANA GOVERNMENT BUSINESS INC", recipientId: "1068e466-707d-6b6f-367f-0255fab79b8c-C", uei: "ZE6ZM6NKSV43" }, [HONEYWELL_FAMILY], k)).toBeNull();
    // a family whose parent is not the company ties nothing
    expect(awardTie({ recipient: "CAES SYSTEMS LLC", uei: "MMA7H4NEMCT9" }, [{ ...HONEYWELL_FAMILY, parent: { id: "p", name: "HONEY WELL PLUMBING LLC" } }], k)).toBeNull();
  });
});
