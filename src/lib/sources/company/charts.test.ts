import { describe, expect, it } from "vitest";
import { countText, depositsView, obTimeline, ratioStat, ratioStats, readerOf, trendCharts, trendTitle, valueAxis, y9cCharts, yearBefore } from "./charts";
import type { ObApplication } from "./orange-book";
import { cellOf } from "./official.server";
import type { BankHistory, DepositsByState, OfficialSource, Y9cReport } from "./types";

// Every figure below is a stored cell of production (25 and 26 Nov 2026): the FDIC history and current-quarter
// tables (JPMorgan Chase Bank NA, certificate 628), the FR Y-9C family table (JPMorgan Chase & Co., RSSD 1039502),
// the 2026 Summary of Deposits by state (certificate 628) and the Orange Book files (Bristol Myers Squibb, Exelixis).

const src = (dataset: string, snapshot: string): OfficialSource => ({ dataset, snapshot, retrievedAt: "2026-11-24T10:00:00Z", publishedAt: "2026-11-24T11:00:00Z", fileSha256: "0".repeat(64), newerSnapshot: null });
const HIST = src("official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b", "cc6fa80010395b5e964e828c57820be11b1522d433a7f2681eda439d723ba817");
const CUR = src("official_fdic_2026q2_cohort500_native_current_quarter", "5161b5868f6f0b69142364ccfc1a39c59578abe9d9b551c3d50b940290ac2ddf");
const MONEY = "USD thousands (monetary measures)";

/** Rows 48512 to 48517 of the history table and the bank's current-quarter row: ASSET, DEP, ROA, RBCT1CER. */
const jpm: BankHistory = {
  cert: "628",
  measures: [
    { field: "ASSET", label: "Total assets", unit: MONEY },
    { field: "DEP", label: "Total deposits", unit: MONEY },
    { field: "ROA", label: "Return on assets", unit: "Percent" },
    { field: "RBCT1CER", label: "Common equity tier 1 ratio", unit: "Percent" },
  ],
  sources: [HIST, CUR],
  points: [
    { period: "2002-03-31", source: 0, row: 189, cells: ["541342000", "271940000", "0.3284011386549638", "0"].map(cellOf) },
    { period: "2025-03-31", source: 0, row: 48512, cells: ["3643099000", "2601221000", "1.4314115308151094", "15.75"].map(cellOf) },
    { period: "2025-06-30", source: 0, row: 48513, cells: ["3788551000", "2669161000", "1.4219196171927215", "15.57"].map(cellOf) },
    { period: "2025-09-30", source: 0, row: 48514, cells: ["3813431000", "2649438000", "1.3864764326074568", "15.69"].map(cellOf) },
    { period: "2025-12-31", source: 0, row: 48515, cells: ["3752662000", "2697842000", "1.3448553188805723", "15.29"].map(cellOf) },
    { period: "2026-03-31", source: 0, row: 48516, cells: ["4016571000", "2787994000", "1.438906517541693", "15.08"].map(cellOf) },
    { period: "2026-06-30", source: 0, row: 48517, cells: ["4091315000", "2820284000", "1.5851712753913223", "15.03"].map(cellOf) },
    { period: "2026-09-30", source: 1, row: 10, cells: ["4174631000", "", null, "14.19"].map(cellOf) },
  ],
};

describe("readerOf and valueAxis", () => {
  it("prints a whitelisted level in reader scale with the stored figure as filed, and leaves any other unit as filed", () => {
    expect(readerOf(MONEY, cellOf("4091315000"))).toMatchObject({ figure: "$4.091 trillion", filed: "4,091,315,000 USD thousands (monetary measures) as filed", axis: { title: "USD trillions", divisor: 1e9 } });
    expect(readerOf("USD thousands", cellOf("5091545000"))).toBeNull();
    expect(readerOf(MONEY, cellOf("N/A"))).toBeNull();
    expect(readerOf(MONEY, cellOf(""))).toBeNull();
  });
  it("ticks a reader-scale axis in its unit and a stored-unit axis in compact stored figures", () => {
    const reader = readerOf(MONEY, cellOf("4174631000"));
    const a = valueAxis([541342000, 4174631000], MONEY, { reader });
    expect(a.title).toBe("USD trillions");
    expect(a.ticks.map(t => t.text)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(a.ticks[1].value).toBe(1e9);
    const b = valueAxis([4900475000, 5091545000], "USD thousands");
    expect(b.title).toBe("USD thousands");
    expect(b.ticks.map(t => t.text)).toEqual(["0", "2B", "4B", "6B"]);
    const pct = valueAxis([6.5297, 17.1592], "Percent", { asFiled: "%", includeZero: true });
    expect(pct.ticks.map(t => t.text)).toEqual(["0", "5", "10", "15", "20"]);
    expect(pct.title).toBe("%");
    expect(valueAxis([13.9676, 17.1592], "Percent").ticks[0].text).toBe("13");
  });
});

describe("FDIC trends and ratio tiles", () => {
  it("draws each charter's own assets and deposits, the latest drawable quarter in reader scale, an empty cell as a gap", () => {
    const [assets, deposits] = trendCharts(jpm);
    expect(assets).toMatchObject({ field: "ASSET", label: "Total assets", unit: MONEY, gaps: 0, reader: { figure: "$4.175 trillion" } });
    expect(assets.latest).toMatchObject({ period: "2026-09-30", ref: { dataset: CUR.dataset, row: 10, field: "ASSET" } });
    expect(deposits.latest?.period).toBe("2026-06-30");
    expect(deposits.gaps).toBe(1);
    expect(trendTitle({ label: "Net income", basis: "quarter" })).toBe("Net income, quarter");
    expect(trendTitle({ label: "Total assets", basis: "balance" })).toBe("Total assets");
  });
  it("compares the latest ratio with the same quarter a year earlier, exactly, and keeps gaps in the sparkline", () => {
    const roa = ratioStat(jpm, "ROA")!;
    expect(roa.latest?.period).toBe("2026-06-30");
    expect(roa.yearEarlier?.period).toBe("2025-06-30");
    // 1.5851712753913223 less 1.4219196171927215 is 0.1632516582..., rounded once
    expect(roa.change).toEqual({ text: "+0.16", formula: "Q2 2026 less Q2 2025, in percentage points of the stored ratios" });
    expect(roa.spark).toHaveLength(7);
    const cet1 = ratioStat(jpm, "RBCT1CER")!;
    expect(cet1.change?.text).toBe("−1.50");
    expect(cet1.notReported).toBe(1);
    expect(cet1.spark[0]).toBeNull();
    expect(cet1.spark[cet1.spark.length - 1]).toBe(14.19);
    expect(ratioStat(jpm, "ASSET")).toBeNull();
    expect(ratioStats(jpm).map(s => s.field)).toEqual(["ROA", "RBCT1CER"]);
    expect(yearBefore("2026-03-31")).toBe("2025-03-31");
  });
});

describe("y9cCharts", () => {
  const Y9 = { dataset: "official_01_financials_data_fed_y9_family_all_native_2026q1_q3_ffceb6e988", snapshot: "eaa74358d53d90f9235e1733559ca65225488e3d13444f8834a1be15afb07948" };
  const quarters = [
    ["2026-03-31", 17, "4900475000", "364038000", "16494000", "14.2769", ""],
    ["2026-06-30", 497, "5015069000", "374598000", "37649000", "14.1913", ""],
    ["2026-09-30", 4077, "5091545000", "372368000", "52954000", "13.9676", ""],
  ] as const;
  const line = (field: string, short: string, unit: string | null, group: "capital" | "statement", basis: "ytd" | "balance", at: number) => ({
    field, label: short, short, unit, group, basis, unitEvidence: null, labelRef: null,
    cells: quarters.map(q => ({ ...cellOf(q[at]), ref: { ...Y9, row: q[1], field } })),
  });
  const report: Y9cReport = {
    rssd: "1039502",
    legalName: "JPMORGAN CHASE & CO.",
    source: src(Y9.dataset, Y9.snapshot),
    dictionary: null,
    quarters: quarters.map(q => ({ reportDate: q[0], ref: { ...Y9, row: q[1] }, totalAssets: { ...cellOf(q[2]), ref: { ...Y9, row: q[1], field: "BHCK2170" }, unit: "USD thousands" } })),
    lines: [
      line("BHCK3210", "Total equity capital", "USD thousands", "statement", "balance", 3),
      line("BHCK4340", "Net income", "USD thousands", "statement", "ytd", 4),
      line("BHCAP793", "Common equity tier 1 capital ratio", "Percent", "capital", "balance", 5),
      line("BHCAP859", "Common equity tier 1 capital", "USD thousands", "capital", "balance", 6),
    ],
    missing: [],
  };
  it("charts total assets, equity and year-to-date net income as filed, and the percent ratios on one axis", () => {
    const { amounts, ratios } = y9cCharts(report);
    expect(amounts.map(a => [a.field, a.basis, a.latest?.cell.text, a.reader])).toEqual([
      ["BHCK2170", "balance", "5091545000", null],
      ["BHCK3210", "balance", "372368000", null],
      ["BHCK4340", "ytd", "52954000", null],
    ]);
    expect(amounts[2].points.map(p => p.ref.row)).toEqual([17, 497, 4077]);
    expect(ratios.map(r => [r.field, r.points.map(p => p.value)])).toEqual([["BHCAP793", [14.2769, 14.1913, 13.9676]]]);
  });
  it("draws no line whose cells are all blank and no line without an established unit", () => {
    const noUnit = { ...report, lines: report.lines.map(l => (l.field === "BHCK3210" ? { ...l, unit: null } : l)) };
    expect(y9cCharts(noUnit).amounts.map(a => a.field)).toEqual(["BHCK2170", "BHCK4340"]);
  });
});

describe("depositsView", () => {
  const SOD = src("official_01_financials_data_fdic_top500_2026_sod_by_bank_state_a65c3ff1ec", "4e3df7aa86492c7fbcfe265b7ee49dedaf7ddc70a2ad48d236a0e0fc4d957a63");
  const d: DepositsByState = {
    cert: "628",
    name: "JPMorgan Chase Bank, National Association",
    unit: "USD thousands",
    states: [
      { code: "AZ", deposits: cellOf("50163251"), branches: cellOf("186"), row: 39 },
      { code: "CA", deposits: cellOf("297741450"), branches: cellOf("857"), row: 40 },
      // a constructed cell (no stored state reads "n/a"): a text cell is ranked last and never drawn
      { code: "GU", deposits: cellOf("n/a"), branches: cellOf("1"), row: 9999 },
      { code: "NY", deposits: cellOf("970263134"), branches: cellOf("576"), row: 69 },
    ],
    totals: { row: 1, deposits: cellOf("2226790000"), branches: cellOf("5141"), states: cellOf("49"), surveyYear: "2026" },
    source: SOD,
    totalsSource: src("official_01_financials_data_fdic_top500_2026_sod_bank_totals_41b1214439", "5f256d95148ca37de19d9cdae591c56f0cc52d55b2a49c876ca786871414756f"),
    fields: { deposits: "branch_deposits_USD_thousands", branches: "branch_records", state: "STALPBR", states: "states_and_territories" },
  };
  it("ranks the stored states by deposits, a cell that is not a number last, and keeps every row's reference", () => {
    const v = depositsView(d);
    expect(v.states.map(s => s.code)).toEqual(["NY", "CA", "AZ", "GU"]);
    expect(v.max).toBe(970263134);
    expect(v.states[0].ref).toEqual({ dataset: SOD.dataset, snapshot: SOD.snapshot, row: 69, field: "branch_deposits_USD_thousands" });
    expect(v.states[3].value).toBeNull();
    expect(v.totalsRef?.row).toBe(1);
    expect(v.reader).toBeNull(); // "USD thousands" is not on the reader-scale whitelist
  });
  it("writes counts only from whole numbers", () => {
    expect(countText(cellOf("5141"))).toBe("5,141");
    expect(countText(cellOf("1.5"))).toBeNull();
    expect(countText(cellOf(""))).toBeNull();
  });
});

describe("obTimeline", () => {
  const ref = (row: number) => ({ dataset: "official_03_healthcare_csv_ob_patent_63776478d4", snapshot: "60c0c87962d5bffc357c222f1a25184892e15415c673f4d5d16636d9c3c1e992", row });
  const xref = (row: number) => ({ dataset: "official_03_healthcare_csv_ob_exclusivity_b108a0e8e8", snapshot: "c7553d3c", row });
  const patent = (no: string, expiry: string, rows: number[], delisted = false) => ({ patent: no, expiry, expiryDay: null, substance: true, drugProduct: true, delisted, products: ["001"], useCodes: [], refs: rows.map(ref) });
  const app = (appl: string, trade: string, patents: ReturnType<typeof patent>[], exclusivity: { code: string; date: string; rows: number[] }[]): ObApplication => ({
    appl, sponsor: "BRISTOL MYERS SQUIBB", trade: [trade], ingredient: [trade.toLowerCase()], applicant: "BRISTOL MYERS SQUIBB", applicantFull: [], products: [],
    patents, exclusivity: exclusivity.map(e => ({ code: e.code, date: e.date, dateDay: null, products: ["001"], refs: e.rows.map(xref) })),
  });
  const eliquis = app("202155", "ELIQUIS", [patent("6967208", "Nov 21, 2026", [526, 527]), patent("6967208*PED", "May 21, 2027", [20986]), patent("9326945", "Feb 24, 2031", [15216]), patent("9326945*PED", "Aug 24, 2031", [20988])], [{ code: "NPP", date: "Apr 17, 2028", rows: [111, 112] }, { code: "NS", date: "Apr 17, 2028", rows: [113] }]);
  const revlimid = app("021880", "REVLIMID", [], [{ code: "ODE-241", date: "May 28, 2026", rows: [33] }, { code: "ODE-245", date: "May 28, 2026", rows: [34] }]);
  const cabometyx = app("203756", "CABOMETYX", [patent("8877776", "Oct 8, 2030", [309])], []);
  const undated = app("999999", "UNDATED", [patent("1234567", "", [1])], []);

  it("orders products by their next listed date, keeps past dates on the axis, and lists what comes next", () => {
    const t = obTimeline([cabometyx, revlimid, eliquis, undated], "2026-11-25");
    expect(t.rows.map(r => [r.trade, r.next?.day ?? null])).toEqual([["ELIQUIS", "2027-05-21"], ["CABOMETYX", "2030-10-08"], ["REVLIMID", null]]);
    expect(t.upcoming.map(e => [e.appl, e.kind, e.printed, e.items.join(" ")])).toEqual([
      ["202155", "patent", "May 21, 2027", "6967208*PED"],
      ["202155", "exclusivity", "Apr 17, 2028", "NPP NS"],
      ["203756", "patent", "Oct 8, 2030", "8877776"],
      ["202155", "patent", "Feb 24, 2031", "9326945"],
      ["202155", "patent", "Aug 24, 2031", "9326945*PED"],
    ]);
    expect(t.from).toBe("2026-05-28");
    expect(t.to).toBe("2031-08-24");
    expect(t.undated).toBe(1);
  });
  it("makes one mark of the entries of one kind that end the same day, with every stored row", () => {
    const t = obTimeline([revlimid], "2026-11-25");
    expect(t.rows[0].events).toHaveLength(1);
    expect(t.rows[0].events[0]).toMatchObject({ kind: "exclusivity", items: ["ODE-241", "ODE-245"], refs: [xref(33), xref(34)] });
    expect(t.upcoming).toEqual([]);
    expect(t.to).toBe("2026-11-25");
  });
});
