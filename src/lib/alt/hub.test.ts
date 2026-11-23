import { describe, expect, it } from "vitest";
import { confirmSeries, rankUnusual, seriesCandidates, SERIES_WATCH, unusualFromBuckets } from "./hub";
import type { CompanyAltRow } from "./company";

const b = (ticker: string, dataset: string, h: number[]) => h.map((n, i) => ({ ticker, dataset, bucket: h.length - 1 - i, n, last_date: i === h.length - 1 ? "2026-11-20" : null })).filter((x) => x.n);

describe("unusualFromBuckets", () => {
  it("ranks real spikes and counts new coverage apart", () => {
    // MSFT regulatory, real buckets 23 Nov 2026: 0,3,7,3,13,21,15,16 then 70
    const msft = b("MSFT", "regulatory", [0, 3, 7, 3, 13, 21, 15, 16, 70]);
    // AAOI 8-K items only began to be collected: 0 × 8 then 6
    const aaoi = b("AAOI", "events", [0, 0, 0, 0, 0, 0, 0, 0, 6]);
    const flat = b("KO", "events", [3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const { items, newCoverage } = unusualFromBuckets([...msft, ...aaoi, ...flat]);
    expect(newCoverage).toBe(1);
    expect(items.map((i) => i.ticker)).toEqual(["MSFT"]);
    // prior seven windows from the first non-empty: mean 78/7 = 11.1
    expect(items[0].text).toBe("70 Federal Register documents in 90 days; normal 11.1");
  });
  it("skips trial records, which are dated by update", () => {
    expect(unusualFromBuckets(b("UTHR", "trials", [1, 1, 1, 1, 1, 1, 1, 1, 30])).items).toEqual([]);
  });
});

describe("series screens", () => {
  const ftd = SERIES_WATCH[0];
  it("pre-screens on the leaderboard ratio and size", () => {
    const leaders = [
      { ticker: "A", value: 5e6, base_median: 1e6, base_n: 24 },
      { ticker: "B", value: 2e6, base_median: 1e6, base_n: 24 },
      { ticker: "C", value: 5e5, base_median: 1e4, base_n: 24 },
    ];
    expect(seriesCandidates(leaders, ftd)).toEqual(["A"]);
  });
  it("confirms with the modified z rule", () => {
    const rows: CompanyAltRow[] = [];
    for (let i = 0; i < 24; i++) rows.push({ uid: `x${i}`, ticker: "A", dataset: "settlement", kind: "series", date: `2025-${String(1 + Math.floor(i / 2)).padStart(2, "0")}-${i % 2 ? "28" : "15"}`, title: ftd.title, value: 1e6 * (1 + (i % 3) * 0.1), unit: "USD", meta: {}, source: "s", source_url: null });
    rows.push({ ...rows[0], uid: "last", date: "2026-01-15", value: 3e7 });
    const out = confirmSeries(rows, ftd, "2026-11-23");
    expect(out).toHaveLength(1);
    expect(rankUnusual(out)[0].direction).toBe("up");
  });
});
