import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { OfficeAiPanel } from "@/components/office/office-ai-panel";
import { PdfEditor } from "@/components/office/pdf-editor";
import { getOfficeFile, markOfficeSaved } from "@/lib/office/files.functions";
import { pdfTool, type PageText } from "@/lib/office/pdf-agent";
import { blankPdf, buildPdf, fromBase, type PdfDoc } from "@/lib/office/pdfdoc";

export const Route = createFileRoute("/_authenticated/app/office/pdf/$id")({
  head: () => ({
    meta: [
      { title: "PDF Studio · FiledUnder" },
      { name: "description", content: "Review, mark up and write PDFs with OfficeAI and SEC-sourced data." },
      { property: "og:title", content: "PDF Studio · FiledUnder" },
      { property: "og:description", content: "Review, mark up and write PDFs with OfficeAI and SEC-sourced data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PdfRoute,
});

const bucket = () => supabase.storage.from("office-files");
type Loaded = { doc: PdfDoc; base: ArrayBuffer | null; baseStored: boolean };

async function loadPdf(owner: string, id: string, hasFile: boolean): Promise<Loaded> {
  const side = await bucket().download(`${owner}/${id}.pdf.json`);
  if (side.data) {
    const doc = JSON.parse(await side.data.text()) as PdfDoc;
    if (!doc.hasBase) return { doc, base: null, baseStored: true };
    const b = await bucket().download(`${owner}/${id}.base.pdf`);
    if (b.data) return { doc, base: await b.data.arrayBuffer(), baseStored: true };
  }
  if (hasFile) {
    const f = await bucket().download(`${owner}/${id}.pdf`);
    if (f.data) {
      const base = await f.data.arrayBuffer();
      const { PDFDocument } = await import("pdf-lib");
      const n = (await PDFDocument.load(base, { ignoreEncryption: true })).getPageCount();
      return { doc: fromBase(n), base, baseStored: false };
    }
  }
  return { doc: blankPdf(), base: null, baseStored: true };
}

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

function PdfRoute() {
  const { id } = Route.useParams();
  const get = useServerFn(getOfficeFile);
  const file = useQuery({ queryKey: ["office-file", id], queryFn: () => get({ data: { id } }) });
  const content = useQuery({
    queryKey: ["office-pdf", id], enabled: !!file.data, staleTime: Infinity, gcTime: 0,
    queryFn: () => loadPdf(file.data!.owner, id, !!file.data!.storage_path),
  });
  if (file.error || content.error) return <div className="p-6 text-sm text-muted-foreground">This PDF could not be opened.</div>;
  if (!file.data || !content.data) return <Skeleton className="m-6 h-[600px]" />;
  return <PdfBody id={id} owner={file.data.owner} initialTitle={file.data.title} initial={content.data} />;
}

function PdfBody({ id, owner, initialTitle, initial }: { id: string; owner: string; initialTitle: string; initial: Loaded }) {
  const mark = useServerFn(markOfficeSaved);
  const [title, setTitle] = useState(initialTitle);
  const [state, setState] = useState<"saved" | "dirty" | "saving">("saved");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [, setV] = useState(0);
  const doc = useRef(initial.doc);
  const baseStored = useRef(initial.baseStored);
  const bytes = useRef<Uint8Array | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const building = useRef<Promise<void>>(Promise.resolve());
  const textCache = useRef<PageText[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleRef = useRef(title); titleRef.current = title;
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const rebuild = useCallback(() => {
    building.current = building.current.then(async () => {
      try {
        const out = await buildPdf(initial.base, doc.current, titleRef.current);
        bytes.current = out; textCache.current = null;
        const lib = await pdfjs();
        const next = await lib.getDocument({ data: out.slice() }).promise;
        const old = pdfRef.current; pdfRef.current = next; setPdf(next); void old?.destroy();
      } catch (e) { toast.error(`Could not render the PDF: ${(e as Error).message}`); }
    });
    return building.current;
  }, [initial.base]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (state !== "saved") e.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [state]);
  useEffect(() => { void rebuild(); return () => { void pdfRef.current?.destroy(); clearTimeout(timer.current); }; }, [rebuild]);

  const dirty = useCallback(() => { setState("dirty"); clearTimeout(timer.current); timer.current = setTimeout(() => void saveRef.current(), 2500); }, []);
  const commit = useCallback(() => { setV((v) => v + 1); dirty(); return rebuild(); }, [dirty, rebuild]);

  saveRef.current = async () => {
    setState("saving");
    try {
      await building.current;
      if (!bytes.current) throw new Error("not rendered yet");
      if (!baseStored.current && initial.base) {
        const b = await bucket().upload(`${owner}/${id}.base.pdf`, new Blob([initial.base], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
        if (b.error) throw b.error; baseStored.current = true;
      }
      await bucket().upload(`${owner}/${id}.pdf.json`, new Blob([JSON.stringify(doc.current)], { type: "application/json" }), { upsert: true });
      const blob = new Blob([bytes.current.slice()], { type: "application/pdf" });
      const r = await bucket().upload(`${owner}/${id}.pdf`, blob, { upsert: true, contentType: "application/pdf" });
      if (r.error) throw r.error;
      await mark({ data: { id, size: blob.size, title: titleRef.current || "Untitled" } });
      setState("saved");
    } catch (e) { setState("dirty"); toast.error(`Save failed: ${(e as Error).message}`); }
  };

  const text = useCallback(async (): Promise<PageText[]> => {
    await building.current;
    if (textCache.current) return textCache.current;
    const p = pdfRef.current; if (!p) return [];
    const out: PageText[] = [];
    for (let i = 1; i <= p.numPages; i++) {
      const pg = await p.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [, , c, d, e, f] = it.transform as number[];
        const h = Math.hypot(c, d) || it.height || 10;
        items.push({ s: it.str, x: e, y: vp.height - f - h * 0.85, w: it.width, h: h * 1.1 });
      }
      out.push({ w: vp.width, h: vp.height, items });
    }
    textCache.current = out; return out;
  }, []);

  const find = useCallback(async (q: string) => {
    const t = await text(), l = q.toLowerCase().trim(); if (!l) return null;
    const i = t.findIndex((p) => p.items.map((x) => x.s).join(" ").toLowerCase().includes(l));
    if (i < 0) { toast.info("No matches"); return null; }
    return i + 1;
  }, [text]);

  async function download() {
    await building.current; if (!bytes.current) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes.current.slice()], { type: "application/pdf" })); a.download = `${title || "document"}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const tool = useMemo(() => pdfTool({
    doc: () => doc.current, commit, text, goTo: setPage,
    setTitle: (t) => { setTitle(t); titleRef.current = t; void saveRef.current(); },
  }), [commit, text]);

  return (
    <div data-office="pdf" className="-m-4 flex h-[calc(100dvh-8rem)] min-w-0 flex-col overflow-hidden border bg-background md:-m-6">
      <div className="flex h-9 min-w-0 shrink-0 items-center gap-2 bg-office px-2 text-office-foreground">
        <Link to="/app/office" aria-label="Back to Office Studio" className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-office-foreground/15"><ArrowLeft className="h-4 w-4" /></Link>
        <span className="text-xs font-semibold">PDF Studio</span>
        <span className="h-4 w-px bg-office-foreground/30" />
        <input aria-label="Title" value={title} onChange={(e) => { setTitle(e.target.value); dirty(); }}
          className="min-w-0 max-w-sm flex-1 rounded-sm bg-transparent px-1.5 py-0.5 text-xs outline-none hover:bg-office-foreground/10 focus:bg-office-foreground/15" />
        <span className="text-[11px] opacity-80">{state === "saving" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : state === "dirty" ? "Saving soon…" : "Saved"}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => void saveRef.current()} className="h-6 rounded-sm px-2 text-[11px] hover:bg-office-foreground/15">Save</button>
          <button onClick={() => void download()} className="flex h-6 items-center gap-1 rounded-sm bg-office-foreground/15 px-2 text-[11px] hover:bg-office-foreground/25"><Download className="h-3 w-3" /> Download .pdf</button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <PdfEditor pdf={pdf} doc={doc.current} commit={() => void commit()} page={page} setPage={setPage} find={find} />
        <div className="hidden min-h-0 lg:block">
          <OfficeAiPanel app="pdf" localTool={tool} context={() => `PDF "${titleRef.current}", ${doc.current.pages.length} pages, ${doc.current.annots.length} annotations; user is on page ${page}. Call pdf_read to see it.`} />
        </div>
      </div>
    </div>
  );
}
