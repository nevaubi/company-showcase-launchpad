// Export any on-screen house chart (an <svg>) as a standalone SVG or PNG with its title block, units and source
// line drawn into the image, so the file stands on its own when pasted into a deck or shared. Browser-only.

const PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline", "letter-spacing"] as const;

function inline(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  dst.setAttribute("style", PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  for (let i = 0; i < src.children.length; i++) {
    const a = src.children[i];
    const b = dst.children[i];
    if (a && b) inline(a, b);
  }
}

export interface ChartFrame {
  title?: string;
  subtitle?: string;
  units?: string;
  source?: string;
  /** background colour; defaults to the page background */
  background?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Wrap `text` to lines of at most `chars` characters (approximate; SVG has no layout engine). */
function wrap(text: string, chars: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if ((line + " " + w).trim().length > chars && line) {
      out.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

/** Standalone SVG markup: title block, the chart, then units and source. */
export function framedSvg(svg: SVGSVGElement, frame: ChartFrame): { markup: string; width: number; height: number } {
  const vb = svg.viewBox?.baseVal;
  const w = Math.round(vb?.width || svg.clientWidth || svg.getBoundingClientRect().width || 640);
  const h = Math.round(vb?.height || svg.clientHeight || svg.getBoundingClientRect().height || 360);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inline(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.querySelectorAll("title").forEach((t) => t.remove());
  const root = getComputedStyle(document.documentElement);
  const ink = root.getPropertyValue("--foreground").trim() || "#1a1a1a";
  const muted = root.getPropertyValue("--muted-foreground").trim() || "#6e6a62";
  const bg = frame.background ?? (getComputedStyle(document.body).backgroundColor || "#ffffff");
  const pad = 16;
  const chars = Math.max(30, Math.floor((w - 2 * pad) / 6.2));
  const titleLines = frame.title ? wrap(frame.title, Math.floor(chars * 0.75)) : [];
  const subLines = frame.subtitle ? wrap(frame.subtitle, chars) : [];
  const foot = [frame.units ? `Units: ${frame.units}` : "", frame.source ? `Source: ${frame.source}` : "", "Filed Under"].filter(Boolean).join(" · ");
  const footLines = wrap(foot, chars);
  let y = pad;
  const parts: string[] = [];
  for (const l of titleLines) {
    y += 18;
    parts.push(`<text x="${pad}" y="${y}" style="font-family:Georgia,serif;font-size:16px;font-weight:600;fill:${ink}">${esc(l)}</text>`);
  }
  for (const l of subLines) {
    y += 15;
    parts.push(`<text x="${pad}" y="${y}" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;fill:${muted}">${esc(l)}</text>`);
  }
  y += titleLines.length || subLines.length ? 10 : 0;
  const chartY = y;
  y += h + 8;
  for (const l of footLines) {
    y += 12;
    parts.push(`<text x="${pad}" y="${y}" style="font-family:Helvetica,Arial,sans-serif;font-size:9.5px;fill:${muted}">${esc(l)}</text>`);
  }
  const H = y + pad;
  const W = w + 2 * pad;
  clone.setAttribute("x", String(pad));
  clone.setAttribute("y", String(chartY));
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" style="fill:${bg}"/>${parts.join("")}${new XMLSerializer().serializeToString(clone)}</svg>`;
  return { markup, width: W, height: H };
}

export async function svgToPng(markup: string, width: number, height: number, scale = 2): Promise<Blob> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("PNG encoding failed");
  return blob;
}

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chart";

export async function exportChart(svg: SVGSVGElement, frame: ChartFrame, format: "svg" | "png") {
  const { markup, width, height } = framedSvg(svg, frame);
  const name = fileSlug(frame.title ?? "chart");
  if (format === "svg") downloadFile(new Blob([markup], { type: "image/svg+xml" }), `${name}.svg`);
  else downloadFile(await svgToPng(markup, width, height), `${name}.png`);
  return { markup, width, height };
}
