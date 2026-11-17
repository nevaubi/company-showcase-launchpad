// Office Slides deck model (16:9, 13.333 × 7.5 in) and pure operations shared by the
// editor, the OfficeAI executor, pptx import/export and tests.
export const W = 13.333, H = 7.5;
export type ElType = "text" | "bullets" | "table" | "chart" | "metric" | "shape";
export interface ElStyle { size?: number; bold?: boolean; italic?: boolean; color?: string; fill?: string; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom" }
export interface ChartSpec { type: "bar" | "line" | "pie" | "area"; labels: string[]; series: { name: string; values: number[] }[] }
export interface Metric { value: string; label: string; delta?: string }
export interface El {
  id: string; type: ElType; x: number; y: number; w: number; h: number;
  text?: string; bullets?: string[]; rows?: string[][]; chart?: ChartSpec; metric?: Metric; shape?: "rect" | "rounded" | "ellipse" | "line";
  style?: ElStyle; role?: "title" | "subtitle";
}
export interface Slide { id: string; els: El[]; notes: string; bg?: string }
export interface Theme { accent: string; font: "Aptos" | "Calibri" | "Georgia" | "Arial"; dark: boolean }
export interface Deck { slides: Slide[]; theme: Theme }
export type Layout = "title" | "title_content" | "two_content" | "section" | "title_only" | "blank";

let seq = 0;
export const uid = (p = "e") => `${p}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

export function makeSlide(layout: Layout, title = "", subtitle = ""): Slide {
  const t = (o: Partial<El>): El => ({ id: uid(), type: "text", x: 0.6, y: 0.4, w: W - 1.2, h: 1, text: "", ...o });
  const els: El[] = [];
  switch (layout) {
    case "title":
      els.push(t({ role: "title", y: 2.4, h: 1.4, text: title, style: { size: 40, bold: true, align: "center", valign: "bottom" } }));
      els.push(t({ role: "subtitle", y: 3.9, h: 0.9, text: subtitle, style: { size: 20, align: "center", valign: "top" } }));
      break;
    case "section":
      els.push(t({ role: "title", y: 3, h: 1.2, text: title, style: { size: 36, bold: true, valign: "middle" } }));
      if (subtitle) els.push(t({ role: "subtitle", y: 4.2, h: 0.7, text: subtitle, style: { size: 18 } }));
      break;
    case "blank": break;
    default:
      els.push(t({ role: "title", h: 0.9, text: title, style: { size: 28, bold: true, valign: "middle" } }));
      if (layout === "title_content") els.push({ id: uid(), type: "bullets", x: 0.6, y: 1.5, w: W - 1.2, h: 5.4, bullets: subtitle ? [subtitle] : [], style: { size: 18 } });
      if (layout === "two_content") {
        els.push({ id: uid(), type: "bullets", x: 0.6, y: 1.5, w: 5.9, h: 5.4, bullets: [], style: { size: 16 } });
        els.push({ id: uid(), type: "bullets", x: 6.8, y: 1.5, w: 5.9, h: 5.4, bullets: [], style: { size: 16 } });
      }
  }
  return { id: uid("s"), els, notes: "" };
}

export const blankDeck = (): Deck => ({ slides: [makeSlide("title", "", "")], theme: { accent: "#1F4E79", font: "Aptos", dark: false } });

/** Keep an element inside the slide. */
export function clampEl(e: El): El {
  const w = Math.max(0.2, Math.min(W, e.w)), h = Math.max(0.1, Math.min(H, e.h));
  return { ...e, w, h, x: Math.max(0, Math.min(W - w, e.x)), y: Math.max(0, Math.min(H - h, e.y)) };
}

export function moveSlide(d: Deck, from: number, to: number) {
  const [s] = d.slides.splice(from, 1);
  if (!s) throw new Error(`No slide ${from + 1}`);
  d.slides.splice(Math.max(0, Math.min(d.slides.length, to)), 0, s);
}

export function duplicateSlide(d: Deck, i: number) {
  const s = d.slides[i];
  if (!s) throw new Error(`No slide ${i + 1}`);
  const c: Slide = JSON.parse(JSON.stringify(s));
  c.id = uid("s"); c.els.forEach((e) => (e.id = uid()));
  d.slides.splice(i + 1, 0, c);
  return i + 1;
}

/** One-line text description of a slide for the agent. */
export function describeSlide(s: Slide, i: number) {
  const parts = s.els.map((e) => {
    const box = `@(${e.x.toFixed(1)},${e.y.toFixed(1)} ${e.w.toFixed(1)}×${e.h.toFixed(1)})`;
    const body = e.type === "text" ? JSON.stringify(e.text ?? "") : e.type === "bullets" ? (e.bullets ?? []).map((b) => `• ${b}`).join(" ")
      : e.type === "table" ? `${e.rows?.length ?? 0}×${e.rows?.[0]?.length ?? 0}: ${(e.rows ?? []).slice(0, 3).map((r) => r.join(" | ")).join(" / ")}`
      : e.type === "chart" ? `${e.chart?.type} ${e.chart?.series.map((x) => x.name).join(", ")} over ${e.chart?.labels.join(",")}`
      : e.type === "metric" ? `${e.metric?.value} ${e.metric?.label} ${e.metric?.delta ?? ""}` : e.shape ?? "rect";
    return `  - ${e.id} ${e.role ?? e.type} ${box}: ${body}`.slice(0, 600);
  });
  return `Slide ${i + 1}${s.notes ? ` (notes: ${s.notes.slice(0, 120)})` : ""}\n${parts.join("\n") || "  (empty)"}`;
}
