// Excel model: the standardized statements workbook (live formulas, Sources sheet) extended with a source note on
// every reported cell, a segments sheet, an IR KPI sheet and a sheet listing every formula with its inputs.
import type { Comment, Workbook, Worksheet } from "exceljs";
import { supabase } from "@/integrations/supabase/client";
import { buildFinancialsWorkbook } from "@/lib/export/xlsx";
import { C, downloadBlob, font, hairline, inkHeader, link, prepareSheet, titleBlock, workbookBlob } from "@/lib/export/xlsx-theme";
import type { CompanyDataset, StatementKey } from "@/lib/financials/types";
import { edgarUrl } from "./dossier";

// Layout of buildFinancialsWorkbook (lib/export/xlsx.ts): label column A, periods from column C, data from row 7.
const SHEET_OF: Record<StatementKey, string> = { income: "Income statement", balance: "Balance sheet", cashflow: "Cash flow", kpis: "Ratios & KPIs" };
const FIRST = 3;
const DATA0 = 7;
const HEAD = 4;

export interface IrKpiFact {
  metric: string;
  label: string;
  category: string;
  breakdown: string | null;
  period_label: string;
  period_end: string | null;
  value: number;
  unit: string;
  accn: string | null;
  doc: string | null;
  filed: string | null;
  document_kind: string | null;
  derived: boolean;
}

export interface ModelStats {
  notes: number;
  formulas: number;
  segments: number;
  irKpis: number;
  layoutMismatch: string[];
}

/** Attach a note (Excel comment) with the filing to every reported or derived statement cell. */
export function annotateSources(wb: Workbook, d: CompanyDataset, freq: "annual" | "quarterly", periods?: number): { notes: number; mismatch: string[] } {
  const filings = new Map(d.filings.map((f) => [f.accn, f]));
  let notes = 0;
  const mismatch: string[] = [];
  for (const key of Object.keys(SHEET_OF) as StatementKey[]) {
    const ws = wb.getWorksheet(SHEET_OF[key]);
    const st = d.statements[freq][key];
    if (!ws || !st) continue;
    const start = periods ? Math.max(0, st.periods.length - periods) : 0;
    st.rows.forEach((row, ri) => {
      const r = ws.getRow(DATA0 + ri);
      if (String(r.getCell(1).value ?? "") !== row.label) {
        mismatch.push(`${SHEET_OF[key]} row ${DATA0 + ri}`);
        return;
      }
      for (let j = 0; start + j < row.cells.length; j++) {
        const c = row.cells[start + j];
        if (!c) continue;
        const xl = r.getCell(FIRST + j);
        let note: string | null = null;
        if (c.src?.accn) {
          const f = filings.get(c.src.accn);
          note = `Reported: ${c.src.concept}\n${f ? `${f.form} filed ${f.filed}` : "SEC filing"}, accession ${c.src.accn}\nPeriod ${c.src.start ? `${c.src.start} to ` : ""}${c.src.end}\n${edgarUrl(d.profile.cik, c.src.accn, c.src.doc ?? f?.doc)}`;
          if (c.alts?.length) note += `\nAlso reported in ${c.alts.length} other filing${c.alts.length === 1 ? "" : "s"}`;
        } else if (c.derived) {
          note = `Calculated: ${c.derived.formula}\n${c.derived.parts
            .slice(0, 6)
            .map((pt) => `${pt.sign < 0 ? "−" : "+"} ${pt.label}: ${pt.concept} (${filings.get(pt.accn)?.form ?? "filing"} ${pt.accn})`)
            .join("\n")}`;
        }
        if (note) {
          xl.note = { texts: [{ text: note, font: { size: 8, name: "Arial" } }] } satisfies Comment;
          notes++;
        }
      }
    });
  }
  return { notes, mismatch };
}

function listFormulas(wb: Workbook): { sheet: string; cell: string; label: string; formula: string }[] {
  const out: { sheet: string; cell: string; label: string; formula: string }[] = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const v = cell.value as { formula?: string } | null;
        if (v && typeof v === "object" && typeof v.formula === "string") out.push({ sheet: ws.name, cell: cell.address, label: String(row.getCell(1).value ?? ""), formula: v.formula });
      });
    });
  });
  return out;
}

function header(ws: Worksheet, cols: { h: string; w: number }[]) {
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));
  const hr = ws.getRow(HEAD);
  cols.forEach((c, i) => (hr.getCell(i + 1).value = c.h));
  inkHeader(hr, 1, cols.length, { height: 18 });
}

export async function fetchIrKpis(ticker: string, limit = 4000): Promise<IrKpiFact[]> {
  const { data, error } = await supabase
    .from("ir_kpi_facts")
    .select("metric,label,category,breakdown,period_label,period_end,value,unit,accn,doc,filed,document_kind,derived")
    .eq("ticker", ticker)
    .order("period_end", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as IrKpiFact[];
}

export async function buildModelWorkbook(d: CompanyDataset, o: { irKpis?: IrKpiFact[]; periods?: number; logo?: ArrayBuffer | null } = {}) {
  const { wb, formulas } = await buildFinancialsWorkbook(d, "quarterly", "M", o.periods, o.logo ?? null);
  const ann = annotateSources(wb, d, "quarterly", o.periods);
  const cik = d.profile.cik;
  const name = `${d.profile.name} (${d.profile.ticker})`;

  // Segments
  const seg = wb.addWorksheet("Segments");
  prepareSheet(seg, { freezeRows: HEAD, tab: C.positive });
  titleBlock(seg, `${name} — segments`, "Segment facts tagged in XBRL filings (axis, member, metric, period), each with its filing.", 9);
  header(seg, [
    { h: "Breakdown", w: 26 },
    { h: "Member", w: 34 },
    { h: "Metric", w: 16 },
    { h: "Period", w: 22 },
    { h: "Value (US$)", w: 18 },
    { h: "XBRL concept", w: 40 },
    { h: "Accession", w: 22 },
    { h: "Filed", w: 12 },
    { h: "Filing", w: 14 },
  ]);
  const filings = new Map(d.filings.map((f) => [f.accn, f]));
  const segs = [...d.segments].sort((a, b) => b.end.localeCompare(a.end) || a.axisLabel.localeCompare(b.axisLabel));
  segs.forEach((f, i) => {
    const r = seg.getRow(HEAD + 1 + i);
    r.values = [f.axisLabel, f.label, f.metric, f.start ? `${f.start} to ${f.end}` : f.end, f.value, f.concept, f.accn, filings.get(f.accn)?.filed ?? ""];
    r.getCell(5).numFmt = "#,##0;(#,##0)";
    for (let c = 1; c <= 9; c++) {
      r.getCell(c).font = font({ size: 9, color: { argb: c === 5 ? C.input : C.formula } });
      r.getCell(c).border = hairline;
    }
    link(r.getCell(9), "SEC.gov", edgarUrl(cik, f.accn, filings.get(f.accn)?.doc));
  });
  if (segs.length) seg.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + segs.length, column: 9 } };

  // IR KPIs
  const kpis = o.irKpis ?? [];
  const kws = wb.addWorksheet("IR KPIs");
  prepareSheet(kws, { freezeRows: HEAD, tab: C.hyperlink });
  titleBlock(kws, `${name} — investor-relations KPIs`, "Operating metrics read from press releases, supplements and presentations, with the source document.", 10);
  header(kws, [
    { h: "Category", w: 16 },
    { h: "Metric", w: 40 },
    { h: "Breakdown", w: 22 },
    { h: "Period", w: 14 },
    { h: "Period end", w: 12 },
    { h: "Value", w: 16 },
    { h: "Unit", w: 10 },
    { h: "Basis", w: 12 },
    { h: "Document", w: 18 },
    { h: "Filed", w: 12 },
  ]);
  kpis.forEach((k, i) => {
    const r = kws.getRow(HEAD + 1 + i);
    r.values = [k.category, k.label, k.breakdown ?? "", k.period_label, k.period_end ?? "", k.value, k.unit, k.derived ? "Calculated" : "Reported", k.document_kind ?? "", k.filed ?? ""];
    r.getCell(6).numFmt = k.unit === "pct" ? "0.0%" : "#,##0.##";
    for (let c = 1; c <= 10; c++) {
      r.getCell(c).font = font({ size: 9, color: { argb: c === 6 ? C.input : C.formula } });
      r.getCell(c).border = hairline;
    }
    if (k.accn) link(r.getCell(9), k.document_kind ?? "Filing", edgarUrl(cik, k.accn, k.doc));
  });
  if (kpis.length) kws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + kpis.length, column: 10 } };
  else kws.getCell(HEAD + 1, 1).value = "No IR KPIs extracted for this company yet.";

  // Formulas
  const fl = listFormulas(wb);
  const fws = wb.addWorksheet("Inputs & formulas");
  prepareSheet(fws, { freezeRows: HEAD, tab: C.inkSoft });
  titleBlock(fws, `${name} — formulas`, "Every live formula in this workbook, where it is and what it computes. Blue cells elsewhere are reported inputs; their notes cite the filing.", 4);
  header(fws, [
    { h: "Sheet", w: 20 },
    { h: "Cell", w: 8 },
    { h: "Line item", w: 44 },
    { h: "Formula", w: 80 },
  ]);
  fl.forEach((f, i) => {
    const r = fws.getRow(HEAD + 1 + i);
    r.values = [f.sheet, f.cell, f.label, `=${f.formula}`];
    for (let c = 1; c <= 4; c++) {
      r.getCell(c).font = font({ size: 9, color: { argb: C.formula } });
      r.getCell(c).border = hairline;
    }
  });

  return { wb, stats: { notes: ann.notes, formulas, segments: segs.length, irKpis: kpis.length, layoutMismatch: ann.mismatch } as ModelStats };
}

export async function exportModel(d: CompanyDataset) {
  const irKpis = await fetchIrKpis(d.profile.ticker);
  const { wb, stats } = await buildModelWorkbook(d, { irKpis });
  downloadBlob(await workbookBlob(wb), `${d.profile.ticker}-model-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return stats;
}
