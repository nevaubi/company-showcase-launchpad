import { describe, expect, it } from "vitest";
import type { Worksheet } from "exceljs";
import { buildIrWorkbook } from "@/lib/export/ir-xlsx";
import type { IrPayload, PayloadCell } from "@/lib/ir/payload";

const Q = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"];
const FY = "2024-12-31";
const M = 1e6;

/** A line with three printed quarters, a printed full year and a fourth quarter derived from them. */
function line(k: string, label: string, quarters: number[], opts: { total?: boolean; parent?: string | null } = {}) {
  const fy = quarters.reduce((a, b) => a + b, 0);
  const q: Record<string, PayloadCell> = {};
  Q.slice(0, 3).forEach((e, i) => (q[e] = { v: quarters[i], d: 0, l: [0, i + 1, 1] }));
  q[Q[3]] = {
    v: quarters[3],
    f: {
      formula: "Q4 = full year − Q1 − Q2 − Q3",
      parts: [
        { label, v: fy, sign: 1, e: FY, m: 12 },
        ...Q.slice(0, 3).map((e, i) => ({ label, v: quarters[i], sign: -1 as const, e, m: 3 })),
      ],
    },
  };
  return { k, cat: "segment", met: "revenue", label, parent: opts.parent ?? null, total: !!opts.total, unit: "usd", q, y: { [FY]: { v: fy, d: 0, l: [0, 5, 1] as [number, number, number] } } };
}

function payload(): IrPayload {
  // Q2's printed total (40) disagrees with its parts (11 + 21 = 32).
  const a = line("a", "Cloud", [10 * M, 11 * M, 12 * M, 13 * M], { parent: "t" });
  const b = line("b", "Devices", [20 * M, 21 * M, 22 * M, 23 * M], { parent: "t" });
  const t = line("t", "Total revenue", [30 * M, 40 * M, 34 * M, 36 * M], { total: true });
  t.y[FY].v = 132 * M;
  const qChecks = Q.map((e, i) => {
    const sum = a.q[e].v + b.q[e].v;
    const total = t.q[e].v;
    return { k: "t", e, kind: "q" as const, total, sum, ok: Math.abs(sum - total) < 1.5 * M, n: 2 };
  });
  return {
    v: 2,
    ticker: "TEST",
    builtAt: "2026-11-01T00:00:00Z",
    quarters: Q,
    years: [FY],
    docs: [{ id: "doc-1", accn: "0000000000-26-000001", doc: "ex99.htm", kind: "press-release", filed: "2025-01-30" }],
    series: [a, b, t],
    groups: [{ id: "t", cat: "segment", met: "revenue", unit: "usd", label: "Total revenue", root: "t", rows: [{ k: "a", depth: 1 }, { k: "b", depth: 1 }, { k: "t", depth: 0 }] }],
    checks: [...qChecks, { k: "t", e: FY, kind: "fy", total: 132 * M, sum: 46 * M + 86 * M, ok: true, n: 2 }],
    stats: { series: 3, groups: 1, documents: 1, facts: 15, firstPeriod: Q[0], lastPeriod: Q[3], checksQ: { ok: 3, total: 4 }, checksFY: { ok: 1, total: 1 } },
  };
}

const rowOf = (ws: Worksheet, label: string) => {
  let found = 0;
  ws.eachRow((r, n) => {
    if (!found && r.getCell(1).value === label) found = n;
  });
  return found;
};
const periodCol = (ws: Worksheet, label: string) => {
  let found = 0;
  ws.getRow(4).eachCell((c, n) => {
    if (c.value === label) found = n;
  });
  return found;
};

describe("IR Excel export", () => {
  it("writes each tie-out check as a live formula over the listed parts and the printed total", async () => {
    const { wb } = await buildIrWorkbook({ ticker: "TEST", payload: payload(), freqs: ["q", "y"], scale: "M", scope: "test" });
    const ws = wb.getWorksheet("Revenue mix · Q")!;
    const check = rowOf(ws, "Check: parts − total");
    const [ra, rb, rt] = [rowOf(ws, "Cloud"), rowOf(ws, "Devices"), rowOf(ws, "Total revenue")];
    const c1 = periodCol(ws, "Mar ’24");
    const L = ws.getColumn(c1).letter;
    const v = ws.getCell(check, c1).value as { formula: string; result: unknown };
    expect(v.formula).toBe(`IF(ABS((${L}${ra}+${L}${rb})-${L}${rt})<=MAX(ABS(${L}${rt})*0.005,1500000),"✓",(${L}${ra}+${L}${rb})-${L}${rt})`);
    expect(v.result).toBe("✓");
  });

  it("shows the difference when a quarter's parts don't add up to the printed total", async () => {
    const { wb } = await buildIrWorkbook({ ticker: "TEST", payload: payload(), freqs: ["q"], scale: "M", scope: "test" });
    const ws = wb.getWorksheet("Revenue mix")!;
    const cell = ws.getCell(rowOf(ws, "Check: parts − total"), periodCol(ws, "Jun ’24")).value as { result: unknown };
    expect(cell.result).toBe(-8 * M);
  });

  it("derives the fourth quarter with a formula on the annual sheet's full-year cell minus Q1–Q3", async () => {
    const { wb } = await buildIrWorkbook({ ticker: "TEST", payload: payload(), freqs: ["q", "y"], scale: "M", scope: "test" });
    const ws = wb.getWorksheet("Revenue mix · Q")!;
    const fy = wb.getWorksheet("Revenue mix · FY")!;
    const r = rowOf(ws, "Cloud");
    const cols = ["Mar ’24", "Jun ’24", "Sep ’24", "Dec ’24"].map((l) => ws.getColumn(periodCol(ws, l)).letter);
    const fyRef = `${fy.getColumn(periodCol(fy, "FY24")).letter}${rowOf(fy, "Cloud")}`;
    const q4 = ws.getCell(`${cols[3]}${r}`).value as { formula: string; result: number };
    expect(q4.formula).toBe(`'Revenue mix · FY'!${fyRef}-${cols[0]}${r}-${cols[1]}${r}-${cols[2]}${r}`);
    expect(q4.result).toBe(13 * M);
  });

  it("keeps full dollar values in cells and shows millions through the number format", async () => {
    const { wb } = await buildIrWorkbook({ ticker: "TEST", payload: payload(), freqs: ["q"], scale: "M", scope: "test" });
    const ws = wb.getWorksheet("Revenue mix")!;
    const cell = ws.getCell(rowOf(ws, "Cloud"), periodCol(ws, "Mar ’24"));
    expect(cell.value).toBe(10 * M);
    expect(cell.numFmt).toBe('#,##0,,;(#,##0,,);"–"');
  });

  it("falls back to the stored value when a calculated quarter's parts aren't in the workbook", async () => {
    const { wb } = await buildIrWorkbook({ ticker: "TEST", payload: payload(), freqs: ["q"], scale: "M", scope: "test" });
    const ws = wb.getWorksheet("Revenue mix")!;
    const cell = ws.getCell(rowOf(ws, "Cloud"), periodCol(ws, "Dec ’24"));
    expect(cell.value).toBe(13 * M);
    expect(String(cell.note)).toContain("Q4 = full year − Q1 − Q2 − Q3");
  });
});
