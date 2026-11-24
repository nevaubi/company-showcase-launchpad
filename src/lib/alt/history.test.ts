import { describe, expect, it } from "vitest";
import { countSupport, eventHistory, inProgress, isCurrent, newestFinished, trailingCount, wholeWindows, EVENT_STREAMS, RANGE_RULES, type HistoryRow } from "./history";

const TODAY = "2026-11-23";
const ev = (dataset: string, uid: string, date: string, meta: Record<string, unknown> = {}): HistoryRow => ({ uid, dataset, kind: "event", date, meta });
/** 8-K items: `n` items of one filing on `date`. */
const eightK = (accn: string, date: string, n = 1) => Array.from({ length: n }, (_, i) => ev("events", `8k:X:${accn}:${i}.0${i}`, date, { item: `${i}.0${i}` }));

describe("event streams: what is countable", () => {
  it("counts 8-K filings, not items", () => {
    const s = countSupport("events", [...eightK("a", "2026-10-01", 3), ...eightK("b", "2026-09-01"), ...eightK("c", "2019-01-01")]);
    const t = trailingCount(s, TODAY);
    expect(t.whole).toBe(true);
    expect(t.units.map((u) => u.rows.length)).toEqual([3, 1]);
  });
  it("labels a history that starts inside the window as 'since', with no comparison", () => {
    // the scheduled reader reached this company first: nothing stored before September 2026
    const s = countSupport("events", [...eightK("a", "2026-09-08"), ...eightK("b", "2026-10-15", 2)]);
    const t = trailingCount(s, TODAY);
    expect(t).toMatchObject({ whole: false, span: "since Sep 8, 2026", before: null });
    expect(t.units).toHaveLength(2);
  });
  it("compares with the year before only when the history covers it", () => {
    const rows = [...eightK("a", "2026-06-01"), ...eightK("b", "2025-06-01"), ...eightK("c", "2025-03-01")];
    expect(trailingCount(countSupport("events", rows), TODAY).before).toBeNull();
    const longer = [...rows, ...eightK("d", "2024-01-01")];
    expect(trailingCount(countSupport("events", longer), TODAY).before!.map((u) => u.key)).toEqual(["b", "c"]);
  });
  it("never counts Federal Register documents over time when a type holds its cap", () => {
    // 40 notices, all in the last two months: the newest 40 of a busier history
    const rows = Array.from({ length: 40 }, (_, i) => ev("regulatory", `fr:${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, { type: "Notice" }));
    const s = countSupport("regulatory", rows);
    expect(s.since).toBe("2026-10-01");
    expect(trailingCount(s, TODAY).whole).toBe(false);
    expect(EVENT_STREAMS.regulatory.every((x) => !x.watch)).toBe(true);
  });
  it("keeps award actions and the five-year award sample out of the rise rule", () => {
    expect(EVENT_STREAMS.contracts.every((x) => !x.watch)).toBe(true);
    const rows = Array.from({ length: 30 }, (_, i) => ({ ...ev("contracts", `usa:X:${i}`, "2026-10-01"), meta: { tie: "name" } }));
    expect(countSupport("contracts", rows, { streams: ["awards"] }).none).toBe(true);
  });
  it("counts a prospectus and its pricing a week apart as one offering", () => {
    const rows = [
      ev("capital", "cap:X:0001-26-1", "2026-10-26", { form: "424B5", category: "offering" }),
      ev("capital", "cap:X:0001-26-2", "2026-10-28", { form: "424B5", category: "offering" }),
      ev("capital", "cap:X:0001-26-3", "2026-10-26", { form: "S-3ASR", category: "shelf" }),
      ev("capital", "cap:X:0001-26-4", "2026-11-12", { form: "424B5", category: "offering" }),
      ev("capital", "cap:X:0001-10-5", "2010-01-01", { form: "S-8", category: "plan" }),
    ];
    const t = trailingCount(countSupport("capital", rows), TODAY);
    expect(t.units.map((u) => u.rows.length).sort()).toEqual([1, 1, 2]);
  });
  it("sets a frequent issuer's 424B2 supplements apart, and keeps an occasional one's", () => {
    const notes = (n: number) => Array.from({ length: n }, (_, i) => ev("capital", `cap:B:n${i}`, `2026-0${1 + (i % 9)}-0${1 + (i % 8)}`, { form: "424B2", category: "offering" }));
    const few = eventHistory("capital", notes(3));
    expect(few.find((h) => h.stream.id === "filings")!.rows).toHaveLength(3);
    const many = eventHistory("capital", notes(25));
    expect(many.find((h) => h.stream.id === "filings")!.rows).toHaveLength(0);
    expect(many.find((h) => h.stream.id === "supplements")!.rows).toHaveLength(25);
  });
  it("counts one FDA recall event once however many products it lists", () => {
    const rows = ["a", "b", "c"].map((p) => ev("fda", `fda:X:${p}`, "2026-06-01", { kind: "device", reason: "Sterility not assured" }));
    expect(trailingCount(countSupport("fda", rows, { streams: ["recalls"] }), TODAY).units).toHaveLength(1);
  });
});

describe("wholeWindows: only windows collected the same way", () => {
  it("drops windows before the first stored record even for sources that hold everything", () => {
    // a recent listing: 13G filings only from June 2026
    const rows = ["2026-06-26", "2026-08-01", "2026-11-05", "2026-11-06", "2026-11-16"].map((d, i) => ev("ownership", `own:X:${i}`, d));
    const w = wholeWindows(countSupport("ownership", rows, { watched: true }), TODAY);
    // only the latest window starts after June 26: no earlier window to compare with
    expect(w.counts).toEqual([3]);
  });
  it("keeps all nine windows for a long history", () => {
    const rows = [...eightK("old", "2015-01-01"), ...eightK("a", "2026-11-01"), ...eightK("b", "2026-02-01")];
    const w = wholeWindows(countSupport("events", rows, { watched: true }), TODAY);
    expect(w.counts).toHaveLength(9);
    expect(w.counts[8]).toBe(1);
    expect(w.latest.map((u) => u.key)).toEqual(["a"]);
  });
});

describe("series periods", () => {
  it("never reads the month in progress", () => {
    expect(inProgress({ dataset: "attention", date: "2026-11-01" }, TODAY)).toBe(true);
    expect(inProgress({ dataset: "attention", date: "2026-10-01" }, TODAY)).toBe(false);
    expect(newestFinished("attention", "2026-11-01", TODAY)).toBe("2026-10-01");
  });
  it("keeps a fiscal year within its reporting lag partial", () => {
    expect(inProgress({ date: "2026-09-30", meta: { fiscal_year: 2026 } }, TODAY)).toBe(true);
    expect(inProgress({ date: "2025-09-30", meta: { fiscal_year: 2025 } }, TODAY)).toBe(false);
  });
  it("judges freshness by the source's own schedule", () => {
    expect(isCurrent("tri", "2024-12-31", TODAY)).toBe(true);
    expect(isCurrent("events", "2026-10-01", TODAY)).toBe(false);
    expect(isCurrent("medicare", "2026-03-31", TODAY)).toBe(true);
  });
  it("every range rule reads at least the span it compares with", () => {
    for (const r of RANGE_RULES) expect(r.readDays).toBeGreaterThan(r.days);
  });
});
