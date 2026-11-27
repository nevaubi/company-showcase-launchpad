// The reduced copy of a document the fill reads on later rebuilds, the history the fill chooses, and the stale
// lane's return to a company whose history is still waiting.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import lowFx from "@/lib/ir/fixtures/fill/low-q3fy26.json";
import type { IrFact } from "@/lib/ir/kpis";
import { fillDocument } from "@/lib/ir/table-fill";
import { fillCompany, fillDocs, fiscalCalendar, monthsBefore } from "@/lib/ir/table-fill-build";
import {
  FILL_CACHE_VERSION,
  fillCachePath,
  packFillDoc,
  reduceDocument,
  unpackFillDoc,
} from "@/lib/ir/table-fill-cache";
import { FILL_PASSES, staleTickers } from "../../../scripts/lib/ir-rebuild-stale";

const html = readFileSync(join(process.cwd(), "src/lib/ir/fixtures/fill/low-q3fy26.htm"), "utf8");
const facts = lowFx.facts as unknown as IrFact[];
const DOC = facts[0].document_id!;

describe("reduced copy of a document", () => {
  it("fills exactly as the stored text does, from a smaller copy", () => {
    const doc = unpackFillDoc(packFillDoc(reduceDocument(html)))!;
    expect(doc.v).toBe(FILL_CACHE_VERSION);
    const opts = {
      doc: DOC,
      facts,
      filed: "2026-11-18",
      calendar: fiscalCalendar(facts, ["2026-10-30"]),
    };
    const a = fillDocument({
      ...opts,
      html,
      captions: new Map(reduceDocument(html).captions.map((c) => [c.t, c])),
    });
    const b = fillDocument({
      ...opts,
      html: "",
      grid: doc.grid,
      zeroDash: doc.zeroDash,
      captions: new Map(doc.captions.map((c) => [c.t, c])),
    });
    expect(b.facts).toEqual(a.facts);
    expect(b.tables).toEqual(a.tables);
    expect(packFillDoc(doc).length).toBeLessThan(html.length);
    expect(fillCachePath("x")).toBe(`fill/x.v${FILL_CACHE_VERSION}.json`);
  });
  it("refuses a copy of another version", () => {
    expect(unpackFillDoc(JSON.stringify({ v: FILL_CACHE_VERSION + 1, t: [] }))).toBeNull();
    expect(unpackFillDoc("not json")).toBeNull();
  });
});

describe("history the fill reads", () => {
  const row = (id: string, filed: string, kind = "press-release") => ({
    id,
    filed,
    kind,
    title: null,
  });
  it("takes 37 months, newest quarter first, releases and supplements before other exhibits", () => {
    const rows = [
      row("old", "2023-09-01"),
      row("q3-other", "2026-10-20", "other"),
      row("q3-pr", "2026-10-14"),
      row("q2-sup", "2026-07-15", "supplement"),
      row("q1-pr", "2026-04-15"),
      row("edge", "2023-11-01"),
    ];
    expect(fillDocs([], 60, rows)).toEqual(["q3-pr", "q3-other", "q2-sup", "q1-pr", "edge"]);
    expect(monthsBefore("2026-10-20", 37)).toBe("2023-09-20");
  });
  it("counts documents left for a later rebuild", async () => {
    const run = await fillCompany(
      facts,
      async (id) => (id === DOC ? reduceDocument(html) : "wait"),
      {
        docs: [
          { id: DOC, filed: "2026-11-18", kind: "press-release", title: null },
          { id: "later", filed: "2026-08-20", kind: "press-release", title: null },
        ],
        reports: ["2026-10-30"],
      },
    );
    expect([run.read, run.waiting, run.failed]).toEqual([1, 1, 0]);
  });
  it("brings the stale lane back to a company whose history waits, at most hourly and 8 times", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const fill = (waiting: number, pass: number, at: string) => ({ waiting, pass, at });
    const rows = [
      { ticker: "A", build: 4, fill: fill(3, 1, "2026-11-27T10:00:00Z") },
      { ticker: "B", build: 4, fill: fill(3, 1, "2026-11-27T11:30:00Z") },
      { ticker: "C", build: 4, fill: fill(3, FILL_PASSES, "2026-11-27T09:00:00Z") },
      { ticker: "D", build: 4, fill: fill(0, 0, "2026-11-27T09:00:00Z") },
      { ticker: "E", build: 3, fill: null },
    ];
    expect(staleTickers(rows, 4, now)).toEqual(["A", "E"]);
    expect(staleTickers(rows, 4)).toEqual(["E"]);
  });
});
