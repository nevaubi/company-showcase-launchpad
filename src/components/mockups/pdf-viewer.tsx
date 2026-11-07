import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type Doc = { id: string; file: string; name: string; page: number; pages: number; find: string };
type Box = { x: number; y: number; w: number; h: number };

/** Renders a real PDF page (pdf.js canvas) and highlights the cited text run. */
export function PdfViewer({ doc, onLit }: { doc: Doc; onLit?: (v: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [pageH, setPageH] = useState(0);
  const [lit, setLit] = useState(false);

  useEffect(() => {
    let dead = false;
    setReady(false); setLit(false); setBox(null); onLit?.(false);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const pdf = await pdfjs.getDocument(doc.file).promise;
      const page = await pdf.getPage(1);
      const width = host.current?.clientWidth ?? 640;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / base.width });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const c = canvas.current;
      if (!c || dead) return;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`;
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
      const text = await page.getTextContent();
      let found: Box | null = null;
      for (const it of text.items as { str: string; transform: number[]; width: number }[]) {
        const at = it.str.indexOf(doc.find);
        if (at < 0) continue;
        const t = pdfjs.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(t[2], t[3]);
        const full = it.width * vp.scale;
        const per = full / Math.max(1, it.str.length);
        found = { x: t[4] + per * at - 3, y: t[5] - fh * 0.95, w: per * doc.find.length + 6, h: fh * 1.25 };
        break;
      }
      if (dead) return;
      setPageH(vp.height); setBox(found); setReady(true);
      setTimeout(() => { if (!dead) { setLit(true); onLit?.(true); } }, 650);
    })();
    return () => { dead = true; };
  }, [doc.file, doc.find]);

  const viewH = 560;
  const offset = box ? Math.max(0, Math.min(pageH - viewH, box.y - viewH * 0.42)) : 0;

  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] border border-ink/15 bg-card shadow-lift">
      {/* Toolbar */}
      <div className="flex h-10 items-center gap-4 border-b border-rule bg-muted/60 px-4 text-[11.5px] text-muted-foreground">
        <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current" strokeWidth="1.3"><path d="M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13" /></svg>
        <span className="truncate text-foreground">{doc.name}</span>
        <div className="ml-auto hidden items-center gap-1.5 sm:flex">
          <span className="rounded border border-rule bg-card px-1.5 py-0.5 tabular-nums text-foreground">{doc.page}</span>
          <span className="tabular-nums">of {doc.pages}</span>
        </div>
        <span className="hidden h-4 w-px bg-rule md:block" />
        <span className="hidden tabular-nums md:inline">100%</span>
        <span className="hidden h-4 w-px bg-rule md:block" />
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current" strokeWidth="1.3"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
          <span className="font-mono text-foreground">{doc.find}</span>
          <span className="tabular-nums">1/1</span>
        </span>
      </div>
      {/* Canvas */}
      <div className="bg-muted/40 p-5">
        <div ref={host} className="relative mx-auto overflow-hidden bg-card shadow-paper ring-1 ring-ink/10" style={{ height: viewH }}>
          <div className="absolute inset-x-0 top-0 transition-transform duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `translate3d(0,${-offset}px,0)` }}>
            <canvas ref={canvas} className={`block transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`} />
            {box && (
              <span data-pdf-hit className="pointer-events-none absolute rounded-[2px] bg-highlight/55 mix-blend-multiply transition-transform duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)]"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h, transformOrigin: "left", transform: `scaleX(${lit ? 1 : 0})` }} />
            )}
            {box && (
              <span className={`pointer-events-none absolute rounded-[3px] ring-1 ring-ink/50 transition-opacity duration-700 ${lit ? "opacity-100 delay-700" : "opacity-0"}`}
                style={{ left: box.x - 3, top: box.y - 3, width: box.w + 6, height: box.h + 6 }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
