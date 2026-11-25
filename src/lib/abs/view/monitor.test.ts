import { describe, expect, it } from "vitest";
import {
  filterRows,
  groupShares,
  monitorModel,
  nextSort,
  parseSort,
  sortRows,
  type MonitorRow,
} from "./monitor";
import { shareOf } from "./figures";
import type { MonitorPayload } from "./types";
import autoLoan from "@/test/fixtures/abs-view/monitor_auto_loan.json";
import autoLease from "@/test/fixtures/abs-view/monitor_auto_lease.json";
import cmbs from "@/test/fixtures/abs-view/monitor_cmbs.json";

const model = (p: unknown) => monitorModel(p as MonitorPayload);

describe("auto monitor rows from real filings", () => {
  const m = model(autoLoan);
  const worldOmni = m.rows.find((r) => r.dealId === "0002140699")!;

  it("derives the 30-plus and 60-plus shares with their numerator and denominator", () => {
    const l = worldOmni.latest!;
    // World Omni Select Auto Trust 2026-A, records of 30 Sep 2026 (0001104659-26-119913)
    const end = 636271119.85;
    expect(l.end!.value).toBeCloseTo(end, 2);
    expect(l.due30!.numerator).toBeCloseTo(26559596.82 + 7596530.23 + 2283973.39, 2);
    expect(l.due60!.numerator).toBeCloseTo(7596530.23 + 2283973.39, 2);
    expect(l.due30!.denominator).toBeCloseTo(end, 2);
    expect(l.due60!.value).toBeCloseTo((7596530.23 + 2283973.39) / end, 10);
    expect(l.due60!.buckets).toEqual(["60 to 89 days", "90 to 119 days"]);
    expect(l.due60!.accession).toBe("0001104659-26-119913");
  });

  it("keeps a status nobody stated out of every numerator", () => {
    expect(worldOmni.latest!.unstated!.amount).toBe(0);
    const s = shareOf({ "(blank)": "100", unreadable: "50" }, "150", ["60 to 89 days"], "x");
    expect(s.value).toBeNull();
    expect(s.numerator).toBeNull();
  });

  it("states the change against the previous stored period with both period ends", () => {
    expect(worldOmni.trend.map((t) => t.recordsEnd)).toEqual(["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"]);
    const c = worldOmni.change!;
    expect(c.from).toBe("2026-08-31");
    expect(c.to).toBe("2026-09-30");
    expect(c.days).toBe(30);
    const [prev, last] = worldOmni.trend.slice(-2);
    expect(c.value).toBeCloseTo(last.share! - prev.share!, 12);
  });

  it("gives a deal with one filing no change", () => {
    const porsche = m.rows.find((r) => r.dealId === "0002149768")!;
    expect(porsche.trend).toHaveLength(1);
    expect(porsche.change).toBeNull();
    expect(porsche.periods).toBe(1);
  });

  it("reads lease files by their end securitization value", () => {
    const lease = model(autoLease).rows[0];
    expect(lease.latest!.end!.value).toBeGreaterThan(0);
    expect(lease.latest!.due60!.buckets).toEqual(["60 to 89 days", "90 to 119 days", "120 days or more"]);
    expect(lease.latest!.recoveries).toBeNull();
  });
});

describe("commercial mortgage monitor rows from real filings", () => {
  const m = model(cmbs);
  it("splits the scheduled end balance by payment status group, matured balloons apart", () => {
    const dbgs = m.rows.find((r) => r.dealId === "0001752363")!;
    const g = Object.fromEntries(dbgs.latest!.groups!.map((x) => [x.key, x]));
    const total = 888613990.93 + 51646746.26;
    expect(g.current.value).toBeCloseTo(888613990.93 / total, 12);
    expect(g.due30.value).toBeCloseTo(51646746.26 / total, 12);
    expect(g.due30.loans).toBe(1);
    expect(g.matured_performing.value).toBe(0);
    expect(g.unstated.loans).toBe(6);
    expect(dbgs.trend.length).toBe(13);
  });
  it("keeps a deal whose newest filing is offering-stage in the monitor by its monthly filing", () => {
    const axdb = m.rows.find((r) => r.dealId === "0002158812")!;
    expect(axdb.latest!.recordsEnd).toBe("2026-10-11");
    expect(axdb.offering!.recordsAfterFiling).toBe(true);
    expect(axdb.review).toBe(true);
  });
  it("reads no group from an empty split", () => {
    expect(groupShares({}, "100", "x").every((g) => g.value == null)).toBe(true);
  });
});

describe("sort and filter", () => {
  const rows = model(autoLoan).rows;
  it("puts the worst 60-plus share first and rows without the figure last", () => {
    const sorted = sortRows(rows, parseSort("auto_loan", undefined));
    const shares = sorted.map((r) => r.latest?.due60?.value ?? null);
    const known = shares.filter((s): s is number => s != null);
    expect(known).toEqual([...known].sort((a, b) => b - a));
  });
  it("reads an unknown sort as the family default and toggles a column", () => {
    expect(parseSort("cmbs", "score:desc")).toEqual({ key: "due30", dir: "desc" });
    expect(nextSort({ key: "due60", dir: "desc" }, "due60")).toEqual({ key: "due60", dir: "asc" });
    expect(nextSort({ key: "due60", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
  it("filters by name, CIK or deal id, case ignored", () => {
    expect(filterRows(rows, "world omni").map((r: MonitorRow) => r.dealId)).toEqual(["0002140699"]);
    expect(filterRows(rows, "2149768").map((r: MonitorRow) => r.dealId)).toEqual(["0002149768"]);
    expect(filterRows(rows, "  ")).toHaveLength(rows.length);
  });
});
