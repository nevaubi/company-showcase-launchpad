// Rasterises the report charts currently on screen (SVG) into PNGs for the Word export. Browser-only:
// computed styles are inlined so theme variables survive outside the page.

export interface ChartImage { png: Uint8Array; w: number; h: number }

const PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline"] as const;

function inline(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  const style = PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
  dst.setAttribute("style", style);
  for (let i = 0; i < src.children.length; i++) {
    const a = src.children[i], b = dst.children[i];
    if (a && b) inline(a, b);
  }
}

async function rasterise(svg: SVGSVGElement, background: string, scale = 2): Promise<ChartImage | null> {
  const vb = svg.viewBox.baseVal;
  const w = Math.round(vb?.width || svg.clientWidth), h = Math.round(vb?.height || svg.clientHeight);
  if (!w || !h) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inline(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.querySelectorAll("title").forEach((t) => t.remove());
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("style", `fill:${background}`);
  clone.insertBefore(bg, clone.firstChild);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), w, h };
}

/** PNG of every `svg[data-report-chart]` under `root`, keyed by chart id. Failures are skipped. */
export async function captureCharts(root: ParentNode = document): Promise<Map<string, ChartImage>> {
  const out = new Map<string, ChartImage>();
  const doc = root instanceof Element ? root : document.querySelector(".report-doc");
  const background = doc ? getComputedStyle(doc).backgroundColor || "#ffffff" : "#ffffff";
  for (const svg of root.querySelectorAll<SVGSVGElement>("svg[data-report-chart]")) {
    const id = svg.dataset["reportChart"];
    if (!id || out.has(id)) continue;
    try {
      const img = await rasterise(svg, background);
      if (img) out.set(id, img);
    } catch {
      /* skip this chart */
    }
  }
  return out;
}
