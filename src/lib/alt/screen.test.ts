import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageOf } from "@/lib/coverage";
import { tickerKeys } from "./contracts";
import { COMPANY_NAMES, CONTRACT_ROWS } from "./contracts.fixture";
import { FDA_FIRMS } from "./firms.fixture";
import { eventBuckets, screenAltRows, withScreenColumns } from "./screen";

// coverage short name plus the SEC name where the contracts fixture recorded it (what the app's universe carries)
const keysOf = (t: string) => {
  const s = coverageOf(t)?.shortName;
  return s ? tickerKeys(t, s, COMPANY_NAMES[t]?.sec ?? null) : null;
};

describe("screenAltRows", () => {
  it("removes misattributed rows of every judged dataset in one pass and leaves the rest", () => {
    const rows: { ticker: string; dataset: string; kind: string; meta: unknown; title?: string; value?: number }[] = [
      // real stored rows: a DOE award to Battelle under Apple, Boeing's own award, KO bottler and own recalls
      ...CONTRACT_ROWS.filter((r) => r.kind === "event" && ["AAPL", "BA"].includes(r.ticker)).map((r) => ({ ticker: r.ticker, dataset: "contracts", kind: "event", meta: { award_id: r.award, recipient: r.recipient } })),
      ...FDA_FIRMS.filter((r) => r.ticker === "KO").map((r) => ({ ticker: "KO", dataset: "fda", kind: "event", meta: { kind: "food recall", firm: r.firm } })),
      { ticker: "JPM", dataset: "bank", kind: "series", title: "CET1 ratio", value: 0, meta: { field: "RBCT1CER", cert: 628 } },
      { ticker: "JPM", dataset: "bank", kind: "series", title: "CET1 ratio", value: 15.2, meta: { field: "RBCT1CER", cert: 628 } },
      { ticker: "AAPL", dataset: "ownership", kind: "event", meta: { filers: ["Vanguard"] } },
      { ticker: "ZZZZ", dataset: "fda", kind: "event", meta: { kind: "drug recall", firm: "Zzzz Inc." } },
      { ticker: "ZZZZ", dataset: "events", kind: "event", meta: {} },
    ];
    const kept = screenAltRows(rows, keysOf);
    const byDataset = (d: string, t?: string) => kept.filter((r) => r.dataset === d && (!t || r.ticker === t));
    expect(byDataset("contracts", "AAPL")).toHaveLength(0);
    expect(byDataset("contracts", "BA").map((r) => (r.meta as { recipient: string }).recipient)).toEqual(["THE BOEING COMPANY"]);
    // 20 distinct firm names stored under KO: 12 bottlers and look-alikes go; 7 spellings of The Coca-Cola Company and its museum stay
    expect(FDA_FIRMS.filter((r) => r.ticker === "KO")).toHaveLength(20);
    expect(byDataset("fda", "KO")).toHaveLength(8);
    expect(byDataset("bank").map((r) => r.value)).toEqual([15.2]);
    expect(byDataset("ownership")).toHaveLength(1);
    // a company the app does not know: rows that need its identity are dropped, others pass
    expect(kept.filter((r) => r.ticker === "ZZZZ").map((r) => r.dataset)).toEqual(["events"]);
  });

  it("never shows the contracts collector's refresh records", () => {
    const run = { ticker: "BA", dataset: "contracts_refresh", kind: "event", meta: { refresh: true, rule: 2, as_of: "2026-11-22T00:00:00Z", parents: [], family: [] } };
    expect(screenAltRows([run], keysOf)).toEqual([]);
  });

  it("adds the columns it needs to a reader's select list", () => {
    expect(withScreenColumns("dataset,date,title,value,unit,source_url")).toBe("dataset,date,title,value,unit,source_url,uid,ticker,kind,meta");
    expect(withScreenColumns("ticker,date,title,value,meta,source_url")).toBe("ticker,date,title,value,meta,source_url,uid,dataset,kind");
    expect(withScreenColumns("*")).toBe("*");
  });
});

// MCHB's bank is certificate 1768; 29011 is The Mechanics Bank of Ohio, which the old collector stored under MCHB
// (reports/company.md). JPM's banks are 628 and 21761, rolled up under RSSD 1039502 (guard.json).
describe("screenAltRows: the bank guard for every reader", () => {
  const bank = (ticker: string, cert: number, title: string, value: number) => ({ uid: `fdic:${ticker}:F:${value}`, ticker, dataset: "bank", kind: "series", date: "2026-09-30", title, value, meta: { field: "F", cert } });
  const total = (ticker: string, year: number, value: number, meta: Record<string, unknown>) => ({ uid: `sod:${ticker}:${year}:total`, ticker, dataset: "deposits", kind: "series", date: `${year}-06-30`, title: "Branch deposits", value, meta: { year, ...meta } });
  const state = (ticker: string, year: number, st: string, value: number, meta: Record<string, unknown> = {}) => ({ uid: `sod:${ticker}:${year}:${st}`, ticker, dataset: "deposits", kind: "series", date: `${year}-06-30`, title: `Deposits · ${st}`, value, meta: { year, state: st, ...meta } });
  const ids = (rows: { uid?: string | null; ticker: string }[]) => rows.map((r) => r.uid ?? r.ticker);

  it("company and cross-company reads: call reports of an unproven certificate go, other tickers and datasets pass", () => {
    const rows = [bank("MCHB", 29011, "Total deposits", 919_600_000), bank("JPM", 628, "Total deposits", 2_500_000_000_000), bank("MCHB", 1768, "Total deposits", 16_000_000_000), bank("ZZZZ", 5, "Total deposits", 1), { uid: "wiki:MCHB:202610", ticker: "MCHB", dataset: "attention", kind: "series", date: "2026-10-01", title: "Wikipedia pageviews", value: 5, meta: {} }];
    expect(ids(screenAltRows(rows, keysOf))).toEqual(["fdic:JPM:F:2500000000000", "fdic:MCHB:F:16000000000", "fdic:ZZZZ:F:1", "wiki:MCHB:202610"]);
  });

  it("deposits by state (every row of two surveys): the other bank's years go, a state left from the wrong roll-up goes, order kept", () => {
    const scope = { scope: "certs:1768" };
    const rows = [
      state("JPM", 2026, "NY", 700, { scope: "rssd:1039502" }),
      total("MCHB", 2025, 790_200_000, { cert: 29011, rssd: "2395326" }),
      state("MCHB", 2025, "OH", 790_200_000),
      total("MCHB", 2026, 18_000, { cert: 1768, rssd: null, ...scope }),
      state("MCHB", 2026, "CA", 17_500, scope),
      state("MCHB", 2026, "OH", 790_200_000),
      state("MCHB", 2026, "OR", 500, scope),
      total("JPM", 2026, 1000, { cert: 628, rssd: "1039502", scope: "rssd:1039502" }),
      state("JPM", 2026, "TX", 300, { scope: "rssd:1039502" }),
      total("ZZZZ", 2026, 9, { cert: 5 }),
    ];
    expect(ids(screenAltRows(rows, keysOf))).toEqual(["sod:JPM:2026:NY", "sod:MCHB:2026:total", "sod:MCHB:2026:CA", "sod:MCHB:2026:OR", "sod:JPM:2026:total", "sod:JPM:2026:TX", "sod:ZZZZ:2026:total"]);
  });

  it("hub leaderboards (rows of alt_series_leaders: no key, no title): each row judged by its own certificate and roll-up", () => {
    const lead = (ticker: string, dataset: string, meta: Record<string, unknown>) => ({ ticker, dataset, kind: "series", date: "2026-06-30", value: 1, unit: "USD", meta, source_url: null, prior_value: null, prior_date: null, base_median: null, base_n: null });
    const rows = [
      lead("MCHB", "bank", { field: "DEP", cert: 29011 }),
      lead("JPM", "bank", { field: "DEP", cert: 628 }),
      lead("MCHB", "deposits", { cert: 29011, rssd: "2395326" }),
      lead("JPM", "deposits", { cert: 628, rssd: "1039502", scope: "rssd:1039502" }),
      lead("JPM", "deposits", { state: "NY", scope: "rssd:1039502" }),
    ];
    expect(screenAltRows(rows, keysOf).map((r) => `${r.ticker} ${r.dataset}`)).toEqual(["JPM bank", "JPM deposits"]);
  });

  it("a year read as its total alone keeps a proven total; a year read in part is left out whole", () => {
    const jpm = { cert: 628, rssd: "1039502", scope: "rssd:1039502" };
    expect(ids(screenAltRows([total("JPM", 2026, 1000, jpm)], keysOf))).toEqual(["sod:JPM:2026:total"]);
    expect(ids(screenAltRows([total("MCHB", 2026, 1000, { cert: 29011, rssd: "2395326" })], keysOf))).toEqual([]);
    expect(ids(screenAltRows([total("JPM", 2026, 1000, jpm), state("JPM", 2026, "TX", 300, { scope: jpm.scope })], keysOf))).toEqual([]);
    expect(ids(screenAltRows([state("JPM", 2026, "TX", 300, { scope: jpm.scope })], keysOf))).toEqual([]);
  });
});

describe("eventBuckets", () => {
  it("counts like alt_event_buckets: 90-day windows back from today, up to 810 days, none in the future", () => {
    const rows = [
      { ticker: "A", dataset: "fda", date: "2026-11-20" },
      { ticker: "A", dataset: "fda", date: "2026-08-23" },
      { ticker: "A", dataset: "fda", date: "2026-08-22" },
      { ticker: "A", dataset: "fda", date: "2024-09-02" },
      { ticker: "A", dataset: "fda", date: "2024-09-01" },
      { ticker: "A", dataset: "fda", date: "2026-12-31" },
      { ticker: "A", dataset: "fda", date: null },
    ];
    const b = eventBuckets(rows, "2026-11-20").sort((x, y) => x.bucket - y.bucket);
    // 2026-08-23 is 89 days back (bucket 0), 2026-08-22 is 90 (bucket 1), 2024-09-02 is 809 (bucket 8), 2024-09-01 is 810 (out)
    expect(b).toEqual([
      { ticker: "A", dataset: "fda", bucket: 0, n: 2, last_date: "2026-11-20" },
      { ticker: "A", dataset: "fda", bucket: 1, n: 1, last_date: "2026-08-22" },
      { ticker: "A", dataset: "fda", bucket: 8, n: 1, last_date: "2024-09-02" },
    ]);
  });
});

describe("alt_data readers", () => {
  // Every read of stored alt rows goes through readAlt/readAltAll (src/lib/alt/query.ts), which screens
  // them. Allowed elsewhere: the collector job's writes and its read-back of stored meta, and the setups
  // job's fails-to-deliver values (a whole-market file keyed by ticker, never matched by name).
  const ALLOWED = new Set(["src/lib/alt/query.ts", "src/lib/jobs/jobs.server.ts", "src/lib/jobs/setups.server.ts"]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.|\.fixture\./.test(f) ? [p] : [];
    });
  it("no file outside the shared read path reads alt_data directly", () => {
    const offenders = files("src")
      .filter((f) => !f.includes("integrations/supabase/types"))
      .filter((f) => /from\(\s*["'`]alt_data["'`]\s*\)/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });
});
