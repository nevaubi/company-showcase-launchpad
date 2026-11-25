import { beforeEach, describe, expect, it } from "vitest";
import { fakeStore } from "@/test/fixtures/sources/company/fake-store";
import { resetOfficialCache, type OfficialClient } from "./official.server";
import { lastListed, obAsks, printedDay, type CompanyPatents } from "./orange-book";
import { PATENTS_CACHE_LIMIT, patentsCacheSize, readCompanyPatents, resetPatentsCache } from "./orange-book.server";

// Real rows (fixture store): Bristol Myers Squibb's REVLIMID 021880, SPRYCEL 021986, ELIQUIS 202155, IDHIFA 209606,
// ZENBEXUS 221075, TUBOCURARINE CHLORIDE 005657 (no patents), Exelixis' COMETRIQ 203756. Sponsors as the FDA panel stores them.
const BMY = ["005657", "021880", "021986", "202155", "209606", "221075"].map(appl => ({ appl, sponsor: "BRISTOL MYERS SQUIBB" }));
const read = async (client: OfficialClient, ticker: string, asks = BMY): Promise<CompanyPatents> => {
  const r = await readCompanyPatents(client, ticker, asks);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};

beforeEach(() => {
  resetOfficialCache();
  resetPatentsCache();
});

describe("obAsks", () => {
  it("takes the new drug applications of the FDA panel with the sponsor each row names, once each", () => {
    const rows = [
      { dataset: "fda", meta: { application: "NDA203756", sponsor: "EXELIXIS", kind: "approval" } },
      { dataset: "fda", meta: { application: "NDA203756", sponsor: "EXELIXIS", kind: "approval" } },
      { dataset: "fda", meta: { application: "BLA125514", sponsor: "MERCK SHARP DOHME" } },
      { dataset: "fda", meta: { application: "ANDA090123", sponsor: "TEVA" } },
      { dataset: "fda", meta: { kind: "recall", firm: "EXELIXIS" } },
      { dataset: "bank", meta: { application: "NDA000001", sponsor: "X" } },
    ];
    expect(obAsks(rows)).toEqual([{ appl: "203756", sponsor: "EXELIXIS" }]);
  });
  it("reads printed dates for ordering only", () => {
    expect([printedDay("Apr 1, 2026"), printedDay("Nov 21, 2026"), printedDay("Approved Prior to Jan 1, 1982"), printedDay("")]).toEqual(["2026-04-01", "2026-11-21", null, null]);
  });
});

describe("readCompanyPatents", () => {
  it("lists each application with Orange Book rows, its products, patents and exclusivity, every line on its stored rows", async () => {
    const log: string[] = [];
    const d = await read(fakeStore({ log }), "BMY");
    expect(d.asked).toBe(6);
    expect(d.applications.map(a => `${a.trade.join("/")} ${a.appl}`)).toEqual(["ELIQUIS 202155", "IDHIFA 209606", "REVLIMID 021880", "SPRYCEL 021986", "ZENBEXUS 221075"]);
    expect(d.withheld).toEqual([]);
    expect(d.partial).toBe(false);
    const eliquis = d.applications[0];
    expect(eliquis.applicant).toBe("BRISTOL MYERS SQUIBB");
    expect(eliquis.products.map(p => `${p.productNo} ${p.strength}`)).toEqual(["001 2.5MG", "002 5MG", "003 0.5MG"]);
    // patent 6967208 is printed on 16 rows (products and use codes); one line keeps all of them
    const p = eliquis.patents.find(x => x.patent === "6967208")!;
    expect(p).toMatchObject({ expiry: "Nov 21, 2026", substance: true, drugProduct: true, delisted: false, products: ["001", "002", "003"] });
    expect(p.refs).toHaveLength(16);
    expect(p.useCodes).toContain("U-4179");
    expect(eliquis.exclusivity.map(e => `${e.code} ${e.date} ${e.products.join(",")}`)).toEqual(["PED Oct 17, 2028", "NPP Apr 17, 2028", "NS Apr 17, 2028"].map((x, i) => `${x} ${i === 2 ? "003" : i === 0 ? "001,002,003" : "001,002"}`));
    expect(lastListed(eliquis)).toMatchObject({ patent: { patent: "9326945*PED", expiry: "Aug 24, 2031" }, exclusivity: { code: "PED", date: "Oct 17, 2028" } });
    expect(eliquis.patents[0].refs[0]).toEqual({ dataset: "official_03_healthcare_csv_ob_patent_63776478d4", snapshot: "60c0c87962d5bffc357c222f1a25184892e15415c673f4d5d16636d9c3c1e992", row: 20988 });
    // products are read only for applications that have Orange Book rows (not 005657)
    expect(log.filter(l => l.startsWith("source_records")).length).toBe(3);
  });
  it("shows an application only while the Orange Book's applicant is the firm the FDA panel names", async () => {
    const d = await read(fakeStore(), "EXEL", [{ appl: "203756", sponsor: "EXELIXIS INC" }]);
    expect(d.applications).toEqual([]);
    expect(d.withheld).toEqual([{ appl: "203756", sponsor: "EXELIXIS INC", applicants: ["EXELIXIS"], why: "The Orange Book's applicant is not the firm the FDA panel names." }]);
    const ok = await read(fakeStore(), "EXEL", [{ appl: "203756", sponsor: "EXELIXIS" }]);
    expect(ok.applications[0]).toMatchObject({ appl: "203756", trade: ["COMETRIQ"], ingredient: ["CABOZANTINIB S-MALATE"] });
    expect(ok.applications[0].patents.map(x => x.patent)).toContain("12128039");
  });
  it("reads nothing but the file descriptions when the panel has no new drug application", async () => {
    const log: string[] = [];
    const d = await read(fakeStore({ log }), "XYZ", []);
    expect(d.applications).toEqual([]);
    expect(log.some(l => l.startsWith("source_records"))).toBe(false);
  });
  it("finds a field by its label when the publisher moved it", async () => {
    // the expiry column moved to position 9 (descriptor and values): the probe fails, the dictionary is read, the label decides
    const d = await read(fakeStore({ shift: [{ snapshot: "60c0c87962d5bffc357c222f1a25184892e15415c673f4d5d16636d9c3c1e992", from: 4, to: 9 }] }), "BMY");
    expect(d.applications).toHaveLength(5);
    expect(d.applications[0].patents.some(p => p.patent === "6967208" && p.expiry === "Nov 21, 2026")).toBe(true);
  });
  it("caches by application number, checks the sponsor after the cache, and keeps at most 300 applications (review int-code S6)", async () => {
    const log: string[] = [];
    const store = fakeStore({ log });
    expect((await read(store, "BMY")).applications).toHaveLength(5);
    const reads = log.filter(l => l.startsWith("source_records")).length;
    // the same applications with another sponsor string: no record is read again, and the check still withholds them
    const other = await read(store, "BMY", BMY.map(a => ({ ...a, sponsor: "SOMEONE ELSE" })));
    expect(other.applications).toEqual([]);
    expect(other.withheld.map(w => w.appl)).toEqual(["021880", "021986", "202155", "209606", "221075"]);
    expect(log.filter(l => l.startsWith("source_records")).length).toBe(reads);
    // a caller who sends ever new application numbers cannot grow the cache past its cap
    for (let batch = 0; batch < 3; batch++) {
      const asks = Array.from({ length: 200 }, (_, i) => ({ appl: String(300_000 + batch * 200 + i), sponsor: `S${i}` }));
      expect((await read(store, "BMY", asks)).applications).toEqual([]);
    }
    expect(patentsCacheSize()).toBe(PATENTS_CACHE_LIMIT);
  });
  it("answers with a reason and never throws when the database fails", async () => {
    const broken: OfficialClient = { from: () => { throw new Error("socket closed"); }, rpc: async () => ({ data: null, error: null }) };
    expect(await readCompanyPatents(broken, "BMY", BMY)).toEqual({ ok: false, reason: "The Orange Book records could not be read." });
    const base = fakeStore();
    const timeout: OfficialClient = {
      from: (t => (t === "source_records" ? { select: () => ({ eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; }, then: (f: (r: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } }).then(f) }) } : base.from(t))) as OfficialClient["from"],
      rpc: base.rpc,
    };
    expect(await readCompanyPatents(timeout, "BMY", BMY)).toEqual({ ok: false, reason: "The database stopped the read after its time limit." });
  });
});
