// Office Slides ⇄ real .pptx. Export with pptxgenjs, import text/tables from slide XML (jszip).
import { H, makeSlide, uid, W, type Deck, type El, type Slide } from "@/lib/office/deck";

const hx = (c?: string) => (c ? c.replace("#", "").toUpperCase() : undefined);

export async function deckToPptx(d: Deck, title: string) {
  const mod = await import("pptxgenjs");
  const P = (mod.default ?? mod) as unknown as new () => import("pptxgenjs").default;
  const pres = new P();
  pres.layout = "LAYOUT_WIDE";
  pres.title = title;
  pres.author = "Filed Under";
  const ink = d.theme.dark ? "F5F5F5" : "1F2328";
  for (const s of d.slides) {
    const sl = pres.addSlide();
    sl.background = { color: hx(s.bg) ?? (d.theme.dark ? "141821" : "FFFFFF") };
    if (s.notes) sl.addNotes(s.notes);
    for (const e of s.els) {
      const st = e.style ?? {};
      const box = { x: e.x, y: e.y, w: e.w, h: e.h };
      const font = { fontFace: d.theme.font, fontSize: st.size ?? 18, bold: st.bold, italic: st.italic, color: hx(st.color) ?? (e.role === "title" ? hx(d.theme.accent) : ink), align: st.align, valign: st.valign ?? "top" } as const;
      const fill = st.fill ? { fill: { color: hx(st.fill)! } } : {};
      if (e.type === "text") sl.addText(e.text ?? "", { ...box, ...font, ...fill, fit: "shrink" });
      else if (e.type === "bullets") sl.addText((e.bullets ?? []).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { ...box, ...font, ...fill, paraSpaceAfter: 6, fit: "shrink" });
      else if (e.type === "table" && e.rows?.length) {
        sl.addTable(e.rows.map((r, ri) => r.map((c, ci) => ({
          text: c, options: ri === 0 ? { bold: true, color: "FFFFFF", fill: { color: hx(d.theme.accent)! } } : { align: ci > 0 && /^[-$(]?[\d.,]+/.test(c) ? "right" : "left" } as never,
        }))), { ...box, fontFace: d.theme.font, fontSize: st.size ?? 12, color: ink, border: { type: "solid", pt: 0.5, color: "BFBFBF" }, autoPage: false });
      } else if (e.type === "chart" && e.chart) {
        const t = { bar: pres.ChartType.bar, line: pres.ChartType.line, pie: pres.ChartType.pie, area: pres.ChartType.area }[e.chart.type];
        sl.addChart(t as never, e.chart.series.map((x) => ({ name: x.name, labels: e.chart!.labels, values: x.values })), {
          ...box, showLegend: e.chart.series.length > 1 || e.chart.type === "pie", legendPos: "b", legendFontSize: 10, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
          chartColors: [hx(d.theme.accent)!, "8FAADC", "F4B183", "A9D18E", "FFD966"], barDir: "col",
        } as never);
      } else if (e.type === "metric" && e.metric) {
        sl.addShape(pres.ShapeType.roundRect, { ...box, fill: { color: hx(st.fill) ?? "F3F6FA" }, line: { color: hx(d.theme.accent)!, width: 1 }, rectRadius: 0.08 });
        sl.addText([
          { text: e.metric.value, options: { fontSize: st.size ?? 32, bold: true, color: hx(d.theme.accent), breakLine: true } },
          { text: e.metric.label, options: { fontSize: 12, color: ink, breakLine: true } },
          ...(e.metric.delta ? [{ text: e.metric.delta, options: { fontSize: 11, color: e.metric.delta.trim().startsWith("-") ? "C00000" : "2E7D32" } }] : []),
        ], { ...box, fontFace: d.theme.font, align: "center", valign: "middle" });
      } else if (e.type === "shape") {
        const kind = { rect: pres.ShapeType.rect, rounded: pres.ShapeType.roundRect, ellipse: pres.ShapeType.ellipse, line: pres.ShapeType.line }[e.shape ?? "rect"];
        sl.addShape(kind, { ...box, fill: e.shape === "line" ? undefined : { color: hx(st.fill) ?? hx(d.theme.accent)! }, line: { color: hx(st.color) ?? hx(d.theme.accent)!, width: 1 } });
        if (e.text) sl.addText(e.text, { ...box, ...font, color: hx(st.color) ?? "FFFFFF", align: st.align ?? "center", valign: "middle" });
      }
    }
  }
  return (await pres.write({ outputType: "blob" })) as Blob;
}

const EMU = 914400;
export async function pptxToDeck(data: ArrayBuffer): Promise<Deck> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  const slides: Slide[] = [];
  const parse = (x: string) => new DOMParser().parseFromString(x, "application/xml");
  for (const n of names) {
    const doc = parse(await zip.file(n)!.async("string"));
    const s = makeSlide("blank");
    const box = (el: Element) => {
      const off = el.getElementsByTagName("a:off")[0], ext = el.getElementsByTagName("a:ext")[0];
      return off && ext ? { x: Number(off.getAttribute("x")) / EMU, y: Number(off.getAttribute("y")) / EMU, w: Number(ext.getAttribute("cx")) / EMU, h: Number(ext.getAttribute("cy")) / EMU } : null;
    };
    for (const sp of Array.from(doc.getElementsByTagName("p:sp"))) {
      const paras = Array.from(sp.getElementsByTagName("a:p")).map((p) => Array.from(p.getElementsByTagName("a:t")).map((t) => t.textContent ?? "").join("")).filter(Boolean);
      if (!paras.length) continue;
      const ph = sp.getElementsByTagName("p:ph")[0]?.getAttribute("type") ?? "";
      const b = box(sp) ?? (ph.includes("itle") ? { x: 0.6, y: 0.4, w: W - 1.2, h: 1 } : { x: 0.6, y: 1.5, w: W - 1.2, h: 5.4 });
      const sz = Number(sp.getElementsByTagName("a:rPr")[0]?.getAttribute("sz")) / 100 || undefined;
      const isTitle = ph === "title" || ph === "ctrTitle";
      const e: El = paras.length > 1 && !isTitle
        ? { id: uid(), type: "bullets", ...b, bullets: paras, style: { size: sz ?? 16 } }
        : { id: uid(), type: "text", ...b, text: paras.join("\n"), role: isTitle ? "title" : undefined, style: { size: sz ?? (isTitle ? 28 : 16), bold: isTitle } };
      s.els.push(e);
    }
    for (const gf of Array.from(doc.getElementsByTagName("p:graphicFrame"))) {
      const rows = Array.from(gf.getElementsByTagName("a:tr")).map((tr) => Array.from(tr.getElementsByTagName("a:tc")).map((tc) => Array.from(tc.getElementsByTagName("a:t")).map((t) => t.textContent).join("")));
      const b = gf.getElementsByTagName("p:xfrm")[0];
      if (rows.length && b) s.els.push({ id: uid(), type: "table", ...box(b)!, rows, style: { size: 12 } });
    }
    const notesRel = await zip.file(n.replace("slides/", "slides/_rels/") + ".rels")?.async("string");
    const nt = notesRel?.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
    if (nt) {
      const nd = parse(await zip.file(`ppt/notesSlides/${nt}`)!.async("string"));
      s.notes = Array.from(nd.getElementsByTagName("p:sp")).filter((sp) => sp.getElementsByTagName("p:ph")[0]?.getAttribute("type") === "body")
        .map((sp) => Array.from(sp.getElementsByTagName("a:t")).map((t) => t.textContent).join("")).join("\n");
    }
    s.els = s.els.map((e) => ({ ...e, x: Math.max(0, Math.min(W - 0.2, e.x)), y: Math.max(0, Math.min(H - 0.1, e.y)) }));
    slides.push(s);
  }
  return { slides: slides.length ? slides : [makeSlide("title")], theme: { accent: "#1F4E79", font: "Aptos", dark: false } };
}
