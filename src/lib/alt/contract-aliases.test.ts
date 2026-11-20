import { describe, expect, it } from "vitest";
import { COVERAGE } from "@/lib/coverage";
import { CONTRACT_ALIASES } from "./contract-aliases";
import { contractRowBelongs, isCompanyName, nameCore, pickParents, sharedCores, tickerKeys, type UsaRecipient } from "./contracts";
import { CONTRACTOR_NAMES, CONTRACTOR_ROWS } from "./contracts-real.fixture";

const keysOf = (t: string) => tickerKeys(t, CONTRACTOR_NAMES[t].short, CONTRACTOR_NAMES[t].sec);
const is = (t: string, name: string) => isCompanyName(name, keysOf(t));

/** Stored rows that pass the name rule (name or alias), per ticker. */
function survivors() {
  const out = new Map<string, { stored: number; kept: number; events: number; series: number }>();
  for (const r of CONTRACTOR_ROWS) {
    const row = { dataset: "contracts", kind: r.kind, meta: r.kind === "series" ? { recipients: r.recipient.split(";") } : { recipient: r.recipient } };
    const o = out.get(r.ticker) ?? { stored: 0, kept: 0, events: 0, series: 0 };
    o.stored += r.n;
    if (contractRowBelongs(row, keysOf(r.ticker))) {
      o.kept += r.n;
      if (r.kind === "event") o.events += r.n;
      else o.series += r.n;
    }
    out.set(r.ticker, o);
  }
  return out;
}

// Recipient search results recorded from api.usaspending.gov on 2026-11-20 (name, level, UEI, amount).
const rec = (name: string, level: "P" | "C", uei: string, amount: number): UsaRecipient => ({ id: `${uei}-${level}`, name, uei, recipient_level: level, amount });
const SEARCH = {
  KBR: [rec("KBR WYLE SERVICES, LLC", "P", "TGPKTMN8YL31", 1302e6), rec("KBR, INC.", "P", "VJ3XVZC76HT9", 975e6), rec("KBR WYLE SERVICES, LLC", "C", "HYBLSJAMM2F4", 807e6), rec("KBR DIEGO GARCIA, LLC", "P", "F6U3MGTBLM69", 37e6)],
  AMZN: [rec("AMAZON WEB SERVICES, INC.", "P", "NQEWN6C1LSU5", 672e6), rec("AMAZON WEB SERVICES, INC", "P", "H6S2VKM5U6C5", 34e6), rec("AMAZON.COM SERVICES LLC", "P", "TMKBFBRHFKH3", 0.2e6)],
  RTX: [rec("RTX CORPORATION", "P", "PPLZG8J3N9D4", 35173e6), rec("CACI INTERNATIONAL INC", "P", "QSRTXLFKV857", 4326e6), rec("RTX BBN TECHNOLOGIES, INC.", "C", "JAXJSTJJSP74", 90e6), rec("GENERAL NUCLEAR ACQUISITION CORPORATION", "P", "RTXPGK5CC6N7", 2e6)],
  VVX: [rec("V2X AEROSPACE LLC", "P", "NVC1EFKKYB93", 1681e6), rec("V2X, INC.", "P", "CG8SV4246V29", 1221e6), rec("P.J. HELICOPTERS, INC.", "P", "V2XHBMFG2TP8", 10e6), rec("LOADPATH, LLC", "P", "FLAQN7M3V2X4", 6e6)],
  JNJ: [rec("JOHNSON & JOHNSON HEALTHCARE", "P", "LKV3QN1ND7D1", 0.1e6), rec("JOHNSON & JOHNSON CONSTRUCTION COMPANY CORP", "P", "J33BWHK84YQ8", 0.1e6), rec("JOHNSON & JOHNSON", "P", "F78LUT6M7HL6", -6e6)],
};

describe("hand-checked recipient aliases", () => {
  it("cites a source for every alias and lists each name once", () => {
    const covered = new Set(COVERAGE.map((c) => c.ticker));
    for (const [t, list] of Object.entries(CONTRACT_ALIASES)) {
      expect(covered.has(t), t).toBe(true);
      const names = list.map((a) => a.name);
      expect(new Set(names).size, t).toBe(names.length);
      for (const a of list) expect(a.source, `${t} ${a.name}`).toMatch(/^(10-K FY\d{4} \(filed \d{4}-\d\d-\d\d\) Exhibit 21 subsidiary list, https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/|SEC name history: |SEC company name )/);
    }
  });

  it("accepts former names and units USAspending prints under other names", () => {
    expect(is("RTX", "RAYTHEON COMPANY")).toBe(true);
    expect(is("RTX", "RTX CORPORATION")).toBe(true);
    expect(is("LHX", "HARRIS CORPORATION")).toBe(true);
    expect(is("LHX", "L3 TECHNOLOGIES, INC.")).toBe(true);
    expect(is("LHX", "L3 TECHNOLOGIES INC")).toBe(true);
    expect(is("AMZN", "AMAZON WEB SERVICES, INC")).toBe(true);
    expect(is("HUM", "HUMANA GOVERNMENT BUSINESS INC")).toBe(true);
    expect(is("KBR", "KBR WYLE SERVICES, LLC")).toBe(true);
    expect(is("VVX", "V2X AEROSPACE LLC")).toBe(true);
    // US operating companies of plc parents
    expect(is("MDT", "MEDTRONIC, INC.")).toBe(true);
    expect(is("LIN", "LINDE INC.")).toBe(true);
    expect(is("STE", "STERIS CORPORATION")).toBe(true);
    expect(is("MDT", "MEDTRONIC PUBLIC LIMITED COMPANY")).toBe(true);
  });

  it("stays strict: whole names only, nothing an allowed source does not list", () => {
    expect(is("RTX", "RAYTHEON")).toBe(false);
    expect(is("RTX", "RAYTHEON/LOCKHEED MARTIN JAVELIN JV")).toBe(false);
    expect(is("RTX", "RAYTHEON COMPANY OF ARIZONA LLC")).toBe(false);
    expect(is("AMZN", "AMAZON WEB SERVICES LLC")).toBe(false);
    expect(is("GOOGL", "GOOGLE PUBLIC SECTOR LLC")).toBe(false);
    expect(is("MDT", "MEDTRONIC SOFAMOR DANEK USA, INC")).toBe(false);
    expect(is("LIN", "LINDE LLC")).toBe(false);
  });

  it("finds the parents USAspending lists for these companies", () => {
    const pick = (t: keyof typeof SEARCH) => pickParents(SEARCH[t], keysOf(t)).map((p) => p.name);
    expect(pick("KBR")).toEqual(["KBR WYLE SERVICES, LLC", "KBR, INC.", "KBR DIEGO GARCIA, LLC"]);
    expect(pick("AMZN")).toEqual(["AMAZON WEB SERVICES, INC.", "AMAZON WEB SERVICES, INC", "AMAZON.COM SERVICES LLC"]);
    // "RTX" also matches UEIs that contain RTX (CACI's QSRTXLFKV857): refused by name
    expect(pick("RTX")).toEqual(["RTX CORPORATION"]);
    expect(pick("VVX")).toEqual(["V2X AEROSPACE LLC", "V2X, INC."]);
    // a parent with deobligations this year is still the parent
    expect(pick("JNJ")).toEqual(["JOHNSON & JOHNSON"]);
  });
});

describe("names that are not the company", () => {
  it("refuses people and trade names without a legal form", () => {
    const t = (tk: string, short: string, sec: string, name: string) => isCompanyName(name, tickerKeys(tk, short, sec));
    expect(t("SCHW", "Charles Schwab", "SCHWAB CHARLES CORP", "SCHWAB, CHARLES")).toBe(false);
    expect(t("SCHW", "Charles Schwab", "SCHWAB CHARLES CORP", "CHARLES SCHWAB")).toBe(false);
    expect(t("SCHW", "Charles Schwab", "SCHWAB CHARLES CORP", "SCHWAB CHARLES CORP")).toBe(true);
    expect(t("RHI", "Robert Half", "ROBERT HALF INC.", "ROBERT HALF")).toBe(false);
    expect(t("RHI", "Robert Half", "ROBERT HALF INC.", "ROBERT HALF INC")).toBe(true);
    expect(t("JKHY", "Jack Henry", "JACK HENRY & ASSOCIATES INC", "JACK HENRY")).toBe(false);
    // a company whose legal name has no form keeps its bare name
    expect(t("JNJ", "Johnson & Johnson", "JOHNSON & JOHNSON", "JOHNSON & JOHNSON")).toBe(true);
  });

  it("refuses a one-word name with words its legal name lacks", () => {
    const ball = tickerKeys("BALL", "Ball", "BALL Corp");
    expect(isCompanyName("BALL CORPORATION", ball)).toBe(true);
    expect(isCompanyName("BALL HOLDINGS CORPORATION", ball)).toBe(false);
    expect(isCompanyName("BALL GROUP CORP", ball)).toBe(false);
    expect(isCompanyName("THE BALL CORPORATION (A JV OF X AND Y)", ball)).toBe(false);
    expect(isCompanyName("BALL CORPORATION (THE)", ball)).toBe(true);
  });

  it("refuses a name two covered companies share, but not share classes of one company", () => {
    const shared = sharedCores(COVERAGE.map((c) => ({ cik: c.cik, names: [c.shortName] })));
    expect(shared.has(nameCore("FIRST BANCORP"))).toBe(true);
    for (const t of ["FBP", "FBNC"]) expect(isCompanyName("FIRST BANCORP", tickerKeys(t, COVERAGE.find((c) => c.ticker === t)!.shortName, "FIRST BANCORP", shared)), t).toBe(false);
    expect(sharedCores([{ cik: "1", names: ["Alphabet"] }, { cik: "1", names: ["Alphabet Inc."] }]).size).toBe(0);
  });
});

describe("stored rows of the contractors in the review (production, 2026-11-20)", () => {
  const s = survivors();

  it("keeps the large contractors' own rows before any refresh", () => {
    // by name or alias alone; subsidiaries listed as children (GD's GDIT, NOC's Systems Corporation,
    // HII's units) are kept by the repair through the refreshed family list, see repair.test.ts
    expect(Object.fromEntries(["LMT", "BA", "HII", "LHX", "LDOS", "NOC", "GD", "HON", "CACI", "RTX"].map((t) => [t, s.get(t)!.kept]))).toEqual({
      LMT: 101, BA: 28, HII: 17, LHX: 50, LDOS: 108, NOC: 0, GD: 22, HON: 14, CACI: 64, RTX: 0,
    });
    expect(Object.fromEntries(["AMZN", "HUM", "KBR", "VVX", "CW", "GOOGL"].map((t) => [t, [s.get(t)!.kept, s.get(t)!.stored]]))).toEqual({
      AMZN: [47, 47], HUM: [5, 5], KBR: [97, 97], VVX: [55, 56], CW: [16, 48], GOOGL: [0, 9],
    });
  });

  it("still shows nothing for companies whose stored rows are other firms'", () => {
    for (const t of ["ROG", "KEX", "BALL", "TREX", "SABR", "TGT", "AAPL", "COMP", "PGR"]) expect(s.get(t)!.kept, t).toBe(0);
    // Resideo keeps only its own yearly totals, not the 17 Honeywell rows stored under it
    expect(s.get("REZI")).toMatchObject({ events: 0, series: 5 });
  });
});
