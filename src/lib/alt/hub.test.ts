import { describe, expect, it } from "vitest";
import { bucketCandidates, confirmCounts, confirmSeries, rangeCandidates, rankUnusual, type UnusualItem } from "./hub";
import { riseFlag, type CompanyAltRow } from "./company";
import { RANGE_RULES, addDays } from "./history";
import type { EventBucket } from "./screen";

const TODAY = "2026-11-23";
/** Buckets as `alt_event_buckets` returns them: bucket 0 is the latest 90 days; oldest first in `h`. */
const b = (ticker: string, dataset: string, h: number[]): EventBucket[] => h.map((n, i) => ({ ticker, dataset, bucket: h.length - 1 - i, n, last_date: null })).filter((x) => x.n);
const row = (ticker: string, dataset: string, uid: string, date: string, extra: Partial<CompanyAltRow> = {}): CompanyAltRow => ({ uid, ticker, dataset, kind: "event", date, title: "t", value: null, unit: null, meta: {}, source: "s", source_url: `https://example.org/${uid}`, ...extra });

describe("bucketCandidates (pre-screen on stored rows)", () => {
  it("passes a jump in a watched dataset and nothing else", () => {
    const cands = bucketCandidates([
      // the review's showcase: MSFT Federal Register mentions, a capped list, are never counted
      ...b("MSFT", "regulatory", [0, 3, 7, 3, 13, 21, 15, 16, 70]),
      // award actions are the newest 300 per recipient: never counted
      ...b("ACN", "contracts", [0, 0, 0, 0, 0, 0, 0, 1, 65]),
      // collection only began: nothing to compare with
      ...b("AAOI", "events", [0, 0, 0, 0, 0, 0, 0, 0, 6]),
      ...b("KO", "events", [3, 3, 3, 3, 3, 3, 3, 3, 3]),
      ...b("JUMP", "events", [2, 2, 2, 2, 2, 2, 2, 2, 12]),
      ...b("UTHR", "trials", [1, 1, 1, 1, 1, 1, 1, 1, 30]),
    ]);
    expect(cands).toEqual([{ ticker: "JUMP", dataset: "events" }]);
  });

  it("keeps every pair the rule flags (seeded simulation of 3,000 single-item histories)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const poisson = (l: number) => { let k = 0, p = Math.exp(-l), s = p; const u = rand(); while (u > s && k < 200) { k++; p *= l / k; s += p; } return k; };
    let flagged = 0, missed = 0;
    for (let c = 0; c < 3000; c++) {
      const rate = 0.3 + rand() * 6;
      const burst = rand() < 0.3 ? 1 + rand() * 6 : 1;
      const h = Array.from({ length: 9 }, (_, i) => poisson(i === 8 ? rate * burst : rate));
      const rows: CompanyAltRow[] = [row("T", "ownership", "own:T:start", "2018-01-01")];
      h.forEach((n, i) => { for (let k = 0; k < n; k++) rows.push(row("T", "ownership", `own:T:${i}-${k}`, addDays(TODAY, -(8 - i) * 90 - 1 - (k % 80)))); });
      if (!riseFlag("ownership", rows, TODAY)) continue;
      flagged++;
      if (!bucketCandidates(b("T", "ownership", h)).length) missed++;
    }
    expect(flagged).toBeGreaterThan(20);
    expect(missed).toBe(0);
  });
});

describe("confirmCounts (the tab's rule on candidates' rows)", () => {
  const history = (ticker: string, latest: { accn: string; items: number }[]) => [
    row(ticker, "events", `8k:${ticker}:0000000000-15-000001:1.01`, "2015-03-01", { meta: { item: "1.01" } }),
    ...Array.from({ length: 8 }, (_, w) => row(ticker, "events", `8k:${ticker}:old-${w}:5.02`, addDays(TODAY, -(w + 1) * 90 - 10), { meta: { item: "5.02" } })),
    ...latest.flatMap((f, i) => Array.from({ length: f.items }, (_, k) => row(ticker, "events", `8k:${ticker}:${f.accn}:${k}.0${k}`, addDays(TODAY, -5 - i * 7), { meta: { item: `${k}.0${k}` } }))),
  ];
  it("flags eight filings after one a quarter (p = 0.00013), not six (p = 0.0026)", () => {
    const out = confirmCounts("events", history("A", Array.from({ length: 8 }, (_, i) => ({ accn: `new-${i}`, items: 1 }))), TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ticker: "A", kind: "rise", direction: "up" });
    expect(out[0].text).toBe("8 8-K filings in the last 90 days; at most 1 in any of the 8 earlier 90-day windows (mean 1.0)");
    expect(out[0].figure.value).toBe("8");
    expect(confirmCounts("events", history("A6", Array.from({ length: 6 }, (_, i) => ({ accn: `six-${i}`, items: 1 }))), TODAY)).toEqual([]);
  });
  it("does not flag one filing with many items", () => {
    expect(confirmCounts("events", history("B", [{ accn: "big", items: 9 }]), TODAY)).toEqual([]);
  });
});

describe("series: pre-screen and confirm on what the queries return", () => {
  const ftd = RANGE_RULES.find((r) => r.dataset === "settlement")!;
  const views = RANGE_RULES.find((r) => r.dataset === "attention")!;
  it("passes only readings that could clear the range, plus those it cannot judge", () => {
    const leaders = [
      { ticker: "A", date: "2026-10-31", value: 6e6, base_median: 1e6, base_n: 22 },
      { ticker: "B", date: "2026-10-31", value: 4e6, base_median: 1e6, base_n: 22 },
      { ticker: "C", date: "2026-10-31", value: 4e6, base_median: null, base_n: null },
    ];
    expect(rangeCandidates(leaders, ftd, TODAY)).toEqual(["A"]);
    const att = [
      { ticker: "IBM", date: "2026-11-01", value: 1_532, base_median: 60_000, base_n: 12 },
      { ticker: "KO", date: "2026-10-01", value: 60_000, base_median: 58_000, base_n: 12 },
    ];
    expect(rangeCandidates(att, views, TODAY)).toEqual(["IBM"]);
    const nco = RANGE_RULES.find((r) => r.quarterOnly)!;
    expect(rangeCandidates([{ ticker: "WAL", date: "2026-06-30", value: 0.2, base_median: 0.5, base_n: 4 }], nco, TODAY)).toEqual(["WAL"]);
  });
  it("ignores a month in progress and tests the last finished one", () => {
    const months = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2024, 9 + i, 1)).toISOString().slice(0, 10));
    // rows come back ordered by uid, not by date
    const rows: CompanyAltRow[] = months.map((d, i) => ({ ...row("IBM", "attention", `att:IBM:${String(99 - i)}`, d), kind: "series", title: views.title, value: i === 24 ? 70_000 : 40_000 + i * 100 }));
    rows.push({ ...rows[0], uid: "att:IBM:00", date: "2026-11-01", value: 1_532 });
    const out = confirmSeries(rows, views, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-01");
    expect(out[0].kind).toBe("range");
  });
  it("does not test a stale reading: a half-month without fails has no row", () => {
    const rows: CompanyAltRow[] = Array.from({ length: 14 }, (_, i) => ({ ...row("X", "settlement", `ftd:${i}`, addDays("2025-10-15", i * 15)), kind: "series", title: ftd.title, value: 1e6 }));
    rows.push({ ...rows[0], uid: "ftd:last", date: "2026-10-15", value: 9e7 });
    // newest row 39 days old on 23 Nov: the 31 Oct half-month had no fails, so nothing is "now"
    expect(confirmSeries(rows, ftd, TODAY)).toEqual([]);
    expect(confirmSeries(rows, ftd, "2026-11-10")).toHaveLength(1);
  });
});

describe("series: the hub reads as far back as the tab's rule looks", () => {
  // the latest reading may be up to currentDays old and the rule compares the `days` before it; a
  // rule on single quarters also needs the quarter before the oldest one to undo year-to-date rates
  it.each(RANGE_RULES.map((r) => [r.title, r] as const))("%s", (_t, r) => {
    expect(r.readDays).toBeGreaterThanOrEqual(r.days + r.currentDays + (r.quarterOnly ? 92 : 0));
  });
});

describe("rankUnusual", () => {
  it("puts rises first and ranks each kind by its own strength", () => {
    const it = (ticker: string, kind: UnusualItem["kind"], strength: number): UnusualItem => ({ ticker, dataset: "events", kind, direction: "up", text: "", strength, date: null, rule: "", figure: { label: "", value: "", rows: [] } });
    expect(rankUnusual([it("R1", "range", 9), it("C1", "rise", 3.2), it("C2", "rise", 5), it("R2", "range", 2)]).map((x) => x.ticker)).toEqual(["C2", "C1", "R1", "R2"]);
  });
});
