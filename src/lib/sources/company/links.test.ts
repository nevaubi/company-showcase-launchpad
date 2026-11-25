import { describe, expect, it } from "vitest";
import links from "./links.json";
import guardFile from "./guard.json";
import { absSponsors, allLinks, linksFor, provenBanks, registrantRssd, reviewRows, y9cRows } from "./links.server";
import { deriveGuard, summarizeLinks, validateLinks } from "./validate";
import type { CompanyLink } from "./types";

const ALL = links as unknown as CompanyLink[];
const certs = (t: string) => provenBanks(t).map(l => l.key_value).sort((a, b) => Number(a) - Number(b));

describe("links.json", () => {
  it("passes every rule of the validator", () => {
    expect(validateLinks(ALL)).toEqual([]);
  });

  it("holds the research counts", () => {
    const s = summarizeLinks(ALL);
    expect(s.provenTickers).toBe(133);
    expect(s.registrants).toBe(133);
    expect(s.y9cRegistrants).toBe(126);
    expect(s.y9cPointers).toBe(375); // ESQ's 30 Jun 2026 row has no consolidated total assets: not an FR Y-9C
    expect(s.insuredBanks).toBe(173); // 174 mapped, Blue Foundry Bank closed on 10 Jul 2026
    expect(s.trustCompanies).toBe(16);
    expect(s.cohortBanks).toBe(154);
    expect(s.absSponsors).toBe(5);
  });

  it("keeps the six name-matched companies for review only", () => {
    expect(summarizeLinks(ALL).reviewTickers).toEqual(["AMAL", "BANC", "FSUN", "MS", "NNI", "WEX"]);
    for (const t of ["AMAL", "BANC", "FSUN", "MS", "NNI", "WEX"]) {
      expect(linksFor(t)).toEqual([]);
      expect(reviewRows(t).length).toBeGreaterThan(0);
      for (const r of reviewRows(t)) expect(r.basis).toBe(["MS", "BANC", "FSUN"].includes(t) ? "name_and_subsidiary_list" : "name_match");
    }
    expect(reviewRows("MS").map(r => r.key_value).sort()).toEqual(["32992", "34221"]);
  });

  it("maps Mechanics Bancorp to certificate 1768, not 29011", () => {
    expect(certs("MCHB")).toEqual(["1768"]);
    expect(registrantRssd("MCHB")).toBe("3843507");
    const wrong = ALL.find(l => l.ticker === "MCHB" && l.key_value === "29011");
    expect(wrong?.status).toBe("retired");
    expect(linksFor("MCHB").some(l => l.key_value === "29011")).toBe(false);
    const bank = provenBanks("MCHB")[0];
    expect(bank.basis).toBe("nic_equity");
    expect(bank.evidence.relationship?.path).toEqual(["3843507", "936462"]);
  });

  // Section 3.3 of the research: CIK, cover EIN, RSSD and certificates of the twelve test companies.
  const TABLE: [string, string, string, string, string[]][] = [
    ["JPM", "19617", "132624428", "1039502", ["628", "21761"]],
    ["BAC", "70858", "560906609", "1073757", ["3510", "25178"]],
    ["WFC", "72971", "410449260", "1120754", ["3511", "5146", "13718", "27389", "34465"]],
    ["C", "831001", "521568099", "1951350", ["7213", "25677"]],
    ["USB", "36104", "410255900", "1119794", ["6548", "34588", "34813", "57047"]],
    ["PNC", "713676", "251435979", "1069778", ["6384"]],
    ["TFC", "92230", "560939887", "1074156", ["9846"]],
    ["COF", "927628", "541719854", "2277860", ["4297"]],
    ["SCHW", "316709", "943025021", "1026632", ["33497", "57450", "59108"]],
    ["KEY", "91576", "346542451", "1068025", ["17534", "59069"]],
    ["HBAN", "49196", "310724920", "1068191", ["6560"]],
    ["RF", "1281761", "630589368", "3242838", ["12368"]],
  ];
  it.each(TABLE)("maps %s as the research table prints it", (ticker, cik, ein, rssd, banks) => {
    const reg = linksFor(ticker).find(l => l.link_kind === "registrant_rssd")!;
    expect(reg.cik).toBe(cik);
    expect(reg.evidence.sec.ein).toBe(ein);
    expect(reg.key_value).toBe(rssd);
    expect(certs(ticker)).toEqual([...banks].sort((a, b) => Number(a) - Number(b)));
    expect(y9cRows(ticker).length).toBe(3);
  });

  it("orders insured banks by assets and trust companies last", () => {
    for (const t of ["WFC", "WTFC", "USB"]) {
      const list = provenBanks(t);
      const kinds = list.map(l => l.link_kind);
      expect(kinds.lastIndexOf("insured_bank")).toBeLessThan(kinds.indexOf("noninsured_trust_company") === -1 ? Infinity : kinds.indexOf("noninsured_trust_company"));
      const insured = list.filter(l => l.link_kind === "insured_bank").map(l => Number(l.evidence.fdic!.total_assets_k));
      expect(insured).toEqual([...insured].sort((a, b) => b - a));
    }
    expect(provenBanks("WFC")[0].key_value).toBe("3511");
    expect(provenBanks("WTFC")).toHaveLength(17);
  });

  it("drops a closed relationship: Blue Foundry Bank is no longer Fulton's", () => {
    expect(certs("FULT")).not.toContain("30052");
    expect(ALL.find(l => l.key_value === "30052")?.valid_to).toBe("2026-07-10");
  });

  it("points at the registrant's FR Y-9C rows by number, oldest first", () => {
    expect(y9cRows("JPM").map(p => [p.report_date, p.row])).toEqual([["2026-03-31", 17], ["2026-06-30", 497], ["2026-09-30", 4077]]);
    expect(y9cRows("UNH")).toEqual([]);
    expect(y9cRows("NOSUCH")).toEqual([]);
  });

  it("records control on another basis for the four companies NIC links that way", () => {
    for (const t of ["UNH", "HOG", "PBI", "VLO"]) expect(provenBanks(t).map(l => l.basis)).toEqual(["nic_other_basis"]);
  });

  it("names the five sponsor banks of asset-backed deals", () => {
    expect(["BAC", "COF", "FITB", "JPM", "WFC"].map(t => absSponsors(t).map(l => l.evidence.sponsor?.cert))).toEqual([["3510"], ["4297"], ["6672"], ["628"], ["3511"]]);
  });

  it("cites each registrant's latest 10-K or 10-Q cover, names it as SEC prints it, and keeps the filing it was first proved on", () => {
    const regs = ALL.filter(l => l.link_kind === "registrant_rssd");
    expect(regs.every(l => /^10-[KQ]$/.test(l.evidence.sec.form ?? ""))).toBe(true);
    expect(regs.find(l => l.ticker === "USB")!.entity_name).toBe("US BANCORP \\DE\\");
    expect(regs.find(l => l.ticker === "TFSL")!.evidence.sec).toMatchObject({ form: "10-K", accession: "0001381668-26-000050", prior_accession: "0001381668-26-000039" });
    expect(regs.find(l => l.ticker === "MCHB")!.evidence.sec).toMatchObject({ accession: "0001518715-26-000073", prior_accession: "0001518715-26-000060" });
  });

  it("states the FDIC's own top holder, and cites the stored row for trust companies the FDIC API does not list", () => {
    expect(provenBanks("MCHB")[0].evidence.fdic!.holder_rssd).toBe("4759650"); // above the registrant (3843507)
    expect(provenBanks("UNH")[0].evidence.fdic!.holder_rssd).toBeNull();
    const trusts = ALL.filter(l => l.link_kind === "noninsured_trust_company");
    expect(trusts).toHaveLength(16);
    for (const t of trusts) {
      expect(t.evidence.fdic!.api_url).toBeUndefined();
      expect(t.evidence.fdic!.row).toBeGreaterThan(0);
    }
  });

  it("is what the loader serves", () => {
    expect(allLinks()).toHaveLength(ALL.length);
  });

  it("derives guard.json exactly", () => {
    expect(guardFile).toEqual(deriveGuard(ALL));
  });
});

describe("validateLinks", () => {
  const base = () => structuredClone(ALL.filter(l => l.ticker === "JPM" || l.ticker === "MCHB"));
  it("refuses a second owner of a certificate", () => {
    const rows = base();
    const extra = structuredClone(rows.find(l => l.ticker === "MCHB" && l.key_value === "1768")!);
    extra.ticker = "JPM";
    extra.cik = "19617";
    extra.evidence.sec.cik = "19617";
    rows.push(extra);
    expect(validateLinks(rows).join("\n")).toMatch(/certificate 1768 has two owners/);
  });
  it("refuses a proven row without its SEC evidence", () => {
    const rows = base();
    const bank = rows.find(l => l.key_value === "628")!;
    delete bank.evidence.sec.accession;
    bank.evidence.sec.ein_source = undefined;
    const p = validateLinks(rows).join("\n");
    expect(p).toMatch(/628\): proven row without the filing's accession/);
    expect(p).toMatch(/628\): the EIN does not come from the cover page/);
  });
  it("refuses a key that does not match its pattern and a duplicate row", () => {
    const rows = base();
    rows.find(l => l.key_value === "21761")!.key_value = "21761a";
    rows.push(structuredClone(rows.find(l => l.key_value === "628")!));
    const p = validateLinks(rows).join("\n");
    expect(p).toMatch(/does not match the CERT pattern/);
    expect(p).toMatch(/duplicate row/);
  });
  it("refuses a proven row that rests on a name, and a top holder that is not the registrant", () => {
    const rows = base();
    rows.find(l => l.key_value === "628")!.basis = "name_match";
    rows.find(l => l.key_value === "21761")!.evidence.fdic!.holder_rssd = "2395326";
    const p = validateLinks(rows).join("\n");
    expect(p).toMatch(/cannot rest on name_match/);
    expect(p).toMatch(/top holder is not the registrant/);
  });
  it("refuses contact details anywhere in the file", () => {
    const rows = base();
    rows[0].evidence.supports = "write to someone@example.com or call 312-555-0100";
    const p = validateLinks(rows).join("\n");
    expect(p).toMatch(/e-mail/);
    expect(p).toMatch(/telephone/);
  });
});
