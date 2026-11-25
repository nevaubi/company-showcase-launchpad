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
      givenUpList: [],
      outOfRange: 0,
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
      givenUpList: ["0000000001-24-000002"],
      outOfRange: 0,
    });
  });

  it("retries only the filings the scheduled job set aside for size, even when skips come first", () => {
    // Production, 25 Nov: a filing skipped for "no EX-102 asset data file" was read again on every pass;
    // with --max-filings=3, three such skips ahead of the listed filings would stop the CIK for good.
    const size = "asset file of 412000000 bytes is over the scheduled run's limit; store it with scripts/abs-ee.ts load --retry-skipped";
    const states = [
      f("0000000001-26-000001", "2026-07-02", "skipped", { detail: "no EX-102 asset data file" }),
      f("0000000001-26-000002", "2026-07-03", "skipped", { detail: "unsupported" }),
      f("0000000001-26-000003", "2026-07-04", "skipped", { detail: "the header does not establish one issuing entity" }),
      f("0000000001-26-000004", "2026-07-05", "skipped", { detail: size }),
      f("0000000001-26-000005", "2026-07-06", "skipped"),
      f("0000000001-26-000006", "2026-07-07", "listed"),
      f("0000000001-26-000007", "2026-07-08", "listed"),
    ];
    expect(planLoads(states, { ...o, maxFilings: 3, retrySkipped: true })).toMatchObject({
      todo: ["0000000001-26-000004", "0000000001-26-000006", "0000000001-26-000007"],
      left: 0,
      skipped: 4,
    });
    // without the option no skip is read again
    expect(planLoads(states, { ...o, maxFilings: 3 }).todo).toEqual(["0000000001-26-000006", "0000000001-26-000007"]);
  });

  it("with retryFailed plans only the filings given up, so it never meets the worker's own runs", () => {
    const states = [
      f("0001104659-26-083795", "2026-07-15", "failed", { attempts: 3, detail: "SEC EDGAR responded 504" }),
      f("0001104659-26-083796", "2026-07-16", "listed"),
      f("0001104659-26-083797", "2026-07-17", "failed", { attempts: 1 }),
      f("0001104659-26-083798", "2026-07-18", "loaded", { parser: "abs-0" }),
    ];
    expect(planLoads(states, { ...o, retryFailed: true, reparse: true, retrySkipped: true })).toMatchObject({
      todo: ["0001104659-26-083795"],
      left: 0,
      givenUp: 1,
      givenUpList: ["0001104659-26-083795"],
    });
    expect(planLoads(states, o).todo).toEqual(["0001104659-26-083796", "0001104659-26-083797"]);
  });

  it("counts filings outside the range apart: listed, but no backlog of these runs", () => {
    // 10,277 of 10,582 listed filings were older than the watch's from date on 25 Nov
    const states = [
      f("0000000001-18-000001", "2018-05-01", "listed"),
      f("0000000001-18-000002", "2018-06-01", "loaded"),
      f("0000000001-19-000001", "2019-01-01", "failed", { attempts: 3 }),
      f("0000000001-26-000001", "2026-07-02", "listed"),
    ];
    expect(planLoads(states, { ...o, from: "2026-07-01" })).toMatchObject({ todo: ["0000000001-26-000001"], left: 0, outOfRange: 2, givenUp: 0 });
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
