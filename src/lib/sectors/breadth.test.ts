import { describe, expect, it } from "vitest";
import { annualised, freshRows, groupTape, tapeAsOf, tapeFile, tapeIndex, type MemberTape, type TapeRow } from "./breadth";
import { readAllPages, singleFlight } from "./breadth.read";

const T = (tk: string, p: Partial<MemberTape> = {}): MemberTape => ({ tk, vol60: null, above200: null, near_high: null, ...p });
const R = (ticker: string, end_date: string, p: Partial<TapeRow> = {}): TapeRow => ({ ticker, end_date, vol60: 0.02, above200: true, near_high: false, ...p });
const fmt = (d: string) => d;

describe("member tape", () => {
  it("drops rows a week older than the newest session", () => {
    const f = freshRows([{ end_date: "2026-11-20" }, { end_date: "2026-11-13" }, { end_date: "2026-11-12" }]);
    expect(f.asOf).toBe("2026-11-20");
    expect(f.rows.map((r) => r.end_date)).toEqual(["2026-11-20", "2026-11-13"]);
  });
  it("counts how many rows describe the newest session", () => {
    // the daily job is part-way through: two rows rewritten for the 23rd, two still at the 20th, one stale
    const f = tapeFile([R("A", "2026-11-23"), R("B", "2026-11-23"), R("C", "2026-11-20"), R("D", "2026-11-20"), R("OLD", "2026-10-01")]);
    expect(f.asOf).toBe("2026-11-23");
    expect(f.atAsOf).toBe(2);
    expect(f.olderAsOf).toBe("2026-11-20");
    expect(f.rows.map((r) => r.tk)).toEqual(["A", "B", "C", "D"]);
    expect(tapeAsOf(f, fmt)).toBe("as of 2026-11-23 for 2 of 4 companies, 2026-11-20 or earlier for the rest");
  });
  it("names one date only when every row is at it", () => {
    const f = tapeFile([R("A", "2026-11-20"), R("B", "2026-11-20")]);
    expect(f.olderAsOf).toBeNull();
    expect(tapeAsOf(f, fmt)).toBe("as of 2026-11-20");
    expect(tapeAsOf(tapeFile([]), fmt)).toBe("");
  });
  it("carries only the fields the pages show, rounded", () => {
    const f = tapeFile([R("A", "2026-11-20", { vol60: 0.0123456789, above200: false, near_high: true })]);
    expect(f.rows[0]).toEqual({ tk: "A", vol60: 0.01235, above200: false, near_high: true });
  });
  it("rolls a group up from its members' own rows and counts those without one", () => {
    const idx = tapeIndex([
      T("AAA", { above200: true, near_high: false, vol60: 0.02 }),
      T("BBB", { above200: false, near_high: true, vol60: 0.01 }),
      T("CCC", { above200: null }),
    ]);
    const g = groupTape(["AAA", "BBB", "CCC", "ZZZ"], idx);
    expect(g.members).toBe(4);
    expect(g.known).toBe(3);
    expect(g.noRow).toBe(1); // ZZZ
    expect(g.above200).toMatchObject({ share: 0.5, hits: 1, known: 2 }); // CCC's flag is unknown
    expect(g.nearHigh).toMatchObject({ hits: 1, known: 2 });
    expect(g.vol).toBeCloseTo(0.015 * Math.sqrt(252)); // median of 0.01 and 0.02, annualised
    expect(g.volKnown).toBe(2);
    expect(annualised(null)).toBeNull();
  });
});

describe("reading every page", () => {
  const table = Array.from({ length: 1777 }, (_, i) => i);
  const server = (cap: number, withTotal = true) => {
    const calls: [number, number][] = [];
    const page = async (from: number, to: number) => {
      calls.push([from, to]);
      return { rows: table.slice(from, Math.min(to + 1, from + cap)), total: withTotal ? table.length : null };
    };
    return { calls, page };
  };
  it("reads 1,777 rows in two pages of 1,000", async () => {
    const s = server(1000);
    expect(await readAllPages(s.page)).toHaveLength(1777);
    expect(s.calls).toEqual([[0, 999], [1000, 1999]]);
  });
  it("still reads everything when the server caps a page at 400 rows", async () => {
    const s = server(400);
    const rows = await readAllPages(s.page);
    expect(rows).toEqual(table);
    expect(s.calls.map((c) => c[0])).toEqual([0, 400, 800, 1200, 1600]);
  });
  it("reads to the first empty page when the server reports no total", async () => {
    const s = server(1000, false);
    expect(await readAllPages(s.page)).toHaveLength(1777);
    expect(s.calls).toHaveLength(3); // the third page is empty
  });
  it("refuses to pass a short read for a whole one", async () => {
    const page = async (from: number) => ({ rows: from === 0 ? table.slice(0, 1000) : [], total: 1777 });
    await expect(readAllPages(page)).rejects.toThrow("partial read: 1000 of 1777 rows");
  });
});

describe("one shared read", () => {
  it("keeps a result for its lifetime, then reads again", async () => {
    let t = 0;
    let reads = 0;
    const get = singleFlight(900, async () => ++reads, () => t);
    expect(await get()).toBe(1);
    t = 899;
    expect(await get()).toBe(1);
    t = 900;
    expect(await get()).toBe(2);
  });
  it("shares one read between calls that arrive together", async () => {
    let reads = 0;
    let done: (v: number) => void = () => {};
    const get = singleFlight(
      900,
      () =>
        new Promise<number>((res) => {
          reads += 1;
          done = res;
        }),
    );
    const a = get();
    const b = get();
    done(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(reads).toBe(1);
  });
  it("does not keep a failure", async () => {
    let reads = 0;
    const get = singleFlight(900, async () => {
      if (++reads === 1) throw new Error("down");
      return "rows";
    });
    await expect(get()).rejects.toThrow("down");
    expect(await get()).toBe("rows");
  });
});
