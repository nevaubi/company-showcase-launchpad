import { describe, expect, it } from "vitest";
import { densify, emptyCells, leftOutNote, rankByReporters, resolveGroup, sectorGroups, WHOLE_SECTOR, type ScopedRow } from "./dense";

/** A constructed Financials sector: 12 banks, 6 insurers, 4 payment networks, 2 exchanges, and one tech company. */
function sector() {
  const kpis: Record<string, Record<string, ScopedRow>> = {};
  const put = (kpi: string, t: string, ind: string, sec = "Financials") => ((kpis[kpi] ??= {})[t] = { sec, ind });
  const banks = Array.from({ length: 12 }, (_, i) => `B${i}`);
  const ins = Array.from({ length: 6 }, (_, i) => `I${i}`);
  const pay = Array.from({ length: 4 }, (_, i) => `P${i}`);
  for (const t of banks) for (const k of ["nim", "cet1", "rotce", "efficiency", "loans"]) put(k, t, "Banks");
  for (const t of ins) for (const k of ["combined_ratio", "premiums", "loss_ratio"]) put(k, t, "Insurance");
  for (const t of pay) for (const k of ["payments_volume", "transactions"]) put(k, t, "Payments");
  put("aum", "X0", "Exchanges");
  put("aum", "X1", "Exchanges");
  put("efficiency", "I0", "Insurance");
  put("nim", "T0", "Software", "Technology");
  return kpis;
}
/** The matrix the page draws: rows are companies with a value in any of the columns, cells null where none. */
function matrix(kpis: Record<string, Record<string, ScopedRow>>, keep: (r: ScopedRow) => boolean, n = 8) {
  const cols = rankByReporters(kpis, keep).slice(0, n).map((x) => x.id);
  const tks = new Set<string>();
  for (const c of cols) for (const [t, r] of Object.entries(kpis[c])) if (keep(r)) tks.add(t);
  const rows = [...tks].map((t) => ({ t, cells: Object.fromEntries(cols.map((c) => [c, kpis[c][t] && keep(kpis[c][t]) ? 1 : null])) }));
  return { cols, rows };
}

describe("KPI matrix density", () => {
  it("offers the sector's industry groups, largest first, small ones folded into the whole sector", () => {
    const g = sectorGroups(sector(), "Financials");
    expect(g.groups).toEqual([
      { ind: "Banks", n: 12 },
      { ind: "Insurance", n: 6 },
      { ind: "Payments", n: 4 },
    ]);
    expect(g.small).toBe(2);
    expect(resolveGroup(g.groups, "")).toBe("Banks");
    expect(resolveGroup(g.groups, "Insurance")).toBe("Insurance");
    expect(resolveGroup(g.groups, "Gone")).toBe("Banks");
    expect(resolveGroup(g.groups, WHOLE_SECTOR)).toBeNull();
    expect(resolveGroup([{ ind: "Banks", n: 12 }], "")).toBeNull();
  });

  it("a group's matrix has far fewer empty cells than the whole sector's", () => {
    const kp = sector();
    const whole = matrix(kp, (r) => r.sec === "Financials");
    const before = emptyCells(whole.rows, whole.cols);
    // 18 companies (banks and insurers; payments fall off the top eight) under 8 columns, each column one group's.
    expect(before).toEqual({ empty: 65, total: 144 });
    const banks = matrix(kp, (r) => r.sec === "Financials" && r.ind === "Banks");
    expect(banks.cols.sort()).toEqual(["cet1", "efficiency", "loans", "nim", "rotce"]);
    expect(emptyCells(banks.rows, banks.cols)).toEqual({ empty: 0, total: 60 });
    const insurers = matrix(kp, (r) => r.sec === "Financials" && r.ind === "Insurance");
    // efficiency is reported by one insurer only: 5 of its 6 cells empty, nothing else.
    expect(emptyCells(insurers.rows, insurers.cols)).toEqual({ empty: 5, total: 24 });
  });

  it("leaves out chosen columns and companies with nothing in them, and can show them again", () => {
    const rows = [
      { t: "A", cells: { nim: 1, cet1: null, combined: null } },
      { t: "B", cells: { nim: null, cet1: 2, combined: null } },
      { t: "C", cells: { nim: null, cet1: null, combined: null } },
    ];
    const d = densify(rows, ["nim", "cet1", "combined"]);
    expect(d.cols).toEqual(["nim", "cet1"]);
    expect(d.rows.map((r) => r.t)).toEqual(["A", "B"]);
    expect(d.hiddenCols).toEqual(["combined"]);
    expect(d.hiddenRows).toBe(1);
    const all = densify(rows, ["nim", "cet1", "combined"], true);
    expect(all.cols).toHaveLength(3);
    expect(all.rows).toHaveLength(3);
    expect(all.hiddenRows).toBe(1);
    expect(leftOutNote(d, (id) => ({ combined: "Combined ratio" })[id] ?? id, "Banks")).toBe(
      "Left out: 1 company reports none of these KPIs; Combined ratio has no value for Banks.",
    );
    expect(leftOutNote(densify(rows.slice(0, 2), ["nim", "cet1"]), String, "Banks")).toBeNull();
    expect(leftOutNote({ hiddenRows: 0, hiddenCols: ["a", "b", "c", "d"] }, String, "Banks")).toBe(
      "Left out: a, b and 2 more have no value for Banks.",
    );
  });
});
