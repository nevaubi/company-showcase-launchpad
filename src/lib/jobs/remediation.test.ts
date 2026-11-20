import { describe, expect, it } from "vitest";
import { checkDue, episodeOf, planRemedies, readReceipts, REMEDY, REMEDY_KEYS } from "./remediation";
import { DATA_CADENCE } from "./data-freshness";

const NOW = Date.parse("2026-11-20T15:00:00Z");
const s = (h: number) => Math.floor((NOW - h * 3600_000) / 1000);

describe("freshness remediation", () => {
  it("every remedy names a real freshness key", () => {
    const keys = new Set(DATA_CADENCE.map((c) => c.key));
    for (const k of Object.keys(REMEDY)) expect(keys.has(k)).toBe(true);
    expect(REMEDY_KEYS.has("worker_heartbeat")).toBe(false);
  });
  it("applies a loop remedy once per step and writes receipts", () => {
    const a = planRemedies([{ key: "alt_ownership" }, { key: "alt_contracts" }, { key: "market_bars" }], new Map(), true, NOW);
    expect(a.map((x) => [x.key, x.apply, x.receipt])).toEqual([
      ["alt_ownership", true, true],
      ["alt_contracts", false, true],
    ]);
  });
  it("asks once per staleness episode, however long the dataset stays stale; again only after new data went stale", () => {
    const stale = [{ key: "partner_mirror", newest: "2026-11-10T00:00:00Z" }];
    const asked = new Map([["partner_mirror", { at: s(200), episode: episodeOf("2026-11-10T00:00:00Z") }]]);
    expect(planRemedies(stale, asked, true, NOW)[0]).toMatchObject({ apply: false, receipt: false });
    expect(planRemedies([{ key: "partner_mirror", newest: "2026-11-12T00:00:00Z" }], asked, true, NOW)[0]).toMatchObject({ apply: true, receipt: true });
  });
  it("AI remedies wait for a healthy route and write nothing meanwhile, so the one request goes out when it is healthy", () => {
    const [x] = planRemedies([{ key: "supply_signals", newest: "2026-11-05T00:00:00Z" }], new Map(), false, NOW);
    expect(x).toMatchObject({ apply: false, receipt: false });
    expect(planRemedies([{ key: "supply_signals", newest: "2026-11-05T00:00:00Z" }], new Map(), true, NOW)[0]).toMatchObject({ apply: true, remedy: { kind: "intel" } });
    expect(planRemedies([{ key: "ir_label_map" }], new Map(), true, NOW)[0]).toMatchObject({ apply: true, remedy: { kind: "loop", step: "canon" } });
  });
  it("reads receipts with and without an episode", () => {
    const r = readReceipts([{ job: "remedy:a", cursor: 5, paused_reason: "episode:none" }, { job: "remedy:b", cursor: 6, paused_reason: null }, { job: "x", cursor: 1, paused_reason: null }]);
    expect([...r]).toEqual([["a", { at: 5, episode: "episode:none" }], ["b", { at: 6, episode: null }]]);
  });
  it("hourly gate", () => {
    expect(checkDue(null, NOW)).toBe(true);
    expect(checkDue(s(0.5), NOW)).toBe(false);
    expect(checkDue(s(1), NOW)).toBe(true);
  });
});
