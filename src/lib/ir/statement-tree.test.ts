// irrules (round 8): the printed hierarchy of a section on real rows. AAPL's Q4 FY26 release prints iPhone, Mac,
// iPad and Wearables in "Net sales by category" under "Total net sales" while the build stored them under
// "Products", printed in the statement's first block; JPM's 3Q26 supplement prints ten noninterest revenue lines
// over "Noninterest revenue", which a build from production facts stored with no parent; the AWM table prints
// Asset Management and Global Private Bank over its total net revenue.
import { describe, expect, it } from "vitest";
import aapl from "@/lib/ir/fixtures/statements/aapl.json";
import lob from "@/lib/ir/fixtures/statements/jpm-lob.json";
import nir from "@/lib/ir/fixtures/statements/jpm-nir.json";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { assembleStatements, blockParts, rowLabel, sectionChecks, type Statement, type StatementRow } from "@/lib/ir/statements";

interface Fixture {
  ticker: string;
  facts: IrFact[];
  captions: Record<string, TableCaption[]>;
}
async function payloadOf(fx: Fixture): Promise<IrPayload> {
  const { withCaptions } = await import("@/lib/ir/statements");
  const p = buildPayload(fx.ticker, fx.facts);
  return withCaptions(p, async (d) => fx.captions[p.docs[d].id]);
}
type Line = Extract<StatementRow, { kind: "line" }>;

/** The rows as "<indent><*>label", headings as "# text", spacers dropped. */
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

describe("printed hierarchy", () => {
  it("AAPL: a part sits under the total of its own block, never under a row of another block", async () => {
    const p = await payloadOf(aapl as unknown as Fixture);
    const s = assembleStatements(p)[0];
    const o = outline(p, s);
    // "Products" closes nothing it prints next to it: no bold.
    expect(o).toContain("  Products");
    const cat = o.indexOf("# (1) Net sales by category");
    expect(o.slice(cat, cat + 7)).toEqual([
      "# (1) Net sales by category",
      "  iPhone",
      "  Mac",
      "  iPad",
      "  Wearables, Home and Accessories",
      "  Services",
      "*Total net sales",
    ]);
  });

  it("JPM: parts that lost their total come back under it when their figures add up to it", () => {
    const p = nir as unknown as IrPayload;
    const s = assembleStatements(p).find((x) => x.id === "2:3")!;
    expect(outline(p, s)).toEqual([
      "    Investment banking fees",
      "    Principal transactions",
      "    Lending- and deposit-related fees",
      "    Asset management fees",
      "    Commissions and other fees",
      "    Investment securities gains/(losses)",
      "    Mortgage fees and related income",
      "    Card income",
      "    Other income",
      "  *Noninterest revenue",
      "  Net interest income",
      "*TOTAL NET REVENUE",
    ]);
    // The section's checks close each total over its own parts only.
    const i = s.rows.findIndex((r) => r.kind === "line" && /^Noninterest revenue$/.test(rowLabel(r, new Map(p.series.map((x) => [x.k, x])))));
    expect(blockParts(s.rows, i)).toHaveLength(9);
    const total = s.rows.findIndex((r) => r.kind === "line" && r.total && /TOTAL NET REVENUE/.test(rowLabel(r, new Map(p.series.map((x) => [x.k, x])))));
    expect(blockParts(s.rows, total)).toHaveLength(2);
  });

  it("JPM AWM: the segment table's business lines are parts of its total net revenue", async () => {
    const p = await payloadOf(lob as unknown as Fixture);
    const s = assembleStatements(p).find((x) => x.group === "main" && /^Asset & wealth management$/i.test(x.title))!;
    const o = outline(p, s);
    const i = o.indexOf("  Asset Management");
    expect(o.slice(i, i + 3)).toEqual(["  Asset Management", "  Global Private Bank", "*TOTAL NET REVENUE"]);
    const by = new Map(p.series.map((x) => [x.k, x]));
    const checks = sectionChecks(s, by, p.checks);
    expect([...checks.values()].every((c) => c.ok || c.partial)).toBe(true);
  });

  it("no line sits more than one level under the row above it unless that row is its parent's block", () => {
    const p = nir as unknown as IrPayload;
    for (const s of assembleStatements(p))
      s.rows.forEach((r, i) => {
        if (r.kind !== "line" || r.up == null) return;
        const parent = s.rows[r.up] as Line;
        expect(r.depth).toBe(parent.depth + 1);
        expect(parent.total).toBe(true);
        expect(i).not.toBe(r.up);
      });
  });
});
