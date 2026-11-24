import { describe, expect, it } from "vitest";
import {
  acceptName,
  applyCorrections,
  industryImplausible,
  nameVerdict,
  namesAgree,
  nameWords,
  sectorImplausible,
  type Correction,
} from "../../scripts/lib/coverage-names";

// Registrant names and former names as SEC's submissions files give them (data.sec.gov, 24 Nov 2026).
const HCC = { name: "WARRIOR MET COAL, INC.", former: [{ name: "WARRIOR MET COAL, LLC", to: "2017-04-13" }] };
const AGO = { name: "ASSURED GUARANTY LTD", former: [{ name: "AGC HOLDINGS LTD", to: "2003-12-23" }] };
const BFH = { name: "BREAD FINANCIAL HOLDINGS, INC.", former: [{ name: "ALLIANCE DATA SYSTEMS CORP", to: "2022-03-23" }] };
const ZD = {
  name: "ZIFF DAVIS, INC.",
  former: [
    { name: "J2 GLOBAL, INC.", to: "2021-10-04" },
    { name: "J2 GLOBAL COMMUNICATIONS INC", to: "2011-11-08" },
  ],
};

describe("nameWords", () => {
  it("drops legal forms, The, state suffixes and punctuation", () => {
    expect(nameWords("WELLS FARGO & COMPANY/MN")).toEqual(["wells", "fargo"]);
    expect(nameWords("The Goldman Sachs Group, Inc.")).toEqual(["goldman", "sachs"]);
    expect(nameWords("AT&T INC.")).toEqual(["att"]);
    expect(nameWords("W. W. Grainger")).toEqual(nameWords("W.W. GRAINGER, INC."));
    expect(nameWords("U.S. BANCORP \\DE\\")).toContain("us");
  });
});

describe("nameVerdict", () => {
  it("flags a name that belongs to another company", () => {
    expect(nameVerdict("Tokio Marine HCC", HCC.name, HCC.former).kind).toBe("unrelated");
    expect(nameVerdict("BlueMountain Capital", AGO.name, AGO.former).kind).toBe("unrelated");
  });
  it("flags a name that matches only a former name, and says which", () => {
    const b = nameVerdict("Alliance Data", BFH.name, BFH.former);
    expect(b).toEqual({ kind: "former", former: BFH.former[0] });
    expect(nameVerdict("J2 Global", ZD.name, ZD.former).kind).toBe("former");
  });
  it("calls a former name stale even when one of its words survived the rename", () => {
    const MLKN = { name: "MILLERKNOLL, INC.", former: [{ name: "HERMAN MILLER INC", to: "2021-10-29" }] };
    const WKC = { name: "WORLD KINECT CORP", former: [{ name: "WORLD FUEL SERVICES CORP", to: "2023-06-07" }] };
    expect(nameVerdict("Herman Miller", MLKN.name, MLKN.former).kind).toBe("former");
    expect(nameVerdict("World Fuel Services", WKC.name, WKC.former).kind).toBe("former");
    expect(nameVerdict("MillerKnoll", MLKN.name, MLKN.former).kind).toBe("current");
    expect(nameVerdict("World Kinect", WKC.name, WKC.former).kind).toBe("current");
    // A former name that only added a word is not stale: the current name still holds every word.
    expect(nameVerdict("Ziff Davis", ZD.name, [{ name: "ZIFF DAVIS HOLDINGS INC" }]).kind).toBe("current");
  });
  it("accepts the current registrant under short, brand and abbreviated names", () => {
    expect(nameVerdict("Warrior Met Coal", HCC.name, HCC.former).kind).toBe("current");
    expect(nameVerdict("Assured Guaranty", AGO.name).kind).toBe("current");
    expect(nameVerdict("Bread Financial", BFH.name, BFH.former).kind).toBe("current");
    expect(nameVerdict("3M", "3M CO").kind).toBe("current");
    expect(nameVerdict("AT&T", "AT&T INC.").kind).toBe("current");
    expect(nameVerdict("Alphabet", "Alphabet Inc.").kind).toBe("current");
    expect(nameVerdict("Wells Fargo", "WELLS FARGO & COMPANY/MN").kind).toBe("current");
    expect(nameVerdict("Coca-Cola", "COCA COLA CO").kind).toBe("current");
    expect(nameVerdict("GE Aerospace", "GENERAL ELECTRIC CO").kind).toBe("current");
    expect(nameVerdict("JetBlue", "JETBLUE AIRWAYS CORP").kind).toBe("current");
  });
  it("does not let a shared filler word make two companies agree", () => {
    expect(namesAgree("Tokio Marine Holdings Inc", "Warrior Met Coal Holdings Inc")).toBe(false);
    expect(namesAgree("The Group Co", "Group Inc")).toBe(false);
  });
});

describe("acceptName (the generator's rule for display-name candidates)", () => {
  it("rejects another company's label and a former name, keeps the current one", () => {
    expect(acceptName("Tokio Marine HCC", HCC.name)).toBe(false);
    expect(acceptName("Alliance Data", BFH.name)).toBe(false);
    expect(acceptName("J2 Global", ZD.name)).toBe(false);
    expect(acceptName("Ziff Davis", ZD.name)).toBe(true);
    expect(acceptName(null, ZD.name)).toBe(false);
  });
});

describe("SIC plausibility", () => {
  it("flags a coal miner filed as Chemicals, not a chemicals maker", () => {
    expect(industryImplausible("Chemicals", "1220")).toBe(true);
    expect(industryImplausible("Chemicals", "2821")).toBe(false);
    expect(industryImplausible("Software", "1220")).toBe(false); // no opinion
  });
  it("flags a sector the SIC code rules out, and has no opinion on unlisted codes", () => {
    expect(sectorImplausible("Information Technology", "6022")).toBe(true);
    expect(sectorImplausible("Financials", "6022")).toBe(false);
    expect(sectorImplausible("Health Care", "6324")).toBe(false);
    expect(sectorImplausible("Industrials", "9999")).toBe(false);
  });
});

describe("applyCorrections", () => {
  const entry = (ticker: string, cik: string, shortName: string) => ({
    ticker,
    cik,
    shortName,
    sector: "Materials",
    industry: "Chemicals",
    group: "Chemicals",
    sectorEtf: "XLB",
    peers: ["DOW", "LYB"],
  });
  const fix = (o: Partial<Correction>): Correction => ({
    ticker: "HCC",
    cik: "1691303",
    field: "shortName",
    old: "Tokio Marine HCC",
    new: "Warrior Met Coal",
    source: "SEC registrant for CIK 1691303: WARRIOR MET COAL, INC.",
    ...o,
  });

  it("applies a sourced correction whose old value still matches, without mutating the input", () => {
    const input = [entry("HCC", "1691303", "Tokio Marine HCC"), entry("DOW", "1751788", "Dow")];
    const r = applyCorrections(input, [fix({}), fix({ field: "peers", old: ["DOW", "LYB"], new: ["AMR", "ARLP"] })]);
    expect(r.entries[0].shortName).toBe("Warrior Met Coal");
    expect(r.entries[0].peers).toEqual(["AMR", "ARLP"]);
    expect(r.entries[1]).toEqual(input[1]);
    expect(input[0].shortName).toBe("Tokio Marine HCC");
    expect(r.applied).toHaveLength(2);
    expect(r.rejected).toEqual([]);
  });

  it("reports and skips a correction whose old value no longer matches", () => {
    const r = applyCorrections([entry("HCC", "1691303", "Warrior Met")], [fix({})]);
    expect(r.entries[0].shortName).toBe("Warrior Met");
    expect(r.applied).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/old value no longer matches/);
  });

  it("reports a correction for another CIK, a missing ticker or no source", () => {
    const list = [entry("HCC", "1691303", "Tokio Marine HCC")];
    const r = applyCorrections(list, [fix({ cik: "1" }), fix({ ticker: "ZZZ" }), fix({ source: " " })]);
    expect(r.entries[0].shortName).toBe("Tokio Marine HCC");
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "CIK is 1691303, correction is for 1",
      "ticker not in the list",
      "no source",
    ]);
  });

  it("treats a value already corrected upstream as done, not as a conflict", () => {
    const r = applyCorrections([entry("HCC", "1691303", "Warrior Met Coal")], [fix({})]);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([]);
  });
});
