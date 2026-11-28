// Pure: what a stored IR payload gives the page, measured the way the page lays it out (the same
// `assembleStatements`, `rowCells` and `sectionChecks`), so the quality ledger and the page never disagree.
// Nothing here corrects anything; it counts.
// - Depth: how many quarters the payload holds and, per statement the sector expects, how many of them the
//   statement's own rows fill (a quarter counts when at least half of the rows that carry quarterly figures
//   print one for it), and how many quarters between its first and newest are empty (holes: a document not
//   stored or not read).
// - Fill by age: filled cells against slots of the front sections' own rows, by how far back the quarter is.
//   A slot is a row with quarterly figures in a quarter its section covers; "old" rows (lines only earlier
//   documents print, listed under the table) are counted apart: history that did not join its row.
// - Ties: totals and results of the front sections by period: they tie, do not tie, are selected-line lists,
//   or are totals and bold lines the page shows with no check at all.
import { periodGrids } from "@/lib/ir/periods";
import type { IrPayload, PayloadSeries } from "@/lib/ir/payload";
import { missingStatements, sectionKind, sectorOf, type SectionKind } from "@/lib/ir/sector-order";
import { assembleStatements, linesLeftOut, rowCells, sectionChecks, type Statement, type StatementRow } from "@/lib/ir/statements";

/** Quarters back from the newest: the newest 8, the next 12, the next 20, anything older. */
export const AUDIT_BANDS = ["q8", "q20", "q40", "older"] as const;
export type AuditBand = (typeof AUDIT_BANDS)[number];
const bandOf = (back: number): AuditBand => (back < 8 ? "q8" : back < 20 ? "q20" : back < 40 ? "q40" : "older");
/** Share of a statement's rows a quarter must fill to count toward its depth. */
export const DEPTH_SHARE = 0.5;

export interface AuditFill {
  /** rows × quarters the section covers */
  slots: number;
  /** of them, with a shown figure */
  cells: number;
  /** of them, with only a held figure */
  held: number;
  /** figures of "old" rows in the band: history listed under the table instead of in its row */
  apart: number;
}

export interface AuditStatement {
  kind: SectionKind;
  title: string;
  /** own rows that carry quarterly figures */
  rows: number;
  /** lines only earlier documents print */
  old: number;
  /** quarters at least half of the rows fill */
  depth: number;
  /** oldest such quarter */
  first: string | null;
  /** quarters between `first` and the newest that are not filled to that share */
  holes: number;
}

export interface IrAudit {
  ticker: string;
  build: number | null;
  /** quarter columns of the payload */
  quarters: number;
  first: string | null;
  last: string | null;
  sections: { main: number; other: number; more: number };
  /** statements the sector expects that no front section prints */
  missing: SectionKind[];
  /** the deepest section of each kind the front prints (income statement, balance sheet, cash flows, …) */
  statements: AuditStatement[];
  rows: { lines: number; old: number };
  fill: Record<AuditBand, AuditFill>;
  /** totals of the front sections, by period: all quarters and years, and the newest eight quarters */
  ties: { ok: number; off: number; partial: number; unchecked: number };
  ties8: { ok: number; off: number; partial: number; unchecked: number };
}

type Line = Extract<StatementRow, { kind: "line" }>;
const emptyFill = (): AuditFill => ({ slots: 0, cells: 0, held: 0, apart: 0 });
const emptyTies = () => ({ ok: 0, off: 0, partial: 0, unchecked: 0 });

/** Measure one payload (see the module comment). `sector` and `industry` as the page passes them. */
export function auditPayload(p: IrPayload, opts: { sector?: string | null; industry?: string | null } = {}): IrAudit {
  const sector = sectorOf(opts.sector, opts.industry);
  const secs = assembleStatements(p, { sector: opts.sector ?? "", industry: opts.industry ?? "" });
  const byKey = new Map<string, PayloadSeries>(p.series.map((s) => [s.k, s]));
  const quarters = periodGrids(p).q;
  const backOf = new Map(quarters.map((e, i) => [e, quarters.length - 1 - i]));
  const newest8 = new Set(quarters.slice(-8));
  const front = secs.filter((s) => s.group !== "more");
  const fill = Object.fromEntries(AUDIT_BANDS.map((b) => [b, emptyFill()])) as Record<AuditBand, AuditFill>;
  const ties = emptyTies();
  const ties8 = emptyTies();
  const best = new Map<SectionKind, AuditStatement>();
  let lines = 0;
  let old = 0;
  const stored = new Map(p.checks.map((c) => [`${c.k}|${c.kind === "fy" ? "y" : "q"}|${c.e}`, c]));
  const partial = linesLeftOut(p);

  for (const sec of front) {
    if (sec.basis === "ytd") continue;
    const own: { row: Line; cells: Record<string, unknown>; held: Record<string, unknown> }[] = [];
    const covered = new Set<string>();
    for (const r of sec.rows) {
      if (r.kind !== "line") continue;
      const rc = rowCells(r.ks, byKey, "q", r.at);
      const any = Object.keys(rc.cells).length + Object.keys(rc.held).length > 0;
      if (r.old) {
        old++;
        for (const e of Object.keys(rc.cells)) {
          const back = backOf.get(e);
          if (back != null) fill[bandOf(back)].apart++;
        }
        continue;
      }
      lines++;
      if (!any) continue;
      own.push({ row: r, cells: rc.cells, held: rc.held });
      for (const e of Object.keys(rc.cells)) covered.add(e);
    }
    const perQuarter = new Map<string, number>();
    for (const e of quarters) {
      if (!covered.has(e)) continue;
      const band = fill[bandOf(backOf.get(e)!)];
      let n = 0;
      for (const o of own) {
        band.slots++;
        if (o.cells[e]) {
          band.cells++;
          n++;
        } else if (o.held[e]) band.held++;
      }
      perQuarter.set(e, n);
    }
    // Depth of this section as a statement of its kind.
    const kind = sec.kind ?? sectionKind(sec, sector);
    if (own.length >= 3) {
      const need = Math.ceil(own.length * DEPTH_SHARE);
      const good = quarters.filter((e) => (perQuarter.get(e) ?? 0) >= need);
      const first = good[0] ?? null;
      const span = first ? quarters.filter((e) => e >= first) : [];
      const st: AuditStatement = {
        kind,
        title: sec.title,
        rows: own.length,
        old: sec.rows.filter((r) => r.kind === "line" && r.old).length,
        depth: good.length,
        first,
        holes: span.length - good.length,
      };
      const cur = best.get(kind);
      if (!cur || st.depth > cur.depth || (st.depth === cur.depth && st.rows > cur.rows)) best.set(kind, st);
    }
    // Totals by period.
    const checks = sectionChecks(sec, byKey, stored, partial);
    sec.rows.forEach((t) => {
      if (t.kind !== "line" || t.old) return;
      for (const freq of ["q", "y"] as const) {
        const tc = rowCells(t.ks, byKey, freq, t.at);
        for (const e of Object.keys(tc.cells)) {
          const found = checks.get(`${tc.from[e]}|${freq}|${e}`);
          const c = found && (t.total || found.by) ? found : undefined;
          // A line that is neither a total nor printed in bold is not expected to carry a check.
          if (!c && !t.total && !t.bold) continue;
          const what = !c ? "unchecked" : c.partial ? "partial" : c.ok ? "ok" : "off";
          ties[what]++;
          if (freq === "q" && newest8.has(e)) ties8[what]++;
        }
      }
    });
  }
  const count = (g: Statement["group"]) => secs.filter((s) => s.group === g).length;
  return {
    ticker: p.ticker,
    build: p.build ?? null,
    quarters: quarters.length,
    first: quarters[0] ?? null,
    last: quarters.at(-1) ?? null,
    sections: { main: count("main"), other: count("other"), more: count("more") },
    missing: missingStatements(secs, sector),
    statements: [...best.values()],
    rows: { lines, old },
    fill,
    ties,
    ties8,
  };
}

/** A company's fill ratio in a band, or null when it has no slot there. */
export const fillRatio = (f: AuditFill): number | null => (f.slots ? f.cells / f.slots : null);
