import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { WriterPage, WriterRibbon, useWriter } from "@/components/office/writer-editor";
import { getOfficeFile, markOfficeSaved } from "@/lib/office/files.functions";
import { writerToDocx, type JNode, type WriterSettings } from "@/lib/office/writer-docx";

export const Route = createFileRoute("/_authenticated/app/office/writer/$id")({
  head: () => ({
    meta: [
      { title: "Writer — Filed Under" },
      { name: "description", content: "Edit Word documents in Filed Under." },
      { property: "og:title", content: "Writer — Filed Under" },
      { property: "og:description", content: "Edit Word documents in Filed Under." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WriterRoute,
});

const DEFAULTS: WriterSettings = { header: "", footer: "", pageNumbers: true, columns: 1 };
const bucket = () => supabase.storage.from("office-files");

/** Sidecar JSON keeps exact editor state; the .docx next to it is the real Word file. */
async function loadContent(owner: string, id: string, hasDocx: boolean) {
  const side = await bucket().download(`${owner}/${id}.writer.json`);
  if (side.data) return JSON.parse(await side.data.text()) as { doc: JNode; settings: WriterSettings };
  if (hasDocx) {
    const f = await bucket().download(`${owner}/${id}.docx`);
    if (f.data) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await f.data.arrayBuffer() });
      return { doc: value as unknown as JNode, settings: DEFAULTS };
    }
  }
  return { doc: null, settings: DEFAULTS };
}

function WriterRoute() {
  const { id } = Route.useParams();
  const get = useServerFn(getOfficeFile);
  const mark = useServerFn(markOfficeSaved);
  const file = useQuery({ queryKey: ["office-file", id], queryFn: () => get({ data: { id } }) });
  const content = useQuery({
    queryKey: ["office-writer", id], enabled: !!file.data, staleTime: Infinity,
    queryFn: () => loadContent(file.data!.owner, id, !!file.data!.storage_path),
  });
  const [title, setTitle] = useState("");
  const [settings, setSettingsRaw] = useState<WriterSettings>(DEFAULTS);
  const [state, setState] = useState<"saved" | "dirty" | "saving">("saved");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (file.data) setTitle(file.data.title); }, [file.data]);
  useEffect(() => { if (content.data) setSettingsRaw({ ...DEFAULTS, ...content.data.settings }); }, [content.data]);

  const editorRef = useRef<ReturnType<typeof useWriter>>(null);
  const editorReady = useState(0)[1];
  const save = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || !file.data) return;
    setState("saving");
    try {
      const doc = ed.getJSON() as JNode;
      const owner = file.data.owner;
      const blob = await writerToDocx(doc, settingsRef.current, titleRef.current || "Untitled");
      await bucket().upload(`${owner}/${id}.writer.json`, new Blob([JSON.stringify({ doc, settings: settingsRef.current })], { type: "application/json" }), { upsert: true });
      const r = await bucket().upload(`${owner}/${id}.docx`, blob, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      if (r.error) throw r.error;
      await mark({ data: { id, size: blob.size, title: titleRef.current || "Untitled" } });
      setState("saved");
    } catch (e) { setState("dirty"); toast.error(`Save failed: ${(e as Error).message}`); }
  }, [file.data, id, mark]);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const titleRef = useRef(title); titleRef.current = title;
  const dirty = useCallback(() => {
    setState("dirty"); clearTimeout(timer.current); timer.current = setTimeout(() => void save(), 2500);
  }, [save]);
  const setSettings = (s: WriterSettings) => { setSettingsRaw(s); dirty(); };

  const editor = editorRef.current;

  async function download() {
    if (!editor) return;
    const blob = await writerToDocx(editor.getJSON() as JNode, settings, title);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${title || "document"}.docx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  if (file.error) return <div className="p-6 text-sm text-muted-foreground">This file could not be opened.</div>;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
        <Button asChild size="icon" variant="ghost" aria-label="Back to Office Studio"><Link to="/app/office"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <input aria-label="Title" value={title} onChange={(e) => { setTitle(e.target.value); dirty(); }}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" />
        <span className="text-xs text-muted-foreground">
          {state === "saving" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : state === "dirty" ? "Unsaved" : "Saved"}
        </span>
        <Button size="sm" variant="outline" onClick={() => void save()}>Save</Button>
        <Button size="sm" variant="outline" onClick={() => void download()}><Download className="mr-1 h-3.5 w-3.5" />.docx</Button>
      </div>
      {!content.data ? <Skeleton className="m-6 h-[600px]" /> : (
        <WriterBody initial={content.data.doc ?? ""} onChange={dirty} settings={settings} setSettings={setSettings}
          onReady={(e) => { editorRef.current = e; editorReady((n) => n + 1); }} />
      )}
    </div>
  );
}

function WriterBody({ initial, onChange, settings, setSettings, onReady }: {
  initial: JNode | string; onChange: () => void; settings: WriterSettings; setSettings: (s: WriterSettings) => void;
  onReady: (e: NonNullable<ReturnType<typeof useWriter>>) => void;
}) {
  const change = useRef(onChange); change.current = onChange;
  const [init] = useState(initial);
  const editor = useWriter(init, () => change.current());
  useEffect(() => { if (editor) onReady(editor); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!editor) return <Skeleton className="m-6 h-[600px]" />;
  return (<>
    <WriterRibbon editor={editor} settings={settings} setSettings={setSettings} />
    <WriterPage editor={editor} settings={settings} setSettings={setSettings} />
  </>);
}
