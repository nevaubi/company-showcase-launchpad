import { describe, expect, it } from "vitest";
import { checkDue, planRemedies, REMEDY, REMEDY_KEYS } from "./remediation";
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
  it("at most once per 6 h per dataset", () => {
    expect(planRemedies([{ key: "partner_mirror" }], new Map([["partner_mirror", s(2)]]), true, NOW)[0]).toMatchObject({ apply: false, receipt: false });
    expect(planRemedies([{ key: "partner_mirror" }], new Map([["partner_mirror", s(7)]]), true, NOW)[0]).toMatchObject({ apply: true });
  });
  it("AI remedies wait for a healthy route but still record the check", () => {
    const [x] = planRemedies([{ key: "supply_signals" }], new Map(), false, NOW);
    expect(x).toMatchObject({ apply: false, receipt: true });
    expect(planRemedies([{ key: "ir_label_map" }], new Map(), true, NOW)[0]).toMatchObject({ apply: true, remedy: { kind: "loop", step: "canon" } });
  });
  it("hourly gate", () => {
    expect(checkDue(null, NOW)).toBe(true);
    expect(checkDue(s(0.5), NOW)).toBe(false);
    expect(checkDue(s(1), NOW)).toBe(true);
  });
});
