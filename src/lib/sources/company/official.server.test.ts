import { beforeEach, describe, expect, it } from "vitest";
import { fakeStore, FIXTURE_SNAPSHOTS } from "@/test/fixtures/sources/company/fake-store";
import { FDIC_CURRENT, FDIC_HISTORY } from "./fdic-fields";
import { cellOf, readCompanyOfficial, resetOfficialCache, type OfficialClient, type OfficialQuery } from "./official.server";
import type { CompanyOfficial } from "./types";

const Y9C = "official_01_financials_data_fed_y9_family_all_native_2026q1_q3_ffceb6e988";
const Y9C_SNAP = "eaa74358d53d90f9235e1733559ca65225488e3d13444f8834a1be15afb07948";
const read = async (client: OfficialClient, ticker: string, cert?: string): Promise<CompanyOfficial> => {
  const r = await readCompanyOfficial(client, ticker, cert);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};

beforeEach(() => resetOfficialCache());

/** The client, recording the snapshot of every whole-dictionary read (`columns` selected by id). */
function recordFullReads(base: OfficialClient, into: string[]): OfficialClient {
  const wrap = (inner: OfficialQuery): OfficialQuery => ({
    eq: (column, value) => {
      if (column === "id") into.push(String(value));
      return wrap(inner.eq(column, value));
    },
    in: (column, values) => wrap(inner.in(column, values)),
    order: (column, options) => wrap(inner.order(column, options)),
    limit: count => wrap(inner.limit(count)),
    then: (ok, fail) => inner.then(ok, fail),
  });
  return {
    rpc: (fn, args) => base.rpc(fn, args),
    from: table => ({ select: columns => (table === "source_snapshots" && columns === "columns" ? wrap(base.from(table).select(columns)) : base.from(table).select(columns)) }),
  };
}

describe("cellOf", () => {
  it("keeps the publisher's string and reads a number only from a plain decimal", () => {
    expect(cellOf("4091315000")).toEqual({ text: "4091315000", value: 4091315000, kind: "number" });
    expect(cellOf("-0.04730322351758596")).toMatchObject({ value: -0.04730322351758596, kind: "number" });
    expect(cellOf("")).toEqual({ text: "", value: null, kind: "empty" });
    expect(cellOf(null)).toEqual({ text: null, value: null, kind: "null" });
    expect(cellOf("N/A")).toEqual({ text: "N/A", value: null, kind: "text" });
  });
});

describe("readCompanyOfficial: JPMorgan Chase, without migration 0069", () => {
  const client = () => fakeStore({ missing: new Set(["source_record"]) });
  it("lists both insured banks, figures only for the one in the FDIC cohort", async () => {
    const d = await read(client(), "JPM");
    expect(d.registrant).toMatchObject({ rssd: "1039502", legalName: "JPMORGAN CHASE & CO." });
    expect(d.banks.map(b => [b.cert, b.inCohort, b.lines.length])).toEqual([["628", true, 9], ["21761", false, 0]]);
    const bank = d.banks[0];
    expect(bank).toMatchObject({ name: "JPMORGAN CHASE BANK NA", state: "OH", reportDate: "2026-09-30", kind: "insured", basis: "top_holder" });
    expect(bank.assets).toEqual({ text: "4174631000", value: 4174631000, kind: "number" });
    const asset = bank.lines.find(l => l.field === "ASSET")!;
    expect(asset).toMatchObject({ unit: "USD thousands (monetary measures)", ref: { dataset: FDIC_CURRENT, snapshot: FIXTURE_SNAPSHOTS[FDIC_CURRENT], row: 10, field: "ASSET" } });
    expect(bank.lines.find(l => l.field === "RBCT1CER")).toMatchObject({ unit: "Percent", cell: { text: "14.19" } });
    expect(d.banks[1]).toMatchObject({ name: "JPMORGAN CHASE BANK DEARBORN", state: "MI", assets: null, note: "Outside the stored FDIC 500 cohort." });
  });
  it("gives the largest cohort bank's history since 2000, with the latest quarter from the current table", async () => {
    const d = await read(client(), "JPM");
    const h = d.history!;
    expect(h.cert).toBe("628");
    expect(h.measures.map(m => m.field)).toEqual(["ASSET", "DEP", "LNLSNET", "NETINC", "NIMY", "ROA", "NTLNLSR", "RBCT1CER", "NCLNLSR"]);
    expect(h.points).toHaveLength(107);
    expect(h.points[0]).toMatchObject({ period: "2000-03-31", source: 0, row: 181 });
    expect(h.points[105]).toMatchObject({ period: "2026-06-30", source: 0, row: 48517 });
    expect(h.points[106]).toMatchObject({ period: "2026-09-30", source: 1, row: 10 });
    expect(h.points[106].cells[0].text).toBe("4174631000");
    expect(h.sources.map(s => s.dataset)).toEqual([FDIC_HISTORY, FDIC_CURRENT]);
    expect(h.points[0].cells[7]).toEqual({ text: "", value: null, kind: "empty" }); // CET1 ratio before it was reported
  });
  it("reads the FR Y-9C rows by number, checks each is the registrant's, labels lines from the Fed's dictionary", async () => {
    const d = await read(client(), "JPM");
    const y = d.y9c!;
    expect(y.quarters.map(q => [q.reportDate, q.ref.row, q.totalAssets.text, q.totalAssets.unit])).toEqual([
      ["2026-03-31", 17, "4900475000", "USD thousands"], ["2026-06-30", 497, "5015069000", "USD thousands"], ["2026-09-30", 4077, "5091545000", "USD thousands"],
    ]);
    const cet1 = y.lines.find(l => l.field === "BHCAP793")!;
    expect(cet1).toMatchObject({ unit: "Percent", label: "COMMON EQUITY TIER 1 CAPITAL RATIO (ITEM 19 DIVIDED BY ITEM 40.A)", labelRef: { row: 289 } });
    expect(cet1.cells.map(c => c.text)).toEqual(["14.2769", "14.1913", "13.9676"]);
    expect(cet1.cells[2].ref).toEqual({ dataset: Y9C, snapshot: Y9C_SNAP, row: 4077, field: "BHCAP793" });
    expect(y.lines.find(l => l.field === "BHCAH036")).toMatchObject({ unit: null, cells: [{ text: "5.5643" }, { text: "5.5218" }, { text: "5.4656" }] });
    expect(y.lines.find(l => l.field === "BHCAP859")!.cells.map(c => c.kind)).toEqual(["empty", "empty", "empty"]);
    expect(y.lines.find(l => l.field === "BHCAA223")).toMatchObject({ unit: "USD thousands", cells: [{}, {}, { text: "2177516285" }] });
    expect(y.missing).toEqual([]);
    expect(y.source.newerSnapshot).toBeNull();
  });
  it("names the asset-backed deals whose header names its bank as sponsor", async () => {
    expect((await read(client(), "JPM")).abs).toEqual([{ sponsorCik: "835271", sponsorName: "JPMorgan Chase Bank, N.A.", cert: "628", deals: 3, assetClass: "commercial mortgage" }]);
  });
});

describe("readCompanyOfficial: the two read modes and the failures", () => {
  it("reads FR Y-9C rows through source_query_records only, never a function no migration defines (review int-code N3)", async () => {
    const log: string[] = [];
    const a = await read(fakeStore({ log }), "JPM");
    expect(log).not.toContain("rpc:source_record");
    expect(log).toContain("rpc:source_query_records");
    resetOfficialCache();
    const b = await read(fakeStore({ missing: new Set(["source_record"]) }), "JPM");
    expect(a.y9c!.lines).toEqual(b.y9c!.lines);
  });
  it("reports a row the mapping points at that is not stored, and keeps the other quarters", async () => {
    const d = await read(fakeStore({ hide: [{ snapshot: Y9C_SNAP, row: 4077 }] }), "JPM");
    expect(d.y9c!.quarters.map(q => q.reportDate)).toEqual(["2026-03-31", "2026-06-30"]);
    expect(d.y9c!.missing).toEqual([{ reportDate: "2026-09-30", reason: "The row is not in the stored file." }]);
  });
  it("shows the pinned FR Y-9C file and names a newer one when it exists", async () => {
    const newer = { id: "f".repeat(64), dataset_id: Y9C, status: "ready", retrieved_at: "2027-02-20 10:00:00+00", published_at: "2027-02-21 10:00:00+00", file_sha256: "0".repeat(64), loaded_rows: 6000, column_count: 2247, columns: {} };
    const d = await read(fakeStore({ snapshots: [newer], latest: { [Y9C]: newer.id } }), "JPM");
    expect(d.y9c!.source).toMatchObject({ snapshot: Y9C_SNAP, newerSnapshot: newer.id });
    expect(d.y9c!.lines.find(l => l.field === "BHCAP793")!.cells[2].text).toBe("13.9676");
  });
  it("finds a field by its label when the publisher moved it", async () => {
    // the fixture keeps only the descriptors round 4 read, so other snapshots may be read whole too; the moved one is read whole once
    const full: string[] = [];
    const cur = FIXTURE_SNAPSHOTS[FDIC_CURRENT];
    const d = await read(recordFullReads(fakeStore({ shift: [{ snapshot: cur, from: 35, to: 40 }] }), full), "JPM");
    expect(full.filter(id => id === cur)).toHaveLength(1);
    expect(d.banks[0].lines.find(l => l.field === "ASSET")).toMatchObject({ cell: { text: "4174631000" }, ref: { row: 10 } });
  });
  it("turns a database failure into a note on that part only, and never throws", async () => {
    const base = fakeStore();
    const failing: OfficialClient = { from: base.from, rpc: async () => ({ data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } }) };
    const d = await read(failing, "JPM");
    expect(d.y9c).toBeNull();
    expect(d.y9cNote).toBe("The database stopped the read after its time limit.");
    expect(d.banks[0].lines).toHaveLength(9);
    const broken: OfficialClient = { from: () => { throw new Error("socket closed"); }, rpc: base.rpc };
    const r = await readCompanyOfficial(broken, "JPM");
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.banks.every(b => b.lines.length === 0)).toBe(true);
  });
});

describe("readCompanyOfficial: the mapping decides which banks", () => {
  it("shows Mechanics Bancorp's own bank, certificate 1768, held through NIC relationship rows", async () => {
    const d = await read(fakeStore(), "MCHB");
    expect(d.banks.map(b => b.cert)).toEqual(["1768"]);
    expect(d.banks[0]).toMatchObject({ name: "MECHANICS BANK", state: "CA", basis: "nic_equity", note: "Held through one NIC relationship (100.00% equity)." });
    expect(d.banks[0].lines.find(l => l.field === "ASSET")!.cell.text).toBe("20957440");
    expect(d.history!.points.find(p => p.period === "2014-03-31")!.cells[7]).toMatchObject({ text: "0.0", value: 0 });
  });
  it("lists all 17 Wintrust institutions: 15 with figures, one outside the cohort, one trust company", async () => {
    const d = await read(fakeStore(), "WTFC");
    expect(d.banks).toHaveLength(17);
    expect(d.banks.filter(b => b.lines.length).length).toBe(15);
    expect(d.banks.find(b => b.cert === "34681")).toMatchObject({ inCohort: false, lines: [], state: "IL" });
    expect(d.banks.find(b => b.cert === "35063")).toMatchObject({ kind: "noninsured_trust", note: "Noninsured trust company." });
    expect(d.history!.cert).toBe("33935");
  });
  it("takes the history of another proven bank on request, never of a bank that is not the company's", async () => {
    expect((await read(fakeStore(), "WTFC", "628")).history!.cert).toBe("33935");
    // the fixture holds no history rows for Lake Forest Bank, only its current quarter
    const other = await read(fakeStore(), "WTFC", "27589");
    expect(other.history!.cert).toBe("27589");
    expect(other.history!.points.map(p => [p.period, p.source])).toEqual([["2026-09-30", 1]]);
  });
  it("says when control rests on another basis than equity", async () => {
    const d = await read(fakeStore(), "UNH");
    expect(d.banks[0]).toMatchObject({ cert: "57408", name: "OPTUM BANK INC", basis: "nic_other_basis", note: "Controlled on a basis other than equity; NIC records no equity share." });
    expect(d.y9c).toBeNull();
    expect(d.y9cNote).toBeNull();
  });
  it("reads nothing for a company the mapping does not cover, name-matched ones included", async () => {
    for (const t of ["AAPL", "MS"]) {
      const log: string[] = [];
      const d = await read(fakeStore({ log }), t);
      expect(d.banks).toEqual([]);
      expect(d.registrant).toBeNull();
      expect(log).toEqual([]);
    }
  });
});
