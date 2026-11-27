// The payload budget: sections only from the newest 37 months' documents, series kept only for kept rows,
// then the byte cap's steps; the newest document's sections unchanged row for row and cell for cell.
import { describe, expect, it } from "vitest";
import lowFx from "@/lib/ir/fixtures/fill/low-q3fy26.json";
import type { IrFact } from "@/lib/ir/kpis";
import { buildPayload } from "@/lib/ir/payload";
import { budgetPayload } from "@/lib/ir/payload-budget";
import { assembleStatements, rowCells, rowLabel } from "@/lib/ir/statements";

const facts = lowFx.facts as unknown as IrFact[];
const back = (d: string | null, years: number) =>
  d ? `${Number(d.slice(0, 4)) - years}${d.slice(4)}` : d;
// The same release five years earlier, under another document id, in tables the newest release no longer prints.
const old = facts.map((f, i) => ({
  ...f,
  id: `old-${i}`,
  document_id: "00000000-0000-4000-8000-000000000001",
  filed: back(f.filed, 5),
  period_end: back(f.period_end, 5)!,
  period_start: back(f.period_start, 5),
  label: `${f.label} (old basis)`,
  // Another table of its own (a table the newest documents no longer print).
  locator: {
    ...(f.locator as object),
    t: (f.locator as { t: number }).t + 50,
  } as IrFact["locator"],
}));
const p = buildPayload("LOW", [...facts, ...old]);
const view = (x: typeof p) => {
  const byKey = new Map(x.series.map((s) => [s.k, s]));
  return assembleStatements(x)
    .filter((s) => x.docs[s.doc]?.id === facts[0].document_id)
    .map((s) => ({
      id: s.id,
      rows: s.rows.flatMap((r) =>
        r.kind === "line"
          ? [`${rowLabel(r, byKey)} ${JSON.stringify(rowCells(r.ks, byKey, "q", r.at).cells)}`]
          : [],
      ),
    }));
};

describe("payload budget", () => {
  it("lays sections out only from the newest 37 months and keeps the newest document's sections as they are", () => {
    const { payload, budget } = budgetPayload(p);
    expect(budget.ok).toBe(true);
    expect(budget.steps[0].step).toBe("recent");
    // Every section left is of a document of the newest 37 months.
    expect(
      assembleStatements(payload).every((x) => (payload.docs[x.doc]?.filed ?? "") >= "2023-10-18"),
    ).toBe(true);
    expect(budget.series.kept).toBeLessThanOrEqual(budget.series.built);
    expect(view(payload)).toEqual(view(p));
    // Every series left is used by a kept section's row (history of the old copy included) or is a standard line.
    const used = new Set(
      assembleStatements(payload).flatMap((x) => [
        ...x.keys,
        ...x.rows.flatMap((r) => (r.kind === "line" ? r.ks : [])),
      ]),
    );
    const parents = new Set(payload.series.map((x) => x.parent).filter(Boolean));
    expect(payload.series.every((x) => used.has(x.k) || x.sc || parents.has(x.k))).toBe(true);
  });
  it("keeps the printed rows when an unused table scope exceeds the interactive limit", () => {
    const large = { ...p.series[0], k: "unused", sc: "old cross-table scope".repeat(20000), q: {}, y: {}, at: undefined };
    const cap = new Blob([JSON.stringify(p)]).size + 2048;
    const { payload, budget } = budgetPayload({ ...p, series: [...p.series, large] }, { cap });
    expect(budget.ok).toBe(true);
    expect(budget.steps.at(-1)?.step).toBe("displayed");
    expect(payload.series.some((s) => s.k === large.k)).toBe(false);
    expect(view(payload)).toEqual(view(p));
  });
  it("records every step and refuses a payload still over the cap", () => {
    const { budget } = budgetPayload(p, { cap: 1000, quarters: 1 });
    expect(budget.steps.map((s) => s.step)).toEqual(["recent", "more", "periods", "displayed"]);
    expect(budget.ok).toBe(false);
    expect(budget.after).toBeGreaterThan(1000);
  });
});
