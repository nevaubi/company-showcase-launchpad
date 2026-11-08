import { describe, expect, it } from "vitest";
import { freshnessOf, freshnessReport, SOURCES, type Run } from "./freshness";

const now = new Date("2026-11-04T15:00:00Z"); // Wednesday, market hours
const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();
const run = (job: string, min: number, ok: boolean): Run => ({ job, started_at: ago(min), finished_at: ago(min - 0.1), ok, items: 2 });
const src = (job: string) => SOURCES.find((s) => s.job === job)!;

describe("data freshness", () => {
  it("is on time within twice the cadence", () => {
    expect(freshnessOf(src("macro"), [run("macro", 19, true)], now).status).toBe("on-time");
  });
  it("is late past twice the cadence", () => {
    expect(freshnessOf(src("macro"), [run("macro", 21, true)], now).status).toBe("late");
  });
  it("is failing when the last three runs errored", () => {
    const runs = [run("sec", 1, false), run("sec", 7, false), run("sec", 13, false), run("sec", 19, true)];
    expect(freshnessOf(src("sec"), runs, now).status).toBe("failing");
  });
  it("does not flag prices outside market hours", () => {
    const sat = new Date("2026-11-07T15:00:00Z");
    const old = { job: "prices", started_at: "2026-11-06T22:50:00Z", finished_at: "2026-11-06T22:50:05Z", ok: true, items: 5 };
    expect(freshnessOf(src("prices"), [old], sat).status).toBe("on-time");
  });
  it("lists problems first", () => {
    const report = freshnessReport([run("macro", 5, true), run("sec", 60, true)], now);
    expect(report[0].status).not.toBe("on-time");
  });
});
