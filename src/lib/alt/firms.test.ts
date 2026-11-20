import { describe, expect, it } from "vitest";
import { coverageOf } from "@/lib/coverage";
import { tickerKeys } from "./contracts";
import { cpscRole, cpscTitleFirms, firmCheck, firmRowBelongs, statedOwners } from "./firms";
import { FDA_FIRMS, SHORT_NAMES, TRIAL_SPONSORS } from "./firms.fixture";

const short = (t: string) => SHORT_NAMES[t] ?? coverageOf(t)?.shortName ?? null;
const check = (t: string) => firmCheck(t, tickerKeys(t, short(t), null));
const judge = (rows: { ticker: string; firm: string; n: number }[]) => {
  const out = new Map<string, { keep: number; drop: number; dropped: string[] }>();
  for (const r of rows) {
    const o = out.get(r.ticker) ?? { keep: 0, drop: 0, dropped: [] };
    if (check(r.ticker)(r.firm)) o.keep += r.n;
    else {
      o.drop += r.n;
      o.dropped.push(r.firm);
    }
    out.set(r.ticker, o);
  }
  return out;
};
const total = (m: ReturnType<typeof judge>) => [...m.values()].reduce((a, o) => ({ keep: a.keep + o.keep, drop: a.drop + o.drop }), { keep: 0, drop: 0 });

// NHTSA manufacturers returned by `upper(manufacturer) like '%<maker>%'`, recorded from
// data.transportation.gov on 2026-11-20 (name, campaigns).
const NHTSA: Record<string, [string, number][]> = {
  F: [["Ford Motor Company", 1762], ["C & C Ford", 1], ["Rockford Corporation", 1]],
  GGG: [["Graco Children's Products, Inc.", 17]],
  ITT: [["Pitts Enterprises, Inc.", 2], ["CUSTOM VEHICLE OUTFITTERS", 1], ["Doolittle Trailer Mfg. Co., Inc.", 1], ["LITTELFUSE INC.", 1], ["Merritt Manufacturing, Inc.", 1], ["Nitto Tire U.S.A. Inc.", 1], ["THE LITTLE TRAILER COMPANY", 1]],
  DAN: [["DANA CORPORATION", 34], ["Dana Incorporated", 9], ["PT. Elangperdana Tyre Industry", 3]],
  LEA: [["LEAR SIEGLER, INC.", 1], ["Tomy International (Learning Curve Brand", 1]],
  DE: [["John Deere", 10], ["DEERE & COMPANY", 1]],
  TEX: [["Terex South Dakota, Inc.", 66], ["Terex Advance Mixer, Inc.", 20], ["Terex Aerial Work Platforms", 3], ["Terex Services", 1]],
  PH: [["PARKER HANNIFIN CORP.", 3], ["PARKER HANNIFIN CANADA", 1]],
  CMI: [["Cummins, Inc.", 87], ["Eaton Cummins Automated Transmission Tec", 1]],
  THO: [["THOR INDUSTRIES", 9]],
};

describe("openFDA recalling firms (all 476 stored firm names)", () => {
  const m = judge(FDA_FIRMS);

  it("drops independent Coca-Cola bottlers and keeps The Coca-Cola Company", () => {
    const ko = m.get("KO")!;
    expect(ko.dropped).toEqual(expect.arrayContaining(["Heartland Coca-Cola Bottling Company", "COCA COLA Consolidated LLC", "Reyes Coca-Cola Bottling, L.L.C.", "Swire Coca Cola USA", "COCA COLA SOUTHWEST BEVERAGES LLC"]));
    expect(check("KO")("Coca-Cola Company  (The)")).toBe(true);
    expect(check("KO")("THE COCA-COLA COMPANY")).toBe(true);
    expect(ko).toMatchObject({ keep: 40, drop: 39 });
    // the bottler that is a covered company keeps its own recalls
    expect(check("COKE")("COCA COLA Consolidated LLC")).toBe(true);
  });

  it("files Boston Scientific Target under Boston Scientific, not Target", () => {
    expect(m.get("TGT")).toMatchObject({ keep: 202, drop: 7, dropped: ["Boston Scientific Target"] });
    expect(check("BSX")("Boston Scientific Target")).toBe(true);
  });

  it("refuses firms that only share an ordinary word or a namesake", () => {
    expect(m.get("WAT")).toMatchObject({ keep: 0, drop: 14 });
    expect(check("WAT")("Waters Medical Systems LLC")).toBe(false);
    expect(check("MRK")("Merck Millipore Ltd.")).toBe(false);
    expect(check("OGN")("Organon Teknika Inc")).toBe(false);
    expect(check("UVV")("Universal Meditech Inc.")).toBe(false);
    expect(check("ICUI")("Otsuka ICU Medical LLC")).toBe(false);
  });

  it("keeps the companies' own units, sites and countries", () => {
    for (const [t, f] of [
      ["SYK", "Stryker Endoscopy"], ["SYK", "Stryker Howmedica Osteonics Corp."], ["MDT", "Medtronic Navigation, Inc.-Littleton"], ["MDT", "Medtronic MiniMed, Inc."],
      ["GEHC", "GE Healthcare Finland Oy"], ["CAH", "Cardinal Health 200, LLC"], ["MDLN", "MEDLINE INDUSTRIES, LP - Northfield"], ["SYY", "Sysco Charlotte"],
      ["ABT", "Abbott Nutrition, Abbott Laboratories"], ["MCK", "Mckesson Medical-Surgical Inc. Corporate Office"],
    ] as const) expect(check(t)(f), `${t} ${f}`).toBe(true);
  });

  it("follows an owner the firm names in its own name", () => {
    expect(statedOwners("Hospira Inc., A Pfizer Company")).toEqual(["Pfizer"]);
    expect(check("PFE")("King Legacy, a wholly owned subsidiary of Pfizer")).toBe(true);
    expect(check("GEHC")("Datex Ohmeda, Inc.  dba GE Healthcare")).toBe(true);
    expect(check("MCK")("Rx Pak Division of McKesson Corporation")).toBe(true);
    expect(check("JNJ")("DePuy Mitek, Inc., a Johnson & Johnson Co.")).toBe(true);
    expect(check("CAH")("Cardinal Health 303 Inc DBA Alaris Products")).toBe(true);
    expect(check("KO")("Chattanooga Coca Cola Bottling Company dba United Packers, Inc.")).toBe(false);
  });

  it("keeps nearly every real recall of the large filers", () => {
    expect(total(m)).toEqual({ keep: 6442, drop: 102 });
    for (const t of ["MDT", "SYK", "GEHC", "BSX", "MDLN", "CAH", "BDX", "ABT", "MCK", "PFE"]) {
      const o = m.get(t)!;
      expect(o.keep / (o.keep + o.drop), t).toBeGreaterThan(0.97);
    }
  });
});

describe("ClinicalTrials.gov lead sponsors (all 248 stored sponsor names)", () => {
  const m = judge(TRIAL_SPONSORS);

  it("drops Merck KGaA and Singapore's National Healthcare Group", () => {
    expect(m.get("MRK")).toMatchObject({ keep: 801, drop: 85 });
    expect(m.get("NHC")).toMatchObject({ keep: 0, drop: 24 });
    expect(check("HUM")("Humana Co.Ltd.")).toBe(false);
  });

  it("keeps subsidiaries named as such and the companies' own units", () => {
    expect(check("MRK")("Cidara Therapeutics Inc., a subsidiary of Merck & Co., Inc. (Rahway, New Jersey USA)")).toBe(true);
    expect(check("JNJ")("Johnson & Johnson Pharmaceutical Research & Development, L.L.C.")).toBe(true);
    expect(check("ABBV")("AbbVie (prior sponsor, Abbott)")).toBe(true);
    expect(total(m)).toEqual({ keep: 13582, drop: 119 });
  });
});

describe("NHTSA manufacturers", () => {
  it("drops look-alikes the substring search returns", () => {
    for (const [t, ms] of Object.entries(NHTSA)) {
      const kept = ms.filter(([n]) => check(t)(n)).map(([n]) => n);
      const want: Record<string, string[]> = {
        F: ["Ford Motor Company"], GGG: [], ITT: [], DAN: ["DANA CORPORATION", "Dana Incorporated"], LEA: [], DE: ["John Deere", "DEERE & COMPANY"],
        TEX: ["Terex South Dakota, Inc.", "Terex Advance Mixer, Inc.", "Terex Aerial Work Platforms", "Terex Services"], PH: ["PARKER HANNIFIN CORP.", "PARKER HANNIFIN CANADA"],
        CMI: ["Cummins, Inc."], THO: ["THOR INDUSTRIES"],
      };
      expect(kept, t).toEqual(want[t]);
    }
  });
});

describe("stored rows", () => {
  const k = (t: string) => tickerKeys(t, short(t), null);
  it("judges fda, trials and recorded NHTSA makers; leaves rows it cannot judge alone", () => {
    expect(firmRowBelongs({ dataset: "fda", kind: "event", meta: { kind: "food recall", firm: "Heartland Coca-Cola Bottling Company" } }, "KO", k("KO"))).toBe(false);
    expect(firmRowBelongs({ dataset: "fda", kind: "event", meta: { kind: "approval", sponsor: "PFIZER" } }, "PFE", k("PFE"))).toBe(true);
    expect(firmRowBelongs({ dataset: "fda", kind: "event", meta: { kind: "drug recall" } }, "PFE", k("PFE"))).toBe(false);
    expect(firmRowBelongs({ dataset: "trials", kind: "event", meta: { sponsor: "Merck KGaA, Darmstadt, Germany" } }, "MRK", k("MRK"))).toBe(false);
    expect(firmRowBelongs({ dataset: "recalls", kind: "event", meta: { manufacturer: "LITTELFUSE INC.", component: "x" } }, "ITT", k("ITT"))).toBe(false);
    // written before the manufacturer was recorded: the repair script looks it up
    expect(firmRowBelongs({ dataset: "recalls", kind: "event", meta: { component: "x" } }, "ITT", k("ITT"))).toBe(true);
    expect(firmRowBelongs({ dataset: "events", kind: "event", meta: {} }, "ITT", k("ITT"))).toBe(true);
  });
});

describe("CPSC recalls (records recorded from saferproducts.gov, 2026-11-20)", () => {
  const apple = check("AAPL");
  const cat = check("CAT");
  const lowes = check("LOW");
  it("refuses toys and fireworks that only carry the company's name", () => {
    expect(cpscRole({ Title: "Sandberg Manufacturing Company Recalls Caterpillar Pull Toys", Manufacturers: [{ Name: "Sandberg" }] }, cat, "Caterpillar")).toBeNull();
    expect(cpscRole({ Title: "CPSC, BRIO® Corporation Announce Recall of Caterpillar Pull Toy", Distributors: [{ Name: "BRIO® Corp., of Germantown, Wis., a subsidiary of BRIO AB, of Sweden" }], Retailers: [{ Name: "Specialty toy stores, Internet retailers and mail order catalogs sold the caterpillar toys nationwide" }] }, cat, "Caterpillar")).toBeNull();
    expect(cpscRole({ Title: '13131 Imports Recalls Red Apple Fireworks Brand "American Glory" and "Merica AF" Fireworks Due to Explosion and Burn Hazards', Manufacturers: [{ Name: "Liuyang Xiaohe Fireworks Manufacturing Co, of China" }], Importers: [{ Name: "13131 Imports LLC, of Las Vegas, Nevada" }], Retailers: [{ Name: "Red Apple Fireworks in Valdosta, Georgia; Flint, Michigan, and Pahrump, Nevada" }] }, apple, "Apple")).toBeNull();
  });
  it("keeps the company as maker or as the store that sold it", () => {
    expect(cpscTitleFirms("CPSC, Apple Announce Recall of PowerBook Computer Batteries")).toEqual(["Apple"]);
    expect(cpscRole({ Title: "CPSC, Apple Announce Recall of PowerBook Computer Batteries", Manufacturers: [{ Name: "Apple Computer Inc., of Cupertino, Calif." }] }, apple, "Apple")).toBe("maker");
    expect(cpscRole({ Title: "Enerco Recalls DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters Due to Fire and Burn Hazards; Sold Exclusively at Lowe's", Importers: [{ Name: "Enerco Group Inc., of Cleveland, Ohio" }], Retailers: [{ Name: "Lowe's stores nationwide and online at Lowes.com from May 2024 through January 2025 for about $200." }] }, lowes, "Lowe's")).toBe("retailer");
    expect(cpscRole({ Title: "Origin 21 Wall Mirrors Sold Exclusively at Lowe's Stores Recalled Due to Laceration and Impact Hazards", Importers: [{ Name: "Lowe's Companies Inc., of Mooresville, North Carolina" }] }, lowes, "Lowe's")).toBe("maker");
  });
});
