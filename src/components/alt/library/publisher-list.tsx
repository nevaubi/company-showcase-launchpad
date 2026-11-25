import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublisherRowModel } from "./overview";

const ROW = "grid h-[29px] grid-cols-[minmax(0,1fr)_3.5rem_4.5rem] items-center gap-2 border-b";

function Head({ className }: { className?: string }) {
  return (
    <div aria-hidden={className ? true : undefined} className={cn(ROW, "h-7 text-[11px] text-muted-foreground", className)}>
      <span>Publisher</span>
      <span className="text-right">Tables</span>
      <span className="text-right" title="Records in original tables; views repeat their parents' records and are not added">
        Records
      </span>
    </div>
  );
}

/**
 * Every publisher with its tables and records, most tables first, read left to right in up to three columns;
 * a row opens the library filtered to that publisher.
 */
export function PublisherList({ rows, loading }: { rows: PublisherRowModel[]; loading?: boolean }) {
  return (
    <section data-section="Publishers" className="min-w-0 rounded-md border bg-card shadow-paper">
      <header className="flex items-baseline gap-2 border-b px-3.5 py-2">
        <h2 className="text-[14px] font-semibold tracking-tight">Publishers</h2>
        <p className="text-[11px] text-muted-foreground">{loading ? "" : `${rows.length} publishers, most tables first`}</p>
      </header>
      <div className="grid grid-cols-1 gap-x-6 px-3.5 pb-1 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <Head />
        <Head className="hidden @2xl:grid" />
        <Head className="hidden @5xl:grid" />
        {loading
          ? Array.from({ length: 12 }).map((_, i) => (
              <div key={i} aria-hidden className={ROW}>
                <Skeleton className="h-3" />
                <Skeleton className="h-3" />
                <Skeleton className="h-3" />
              </div>
            ))
          : rows.map((p) => (
              <Link
                key={p.id}
                to="/app/alt-data/library"
                search={{ pub: p.id }}
                title={p.name}
                className={cn(ROW, "rounded-sm text-[13px] transition-colors duration-150 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
              >
                <span className="truncate">{p.short}</span>
                <span className="num text-right">{p.tables.toLocaleString("en-US")}</span>
                <span className="num text-right text-muted-foreground" title={p.records.toLocaleString("en-US")}>
                  {fmtCompact(p.records)}
                </span>
              </Link>
            ))}
      </div>
    </section>
  );
}
