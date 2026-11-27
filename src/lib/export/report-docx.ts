// Word (.docx) export of a library report: branded cover, cited sections with superscript source
// numbers, tables and a numbered source list. Browser-only (built on click).
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel, ImageRun, Packer, PageNumber, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { citationOrder } from "@/lib/reports/vet";
import { reportSources, sourceMark, type ReportSources } from "@/lib/reports/source-register";
import { KINDS } from "@/lib/reports/kinds";
import { compressRefs, readableDates, refCaption } from "@/lib/reports/present";
import type { Claim, Fact, ReportChart, ReportContent, ReportTable } from "@/lib/reports/types";
import type { ChartImage } from "@/lib/export/chart-capture";
import { readableOn, resolveBranding, type FirmBranding } from "@/lib/firm/core";

const FONT: Record<"sans" | "serif" | "mono", string> = { sans: "Calibri", serif: "Georgia", mono: "Consolas" };
const hex = (c: string) => c.replace("#", "").toUpperCase();

async function logoRun(dataUrl: string | null): Promise<ImageRun | null> {
  if (!dataUrl?.startsWith("data:image/png")) return null;
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
  const img = new Image();
  img.src = dataUrl;
  await img.decode().catch(() => undefined);
  const w = img.naturalWidth || 300, h = img.naturalHeight || 100;
  const height = 36, width = Math.round((w / h) * height);
  return new ImageRun({ type: "png", data: bytes, transformation: { width: Math.min(width, 220), height } });
}

function claimRuns(c: Claim, order: Map<string, number>, font: string): TextRun[] {
  const nums = c.factIds.map((id) => order.get(id)).filter((n): n is number => !!n);
  return [new TextRun({ text: readableDates(c.text), font, size: 21 }), ...(nums.length ? [new TextRun({ text: compressRefs(nums), superScript: true, font, size: 15, color: "555555" })] : [])];
}

function sourceRun(numbers: number[] | undefined, font: string) {
  return numbers?.length ? [new TextRun({ text: sourceMark(numbers), font, size: 13, color: "52667A", superScript: true })] : [];
}

function tableBlock(t: ReportTable, brand: string, font: string, sources: ReportSources): (Paragraph | Table)[] {
  const border = { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const cell = (text: string, opts: { bold?: boolean; right?: boolean; head?: boolean; color?: string; refs?: number[] } = {}) =>
    new TableCell({
      shading: opts.head || opts.bold ? { type: ShadingType.CLEAR, fill: opts.head ? "E9EDF2" : "F4F6F8" } : undefined,
      margins: { top: 42, bottom: 42, left: 65, right: 65 },
      borders: { top: none, left: none, right: none, bottom: opts.head ? { style: BorderStyle.SINGLE, size: 8, color: hex(brand) } : border },
      children: [new Paragraph({ alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold || opts.head, font, size: 17, color: opts.head ? "334155" : opts.color }), ...sourceRun(opts.refs, font)] })],
    });
  return [
    new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t.title.toUpperCase(), bold: true, size: 16, font, color: hex(brand) })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [cell("Measure", { head: true }), ...t.columns.map((c) => cell(c, { head: true, right: c !== "Basis" }))] }),
        ...t.rows.map((r) => new TableRow({ cantSplit: true, children: [cell(r.label, { bold: r.bold }), ...r.cells.map((c, i) => cell(c?.text ?? "–", { right: t.columns[i] !== "Basis", bold: r.bold, refs: sources.forRef(c?.ref), color: c?.tone === "negative" ? "B42318" : c?.tone === "positive" ? "067647" : undefined }))] })),
      ],
    }),
    ...(t.note ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t.note, italics: true, size: 15, color: "777777", font })] })] : []),
  ];
}

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

/** Title, subtitle, image and legend of one chart. */
function chartParagraphs(c: ReportChart, img: ChartImage, width: number, brand: string, font: string, sources: ReportSources): Paragraph[] {
  const height = Math.round((img.h / img.w) * width);
  const legend = c.type === "combo" || c.type === "stacked" ? c.series.map((s) => `${s.name}${s.kind === "bar" ? "" : s.kind === "dash" ? " (dashed)" : " (line)"}`).join(" · ") : "";
  return [
    new Paragraph({ spacing: { before: 120, after: 20 }, children: [new TextRun({ text: c.title.toUpperCase(), bold: true, size: 15, font, color: hex(brand) })] }),
    ...(c.subtitle ? [new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: readableDates(c.subtitle), size: 14, font, color: "777777" })] })] : []),
    new Paragraph({ children: [new ImageRun({ type: "png", data: img.png, transformation: { width, height }, altText: { title: c.title, name: c.id, description: c.subtitle ?? c.title } })] }),
    ...(c.note ? [new Paragraph({ children: [new TextRun({ text: readableDates(c.note), size: 15, italics: true, font, color: "526071" })] })] : []),
    ...(sources.chartSources.get(c.id)?.length ? [new Paragraph({ children: [new TextRun({ text: `Source documents · ${sourceMark(sources.chartSources.get(c.id))}`, size: 14, font, color: "526071" })] })] : []),
    ...(legend ? [new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: legend, size: 13, font, color: "777777" })] })] : []),
  ];
}

/** Charts of a section: half-width ones two to a row, full-width ones alone. */
function chartBlock(ids: string[], charts: Map<string, ReportChart>, images: Map<string, ChartImage>, brand: string, font: string, sources: ReportSources): (Paragraph | Table)[] {
  const list = ids.map((id) => charts.get(id)).filter((c): c is ReportChart => !!c);
  const missing = list.filter((c) => !images.has(c.id));
  if (missing.length) throw new Error(`Could not capture ${missing.map((c) => c.title).join(", ")}. Let the charts finish loading and retry, or use Print to PDF.`);
  const out: (Paragraph | Table)[] = [];
  let pair: ReportChart[] = [];
  const flush = () => {
    if (!pair.length) return;
    // A half-width chart without a partner keeps its half-width scale so its text matches the others.
    if (pair.length === 1) out.push(...chartParagraphs(pair[0], images.get(pair[0].id)!, pair[0].size === "full" ? 600 : 300, brand, font, sources));
    else out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS,
      rows: [new TableRow({ children: pair.map((c) => new TableCell({ borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, width: { size: 50, type: WidthType.PERCENTAGE }, children: chartParagraphs(c, images.get(c.id)!, 300, brand, font, sources) })) })],
    }));
    pair = [];
  };
  for (const c of list) {
    if (c.size === "full") { flush(); pair = [c]; flush(); continue; }
    pair.push(c);
    if (pair.length === 2) flush();
  }
  flush();
  return out;
}

export async function reportToDocx(
  content: ReportContent,
  brand: { branding: FirmBranding | null; logo: string | null; firmName: string | null; preparedBy: string | null },
  images: Map<string, ChartImage> = new Map(),
): Promise<Blob> {
  const b = resolveBranding(brand.branding);
  const font = FONT[b.font];
  const ink = hex(readableOn(b.primary));
  const order = citationOrder(content.sections);
  const sources = reportSources(content);
  const facts = new Map(content.facts.map((f) => [f.id, f]));
  const tables = new Map(content.tables.map((t) => [t.id, t]));
  const charts = new Map((content.charts ?? []).map((c) => [c.id, c]));
  const strong = readableOn(b.primary) === "#ffffff" ? b.primary : "#111111";
  const logo = await logoRun(brand.logo);
  const shade = { type: ShadingType.CLEAR, color: "auto", fill: hex(b.primary) };

  const cover: Paragraph[] = [
    new Paragraph({ shading: shade, spacing: { after: 0 }, children: logo ? [logo] : [new TextRun({ text: brand.firmName ?? "FiledUnder", bold: true, color: ink, font, size: 22 })] }),
    new Paragraph({ shading: shade, spacing: { before: 120 }, children: [new TextRun({ text: KINDS[content.kind].label.toUpperCase(), color: ink, font, size: 16, bold: true })] }),
    new Paragraph({ shading: shade, border: { top: { style: BorderStyle.SINGLE, size: 18, color: hex(b.accent), space: 6 } }, children: [new TextRun({ text: content.title, bold: true, color: ink, font, size: 40 })] }),
    new Paragraph({ shading: shade, children: [new TextRun({ text: content.subtitle, color: ink, font, size: 22 })] }),
    new Paragraph({ shading: shade, spacing: { after: 240 }, children: [new TextRun({ text: readableDates(`${content.name} (${content.ticker}) · ${content.asOf}${content.priceAsOf ? ` · prices as of ${content.priceAsOf}` : ""}${b.signature && brand.preparedBy ? ` · prepared by ${brand.preparedBy}` : ""}`), color: ink, font, size: 17 })] }),
  ];

  const body: (Paragraph | Table)[] = [];
  if (content.glance?.length) {
    const cells = content.glance.map((g) => new TableCell({
      borders: { top: NONE, left: NONE, right: NONE, bottom: { style: BorderStyle.SINGLE, size: 2, color: "DDDDDD" } },
      children: [
        new Paragraph({ children: [new TextRun({ text: g.label.toUpperCase(), size: 13, font, color: "777777" })] }),
        new Paragraph({ children: [new TextRun({ text: readableDates(g.value), bold: true, size: 24, font }), ...sourceRun(sources.forRef(facts.get(g.f ?? "")?.ref), font)] }),
        ...(g.sub ? [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: readableDates(g.sub), size: 13, font, color: g.tone === "negative" ? "B42318" : g.tone === "positive" ? "067647" : "777777" })] })] : []),
      ],
    }));
    const rows: TableRow[] = [];
    for (let i = 0; i < cells.length; i += 4) {
      const row = cells.slice(i, i + 4);
      while (row.length < 4) row.push(new TableCell({ borders: { top: NONE, left: NONE, right: NONE, bottom: NONE }, children: [new Paragraph("")] }));
      rows.push(new TableRow({ children: row }));
    }
    body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, rows }));
    if (content.peers?.length) body.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: `Peer set: ${content.peers.map((p) => `${p.name} (${p.ticker})`).join(", ")}`, size: 14, font, color: "777777" })] }));
  }
  for (const s of content.sections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(b.accent), space: 2 } }, children: [new TextRun({ text: s.title, bold: true, font, size: 26, color: "111111" })] }));
    for (const p of s.paragraphs) body.push(new Paragraph({ spacing: { after: 120, line: 300 }, children: claimRuns(p, order, font) }));
    for (const x of s.bullets) body.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line: 290 }, children: claimRuns(x, order, font) }));
    body.push(...chartBlock(s.charts ?? [], charts, images, strong, font, sources));
    for (const id of s.tables) { const t = tables.get(id); if (t) body.push(...tableBlock(t, strong, font, sources)); }
  }

  body.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Sources", bold: true, font, size: 24 })] }));
  for (const [id, n] of [...order.entries()].sort((a, c) => a[1] - c[1])) {
    const f: Fact | undefined = facts.get(id);
    if (!f) continue;
    body.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: `${n}. `, bold: true, size: 15, font }),
      new TextRun({ text: `${readableDates(f.text)} · ${refCaption(f.ref)}`, size: 15, font, color: "333333" }),
      ...sourceRun(sources.forRef(f.ref), font),
    ] }));
  }
  if (sources.documents.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, spacing: { before: 180, after: 80 }, text: "Source documents and datasets" }));
    sources.documents.forEach((source, i) => {
      const label = new TextRun({ text: source.label, font, size: 16, color: source.url ? "244F78" : "526071", underline: source.url ? {} : undefined });
      body.push(new Paragraph({ spacing: { after: 45 }, children: [
        new TextRun({ text: `D${i + 1}  `, font, size: 15, bold: true }),
        source.url ? new ExternalHyperlink({ link: source.url, children: [label] }) : label,
      ] }));
    });
  }
  body.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: b.disclaimer, size: 14, italics: true, font, color: "777777" })] }));

  const doc = new Document({
    creator: brand.firmName ?? "FiledUnder",
    title: content.title,
    description: `${KINDS[content.kind].label}: ${content.name} (${content.ticker})`,
    styles: { default: { document: { run: { font, size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: `${b.footer} · AI-drafted from cited sources; review before distribution · `, size: 14, color: "666666", font }), new TextRun({ children: [PageNumber.CURRENT], size: 14, font })] })] }) },
      children: [...cover, ...body],
    }],
  });
  return Packer.toBlob(doc);
}
