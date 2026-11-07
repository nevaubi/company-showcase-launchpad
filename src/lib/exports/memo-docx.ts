// Investment committee fact base (.docx): the sourced facts an IC memo is argued from, organized by section, every
// figure with a numbered reference to its filing or dataset. The analyst's view is left to the analyst: the memo
// states what the record shows and leaves the recommendation section for the author to write.
import type { Paragraph as DocParagraph, Table as DocTable } from "docx";
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

export interface MemoResult {
  blob: Blob;
  filename: string;
  sources: number;
}

export async function buildMemoDocx(x: Dossier): Promise<MemoResult> {
  const docx = await import("docx");
  const { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = docx;
  const d = x.d;
  const p = d.profile;
  const reg = new SourceRegister(p.cik, new Map(d.filings.map((f) => [f.accn, f])));
  const s = x.screen ?? ({} as Record<string, unknown>);
  const screenRef = reg.dataset("screener", `Filed Under screener${x.screenAsOf ? ` (prices as of ${x.screenAsOf})` : ""}: price × cover-page shares; multiples from the last four reported quarters`);
  const FONT = "Calibri";

  const sup = (n: number | null) => (n ? [new TextRun({ text: String(n), superScript: true, size: 14, color: "777777", font: FONT })] : []);
  const para = (parts: (string | { t: string; ref?: number | null; bold?: boolean })[], o: { after?: number } = {}) =>
    new Paragraph({
      spacing: { after: o.after ?? 80 },
      children: parts.flatMap((pt) =>
        typeof pt === "string" ? [new TextRun({ text: pt, font: FONT, size: 20 })] : [new TextRun({ text: pt.t, bold: pt.bold, font: FONT, size: 20 }), ...sup(pt.ref ?? null)],
      ),
    });
  const h = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, font: FONT, bold: true, size: 24, color: "24406E" })] });
  const thin = { style: BorderStyle.SINGLE, size: 2, color: "D6D0C4" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const cell = (t: string, o: { ref?: number | null; head?: boolean; right?: boolean; bold?: boolean } = {}) =>
    new TableCell({
      borders: { top: none, left: none, right: none, bottom: o.head ? { style: BorderStyle.SINGLE, size: 8, color: "1A1A1A" } : thin },
      children: [
        new Paragraph({
          alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text: t, font: FONT, size: 17, bold: o.head || o.bold, color: o.head ? "555555" : undefined }), ...sup(o.ref ?? null)],
        }),
      ],
    });
  const grid = (head: string[], rows: { label: string; cells: { t: string; ref?: number | null }[] }[]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, { head: true, right: i > 0 })) }),
        ...rows.map((r) => new TableRow({ children: [cell(r.label), ...r.cells.map((c) => cell(c.t, { ref: c.ref, right: true }))] })),
      ],
    });

  const body: (DocParagraph | DocTable)[] = [];
  body.push(
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "INVESTMENT COMMITTEE FACT BASE", font: FONT, size: 16, bold: true, color: "24406E" })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${p.name} (${x.ticker})`, font: "Georgia", size: 40, bold: true })] }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: `${[p.exchange, p.sector, p.industry].filter(Boolean).join(" · ")} · prepared ${x.generated.slice(0, 10)} from SEC filings and Filed Under datasets`, font: FONT, size: 18, color: "6E6A62" })],
    }),
  );

  // Company
  body.push(h("1. Company"));
  if (p.description) body.push(para([p.description.slice(0, 1400)]));
  body.push(para([`Fiscal year ends ${p.fiscalYearEnd || "n/a"}. Headquarters ${[p.address?.city, p.address?.state].filter(Boolean).join(", ") || "n/a"}. ${p.ceo ? `CEO ${p.ceo}.` : ""}`]));

  // Snapshot
  const q = d.statements.quarterly;
  const revTtm = ttmSum(q.income, ROW_KEYS.revenue);
  const niTtm = ttmSum(q.income, ROW_KEYS.netIncome);
  const cfoTtm = ttmSum(q.cashflow, ROW_KEYS.cfo);
  const lastCell = (t: ReturnType<typeof ttmSum>) => (t ? reg.cell(t.cells[3]) : null);
  body.push(h("2. Snapshot"));
  body.push(
    grid(["Measure", "Value"], [
      { label: "Share price", cells: [{ t: x.price != null ? `$${x.price.toFixed(2)} (${x.priceDate ?? "latest"})` : "n/a", ref: reg.dataset("price", "Daily closes, Yahoo Finance chart API") }] },
      { label: "Market cap / enterprise value", cells: [{ t: `${fmtMoney(num(s.mcap))} / ${fmtMoney(num(s.ev))}`, ref: screenRef }] },
      { label: "Revenue, last four quarters", cells: [{ t: fmtMoney(revTtm?.value), ref: lastCell(revTtm) }] },
      { label: "Net income, last four quarters", cells: [{ t: fmtMoney(niTtm?.value), ref: lastCell(niTtm) }] },
      { label: "Operating cash flow, last four quarters", cells: [{ t: fmtMoney(cfoTtm?.value), ref: lastCell(cfoTtm) }] },
      { label: "Revenue growth, latest quarter YoY / acceleration", cells: [{ t: `${fmtPctV(num(s.rev_g_q), 1, true)} / ${num(s.rev_accel) != null ? `${(num(s.rev_accel)! * 100).toFixed(1)} pts` : "n/a"}`, ref: screenRef }] },
      { label: "Gross / operating / FCF margin", cells: [{ t: `${fmtPctV(num(s.gm))} / ${fmtPctV(num(s.om))} / ${fmtPctV(num(s.fcfm))}`, ref: screenRef }] },
    ]),
  );

  // Financial trajectory
  const qs = lastPeriods(q.income, ROW_KEYS.revenue, 8);
  if (qs) {
    body.push(h("3. Financial trajectory"));
    const pick = (keys: readonly string[], st = q.income) => {
      const r = st.rows.find((rr) => keys.includes(rr.key));
      return qs.periods.map((pp) => {
        const i = st.periods.findIndex((x2) => x2.key === pp.key);
        const c = r && i >= 0 ? r.cells[i] : null;
        return { t: c ? (keys === ROW_KEYS.eps ? `$${c.v.toFixed(2)}` : fmtMoney(c.v)) : "n/a", ref: reg.cell(c) };
      });
    };
    body.push(
      grid(["Quarter", ...qs.periods.map((pp) => pp.label)], [
        { label: "Revenue", cells: pick(ROW_KEYS.revenue) },
        { label: "Operating income", cells: pick(ROW_KEYS.operatingIncome) },
        { label: "Net income", cells: pick(ROW_KEYS.netIncome) },
        { label: "Diluted EPS", cells: pick(ROW_KEYS.eps) },
      ]),
    );
  }

  // Valuation
  body.push(h("4. Valuation against its own history"));
  const pctile = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}th percentile of its last five years`);
  body.push(
    para([{ t: `P/E ${fmtX(num(s.pe))}`, ref: screenRef }, `, ${pctile(num(s.pe_p5))}. `, { t: `FCF yield ${fmtPctV(num(s.fcf_yield))}`, ref: screenRef }, `, ${pctile(num(s.fcf_yield_p5))} (higher = cheaper). `, { t: `EV/EBIT ${fmtX(num(s.ev_ebit))}`, ref: screenRef }, "."]),
  );

  // Quality & balance sheet
  body.push(h("5. Quality and balance sheet"));
  body.push(
    para([
      { t: `Piotroski F-score ${fmtNum(num(s.pio_f), 0)}`, ref: screenRef },
      `; Altman Z ${fmtNum(num(s.altman_z))}; accruals ratio ${fmtPctV(num(s.accruals))}; stock-based compensation ${fmtPctV(num(s.sbc_pct))} of revenue; share count change over one year ${fmtPctV(num(s.shr_chg1), 1, true)}; net debt / EBITDA ${fmtX(num(s.nd_ebitda))}.`,
    ]),
  );

  // Supply chain
  body.push(h("6. Disclosed dependencies"));
  const customers = x.links.filter((l) => l.relation === "customer" && l.share_pct != null).sort((m, n) => (n.share_pct ?? 0) - (m.share_pct ?? 0)).slice(0, 5);
  const single = x.links.filter((l) => l.relation === "supplier" && l.single_source).slice(0, 5);
  if (!customers.length && !single.length) body.push(para(["The current filings disclose no customer revenue shares or single-source suppliers."]));
  for (const l of customers) body.push(para([{ t: `Customer ${l.counterparty}: ${l.share_pct}% of revenue`, ref: reg.filing(l.accn, l.doc) }, `. "${l.quote.slice(0, 280)}"`]));
  for (const l of single) body.push(para([{ t: `Single-source supplier ${l.counterparty}`, ref: reg.filing(l.accn, l.doc) }, `${l.detail ? ` (${l.detail})` : ""}. "${l.quote.slice(0, 280)}"`]));

  // Insiders
  const ins = insiderSummary(d, 90, x.generated.slice(0, 10));
  const insRef = reg.dataset("form4", "SEC Form 4 filings (open-market purchases P and sales S)");
  body.push(h("7. Insider activity, last 90 days"));
  body.push(
    para([
      { t: `${ins.buys} open-market purchases by ${ins.buyers} insider${ins.buyers === 1 ? "" : "s"} (${fmtMoney(ins.buyValue)})`, ref: insRef },
      "; ",
      { t: `${ins.sells} sales (${fmtMoney(ins.sellValue)}), ${ins.planSells} under 10b5-1 plans`, ref: insRef },
      ".",
    ]),
  );
  for (const t of ins.largest) body.push(para([{ t: `${t.date} ${t.owner} (${t.role || "insider"}) ${t.code === "P" ? "bought" : "sold"} ${t.shares.toLocaleString()} shares at $${(t.price ?? 0).toFixed(2)}${t.plan10b5 ? ", 10b5-1 plan" : ""}`, ref: reg.filing(t.accn, t.doc) }]));

  // Events
  body.push(h("8. Recent events"));
  const events = x.alt.filter((e) => e.date).slice(0, 10);
  if (!events.length) body.push(para(["No dated alternative-data events in the last 12 months."]));
  for (const e of events) body.push(para([`${e.date!.slice(0, 10)} · `, { t: e.title, ref: reg.dataset(`alt:${e.source}:${e.source_url ?? ""}`, e.source, e.source_url) }]));
  const recent = d.filings.filter((f) => ["10-K", "10-Q", "8-K"].includes(f.form)).sort((m, n) => n.filed.localeCompare(m.filed)).slice(0, 6);
  for (const f of recent) body.push(para([`${f.filed} · `, { t: `${f.form}${f.desc ? ` ${f.desc}` : ""}${f.items ? ` (items ${f.items})` : ""}`, ref: reg.filing(f.accn, f.doc) }]));

  // Author sections
  body.push(h("9. Thesis, risks and recommendation"));
  body.push(para(["Written by the analyst presenting to the committee. The sections above are the sourced record it argues from."]));

  // Sources
  body.push(h("Sources"));
  for (const sEntry of reg.list()) {
    body.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: `${sEntry.n}. `, font: FONT, size: 16, color: "6E6A62" }),
          sEntry.url
            ? new ExternalHyperlink({ link: sEntry.url, children: [new TextRun({ text: sEntry.label, font: FONT, size: 16, color: "24406E", underline: {} })] })
            : new TextRun({ text: sEntry.label, font: FONT, size: 16, color: "6E6A62" }),
        ],
      }),
    );
  }

  const document = new Document({ creator: "Filed Under", title: `${x.ticker} IC fact base`, sections: [{ properties: {}, children: body }] });
  const blob = await Packer.toBlob(document);
  return { blob, filename: `${x.ticker}-ic-fact-base-${x.generated.slice(0, 10)}.docx`, sources: reg.list().length };
}
