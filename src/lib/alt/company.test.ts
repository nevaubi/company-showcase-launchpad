import { describe, expect, it } from "vitest";
import { buildCompanyAlt, completeThrough, phaseLine, riseFlag, sameDrugChange, snapshotFigures, type CompanyAltRow } from "./company";
import { addDays } from "./history";

const TODAY = "2026-11-23";
let n = 0;
const row = (p: Partial<CompanyAltRow>): CompanyAltRow => ({ uid: `u${n++}`, ticker: "LMT", dataset: "events", kind: "event", date: null, title: "", value: null, unit: null, meta: {}, source: "s", source_url: `https://example.org/${n}`, ...p });

// Real LMT figures (alt_data, 23 Nov 2026): FY2025 obligations $69,313,261,998.29, FY2024 $34,774,315,531.77.
const obligations = (date: string, value: number, fy: number, extra: Record<string, unknown> = {}) => row({ dataset: "contracts", kind: "series", title: "Federal contract obligations", date, value, unit: "USD", meta: { fiscal_year: fy, ytd: false, recipients: ["LOCKHEED MARTIN CORP", "LOCKHEED MARTIN SPACE"], ...extra } });
const contracts = [obligations("2024-09-30", 34774315531.77, 2024), obligations("2025-09-30", 69313261998.29, 2025), obligations("2026-09-30", 55798650433.48, 2026)];
const revenue = [{ value: 71043000000, end: "2024-12-31" }, { value: 75048000000, end: "2025-12-31", accn: "0001628280-26-004195" }];

describe("contracts", () => {
  it("compares settled fiscal years, keeps unsettled ones apart and names how many recipients the total covers", () => {
    const v = buildCompanyAlt(contracts, TODAY, revenue).views.find((x) => x.dataset === "contracts")!;
    expect(v.figures[0].label).toBe("Federal obligations, FY2025");
    expect(v.figures[0].value).toBe("$69.3B");
    // 69.31 / 34.77 − 1 = +99.3%; FY2026 ended 2026-09-30 and is within the 120-day lag
    expect(v.figures[0].sub).toBe("+99% vs FY2024 · FY2026 prelim.: $55.8B · 2 recipient names");
    expect(v.chart!.points.map((p) => p.partial)).toEqual([false, false, true]);
  });
  it("shows every unsettled year, not only the newest", () => {
    const fy27 = obligations("2026-11-20", 52.7e6, 2027, { ytd: true, period_end: "2027-09-30", as_of: "2026-11-20" });
    const v = buildCompanyAlt([...contracts, fy27], TODAY).views.find((x) => x.dataset === "contracts")!;
    expect(v.figures[0].sub).toBe("+99% vs FY2024 · FY2026 prelim.: $55.8B · FY2027 YTD: $52.7M · 2 recipient names");
  });
  it("never sums award actions (the newest 300 per recipient) and does not size obligations against revenue", () => {
    const acts = [120e6, 80e6, 5e6].map((value, i) => row({ dataset: "contracts", uid: `usatx:LMT:${i}`, date: addDays(TODAY, -20 - i), value, unit: "USD", title: "Award action", meta: { agency: "Department of the Navy" } }));
    const v = buildCompanyAlt([...contracts, ...acts], TODAY, revenue).views.find((x) => x.dataset === "contracts")!;
    expect(v.figures.map((f) => f.label)).toEqual(["Federal obligations, FY2025", "Largest award action, 12 months"]);
    expect(v.figures[1].value).toBe("$120.0M");
    expect(v.figures.some((f) => /revenue/i.test(f.label))).toBe(false);
    expect(v.flag).toBeUndefined();
  });
});

describe("medicare", () => {
  const m = (title: string, date: string, value: number, meta: Record<string, unknown>) => row({ dataset: "medicare", kind: "series", title, date, value, unit: "USD", meta });
  // UTHR, stored rows: Part B 2024 holds Tyvaso and Remodulin, Part B 2025 Remodulin only
  const lines = (y: number, xs: [string, number][]) => xs.map(([t, v]) => m(t, `${y}-12-31`, v, { year: y, ytd: false }));
  const d24: [string, number][] = [["Part D · Orenitram ER", 230423098], ["Part D · Orenitram Month 3 Titration Kt", 399793], ["Part D · Remodulin", 13529903], ["Part D · Tyvaso Dpi", 728752455], ["Part D · Tyvaso Refill Kit", 7668325], ["Part D · Tyvaso Starter Kit", 492359], ["Part B · Remodulin", 121601006], ["Part B · Tyvaso", 183021609]];
  const d25: [string, number][] = [["Part D · Orenitram ER", 276952111], ["Part D · Orenitram Month 3 Titration Kt", 403568], ["Part D · Remodulin", 15112997], ["Part D · Tyvaso Dpi", 1005963880], ["Part D · Tyvaso Refill Kit", 11300400], ["Part D · Tyvaso Starter Kit", 673560], ["Part B · Remodulin", 111148523]];
  it("compares only the drugs on file in both years", () => {
    const c = sameDrugChange([...lines(2024, d24), ...lines(2025, d25)], "2025", "2024")!;
    // 1,421,555,039 / 1,102,866,939 − 1 = 28.9%, over 7 drugs; Part B Tyvaso (2024 only) is left out
    expect(c.drugs).toBe(7);
    expect(c.change).toBeCloseTo(0.28896, 4);
  });
  it("puts the same-drug change and the revenue share in the headline's sub-line", () => {
    const alt = buildCompanyAlt([
      m("Medicare Part D spending", "2024-12-31", 981712148, { year: 2024, ytd: false }),
      m("Medicare Part B spending", "2024-12-31", 304622615, { year: 2024, ytd: false }),
      m("Medicare Part D spending", "2025-12-31", 1310918477, { year: 2025, ytd: false }),
      m("Medicare Part B spending", "2025-12-31", 111148523, { year: 2025, ytd: false }),
      m("Medicare Part D spending", "2026-03-31", 342071433, { year: 2026, ytd: true, quarters: 1 }),
      ...lines(2024, d24), ...lines(2025, d25),
    ], TODAY, [{ value: 3182700000, end: "2025-12-31" }]);
    const f = alt.views[0].figures;
    expect(f).toHaveLength(1);
    expect(f[0].value).toBe("$1.4B");
    // 1,422,067,000 / 3,182,700,000 = 44.7%
    expect(f[0].sub).toBe("+29% vs 2024 on the 7 drugs in both years · 45% of FY2025 revenue · 2026 Q1: $342.1M");
  });
});

describe("events: counts the stored history can carry", () => {
  it("flags a burst of filings against a steady history and lists red-flag items as notable", () => {
    const ev: CompanyAltRow[] = [];
    // one filing every 45 days for two years, then twelve in November: p = 2.6e-5 against 2 per window
    for (let d = 100; d < 800; d += 45) ev.push(row({ date: addDays(TODAY, -d), title: "Director or officer change", meta: { item: "5.02" } }));
    for (let i = 0; i < 12; i++) ev.push(row({ date: `2026-11-${String(1 + i).padStart(2, "0")}`, title: i ? "Director or officer change" : "Prior financials no longer reliable", meta: { item: i ? "5.02" : "4.02" } }));
    const alt = buildCompanyAlt(ev, TODAY);
    expect(alt.flags).toHaveLength(1);
    expect(alt.flags[0]).toMatchObject({ kind: "rise", direction: "up" });
    expect(alt.flags[0].text).toBe("12 8-K filings in the last 90 days; at most 2 in any of the 7 earlier 90-day windows (mean 2.0)");
    expect(alt.notable.map((r) => r.meta.item)).toEqual(["4.02"]);
    const snap = snapshotFigures(alt);
    expect(snap[0].flag).toBeDefined();
    expect(snap[0].figure.label).toBe("8-K filings, last 90 days");
  });
  it("labels a history that starts inside the year, without a comparison or an all-clear", () => {
    const ev = Array.from({ length: 6 }, (_, i) => row({ uid: `8k:X:a${i}:5.02`, date: `2026-11-0${i + 1}`, meta: { item: "5.02" } }));
    const alt = buildCompanyAlt(ev, TODAY);
    expect(alt.flags).toEqual([]);
    const v = alt.views[0];
    expect(v.figures[0]).toMatchObject({ label: "8-K filings, since Nov 1, 2026", value: "6", sub: "6 items" });
    expect(v.figures[1].label).toBe("Red-flag items, since Nov 1, 2026");
    expect(v.figures[1].sub).toBeUndefined();
    expect(v.coverage).toMatch(/^Stored history starts Nov 1, 2026/);
  });
});

describe("series", () => {
  const views = (vals: [string, number][]) => vals.map(([date, value]) => row({ dataset: "attention", kind: "series", title: "Wikipedia pageviews", date, value, meta: { article: "X" } }));
  it("never reads the month in progress", () => {
    const months = Array.from({ length: 26 }, (_, i) => new Date(Date.UTC(2024, 8 + i, 1)).toISOString().slice(0, 10));
    const rows = views([...months.map((d) => [d, 60_000] as [string, number]), ["2026-11-01", 1_532]]);
    const v = buildCompanyAlt(rows, TODAY).views[0];
    expect(v.figures.map((f) => f.label)).toEqual(["Pageviews, 12 months", "Pageviews, 2026-10"]);
    expect(v.figures[0].sub).toBe("0.0% vs prior 12 months");
    expect(v.chart!.points[v.chart!.points.length - 1].label).toBe("2026-10");
    expect(v.flag).toBeUndefined();
  });

  it("puts a bank's flag on the reading it is about, not on deposits", () => {
    const q = (y: number, k: number) => `${y}-${["03-31", "06-30", "09-30", "12-31"][k]}`;
    const rows: CompanyAltRow[] = [];
    for (let y = 2020; y <= 2026; y++) for (let k = 0; k < 4; k++) {
      const d = q(y, k);
      if (d > "2026-06-30") continue;
      rows.push(row({ dataset: "bank", kind: "series", title: "Total deposits", date: d, value: 80e9 + y * 1e8, unit: "USD" }));
      // year-to-date annualised rate: 0.2% every quarter, then a 3% second quarter in 2026 (YTD 1.6%)
      rows.push(row({ dataset: "bank", kind: "series", title: "Net charge-off rate", date: d, value: d === "2026-06-30" ? 1.6 : 0.2, unit: "%" }));
    }
    const alt = buildCompanyAlt(rows, TODAY);
    const bank = alt.views.find((v) => v.dataset === "bank")!;
    expect(bank.figures[0].label).toMatch(/^Bank deposits/);
    expect(bank.flag!.kind).toBe("range");
    // single quarter: 2·1.6 − 0.2 = 3.0%, against a highest single quarter of 0.2%
    expect(bank.flag!.figure).toMatchObject({ label: "Net charge-off rate, 2026-06-30 quarter", value: "3.00%" });
    const snap = snapshotFigures(alt);
    expect(snap[0].figure.label).toBe("Net charge-off rate, 2026-06-30 quarter");
  });
});

describe("wording and materiality", () => {
  it("writes trial phases plainly", () => {
    const t = (phase?: string) => row({ dataset: "trials", meta: { status: "RECRUITING", phase } });
    expect(phaseLine([t("PHASE3"), t("PHASE3"), t("PHASE3"), t("PHASE2"), t(), t(), t("PHASE1/PHASE2")])).toBe("Phase 3: 3 · Phase 1/2: 1 · Phase 2: 1 · no phase: 2");
  });
  it("keeps small datasets to one quiet line and out of the snapshot", () => {
    const tri = [2023, 2024].map((y) => row({ ticker: "KO", dataset: "tri", kind: "series", title: "Toxic releases (TRI)", date: `${y}-12-31`, value: 2221, unit: "lbs" }));
    const alt = buildCompanyAlt([...tri, ...contracts], TODAY);
    expect(alt.views.find((v) => v.dataset === "tri")!.quiet).toMatch(/^Under 10,000 lb/);
    expect(snapshotFigures(alt).map((x) => x.view.dataset)).toEqual(["contracts"]);
  });
  it("omits a regulatory series of zeros and a company without rows", () => {
    const zeros = [2024, 2025].map((y) => row({ dataset: "regulatory", kind: "series", title: "Federal Register documents naming the company", date: `${y}-12-31`, value: 0, unit: "docs" }));
    expect(buildCompanyAlt(zeros, TODAY).views).toEqual([]);
    expect(buildCompanyAlt([], TODAY).themes).toEqual([]);
  });
});

describe("riseFlag on a source that publishes late", () => {
  // FDA recalls: about 2 a quarter for two years, then 9 recalls 100 to 170 days back (published, whole),
  // and 6 in the last 30 days (some of a quarter that is not all published yet)
  const recall = (daysBack: number, i: number) => row({ ticker: "ABT", dataset: "fda", date: addDays(TODAY, -daysBack), meta: { kind: "recall", reason: `reason ${daysBack} ${i}` } });
  const base = Array.from({ length: 16 }, (_, i) => recall(200 + i * 50, i));
  it("compares only windows that end where the source is complete, and says so", () => {
    const burst = Array.from({ length: 9 }, (_, i) => recall(100 + i * 8, i));
    const f = riseFlag("fda", [...base, ...burst], TODAY)!;
    expect(f).toBeDefined();
    expect(completeThrough({ lagDays: 90 }, TODAY)).toBe(addDays(TODAY, -90));
    expect(f.text).toContain(`90 days to Aug 25, 2026`);
    expect(f.figure?.label).toContain("90 days to");
  });
  it("does not flag recent records inside the publication delay", () => {
    const fresh = Array.from({ length: 9 }, (_, i) => recall(5 + i * 2, i));
    expect(riseFlag("fda", [...base, ...fresh], TODAY)).toBeUndefined();
  });
  it("keeps SEC sources complete through today", () => {
    expect(completeThrough({ lagDays: 3 }, TODAY)).toBe(TODAY);
  });
});
