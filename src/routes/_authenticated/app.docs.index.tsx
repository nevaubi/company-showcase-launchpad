import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Empty, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { fmtRelative } from "@/lib/format";
import { currentUserId } from "@/lib/workspace";
import { useFirm } from "@/components/firm/firm-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/docs/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Docs & sheets — Filed Under" },
      { name: "description", content: "Research notes and live spreadsheets that pull sourced SEC data." },
      { property: "og:title", content: "Docs & sheets — Filed Under" },
      { property: "og:description", content: "Research notes and live spreadsheets that pull sourced SEC data." },
    ],
  }),
  component: Docs,
});

const SHEET_TEMPLATE = {
  rows: 40,
  cols: 12,
  cells: {
    A1: "Metric",
    B1: "FY2023",
    C1: "FY2024",
    D1: "FY2025",
    E1: "CAGR",
    A2: "Revenue ($B)",
    B2: '=FU("AAPL","revenue",B1,"B")',
    C2: '=FU("AAPL","revenue",C1,"B")',
    D2: '=FU("AAPL","revenue",D1,"B")',
    E2: "=CAGR(B2,D2,2)",
    A3: "Net income ($B)",
    B3: '=FU("AAPL","netIncome",B1,"B")',
    C3: '=FU("AAPL","netIncome",C1,"B")',
    D3: '=FU("AAPL","netIncome",D1,"B")',
    E3: "=CAGR(B3,D3,2)",
    A4: "Net margin",
    B4: "=B3/B2",
    C4: "=C3/C2",
    D4: "=D3/D2",
  },
  formats: { E: "pct", B4: "pct", C4: "pct", D4: "pct" },
};

function Docs() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "doc" | "sheet">("all");
  const list = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select("id, title, kind, ticker, updated_at, user_id, firm_id").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async (kind: "doc" | "sheet") => {
      const userId = await currentUserId();
      const { data, error } = await supabase
        .from("documents")
        .insert({ user_id: userId, kind, title: kind === "doc" ? "Untitled note" : "Untitled sheet", content: kind === "doc" ? { html: "" } : SHEET_TEMPLATE })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      navigate({ to: "/app/docs/$id", params: { id } });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const { userId } = useFirm();
  const [owner, setOwner] = useState<"all" | "mine" | "shared">("all");
  const hasShared = (list.data ?? []).some((d) => d.user_id !== userId);
  const items = (list.data ?? []).filter((d) => (filter === "all" || d.kind === filter) && (owner === "all" || (owner === "mine") === (d.user_id === userId)));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Workspace"
        title="Docs & sheets"
        description="Write notes with an AI assistant grounded in filings, and build spreadsheets whose cells pull sourced SEC values with =FU()."
        actions={
          <>
            <Button variant="outline" onClick={() => create.mutate("sheet")} disabled={create.isPending}>
              <FileSpreadsheet /> New sheet
            </Button>
            <Button variant="ink" onClick={() => create.mutate("doc")} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} New doc
            </Button>
          </>
        }
      />
      <div className="mb-3 flex gap-1">
        {(["all", "doc", "sheet"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-md px-3 py-1.5 text-sm capitalize", filter === f ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary")}>
            {f === "all" ? "All" : f === "doc" ? "Docs" : "Sheets"}
          </button>
        ))}
        {hasShared && (
          <span className="ml-auto flex gap-1">
            {(["all", "mine", "shared"] as const).map((o) => (
              <button key={o} onClick={() => setOwner(o)} className={cn("rounded-md px-3 py-1.5 text-sm", owner === o ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary")}>
                {o === "all" ? "Everyone" : o === "mine" ? "Mine" : "Shared with me"}
              </button>
            ))}
          </span>
        )}
      </div>
      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : !items.length ? (
        <Empty title="Nothing here yet" icon={<FileText className="size-6 text-muted-foreground" />}>
          Create a doc for your notes or a sheet for a model.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => (
            <div key={d.id} className="group relative rounded-lg border bg-card shadow-paper transition-colors hover:border-rule">
              <Link to="/app/docs/$id" params={{ id: d.id }} className="block p-4">
                <div className="ruled mb-3 flex h-16 items-end rounded-md border bg-paper/60 p-2">
                  {d.kind === "sheet" ? <FileSpreadsheet className="size-6 text-chart-3" /> : <FileText className="size-6 text-chart-1" />}
                </div>
                <p className="truncate font-medium">{d.title}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{d.kind}</span>
                  {d.ticker && <Badge variant="mono">{d.ticker}</Badge>}
                  {d.user_id !== userId ? <Badge variant="outline" className="gap-1"><Users className="size-3" /> Firm</Badge> : d.firm_id ? <Badge variant="outline" className="gap-1"><Users className="size-3" /> Shared</Badge> : null}
                  <span className="ml-auto">{fmtRelative(d.updated_at)}</span>
                </div>
              </Link>
              {d.user_id === userId && <button
                onClick={() => confirm(`Delete "${d.title}"?`) && remove.mutate(d.id)}
                className="absolute right-2 top-2 rounded p-1.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-negative group-hover:opacity-100"
                aria-label="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
