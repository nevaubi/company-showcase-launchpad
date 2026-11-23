import { describe, expect, it } from "vitest";
import { backoffRow, blockStreak, chainStatus, judgeSlice, optionsNight, type ChainResult } from "./options-run";

const blocked = (t: string, status = 403): ChainResult => ({ t, kind: "blocked", status });
const stored = (t: string): ChainResult => ({ t, kind: "stored", row: {} });

describe("options slice verdict", () => {
  it("maps statuses", () => {
    expect([200, 404, 403, 429, 500].map(chainStatus)).toEqual(["read", "none", "blocked", "blocked", "error"]);
  });
  it("two or more 403s with nothing stored need the SPY probe", () => {
    expect(judgeSlice([blocked("A"), blocked("B"), { t: "C", kind: "none", status: 404 }, { t: "D", kind: "none", status: 404 }]).needsProbe).toBe(true);
  });
  it("probe refused: blocked; probe answered: the 403s are unlisted symbols", () => {
    const r = [blocked("A"), blocked("B"), blocked("C"), blocked("D")];
    expect(judgeSlice(r, 403).outcome).toBe("blocked");
    expect(judgeSlice(r, 0).outcome).toBe("blocked");
    const ok = judgeSlice(r, 200);
    expect(ok.outcome).toBe("done");
    expect(ok.results.every((x) => x.kind === "none")).toBe(true);
  });
  it("a single 403 beside stored chains is an unlisted symbol, without a probe", () => {
    const v = judgeSlice([blocked("A"), stored("B"), stored("C"), stored("D")]);
    expect(v).toMatchObject({ outcome: "done", needsProbe: false, stored: 3 });
  });
  it("any 429 blocks the slice", () => {
    expect(judgeSlice([blocked("A", 429), stored("B"), stored("C"), stored("D")]).outcome).toBe("blocked");
  });
  it("all errors fail the slice; some errors do not", () => {
    const e = (t: string): ChainResult => ({ t, kind: "error", message: "timeout" });
    expect(judgeSlice([e("A"), e("B"), e("C"), e("D")]).outcome).toBe("failed");
    expect(judgeSlice([e("A"), stored("B")]).outcome).toBe("done");
  });
  it("backoff: 2 min doubling to 60 min, streak kept in the reason", () => {
    const now = 1_800_000_000_000;
    const mid = () => 0.5;
    expect(backoffRow(1, [403], now, mid).waitMs).toBe(120_000);
    expect(backoffRow(3, [403], now, mid).waitMs).toBe(480_000);
    expect(backoffRow(12, [429], now, () => 1).waitMs).toBe(3_600_000);
    expect(blockStreak(backoffRow(4, [403, 403, 429], now).paused_reason)).toBe(4);
    expect(backoffRow(1, [403, 403, 429], now).paused_reason).toBe("blocked: Cboe refused option chains (403 x2, 429 x1) [n=1]");
  });
  it("one options night runs from 22:00 to 05:59 UTC", () => {
    const at = (s: string) => optionsNight(Date.parse(s));
    expect(at("2026-11-19T22:00:00Z")).toBe(20261119);
    expect(at("2026-11-20T05:59:00Z")).toBe(20261119);
    expect(at("2026-11-20T22:01:00Z")).toBe(20261120);
  });
});
