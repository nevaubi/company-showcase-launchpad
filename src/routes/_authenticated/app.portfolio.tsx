import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LoadingState from "@/components/ui/loading-state";
import { ImportDialog } from "@/components/portfolio/import-dialog";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { holdingsToCsv, type Holding } from "@/lib/portfolio/parse";
import { useDeletePortfolio, usePortfolios, useSavePortfolio } from "@/lib/portfolio/store";
import { downloadFile } from "@/lib/exports/chart-export";

const search = z.object({ id: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/app/portfolio")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Portfolio — Filed Under" },
      { name: "description", content: "Exposure, hidden supply-chain overlap, factor and macro sensitivity, supply-shock impact and liquidity for your holdings, each measure with its source." },
      { property: "og:title", content: "Portfolio — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const { id } = Route.useSearch();
  const navigate = Route.useNavigate();
  const list = usePortfolios();
  const save = useSavePortfolio();
  const del = useDeletePortfolio();
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  const current = list.data?.find((p) => p.id === id) ?? list.data?.[0] ?? null;

  const onSave = (title: string, holdings: Holding[]) =>
    save.mutate(
      { id: dialog === "edit" ? current?.id : undefined, title, content: { version: 1, holdings } },
      {
        onSuccess: (newId) => {
          setDialog(null);
          toast.success(`Saved ${holdings.length} holdings`);
          navigate({ search: { id: newId }, replace: true });
        },
      },
    );

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Workspace"
        title="Portfolio"
        description="What your holdings have in common: sector and factor exposure, suppliers and customers they share, revenue at risk when one company stumbles, and how long positions take to exit."
        actions={
          <>
            {(list.data?.length ?? 0) > 1 && current && (
              <Select value={current.id} onValueChange={(v) => navigate({ search: { id: v }, replace: true })}>
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.data!.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {current && (
              <>
                <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadFile(new Blob([holdingsToCsv(current.content.holdings)], { type: "text/csv" }), `${current.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`)}>
                  <Download /> CSV
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete portfolio"
                  onClick={() => {
                    if (window.confirm(`Delete "${current.title}"?`)) del.mutate(current.id, { onSuccess: () => navigate({ search: {}, replace: true }) });
                  }}
                >
                  <Trash2 />
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => setDialog("new")}>
              {current ? <Plus /> : <Upload />} {current ? "New" : "Import holdings"}
            </Button>
          </>
        }
      />
      {list.isLoading ? (
        <LoadingState label="Loading portfolios" variant="Dots" />
      ) : !current ? (
        <div className="border-y bg-card/40 px-4 py-10 text-center">
          <p className="font-display text-xl">No portfolio yet</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Import a broker CSV or paste tickers with share counts or weights. Holdings are saved to your account only.
          </p>
          <Button className="mt-4" onClick={() => setDialog("new")}>
            <Upload /> Import holdings
          </Button>
        </div>
      ) : (
        <PortfolioView key={current.id + current.updated_at} holdings={current.content.holdings} />
      )}
      {dialog && (
        <ImportDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={dialog === "edit" && current ? { title: current.title, holdings: current.content.holdings } : null}
          onSave={onSave}
          saving={save.isPending}
        />
      )}
    </div>
  );
}
