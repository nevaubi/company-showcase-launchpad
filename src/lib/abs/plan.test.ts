import { describe, expect, it } from "vitest";
import { planLoads, type FilingState } from "./plan";

const f = (
  accession: string,
  filed: string,
  status: FilingState["status"],
  more: Partial<FilingState> = {},
): FilingState => ({
  accession,
  form: "ABS-EE",
  filed,
  status,
  attempts: 0,
  is_current: status === "loaded",
  parser: status === "loaded" ? "abs-1" : null,
  sha256: status === "loaded" ? "a".repeat(64) : null,
  ...more,
});
const o = { parser: "abs-1", maxFilings: 10, maxAttempts: 3 };

describe("abs run plan", () => {
  it("stores oldest first, whatever order the list arrives in, and an amendment after the filing it amends", () => {
    const states = [
      f("0000000001-24-000009", "2024-03-01", "listed"),
      f("0000000001-24-000002", "2024-01-15", "listed"),
      f("0000000001-24-000005", "2024-01-15", "listed", { form: "ABS-EE/A" }),
      f("0000000001-24-000001", "2024-02-01", "listed"),
    ];
    expect(planLoads(states, o).todo).toEqual([
      "0000000001-24-000002",
      "0000000001-24-000005",
      "0000000001-24-000001",
      "0000000001-24-000009",
    ]);
  });

  it("takes a bounded batch and says how much is left", () => {
    const states = Array.from({ length: 7 }, (_, i) =>
      f(`0000000001-24-00000${i}`, `2024-0${i + 1}-01`, "listed"),
    );
    const p = planLoads(states, { ...o, maxFilings: 3 });
    expect(p.todo).toEqual([
      "0000000001-24-000000",
      "0000000001-24-000001",
      "0000000001-24-000002",
    ]);
    expect(p.left).toBe(4);
    expect(planLoads(states, { ...o, maxFilings: 0 })).toMatchObject({ todo: [], left: 7 });
  });

  it("plans nothing for what this reader already stored: running again is a no-op", () => {
    const states = [
      f("0000000001-24-000001", "2024-01-01", "loaded"),
      f("0000000001-24-000002", "2024-02-01", "loaded"),
    ];
    expect(planLoads(states, o)).toEqual({
      todo: [],
      left: 0,
      loaded: 2,
      stale: 0,
      skipped: 0,
      givenUp: 0,
    });
  });

  it("resumes after a cut-off run: stored filings stay, the rest is planned", () => {
    const states = [
      f("0000000001-24-000001", "2024-01-01", "loaded"),
      f("0000000001-24-000002", "2024-02-01", "listed"),
      f("0000000001-24-000003", "2024-03-01", "listed"),
    ];
    expect(planLoads(states, o)).toMatchObject({
      todo: ["0000000001-24-000002", "0000000001-24-000003"],
      loaded: 1,
    });
  });

  it("retries a failed filing until the limit, then leaves it for a person", () => {
    const states = [
      f("0000000001-24-000001", "2024-01-01", "failed", { attempts: 2 }),
      f("0000000001-24-000002", "2024-02-01", "failed", { attempts: 3 }),
      f("0000000001-24-000003", "2024-03-01", "skipped"),
    ];
    expect(planLoads(states, o)).toEqual({
      todo: ["0000000001-24-000001"],
      left: 0,
      loaded: 0,
      stale: 0,
      skipped: 1,
      givenUp: 1,
    });
  });

  it("stores again what an older reader stored only when asked", () => {
    const states = [
      f("0000000001-24-000001", "2024-01-01", "loaded", { parser: "abs-0" }),
      f("0000000001-24-000002", "2024-02-01", "loaded"),
    ];
    expect(planLoads(states, o)).toMatchObject({ todo: [], loaded: 2, stale: 1 });
    expect(planLoads(states, { ...o, reparse: true })).toMatchObject({
      todo: ["0000000001-24-000001"],
      loaded: 2,
      stale: 1,
    });
  });

  it("keeps to a filing-date range", () => {
    const states = [
      f("0000000001-24-000001", "2024-01-01", "listed"),
      f("0000000001-24-000002", "2024-02-01", "listed"),
      f("0000000001-24-000003", "2024-03-01", "listed"),
    ];
    expect(planLoads(states, { ...o, from: "2024-02-01", to: "2024-02-29" }).todo).toEqual([
      "0000000001-24-000002",
    ]);
    expect(planLoads(states, { ...o, from: "2024-02-01" }).todo).toEqual([
      "0000000001-24-000002",
      "0000000001-24-000003",
    ]);
  });
});
