import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { OfficeAiPanel } from "@/components/office/office-ai-panel";
import { SlidesEditor, useDeck } from "@/components/office/slides-editor";
import { getOfficeFile, markOfficeSaved } from "@/lib/office/files.functions";
import { slidesTool } from "@/lib/office/slides-agent";
import { deckToPptx, pptxToDeck } from "@/lib/office/deck-pptx";
import { blankDeck, type Deck } from "@/lib/office/deck";

export const Route = createFileRoute("/_authenticated/app/office/slides/$id")({
  head: () => ({
    meta: [
      { title: "Slides · FiledUnder" },
      { name: "description", content: "Build PowerPoint decks with OfficeAI from SEC-sourced data." },
      { property: "og:title", content: "Slides · FiledUnder" },
      { property: "og:description", content: "Build PowerPoint decks with OfficeAI from SEC-sourced data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SlidesRoute,
});

const bucket = () => supabase.storage.from("office-files");
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function loadDeck(owner: string, id: string, hasFile: boolean): Promise<Deck> {
  const side = await bucket().download(`${owner}/${id}.slides.json`);
  if (side.data) return JSON.parse(await side.data.text()) as Deck;
  if (hasFile) {
    const f = await bucket().download(`${owner}/${id}.pptx`);
    if (f.data) return pptxToDeck(await f.data.arrayBuffer());
  }
  return blankDeck();
}

function SlidesRoute() {
  const { id } = Route.useParams();
  const get = useServerFn(getOfficeFile);
  const file = useQuery({ queryKey: ["office-file", id], queryFn: () => get({ data: { id } }) });
  const content = useQuery({
    queryKey: ["office-slides", id], enabled: !!file.data, staleTime: Infinity, gcTime: 0,
    queryFn: () => loadDeck(file.data!.owner, id, !!file.data!.storage_path),
  });
  if (file.error || content.error) return <div className="p-6 text-sm text-muted-foreground">This deck could not be opened.</div>;
  if (!file.data || !content.data) return <Skeleton className="m-6 h-[600px]" />;
  return <SlidesBody id={id} owner={file.data.owner} initialTitle={file.data.title} initial={content.data} />;
}

function SlidesBody({ id, owner, initialTitle, initial }: { id: string; owner: string; initialTitle: string; initial: Deck }) {
  const mark = useServerFn(markOfficeSaved);
  const [title, setTitle] = useState(initialTitle);
  const [state, setState] = useState<"saved" | "dirty" | "saving">("saved");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleRef = useRef(title); titleRef.current = title;
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const dirty = useCallback(() => { setState("dirty"); clearTimeout(timer.current); timer.current = setTimeout(() => void saveRef.current(), 2500); }, []);
  const api = useDeck(initial, dirty);

  saveRef.current = async () => {
    setState("saving");
    try {
      const blob = await deckToPptx(api.deck.current, titleRef.current);
      await bucket().upload(`${owner}/${id}.slides.json`, new Blob([JSON.stringify(api.deck.current)], { type: "application/json" }), { upsert: true });
      const r = await bucket().upload(`${owner}/${id}.pptx`, blob, { upsert: true, contentType: PPTX });
      if (r.error) throw r.error;
      await mark({ data: { id, size: blob.size, title: titleRef.current || "Untitled" } });
      setState("saved");
    } catch (e) { setState("dirty"); toast.error(`Save failed: ${(e as Error).message}`); }
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  async function download() {
    const blob = await deckToPptx(api.deck.current, title);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${title || "deck"}.pptx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const setCur = api.setCur;
  const tool = useMemo(() => slidesTool({
    deck: () => api.deck.current, commit: api.commit, select: setCur,
    setTitle: (t) => { setTitle(t); dirty(); },
  }), [api.commit, setCur, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-office="slides" className="-m-4 flex h-[calc(100dvh-7.5rem)] min-w-0 flex-col overflow-hidden border bg-background md:-m-6">
      <div className="flex h-9 min-w-0 shrink-0 items-center gap-2 bg-office px-2 text-office-foreground">
        <Link to="/app/office" aria-label="Back to Office Studio" className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-office-foreground/15"><ArrowLeft className="h-4 w-4" /></Link>
        <span className="text-xs font-semibold">Slides</span>
        <span className="h-4 w-px bg-office-foreground/30" />
        <input aria-label="Title" value={title} onChange={(e) => { setTitle(e.target.value); dirty(); }}
          className="min-w-0 max-w-sm flex-1 rounded-sm bg-transparent px-1.5 py-0.5 text-xs outline-none hover:bg-office-foreground/10 focus:bg-office-foreground/15" />
        <span className="text-[11px] opacity-80">{state === "saving" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : state === "dirty" ? "Saving soon…" : "Saved"}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => void saveRef.current()} className="h-6 rounded-sm px-2 text-[11px] hover:bg-office-foreground/15">Save</button>
          <button onClick={() => void download()} className="flex h-6 items-center gap-1 rounded-sm bg-office-foreground/15 px-2 text-[11px] hover:bg-office-foreground/25"><Download className="h-3 w-3" /> Download .pptx</button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SlidesEditor api={api} />
        <div className="hidden min-h-0 lg:block">
          <OfficeAiPanel app="slides" localTool={tool} context={() => `Slides deck "${titleRef.current}", ${api.deck.current.slides.length} slides; user is on slide ${api.cur + 1}. Call deck_read to see it.`} />
        </div>
      </div>
    </div>
  );
}
