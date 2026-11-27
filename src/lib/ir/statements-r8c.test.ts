// irrules3 (round 8): findings on real stored rows, fixtures trimmed from local builds of production facts.
import { describe, expect, it } from "vitest";
import wfcEq from "@/lib/ir/fixtures/statements/wfc-eq.json";
import aaplCat from "@/lib/ir/fixtures/statements/aapl-cat.json";
import koYtd from "@/lib/ir/fixtures/statements/ko-ytd.json";
import koOld from "@/lib/ir/fixtures/statements/ko-old.json";
import wmtUs from "@/lib/ir/fixtures/statements/wmt-us.json";
import { missingStatements } from "@/lib/ir/sector-order";
import type { IrPayload } from "@/lib/ir/payload";
import { assembleStatements, printedDiv, rowCells, rowLabel, type StatementRow } from "@/lib/ir/statements";

type Line = Extract<StatementRow, { kind: "line" }>;

describe("irfill2-01 WFC: a balance sheet row never shows another table's billions", () => {
  it("leaves Total equity empty when its only figures are the capital table's rounded billions", () => {
    const p = wfcEq as unknown as IrPayload;
    const by = new Map(p.series.map((x) => [x.k, x]));
    const s = assembleStatements(p).find((x) => x.id === "0:5")!;
    expect(s.unitLine).toMatch(/millions/i);
    const lines = s.rows.filter((r): r is Line => r.kind === "line");
    const eq = lines.find((r) => rowLabel(r, by) === "Total equity")!;
    expect(eq.at).toEqual([0, 5, 45]);
    const cells = rowCells(eq.ks, by, "q", eq.at).cells;
    for (const c of Object.values(cells)) expect(printedDiv(c)).toBe(1e6);
    // The table's other rows keep their own figures.
    const assets = lines.find((r) => rowLabel(r, by) === "Total assets")!;
    const own = rowCells(assets.ks, by, "q", assets.at).cells["2026-09-30"];
    expect(printedDiv(own!)).toBe(1e6);
  });
});

describe("style2-01 AAPL: a heading read into the first row's name", () => {
  it("draws the label-only row as a heading and names the row as stored", () => {
    const p = aaplCat as unknown as IrPayload;
    const by = new Map(p.series.map((x) => [x.k, x]));
    const sector = { sector: "Information Technology", industry: "Technology Hardware, Storage & Peripherals" };
    const secs = assembleStatements(p, sector);
    const s = secs.find((x) => x.id === "9:0")!;
    const i = s.rows.findIndex((r) => r.kind === "line" && r.at?.[2] === 40);
    const row = s.rows[i] as Line;
    expect(rowLabel(row, by)).toBe("iPhone");
    const head = s.rows[i - 1];
    expect(head.kind === "head" && head.text).toBe("Net sales by category");
    expect(missingStatements(secs, "technology")).not.toContain("product");
  });
});

describe("irrules-05 KO: sections printed only year to date", () => {
  it("marks the nine-month tables year to date and keeps them apart from the quarter's", () => {
    const p = koYtd as unknown as IrPayload;
    const secs = assembleStatements(p).filter((x) => x.group !== "more");
    const by = new Map(secs.map((x) => [x.id, x]));
    expect(by.get("5:21")?.basis).toBeUndefined();
    expect(by.get("5:22")?.basis).toBe("ytd");
    expect(by.get("5:24")?.basis).toBe("ytd");
    // The cash flow rows carry the nine-month figures as printed in their own table.
    const series = new Map(p.series.map((x) => [x.k, x]));
    const cf = by.get("5:24")!.rows.filter((r): r is Line => r.kind === "line");
    const own = cf.flatMap((r) => Object.values((series.get(r.k) as { ytd?: Record<string, { d?: number; l?: unknown; m?: number }> }).ytd ?? {}))
      .filter((c) => c.d === 5 && Array.isArray(c.l) && (c.l as number[])[0] === 24);
    expect(own.length).toBeGreaterThan(10);
    expect(own.every((c) => c.m === 9)).toBe(true);
    // A quarter of such a line is calculated, with its formula and both printed figures.
    const da = cf.map((r) => series.get(r.k)!).find((x) => /depreciation and amortization/.test(x.k))!;
    const q = da.q["2026-10-02"];
    expect(q.f?.formula).toBe("Nine months YTD − six months YTD");
    expect(q.f?.parts?.map((x) => x.x)).toEqual(["783", "530"]);
  });
});

describe("verb-14 KO: lines only older releases print", () => {
  it("never lists two older lines under one name", () => {
    const p = koOld as unknown as IrPayload;
    const by = new Map(p.series.map((x) => [x.k, x]));
    const s = assembleStatements(p).find((x) => x.id === "11:25")!;
    const old = s.rows.filter((r): r is Line => r.kind === "line" && !!r.old).map((r) => rowLabel(r, by));
    expect(old.length).toBeGreaterThan(10);
    expect(new Set(old).size).toBe(old.length);
  });
});

describe("WMT: a row with no table position keeps one printed scale", () => {
  it("shows the newest figure's scale only (millions), never the slides' billions beside it", () => {
    const p = wmtUs as unknown as IrPayload;
    const by = new Map(p.series.map((x) => [x.k, x]));
    const k = p.series[0].k;
    const cells = rowCells([k], by, "q").cells;
    expect(cells["2026-10-30"]?.x).toBe("124,969");
    const divs = new Set(Object.values(cells).map((c) => printedDiv(c)).filter((d) => d != null));
    expect([...divs]).toEqual([1e6]);
  });
});
