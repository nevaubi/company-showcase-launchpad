import { describe, expect, it } from "vitest";
import links from "./links.json";
import linksText from "./links.json?raw";
import {
  banksByHolder, coverEin, fdicVerdict, indexByTax, legalCore, matchRegistrant, mergeLinks, sameRegistrant, serializeLinks, walkRelationships,
  type FdicInstitution, type NicEntity, type NicRelationship,
} from "./build";
import type { CompanyLink } from "./types";

const ALL = links as unknown as CompanyLink[];
const row = (t: string, kind: string, key: string) => structuredClone(ALL.find(l => l.ticker === t && l.link_kind === kind && l.key_value === key)!);

describe("name rule", () => {
  it("accepts every registrant the research accepted, by its NIC legal name", () => {
    const regs = ALL.filter(l => l.link_kind === "registrant_rssd");
    expect(regs).toHaveLength(133);
    expect(regs.filter(l => !sameRegistrant(l.entity_name!, l.evidence.nic!.legal_name)).map(l => `${l.ticker}: ${l.entity_name} / ${l.evidence.nic!.legal_name}`)).toEqual([]);
  });
  it("refuses an EIN NIC carries on another entity", () => {
    expect(sameRegistrant("FirstSun Capital Bancorp", "BAY POND PARTNERS, L.P.")).toBe(false);
    expect(sameRegistrant("INDEPENDENT BANK CORP", "INDEPENDENT BANK GROUP, INC.")).toBe(false);
  });
  it("removes legal forms, state markers and spelled-apart initials", () => {
    expect(legalCore("THE PNC FINANCIAL SERVICES GROUP, INC.")).toBe("PNC FINANCIAL SERVICES GROUP");
    expect(legalCore("US BANCORP DE")).toBe("US BANCORP");
    expect(legalCore("BANK OF HAWAII CORP")).toBe("BANK OF HAWAII");
    expect(legalCore("US BANCORP \\DE\\")).toBe("US BANCORP");
    expect(legalCore("U.S. BANCORP")).toBe("US BANCORP");
    expect(legalCore("FNB CORP/PA/")).toBe(legalCore("F.N.B. CORPORATION"));
  });
});

describe("matchRegistrant", () => {
  const e = (rssd: string, taxId: string, legalName: string): NicEntity => ({ row: 1, rssd, taxId, legalName, entityType: "FHD", secStatus: "3" });
  const byTax = indexByTax([e("1039502", "132624428", "JPMORGAN CHASE & CO."), e("5923971", "814552413", "BAY POND PARTNERS, L.P."), e("1", "42", "A"), e("2", "42", "B")]);
  it("proves by EIN and name, compares the tax ID as an integer", () => {
    expect(matchRegistrant("132624428", "JPMORGAN CHASE & CO", byTax)).toMatchObject({ status: "proven", entity: { rssd: "1039502" } });
  });
  it("holds for review when the name is another entity's, and finds nothing for an unknown or zero EIN", () => {
    expect(matchRegistrant("814552413", "FIRSTSUN CAPITAL BANCORP", byTax).status).toBe("review");
    expect(matchRegistrant("000000000", "X", byTax).status).toBe("none");
    expect(matchRegistrant("123456789", "X", byTax).status).toBe("none");
  });
  it("drops a tax ID two entities carry", () => {
    expect(byTax.has("42")).toBe(false);
  });
});

describe("banks", () => {
  const inst = (CERT: number, RSSDHCR: string, FED_RSSD: string, ACTIVE = 1): FdicInstitution => ({ CERT, NAME: `BANK ${CERT}`, RSSDHCR, FED_RSSD, ACTIVE });
  it("takes active institutions under the registrant as top holder, or the registrant itself", () => {
    const got = banksByHolder("1039502", [inst(628, "1039502", "852218"), inst(21761, "1039502", "651448"), inst(1, "1039502", "9", 0), inst(2, "99", "1039502"), inst(3, "7", "8")]);
    expect(got.map(g => [g.inst.CERT, g.basis])).toEqual([[628, "top_holder"], [21761, "top_holder"], [2, "self"]]);
  });
  it("walks current controlling relationship rows from the registrant to a bank (Hilltop: two steps)", () => {
    const rel = (rowN: number, parent: string, offspring: string, extra: Partial<NicRelationship> = {}): NicRelationship => ({ row: rowN, parent, offspring, ctrlInd: "1", equityInd: "1", otherBasisInd: "0", pctEquity: "100.00", end: "12/31/9999", ...extra });
    const rels = [rel(222366, "3838727", "4414137"), rel(247687, "4414137", "637451"), rel(1, "3838727", "555", { end: "07/10/2026" }), rel(2, "3838727", "777", { ctrlInd: "0" }), rel(260494, "4665014", "3202702", { equityInd: "0", otherBasisInd: "1", pctEquity: null })];
    const banks = new Set(["637451", "555", "777", "3202702"]);
    expect(walkRelationships("3838727", rels, banks)).toEqual([{ bank: "637451", path: ["3838727", "4414137", "637451"], steps: [
      { offspring: "4414137", row: 222366, equity_pct: "100.00", other_basis: false, ctrl_ind: "1" },
      { offspring: "637451", row: 247687, equity_pct: "100.00", other_basis: false, ctrl_ind: "1" },
    ] }]);
    expect(walkRelationships("4665014", rels, banks)[0].steps[0]).toMatchObject({ equity_pct: null, other_basis: true });
  });
});

describe("fdicVerdict", () => {
  it("agrees when holder and bank RSSD are as mapped and the bank is active", () => {
    expect(fdicVerdict(row("JPM", "insured_bank", "628"), { CERT: 628, NAME: "", RSSDHCR: 1039502, FED_RSSD: "852218", ACTIVE: 1 })).toEqual({ ok: true, text: "agrees" });
  });
  it("reports a closed bank, a new holder and a missing record", () => {
    const blue = row("FULT", "insured_bank", "30052");
    expect(fdicVerdict(blue, { CERT: 30052, NAME: "", RSSDHCR: "1117129", FED_RSSD: "797775", ACTIVE: 0 }).ok).toBe(false);
    expect(fdicVerdict(row("JPM", "insured_bank", "628"), { CERT: 628, NAME: "", RSSDHCR: "5", FED_RSSD: "852218", ACTIVE: 1 }).text).toMatch(/^differs: .*top holder RSSD 5/);
    expect(fdicVerdict(row("JPM", "insured_bank", "628"), undefined).text).toBe("not returned by the FDIC");
  });
  it("checks only the bank's own RSSD where the link runs through NIC relationship rows", () => {
    expect(fdicVerdict(row("MCHB", "insured_bank", "1768"), { CERT: 1768, NAME: "", RSSDHCR: "4759650", FED_RSSD: "936462", ACTIVE: 1 }).ok).toBe(true);
  });
});

describe("mergeLinks", () => {
  const jpm = ALL.filter(l => l.ticker === "JPM");
  it("keeps a row proved again with its first date, closes one not proved again, opens a new one, deletes nothing", () => {
    const fresh = jpm.filter(l => l.key_value !== "21761").map(l => ({ ...structuredClone(l), valid_from: "2027-01-15" }));
    const added = { ...structuredClone(jpm.find(l => l.key_value === "628")!), key_value: "99999", valid_from: null };
    const { links: out, opened, closed, kept } = mergeLinks(jpm, [...fresh, added], "2027-01-15");
    expect(out).toHaveLength(jpm.length + 1);
    expect(kept).toBe(jpm.length - 1);
    expect(closed.map(l => [l.key_value, l.valid_to])).toEqual([["21761", "2027-01-15"]]);
    expect(opened.map(l => [l.key_value, l.valid_from])).toEqual([["99999", "2027-01-15"]]);
    expect(out.find(l => l.key_value === "628")!.valid_from).toBe("2026-06-30");
  });
  it("carries review, retired and closed rows over untouched", () => {
    const old = ALL.filter(l => l.ticker === "MCHB" || l.ticker === "MS" || l.key_value === "30052");
    const { links: out } = mergeLinks(old, [], "2027-01-15");
    for (const o of old.filter(l => l.status !== "proven" || l.valid_to)) expect(out).toContainEqual(o);
  });
});

describe("serializeLinks", () => {
  it("writes the file exactly as it is stored, so a rebuild with no change has no diff", () => {
    expect(serializeLinks(ALL)).toBe(linksText);
  });
});

describe("coverEin", () => {
  it("reads the EIN cell of a cover page", () => {
    const html = '<tr><td class="pl"><a class="a" href="#">Entity Tax Identification Number</a></td><td class="text">13-2624428<span></span></td></tr>';
    expect(coverEin(html)).toBe("132624428");
    expect(coverEin("<td>Entity Registrant Name</td>")).toBeNull();
  });
});
