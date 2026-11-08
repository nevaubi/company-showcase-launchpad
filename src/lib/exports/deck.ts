// Canvas views to a PowerPoint deck (pptxgenjs): one slide per view (dashboards flatten to one slide per item),
// native charts where PowerPoint has the type, tables for tabular views, and a picture of the rendered view (when
// the caller passes one) for diagrams and custom charts. Every slide keeps the view's title, subtitle and source.
import type PptxGenJS from "pptxgenjs";
import { tableOf, type LeafSpec, type ViewSpec } from "@/lib/research/view-spec";

const INK = "1A1A1A";
const MUTED = "6E6A62";
const RULE = "D6D0C4";
const PALETTE = ["24406E", "C2410C", "0F766E", "7C3AED", "B45309", "0369A1", "BE123C", "4D7C0F"];
const W = 13.333;
const H = 7.5;

export interface DeckOptions {
  title?: string;
  subtitle?: string;
  /** PNG data URLs of rendered views, keyed by the view's index in `views` (or `${index}.${item}` for dashboard items) */
  images?: Map<string, string>;
  author?: string;
}

export interface DeckResult {
  blob: Blob;
  slides: number;
  native: number;
  pictures: number;
  tables: number;
  filename: string;
}

type Slide = ReturnType<PptxGenJS["addSlide"]>;

function chrome(s: Slide, v: { title?: string; subtitle?: string; source?: string }, n: number, total: number, deckTitle: string) {
  s.background = { color: "FFFFFF" };
  s.addText(v.title ?? "Untitled view", { x: 0.5, y: 0.3, w: W - 1, h: 0.55, fontFace: "Georgia", fontSize: 22, bold: true, color: INK });
  if (v.subtitle) s.addText(v.subtitle, { x: 0.5, y: 0.85, w: W - 1, h: 0.4, fontFace: "Arial", fontSize: 12, color: MUTED });
  s.addShape("line", { x: 0.5, y: 1.3, w: W - 1, h: 0, line: { color: RULE, width: 0.75 } });
  s.addText([v.source ? `Source: ${v.source}` : "", `${deckTitle} · ${n}/${total}`].filter(Boolean).join("   ·   "), {
    x: 0.5,
    y: H - 0.45,
    w: W - 1,
    h: 0.3,
    fontFace: "Arial",
    fontSize: 9,
    color: MUTED,
  });
}

const BODY = { x: 0.5, y: 1.45, w: W - 1, h: H - 2.05 };

function fmt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return "";
  return String(v);
}

function addTable(s: Slide, columns: string[], rows: (string | number | null)[][]) {
  const max = 18;
  const head = columns.map((c) => ({ text: c, options: { bold: true, color: MUTED, fontSize: 10, border: [{ type: "none" }, { type: "none" }, { pt: 1, color: INK }, { type: "none" }] } }));
  const body = rows.slice(0, max).map((r) => r.map((c) => ({ text: fmt(c), options: { fontSize: 10, color: INK, border: [{ type: "none" }, { type: "none" }, { pt: 0.5, color: RULE }, { type: "none" }], align: typeof c === "number" ? "right" : "left" } })));
  // pptxgenjs table cell typing is loose; the objects above follow its TableCell shape
  s.addTable([head, ...body] as never, { ...BODY, fontFace: "Arial", autoPage: false, colW: columns.map(() => BODY.w / columns.length) });
  if (rows.length > max) s.addText(`${rows.length - max} more rows in the canvas`, { x: BODY.x, y: BODY.y + BODY.h - 0.1, w: BODY.w, h: 0.3, fontSize: 9, color: MUTED, fontFace: "Arial" });
}

function chartType(p: PptxGenJS, kind: string) {
  const t = p.ChartType;
  return kind === "line" ? t.line : kind === "area" ? t.area : t.bar;
}

/** Native chart for the view types PowerPoint has; false when it does not. */
function addNative(p: PptxGenJS, s: Slide, v: LeafSpec): boolean {
  const base = { ...BODY, fontFace: "Arial", catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, legendFontSize: 10, chartColors: PALETTE, valGridLine: { color: RULE, size: 0.5 }, catGridLine: { style: "none" as const } };
  switch (v.type) {
    case "chart": {
      const labels = v.data.map((r) => fmt(r[v.x]));
      const series = (names: string[]) => names.map((n) => ({ name: n, labels, values: v.data.map((r) => (typeof r[n] === "number" ? (r[n] as number) : 0)) }));
      if (v.chart === "combo" && v.lineSeries?.length) {
        const bars = v.series.filter((n) => !v.lineSeries!.includes(n));
        s.addChart(
          [
            { type: p.ChartType.bar, data: series(bars), options: { barGrouping: "clustered", chartColors: PALETTE } },
            { type: p.ChartType.line, data: series(v.lineSeries), options: { chartColors: PALETTE.slice(bars.length), secondaryValAxis: true, secondaryCatAxis: true } },
          ] as never,
          { ...base, showLegend: true, legendPos: "b", valAxes: [{ showValAxisTitle: false }, { showValAxisTitle: false, valGridLine: { style: "none" } }], catAxes: [{ catAxisTitle: v.x }, { catAxisHidden: true }] } as never,
        );
        return true;
      }
      const grouping = v.chart === "stacked" ? "stacked" : v.chart === "stacked100" ? "percentStacked" : "clustered";
      s.addChart(chartType(p, v.chart === "combo" ? "bar" : v.chart), series(v.series), { ...base, barGrouping: grouping, showLegend: v.series.length > 1, legendPos: "b", lineDataSymbol: "none", lineSize: 2 } as never);
      return true;
    }
    case "hbar": {
      const items = v.sort === "asc" ? [...v.items].sort((a, b) => a.value - b.value) : v.sort === "none" ? v.items : [...v.items].sort((a, b) => b.value - a.value);
      s.addChart(p.ChartType.bar, [{ name: v.title ?? "value", labels: items.map((i) => i.label), values: items.map((i) => i.value) }], { ...base, barDir: "bar", showLegend: false, showValue: items.length <= 15, dataLabelFontSize: 9 } as never);
      return true;
    }
    case "donut":
      s.addChart(p.ChartType.doughnut, [{ name: v.title ?? "share", labels: v.parts.map((x) => x.label), values: v.parts.map((x) => x.value) }], { ...base, holeSize: 60, showLegend: true, legendPos: "r", showPercent: true } as never);
      return true;
    case "scatter": {
      const xs = v.points.map((pt) => pt.x);
      s.addChart(p.ChartType.scatter, [{ name: "X", values: xs }, { name: v.yLabel, values: v.points.map((pt) => pt.y) }], { ...base, showLegend: false, valAxisTitle: v.yLabel, showValAxisTitle: true, catAxisTitle: v.xLabel, showCatAxisTitle: true, lineSize: 0, lineDataSymbolSize: 6 } as never);
      return true;
    }
    case "multiples":
      return false;
    default:
      return false;
  }
}

function addKpis(s: Slide, items: { label: string; value: string | number; unit?: string; delta?: number | null; note?: string }[]) {
  const per = Math.min(4, items.length);
  const rows = Math.ceil(items.length / per);
  const cw = BODY.w / per;
  const ch = Math.min(1.7, BODY.h / rows);
  items.forEach((k, i) => {
    const x = BODY.x + (i % per) * cw;
    const y = BODY.y + Math.floor(i / per) * ch;
    const val = typeof k.value === "number" ? `${k.unit === "$" ? "$" : ""}${fmt(k.value)}${k.unit && k.unit !== "$" ? k.unit : ""}` : k.value;
    s.addText(k.label.toUpperCase(), { x, y, w: cw - 0.2, h: 0.3, fontSize: 9, color: MUTED, fontFace: "Arial" });
    s.addText(val, { x, y: y + 0.3, w: cw - 0.2, h: 0.6, fontSize: 26, bold: true, color: INK, fontFace: "Georgia" });
    const sub = [k.delta != null ? `${k.delta > 0 ? "+" : ""}${fmt(k.delta)}` : "", k.note ?? ""].filter(Boolean).join(" · ");
    if (sub) s.addText(sub, { x, y: y + 0.9, w: cw - 0.2, h: 0.4, fontSize: 10, color: k.delta != null && k.delta < 0 ? "B42318" : MUTED, fontFace: "Arial" });
  });
}

function stripMarkdown(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

function leaves(views: ViewSpec[]): { key: string; v: LeafSpec }[] {
  const out: { key: string; v: LeafSpec }[] = [];
  views.forEach((v, i) => {
    if (v.type !== "dashboard") return out.push({ key: String(i), v });
    const sections = v.sections ?? v.tabs?.flatMap((t) => t.sections) ?? [];
    let j = 0;
    for (const sec of sections) for (const item of sec.items) out.push({ key: `${i}.${j++}`, v: item as LeafSpec });
  });
  return out;
}

export async function buildDeck(views: ViewSpec[], o: DeckOptions = {}): Promise<DeckResult> {
  const { default: Pptx } = await import("pptxgenjs");
  const p = new Pptx();
  p.layout = "LAYOUT_WIDE";
  p.author = o.author ?? "Filed Under";
  p.title = o.title ?? "Filed Under canvas";
  const deckTitle = o.title ?? "Filed Under";
  const items = leaves(views);
  const total = items.length + 1;
  let native = 0;
  let pictures = 0;
  let tables = 0;

  const cover = p.addSlide();
  cover.background = { color: INK };
  cover.addText(deckTitle, { x: 0.7, y: 2.6, w: W - 1.4, h: 1, fontFace: "Georgia", fontSize: 36, bold: true, color: "FAF8F4" });
  cover.addText(o.subtitle ?? `${items.length} views · exported ${new Date().toISOString().slice(0, 10)}`, { x: 0.7, y: 3.6, w: W - 1.4, h: 0.6, fontFace: "Arial", fontSize: 14, color: "C9C5BC" });

  items.forEach(({ key, v }, n) => {
    const s = p.addSlide();
    chrome(s, v, n + 2, total, deckTitle);
    const img = o.images?.get(key);
    const pictureFirst = ["heatmap", "waterfall", "candles", "treemap", "multiples", "timeline", "mermaid", "graph", "histogram", "sparktable", "cards"].includes(v.type);
    if (img && pictureFirst) {
      s.addImage({ data: img, ...BODY, sizing: { type: "contain", w: BODY.w, h: BODY.h } });
      pictures++;
      return;
    }
    if (addNative(p, s, v)) {
      native++;
      return;
    }
    if (v.type === "kpis") return addKpis(s, v.items);
    if (v.type === "table") {
      addTable(s, v.columns, v.rows);
      tables++;
      return;
    }
    if (v.type === "cards") return addKpis(s, v.items.flatMap((c) => c.metrics.map((m) => ({ ...m, label: `${c.title} · ${m.label}` }))).slice(0, 12));
    if (v.type === "note") {
      s.addText(stripMarkdown(v.markdown).slice(0, 2500), { ...BODY, fontSize: 13, color: INK, fontFace: "Arial", valign: "top" });
      return;
    }
    if (v.type === "code") {
      s.addText((v.stdout || v.result || v.code).slice(0, 2500), { ...BODY, fontSize: 10, color: INK, fontFace: "Courier New", valign: "top" });
      return;
    }
    if (v.type === "image") {
      s.addImage({ path: v.src, ...BODY, sizing: { type: "contain", w: BODY.w, h: BODY.h } });
      pictures++;
      return;
    }
    if (img) {
      s.addImage({ data: img, ...BODY, sizing: { type: "contain", w: BODY.w, h: BODY.h } });
      pictures++;
      return;
    }
    const t = tableOf(v);
    if (t) {
      addTable(s, t.columns, t.rows);
      tables++;
      return;
    }
    s.addText("This view has no tabular form; open it in the canvas.", { ...BODY, fontSize: 12, color: MUTED, fontFace: "Arial" });
  });

  const blob = (await p.write({ outputType: "blob" })) as Blob;
  const name = (o.title ?? "canvas").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "canvas";
  return { blob, slides: total, native, pictures, tables, filename: `${name}-${new Date().toISOString().slice(0, 10)}.pptx` };
}
