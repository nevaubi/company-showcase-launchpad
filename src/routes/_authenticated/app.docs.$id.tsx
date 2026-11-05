import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, TriangleAlert } from "lucide-react";
import { DocEditor } from "@/components/docs/doc-editor";
import { SheetEditor, type SheetContent } from "@/components/docs/sheet-editor";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { COVERAGE } from "@/lib/coverage";
import { fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/docs/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Document — Filed Under" },
      { name: "description", content: "Research document editor." },
      { property: "og:title", content: "Document — Filed Under" },
      { property: "og:description", content: "Research document editor." },
    ],
  }),
  component: DocPage,
});

type SaveState = "idle" | "saving" | "saved" | "error";

function DocPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["document", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [title, setTitle] = useState("");
  const [ticker, setTicker] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (q.data) {
      setTitle(q.data.title);
      setTicker(q.data.ticker);
      setSavedAt(q.data.updated_at);
    }
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    setSave("saving");
    const updated_at = new Date().toISOString();
    const { error } = await supabase.from("documents").update({ ...patch, updated_at }).eq("id", id);
    if (error) {
      setSave("error");
      pending.current = { ...patch, ...(pending.current ?? {}) };
      return;
    }
    setSave("saved");
    setSavedAt(updated_at);
    qc.invalidateQueries({ queryKey: ["documents"] });
  }, [id, qc]);

  const queue = useCallback(
    (patch: Record<string, unknown>, delay = 600) => {
      pending.current = { ...(pending.current ?? {}), ...patch };
      setSave("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush],
  );

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      clearTimeout(timer.current);
      flush();
    };
  }, [flush]);

  const onDoc = useCallback((html: string) => queue({ content: { html } }), [queue]);
  const onSheet = useCallback((c: SheetContent) => queue({ content: c }, 100), [queue]);

  if (q.isLoading) return <Skeleton className="h-[70vh]" />;
  if (!q.data)
    return (
      <div className="py-20 text-center">
        <p className="font-display text-3xl">Document not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/app/docs">Back to docs</Link>
        </Button>
      </div>
    );

  const d = q.data;
  const content = (d.content ?? {}) as Record<string, unknown>;

  return (
    <div className={d.kind === "sheet" ? "-mx-4 -mb-16 -mt-6 flex h-[calc(100dvh-3rem)] flex-col lg:-mx-8" : "-mx-4 -mb-16 -mt-6 flex flex-col lg:-mx-8"}>
      <div className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-2 lg:px-6">
        <Link to="/app/docs" className="text-muted-foreground hover:text-foreground" aria-label="Back to docs">
          <ArrowLeft className="size-4" />
        </Link>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queue({ title: e.target.value.trim() || "Untitled" });
          }}
          className="min-w-0 flex-1 bg-transparent font-display text-2xl outline-none"
          maxLength={140}
          aria-label="Title"
        />
        <Select
          value={ticker ?? "none"}
          onValueChange={(v) => {
            const t = v === "none" ? null : v;
            setTicker(t);
            queue({ ticker: t }, 0);
          }}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Link a company" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No company</SelectItem>
            {COVERAGE.map((c) => (
              <SelectItem key={c.ticker} value={c.ticker}>
                {c.ticker} · {c.shortName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex w-28 items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {save === "saving" ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Saving
            </>
          ) : save === "error" ? (
            <button className="flex items-center gap-1 text-negative" onClick={flush}>
              <TriangleAlert className="size-3" /> Retry save
            </button>
          ) : (
            <>
              <Check className="size-3" /> {savedAt ? `Saved ${fmtRelative(savedAt)}` : "Saved"}
            </>
          )}
        </span>
      </div>
      {d.kind === "sheet" ? (
        <SheetEditor initial={content as Partial<SheetContent>} onChange={onSheet} />
      ) : (
        <DocEditor initialHtml={String(content.html ?? "")} title={title} ticker={ticker} onChange={onDoc} />
      )}
    </div>
  );
}
