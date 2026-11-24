import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AltEventList } from "@/components/alt/alt-views";
import { altCellQuery, DATASETS } from "@/lib/alt/query";
import { cn } from "@/lib/utils";

/** Counts per 90-day window as small bars, the latest dark. */
export function Spark({ h }: { h: number[] }) {
  const max = Math.max(1, ...h);
  return (
    <div className="flex h-5 items-end gap-px" aria-hidden>
      {h.map((v, i) => <span key={i} className={cn("w-1.5 rounded-[1px]", i === h.length - 1 ? "bg-foreground" : "bg-muted-foreground/35")} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />)}
    </div>
  );
}

/** One company's records of one dataset for the last 180 days, in a side sheet. */
export function CellSheet({ cell, onClose }: { cell: { ticker: string; dataset: string; text?: string; rule?: string; history?: number[] } | null; onClose: () => void }) {
  const q = useQuery({ ...altCellQuery(cell?.ticker ?? "", cell?.dataset ?? "", 180), enabled: !!cell });
  return (
    <Sheet open={!!cell} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {cell && (
          <>
            <SheetHeader className="border-b p-4 text-left">
              <SheetTitle>{cell.ticker} · {DATASETS[cell.dataset]?.label}</SheetTitle>
              <SheetDescription>{DATASETS[cell.dataset]?.source} · last 180 days</SheetDescription>
              {cell.text && (
                <div className="mt-2 flex items-start gap-3 text-[12px]">
                  {cell.history && <Spark h={cell.history} />}
                  <span className="min-w-0">{cell.text}{cell.rule && <span className="block text-[11px] text-muted-foreground">{cell.rule}</span>}</span>
                </div>
              )}
              <Link to="/app/companies/$ticker/alt-data" params={{ ticker: cell.ticker }} className="mt-2 inline-flex items-center gap-1 text-[12px] underline">Full alt data for {cell.ticker} <ExternalLink className="size-3" /></Link>
            </SheetHeader>
            {q.isLoading ? <Skeleton className="m-4 h-64" /> : <AltEventList rows={q.data ?? []} max={200} />}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
