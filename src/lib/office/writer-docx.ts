// Tiptap JSON -> real .docx (browser-safe, pure). Header/footer, page numbers
// and column count come from the document settings.
import {
  AlignmentType, Document, ExternalHyperlink, Footer, Header, HeadingLevel, LevelFormat, Packer,
  PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

export type JNode = { type: string; attrs?: Record<string, unknown>; content?: JNode[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
export type WriterSettings = { header: string; footer: string; pageNumbers: boolean; columns: 1 | 2 };

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};
const HEAD = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

function runs(nodes: JNode[] = [], extra: { bold?: boolean } = {}): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const n of nodes) {
    if (n.type === "hardBreak") { out.push(new TextRun({ text: "", break: 1 })); continue; }
    if (n.type !== "text" || !n.text) continue;
    const m = new Set((n.marks ?? []).map((x) => x.type));
    const link = n.marks?.find((x) => x.type === "link")?.attrs?.href as string | undefined;
    const run = new TextRun({
      text: n.text, bold: m.has("bold") || extra.bold, italics: m.has("italic"), strike: m.has("strike"),
      underline: m.has("underline") || link ? {} : undefined, font: m.has("code") ? "Consolas" : undefined,
      highlight: m.has("highlight") ? "yellow" : undefined, color: link ? "1F4E79" : undefined,
    });
    out.push(link ? new ExternalHyperlink({ link, children: [run] }) : run);
  }
  return out;
}

function blocks(nodes: JNode[] = [], list?: { ref: string; level: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const n of nodes) {
    const alignment = ALIGN[(n.attrs?.textAlign as string) ?? "left"];
    switch (n.type) {
      case "paragraph":
        out.push(new Paragraph({ children: runs(n.content), alignment, numbering: list ? { reference: list.ref, level: list.level } : undefined }));
        break;
      case "heading":
        out.push(new Paragraph({ children: runs(n.content), heading: HEAD[Math.min(4, Number(n.attrs?.level ?? 1)) - 1], alignment }));
        break;
      case "bulletList": case "orderedList":
        for (const li of n.content ?? []) {
          const ref = n.type === "bulletList" ? "bullets" : "numbers";
          const level = list ? Math.min(list.level + 1, 4) : 0;
          for (const c of li.content ?? []) {
            if (c.type === "paragraph") out.push(...blocks([c], { ref, level }));
            else out.push(...blocks([c], { ref, level }));
          }
        }
        break;
      case "blockquote":
        for (const c of blocks(n.content)) out.push(c instanceof Paragraph ? c : c);
        break;
      case "codeBlock":
        out.push(new Paragraph({ children: [new TextRun({ text: (n.content ?? []).map((t) => t.text).join(""), font: "Consolas" })] }));
        break;
      case "horizontalRule": case "pageBreak":
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case "table": {
        const rows = (n.content ?? []).map((r) => new TableRow({
          children: (r.content ?? []).map((c) => new TableCell({
            children: (() => { const b = blocks(c.content).filter((x): x is Paragraph => x instanceof Paragraph); return b.length ? b : [new Paragraph("")]; })(),
            columnSpan: Number(c.attrs?.colspan ?? 1), rowSpan: Number(c.attrs?.rowspan ?? 1),
            shading: c.type === "tableHeader" ? { type: ShadingType.CLEAR, fill: "EDEBE6", color: "auto" } : undefined,
          })),
        }));
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        out.push(new Paragraph(""));
        break;
      }
      default:
        if (n.content) out.push(...blocks(n.content, list));
    }
  }
  return out;
}

const levels = (fmt: (typeof LevelFormat)[keyof typeof LevelFormat], text: (i: number) => string) =>
  [0, 1, 2, 3, 4].map((level) => ({ level, format: fmt, text: text(level), alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } }));

export async function writerToDocx(doc: JNode, s: WriterSettings, title: string): Promise<Blob> {
  const footerKids = [
    ...(s.footer ? [new TextRun(s.footer + (s.pageNumbers ? "   " : ""))] : []),
    ...(s.pageNumbers ? [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] })] : []),
  ];
  const d = new Document({
    title, creator: "FiledUnder",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: { config: [
      { reference: "bullets", levels: levels(LevelFormat.BULLET, (i) => ["•", "◦", "▪", "•", "◦"][i]) },
      { reference: "numbers", levels: levels(LevelFormat.DECIMAL, (i) => `%${i + 1}.`) },
    ] },
    sections: [{
      properties: { column: s.columns === 2 ? { count: 2, space: 708 } : undefined },
      headers: s.header ? { default: new Header({ children: [new Paragraph({ children: [new TextRun(s.header)], alignment: AlignmentType.RIGHT })] }) } : undefined,
      footers: footerKids.length ? { default: new Footer({ children: [new Paragraph({ children: footerKids, alignment: AlignmentType.CENTER })] }) } : undefined,
      children: blocks(doc.content),
    }],
  });
  return Packer.toBlob(d);
}
