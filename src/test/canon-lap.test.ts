import { describe, expect, it } from "vitest";
import { canonLap, staleLabelKeys } from "../../scripts/lib/canon-lap";

const now = Date.parse("2026-11-20T12:00:00Z");
describe("canon lap (review F7)", () => {
  it("keeps walking the stored lap when today's rank order differs", () => {
    const lap = { order: ["A", "B", "C", "D", "E"], startedAt: "2026-11-01T00:00:00Z" };
    // dv20 moved overnight: today's order is reversed, the lap is not
    const r = canonLap(lap, 2, ["E", "D", "C", "B", "A"], now);
    expect(r.fresh).toBe(false);
    expect(r.lap.order.slice(r.start)).toEqual(["C", "D", "E"]);
  });
  it("visits every company exactly once per lap over many days of shifting ranks", () => {
    const tickers = Array.from({ length: 23 }, (_, i) => `T${i}`);
    let stored: { order: string[]; startedAt: string } | null = null;
    let cursor = 0;
    const seen: string[] = [];
    for (let day = 0; day < 6; day++) {
      const today = [...tickers].sort((a, b) => ((a.charCodeAt(1) * 7 + day * 13) % 23) - ((b.charCodeAt(1) * 7 + day * 13) % 23) || a.localeCompare(b));
      const r = canonLap(stored, cursor, day % 2 ? today.reverse() : today, now + day * 86_400_000);
      if (r.fresh && day > 0) break;
      stored = r.lap;
      const batch = r.lap.order.slice(r.start, r.start + 5);
      seen.push(...batch);
      cursor = r.start + batch.length;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(23);
  });
  it("starts a new lap at the end, drops companies that left and appends new ones", () => {
    const lap = { order: ["A", "B", "C"], startedAt: "x" };
    expect(canonLap(lap, 3, ["C", "B", "A"], now)).toMatchObject({ fresh: true, start: 0, lap: { order: ["C", "B", "A"] } });
    const r = canonLap(lap, 2, ["C", "A", "Z"], now);
    expect(r.lap.order).toEqual(["A", "C", "Z"]);
    expect(r.lap.order[r.start]).toBe("C");
    expect(canonLap(null, 7, ["A"], now)).toMatchObject({ fresh: true, start: 0 });
  });
});

describe("label map replacement order (review F20)", () => {
  it("deletes only the keys the new map no longer has, after the upsert", () => {
    expect(staleLabelKeys(["a", "b", "c"], ["b", "c", "d"])).toEqual(["a"]);
    expect(staleLabelKeys(["a"], ["a"])).toEqual([]);
  });
  it("ir-canon upserts the new map before deleting stale keys", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("scripts/ir-canon.ts", "utf8");
    const up = src.indexOf('from("ir_label_map").upsert(');
    const del = src.indexOf('from("ir_label_map").delete().eq("ticker", ticker).in("raw_key"');
    expect(up).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(up);
  });
});
