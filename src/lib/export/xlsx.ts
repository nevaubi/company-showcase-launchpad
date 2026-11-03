// Excel model export: one sheet per statement with live formulas for calculated
// lines, plus a Sources sheet that maps every number to its SEC filing.
// exceljs is loaded on demand so it never weighs on page loads.
import type { CompanyDataset, Period, Row, Statement, StatementKey } from "@/lib/financials/types";
import { scaled, scaleCaption, unitLabel, type Scale } from "@/lib/format";

type Freq = "annual" | "quarterly";

const SHEETS: { key: StatementKey; name: string }[] = [
  { key: "income", name: "Income statement" },
  { key: "balance", name: "Balance sheet" },
  { key: "cashflow", name: "Cash flow" },
  { key: "kpis", name: "Ratios & KPIs" },
];

const colName = (n: number) => {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const FIRST_COL = 2; // A = label, B = unit, C… = periods

function numFmt(row: Row, scale: Scale) {
  switch (row.unit) {
    case "usd":
      return scale === "B" ? '#,##0.0;(#,##0.0);"–"' : '#,##0;(#,##0);"–"';
    case "shares":
      return scale === "B" ? "#,##0.00" : "#,##0";
    case "usdPerShare":
      return '0.00;(0.00);"–"';
    case "pct":
      return "0.0%";
    case "ratio":
      return '0.00"×"';
    case "days":
      return "0";
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

export async function exportWorkbook(d: CompanyDataset, freq: Freq, scale: Scale, periods?: number) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Filed Under";
  wb.created = new Date();
  const ticker = d.profile.ticker;
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

  // Row positions for cross-sheet references.
  const where = new Map<string, Ref>();
  for (const s of SHEETS) statements[s.key].rows.forEach((r, i) => where.set(`${s.key}.${r.key}`, { sheet: s.name, row: i + 3 }));

  const ink = "FF1F232B";
  const paper = "FFF7F4EC";

  for (const s of SHEETS) {
    const st: Statement = statements[s.key];
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
    ws.getColumn(1).width = 46;
    ws.getColumn(2).width = 8;
    ps.forEach((_, j) => (ws.getColumn(FIRST_COL + j + 1).width = 13));
    const title = ws.getRow(1);
    title.getCell(1).value = `${d.profile.name} (${ticker}) — ${s.name}, ${freq}`;
    title.getCell(1).font = { bold: true, size: 12 };
    title.getCell(2).value = scaleCaption(scale);
    title.getCell(2).font = { italic: true, color: { argb: "FF6B7280" } };
    const head = ws.getRow(2);
    head.getCell(1).value = "Line item";
    head.getCell(2).value = "Unit";
    ps.forEach((p, j) => (head.getCell(FIRST_COL + j + 1).value = `${p.label}\n${p.end}`));
    head.height = 30;
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: paper } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ink } };
      c.alignment = { wrapText: true, vertical: "middle", horizontal: c.col > FIRST_COL ? "right" : "left" };
    });

    st.rows.forEach((row, ri) => {
      const r = ws.getRow(ri + 3);
      r.getCell(1).value = row.label;
      r.getCell(1).alignment = { indent: row.indent ? 2 : 0 };
      if (row.bold) r.getCell(1).font = { bold: true };
      r.getCell(2).value = unitLabel(row.unit, scale);
      r.getCell(2).font = { color: { argb: "FF6B7280" }, size: 9 };
      const template = FORMULAS[s.key]?.[row.key];
      ps.forEach((p, j) => {
        const i = startIdx + j;
        const cell = row.cells[i];
        const xl = r.getCell(FIRST_COL + j + 1);
        xl.numFmt = numFmt(row, scale);
        if (row.bold) xl.font = { bold: true };
        if (!cell) return;
        const value = row.unit === "pct" ? cell.v : scaled(cell.v, row.unit, scale);
        const isDerived = !cell.src && !!cell.derived;
        if (isDerived && template) {
          const ref = (key: string, offset = 0) => {
            const [sk, rk] = key.includes(".") ? key.split(".") : [s.key, key];
            const at = where.get(`${sk}.${rk}`);
            const srcRow = statements[sk as StatementKey].rows.find((x) => x.key === rk);
            let col = j;
            if (offset) {
              const pi = priorYearIndex(allPeriods, i);
              if (pi < startIdx) return null;
              col = pi - startIdx;
            }
            if (!at || !srcRow?.cells[startIdx + col]) return null;
            const sheetRef = at.sheet === s.name ? "" : `'${at.sheet}'!`;
            return `${sheetRef}${colName(FIRST_COL + col)}${at.row}`;
          };
          const f = template(ref);
          if (f) {
            xl.value = { formula: f, result: value };
            xl.font = { ...(xl.font ?? {}), italic: true, color: { argb: "FF374151" } };
            return;
          }
        }
        xl.value = value;
        if (isDerived) xl.font = { ...(xl.font ?? {}), italic: true, color: { argb: "FF374151" } };
      });
    });
  }

  // Sources: every reported number and every component of a calculated one.
  const src = wb.addWorksheet("Sources", { views: [{ state: "frozen", ySplit: 1 }] });
  src.columns = [
    { header: "Statement", key: "statement", width: 18 },
    { header: "Line item", key: "line", width: 36 },
    { header: "Period", key: "period", width: 12 },
    { header: "Value (US$, as reported)", key: "value", width: 22 },
    { header: "Basis", key: "basis", width: 46 },
    { header: "XBRL concept", key: "concept", width: 48 },
    { header: "Fact period", key: "factPeriod", width: 24 },
    { header: "Form", key: "form", width: 8 },
    { header: "Filed", key: "filed", width: 12 },
    { header: "Accession", key: "accn", width: 22 },
    { header: "Filing", key: "url", width: 18 },
  ];
  src.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: paper } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ink } };
  });
  for (const s of SHEETS) {
    if (s.key === "kpis") continue;
    for (const row of statements[s.key].rows)
      ps.forEach((p, j) => {
        const cell = row.cells[startIdx + j];
        if (!cell) return;
        const refs = cell.src ? [{ ...cell.src, label: "Reported" }] : (cell.derived?.parts ?? []);
        for (const r of refs) {
          const f = filings.get(r.accn);
          const added = src.addRow({
            statement: s.name,
            line: row.label,
            period: p.label,
            value: r.value,
            basis: cell.src ? "Reported" : `${cell.derived?.formula} — ${r.label}`,
            concept: r.concept,
            factPeriod: r.start ? `${r.start} → ${r.end}` : r.end,
            form: f?.form ?? "",
            filed: f?.filed ?? "",
            accn: r.accn,
            url: { text: "Open on SEC.gov", hyperlink: filingUrl(r.accn) },
          });
          added.getCell("value").numFmt = row.unit === "usd" ? "#,##0" : "0.00";
          added.getCell("url").font = { color: { argb: "FF1D4ED8" }, underline: true };
        }
      });
  }

  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  [
    `${d.profile.name} (${ticker}) — standardized financial statements from SEC EDGAR XBRL filings.`,
    `Exported ${new Date().toISOString().slice(0, 10)} from Filed Under. Dataset generated ${d.generatedAt.slice(0, 10)}.`,
    `Dollar values in ${scaleCaption(scale)}; per-share values in dollars; ratios as decimals.`,
    "Italic cells are calculated. Where the calculation uses lines in this workbook it is a live formula.",
    "The Sources sheet lists the SEC accession, XBRL concept and period behind every value, with a link to the filing.",
  ].forEach((t, i) => (about.getCell(i + 1, 1).value = t));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ticker}-financials-${freq}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
