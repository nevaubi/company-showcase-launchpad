// irpolish (round 7): defects the lead saw on JPM's rebuilt payload, on real rows of the 3Q26 supplement
// (tables 2, 5, 8 and 20), two earlier supplements' tables 2 and 8, and the 3Q26 deck's AWM revenue slide.
import { describe, expect, it } from "vitest";
import lob from "@/lib/ir/fixtures/statements/jpm-lob.json";
import { buildPayload, type IrPayload, type PayloadSeries } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import {
  assembleStatements,
  rowLabel,
  sameRows,
  sectionChecks,
  visibleRows,
  withCaptions,
  type Statement,
  type StatementRow,
} from "@/lib/ir/statements";

interface Fixture {
  ticker: string;
  facts: IrFact[];
  captions: Record<string, TableCaption[]>;
}
async function payloadOf(fx: Fixture): Promise<IrPayload> {
  const p = buildPayload(fx.ticker, fx.facts);
  return withCaptions(p, async (d) => fx.captions[p.docs[d].id]);
}
type Line = Extract<StatementRow, { kind: "line" }>;
const p = await payloadOf(lob as unknown as Fixture);
const secs = assembleStatements(p);
const byKey = new Map(p.series.map((s) => [s.k, s]));
const sec = (title: RegExp) => secs.find((s) => s.group === "main" && title.test(s.title))!;
/** The rows of a printed block: the lines after `head` up to and including the total that closes it. */
function block(s: Statement, head: RegExp): Line[] {
  const i = s.rows.findIndex((r) => r.kind === "head" && head.test(r.text));
  const out: Line[] = [];
  for (const r of s.rows.slice(i + 1)) {
    if (r.kind !== "line") {
      if (out.length) break;
      continue;
    }
    out.push(r);
    if (r.total) break;
  }
  return out;
}

describe("irpolish: statement sections on JPM's rebuilt payload", () => {
  it("draws no heading that is the first half of a wrapped label, and no heading without a line under it", () => {
    const s = sec(/average balance sheets/i);
    const heads = s.rows.filter((r): r is Extract<StatementRow, { kind: "head" }> => r.kind === "head").map((r) => r.text);
    expect(heads.some((h) => /\b(or|and|of)$/i.test(h))).toBe(false);
    const { rows } = visibleRows(s, byKey, {});
    rows.forEach((r, i) => {
      if (r.kind !== "head") return;
      const next = rows.slice(i + 1).find((x) => x.kind !== "gap");
      expect(next?.kind, `heading "${r.text}" has a line under it`).toBe("line");
    });
  });

  it("reads a label the table wraps over two rows as one name", () => {
    const s = { k: "x", label: "Sold under repurchase agreements", unit: "usd", q: {}, y: {} } as unknown as PayloadSeries;
    const by = new Map([["x", s]]);
    expect(rowLabel({ k: "x", ks: ["x"], wrap: "Federal funds purchased and securities loaned or" }, by)).toBe(
      "Federal funds purchased and securities loaned or sold under repurchase agreements",
    );
    const full = { ...s, label: "Federal funds purchased and securities loaned or sold under repurchase agreements" };
    expect(rowLabel({ k: "x", ks: ["x"], wrap: "Federal funds purchased and securities loaned or" }, new Map([["x", full]]))).toBe(full.label);
  });

  it("indents siblings printed at the same level alike, under the total that closes their block", () => {
    const s = sec(/^Segment & corporate results/);
    for (const head of [/^Total net revenue/i, /^Total noninterest expense/i, /^Net income/i]) {
      const rows = block(s, head);
      const total = rows.at(-1)!;
      expect(total.total).toBe(true);
      const parts = rows.slice(0, -1);
      expect(parts.map((r) => rowLabel(r, byKey))).toEqual([
        "Consumer & Community Banking",
        "Commercial & Investment Bank",
        "Asset & Wealth Management",
        "Corporate",
      ]);
      expect(new Set(parts.map((r) => r.depth))).toEqual(new Set([total.depth + 1]));
    }
  });

  it("checks a total only against the parts its own table prints", () => {
    for (const s of [sec(/^Segment & corporate results/), sec(/^Consolidated financial highlights, continued/)]) {
      const revenue = s.rows.find((r): r is Line => r.kind === "line" && r.total && /total net revenue/i.test(rowLabel(r, byKey)))!;
      // The rebuilt production payload stores the 3Q26 check of this total with six parts: the four lines of
      // business and the deck's Asset Management and Global Private Bank lines (parent "Revenue").
      const stored = [
        ...p.checks.filter((c) => !(c.k === revenue.k && c.e === "2026-09-30")),
        { k: revenue.k, e: "2026-09-30", kind: "q" as const, total: 50_907e6, sum: 57_816e6, ok: false, n: 6 },
      ];
      const mine = [...sectionChecks(s, byKey, stored).values()].filter((c) => c.k === revenue.k && c.kind === "q");
      expect(mine.length).toBeGreaterThan(4);
      expect(mine.some((c) => c.e === "2026-09-30")).toBe(true);
      for (const c of mine) {
        expect(c.n, `${s.title} ${c.e}`).toBe(4);
        expect(c.ok, `${s.title} ${c.e}: ${c.sum} vs ${c.total}`).toBe(true);
      }
    }
  });
});

describe("irpolish: one printed row in copies of a table", () => {
  const line = (k: string, parent: string | null, q: Record<string, number>): PayloadSeries =>
    ({
      k,
      cat: "segment",
      met: "net_income",
      label: "Commercial & Investment Bank",
      parent,
      total: false,
      unit: "usd",
      q: Object.fromEntries(Object.entries(q).map(([e, v]) => [e, { v, d: 0, x: String(v / 1e6), e, m: 3 }])),
      y: {},
    }) as unknown as PayloadSeries;
  const total = (k: string, label: string) => ({ ...line(k, null, {}), label, total: true }) as PayloadSeries;
  it("joins two stored identities printed at the same row of the same table in two supplements", () => {
    // The newest supplement's line sits under "Total net income", the older one's under "NET INCOME" (the
    // highlights page's total), so the two names of their totals differ.
    const ta = total("ta", "Total net income");
    const tb = total("tb", "NET INCOME");
    const a = line("a", "ta", { "2026-09-30": 8_247e6, "2025-12-31": 7_268e6 });
    const b = line("b", "tb", { "2025-06-30": 6_650e6, "2025-09-30": 6_901e6, "2025-12-31": 7_268e6 });
    const c = line("c", "tb", { "2025-12-31": 7_000e6 });
    const by = new Map([ta, tb, a, b, c].map((s) => [s.k, s]));
    const at = (x: Record<string, string>) => new Map(Object.entries(x).map(([k, v]) => [k, new Set([v])]));
    expect(sameRows(["a", "b"], by, at({ a: "2:8:39", b: "7:8:39" }))).toEqual([["a", "b"]]);
    // Not at another printed row, nor when a figure conflicts.
    expect(sameRows(["a", "b"], by, at({ a: "2:8:39", b: "7:8:40" }))).toEqual([["a"], ["b"]]);
    expect(sameRows(["a", "c"], by, at({ a: "2:8:39", c: "7:8:39" }))).toEqual([["a"], ["c"]]);
  });
});
