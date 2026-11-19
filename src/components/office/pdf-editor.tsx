import { useEffect, useRef, useState, type PointerEvent as PE } from "react";
import { ArrowDown, ArrowUp, FilePlus2, Highlighter, MousePointer2, RectangleHorizontal, Search, Square, Stamp, StickyNote, Trash2, Type, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { cn } from "@/lib/utils";
import { B, Group } from "@/components/office/writer-editor";
import { annotColor, uid, type AnnotType, type PdfDoc } from "@/lib/office/pdfdoc";

type Mode = "select" | AnnotType;
const TOOLS: { m: Mode; t: string; I: typeof Square }[] = [
  { m: "select", t: "Select", I: MousePointer2 }, { m: "highlight", t: "Highlight area", I: Highlighter }, { m: "note", t: "Sticky note", I: StickyNote },
  { m: "text", t: "Text box", I: Type }, { m: "rect", t: "Box", I: Square }, { m: "redact", t: "Redact", I: RectangleHorizontal }, { m: "stamp", t: "Stamp", I: Stamp },
];

export interface PdfEditorProps {
  pdf: PDFDocumentProxy | null; doc: PdfDoc; commit: () => void; page: number; setPage: (n: number) => void;
  find: (q: string) => Promise<number | null>;
}

function PageCanvas({ pdf, n, scale, onSize }: { pdf: PDFDocumentProxy; n: number; scale: number; onSize?: (w: number, h: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => e.isIntersecting && setVis(true), { rootMargin: "600px" });
    if (box.current) o.observe(box.current); return () => o.disconnect();
  }, []);
  useEffect(() => {
    let task: RenderTask | null = null, dead = false;
    void pdf.getPage(n).then((p) => {
      if (dead) return;
      const vp = p.getViewport({ scale }); onSize?.(vp.width / scale, vp.height / scale);
      const c = ref.current; if (!c || !vis) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = vp.width * dpr; c.height = vp.height * dpr; c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`;
      task = p.render({ canvasContext: c.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task.promise.catch(() => {});
    });
    return () => { dead = true; task?.cancel(); };
  }, [pdf, n, scale, vis]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={box}><canvas ref={ref} className="block bg-card" /></div>;
}

export function PdfEditor({ pdf, doc, commit, page, setPage, find }: PdfEditorProps) {
  const [mode, setMode] = useState<Mode>("select");
  const [color, setColor] = useState("");
  const [scale, setScale] = useState(1.2);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sizes, setSizes] = useState<Record<number, [number, number]>>({});
  const [drag, setDrag] = useState<{ pg: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ic = "h-3.5 w-3.5";
  const a = doc.annots.find((x) => x.id === sel);
  const mutate = (f: () => void) => { f(); commit(); };

  useEffect(() => {
    const el = scroller.current?.querySelector(`[data-page="${page}"]`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [page]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || t.closest("[data-agent-ignore]")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); mutate(() => { doc.annots = doc.annots.filter((x) => x.id !== sel); }); setSel(null); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  const pt = (e: PE, el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
  const down = (e: PE<HTMLDivElement>, pg: number) => {
    if (mode === "select") { if (e.target === e.currentTarget) setSel(null); return; }
    const p = pt(e, e.currentTarget); e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ pg, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const move = (e: PE<HTMLDivElement>) => { if (!drag) return; const p = pt(e, e.currentTarget); setDrag({ ...drag, x1: p.x, y1: p.y }); };
  const up = () => {
    if (!drag || mode === "select") return setDrag(null);
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    let w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    if (w < 6 || h < 6) { w = mode === "stamp" ? 160 : mode === "note" ? 180 : 140; h = mode === "stamp" ? 44 : mode === "note" ? 60 : mode === "text" ? 24 : 18; }
    const text = mode === "note" || mode === "text" ? window.prompt(mode === "note" ? "Note text" : "Text") ?? "" : mode === "stamp" ? window.prompt("Stamp text", "REVIEWED") ?? "REVIEWED" : undefined;
    const id = uid();
    mutate(() => doc.annots.push({ id, page: doc.pages[drag.pg].id, type: mode, x, y, w, h, text, color: color || undefined }));
    setSel(id); setDrag(null); setMode("select");
  };
  const pageOp = (f: (i: number) => void) => mutate(() => f(page - 1));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b bg-card" data-section="PDF ribbon">
        <div className="flex h-7 items-end gap-0.5 px-2"><span className="h-6 border-b-2 border-office px-3 text-[11px] font-semibold leading-6 text-office">Edit</span></div>
        <div className="flex h-[68px] items-stretch overflow-x-auto border-t bg-background/60 py-1">
          <Group name="Annotate">
            {TOOLS.map(({ m, t, I }) => <B key={m} title={t} active={mode === m} on={() => setMode(m)}><I className={ic} /></B>)}
            <label title="Colour" className="relative inline-flex h-6 items-center px-1 text-[11px]">Colour<span className="ml-0.5 h-1.5 w-3 border" style={{ background: color || undefined }} />
              <input type="color" aria-label="Annotation colour" onChange={(e) => { setColor(e.target.value); if (a) mutate(() => { a.color = e.target.value; }); }} className="absolute inset-0 opacity-0" /></label>
            <B title="Delete annotation" disabled={!a} on={() => mutate(() => { doc.annots = doc.annots.filter((x) => x.id !== sel); setSel(null); })}><Trash2 className={ic} /></B>
          </Group>
          <Group name="Pages">
            <B title="Insert blank page" on={() => pageOp((i) => doc.pages.splice(i + 1, 0, { id: uid(), src: "gen", title: "", body: "" }))} label="Insert"><FilePlus2 className={ic} /></B>
            <B title="Move page up" disabled={page < 2} on={() => pageOp((i) => { const [p] = doc.pages.splice(i, 1); doc.pages.splice(i - 1, 0, p); setPage(page - 1); })}><ArrowUp className={ic} /></B>
            <B title="Move page down" disabled={page >= doc.pages.length} on={() => pageOp((i) => { const [p] = doc.pages.splice(i, 1); doc.pages.splice(i + 1, 0, p); setPage(page + 1); })}><ArrowDown className={ic} /></B>
            <B title="Delete page" disabled={doc.pages.length < 2} on={() => pageOp((i) => { const [p] = doc.pages.splice(i, 1); doc.annots = doc.annots.filter((x) => x.page !== p.id); setPage(Math.max(1, Math.min(page, doc.pages.length))); })}><Trash2 className={ic} /></B>
          </Group>
          <Group name="Find">
            <form className="flex items-center gap-0.5" onSubmit={(e) => { e.preventDefault(); void find(q).then((n) => n && setPage(n)); }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find text" aria-label="Find text" className="h-6 w-36 rounded-sm border bg-background px-1.5 text-[11px] outline-none focus:border-office" />
              <B title="Find" on={() => void find(q).then((n) => n && setPage(n))}><Search className={ic} /></B>
            </form>
          </Group>
          <Group name="Zoom">
            <B title="Zoom out" on={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)))}><ZoomOut className={ic} /></B>
            <span className="w-9 text-center text-[11px] tabular-nums">{Math.round(scale * 100)}%</span>
            <B title="Zoom in" on={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))}><ZoomIn className={ic} /></B>
          </Group>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[96px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r bg-muted/40 p-2" data-section="Page thumbnails">
          {pdf && doc.pages.map((p, i) => (
            <button key={p.id} onClick={() => setPage(i + 1)} className={cn("mb-2 block w-full rounded-sm p-1 text-center", page === i + 1 ? "bg-office-soft ring-1 ring-office" : "hover:bg-muted")}>
              <div className="pointer-events-none mx-auto w-fit shadow-sm"><PageCanvas pdf={pdf} n={i + 1} scale={0.12} /></div>
              <span className="text-[10px] text-muted-foreground">{i + 1}</span>
            </button>
          ))}
        </div>
        <div ref={scroller} className="min-h-0 overflow-auto bg-muted/60 py-4" data-section="PDF pages">
          {!pdf && <div className="p-6 text-center text-xs text-muted-foreground">Rendering…</div>}
          {pdf && doc.pages.map((p, i) => {
            const [w, h] = sizes[i] ?? [612, 792];
            return (
              <div key={p.id} data-page={i + 1} className="relative mx-auto mb-4 w-fit shadow-md" style={{ minHeight: h * scale }}>
                <PageCanvas pdf={pdf} n={i + 1} scale={scale} onSize={(W, H) => (W !== w || H !== h) && setSizes((s) => ({ ...s, [i]: [W, H] }))} />
                <div className={cn("absolute inset-0", mode !== "select" && "cursor-crosshair")} onPointerDown={(e) => { setPage(i + 1); down(e, i); }} onPointerMove={move} onPointerUp={up}>
                  {doc.annots.filter((x) => x.page === p.id).map((x) => (
                    <div key={x.id} title={x.text || x.type} onPointerDown={(e) => { if (mode === "select") { e.stopPropagation(); setSel(x.id); } }}
                      className={cn("absolute", mode === "select" && "cursor-pointer", sel === x.id && "outline outline-2 outline-offset-1 outline-office")}
                      style={{ left: x.x * scale, top: x.y * scale, width: x.w * scale, height: x.h * scale }} />
                  ))}
                  {drag && drag.pg === i && (
                    <div className="pointer-events-none absolute border border-dashed border-office bg-office/10"
                      style={{ left: Math.min(drag.x0, drag.x1) * scale, top: Math.min(drag.y0, drag.y1) * scale, width: Math.abs(drag.x1 - drag.x0) * scale, height: Math.abs(drag.y1 - drag.y0) * scale, borderColor: color || undefined }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-3 border-t bg-card px-3 text-[11px] text-muted-foreground">
        <span>Page {page} of {doc.pages.length}</span><span>{doc.annots.length} annotations</span>
        {a && <span className="text-foreground">Selected: {a.type}{a.text ? `: ${a.text.slice(0, 40)}` : ""} <span className="inline-block h-2 w-2 align-middle" style={{ background: annotColor(a) }} /></span>}
      </div>
    </div>
  );
}
