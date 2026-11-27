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
import citi from "@/lib/ir/fixtures/statements/c-supp.json";
import layout from "@/lib/ir/fixtures/statements/jpm-layout.json";
import tsla from "@/lib/ir/fixtures/statements/tsla-rows.json";
import now from "@/lib/ir/fixtures/statements/now-sum.json";
import crm from "@/lib/ir/fixtures/statements/crm-rpo.json";
import intc2 from "@/lib/ir/fixtures/statements/intc-two.json";
import ear from "@/lib/ir/fixtures/statements/jpm-ear.json";
import { buildPayload, type IrPayload, type PayloadSeries } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { assembleStatements, rowCells, rowLabel, sameRows, type Statement, type StatementRow } from "@/lib/ir/statements";

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

describe("auda-02 C: the supplement stored as another kind leads the page", () => {
  it("a document whose tables a supplement copy of the same release prints ranks as the supplement", async () => {
    const p = await payloadOf(citi);
    const secs = assembleStatements(p);
    expect(secs[0].group).toBe("main");
    expect(p.docs[secs[0].doc].kind).toBe("other");
    expect(secs.find((s) => p.docs[s.doc].kind === "press-release")?.group).toBe("other");
  });
});

describe("auda-06, audd-03, irtables-01, irstyle-01: the printed row layout of build format 3", () => {
  const p = layout as unknown as IrPayload;
  const secs = assembleStatements(p);
  it("rows read under their printed names, at their printed levels", () => {
    const s = secs.find((x) => x.id === "2:24")!;
    const o = outline(p, s);
    expect(o).toContain("  Loans retained");
    expect(o).toContain("  Loans held-for-sale and loans at fair value");
    expect(o).toContain("Consumer exposure");
    expect(o.some((x) => /Consumer loans excluding credit card/.test(x))).toBe(false);
    for (const r of s.rows) if (r.kind !== "gap") expect(r.depth).toBeLessThanOrEqual(2);
  });
  it("a table that indents totals past their parts keeps the stored levels; bold marks are carried", () => {
    const s = secs.find((x) => x.id === "2:3")!;
    const by = new Map(p.series.map((x) => [x.k, x]));
    const nir = s.rows.find((r): r is Line => r.kind === "line" && rowLabel(r, by) === "Noninterest revenue")!;
    const ib = s.rows.find((r): r is Line => r.kind === "line" && rowLabel(r, by) === "Investment banking fees")!;
    expect(ib.depth).toBe(nir.depth + 1);
    const total = s.rows.find((r): r is Line => r.kind === "line" && rowLabel(r, by) === "TOTAL NET REVENUE")!;
    expect(total.bold).toBe(true);
  });
});

describe("audb-09 TSLA: lines of one slide height are one row only when they measure the same thing", () => {
  it("restructuring costs and services revenue at one height stay two rows", () => {
    const series = (tsla as unknown as { series: PayloadSeries[] }).series;
    const by = new Map(series.map((x) => [x.k, x]));
    const keys = series.map((x) => x.k);
    const places = new Map(keys.map((k) => [k, new Set(["20:p1:0"])]));
    expect(sameRows(keys, by, places)).toHaveLength(2);
  });
});

describe("audd-08 CRM: a table printed with dates down the side", () => {
  it("is one row per label, not one per printed date", async () => {
    const p = await payloadOf(crm);
    const s = assembleStatements(p)[0];
    const rows = linesOf(p, s, "2026-07-31").map((r) => r.replace(/ -?\d+$/, ""));
    expect(rows).toHaveLength(3);
    expect(new Set(rows).size).toBe(3);
  });
});

describe("audd-09 NOW: GAAP and non-GAAP amount and margin columns on one printed row", () => {
  it("names each line by basis and measure, under the printed title", async () => {
    const p = await payloadOf(now);
    const s = assembleStatements(p)[0];
    expect(s.title).toBe("Third quarter 2026 GAAP and Non-GAAP results");
    const rows = linesOf(p, s, "2026-09-30").map((r) => r.replace(/ -?[\d.]+$/, ""));
    expect(rows.filter((r) => r.startsWith("Subscription gross profit"))).toEqual([
      "Subscription gross profit: GAAP gross profit",
      "Subscription gross profit: GAAP margin",
      "Subscription gross profit: non-GAAP gross profit",
      "Subscription gross profit: non-GAAP margin",
    ]);
    expect(new Set(rows).size).toBe(rows.length);
  });
});

describe("lines only older documents print", () => {
  it("close the section under a heading saying so, after the table's own rows, never among them", async () => {
    const p = await payloadOf(intc2);
    const s = assembleStatements(p).find((x) => x.group === "main")!;
    const i = s.rows.findIndex((r) => r.kind === "head" && r.text === "Printed only in earlier periods");
    expect(i).toBeGreaterThan(0);
    const after = s.rows.slice(i + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((r) => r.kind === "line" && r.old)).toBe(true);
    expect(s.rows.slice(0, i).some((r) => r.kind === "line" && r.old)).toBe(false);
    expect(assembleStatements(p).some((x) => x.id === `${s.id}~old`)).toBe(false);
  });
});

describe("vera-02 JPM: rows that differ only by their sign", () => {
  it("+100 bps and -100 bps are two series with their own figures", async () => {
    const p = await payloadOf(ear);
    const by = new Map(p.series.map((x) => [x.k, x]));
    const s = assembleStatements(p)[0];
    const rows = s.rows.filter((r): r is Line => r.kind === "line");
    expect(rows).toHaveLength(2);
    const v = rows.map((r) => rowCells(r.ks, by, "q", r.at).cells["2026-09-30"]?.v);
    expect(v).toEqual([1.4e9, -2.2e9]);
  });
});
