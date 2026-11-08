// One-page company tear sheet (PDF, US Letter). Dense, numbered references on every figure, source list at the
// foot (continued on a second page only when there are more sources than fit). jsPDF, built client-side on click.
import type { jsPDF as JsPDF } from "jspdf";
import type { Cell } from "@/lib/financials/types";
import {
  fmtMoney,
  fmtNum,
  fmtPctV,
  fmtX,
  insiderSummary,
  lastPeriods,
  num,
  ROW_KEYS,
  SourceRegister,
  ttmSum,
  type Dossier,
} from "./dossier";

const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [110, 106, 98];
const RULE: [number, number, number] = [214, 208, 196];
const POS: [number, number, number] = [6, 118, 71];
const NEG: [number, number, number] = [180, 35, 24];
const ACCENT: [number, number, number] = [36, 64, 110];

const PAGE_W = 612;
const PAGE_H = 792;
const M = 32;

interface Col {
  w: number;
  align?: "left" | "right";
}

type CellText = string | { t: string; ref?: number | null; tone?: "pos" | "neg" | null; bold?: boolean };

function text(doc: JsPDF, s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right"; maxW?: number } = {}) {
  doc.setFont("helvetica", o.bold ? "bold" : "normal");
  doc.setFontSize(o.size ?? 7.5);
  doc.setTextColor(...(o.color ?? INK));
  let out = s;
  if (o.maxW) {
    while (out.length > 3 && doc.getTextWidth(out) > o.maxW) out = out.slice(0, -2);
    if (out !== s) out = `${out.trimEnd()}…`;
  }
  doc.text(out, x, y, { align: o.align ?? "left" });
}

/** Text with a superscript reference number, right- or left-aligned at x. */
function refText(doc: JsPDF, c: CellText, x: number, y: number, align: "left" | "right", size = 7.5, maxW?: number) {
  const v = typeof c === "string" ? { t: c } : c;
  const color = v.tone === "pos" ? POS : v.tone === "neg" ? NEG : INK;
  const ref = v.ref ? String(v.ref) : "";
  doc.setFontSize(5);
  const rw = ref ? doc.getTextWidth(ref) + 0.8 : 0;
  if (align === "right") {
    text(doc, v.t, x - rw, y, { size, bold: v.bold, color, align: "right", maxW });
    if (ref) text(doc, ref, x, y - 2.6, { size: 5, color: MUTED, align: "right" });
  } else {
    text(doc, v.t, x, y, { size, bold: v.bold, color, maxW });
    doc.setFontSize(size);
    const w = Math.min(doc.getTextWidth(v.t), maxW ?? Infinity);
    if (ref) text(doc, ref, x + w + 0.8, y - 2.6, { size: 5, color: MUTED });
  }
}

function heading(doc: JsPDF, s: string, x: number, y: number, w: number) {
  text(doc, s.toUpperCase(), x, y, { size: 6.5, bold: true, color: ACCENT });
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(x, y + 2.5, x + w, y + 2.5);
  return y + 11;
}

/** Simple ruled table; returns the y after the last row. */
function table(doc: JsPDF, x: number, y: number, cols: Col[], head: CellText[] | null, rows: CellText[][], rowH = 10) {
  let cy = y;
  const total = cols.reduce((s, c) => s + c.w, 0);
  if (head) {
    let cx = x;
    head.forEach((h, i) => {
      const al = cols[i].align ?? (i === 0 ? "left" : "right");
      const v = typeof h === "string" ? { t: h } : h;
      refText(doc, { ...v, bold: true }, al === "right" ? cx + cols[i].w - 1 : cx, cy, al, 6.5);
      cx += cols[i].w;
    });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.5);
    doc.line(x, cy + 2.5, x + total, cy + 2.5);
    cy += rowH;
  }
  for (const r of rows) {
    let cx = x;
    r.forEach((c, i) => {
      const al = cols[i].align ?? (i === 0 ? "left" : "right");
      refText(doc, c, al === "right" ? cx + cols[i].w - 1 : cx, cy, al, 7.5, cols[i].w - 6);
      cx += cols[i].w;
    });
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.25);
    doc.line(x, cy + 2.5, x + total, cy + 2.5);
    cy += rowH;
  }
  return cy;
}

function sparkline(doc: JsPDF, closes: number[], x: number, y: number, w: number, h: number) {
  if (closes.length < 2) return;
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const span = hi - lo || 1;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.25);
  doc.line(x, y + h, x + w, y + h);
  const up = closes.at(-1)! >= closes[0];
  doc.setDrawColor(...(up ? POS : NEG));
  doc.setLineWidth(0.8);
  const step = w / (closes.length - 1);
  for (let i = 1; i < closes.length; i++) {
    doc.line(x + (i - 1) * step, y + h - ((closes[i - 1] - lo) / span) * h, x + i * step, y + h - ((closes[i] - lo) / span) * h);
  }
  text(doc, `$${hi.toFixed(2)}`, x + w, y - 1, { size: 5.5, color: MUTED, align: "right" });
  text(doc, `$${lo.toFixed(2)}`, x + w, y + h + 7, { size: 5.5, color: MUTED, align: "right" });
}

const tone = (v: number | null): "pos" | "neg" | null => (v == null ? null : v > 0 ? "pos" : v < 0 ? "neg" : null);

export interface TearSheetResult {
  blob: Blob;
  pages: number;
  sources: number;
  filename: string;
}

/** Builds the tear sheet. `jsPDFCtor` is injectable for tests (node build of jspdf). */
export async function buildTearSheet(x: Dossier, jsPDFCtor?: typeof import("jspdf").jsPDF): Promise<TearSheetResult> {
  const Ctor = jsPDFCtor ?? (await import("jspdf")).jsPDF;
  const doc = new Ctor({ unit: "pt", format: "letter", compress: true });
  const d = x.d;
  const p = d.profile;
  const reg = new SourceRegister(p.cik, new Map(d.filings.map((f) => [f.accn, f])));
  const s = x.screen ?? ({} as Record<string, unknown>);
  const screenRef = reg.dataset(
    "screener",
    `Filed Under screener${x.screenAsOf ? ` (prices as of ${x.screenAsOf})` : ""}: price × cover-page shares; multiples from the last four reported quarters`,
  );
  const priceRef = reg.dataset("price", `Daily closes, Yahoo Finance chart API${x.priceDate ? `, last close ${x.priceDate}` : ""}`);

  // ---------------------------------------------------------------- header band
  doc.setFillColor(...INK);
  doc.rect(0, 0, PAGE_W, 54, "F");
  text(doc, `${p.name} (${x.ticker})`, M, 24, { size: 15, bold: true, color: [250, 248, 244], maxW: 380 });
  text(doc, [p.exchange, p.sector, p.industry].filter(Boolean).join(" · "), M, 38, { size: 7.5, color: [201, 197, 188], maxW: 380 });
  text(doc, x.price != null ? `$${x.price.toFixed(2)}` : "n/a", PAGE_W - M, 26, { size: 15, bold: true, color: [250, 248, 244], align: "right" });
  text(
    doc,
    `${x.changePct != null ? `${x.changePct > 0 ? "+" : ""}${x.changePct.toFixed(2)}% today · ` : ""}as of ${x.priceDate ?? "n/a"} · tear sheet ${x.generated.slice(0, 10)}`,
    PAGE_W - M,
    38,
    { size: 6.5, color: [201, 197, 188], align: "right" },
  );

  const colW = (PAGE_W - 2 * M - 16) / 2;
  const L = M;
  const R = M + colW + 16;
  let yl = 72;
  let yr = 72;

  // ---------------------------------------------------------------- left: key figures
  const q = d.statements.quarterly;
  const a = d.statements.annual;
  const revTtm = ttmSum(q.income, ROW_KEYS.revenue);
  const niTtm = ttmSum(q.income, ROW_KEYS.netIncome);
  const cfoTtm = ttmSum(q.cashflow, ROW_KEYS.cfo);
  const capexTtm = ttmSum(q.cashflow, ROW_KEYS.capex);
  const fcfTtm = cfoTtm && capexTtm ? cfoTtm.value - Math.abs(capexTtm.value) : null;
  const lastRef = (c: { cells: Cell[] } | null) => (c ? reg.cell(c.cells[c.cells.length - 1]) : null);
  yl = heading(doc, "Key figures", L, yl, colW);
  yl = table(
    doc,
    L,
    yl,
    [{ w: colW * 0.55 }, { w: colW * 0.45 }],
    null,
    [
      ["Market cap", { t: fmtMoney(num(s.mcap)), ref: screenRef }],
      ["Enterprise value", { t: fmtMoney(num(s.ev)), ref: screenRef }],
      ["P/E (TTM diluted EPS)", { t: fmtX(num(s.pe)), ref: screenRef }],
      ["EV / EBIT", { t: fmtX(num(s.ev_ebit)), ref: screenRef }],
      ["FCF yield", { t: fmtPctV(num(s.fcf_yield)), ref: screenRef }],
      ["Dividend yield", { t: fmtPctV(num(s.div_yield)), ref: screenRef }],
      ["Revenue, last 4 quarters", { t: fmtMoney(revTtm?.value), ref: lastRef(revTtm) }],
      ["Net income, last 4 quarters", { t: fmtMoney(niTtm?.value), ref: lastRef(niTtm) }],
      ["Free cash flow, last 4 quarters", { t: fmtMoney(fcfTtm), ref: lastRef(cfoTtm) }],
      ["Revenue growth, latest quarter YoY", { t: fmtPctV(num(s.rev_g_q), 1, true), ref: screenRef, tone: tone(num(s.rev_g_q)) }],
      ["Gross / operating margin", { t: `${fmtPctV(num(s.gm))} / ${fmtPctV(num(s.om))}`, ref: screenRef }],
      ["Net debt / EBITDA", { t: fmtX(num(s.nd_ebitda)), ref: screenRef }],
    ],
  );

  yl = heading(doc, "Valuation against its own five-year history", L, yl + 6, colW);
  const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}th percentile`);
  yl = table(
    doc,
    L,
    yl,
    [{ w: colW * 0.55 }, { w: colW * 0.45 }],
    null,
    [
      ["P/E", { t: pct(num(s.pe_p5)), ref: screenRef }],
      ["FCF yield (higher = cheaper)", { t: pct(num(s.fcf_yield_p5)), ref: screenRef }],
      ["EV / sales", { t: pct(num(s.ev_sales_p5)), ref: screenRef }],
    ],
  );
  text(doc, "0 = cheapest month in five years, 100 = most expensive (FCF yield: 100 = highest yield).", L, yl + 1, { size: 5.5, color: MUTED });
  yl += 8;

  // ---------------------------------------------------------------- right: price + estimates + insiders
  yr = heading(doc, "Price, last 12 months", R, yr, colW);
  const closes = x.bars.map((b) => b[4]).filter((v) => v > 0);
  sparkline(doc, closes, R, yr + 4, colW, 46);
  yr += 62;
  yr = table(
    doc,
    R,
    yr,
    [{ w: colW / 4 }, { w: colW / 4 }, { w: colW / 4 }, { w: colW / 4 }],
    [{ t: "1M", ref: priceRef }, "3M", "1Y", "From 52w high"],
    [[
      { t: fmtPctV(num(s.ret_1m), 1, true), tone: tone(num(s.ret_1m)) },
      { t: fmtPctV(num(s.ret_3m), 1, true), tone: tone(num(s.ret_3m)) },
      { t: fmtPctV(num(s.ret_1y), 1, true), tone: tone(num(s.ret_1y)) },
      { t: fmtPctV(num(s.dist_hi52) != null ? -Math.abs(num(s.dist_hi52)!) : null), tone: "neg" },
    ]],
  );

  const e = x.estimates?.earnings;
  const estRef = e?.provider ? reg.dataset("estimates", `${e.provider} consensus${e.as_of ? ` as of ${e.as_of.slice(0, 10)}` : ""}`, e.url ?? null) : null;
  yr = heading(doc, "Next report and consensus", R, yr + 6, colW);
  yr = table(
    doc,
    R,
    yr,
    [{ w: colW * 0.55 }, { w: colW * 0.45 }],
    null,
    [
      ["Next earnings date", { t: e?.date ? `${e.date}${e.is_estimate ? " (projected)" : ""}` : (x.estimates?.next_earnings ?? "n/a"), ref: estRef }],
      ["Consensus EPS, next report", { t: fmtNum(e?.eps ?? x.estimates?.eps_0q ?? null), ref: estRef }],
      [
        "Last quarter: actual vs estimate",
        {
          t: e?.last ? `${fmtNum(e.last.eps_actual)} vs ${fmtNum(e.last.eps_estimate)} (${fmtPctV(e.last.surprise_pct, 1, true)})` : "n/a",
          ref: e?.last?.report?.accn ? reg.filing(e.last.report.accn) : estRef,
          tone: tone(e?.last?.surprise_pct ?? null),
        },
      ],
      ["Median one-day move after reports", { t: e?.reaction ? `${(e.reaction.median_abs_move * 100).toFixed(1)}% (n=${e.reaction.n})` : "n/a", ref: priceRef }],
    ],
  );

  const ins = insiderSummary(d, 90, x.generated.slice(0, 10));
  const insRef = reg.dataset("form4", "SEC Form 4 filings (open-market purchases P and sales S, last 90 days)");
  yr = heading(doc, "Insiders, last 90 days", R, yr + 6, colW);
  yr = table(
    doc,
    R,
    yr,
    [{ w: colW * 0.55 }, { w: colW * 0.45 }],
    null,
    [
      ["Open-market purchases", { t: `${ins.buys} by ${ins.buyers} insider${ins.buyers === 1 ? "" : "s"}, ${fmtMoney(ins.buyValue)}`, ref: insRef, tone: ins.buys ? "pos" : null }],
      ["Open-market sales", { t: `${ins.sells} (${ins.planSells} under 10b5-1 plans), ${fmtMoney(ins.sellValue)}`, ref: insRef, tone: ins.sells ? "neg" : null }],
    ],
  );

  // ---------------------------------------------------------------- full width: quarters
  let y = Math.max(yl, yr) + 8;
  const qs = lastPeriods(q.income, ROW_KEYS.revenue, 8);
  if (qs) {
    y = heading(doc, "Last eight quarters (as reported)", M, y, PAGE_W - 2 * M);
    const labelW = 120;
    const w = (PAGE_W - 2 * M - labelW) / qs.periods.length;
    const cols: Col[] = [{ w: labelW }, ...qs.periods.map(() => ({ w }))];
    const series = (keys: readonly string[], fmt: (v: number) => string, st = q.income) => {
      const r = st.rows.find((rr) => keys.includes(rr.key));
      if (!r) return null;
      const idx = qs.periods.map((pp) => st.periods.findIndex((x2) => x2.key === pp.key));
      return idx.map((i) => (i >= 0 && r.cells[i] ? fmt(r.cells[i]!.v) : "n/a"));
    };
    const head: CellText[] = ["", ...qs.periods.map((pp, j) => ({ t: pp.label, ref: reg.cell(qs.cells[j]) }))];
    const yoy = qs.periods.map((pp, j) => {
      const prior = q.income.periods.findIndex((x2) => x2.fy === pp.fy - 1 && (x2.fq ?? 0) === (pp.fq ?? 0));
      const cur = qs.cells[j]?.v;
      const prev = prior >= 0 ? qs.row.cells[prior]?.v : undefined;
      const g = cur != null && prev ? cur / prev - 1 : null;
      return { t: fmtPctV(g, 1, true), tone: tone(g) } as CellText;
    });
    const rows: CellText[][] = [
      ["Revenue", ...qs.cells.map((c) => (c ? fmtMoney(c.v) : "n/a"))],
      ["Revenue growth YoY", ...yoy],
    ];
    const add = (label: string, vals: string[] | null) => vals && rows.push([label, ...vals]);
    add("Gross profit", series(ROW_KEYS.grossProfit, (v) => fmtMoney(v)));
    add("Operating income", series(ROW_KEYS.operatingIncome, (v) => fmtMoney(v)));
    add("Net income", series(ROW_KEYS.netIncome, (v) => fmtMoney(v)));
    add("Diluted EPS", series(ROW_KEYS.eps, (v) => `$${v.toFixed(2)}`));
    add("Operating cash flow", series(ROW_KEYS.cfo, (v) => fmtMoney(v), q.cashflow));
    y = table(doc, M, y, cols, head, rows, 9.5);
  }

  // ---------------------------------------------------------------- full width: fiscal years
  const ys = lastPeriods(a.income, ROW_KEYS.revenue, 5);
  if (ys) {
    y = heading(doc, "Fiscal years", M, y + 6, PAGE_W - 2 * M);
    const labelW = 120;
    const w = (PAGE_W - 2 * M - labelW) / ys.periods.length;
    const cols: Col[] = [{ w: labelW }, ...ys.periods.map(() => ({ w }))];
    const series = (keys: readonly string[], st = a.income) => {
      const r = st.rows.find((rr) => keys.includes(rr.key));
      if (!r) return null;
      return ys.periods.map((pp) => {
        const i = st.periods.findIndex((x2) => x2.key === pp.key);
        return i >= 0 && r.cells[i] ? fmtMoney(r.cells[i]!.v) : "n/a";
      });
    };
    const rows: CellText[][] = [["Revenue", ...ys.cells.map((c) => (c ? fmtMoney(c.v) : "n/a"))]];
    const ni = series(ROW_KEYS.netIncome);
    if (ni) rows.push(["Net income", ...ni]);
    const cfo = series(ROW_KEYS.cfo, a.cashflow);
    if (cfo) rows.push(["Operating cash flow", ...cfo]);
    y = table(doc, M, y, cols, ["", ...ys.periods.map((pp, j) => ({ t: pp.label, ref: reg.cell(ys.cells[j]) }))], rows, 9.5);
  }

  // ---------------------------------------------------------------- supply chain + events (two columns)
  y += 6;
  let ysL = heading(doc, "Disclosed dependencies", L, y, colW);
  const customers = x.links.filter((l) => l.relation === "customer" && l.share_pct != null).sort((m, n) => (n.share_pct ?? 0) - (m.share_pct ?? 0)).slice(0, 3);
  const single = x.links.filter((l) => l.relation === "supplier" && l.single_source).slice(0, 3);
  const depRows: CellText[][] = [
    ...customers.map((l) => [`Customer: ${l.counterparty}`, { t: `${l.share_pct}% of revenue`, ref: reg.filing(l.accn, l.doc) }] as CellText[]),
    ...single.map((l) => [`Single-source supplier: ${l.counterparty}`, { t: l.detail || "named in filing", ref: reg.filing(l.accn, l.doc) }] as CellText[]),
  ];
  ysL = depRows.length
    ? table(doc, L, ysL, [{ w: colW * 0.62 }, { w: colW * 0.38 }], null, depRows)
    : (text(doc, "No customer shares or single-source suppliers disclosed in the current filings.", L, ysL, { size: 7, color: MUTED }), ysL + 10);

  let ysR = heading(doc, "Recent events (alternative data)", R, y, colW);
  const events = x.alt.filter((ev) => ev.date).slice(0, 5);
  ysR = events.length
    ? table(
        doc,
        R,
        ysR,
        [{ w: 52, align: "left" }, { w: colW - 52, align: "left" }],
        null,
        events.map((ev) => [ev.date!.slice(0, 10), { t: ev.title, ref: reg.dataset(`alt:${ev.source}:${ev.source_url ?? ""}`, ev.source, ev.source_url) }]),
      )
    : (text(doc, "No dated events in the last 12 months.", R, ysR, { size: 7, color: MUTED }), ysR + 10);

  // ---------------------------------------------------------------- sources
  let ys2 = Math.max(ysL, ysR) + 8;
  const sources = reg.list();
  let pages = 1;
  const drawSources = (from: number, y0: number, maxY: number) => {
    let yy = heading(doc, from === 0 ? "Sources" : "Sources (continued)", M, y0, PAGE_W - 2 * M);
    const half = (PAGE_W - 2 * M - 12) / 2;
    let i = from;
    let colX = M;
    const startY = yy;
    while (i < sources.length) {
      const sEntry = sources[i];
      const line = `${sEntry.n}. ${sEntry.label}`;
      text(doc, line, colX, yy, { size: 5.8, color: MUTED, maxW: half });
      if (sEntry.url) doc.link(colX, yy - 5, half, 7, { url: sEntry.url });
      yy += 7.2;
      i++;
      if (yy > maxY) {
        if (colX === M) {
          colX = M + half + 12;
          yy = startY;
        } else break;
      }
    }
    return i;
  };
  let next = drawSources(0, ys2, PAGE_H - 30);
  while (next < sources.length) {
    doc.addPage();
    pages++;
    ys2 = 40;
    next = drawSources(next, ys2, PAGE_H - 30);
  }
  for (let pg = 1; pg <= pages; pg++) {
    doc.setPage(pg);
    text(doc, `Filed Under · ${x.ticker} tear sheet · figures as reported in SEC filings unless noted; numbers refer to the source list · page ${pg} of ${pages}`, M, PAGE_H - 16, { size: 5.5, color: MUTED });
  }
  const blob = doc.output("blob") as Blob;
  return { blob, pages, sources: sources.length, filename: `${x.ticker}-tear-sheet-${x.generated.slice(0, 10)}.pdf` };
}
