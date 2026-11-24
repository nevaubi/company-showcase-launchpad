import { describe, expect, it } from "vitest";
import {
  applyDetailCorrections,
  describesDefunct,
  descriptionAgrees,
  descriptionSubject,
  domainAgrees,
  fallbackDescription,
  registrableDomain,
  type CoverageDetails,
  type DetailCorrection,
} from "../../scripts/lib/coverage-details";

describe("registrableDomain", () => {
  it("drops scheme, www and subdomains, keeps country second levels", () => {
    expect(registrableDomain("http://investors.warriormetcoal.com/x")).toBe("warriormetcoal.com");
    expect(registrableDomain("https://www.bxp.com/")).toBe("bxp.com");
    expect(registrableDomain("https://sonal.co.in/investor-relations")).toBe("sonal.co.in");
    expect(registrableDomain("http://www.galaxyfm.co.uk")).toBe("galaxyfm.co.uk");
    expect(registrableDomain("")).toBeNull();
    expect(registrableDomain("not a url")).toBeNull();
  });
});

describe("domainAgrees", () => {
  it("flags another entity's site (the real cases)", () => {
    expect(domainAgrees("http://www.tmhcc.com", ["Warrior Met Coal", "WARRIOR MET COAL, INC.", "WARRIOR MET COAL, LLC"], "HCC")).toBe(false);
    expect(domainAgrees("https://www.bluemountaincapital.com", ["Assured Guaranty", "ASSURED GUARANTY LTD", "AGC HOLDINGS LTD"], "AGO")).toBe(false);
    expect(domainAgrees("http://www.helixesg.com/", ["Hornbeck Offshore", "HORNBECK OFFSHORE SERVICES, INC."], "HOS")).toBe(false);
    expect(domainAgrees("https://sonal.co.in/investor-relations", ["ON Semiconductor", "ON SEMICONDUCTOR CORP"], "ON")).toBe(false);
    expect(domainAgrees("http://www.ntoire-polus.ru/", ["IPG Photonics", "IPG PHOTONICS CORP"], "IPGP")).toBe(false);
  });
  it("a former name's domain agrees with the former name only", () => {
    const current = ["Ziff Davis", "ZIFF DAVIS, INC."];
    expect(domainAgrees("http://www.j2global.com", current, "ZD")).toBe(false);
    expect(domainAgrees("http://www.j2global.com", [...current, "J2 GLOBAL, INC."], "ZD")).toBe(true);
    expect(domainAgrees("http://www.actuant.com/", ["Enerpac Tool Group", "ENERPAC TOOL GROUP CORP"], "EPAC")).toBe(false);
  });
  it("does not flag the company's own words, initials, ticker or hosted IR subdomain", () => {
    expect(domainAgrees("https://www.warriormetcoal.com", ["WARRIOR MET COAL, INC."], "HCC")).toBe(true);
    expect(domainAgrees("http://www.hornbeckoffshore.com", ["HORNBECK OFFSHORE SERVICES, INC."], "HOS")).toBe(true);
    expect(domainAgrees("https://ir.cfsi.com", ["COMMUNITY FINANCIAL SYSTEM, INC."], "CBU")).toBe(true);
    expect(domainAgrees("https://www.jnj.com", ["Johnson & Johnson"], "JNJ")).toBe(true);
    expect(domainAgrees("https://www.rclinvestor.com", ["ROYAL CARIBBEAN CRUISES LTD"], "RCL")).toBe(true);
    expect(domainAgrees("https://hubbell.gcs-web.com", ["HUBBELL INC"], "HUBB")).toBe(true);
    expect(domainAgrees("https://www.h2o-america.com", ["H2O AMERICA"], "HTO")).toBe(true);
    expect(domainAgrees("https://www.digi.com/", ["DIGI INTERNATIONAL INC"], "DGII")).toBe(true);
    expect(domainAgrees("https://www.ufpi.com/", ["UFP INDUSTRIES INC"], "UFPI")).toBe(true);
  });
});

describe("descriptionSubject and descriptionAgrees", () => {
  const hcc = ["Warrior Met Coal", "WARRIOR MET COAL, INC.", "WARRIOR MET COAL, LLC"];
  it("reads the name a generated description opens with", () => {
    expect(descriptionSubject("Tokio Marine HCC is an international insurance group with offices across the United States.")).toBe("Tokio Marine HCC");
    expect(descriptionSubject("Lindsay Corporation, formerly known as Lindsay Manufacturing Co., is a manufacturer.")).toBe("Lindsay Corporation");
    expect(descriptionSubject("Medtronic plc is an international medical device company.")).toBe("Medtronic plc");
    expect(descriptionSubject("eBay Inc. is an American multinational e-commerce company.")).toBe("eBay Inc.");
  });
  it("has no subject for the curated, verb-led descriptions", () => {
    expect(descriptionSubject("Parent of Google. Generates most revenue from Search.")).toBeNull();
    expect(descriptionSubject("Accelerated computing company whose GPUs, networking and software platforms are the standard.")).toBeNull();
    expect(descriptionAgrees("Designs and sells iPhone, Mac, iPad and wearables.", ["Apple"])).toBe(true);
  });
  it("flags a description of another entity", () => {
    expect(descriptionAgrees("Tokio Marine HCC is an international insurance group.", hcc)).toBe(false);
    expect(descriptionAgrees("FMC Technologies, Inc. was a North American company.", ["TechnipFMC", "TechnipFMC plc", "TechnipFMC Ltd"])).toBe(false);
  });
  it("accepts the current, a former or the short name", () => {
    expect(descriptionAgrees("Warrior Met Coal, Inc. is a producer of met coal.", hcc)).toBe(true);
    expect(descriptionAgrees("J2 Global, Inc. was an American technology holding company.", ["Ziff Davis", "ZIFF DAVIS, INC.", "J2 GLOBAL, INC."])).toBe(true);
    expect(descriptionAgrees(undefined, hcc)).toBe(true);
  });
});

describe("describesDefunct", () => {
  it("flags a past-tense entry for a predecessor or another entity", () => {
    expect(describesDefunct("J2 Global, Inc. was an American technology holding company based in Los Angeles.")).toBe(true);
    expect(describesDefunct("Galaxy Digital was a radio station broadcasting through the digital platform across the United Kingdom.")).toBe(true);
    expect(describesDefunct("The Hewlett-Packard Company, commonly shortened to Hewlett-Packard or HP, was an American multinational company.")).toBe(true);
  });
  it("leaves present tense and founding history alone", () => {
    expect(describesDefunct("Azenta, was founded in 1978, and is based in Burlington, Massachusetts.")).toBe(false);
    expect(describesDefunct("LPL Financial Holdings Inc. was founded in 1989.")).toBe(false);
    expect(describesDefunct("Artivion, Inc. is a distributor of cryogenically preserved human tissues.")).toBe(false);
    expect(describesDefunct(undefined)).toBe(false);
  });
});

describe("fallbackDescription", () => {
  it("builds the generator's SEC sentence", () => {
    expect(
      fallbackDescription({ name: "World Kinect", industry: "Oil & Gas Midstream", city: "MIAMI", stateOrCountry: "FL", sic: "5172", sicDescription: "WHOLESALE-PETROLEUM & PETROLEUM PRODUCTS (NO BULK STATIONS)" }),
    ).toBe("World Kinect is a U.S.-listed oil & gas midstream company headquartered in Miami, FL (SEC SIC 5172: Wholesale-Petroleum & Petroleum Products (No Bulk Stations)).");
    expect(fallbackDescription({ name: "X", industry: "Banks", sic: null, sicDescription: null })).toBe("X is a U.S.-listed banks company (SEC SIC —: ).");
  });
});

describe("applyDetailCorrections", () => {
  const details: Record<string, CoverageDetails> = {
    HCC: { website: "http://www.tmhcc.com", founded: 1974, description: "Tokio Marine HCC is an international insurance group." },
    ZD: { website: "http://www.j2global.com", founded: 1995 },
  };
  const ciks = { HCC: "1691303", ZD: "1084048" };
  const fix = (c: Partial<DetailCorrection>): DetailCorrection => ({
    ticker: "HCC", cik: "1691303", field: "website", old: "http://www.tmhcc.com", new: "https://www.warriormetcoal.com", source: "8-K 0001193125-26-447189: \"please visit www.warriormetcoal.com\"", ...c,
  });
  it("replaces, removes and keeps field order", () => {
    const r = applyDetailCorrections(details, ciks, [fix({}), fix({ field: "founded", old: 1974, new: null })]);
    expect(r.applied).toHaveLength(2);
    expect(r.rejected).toHaveLength(0);
    expect(r.details.HCC).toEqual({ website: "https://www.warriormetcoal.com", description: "Tokio Marine HCC is an international insurance group." });
    expect(Object.keys(r.details.HCC)).toEqual(["website", "description"]);
    expect(details.HCC.website).toBe("http://www.tmhcc.com"); // input untouched
  });
  it("adds a field that was empty only when the old value says empty", () => {
    const r = applyDetailCorrections(details, ciks, [fix({ ticker: "ZD", cik: "1084048", field: "ir", old: null, new: "https://investor.ziffdavis.com" })]);
    expect(r.details.ZD).toEqual({ website: "http://www.j2global.com", ir: "https://investor.ziffdavis.com", founded: 1995 });
  });
  it("rejects a stale old value, a wrong CIK, a missing ticker, a missing source and an unknown field", () => {
    const r = applyDetailCorrections(details, ciks, [
      fix({ old: "http://www.other.com" }),
      fix({ cik: "1" }),
      fix({ ticker: "NOPE" }),
      fix({ source: " " }),
      fix({ field: "shortName" as never }),
    ]);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'old value no longer matches (now "http://www.tmhcc.com")',
      "CIK is 1691303, correction is for 1",
      "ticker not in the list",
      "no source",
      "unknown field shortName",
    ]);
    expect(r.details).toEqual(details);
  });
  it("skips a correction already present upstream", () => {
    const r = applyDetailCorrections({ HCC: { website: "https://www.warriormetcoal.com" } }, ciks, [fix({})]);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });
});
