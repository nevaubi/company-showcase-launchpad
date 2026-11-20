import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COVERAGE, companyCiks, coverageOf, historyCik, tickerByCik } from "@/lib/coverage";
import { driftRow, MIN_TICKER_FILE_ROWS, parseTickerFile, registrantDrift, type TickerFileEntry } from "./registrant-drift";
import { alerts } from "./watchdog";

// Entries as SEC's ticker file listed them on 20 Nov 2026.
const XOM_2026: TickerFileEntry = { cik_str: 2115436, ticker: "XOM", title: "ExxonMobil Holdings Corp" };
const AAPL: TickerFileEntry = { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." };
const filler = (n: number) => Array.from({ length: n }, (_, i) => ({ cik_str: 9_000_000 + i, ticker: `ZZ${i}`, title: `Filler ${i}` }));

describe("coverage CIKs", () => {
  it("XOM files under ExxonMobil Holdings (2115436) and keeps its history under 34088", () => {
    const xom = coverageOf("XOM")!;
    expect(companyCiks(xom)).toEqual(["2115436", "34088"]);
    expect(historyCik(xom)).toBe("34088");
    expect(tickerByCik().get("34088")).toBe("XOM");
    expect(tickerByCik().get("2115436")).toBe("XOM");
  });
  it("every other company keeps one CIK, so the ingest builds exactly what it built before", () => {
    for (const c of COVERAGE) if (!c.formerCiks) expect(historyCik(c), c.ticker).toBe(c.cik);
    expect(COVERAGE.filter((c) => c.formerCiks).map((c) => c.ticker)).toEqual(["XOM"]);
    const src = readFileSync("scripts/ingest.ts", "utf8");
    expect(src).toMatch(/const cik = historyCik\(cfg\);/);
    expect(src.slice(src.indexOf("async function ingestCompany"))).not.toMatch(/cfg\.cik/);
  });
});

describe("registrant drift check", () => {
  it("names the ticker and both CIKs when coverage still has the old registrant", () => {
    const file = [XOM_2026, AAPL, ...filler(10)];
    const before = [{ ticker: "XOM", cik: "34088" }, { ticker: "AAPL", cik: "320193" }, { ticker: "KVUE", cik: "1944048" }];
    const r = registrantDrift(before, file);
    expect(r.drift).toEqual([{ ticker: "XOM", coverageCik: "34088", secCik: "2115436", secName: "ExxonMobil Holdings Corp", knownFormer: false }]);
    expect(r.unlisted).toEqual(["KVUE"]);
    const row = driftRow(r.drift[0], Date.parse("2026-11-20T12:00:00Z"));
    expect(row).toMatchObject({ job: "registrant-drift:XOM", cursor: 2115436, paused_reason: "coverage CIK 34088, SEC CIK 2115436 (ExxonMobil Holdings Corp)" });
    const a = alerts({ freshness: [{ key: "worker_heartbeat", label: "hb", newest: new Date().toISOString(), ageHours: 0, maxAgeHours: 1, status: "fresh" } as never], jobs: [], states: [{ ...row, updated_at: row.updated_at }] }, Date.now());
    expect(a.find((x) => x.key === "registrant:XOM")?.title).toBe("XOM changed SEC registrant: coverage CIK 34088, SEC CIK 2115436 (ExxonMobil Holdings Corp)");
  });
  it("finds no drift for today's coverage (XOM carries the new CIK)", () => {
    expect(registrantDrift(COVERAGE.filter((c) => ["XOM", "AAPL"].includes(c.ticker)), [XOM_2026, AAPL]).drift).toEqual([]);
  });
  it("reads tickers with dots or dashes alike, and refuses a short or malformed download", () => {
    expect(registrantDrift([{ ticker: "BRK.B", cik: "1067983" }], [{ cik_str: 1067983, ticker: "BRK-B", title: "Berkshire" }]).drift).toEqual([]);
    expect(parseTickerFile({ 0: XOM_2026 })).toBeNull();
    expect(parseTickerFile("<html>")).toBeNull();
    const ok = Object.fromEntries([XOM_2026, ...filler(MIN_TICKER_FILE_ROWS)].map((e, i) => [String(i), e]));
    expect(parseTickerFile(ok)?.length).toBe(MIN_TICKER_FILE_ROWS + 1);
  });
  it("the watchdog reads the drift rows and the page does not list them as paused jobs", async () => {
    expect(readFileSync("src/lib/jobs/watchdog.server.ts", "utf8")).toMatch(/job\.like\."registrant-drift:\*"/);
    const { pausedJobs } = await import("./data-freshness");
    expect(pausedJobs([{ job: "registrant-drift:XOM", paused_reason: "coverage CIK 34088, SEC CIK 2115436", updated_at: new Date().toISOString() }])).toEqual([]);
  });
});
