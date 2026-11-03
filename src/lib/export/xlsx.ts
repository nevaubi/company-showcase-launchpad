// Excel model export: one sheet per statement with live formulas for calculated lines, plus a
// Sources sheet that maps every number to its SEC filing. Styled with the shared Filed Under theme;
// exceljs is loaded on demand so it never weighs on page loads.
import type { CompanyDataset, Period, Row, Statement, StatementKey } from "@/lib/financials/types";
import { unitLabel, type Scale } from "@/lib/format";
import {
  C,
  col,
  cover,
  downloadBlob,
  fetchLogo,
  font,
  footer,
  hairline,
  inkHeader,
  link,
  loadExcel,
  numFmtFor,
  prepareSheet,
  scaleWords,
  sheetRef,
  solid,
  titleBlock,
  totalRule,
  workbookBlob,
} from "@/lib/export/xlsx-theme";

type Freq = "annual" | "quarterly";

const SHEETS: { key: StatementKey; name: string; tab: string }[] = [
  { key: "income", name: "Income statement", tab: C.ink },
  { key: "balance", name: "Balance sheet", tab: C.hyperlink },
  { key: "cashflow", name: "Cash flow", tab: C.positive },
  { key: "kpis", name: "Ratios & KPIs", tab: C.warning },
];

const FIRST = 3; // A = label, B = unit, C… = periods
const HEAD = 4; // header rows 4–5
const DATA0 = HEAD + 3; // first statement row

function numFmt(row: Row, scale: Scale) {
  switch (row.unit) {
    case "usd":
      return numFmtFor("usd", scale);
    case "shares": {
      const body = scale === "full" ? "#,##0" : scale === "K" ? "#,##0," : scale === "M" ? "#,##0.0,," : "#,##0.00,,,";
      return `${body};(${body});"–"`;
    }
    case "usdPerShare":
      return '$0.00;($0.00);"–"';
    case "pct":
      return '0.0%;(0.0%);"–"';
    case "ratio":
      return '0.00"×";(0.00"×");"–"';
    case "days":
      return '0;(0);"–"';
  }
}

interface Ref {
  sheet: string;
  row: number;
}

/** Formula templates for calculated lines, referencing other lines by key. */
type Formula = (cell: (key: string, offset?: number) => string | null) => string | null;
const FORMULAS: Partial<Record<StatementKey, Record<string, Formula>>> = {
  income: {
    grossProfit: (c) => (c("revenue") && c("costOfRevenue") ? `${c("revenue")}-${c("costOfRevenue")}` : null),
    ebitda: (c) => (c("operatingIncome") && c("cashflow.dna") ? `${c("operatingIncome")}+${c("cashflow.dna")}` : null),
  },
  balance: {
    netDebt: (c) => (c("totalDebt") && c("cash") ? `${c("totalDebt")}-${c("cash")}${c("shortTermInvestments") ? `-${c("shortTermInvestments")}` : ""}` : null),
  },
  cashflow: {
    fcf: (c) => (c("cfo") && c("capex") ? `${c("cfo")}-${c("capex")}` : null),
  },
  kpis: {
    grossMargin: (c) => ratio(c("income.grossProfit"), c("income.revenue")),
    operatingMargin: (c) => ratio(c("income.operatingIncome"), c("income.revenue")),
    ebitdaMargin: (c) => ratio(c("income.ebitda"), c("income.revenue")),
    netMargin: (c) => ratio(c("income.netIncome"), c("income.revenue")),
    fcfMargin: (c) => ratio(c("cashflow.fcf"), c("income.revenue")),
    rndIntensity: (c) => ratio(c("income.rnd"), c("income.revenue")),
    capexIntensity: (c) => ratio(c("cashflow.capex"), c("income.revenue")),
    sbcIntensity: (c) => ratio(c("cashflow.sbc"), c("income.revenue")),
    taxRate: (c) => ratio(c("income.incomeTax"), c("income.pretaxIncome")),
    currentRatio: (c) => ratio(c("balance.currentAssets"), c("balance.currentLiabilities")),
    debtToEquity: (c) => ratio(c("balance.totalDebt") ?? c("balance.longTermDebt"), c("balance.equity")),
    fcfConversion: (c) => ratio(c("cashflow.fcf"), c("income.netIncome")),
    payoutRatio: (c) => ratio(c("cashflow.dividends"), c("income.netIncome")),
    interestCoverage: (c) => ratio(c("income.operatingIncome"), c("income.interestExpense")),
    revenueGrowth: (c) => growth(c("income.revenue"), c("income.revenue", -1)),
    netIncomeGrowth: (c) => growth(c("income.netIncome"), c("income.netIncome", -1)),
    epsGrowth: (c) => growth(c("income.epsDiluted"), c("income.epsDiluted", -1)),
    fcfGrowth: (c) => growth(c("cashflow.fcf"), c("cashflow.fcf", -1)),
  },
};
const ratio = (a: string | null, b: string | null) => (a && b ? `IFERROR(${a}/${b},"")` : null);
const growth = (a: string | null, b: string | null) => (a && b ? `IFERROR(${a}/${b}-1,"")` : null);

/** Index of the same fiscal period one year earlier (annual: previous column; quarterly: same quarter). */
function priorYearIndex(periods: Period[], i: number) {
  const p = periods[i];
  return periods.findIndex((q) => q.fy === p.fy - 1 && (q.fq ?? 0) === (p.fq ?? 0));
}

export async function buildFinancialsWorkbook(d: CompanyDataset, freq: Freq, scale: Scale, periods?: number, logo?: ArrayBuffer | null) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Filed Under";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const ticker = d.profile.ticker;
  const name = `${d.profile.name} (${ticker})`;
  const statements = d.statements[freq];
  const allPeriods = statements.income.periods;
  const startIdx = periods ? Math.max(0, allPeriods.length - periods) : 0;
  const ps = allPeriods.slice(startIdx);
  const filings = new Map(d.filings.map((f) => [f.accn, f]));
  const cik = Number(d.profile.cik);
  const filingUrl = (accn: string) => {
    const f = filings.get(accn);
    return `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${f?.doc ?? ""}`;
  };
  const last = FIRST + ps.length - 1;
  let formulas = 0;
  let values = 0;

  // Row positions for cross-sheet references.
  const where = new Map<string, Ref>();
  for (const s of SHEETS) statements[s.key].rows.forEach((r, i) => where.set(`${s.key}.${r.key}`, { sheet: s.name, row: DATA0 + i }));

  const ov = wb.addWorksheet("Overview");

  for (const s of SHEETS) {
    const st: Statement = statements[s.key];
    const ws = wb.addWorksheet(s.name);
    prepareSheet(ws, { freezeCols: 2, freezeRows: HEAD + 1, tab: s.tab });
    ws.getColumn(1).width = 48;
    ws.getColumn(2).width = 8;
    ps.forEach((_, j) => (ws.getColumn(FIRST + j).width = 13));
    titleBlock(ws, `${name} — ${s.name}, ${freq}`, `Dollar amounts shown in ${scaleWords(scale)}; cells hold full values. Blue = reported in an SEC filing, black = formula, green = formula using another sheet.`, last);
    ws.getRow(3).height = 6;
    const h1 = ws.getRow(HEAD);
    const h2 = ws.getRow(HEAD + 1);
    h1.getCell(1).value = "Line item";
    h1.getCell(2).value = "Unit";
    h2.getCell(1).value = freq === "annual" ? "Fiscal year ended" : "Quarter ended";
    ps.forEach((p, j) => {
      h1.getCell(FIRST + j).value = p.label;
      const c = h2.getCell(FIRST + j);
      c.value = new Date(`${p.end}T00:00:00Z`);
      c.numFmt = "d mmm yyyy";
    });
    inkHeader(h1, 1, last, { size: 10, height: 18, align: (c) => (c >= FIRST ? "right" : "left") });
    inkHeader(h2, 1, last, { size: 8, height: 14, align: (c) => (c >= FIRST ? "right" : "left") });
    for (let c = 1; c <= last; c++) h2.getCell(c).font = font({ size: 8, color: { argb: "FFC9C5BC" } });
    ws.pageSetup.printTitlesRow = `${HEAD}:${HEAD + 1}`;
    footer(ws, `${name} · ${s.name}`);

    st.rows.forEach((row, ri) => {
      const r = ws.getRow(DATA0 + ri);
      const border = row.bold ? totalRule : hairline;
      const label = r.getCell(1);
      label.value = row.label;
      label.alignment = { indent: row.indent ? 2 : 0 };
      label.font = font({ bold: row.bold, color: { argb: C.ink } });
      label.border = border;
      const u = r.getCell(2);
      u.value = unitLabel(row.unit, scale);
      u.font = font({ size: 8, color: { argb: C.muted } });
      u.alignment = { horizontal: "center" };
      u.border = border;
      const template = FORMULAS[s.key]?.[row.key];
      ps.forEach((_, j) => {
        const i = startIdx + j;
        const cell = row.cells[i];
        const xl = r.getCell(FIRST + j);
        xl.numFmt = numFmt(row, scale);
        xl.border = border;
        if (!cell) return;
        values++;
        const value = cell.v;
        const isDerived = !cell.src && !!cell.derived;
        if (isDerived && template) {
          const ref = (key: string, offset = 0) => {
            const [sk, rk] = key.includes(".") ? key.split(".") : [s.key, key];
            const at = where.get(`${sk}.${rk}`);
            const srcRow = statements[sk as StatementKey].rows.find((x) => x.key === rk);
            let c = j;
            if (offset) {
              const pi = priorYearIndex(allPeriods, i);
              if (pi < startIdx) return null;
              c = pi - startIdx;
            }
            if (!at || !srcRow?.cells[startIdx + c]) return null;
            const prefix = at.sheet === s.name ? "" : `${sheetRef(at.sheet)}!`;
            return `${prefix}${col(FIRST + c)}${at.row}`;
          };
          const f = template(ref);
          if (f) {
            xl.value = { formula: f, result: value };
            xl.font = font({ italic: true, bold: row.bold, color: { argb: f.includes("!") ? C.link : C.formula } });
            formulas++;
            return;
          }
        }
        xl.value = value;
        xl.font = isDerived ? font({ italic: true, bold: row.bold, color: { argb: C.inkSoft } }) : font({ bold: row.bold, color: { argb: C.input } });
      });
    });
  }

  // Sources: every reported number and every component of a calculated one.
  const src = wb.addWorksheet("Sources");
  prepareSheet(src, { freezeRows: HEAD, tab: C.inkSoft });
  const head = ["Statement", "Line item", "Period", "Value (US$, as reported)", "Basis", "XBRL concept", "Fact period", "Form", "Filed", "Accession", "Filing"];
  [18, 36, 12, 22, 46, 48, 24, 8, 12, 22, 16].forEach((w, i) => (src.getColumn(i + 1).width = w));
  titleBlock(src, `${name} — sources`, "Every reported value and every part of a calculated one, with the SEC filing it comes from.", head.length);
  const hr = src.getRow(HEAD);
  head.forEach((h, i) => (hr.getCell(i + 1).value = h));
  inkHeader(hr, 1, head.length, { height: 18, align: (c) => (c === 4 ? "right" : "left") });
  let sr = HEAD + 1;
  for (const s of SHEETS) {
    if (s.key === "kpis") continue;
    for (const row of statements[s.key].rows)
      ps.forEach((p, j) => {
        const cell = row.cells[startIdx + j];
        if (!cell) return;
        const refs = cell.src ? [{ ...cell.src, label: "Reported" }] : (cell.derived?.parts ?? []);
        for (const r of refs) {
          const f = filings.get(r.accn);
          const x = src.getRow(sr);
          x.values = [s.name, row.label, p.label, r.value, cell.src ? "Reported" : `${cell.derived?.formula} — ${r.label}`, r.concept, r.start ? `${r.start} → ${r.end}` : r.end, f?.form ?? "", f?.filed ?? "", r.accn];
          for (let i = 1; i <= head.length; i++) {
            x.getCell(i).font = font({ size: 9, color: { argb: i === 4 ? C.input : C.formula } });
            x.getCell(i).border = hairline;
          }
          x.getCell(4).numFmt = row.unit === "usd" ? "#,##0;(#,##0)" : "0.00";
          link(x.getCell(11), "Open on SEC.gov", filingUrl(r.accn));
          x.getCell(11).font = font({ size: 9, color: { argb: C.hyperlink }, underline: true });
          sr++;
        }
      });
  }
  src.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: Math.max(HEAD + 1, sr - 1), column: head.length } };
  footer(src, `${name} · Sources`);

  // Overview: facts, legend and linked contents.
  const next = cover(wb, ov, {
    title: name,
    subtitle: `Standardized financial statements from SEC EDGAR XBRL filings — ${freq}`,
    logo,
    facts: [
      ["Exported", new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })],
      ["Dataset generated", new Date(d.generatedAt).toLocaleString("en-US", { dateStyle: "medium" })],
      ["Periods", ps.length ? `${ps.length} ${freq === "annual" ? "fiscal years" : "quarters"} · ${ps[0].label} – ${ps[ps.length - 1].label}` : "—"],
      ["Dollar display", `${scaleWords(scale)} — cells hold full values, so formulas stay exact; per-share values in dollars; ratios as decimals`],
      ["In this workbook", `${values.toLocaleString()} values · ${formulas.toLocaleString()} live formulas · ${(sr - HEAD - 1).toLocaleString()} source rows`],
      ["SEC CIK", d.profile.cik],
    ],
    legend: [
      { sample: "1,234", style: { color: { argb: C.input } }, text: "Reported in an SEC filing (input). The Sources sheet lists its accession, XBRL concept and period." },
      { sample: "1,234", style: { italic: true, color: { argb: C.formula } }, text: "Calculated with a live formula from lines on the same sheet." },
      { sample: "12.3%", style: { italic: true, color: { argb: C.link } }, text: "Calculated with a live formula that uses another sheet (margins, conversion, growth)." },
      { sample: "1,234", style: { italic: true, color: { argb: C.inkSoft } }, text: "Calculated by Filed Under from facts outside this workbook (e.g. fourth quarter = full year − nine months)." },
    ],
  });
  let r = next + 1;
  ov.getCell(r, 2).value = "Contents";
  ov.getCell(r, 2).font = font({ bold: true, size: 10, color: { argb: C.ink } });
  r++;
  for (const s of [...SHEETS.map((x) => ({ name: x.name, n: statements[x.key].rows.length })), { name: "Sources", n: sr - HEAD - 1 }]) {
    link(ov.getCell(r, 2), s.name, `#${sheetRef(s.name)}!A1`);
    ov.getCell(r, 3).value = s.name === "Sources" ? `${s.n.toLocaleString()} source rows` : `${s.n} lines`;
    ov.getCell(r, 3).font = font({ size: 9, color: { argb: C.muted } });
    for (let c = 2; c <= 6; c++) ov.getCell(r, c).border = hairline;
    r++;
  }
  ov.getCell(r + 1, 2).value = "Filed Under · every number links to its SEC source";
  ov.getCell(r + 1, 2).font = font({ size: 8, italic: true, color: { argb: C.muted } });
  ov.getCell(r + 1, 2).fill = solid(C.paper);
  footer(ov, `${name} · Overview`);
  return { wb, values, formulas };
}

export async function exportWorkbook(d: CompanyDataset, freq: Freq, scale: Scale, periods?: number, logoUrl?: string) {
  const logo = logoUrl ? await fetchLogo(logoUrl) : null;
  const { wb } = await buildFinancialsWorkbook(d, freq, scale, periods, logo);
  downloadBlob(await workbookBlob(wb), `${d.profile.ticker}-financials-${freq}.xlsx`);
}
