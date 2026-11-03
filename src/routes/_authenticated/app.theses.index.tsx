import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Flag, Plus } from "lucide-react";
import { PageHeader, Empty } from "@/components/app/page-header";
import { ThesisList } from "@/components/app/thesis-list";
import { ThesisForm } from "@/components/app/thesis-form";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/theses/")({
  validateSearch: z.object({ new: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Theses — Filed Under" },
      { name: "description", content: "Investment theses tracked against live prices and new filings." },
      { property: "og:title", content: "Theses — Filed Under" },
      { property: "og:description", content: "Investment theses tracked against live prices and new filings." },
    ],
  }),
  component: Theses,
});

function Theses() {
  const search = Route.useSearch();
  const [open, setOpen] = useState(!!search.new);
  const [tab, setTab] = useState<"active" | "closed">("active");
  const q = useQuery({
    queryKey: ["theses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("theses").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const list = (q.data ?? []).filter((t) => t.status === tab);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Thesis tracker"
        title="Theses"
        description="Write down why you own (or short) something, then let the price, the filings and an AI reviewer keep you honest."
        actions={
          <Button variant="ink" onClick={() => setOpen(true)}>
            <Plus /> New thesis
          </Button>
        }
      />
      <div className="mb-3 flex gap-1">
        {(["active", "closed"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 text-sm capitalize", tab === t ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary")}>
            {t} ({(q.data ?? []).filter((x) => x.status === t).length})
          </button>
        ))}
      </div>
      {q.isError ? (
        <p className="text-sm text-negative">{(q.error as Error).message}</p>
      ) : !q.isLoading && !list.length ? (
        <Empty title={tab === "active" ? "No active theses" : "Nothing closed yet"} icon={<Flag className="size-6 text-muted-foreground" />}>
          {tab === "active" && (
            <Button className="mt-4" variant="outline" onClick={() => setOpen(true)}>
              Write your first thesis
            </Button>
          )}
        </Empty>
      ) : (
        <div className="rounded-lg border bg-card shadow-paper">
          <ThesisList theses={list} loading={q.isLoading} />
        </div>
      )}
      <ThesisForm open={open} onOpenChange={setOpen} />
    </div>
  );
}
