import { expect, it } from "vitest";
import { fiscalEpsHistory, type Snapshot } from "./street";

it("follows one fiscal endpoint across a rollover without joining annual and quarterly EPS", () => {
  const point = (end: string, eps: number) => ({ end, eps, rev: null });
  const end = "2026-12-31";
  const snapshots: Snapshot[] = [
    { as_of: "2026-10-01", p: { "0q": point("2026-09-30", 8), "+1q": point(end, -2), "0y": point(end, 15) } },
    { as_of: "2026-11-03", p: { "0q": point(end, -1), "+1q": point("2027-03-31", 7), "0y": point(end, 14) } },
  ];
  expect(fiscalEpsHistory(snapshots, "0q", end).map((r) => r.v)).toEqual([-2, -1]);
  expect(fiscalEpsHistory(snapshots, "0y", end).map((r) => r.v)).toEqual([15, 14]);
});
