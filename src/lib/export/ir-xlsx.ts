// Investor-relations breakdowns as a styled Excel workbook: one sheet per breakdown type and period
// type, live formulas for calculated quarters/years and for every "parts = total" check, plus Checks
// and Data & sources sheets that trace each number to the stored document (and SEC.gov when filed).
import type { Workbook } from "exceljs";
import type { Scale } from "@/lib/format";
import type { IrPayload, PayloadCell, PayloadCheck, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";
import { groupOrder, groupTitle, inDimension, periodLabel, periodLong, rowLabel, unitCaption } from "@/lib/ir/display";
import {
  C,
  band,
  cellValue,
  col,
  cover,
  font,
  footer,
  hairline,
  inkHeader,
  link,
  linkFormula,
  loadExcel,
  numFmtFor,
  prepareSheet,
  rootRule,
  scaleWords,
  sheetName,
  sheetRef,
  solid,
  titleBlock,
  totalRule,
  unitShort,
  usdNeedsDecimals,
} from "@/lib/export/xlsx-theme";

export type IrFreq = "q" | "y";

export interface IrExportOptions {
  ticker: string;
  company?: string;
  cik?: string | null;
  payload: IrPayload;
  /** Breakdowns to include, already filtered; all of them when omitted. */
  groups?: PayloadGroup[];
  freqs: IrFreq[];
  /** Periods per period type; every period with data when omitted. */
  cols?: Partial<Record<IrFreq, string[]>>;
  scale: Scale;
  /** Describes what was exported, shown on the cover. */
  scope: string;
  /** App origin for "Open in Filed Under" links. */
  origin?: string;
  logo?: ArrayBuffer | null;
  /** Include the Data & sources sheet (default true). */
  sources?: boolean;
}

export interface IrExportStats {
  sheets: string[];
  breakdowns: number;
  values: number;
  formulas: number;
  checks: number;
}

const SECTIONS: { v: string; name: string; tab: string }[] = [
  { v: "revenue", name: "Revenue mix", tab: C.ink },
  { v: "profit", name: "Segment profit", tab: C.positive },
  { v: "cost", name: "Costs", tab: C.negative },
  { v: "kpi", name: "KPIs", tab: C.hyperlink },
  { v: "balance", name: "Balances", tab: C.warning },
  { v: "other", name: "Other lines", tab: C.muted },
];
export const sectionOf = (g: PayloadGroup) => SECTIONS.slice(0, -1).find((s) => inDimension(g, s.v))?.v ?? "other";

const KIND_ONE: Record<string, string> = {
  "press-release": "Earnings release",
  presentation: "Presentation",
  supplement: "Financial supplement",
  data: "Data file",
  transcript: "Transcript",
  image: "Slide image",
  report: "Report",
  "annual-report": "Annual report",
  proxy: "Proxy statement",
  "sec-copy": "SEC filing",
  other: "Exhibit",
};

const FREQ_WORD: Record<IrFreq, string> = { q: "Quarterly", y: "Annual" };
const FIRST = 3; // A = line, B = unit, C… = periods
const HEAD = 4; // header rows 4–5, data from row 7

interface Addr {
  sheet: string;
  ref: string;
  v: number;
}
interface LinePlan {
  kind: "line" | "residual";
  row: number;
  s: PayloadSeries;
  depth: number;
}
interface BlockPlan {
  g: PayloadGroup;
  root?: PayloadSeries;
  title: string;
  titleRow: number;
  lines: LinePlan[];
  checkRow?: number;
}
interface SheetPlan {
  name: string;
  freq: IrFreq;
  section: (typeof SECTIONS)[number];
  cols: string[];
  blocks: BlockPlan[];
}

const tolExpr = (unit: string, t: string) => (unit === "usd" ? `MAX(ABS(${t})*0.005,1500000)` : `MAX(ABS(${t})*0.005,1.5)`);
const tolOf = (unit: string, v: number) => (unit === "usd" ? Math.max(Math.abs(v) * 0.005, 1.5e6) : Math.max(Math.abs(v) * 0.005, 1.5));

export async function buildIrWorkbook(o: IrExportOptions): Promise<{ wb: Workbook; stats: IrExportStats }> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Filed Under";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  const p = o.payload;
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const groups = [...(o.groups ?? p.groups)].sort(groupOrder);
  const checkMap = new Map<string, PayloadCheck>();
  for (const c of p.checks) checkMap.set(`${c.k}|${c.kind === "fy" ? "y" : "q"}|${c.e}`, c);
  const cellsOf = (s: PayloadSeries, f: IrFreq) => (f === "q" ? s.q : s.y);
  const name = o.company ? `${o.company} (${o.ticker})` : o.ticker;
  const used = new Set<string>(["overview", "checks", "data & sources"]);

  // ---- Pass 1: lay out every sheet so formulas can reference cells on any sheet.
  const addr = new Map<string, Addr>();
  const plans: SheetPlan[] = [];
  for (const f of o.freqs) {
    const allCols = o.cols?.[f] ?? (f === "q" ? p.quarters : p.years);
    for (const section of SECTIONS) {
      const gs = groups.filter((g) => sectionOf(g) === section.v);
      const rowsOf = (g: PayloadGroup) => g.rows.map((r) => ({ ...r, s: byKey.get(r.k)! })).filter((r) => r.s && allCols.some((e) => cellsOf(r.s, f)[e]));
      const withData = gs.map((g) => ({ g, rows: rowsOf(g) })).filter((x) => x.rows.length);
      if (!withData.length) continue;
      // Trim leading/trailing periods that have nothing on this sheet.
      const has = allCols.map((e) => withData.some((x) => x.rows.some((r) => cellsOf(r.s, f)[e])));
      const lo = has.indexOf(true);
      const hi = has.lastIndexOf(true);
      const cols = allCols.slice(lo, hi + 1);
      const sheet = sheetName(o.freqs.length > 1 ? `${section.name} · ${f === "q" ? "Q" : "FY"}` : section.name, used);
      const plan: SheetPlan = { name: sheet, freq: f, section, cols, blocks: [] };
      let r = HEAD + 3;
      for (const { g, rows } of withData) {
        const root = g.root ? byKey.get(g.root) : undefined;
        const block: BlockPlan = { g, root, title: groupTitle(g, root), titleRow: r, lines: [] };
        r += 2; // title + caption
        const partial = root ? cols.some((e) => checkMap.get(`${root.k}|${f}|${e}`)?.partial) : false;
        for (const x of rows) {
          if (root && x.k === root.k && partial) block.lines.push({ kind: "residual", row: r++, s: x.s, depth: 1 });
          block.lines.push({ kind: "line", row: r, s: x.s, depth: x.depth });
          cols.forEach((e, j) => {
            const c = cellsOf(x.s, f)[e];
            if (c) addr.set(`${x.s.k}|${f}|${e}`, { sheet, ref: `${col(FIRST + j)}${r}`, v: cellValue(c.v, x.s.unit) });
          });
          r++;
        }
        if (root?.total && cols.some((e) => checkMap.has(`${root.k}|${f}|${e}`))) block.checkRow = r++;
        r++; // spacer
        plan.blocks.push(block);
      }
      plans.push(plan);
    }
  }

  // ---- Overview first (filled in at the end, once totals are known).
  const ov = wb.addWorksheet("Overview");
  const stats: IrExportStats = { sheets: [], breakdowns: 0, values: 0, formulas: 0, checks: 0 };

  // ---- Pass 2: write the breakdown sheets.
  const refTo = (here: string, a: Addr) => (a.sheet === here ? a.ref : `${sheetRef(a.sheet)}!${a.ref}`);
  for (const plan of plans) {
    const f = plan.freq;
    const last = FIRST + plan.cols.length - 1;
    const ws = wb.addWorksheet(plan.name);
    stats.sheets.push(plan.name);
    prepareSheet(ws, { freezeCols: 2, freezeRows: HEAD + 1, tab: plan.section.tab });
    ws.properties.outlineProperties = { summaryBelow: true, summaryRight: false };
    // exceljs marks a row "collapsed" when its level reaches outlineLevelRow; keep every group open.
    ws.properties.outlineLevelRow = Math.min(8, Math.max(0, ...plan.blocks.flatMap((b) => (b.root ? b.lines.map((l) => l.depth) : [0]))) + 1);
    ws.getColumn(1).width = 54;
    ws.getColumn(2).width = 7;
    plan.cols.forEach((_, j) => (ws.getColumn(FIRST + j).width = 12.5));
    titleBlock(
      ws,
      `${name} — ${plan.section.name}, ${FREQ_WORD[f].toLowerCase()}`,
      `Dollar amounts shown in ${scaleWords(o.scale)}; cells hold full values. Blue = printed in a document, black = formula, green = formula using another sheet.`,
      last,
    );
    ws.getRow(3).height = 6;
    const h1 = ws.getRow(HEAD);
    const h2 = ws.getRow(HEAD + 1);
    h1.getCell(1).value = "Line";
    h1.getCell(2).value = "Unit";
    h2.getCell(1).value = f === "q" ? "Quarter ended" : "Fiscal year ended";
    plan.cols.forEach((e, j) => {
      h1.getCell(FIRST + j).value = periodLabel(e, f);
      const d = h2.getCell(FIRST + j);
      d.value = new Date(`${e}T00:00:00Z`);
      d.numFmt = "d mmm yyyy";
    });
    inkHeader(h1, 1, last, { size: 10, height: 18, align: (c) => (c >= FIRST ? "right" : "left") });
    inkHeader(h2, 1, last, { size: 8, height: 14, align: (c) => (c >= FIRST ? "right" : "left") });
    for (let c = 1; c <= last; c++) h2.getCell(c).font = font({ size: 8, color: { argb: "FFC9C5BC" } });
    ws.pageSetup.printTitlesRow = `${HEAD}:${HEAD + 1}`;
    footer(ws, `${name} · ${plan.name}`);

    for (const b of plan.blocks) {
      stats.breakdowns++;
      const { root, g } = b;
      const unit = root?.unit ?? g.unit;
      const tr = ws.getRow(b.titleRow);
      tr.height = 18;
      tr.getCell(1).value = b.title;
      tr.getCell(1).font = font({ bold: true, size: 11, color: { argb: C.ink } });
      tr.getCell(1).alignment = { vertical: "middle" };
      band(tr, 1, last, C.paperDeep);
      const groupChecks = root?.total ? plan.cols.map((e) => checkMap.get(`${root.k}|${f}|${e}`)).filter((c): c is PayloadCheck => !!c) : [];
      const real = groupChecks.filter((c) => !c.partial);
      const lineCount = b.lines.filter((l) => l.kind === "line").length;
      const caption = [
        unitCaption(unit, o.scale),
        `${lineCount} line${lineCount === 1 ? "" : "s"}`,
        real.length ? (real.every((c) => c.ok) ? "every total ties out" : `${real.filter((c) => c.ok).length} of ${real.length} totals tie out`) : null,
        groupChecks.length > real.length ? "selected lines only — remainder shown as “Not itemized”" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const cr = ws.getRow(b.titleRow + 1);
      cr.getCell(1).value = caption;
      cr.getCell(1).font = font({ size: 8, italic: true, color: { argb: C.muted } });

      const kids = root ? b.lines.filter((l) => l.kind === "line" && l.s.parent === root.k) : [];
      const kidExpr = (e: string, j: number, sub?: string[]) => {
        const present = kids.filter((k) => cellsOf(k.s, f)[e]);
        const terms = present.map((k, i) => {
          const neg = sub?.includes(k.s.label);
          return `${i === 0 ? (neg ? "-" : "") : neg ? "-" : "+"}${col(FIRST + j)}${k.row}`;
        });
        const naive = present.reduce((n, k) => n + (sub?.includes(k.s.label) ? -1 : 1) * cellsOf(k.s, f)[e].v, 0);
        return { expr: terms.join("") || "0", naive, n: present.length };
      };

      for (const l of b.lines) {
        const r = ws.getRow(l.row);
        const s = l.s;
        const isRoot = root?.k === s.k;
        r.outlineLevel = root ? Math.min(l.depth, 7) : 0;
        const vals = plan.cols.map((e) => cellsOf(s, f)[e]?.v).filter((v): v is number => v != null);
        const fmt = numFmtFor(s.unit, o.scale, { decimals: s.unit === "usd" ? usdNeedsDecimals(vals) : s.unit === "count" && vals.some((v) => !Number.isInteger(v) && Math.abs(v) < 1000) });
        const label = r.getCell(1);
        if (l.kind === "residual") {
          label.value = "Not itemized in the release";
          label.font = font({ italic: true, color: { argb: C.muted } });
          label.alignment = { indent: 1 };
          r.getCell(2).value = unitShort(s.unit, o.scale);
          r.getCell(2).font = font({ size: 8, color: { argb: C.muted } });
          plan.cols.forEach((e, j) => {
            const x = r.getCell(FIRST + j);
            x.border = hairline;
            const chk = checkMap.get(`${s.k}|${f}|${e}`);
            const t = cellsOf(s, f)[e];
            if (!chk?.partial || !t) return;
            const { expr } = kidExpr(e, j, chk.sub);
            const tref = `${col(FIRST + j)}${l.row + 1}`;
            x.value = { formula: `${tref}-(${expr})`, result: chk.total - chk.sum };
            x.numFmt = fmt;
            x.font = font({ italic: true, color: { argb: C.muted } });
            stats.formulas++;
          });
          r.getCell(1).border = hairline;
          r.getCell(2).border = hairline;
          continue;
        }
        const scopeTag = s.sc && !isRoot && root?.sc !== s.sc ? ` · ${s.sc}` : "";
        label.value = `${isRoot ? s.label : rowLabel(s.label, root?.label)}${scopeTag}${s.pit ? " (period end)" : ""}`;
        label.font = font({ bold: s.total, color: { argb: C.ink } });
        label.alignment = { indent: root ? Math.min(l.depth, 8) : 0 };
        const u = r.getCell(2);
        u.value = unitShort(s.unit, o.scale);
        u.font = font({ size: 8, color: { argb: C.muted } });
        u.alignment = { horizontal: "center" };
        const border = isRoot ? rootRule : s.total ? totalRule : hairline;
        label.border = border;
        u.border = border;
        if (isRoot) band(r, 1, last, "FFFBFAF6");
        plan.cols.forEach((e, j) => {
          const x = r.getCell(FIRST + j);
          x.border = border;
          x.numFmt = fmt;
          const c: PayloadCell | undefined = cellsOf(s, f)[e];
          if (!c) return;
          stats.values++;
          const value = cellValue(c.v, s.unit);
          if (c.f) {
            // Calculated period: a live formula when every part is a cell in this workbook.
            const refs = c.f.parts.map((pt) => {
              const pf: IrFreq | null = pt.m === 12 ? "y" : pt.m === 3 ? "q" : null;
              const a = pf ? addr.get(`${s.k}|${pf}|${pt.e}`) : undefined;
              return a && Math.abs(a.v - cellValue(pt.v, s.unit)) <= Math.max(1e-6, Math.abs(a.v) * 1e-9) ? { a, sign: pt.sign } : null;
            });
            if (refs.length && refs.every(Boolean)) {
              const formula = refs.map((x2, i) => `${x2!.sign < 0 ? "-" : i ? "+" : ""}${refTo(plan.name, x2!.a)}`).join("");
              x.value = { formula, result: value };
              x.font = font({ italic: true, bold: s.total, color: { argb: refs.some((x2) => x2!.a.sheet !== plan.name) ? C.link : C.formula } });
              stats.formulas++;
            } else {
              x.value = value;
              x.font = font({ italic: true, bold: s.total, color: { argb: C.inkSoft } });
              x.note = `${c.f.formula}\n${c.f.parts.map((pt) => `${pt.sign < 0 ? "−" : "+"} ${pt.label} (${pt.m} months to ${pt.e})`).join("\n")}`;
            }
          } else {
            x.value = value;
            x.font = font({ bold: s.total, color: { argb: C.input } });
          }
          if (c.w === "scale") {
            x.fill = solid(C.attention);
            x.note = "About 1,000× off the neighbouring periods — a different unit or measure may have been read here. Check the source.";
          }
        });
      }

      if (b.checkRow && root) {
        const r = ws.getRow(b.checkRow);
        const rootLine = b.lines.find((l) => l.kind === "line" && l.s.k === root.k)!;
        r.getCell(1).value = "Check: parts − total";
        r.getCell(1).font = font({ size: 8, italic: true, color: { argb: C.muted } });
        r.getCell(1).alignment = { indent: 1 };
        plan.cols.forEach((e, j) => {
          const chk = checkMap.get(`${root.k}|${f}|${e}`);
          const x = r.getCell(FIRST + j);
          x.alignment = { horizontal: "right" };
          if (!chk) return;
          stats.checks++;
          const tref = `${col(FIRST + j)}${rootLine.row}`;
          const { expr, naive } = kidExpr(e, j, chk.sub);
          if (chk.partial) {
            x.value = { formula: `IFERROR((${expr})/${tref},"")`, result: chk.sum / chk.total };
            x.numFmt = '0%" listed"';
            x.font = font({ size: 8, color: { argb: C.muted } });
            stats.formulas++;
            return;
          }
          const sameParts = Math.abs(naive - chk.sum) <= tolOf(root.unit, chk.total) * 0.2;
          if (sameParts) {
            const t = tref;
            x.value = {
              formula: `IF(ABS((${expr})-${t})<=${tolExpr(root.unit, t)},"✓",(${expr})-${t})`,
              result: chk.ok ? "✓" : chk.sum - chk.total,
            };
            stats.formulas++;
          } else {
            x.value = chk.ok ? "✓" : chk.sum - chk.total;
            x.note = `Filed Under matched ${chk.n} lines for this total${chk.sub?.length ? ` (subtracting ${chk.sub.join(", ")})` : ""} — including a line printed in a neighbouring table or the parts of a subtotal not printed this period — so this check is a stored result rather than a formula.`;
          }
          x.numFmt = numFmtFor(root.unit, o.scale, { decimals: true });
          x.font = font({ size: 9, bold: chk.ok, color: { argb: chk.ok ? C.positive : C.warning } });
          if (!chk.ok) x.fill = solid(C.warningSoft);
        });
      }
    }
  }

  // ---- Checks sheet: every tie-out in the export, nested subtotals included.
  const inExport = new Set(plans.flatMap((pl) => pl.blocks.flatMap((b) => b.lines.map((l) => `${l.s.k}|${pl.freq}`))));
  const colSets = new Map(plans.map((pl) => [`${pl.name}`, new Set(pl.cols)]));
  const sheetOf = new Map<string, { sheet: string; block: BlockPlan }>();
  for (const pl of plans) for (const b of pl.blocks) for (const l of b.lines) sheetOf.set(`${l.s.k}|${pl.freq}`, { sheet: pl.name, block: b });
  const checkRows = p.checks.filter((c) => {
    const f: IrFreq = c.kind === "fy" ? "y" : "q";
    const at = sheetOf.get(`${c.k}|${f}`);
    return inExport.has(`${c.k}|${f}`) && at && colSets.get(at.sheet)?.has(c.e);
  });
  if (checkRows.length) {
    const ws = wb.addWorksheet("Checks");
    stats.sheets.push("Checks");
    prepareSheet(ws, { freezeRows: HEAD, tab: C.positive });
    const head = ["Sheet", "Breakdown", "Total line", "Period", "Period end", "Printed total", "Sum of parts", "Difference", "Parts", "Subtracted", "Status"];
    const widths = [20, 40, 40, 10, 12, 16, 16, 14, 7, 22, 26];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    titleBlock(ws, `${name} — tie-out checks`, "Every printed total compared with the sum of its listed parts. Tolerance: 0.5% or $1.5 million, whichever is larger (rounding in the releases).", head.length);
    const hr = ws.getRow(HEAD);
    head.forEach((h, i) => (hr.getCell(i + 1).value = h));
    inkHeader(hr, 1, head.length, { height: 18, align: (c) => (c >= 6 && c <= 9 ? "right" : "left") });
    let r = HEAD + 1;
    const sorted = [...checkRows].sort((a, b) => (sheetOf.get(`${a.k}|${a.kind === "fy" ? "y" : "q"}`)!.sheet.localeCompare(sheetOf.get(`${b.k}|${b.kind === "fy" ? "y" : "q"}`)!.sheet)) || a.k.localeCompare(b.k) || a.e.localeCompare(b.e));
    for (const c of sorted) {
      const f: IrFreq = c.kind === "fy" ? "y" : "q";
      const s = byKey.get(c.k);
      const at = sheetOf.get(`${c.k}|${f}`)!;
      const row = ws.getRow(r);
      const fmt = numFmtFor(s?.unit ?? "usd", o.scale, { decimals: true });
      const status = c.partial ? `Selected lines (${Math.round((c.sum / c.total) * 100)}% listed)` : c.ok ? "Ties" : "Off";
      row.values = [at.sheet, at.block.title, s?.label ?? c.k, periodLabel(c.e, f), new Date(`${c.e}T00:00:00Z`), c.total, c.sum, null, c.n, c.sub?.join(", ") ?? "", status];
      row.getCell(5).numFmt = "d mmm yyyy";
      row.getCell(6).numFmt = fmt;
      row.getCell(7).numFmt = fmt;
      row.getCell(8).value = { formula: `G${r}-F${r}`, result: c.sum - c.total };
      row.getCell(8).numFmt = fmt;
      const target = addr.get(`${c.k}|${f}|${c.e}`);
      if (target) link(row.getCell(1), at.sheet, `#${sheetRef(target.sheet)}!${target.ref}`);
      for (let i = 1; i <= head.length; i++) {
        const x = row.getCell(i);
        if (i !== 1) x.font = font({ size: 9, color: { argb: i === 6 || i === 7 ? C.input : C.formula } });
        x.border = hairline;
      }
      const st = row.getCell(11);
      st.font = font({ size: 9, bold: true, color: { argb: c.partial ? C.muted : c.ok ? C.positive : C.warning } });
      st.fill = solid(c.partial ? C.band : c.ok ? C.positiveSoft : C.warningSoft);
      r++;
    }
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: r - 1, column: head.length } };
    footer(ws, `${name} · Checks`);
  }

  // ---- Data & sources: one row per value (and per part of a calculated value), pivot-ready.
  if (o.sources !== false && plans.length) {
    const ws = wb.addWorksheet("Data & sources");
    stats.sheets.push("Data & sources");
    prepareSheet(ws, { freezeRows: HEAD, tab: C.inkSoft });
    const head = ["Sheet", "Breakdown", "Line", "Parent line", "Unit", "Period", "Period end", "Months", "Value", "How it was obtained", "Printed as", "Document", "Filed", "Accession", "Location in document", "Open in Filed Under", "SEC filing"];
    const widths = [18, 34, 40, 30, 7, 9, 12, 8, 16, 44, 14, 22, 11, 22, 26, 18, 14];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    titleBlock(ws, `${name} — data & sources`, "Long format for pivot tables and lookups. Values in full units (percentages as fractions). Links open the stored document at the exact cell.", head.length);
    const hr = ws.getRow(HEAD);
    head.forEach((h, i) => (hr.getCell(i + 1).value = h));
    inkHeader(hr, 1, head.length, { height: 18, align: (c) => (c === 9 || c === 8 ? "right" : "left") });
    let r = HEAD + 1;
    const cik = o.cik ? String(Number(o.cik)) : null;
    const secUrl = (accn: string | null, doc: string | null) => (cik && accn && doc ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${doc}` : null);
    const where = (l: PayloadCell["l"]) => (!l ? "" : Array.isArray(l) ? `Table ${l[0] + 1}, row ${l[1] + 1}, column ${l[2] + 1}` : `Page ${l.p}`);
    const docCols = (d: number | undefined) => {
      const doc = d != null ? p.docs[d] : undefined;
      return { kind: doc ? (KIND_ONE[doc.kind ?? ""] ?? doc.kind ?? "Document") : "", filed: doc?.filed ?? "", accn: doc?.accn ?? "", sec: doc ? secUrl(doc.accn, doc.doc) : null };
    };
    const deep = (k: string, f: IrFreq, e: string) => (o.origin ? `${o.origin}/app/companies/${o.ticker}/ir?line=${encodeURIComponent(k)}&period=${e}&freq=${f}` : null);
    for (const pl of plans) {
      for (const b of pl.blocks) {
        for (const l of b.lines) {
          if (l.kind !== "line") continue;
          const s = l.s;
          const parent = s.parent ? byKey.get(s.parent)?.label ?? "" : "";
          const fmt = numFmtFor(s.unit, "full", { decimals: true });
          for (const e of pl.cols) {
            const c = cellsOf(s, pl.freq)[e];
            if (!c) continue;
            const d = docCols(c.d);
            const row = ws.getRow(r);
            row.values = [
              pl.name,
              b.title,
              s.label,
              parent,
              unitShort(s.unit, "full"),
              periodLabel(e, pl.freq),
              new Date(`${e}T00:00:00Z`),
              c.m ?? (pl.freq === "q" ? 3 : 12),
              cellValue(c.v, s.unit),
              c.f ? `Calculated: ${c.f.formula}` : "Printed",
              c.x ?? "",
              c.f ? "" : d.kind,
              c.f ? "" : d.filed,
              c.f ? "" : d.accn,
              c.f ? "" : where(c.l),
            ];
            row.getCell(7).numFmt = "d mmm yyyy";
            row.getCell(9).numFmt = s.unit === "pct" ? "0.0%" : fmt;
            row.getCell(9).font = font({ size: 9, italic: !!c.f, color: { argb: c.f ? C.inkSoft : C.input } });
            const url = deep(s.k, pl.freq, e);
            if (url) linkFormula(row.getCell(16), "Open source", url);
            if (!c.f && d.sec) linkFormula(row.getCell(17), "SEC.gov", d.sec);
            for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]) row.getCell(i).font = font({ size: 9, color: { argb: i === 10 && c.f ? C.inkSoft : C.formula } });
            r++;
            if (c.f) {
              for (const pt of c.f.parts) {
                const pd = docCols(pt.d);
                const prow = ws.getRow(r);
                prow.values = [pl.name, b.title, `   ↳ ${pt.sign < 0 ? "minus" : "plus"} ${pt.label}`, s.label, unitShort(s.unit, "full"), "", new Date(`${pt.e}T00:00:00Z`), pt.m, cellValue(pt.sign * pt.v, s.unit), `Part of ${periodLabel(e, pl.freq)} calculation`, pt.x ?? "", pd.kind, pd.filed, pd.accn, where(pt.l)];
                prow.getCell(7).numFmt = "d mmm yyyy";
                prow.getCell(9).numFmt = s.unit === "pct" ? "0.0%" : fmt;
                for (let i = 1; i <= 15; i++) prow.getCell(i).font = font({ size: 8, color: { argb: i === 9 ? C.input : C.muted } });
                if (pd.sec) linkFormula(prow.getCell(17), "SEC.gov", pd.sec);
                r++;
              }
            }
          }
        }
      }
    }
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: Math.max(HEAD + 1, r - 1), column: head.length } };
    footer(ws, `${name} · Data & sources`);
  }

  // ---- Overview: cover facts, legend and a linked table of contents.
  const st = p.stats;
  const nextRow = cover(wb, ov, {
    title: `${name}`,
    subtitle: "Segment & KPI breakdowns from investor-relations documents",
    logo: o.logo,
    facts: [
      ["Exported", new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })],
      ["Data updated", new Date(p.builtAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })],
      ["Scope", o.scope],
      ["Period types", o.freqs.map((f) => FREQ_WORD[f]).join(" and ")],
      ["Dollar display", `${scaleWords(o.scale)} — cells hold full values, so formulas and pivots stay exact`],
      ["Coverage", st.firstPeriod && st.lastPeriod ? `${periodLong(st.firstPeriod, "q").replace(/^Quarter ended /, "")} – ${periodLong(st.lastPeriod, "q").replace(/^Quarter ended /, "")}` : "—"],
      ["In this workbook", `${stats.breakdowns.toLocaleString()} breakdowns · ${stats.values.toLocaleString()} values · ${stats.formulas.toLocaleString()} live formulas · ${stats.checks.toLocaleString()} tie-out checks`],
      ["Totals tie out (all data)", `Quarterly ${st.checksQ.total ? Math.round((st.checksQ.ok / st.checksQ.total) * 100) : 0}% (${st.checksQ.ok.toLocaleString()} of ${st.checksQ.total.toLocaleString()}) · annual ${st.checksFY.total ? Math.round((st.checksFY.ok / st.checksFY.total) * 100) : 0}% (${st.checksFY.ok.toLocaleString()} of ${st.checksFY.total.toLocaleString()})`],
      ["Source documents", `${st.documents.toLocaleString()} stored earnings releases, supplements, presentations and data files`],
    ],
    legend: [
      { sample: "1,234.5", style: { color: { argb: C.input } }, text: "Printed in a company document (input). The Data & sources sheet links each one to the stored document at that cell." },
      { sample: "1,234.5", style: { italic: true, color: { argb: C.formula } }, text: "Calculated with a live formula from cells on the same sheet." },
      { sample: "1,234.5", style: { italic: true, color: { argb: C.link } }, text: "Calculated with a live formula that uses another sheet — e.g. fourth quarter = full year (annual sheet) − first three quarters." },
      { sample: "1,234.5", style: { italic: true, color: { argb: C.inkSoft } }, text: "Calculated by Filed Under from figures not in this workbook (e.g. nine-month year-to-date); the cell note shows the formula." },
      { sample: "✓", style: { bold: true, color: { argb: C.positive } }, text: "Check row: the listed parts add up to the printed total (within rounding). A number is the difference when they don't." },
      { sample: "1,234.5", style: { color: { argb: C.input } }, fill: C.attention, text: "About 1,000× off the neighbouring periods — likely read in a different unit. Check the source." },
      { sample: "Not itemized", style: { italic: true, color: { argb: C.muted } }, text: "The release lists selected lines only; this row is the printed total minus the listed lines." },
      { sample: "[ + ]", style: { color: { argb: C.muted } }, text: "Use Excel's outline buttons in the left margin to collapse a breakdown to its totals." },
    ],
  });
  let r = nextRow + 1;
  ov.getCell(r, 2).value = "Contents";
  ov.getCell(r, 2).font = font({ bold: true, size: 10, color: { argb: C.ink } });
  r++;
  const hr = ov.getRow(r);
  ["", "Sheet", "Breakdown", "Lines", "Totals tie out", "Latest period"].forEach((h, i) => i && (hr.getCell(i + 1).value = h));
  inkHeader(hr, 2, 6, { height: 16, align: (c) => (c >= 4 ? "right" : "left") });
  r++;
  for (const pl of plans) {
    for (const b of pl.blocks) {
      const row = ov.getRow(r);
      row.getCell(2).value = pl.name;
      row.getCell(2).font = font({ size: 9, color: { argb: C.muted } });
      link(row.getCell(3), b.title, `#${sheetRef(pl.name)}!A${b.titleRow}`);
      row.getCell(3).font = font({ size: 9, color: { argb: C.hyperlink }, underline: true });
      row.getCell(4).value = b.lines.filter((l) => l.kind === "line").length;
      const cks = b.root?.total ? pl.cols.map((e) => checkMap.get(`${b.root!.k}|${pl.freq}|${e}`)).filter((c): c is PayloadCheck => !!c && !c.partial) : [];
      row.getCell(5).value = cks.length ? `${cks.filter((c) => c.ok).length} of ${cks.length}` : "—";
      row.getCell(5).font = font({ size: 9, color: { argb: cks.length && cks.every((c) => c.ok) ? C.positive : cks.length ? C.warning : C.muted } });
      const lastE = [...pl.cols].reverse().find((e) => b.lines.some((l) => cellsOf(l.s, pl.freq)[e]));
      row.getCell(6).value = lastE ? periodLabel(lastE, pl.freq) : "";
      for (const i of [4, 5, 6]) row.getCell(i).alignment = { horizontal: "right" };
      for (const i of [4, 6]) row.getCell(i).font = font({ size: 9 });
      for (let i = 2; i <= 6; i++) row.getCell(i).border = hairline;
      r++;
    }
  }
  footer(ov, `${name} · Overview`);
  return { wb, stats };
}

export async function irWorkbookBlob(o: IrExportOptions) {
  const { wb, stats } = await buildIrWorkbook(o);
  const buf = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), stats };
}
