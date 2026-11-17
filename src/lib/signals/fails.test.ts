import { describe, expect, it } from "vitest";
import { eventFeatures, EVENT_RULES } from "./events";
import { STRATEGY } from "./strategies";
import type { Features } from "./features";

// Weekday calendar Jan 2024 – Dec 2025.
const dates: string[] = [];
for (let t = Date.parse("2024-01-01T12:00:00Z"); t <= Date.parse("2025-12-31T12:00:00Z"); t += 864e5) {
  const d = new Date(t);
  if (d.getUTCDay() % 6) dates.push(d.toISOString().slice(0, 10));
}
const n = dates.length;
const f = { a: { c: new Float64Array(n).fill(10), start: 0 }, dv20: new Float64Array(n).fill(1_000_000), vol60: new Float64Array(n).fill(0.02) } as unknown as Features;
const bench = new Float64Array(n).fill(100);

// Steady $50K fails every half-month of 2024, then a $600K reading for the first half of 2025.
const fails: { end: string; value: number }[] = [];
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, "0");
  fails.push({ end: `2024-${mm}-15`, value: 50_000 });
  fails.push({ end: new Date(Date.UTC(2024, m, 0)).toISOString().slice(0, 10), value: 50_000 });
}
fails.push({ end: "2025-01-15", value: 600_000 });

describe("fails-to-deliver feature", () => {
  const ev = eventFeatures(dates, f, bench, { earnings: [], buys: [], short: [], fails });
  const at = (d: string) => dates.indexOf(d);

  it("uses a reading only once the SEC has published it", () => {
    const lagged = new Date(Date.parse("2025-01-15T00:00:00Z") + EVENT_RULES.failsLagDays * 864e5).toISOString().slice(0, 10); // 2025-01-31
    expect(ev.failsDV[at("2025-01-30")]).toBeCloseTo(0.05); // still the Dec 2024 reading
    expect(ev.failsNew[at(lagged)]).toBe(1);
    expect(ev.failsDV[at(lagged)]).toBeCloseTo(0.6);
    expect(ev.failsX[at(lagged)]).toBeCloseTo(12);
  });

  it("fires a short only on the publication bar of a large, unusual reading", () => {
    const fire = STRATEGY.fails.fire!;
    const fev = { ...f, ev } as Features;
    expect(fire(fev, at("2025-01-31"))).toBe(-1);
    expect(fire(fev, at("2025-02-03"))).toBe(0); // same reading, not new
    expect(fire(fev, at("2024-12-31"))).toBe(0); // ordinary reading
  });

  it("drops a stock whose fails stopped being reported", () => {
    expect(Number.isNaN(ev.failsDV[at("2025-03-31")])).toBe(true);
  });
});
