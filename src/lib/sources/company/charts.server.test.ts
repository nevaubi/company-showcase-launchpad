import { beforeEach, describe, expect, it } from "vitest";
import { depositsView, ratioStats, trendCharts, y9cCharts } from "./charts";
import { FDIC_HISTORY } from "./fdic-fields";
import data from "./fixtures/r6-store.json";
import { fixtureClient, type FixtureStore } from "./fixtures/store-client";
import { readCompanyOfficial, resetOfficialCache } from "./official.server";
import { SOD_BY_STATE } from "./sod-fields";
import type { CompanyOfficial } from "./types";

// Real rows of Wells Fargo (three cohort charters and two trust companies) and Fifth Third (one charter), copied
// with the checksum transfer on 26 Nov 2026 (fixtures/README.md).
const store = data as unknown as FixtureStore;
const read = async (ticker: string, cert?: string, client = fixtureClient(store)): Promise<CompanyOfficial> => {
  const r = await readCompanyOfficial(client, ticker, cert);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};
const HIST_SNAP = store.datasets.find(d => d.id === FDIC_HISTORY)!.latest_snapshot_id;

beforeEach(() => resetOfficialCache());

describe("trends of every proven cohort charter", () => {
  it("reads Wells Fargo's three charters in one select by certificate, each with the latest quarter appended", async () => {
    const log: string[] = [];
    const d = await read("WFC", undefined, fixtureClient(store, log));
    expect(d.trends.map(t => [t.cert, t.points.length, t.points[0].period, t.points[t.points.length - 1].period])).toEqual([
      ["3511", 107, "2000-03-31", "2026-09-30"],
      ["27389", 107, "2000-03-31", "2026-09-30"],
      ["5146", 107, "2000-03-31", "2026-09-30"],
    ]);
    expect(d.trends[0].measures).toEqual([
      { field: "ASSET", label: "Total assets", unit: "USD thousands (monetary measures)" },
      { field: "DEP", label: "Total deposits", unit: "USD thousands (monetary measures)" },
      { field: "NETINCQ", label: "Net income", unit: "USD thousands (monetary measures)" },
    ]);
    // one history select for the trends (three charters) and one for the selected bank, both by entity
    const historyReads = log.filter(l => l.startsWith("source_records:row_number") && l.includes("period") && !l.includes("c_REPDTE"));
    expect(historyReads.length).toBeLessThanOrEqual(3);
    const [assets, , income] = trendCharts(d.trends[0]);
    expect(assets.latest).toMatchObject({ period: "2026-09-30", cell: { text: "1914653000" }, ref: { row: 42 } });
    expect(assets.reader?.figure).toBe("$1.915 trillion");
    // the quarterly figure is the FDIC's own NETINCQ, stored with a trailing ".0" in the history table
    expect(income.points.find(p => p.period === "2008-12-31")).toMatchObject({ value: -794112, cell: { text: "-794112.0" }, ref: { snapshot: HIST_SNAP, row: 9704, field: "NETINCQ" } });
  });
  it("gives a one-charter company one trend and no small multiple", async () => {
    const d = await read("FITB");
    expect(d.trends.map(t => t.cert)).toEqual(["6672"]);
    expect(d.trendsNote).toBeNull();
  });
});

describe("ratio tiles of the selected charter", () => {
  it("states each FDIC ratio of the latest quarter with the change on the same quarter a year earlier", async () => {
    const d = await read("WFC");
    const stats = ratioStats(d.history!);
    expect(stats.map(s => s.field)).toEqual(["ROA", "NIMY", "EEFFR", "RBCT1CER", "NCLNLSR", "NTLNLSR"]);
    const cet1 = stats.find(s => s.field === "RBCT1CER")!;
    // 11.66 at 30 Sep 2026 (current-quarter table) less 13.13 at 30 Sep 2025 (history table, row 48706)
    expect([cet1.latest?.period, cet1.latest?.cell.text, cet1.yearEarlier?.ref.row, cet1.change?.text]).toEqual(["2026-09-30", "11.66", 48706, "−1.47"]);
    expect(cet1.spark).toHaveLength(24);
  });
});

describe("deposits by state", () => {
  it("reads the selected charter's branch states and its stored totals by certificate", async () => {
    const d = await read("WFC");
    expect(d.deposits?.cert).toBe("3511");
    expect(d.deposits?.unit).toBe("USD thousands");
    expect(d.deposits?.states).toHaveLength(40);
    expect(d.deposits?.totals).toMatchObject({ row: 3, surveyYear: "2026", deposits: { text: "1554614000" }, branches: { text: "4157" }, states: { text: "40" } });
    const v = depositsView(d.deposits!);
    expect(v.states.slice(0, 3).map(s => [s.code, s.deposits.text, s.branches.text])).toEqual([["SD", "464761269", "30"], ["CA", "304401995", "769"], ["TX", "94361589", "457"]]);
    // a stored zero is a figure, drawn as zero; it is not a missing state
    expect(v.states.find(s => s.code === "MA")).toMatchObject({ value: 0, deposits: { text: "0" } });
  });
  it("follows the selected certificate, and a one-branch charter has one state", async () => {
    const d = await read("WFC", "5146");
    expect(d.history?.cert).toBe("5146");
    expect(d.deposits?.states.map(s => [s.code, s.deposits.text, s.row])).toEqual([["TX", "1673209", 382]]);
  });
  it("turns the deposits off when the dictionary states another unit, with a note", async () => {
    const changed: FixtureStore = structuredClone(store);
    const snap = changed.snapshots.find(s => s.dataset_id === SOD_BY_STATE)!;
    snap.columns["4"] = { ...snap.columns["4"], unit: "USD millions" };
    const d = await read("FITB", undefined, fixtureClient(changed));
    expect(d.deposits).toBeNull();
    expect(d.depositsNote).toBe("The Summary of Deposits dictionary states another unit for the deposits.");
    expect(d.trends).toHaveLength(1);
  });
});

describe("FR Y-9C equity and net income", () => {
  it("adds total equity capital and year-to-date net income to the holding company's quarters", async () => {
    const d = await read("FITB");
    const eq = d.y9c!.lines.find(l => l.field === "BHCK3210")!;
    const ni = d.y9c!.lines.find(l => l.field === "BHCK4340")!;
    expect([eq.unit, eq.group, eq.basis, eq.cells.map(c => c.text)]).toEqual(["USD thousands", "statement", "balance", ["34106000", "34482000", "33296000"]]);
    expect([ni.basis, ni.cells.map(c => c.text), ni.cells.map(c => c.ref.row)]).toEqual(["ytd", ["165000", "966000", "1832000"], [39, 747, 4098]]);
    expect(ni.label).toBe("NET INCOME (LOSS) ATTRIBUTABLE TO BANK HOLDING COMPANY (BHC CONSOLIDATED)");
    const { amounts, ratios } = y9cCharts(d.y9c!);
    expect(amounts.map(a => [a.field, a.latest?.cell.text])).toEqual([["BHCK2170", "301226000"], ["BHCK3210", "33296000"], ["BHCK4340", "1832000"]]);
    expect(ratios.map(r => r.field)).toEqual(["BHCAP793", "BHCA7206", "BHCA7205", "BHCA7204"]);
  });
});
