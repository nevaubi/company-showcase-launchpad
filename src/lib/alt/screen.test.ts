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
      { ticker: "JPM", dataset: "bank", kind: "series", title: "CET1 ratio", value: 0, meta: { field: "RBCT1CER" } },
      { ticker: "JPM", dataset: "bank", kind: "series", title: "CET1 ratio", value: 15.2, meta: { field: "RBCT1CER" } },
      { ticker: "AAPL", dataset: "ownership", kind: "event", meta: { filers: ["Vanguard"] } },
      { ticker: "ZZZZ", dataset: "fda", kind: "event", meta: { kind: "drug recall", firm: "Zzzz Inc." } },
      { ticker: "ZZZZ", dataset: "events", kind: "event", meta: {} },
    ];
    const kept = screenAltRows(rows, keysOf);
    const byDataset = (d: string, t?: string) => kept.filter((r) => r.dataset === d && (!t || r.ticker === t));
    expect(byDataset("contracts", "AAPL")).toHaveLength(0);
    expect(byDataset("contracts", "BA").map((r) => (r.meta as { recipient: string }).recipient)).toEqual(["THE BOEING COMPANY"]);
    // 20 distinct firm names stored under KO: 13 bottlers and look-alikes go, 7 spellings of The Coca-Cola Company stay
    expect(FDA_FIRMS.filter((r) => r.ticker === "KO")).toHaveLength(20);
    expect(byDataset("fda", "KO")).toHaveLength(7);
    expect(byDataset("bank").map((r) => r.value)).toEqual([15.2]);
    expect(byDataset("ownership")).toHaveLength(1);
    // a company the app does not know: rows that need its identity are dropped, others pass
    expect(kept.filter((r) => r.ticker === "ZZZZ").map((r) => r.dataset)).toEqual(["events"]);
  });

  it("adds the columns it needs to a reader's select list", () => {
    expect(withScreenColumns("dataset,date,title,value,unit,source_url")).toBe("dataset,date,title,value,unit,source_url,ticker,kind,meta");
    expect(withScreenColumns("*")).toBe("*");
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
