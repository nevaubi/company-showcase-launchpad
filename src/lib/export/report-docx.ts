// Word (.docx) export of a library report: branded cover, cited sections with superscript source
// numbers, tables and a numbered source list. Browser-only (built on click).
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { citationOrder } from "@/lib/reports/vet";
import { KINDS } from "@/lib/reports/kinds";
import { compressRefs, readableDates, refCaption } from "@/lib/reports/present";
import type { Claim, Fact, ReportContent, ReportTable } from "@/lib/reports/types";
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

function tableBlock(t: ReportTable, brand: string, font: string): (Paragraph | Table)[] {
  const border = { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const cell = (text: string, opts: { bold?: boolean; right?: boolean; head?: boolean; color?: string } = {}) =>
    new TableCell({
      borders: { top: none, left: none, right: none, bottom: opts.head ? { style: BorderStyle.SINGLE, size: 8, color: hex(brand) } : border },
      children: [new Paragraph({ alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold || opts.head, font, size: 17, color: opts.head ? "666666" : opts.color })] })],
    });
  return [
    new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t.title.toUpperCase(), bold: true, size: 16, font, color: hex(brand) })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [cell("", { head: true }), ...t.columns.map((c) => cell(c, { head: true, right: true }))] }),
        ...t.rows.map((r) => new TableRow({ children: [cell(r.label, { bold: r.bold }), ...r.cells.map((c) => cell(c?.text ?? "—", { right: true, bold: r.bold, color: c?.tone === "negative" ? "B42318" : c?.tone === "positive" ? "067647" : undefined }))] })),
      ],
    }),
    ...(t.note ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t.note, italics: true, size: 15, color: "777777", font })] })] : []),
  ];
}

export async function reportToDocx(content: ReportContent, brand: { branding: FirmBranding | null; logo: string | null; firmName: string | null; preparedBy: string | null }): Promise<Blob> {
  const b = resolveBranding(brand.branding);
  const font = FONT[b.font];
  const ink = hex(readableOn(b.primary));
  const order = citationOrder(content.sections);
  const facts = new Map(content.facts.map((f) => [f.id, f]));
  const tables = new Map(content.tables.map((t) => [t.id, t]));
  const strong = readableOn(b.primary) === "#ffffff" ? b.primary : "#111111";
  const logo = await logoRun(brand.logo);
  const shade = { type: ShadingType.CLEAR, color: "auto", fill: hex(b.primary) };

  const cover: Paragraph[] = [
    new Paragraph({ shading: shade, spacing: { after: 0 }, children: logo ? [logo] : [new TextRun({ text: brand.firmName ?? "Filed Under", bold: true, color: ink, font, size: 22 })] }),
    new Paragraph({ shading: shade, spacing: { before: 120 }, children: [new TextRun({ text: KINDS[content.kind].label.toUpperCase(), color: ink, font, size: 16, bold: true })] }),
    new Paragraph({ shading: shade, border: { top: { style: BorderStyle.SINGLE, size: 18, color: hex(b.accent), space: 6 } }, children: [new TextRun({ text: content.title, bold: true, color: ink, font, size: 40 })] }),
    new Paragraph({ shading: shade, children: [new TextRun({ text: content.subtitle, color: ink, font, size: 22 })] }),
    new Paragraph({ shading: shade, spacing: { after: 240 }, children: [new TextRun({ text: readableDates(`${content.name} (${content.ticker}) · ${content.asOf}${content.priceAsOf ? ` · prices as of ${content.priceAsOf}` : ""}${b.signature && brand.preparedBy ? ` · prepared by ${brand.preparedBy}` : ""}`), color: ink, font, size: 17 })] }),
  ];

  const body: (Paragraph | Table)[] = [];
  for (const s of content.sections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(b.accent), space: 2 } }, children: [new TextRun({ text: s.title, bold: true, font, size: 26, color: "111111" })] }));
    for (const p of s.paragraphs) body.push(new Paragraph({ spacing: { after: 120, line: 300 }, children: claimRuns(p, order, font) }));
    for (const x of s.bullets) body.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line: 290 }, children: claimRuns(x, order, font) }));
    for (const id of s.tables) { const t = tables.get(id); if (t) body.push(...tableBlock(t, strong, font)); }
  }

  body.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Sources", bold: true, font, size: 24 })] }));
  for (const [id, n] of [...order.entries()].sort((a, c) => a[1] - c[1])) {
    const f: Fact | undefined = facts.get(id);
    if (!f) continue;
    body.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: `${n}. `, bold: true, size: 15, font }),
      new TextRun({ text: `${readableDates(f.text)} — ${refCaption(f.ref)}`, size: 15, font, color: "333333" }),
      ...(f.ref.kind === "web" ? [new TextRun({ text: ` ${f.ref.url}`, size: 14, font, color: "1D4ED8" })] : []),
    ] }));
  }
  body.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: b.disclaimer, size: 14, italics: true, font, color: "777777" })] }));

  const doc = new Document({
    creator: brand.firmName ?? "Filed Under",
    title: content.title,
    description: `${KINDS[content.kind].label} — ${content.name} (${content.ticker})`,
    styles: { default: { document: { run: { font, size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: `${b.footer} · AI-drafted from cited sources; review before distribution`, size: 14, color: "888888", font })] })] }) },
      children: [...cover, ...body],
    }],
  });
  return Packer.toBlob(doc);
}
