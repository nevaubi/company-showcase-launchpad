// irrules (round 8): auditors' findings on real stored rows, each fixture trimmed from the auditor's saved facts
// (META, ORCL, AVGO releases on sec.gov), with captions read from the SEC copies.
import { describe, expect, it } from "vitest";
import meta from "@/lib/ir/fixtures/statements/meta-seg.json";
import orcl from "@/lib/ir/fixtures/statements/orcl-rev.json";
import avgo from "@/lib/ir/fixtures/statements/avgo-sbc.json";
import ko from "@/lib/ir/fixtures/statements/ko-seg.json";
import ge from "@/lib/ir/fixtures/statements/ge-seg.json";
import intc from "@/lib/ir/fixtures/statements/intc-seg.json";
import amd from "@/lib/ir/fixtures/statements/amd-corp.json";
import mu from "@/lib/ir/fixtures/statements/mu-bu.json";
import nflx from "@/lib/ir/fixtures/statements/nflx-geo.json";
import csco from "@/lib/ir/fixtures/statements/csco-gm.json";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { assembleStatements, rowCells, rowLabel, type Statement, type StatementRow } from "@/lib/ir/statements";

interface Fixture {
  ticker: string;
  facts: IrFact[];
  captions: Record<string, TableCaption[]>;
}
async function payloadOf(fx: unknown): Promise<IrPayload> {
  const { withCaptions } = await import("@/lib/ir/statements");
  const f = fx as Fixture;
  const p = buildPayload(f.ticker, f.facts);
  return withCaptions(p, async (d) => f.captions[p.docs[d].id]);
}
type Line = Extract<StatementRow, { kind: "line" }>;
function outline(p: IrPayload, s: Statement) {
  const by = new Map(p.series.map((x) => [x.k, x]));
  return s.rows
    .filter((r) => r.kind !== "gap")
    .map((r) =>
      r.kind === "head"
        ? `${"  ".repeat(r.depth)}# ${r.text}`
        : `${"  ".repeat(r.depth)}${r.total ? "*" : ""}${rowLabel(r as Line, by)}`,
    );
}

describe("audd-04 META: a subtotal printed under its parts", () => {
  it("Family of Apps is bold over Advertising and Other revenue, and a part of Total revenue", async () => {
    const p = await payloadOf(meta);
    const s = assembleStatements(p).find((x) => x.title === "Segment information")!;
    expect(outline(p, s).slice(0, 6)).toEqual([
      "# Revenue",
      "    Advertising",
      "    Other revenue",
      "  *Family of Apps",
      "  Reality Labs",
      "*Total revenue",
    ]);
  });
});

describe("audd-05 ORCL: no heading over rows the reader did not keep", () => {
  it("the growth-rate headings over unread rows are not drawn", async () => {
    const p = await payloadOf(orcl);
    const s = assembleStatements(p).find((x) => /supplemental analysis of gaap revenues/i.test(x.title))!;
    const heads = outline(p, s).filter((x) => x.trim().startsWith("#"));
    expect(heads.some((h) => /growth rates/i.test(h))).toBe(false);
    expect(heads.map((h) => h.trim())).toEqual(
      expect.arrayContaining(["# Cloud revenues by offerings", "# Geographic revenues"]),
    );
    // Every heading has a line straight under it.
    s.rows.forEach((r, i) => {
      if (r.kind === "head") expect(s.rows[i + 1]?.kind, (r as { text: string }).text).toBe("line");
    });
  });
});

describe("audb-05 AVGO: the same printed row stored under its block's name in older releases", () => {
  it("joins the older quarters onto the row instead of listing them apart", async () => {
    const p = await payloadOf(avgo);
    const secs = assembleStatements(p);
    const s = secs.find((x) => x.group === "main")!;
    const by = new Map(p.series.map((x) => [x.k, x]));
    const cost = s.rows.find((r): r is Line => r.kind === "line" && r.at?.[2] === 47)!;
    expect(rowLabel(cost, by)).toBe("Cost of revenue");
    const cells = rowCells(cost.ks, by, "q", cost.at).cells;
    expect(cells["2026-08-02"]?.v).toBe(224e6);
    expect(cells["2026-02-01"]?.v).toBe(236e6);
    expect(secs.some((x) => /lines only other copies print/.test(x.title))).toBe(false);
  });
});

const linesOf = (p: IrPayload, s: Statement, end: string) => {
  const by = new Map(p.series.map((x) => [x.k, x]));
  return s.rows
    .filter((r): r is Line => r.kind === "line")
    .map((r) => `${rowLabel(r, by)} ${rowCells(r.ks, by, "q", r.at).cells[end]?.v ?? "-"}`);
};

describe("audc-01 KO: reported and comparable segment revenue stay two lines", () => {
  it("the comparable block keeps every segment, also where its figure equals the reported one", async () => {
    const p = await payloadOf(ko);
    const s = assembleStatements(p).find((x) => x.id.endsWith(":36"))!;
    const rows = linesOf(p, s, "2026-10-02");
    expect(rows).toEqual([
      "EMEA 3104000000",
      "Latin America 1958000000",
      "North America 5386000000",
      "Asia Pacific 1563000000",
      "Bottling Investments 1523000000",
      "Corporate 38000000",
      "Eliminations -192000000",
      "Consolidated 13380000000",
      "EMEA 3093000000",
      "Latin America 1938000000",
      "North America 5386000000",
      "Asia Pacific 1568000000",
      "Bottling Investments 1523000000",
      "Corporate 38000000",
      "Eliminations -192000000",
      "Consolidated 13354000000",
    ]);
    const heads = s.rows.filter((r) => r.kind === "head").map((r) => (r as { text: string }).text);
    expect(heads).toEqual(["Reported revenue by segment", "Comparable revenue by segment"]);
  });
});

describe("audc-03 KO: one printed row of two column groups", () => {
  it("names each line by what it measures, in printed column order", async () => {
    const p = await payloadOf(ko);
    const s = assembleStatements(p).find((x) => x.id.endsWith(":25"))!;
    const rows = linesOf(p, s, "2026-10-02");
    expect(rows.slice(0, 2)).toEqual(["EMEA: revenue 3104000000", "EMEA: operating income 1171000000"]);
    expect(rows.slice(-2)).toEqual(["Consolidated: revenue 13380000000", "Consolidated: operating income 4465000000"]);
    expect(new Set(rows.map((r) => r.replace(/ -?\d+$/, ""))).size).toBe(rows.length);
  });
});

describe("audc-02 GE: a segment table keeps its revenue row", () => {
  it("the revenue line merged with the summary's segment line is still a row of each segment table", async () => {
    const p = await payloadOf(ge);
    for (const [t, v] of [
      [4, 10342e6],
      [5, 3469e6],
    ] as const) {
      const s = assembleStatements(p).find((x) => x.id === `0:${t}`)!;
      const by = new Map(p.series.map((x) => [x.k, x]));
      const row = s.rows.find((r): r is Line => r.kind === "line" && r.at?.[2] === 4)!;
      expect(rowCells(row.ks, by, "q", row.at).cells["2026-09-30"]?.v).toBe(v);
    }
  });
});

describe("audb-08 INTC: a matrix printed twice in one release (this quarter, last year)", () => {
  it("is one section, its lines in the printed column order", async () => {
    const p = await payloadOf(intc);
    const secs = assembleStatements(p).filter((x) => x.group === "main");
    expect(secs).toHaveLength(1);
    const rows = linesOf(p, secs[0], "2026-09-26").slice(0, 7).map((r) => r.replace(/ -?\d+$/, ""));
    expect(rows).toEqual([
      "CCPG: Revenue",
      "DCAI: Revenue",
      "Total Intel Products: Revenue",
      "Intel Foundry: Revenue",
      "All Other: Revenue",
      "Intersegment Eliminations: Revenue",
      "Total Consolidated: Revenue",
    ]);
  });
});

describe("audb-07 AMD: printed headings, a sub-block closed by its own total", () => {
  it("keeps the printed case, ends the block at its total and marks it", async () => {
    const p = await payloadOf(amd);
    const s = assembleStatements(p)[0];
    const o = outline(p, s);
    const i = o.indexOf("# Net Revenue");
    expect(o.slice(i, i + 8)).toEqual([
      "# Net Revenue",
      "  Data Center Segment",
      "  # Client and Gaming Segment",
      "    Client",
      "    Gaming",
      "  *Total Client and Gaming",
      "  Embedded Segment",
      "*Total net revenue",
    ]);
    expect(o).toContain("# Operating Income (Loss)");
  });
});

describe("audb-06 MU: printed titles and rows under their heading", () => {
  it("names sections by the title in the table's first row, rows without the heading repeated", async () => {
    const p = await payloadOf(mu);
    const secs = assembleStatements(p);
    const bu = secs.find((s) => s.id.endsWith(":3"))!;
    expect(bu.title).toBe("Quarterly business unit financial results");
    expect(bu.titleFrom).toBe("printed");
    expect(outline(p, bu).slice(0, 4)).toEqual(["# Cloud Memory Business Unit", "Revenue", "Gross margin", "Operating margin"]);
    const all = JSON.stringify(secs.map((s) => [s.title, s.rows.map((r) => (r.kind === "head" ? r.text : ""))]));
    expect(all).toContain("Quarterly financial results");
    expect(all).not.toContain("Revenue by business unit");
  });
});

describe("audd-06, audd-07 NFLX: a table in thousands, a sentence over a table", () => {
  it("shows only the thousands table's own figures in its rows and states its scale", async () => {
    const p = await payloadOf(nflx);
    const s = assembleStatements(p).find((x) => x.id.endsWith(":23"))!;
    expect(s.unitLine).toBe("Dollars in thousands");
    const by = new Map(p.series.map((x) => [x.k, x]));
    const ucan = s.rows.find((r): r is Line => r.kind === "line" && rowLabel(r, by) === "UCAN")!;
    const cells = rowCells(ucan.ks, by, "q", ucan.at).cells;
    expect(Object.keys(cells).sort()).toEqual(["2025-09-30", "2026-09-30"]);
    expect(cells["2026-09-30"].v).toBe(5628215000);
  });
  it("never takes a paragraph's closing sentence as a table's title", async () => {
    const p = await payloadOf(nflx);
    const text = JSON.stringify(assembleStatements(p));
    expect(text).not.toContain("are below");
  });
});

describe("audb-12 CSCO: one reconciliation printed for two quarters and two fiscal years", () => {
  it("is one section; its annual view shows the fiscal-year tables' figures", async () => {
    const p = await payloadOf(csco);
    const secs = assembleStatements(p).filter((x) => x.group !== "more");
    expect(secs).toHaveLength(1);
    const by = new Map(p.series.map((x) => [x.k, x]));
    const first = secs[0].rows.find((r): r is Line => r.kind === "line")!;
    expect(rowCells(first.ks, by, "q", first.at).cells["2026-07-25"]?.v).toBe(8430e6);
    expect(rowCells(first.ks, by, "y", first.at).cells["2026-07-25"]?.v).toBe(30514e6);
  });
});
